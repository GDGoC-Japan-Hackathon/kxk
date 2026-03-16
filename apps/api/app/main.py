from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import random
import re
import secrets
import sqlite3
import time
import xml.etree.ElementTree as ET
from collections import Counter
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    import spacy
except Exception:
    spacy = None


class EventCategory(str, Enum):
    geopolitics = "geopolitics"
    macro = "macro"
    commodities = "commodities"
    tech = "tech"
    crypto = "crypto"
    earnings = "earnings"


class Region(str, Enum):
    NA = "NA"
    SA = "SA"
    EU = "EU"
    MEA = "MEA"
    APAC = "APAC"


FACTOR_KEYS = ["Market", "InterestRate", "USD", "Oil", "Volatility", "Liquidity"]


class Event(BaseModel):
    id: str
    ts: str
    title: str
    summary: str
    source: str
    url: str
    category: EventCategory
    region: Region
    country: str
    country_code: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    severity: float = Field(ge=0, le=1)
    factors: Dict[str, float]
    article_count: int = 1
    updated_at: str
    provenance: str
    top_thumbnail_url: Optional[str] = None


class EventWithArticles(Event):
    articles: List[Dict[str, Any]]


class EventListResponse(BaseModel):
    events: List[Event]
    clusters: List[Event] = Field(default_factory=list)
    source: str
    updated_at: str
    status: str = "live"
    reason: Optional[str] = None
    as_of: Optional[str] = None
    coverage_countries: Optional[int] = None
    coverage_warning: Optional[str] = None
    recommended_since_minutes: Optional[int] = None
    sources_used: List[str] = Field(default_factory=list)
    discard_reasons: Dict[str, int] = Field(default_factory=dict)
    top_rejected_domains: List[List[Any]] = Field(default_factory=list)


class Holding(BaseModel):
    ticker: str = Field(min_length=1, max_length=12)
    weight: float = Field(gt=0)


class PortfolioIn(BaseModel):
    holdings: List[Holding] = Field(min_length=1)


class PortfolioStored(BaseModel):
    holdings: List[Holding]
    normalized: bool


class PortfolioOut(BaseModel):
    portfolio: PortfolioStored
    exposure: Dict[str, float]


class ImpactRequest(BaseModel):
    portfolio: Optional[PortfolioIn] = None
    event_id: Optional[str] = None
    event: Optional[Event] = None
    scenario_rate_shock: float = Field(default=0, ge=-1, le=1)
    scenario_oil_shock: float = Field(default=0, ge=-1, le=1)
    scenario_usd_shock: float = Field(default=0, ge=-1, le=1)


class AssetImpact(BaseModel):
    ticker: str
    weight: float
    signed_impact: float
    abs_impact: float


class ImpactResponse(BaseModel):
    event_id: str
    impact_score: float
    portfolio_exposure: Dict[str, float]
    shock_vector: Dict[str, float]
    per_asset_contributions: List[AssetImpact]
    top_impacted_holdings: List[AssetImpact]


class GeoAggregate(BaseModel):
    name: str
    code: str
    level: str
    region: Region
    lat: float
    lon: float
    article_count: int
    severity_score: float
    updated_at: str
    top_headline: Optional[str] = None


class GeoAggregateResponse(BaseModel):
    generated_at: str
    mode: str
    coverage_countries: int
    coverage_warning: Optional[str] = None
    recommended_since_minutes: Optional[int] = None
    sources_used: List[str] = Field(default_factory=list)
    source: str = "worldlens-db"
    status: str = "live"
    reason: Optional[str] = None
    items: List[GeoAggregate]


class GeoCountryDetailResponse(BaseModel):
    country_code: str
    country: str
    region: Region
    updated_at: str
    clusters: List[Event]


class MarketCatalogItem(BaseModel):
    symbol: str
    name: str
    asset_class: str
    region: str
    type: Optional[str] = None
    currency: Optional[str] = None
    exchange: Optional[str] = None
    provider_priority: List[str] = Field(default_factory=list)
    stooq_symbol: Optional[str] = None
    coingecko_id: Optional[str] = None


class MarketQuote(BaseModel):
    symbol: str
    name: str
    asset_class: str
    region: str
    price: Optional[float] = None
    change_pct: Optional[float] = None
    updated_at: str
    source: str
    series: List[float]
    status: str
    latency_hint: str = "best-effort"
    rate_limit_hint: str = "provider-dependent"
    reason: Optional[str] = None


class MarketHistoryResponse(BaseModel):
    symbol: str
    range: str
    interval: str
    source: str
    status: str
    updated_at: str
    latency_hint: str
    rate_limit_hint: str
    reason: Optional[str] = None
    series_type: str = "ohlcv"
    timezone: str = "UTC"
    ohlcv: List[Dict[str, Any]]
    data: List[List[Optional[float]]] = Field(default_factory=list)


class MarketQuotesResponse(BaseModel):
    asof: str
    mode: str
    items: List[MarketQuote]


class MarketsCatalogResponse(BaseModel):
    updated_at: str
    items: List[MarketCatalogItem]


class WaitlistIn(BaseModel):
    email: str


class AuthIn(BaseModel):
    email: str
    password: str
    newsletter: bool = True


class AuthResponse(BaseModel):
    token: str
    user: Dict[str, Any]


class UserSettingsIn(BaseModel):
    newsletter: bool = True


class MacroChatTurn(BaseModel):
    role: str
    content: str


class MacroChatIn(BaseModel):
    message: str
    history: List[MacroChatTurn] = Field(default_factory=list)


class MacroContextHeadline(BaseModel):
    title: str
    source: str
    url: str
    country: str
    image: Optional[str] = None


class MacroContextMarket(BaseModel):
    symbol: str
    name: str
    latest: Optional[float] = None
    changePct: Optional[float] = None
    source: str


class MacroChatReply(BaseModel):
    summary: str
    answer: List[str] = Field(default_factory=list)
    keyRisks: List[str] = Field(default_factory=list)
    marketImpact: List[str] = Field(default_factory=list)
    watchlist: List[str] = Field(default_factory=list)
    relatedArticles: List[MacroContextHeadline] = Field(default_factory=list)
    followUp: str = ""
    confidenceLabel: str = "Adaptive context"
    queryType: str = "global_risk"


class MacroChatContext(BaseModel):
    markets: List[MacroContextMarket] = Field(default_factory=list)
    headlines: List[MacroContextHeadline] = Field(default_factory=list)
    watchAssets: List[str] = Field(default_factory=list)
    engineState: str = "standby"
    queryType: str = "global_risk"


class MacroChatOut(BaseModel):
    reply: MacroChatReply
    context: MacroChatContext
    updatedAt: str


class AiSummaryIn(BaseModel):
    timeframe: str = "1W"


class AiSummaryOut(BaseModel):
    marketSummary: str
    bullishFactors: List[str] = Field(default_factory=list)
    bearishRisks: List[str] = Field(default_factory=list)
    scenarioOutlook: str


app = FastAPI(title="WorldLens API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "updated_at": now_iso(),
        "source": "api",
        "data": {"version": "dev"}
    }

DB_PATH = os.getenv("WORLDLENS_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "worldlens.db"))
JWT_SECRET = os.getenv("WORLDLENS_AUTH_SECRET", "worldlens-dev-secret")
TOKEN_TTL_HOURS = 72
DATA_DIR = Path(__file__).resolve().parent / "data"
MARKET_CATALOG_PATH = DATA_DIR / "market_catalog.json"
ALLOWLIST_PATH = DATA_DIR / "allowlist.json"
RSS_CATALOG_PATH = DATA_DIR / "rss_catalog.json"
ISO_CODES_PATH = DATA_DIR / "iso3166_alpha2.json"

DB = sqlite3.connect(DB_PATH, check_same_thread=False)
DB.row_factory = sqlite3.Row
DB_LOCK = Lock()

RNG = random.Random(20260216)
LAST_NEWS_SYNC = 0.0
LAST_MARKET_SYNC = 0.0
NEWS_SYNC_INTERVAL_SECONDS = 600
QUOTE_CACHE_SECONDS = 60
HISTORY_CACHE_SECONDS = 900
INTEL_CACHE_SECONDS = 120
INTEL_FEED_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

ASSET_BETAS: Dict[str, Dict[str, float]] = {
    "SPY": {"Market": 1.0, "InterestRate": -0.2, "USD": -0.1, "Oil": 0.15, "Volatility": -0.65, "Liquidity": 0.45},
    "QQQ": {"Market": 1.15, "InterestRate": -0.45, "USD": -0.2, "Oil": 0.05, "Volatility": -0.8, "Liquidity": 0.55},
    "AAPL": {"Market": 1.2, "InterestRate": -0.35, "USD": -0.25, "Oil": 0.05, "Volatility": -0.9, "Liquidity": 0.45},
    "TSLA": {"Market": 1.45, "InterestRate": -0.6, "USD": -0.15, "Oil": 0.2, "Volatility": -1.2, "Liquidity": 0.4},
    "GLD": {"Market": -0.2, "InterestRate": -0.65, "USD": -0.75, "Oil": 0.0, "Volatility": 0.3, "Liquidity": 0.2},
    "BTC": {"Market": 0.75, "InterestRate": -0.25, "USD": -0.55, "Oil": 0.0, "Volatility": -1.5, "Liquidity": 0.8},
    "ETH": {"Market": 0.7, "InterestRate": -0.2, "USD": -0.45, "Oil": 0.0, "Volatility": -1.4, "Liquidity": 0.85},
    "XOM": {"Market": 0.85, "InterestRate": -0.1, "USD": -0.2, "Oil": 1.35, "Volatility": -0.5, "Liquidity": 0.35},
    "TLT": {"Market": -0.35, "InterestRate": -1.4, "USD": -0.05, "Oil": -0.1, "Volatility": 0.4, "Liquidity": 0.3},
}

COUNTRY_META = {
    "US": {"country": "United States", "region": "NA", "lat": 38.5, "lon": -97.5},
    "CA": {"country": "Canada", "region": "NA", "lat": 56.1, "lon": -106.3},
    "MX": {"country": "Mexico", "region": "NA", "lat": 23.6, "lon": -102.5},
    "BR": {"country": "Brazil", "region": "SA", "lat": -14.2, "lon": -51.9},
    "AR": {"country": "Argentina", "region": "SA", "lat": -34.0, "lon": -64.0},
    "CL": {"country": "Chile", "region": "SA", "lat": -35.7, "lon": -71.5},
    "GB": {"country": "United Kingdom", "region": "EU", "lat": 54.0, "lon": -2.5},
    "DE": {"country": "Germany", "region": "EU", "lat": 51.0, "lon": 10.4},
    "FR": {"country": "France", "region": "EU", "lat": 46.2, "lon": 2.2},
    "EU": {"country": "European Union", "region": "EU", "lat": 50.0, "lon": 8.0},
    "SA": {"country": "Saudi Arabia", "region": "MEA", "lat": 23.9, "lon": 45.1},
    "AE": {"country": "United Arab Emirates", "region": "MEA", "lat": 24.3, "lon": 54.3},
    "ZA": {"country": "South Africa", "region": "MEA", "lat": -30.6, "lon": 22.9},
    "CN": {"country": "China", "region": "APAC", "lat": 35.8, "lon": 104.1},
    "JP": {"country": "Japan", "region": "APAC", "lat": 36.2, "lon": 138.3},
    "IN": {"country": "India", "region": "APAC", "lat": 22.6, "lon": 79.5},
    "KR": {"country": "South Korea", "region": "APAC", "lat": 36.5, "lon": 127.8},
    "AU": {"country": "Australia", "region": "APAC", "lat": -25.3, "lon": 133.8},
    "RU": {"country": "Russia", "region": "EU", "lat": 60.0, "lon": 90.0},
    "UA": {"country": "Ukraine", "region": "EU", "lat": 49.0, "lon": 32.0},
    "IL": {"country": "Israel", "region": "MEA", "lat": 31.0, "lon": 35.0},
}

COUNTRY_KEYWORDS = {
    "US": ["u.s.", "united states", "washington", "federal reserve", "fed"],
    "EU": ["europe", "ecb", "eurozone", "european union"],
    "GB": ["uk", "britain", "bank of england"],
    "CN": ["china", "beijing", "pbo c", "pboc"],
    "JP": ["japan", "tokyo", "boj", "bank of japan"],
    "KR": ["korea", "seoul", "bank of korea"],
    "IN": ["india", "rbi"],
    "SA": ["saudi", "riyadh", "opec"],
    "RU": ["russia", "moscow"],
    "UA": ["ukraine", "kyiv"],
    "IL": ["israel", "tel aviv", "gaza"],
}

MACRO_ALLOW = [
    "inflation",
    "central bank",
    "interest rate",
    "policy",
    "sanction",
    "geopolitics",
    "oil",
    "energy",
    "chip",
    "semiconductor",
    "earnings",
    "federal reserve",
    "ecb",
    "boj",
    "pboc",
    "trade",
    "tariff",
    "currency",
    "liquidity",
    "crypto",
    "regulation",
    "macro",
]

DENY_KEYWORDS = [
    "murder",
    "killed",
    "arrested",
    "robbery",
    "shooting",
    "local police",
    "celebrity",
    "weather accident",
    "lottery",
]

REDIRECT_BLOCKLIST = {
    "google.com",
    "news.google.com",
    "googleusercontent.com",
    "t.co",
    "bit.ly",
    "tinyurl.com",
    "rebrand.ly",
    "bing.com",
    "duckduckgo.com",
}

COUNTRY_DOMAIN_ALLOWLIST: Dict[str, List[str]] = {}
PAYWALL_DOMAINS = {
    "ft.com",
    "wsj.com",
    "economist.com",
    "nytimes.com",
    "bloomberg.com",
}

COUNTRY_ALIASES = {
    "US": ["united states", "u.s.", "usa", "america"],
    "GB": ["united kingdom", "uk", "britain", "england"],
    "KR": ["south korea", "korea", "republic of korea"],
    "KP": ["north korea", "dprk"],
    "CN": ["china", "prc"],
    "JP": ["japan"],
    "TW": ["taiwan"],
    "RU": ["russia", "russian federation"],
    "UA": ["ukraine"],
    "AE": ["uae", "united arab emirates"],
    "SA": ["saudi arabia"],
    "IR": ["iran"],
    "IL": ["israel"],
    "PS": ["palestine", "gaza", "west bank"],
    "IN": ["india"],
    "PK": ["pakistan"],
    "TR": ["turkey", "turkiye"],
}

RSS_SOURCES: List[Dict[str, str]] = [
    {"url": "https://feeds.reuters.com/reuters/worldNews", "source": "Reuters", "country_code": "US", "publisher_country": "US"},
    {"url": "https://feeds.bbci.co.uk/news/world/rss.xml", "source": "BBC", "country_code": "GB", "publisher_country": "GB"},
    {"url": "https://www.cnbc.com/id/100003114/device/rss/rss.html", "source": "CNBC", "country_code": "US", "publisher_country": "US"},
    {"url": "https://asia.nikkei.com/rss/feed/nar", "source": "Nikkei", "country_code": "JP", "publisher_country": "JP"},
    {"url": "https://www.ft.com/world?format=rss", "source": "Financial Times", "country_code": "GB", "publisher_country": "GB"},
    {"url": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "source": "NYTimes", "country_code": "US", "publisher_country": "US"},
    {"url": "https://www.aljazeera.com/xml/rss/all.xml", "source": "AlJazeera", "country_code": "QA", "publisher_country": "QA"},
]

NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "").strip()
NLP = None


def load_market_catalog() -> List[Dict[str, Any]]:
    if not MARKET_CATALOG_PATH.exists():
        return []
    try:
        content = json.loads(MARKET_CATALOG_PATH.read_text(encoding="utf-8"))
        if isinstance(content, list):
            return [item for item in content if isinstance(item, dict) and "symbol" in item]
    except Exception:
        return []
    return []


def load_allowlist() -> Dict[str, List[str]]:
    if not ALLOWLIST_PATH.exists():
        return {"GLOBAL": []}
    try:
        data = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
        out: Dict[str, List[str]] = {}
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, list):
                    out[key.upper()] = [str(item).lower().replace("www.", "") for item in value]
        return out or {"GLOBAL": []}
    except Exception:
        return {"GLOBAL": []}


def load_rss_catalog() -> List[Dict[str, str]]:
    if not RSS_CATALOG_PATH.exists():
        return []
    try:
        data = json.loads(RSS_CATALOG_PATH.read_text(encoding="utf-8"))
        out: List[Dict[str, str]] = []
        if isinstance(data, dict):
            for region_code, entries in data.items():
                if not isinstance(entries, list):
                    continue
                for item in entries:
                    if not isinstance(item, dict):
                        continue
                    url = str(item.get("url", "")).strip()
                    if not url:
                        continue
                    out.append(
                        {
                            "url": url,
                            "source": str(item.get("name") or item.get("source") or "RSS"),
                            "publisher_country": str(item.get("publisher_country") or region_code or "").upper()[:2],
                            "language": str(item.get("language") or "en"),
                            "category_hint": str(item.get("category_hint") or "macro"),
                            "region_code": str(region_code).upper(),
                        }
                    )
        return out
    except Exception:
        return []


def load_iso_codes() -> Dict[str, str]:
    if not ISO_CODES_PATH.exists():
        return {}
    try:
        data = json.loads(ISO_CODES_PATH.read_text(encoding="utf-8"))
        out: Dict[str, str] = {}
        if isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                code = str(item.get("code") or "").upper().strip()
                name = str(item.get("name") or "").strip()
                if len(code) == 2 and name:
                    out[code] = name
        return out
    except Exception:
        return {}


MARKET_CATALOG: List[Dict[str, Any]] = load_market_catalog()
COUNTRY_DOMAIN_ALLOWLIST = load_allowlist()
DEFAULT_GLOBAL_DOMAINS = COUNTRY_DOMAIN_ALLOWLIST.get("GLOBAL", [])
RSS_SOURCES = load_rss_catalog() or RSS_SOURCES
ISO_COUNTRIES = load_iso_codes()
if spacy is not None:
    try:
        NLP = spacy.load("en_core_web_sm")
    except Exception:
        NLP = None

MARKET_CATALOG_BY_SYMBOL: Dict[str, Dict[str, Any]] = {str(item.get("symbol", "")).upper(): item for item in MARKET_CATALOG}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


CHAT_REGION_TERMS: Dict[str, List[str]] = {
    "Asia": ["asia", "asian", "apac"],
    "Europe": ["europe", "euro area", "eurozone", "ecb"],
    "Middle East": ["middle east", "gulf", "iran", "israel", "saudi"],
    "United States": ["united states", "u.s.", "us", "america", "fed", "federal reserve"],
}

CHAT_ASSET_TERMS: Dict[str, List[str]] = {
    "Semiconductors": ["semiconductor", "semis", "chip", "chips"],
    "Oil": ["oil", "crude", "brent", "wti", "energy"],
    "FX": ["fx", "yen", "dollar", "usd", "eur", "jpy", "cny", "currency"],
    "Rates": ["rates", "yield", "bond", "treasury", "duration"],
    "Equities": ["equity", "equities", "stock", "stocks", "s&p", "nasdaq"],
    "Gold": ["gold"],
    "Crypto": ["bitcoin", "btc", "crypto", "ethereum"],
}

CHAT_PORTFOLIO_TERMS = ["portfolio", "holdings", "exposure", "drawdown", "hedge", "book", "allocation"]


def extract_output_text(payload: Dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    output = payload.get("output")
    if not isinstance(output, list):
        return ""

    parts: List[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                continue
            text_value = part.get("text")
            if isinstance(text_value, str):
                parts.append(text_value)
    return "\n".join(parts)


def post_openai_json(system_prompt: str, user_payload: Dict[str, Any], schema_name: str, schema: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    body = {
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "schema": schema,
            }
        },
    }

    req = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc

    output_text = extract_output_text(payload)
    if not output_text:
        return None

    try:
        parsed = json.loads(output_text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def chat_tokenize(text: str) -> List[str]:
    return [token for token in re.split(r"[^a-z0-9\-/]+", text.lower()) if len(token) >= 3]


def derive_effective_message(message: str, history: List[MacroChatTurn]) -> str:
    cleaned = message.strip()
    prior_user_messages = [turn.content.strip() for turn in history if turn.role == "user" and turn.content.strip()]
    if not prior_user_messages:
        return cleaned

    short_follow_up = len(cleaned.split()) <= 8
    follow_up_cue = bool(re.search(r"\b(and|also|then|what about|how about|why|which|what if|that one|this one)\b", cleaned, re.I))
    if not short_follow_up and not follow_up_cue:
        return cleaned

    return f"{prior_user_messages[-1]}\nFollow-up: {cleaned}"


def detect_query_type(message: str) -> str:
    lower = message.lower()
    if any(term in lower for term in CHAT_PORTFOLIO_TERMS):
        return "portfolio"
    if any(term in lower for terms in COUNTRY_ALIASES.values() for term in terms) or any(term in lower for terms in CHAT_REGION_TERMS.values() for term in terms):
        return "country_region"
    if any(term in lower for terms in CHAT_ASSET_TERMS.values() for term in terms):
        return "market_asset"
    return "global_risk"


def extract_country_focus(message: str) -> List[str]:
    lower = message.lower()
    matches: List[str] = []
    for code, aliases in COUNTRY_ALIASES.items():
        if any(alias in lower for alias in aliases):
            label = COUNTRY_META.get(code, {}).get("country") or ISO_COUNTRIES.get(code) or code
            if label not in matches:
                matches.append(str(label))
    for label, aliases in CHAT_REGION_TERMS.items():
        if any(alias in lower for alias in aliases) and label not in matches:
            matches.append(label)
    return matches[:4]


def extract_asset_focus(message: str) -> List[str]:
    lower = message.lower()
    matches: List[str] = []
    for label, aliases in CHAT_ASSET_TERMS.items():
        if any(alias in lower for alias in aliases):
            matches.append(label)
    return matches[:4]


def infer_watch_assets(message: str, query_type: str, markets: List[MacroContextMarket]) -> List[str]:
    lower = message.lower()
    watch: List[str] = []
    canonical = {
        "US10Y": "US 10Y",
        "OIL": "Oil",
        "GOLD": "Gold",
        "NASDAQ": "Nasdaq",
        "SP500": "S&P 500",
        "USDJPY": "USDJPY",
        "DXY": "DXY",
    }
    mapping = [
        ("Oil", ["oil", "crude", "brent", "wti"]),
        ("USDJPY", ["yen", "boj", "japan"]),
        ("DXY", ["dollar", "usd", "fx"]),
        ("US 10Y", ["yield", "rates", "treasury", "bond"]),
        ("Gold", ["gold"]),
        ("BTC", ["bitcoin", "btc", "crypto"]),
        ("Semis", ["semiconductor", "semis", "chip"]),
    ]

    def push(label: str) -> None:
        normalized = canonical.get(label, label)
        if normalized not in watch:
            watch.append(normalized)

    for label, aliases in mapping:
        if any(alias in lower for alias in aliases):
            push(label)

    if query_type == "global_risk":
        for item in ["DXY", "US 10Y", "Oil", "Gold"]:
            push(item)
    elif query_type == "portfolio":
        for item in ["Portfolio beta", "Rates", "FX", "Energy"]:
            push(item)

    for market in markets:
        push(market.symbol)
        if len(watch) >= 5:
            break
    return watch[:5]


def format_change(value: Optional[float]) -> str:
    if value is None or math.isnan(value):
        return "flat"
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.2f}%"


def score_event_for_message(event: Event, query_terms: List[str], countries: List[str], assets: List[str], query_type: str) -> float:
    haystack = f"{event.title} {event.summary} {event.country} {event.category.value}".lower()
    score = event.severity * 10
    for token in query_terms:
        if token in haystack:
            score += 1.2
    for country in countries:
        if country.lower() in haystack:
            score += 5
    for asset in assets:
        if asset.lower() in haystack:
            score += 4
    if query_type == "global_risk" and event.severity >= 0.65:
        score += 2
    return score


def score_market_for_message(row: sqlite3.Row, query_terms: List[str], assets: List[str], query_type: str) -> float:
    haystack = f"{row['symbol']} {row['name']}".lower()
    joined_terms = " ".join(query_terms)
    score = 0.0
    for token in query_terms:
        if token in haystack:
            score += 1
    for asset in assets:
        if asset.lower() in haystack:
            score += 4
    if ("yen" in joined_terms or "japan" in joined_terms or "boj" in joined_terms) and row["symbol"] == "USDJPY":
        score += 6
    if ("rates" in joined_terms or "yield" in joined_terms or "treasury" in joined_terms) and row["symbol"] == "US10Y":
        score += 5
    if ("oil" in joined_terms or "crude" in joined_terms or "energy" in joined_terms) and row["symbol"] == "OIL":
        score += 6
    if ("semiconductor" in joined_terms or "semis" in joined_terms or "chip" in joined_terms) and row["symbol"] == "NASDAQ":
        score += 5
    defaults = {
        "global_risk": {"DXY", "GOLD", "OIL", "BTC", "NASDAQ", "SP500"},
        "country_region": {"DXY", "OIL", "GOLD", "SP500", "NASDAQ", "US10Y"},
        "market_asset": {"DXY", "OIL", "GOLD", "BTC", "NASDAQ", "SP500"},
        "portfolio": {"SP500", "NASDAQ", "DXY", "OIL", "GOLD", "US10Y"},
    }
    if row["symbol"] in defaults.get(query_type, set()):
        score += 2.5
    return score


def build_macro_chat_context(message: str, history: List[MacroChatTurn]) -> Tuple[MacroChatContext, Dict[str, Any]]:
    effective_message = derive_effective_message(message, history)
    query_type = detect_query_type(effective_message)
    countries = extract_country_focus(effective_message)
    assets = extract_asset_focus(effective_message)
    query_terms = list(dict.fromkeys(chat_tokenize(effective_message) + [item.lower() for item in countries + assets]))

    events = get_filtered_events(None, None, None, 0.0, 72 * 60, 18)
    ranked_events = sorted(
        events,
        key=lambda item: score_event_for_message(item, query_terms, countries, assets, query_type),
        reverse=True,
    )
    selected_events = ranked_events[:5]

    update_market_cache()
    market_rows = db_fetchall("SELECT * FROM market_cache ORDER BY asset_class, symbol")
    ranked_markets = sorted(
        market_rows,
        key=lambda row: score_market_for_message(row, query_terms, assets, query_type),
        reverse=True,
    )

    selected_markets = [
        MacroContextMarket(
            symbol=str(row["symbol"]),
            name=str(row["name"]),
            latest=float(row["price"]) if row["price"] is not None else None,
            changePct=float(row["change_pct"]) if row["change_pct"] is not None else None,
            source=str(row["source"]),
        )
        for row in ranked_markets[:6]
    ]

    selected_headlines = [
        MacroContextHeadline(
            title=event.title,
            source=event.source,
            url=event.url,
            country=event.country,
            image=event.top_thumbnail_url,
        )
        for event in selected_events
    ]

    watch_assets = infer_watch_assets(effective_message, query_type, selected_markets)
    context = MacroChatContext(
        markets=selected_markets,
        headlines=selected_headlines,
        watchAssets=watch_assets,
        engineState="live" if os.getenv("OPENAI_API_KEY", "").strip() else "standby",
        queryType=query_type,
    )

    profile = {
        "message": message.strip(),
        "effectiveMessage": effective_message,
        "queryType": query_type,
        "countries": countries,
        "assets": assets,
        "queryTerms": query_terms,
    }
    return context, profile


def normalize_string_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def normalize_chat_reply(raw: Optional[Dict[str, Any]], context: MacroChatContext, profile: Dict[str, Any]) -> Optional[MacroChatReply]:
    if not isinstance(raw, dict):
        return None

    allowed_urls = {item.url: item for item in context.headlines}
    related_articles: List[MacroContextHeadline] = []
    for item in raw.get("relatedArticles", []):
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if url in allowed_urls:
            related_articles.append(allowed_urls[url])

    summary = str(raw.get("summary") or "").strip()
    answer = normalize_string_list(raw.get("answer"))
    if not summary:
        return None

    return MacroChatReply(
        summary=summary,
        answer=answer or [summary],
        keyRisks=normalize_string_list(raw.get("keyRisks")),
        marketImpact=normalize_string_list(raw.get("marketImpact")),
        watchlist=normalize_string_list(raw.get("watchlist")) or context.watchAssets,
        relatedArticles=related_articles,
        followUp=str(raw.get("followUp") or "").strip(),
        confidenceLabel=str(raw.get("confidenceLabel") or ("Live model" if context.engineState == "live" else "Context-driven answer")).strip(),
        queryType=str(raw.get("queryType") or profile["queryType"]).strip() or profile["queryType"],
    )


def build_macro_chat_fallback(message: str, history: List[MacroChatTurn], context: MacroChatContext, profile: Dict[str, Any]) -> MacroChatReply:
    lead_headline = context.headlines[0] if context.headlines else None
    supporting_headline = context.headlines[1] if len(context.headlines) > 1 else None
    lead_market = context.markets[0] if context.markets else None
    second_market = context.markets[1] if len(context.markets) > 1 else None
    if profile["countries"]:
        focus_label = ", ".join(profile["countries"])
    elif profile["assets"]:
        asset_focus = profile["assets"][0]
        focus_label = f"{asset_focus.lower()} exposure" if profile["queryType"] == "portfolio" else ", ".join(profile["assets"])
    else:
        focus_label = "the current macro setup"

    if profile["queryType"] == "portfolio":
        summary = (
            f"From a portfolio angle, the main question is whether {focus_label} stays isolated or starts spilling into broader risk pricing."
            if lead_headline
            else "From a portfolio angle, the key issue is whether the shock stays local or leaks into broader rates, FX, and equity beta."
        )
        answer = [
            f"The most relevant live catalyst is {lead_headline.title}." if lead_headline else "There is no single dominant headline, so the portfolio read has to lean more on market transmission than on one article.",
            f"The first thing to test is whether {lead_market.symbol} confirms the move with persistence rather than a one-turn reaction." if lead_market else "The first thing to test is whether rates, FX, and index beta start moving together.",
            "If the move broadens into funding conditions, energy, or dollar strength, portfolio damage rises because the shock is no longer confined to one theme.",
        ]
    elif profile["queryType"] == "country_region":
        summary = f"The answer centers on {focus_label}: the important issue is how the local story transmits into FX, rates, and global risk appetite."
        answer = [
            f"The lead headline is {lead_headline.title}." if lead_headline else f"The live read on {focus_label} is more about transmission than headline volume right now.",
            f"The first market confirmation point is {lead_market.symbol} at {format_change(lead_market.changePct)}." if lead_market else "The first market confirmation point is whether FX and sovereign rates begin moving in the same direction.",
            "If the domestic story stays isolated, global spillover remains limited. If it starts changing policy expectations or commodity flow, the market impact becomes much larger.",
        ]
    elif profile["queryType"] == "market_asset":
        summary = f"For {focus_label}, the right frame is catalyst first, then cross-asset confirmation."
        answer = [
            f"The cleanest macro catalyst in the current context is {lead_headline.title}." if lead_headline else f"The asset move should be read through rates, FX, and policy expectations rather than one headline alone.",
            f"{lead_market.symbol} is the first thing I would trust, currently at {format_change(lead_market.changePct)}." if lead_market else "The first thing I would trust is whether related assets start confirming the move.",
            "If the signal spreads across related assets, the move is probably regime-relevant rather than noise.",
        ]
    else:
        summary = (
            f"The most important global risk in the current feed is {lead_headline.title}."
            if lead_headline
            else "The current global risk picture is still mixed, so the best read comes from cross-asset confirmation."
        )
        answer = [
            f"This matters because it sits closest to the center of today's risk transmission map for {focus_label}." if lead_headline else "This matters because the risk picture is becoming cross-asset rather than headline-specific.",
            f"The first market check is {lead_market.symbol} at {format_change(lead_market.changePct)}." if lead_market else "The first market check is whether the dollar, rates, and crude all begin leaning the same way.",
            "The next step is to watch whether the story remains local or begins to affect funding, inflation expectations, and cyclical equity exposure.",
        ]

    key_risks = [
        f"{lead_headline.country}: escalation would push this from a local story into broader repricing." if lead_headline else "The main risk is that the story broadens faster than the market is currently pricing.",
        f"{lead_market.symbol}: if the move extends beyond the current {format_change(lead_market.changePct)}, the market is treating this as a durable repricing." if lead_market else "Cross-asset confirmation is still the main thing missing.",
    ]
    if supporting_headline:
        key_risks.append(f"{supporting_headline.title}: a second related headline suggests the theme is not isolated.")

    market_impact: List[str] = []
    if lead_market:
        market_impact.append(f"{lead_market.symbol} is the fastest market signal and is currently {format_change(lead_market.changePct)}.")
    if second_market:
        market_impact.append(f"{second_market.symbol} is the next confirmation point after {lead_market.symbol}.")
    if not market_impact:
        market_impact.append("The practical test is whether FX, rates, and equity beta begin confirming one another.")

    follow_up = {
        "portfolio": "If you want, I can map this into sector risk, factor exposure, or hedging implications.",
        "country_region": "If you want, I can narrow this to policy risk, FX transmission, or equity exposure.",
        "market_asset": "If you want, I can break this into catalyst, confirmation assets, and what would invalidate the move.",
        "global_risk": "If you want, I can rank the next two global risks after this one and explain their market channels.",
    }[profile["queryType"]]

    return MacroChatReply(
        summary=summary,
        answer=answer,
        keyRisks=key_risks[:3],
        marketImpact=market_impact[:3],
        watchlist=context.watchAssets,
        relatedArticles=context.headlines[:3],
        followUp=follow_up,
        confidenceLabel="Live model" if context.engineState == "live" else "Context-driven answer",
        queryType=profile["queryType"],
    )


def generate_macro_chat_reply(message: str, history: List[MacroChatTurn]) -> Tuple[MacroChatReply, MacroChatContext]:
    context, profile = build_macro_chat_context(message, history)
    schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "answer": {"type": "array", "items": {"type": "string"}},
            "keyRisks": {"type": "array", "items": {"type": "string"}},
            "marketImpact": {"type": "array", "items": {"type": "string"}},
            "watchlist": {"type": "array", "items": {"type": "string"}},
            "relatedArticles": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "source": {"type": "string"},
                        "url": {"type": "string"},
                        "country": {"type": "string"},
                        "image": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    },
                    "required": ["title", "source", "url", "country", "image"],
                    "additionalProperties": False,
                },
            },
            "followUp": {"type": "string"},
            "confidenceLabel": {"type": "string"},
            "queryType": {"type": "string"},
        },
        "required": ["summary", "answer", "keyRisks", "marketImpact", "watchlist", "relatedArticles", "followUp", "confidenceLabel", "queryType"],
        "additionalProperties": False,
    }
    system_prompt = (
        "You are WorldLens Macro Analyst AI. Answer the user's exact question first. "
        "Do not repeat canned bullish/bearish/scenario templates. Use recent conversation history when the user asks a follow-up. "
        "Vary the structure by the question. Keep the tone direct, analytical, and product-facing. "
        "Use only the provided context. If context is thin, say what is uncertain. "
        "Only include Key Risks, Market Impact, or Watchlist content when it is relevant. "
        "relatedArticles must be selected only from the provided headlines."
    )
    user_payload = {
        "question": message.strip(),
        "effective_question": profile["effectiveMessage"],
        "query_type": profile["queryType"],
        "countries": profile["countries"],
        "assets": profile["assets"],
        "recent_history": [turn.model_dump() for turn in history[-8:]],
        "context": context.model_dump(),
    }

    try:
        raw = post_openai_json(system_prompt, user_payload, "macro_chat_reply", schema)
        normalized = normalize_chat_reply(raw, context, profile)
        if normalized is not None:
            return normalized, context
    except Exception:
        pass

    return build_macro_chat_fallback(message, history, context, profile), context


def build_ai_analysis_fallback(timeframe: str) -> AiSummaryOut:
    events = get_filtered_events(None, None, None, 0.0, 72 * 60, 3)
    update_market_cache()
    rows = db_fetchall("SELECT * FROM market_cache ORDER BY asset_class, symbol LIMIT 6")
    markets = [
        MacroContextMarket(
            symbol=str(row["symbol"]),
            name=str(row["name"]),
            latest=float(row["price"]) if row["price"] is not None else None,
            changePct=float(row["change_pct"]) if row["change_pct"] is not None else None,
            source=str(row["source"]),
        )
        for row in rows[:4]
    ]
    lead_event = events[0] if events else None
    lead_market = markets[0] if markets else None
    return AiSummaryOut(
        marketSummary=(
            f"For the {timeframe} lens, the current market frame is being driven by {lead_event.title}."
            if lead_event
            else f"For the {timeframe} lens, the market setup is mixed and should be read through cross-asset confirmation."
        ),
        bullishFactors=[
            f"{lead_market.symbol} is stable enough to keep risk appetite supported at the margin." if lead_market else "No single market is signaling acute stress yet.",
            "Headline flow is not yet broad enough to force a full risk-off repricing.",
        ],
        bearishRisks=[
            f"{lead_event.country} remains the main source of escalation risk." if lead_event else "A fresh macro shock could still force a rapid repricing.",
            "If FX, rates, and commodities start confirming one another, the downside path gets more credible.",
        ],
        scenarioOutlook="Base case: watch whether today's headline risk stays local or spreads into rates, dollar strength, and cyclical equities.",
    )


def generate_ai_summary(timeframe: str) -> AiSummaryOut:
    fallback = build_ai_analysis_fallback(timeframe)
    events = get_filtered_events(None, None, None, 0.0, 72 * 60, 6)
    update_market_cache()
    rows = db_fetchall("SELECT * FROM market_cache ORDER BY asset_class, symbol LIMIT 8")
    markets = [
        {
            "symbol": str(row["symbol"]),
            "name": str(row["name"]),
            "changePct": float(row["change_pct"]) if row["change_pct"] is not None else None,
        }
        for row in rows
    ]
    schema = {
        "type": "object",
        "properties": {
            "marketSummary": {"type": "string"},
            "bullishFactors": {"type": "array", "items": {"type": "string"}},
            "bearishRisks": {"type": "array", "items": {"type": "string"}},
            "scenarioOutlook": {"type": "string"},
        },
        "required": ["marketSummary", "bullishFactors", "bearishRisks", "scenarioOutlook"],
        "additionalProperties": False,
    }
    system_prompt = (
        "You are WorldLens Macro Analyst AI. Produce a concise market read for the dashboard. "
        "Do not mention API keys, missing configuration, or internal tooling."
    )
    try:
        raw = post_openai_json(
            system_prompt,
            {
                "timeframe": timeframe,
                "headlines": [event.model_dump() for event in events],
                "markets": markets,
            },
            "macro_ai_summary",
            schema,
        )
    except Exception:
        raw = None

    if not isinstance(raw, dict):
        return fallback

    return AiSummaryOut(
        marketSummary=str(raw.get("marketSummary") or fallback.marketSummary).strip(),
        bullishFactors=normalize_string_list(raw.get("bullishFactors")) or fallback.bullishFactors,
        bearishRisks=normalize_string_list(raw.get("bearishRisks")) or fallback.bearishRisks,
        scenarioOutlook=str(raw.get("scenarioOutlook") or fallback.scenarioOutlook).strip(),
    )


def db_exec(query: str, params: tuple = ()) -> None:
    with DB_LOCK:
        DB.execute(query, params)
        DB.commit()


def db_fetchall(query: str, params: tuple = ()) -> List[sqlite3.Row]:
    with DB_LOCK:
        cur = DB.execute(query, params)
        return cur.fetchall()


def db_fetchone(query: str, params: tuple = ()) -> Optional[sqlite3.Row]:
    with DB_LOCK:
        cur = DB.execute(query, params)
        return cur.fetchone()


def init_db() -> None:
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            settings_json TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS waitlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS portfolios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            holdings_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS articles (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            source TEXT NOT NULL,
            published_at TEXT NOT NULL,
            language TEXT,
            country_code TEXT NOT NULL,
            region TEXT NOT NULL,
            category TEXT NOT NULL,
            keywords_json TEXT NOT NULL,
            event_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS news_articles (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            original_url TEXT NOT NULL,
            domain TEXT NOT NULL,
            published_at TEXT NOT NULL,
            country_code TEXT NOT NULL,
            publisher_country TEXT,
            region TEXT NOT NULL,
            category TEXT NOT NULL,
            severity REAL NOT NULL,
            source TEXT NOT NULL,
            ingested_at TEXT NOT NULL,
            thumbnail_url TEXT,
            summary TEXT,
            paywall_flag INTEGER DEFAULT 0
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS article_countries (
            article_id TEXT NOT NULL,
            country_code TEXT NOT NULL,
            PRIMARY KEY (article_id, country_code)
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS news_clusters (
            id TEXT PRIMARY KEY,
            country_code TEXT NOT NULL,
            country TEXT NOT NULL,
            region TEXT NOT NULL,
            category TEXT NOT NULL,
            headline TEXT NOT NULL,
            summary TEXT NOT NULL,
            top_url TEXT NOT NULL,
            top_thumbnail_url TEXT,
            source TEXT NOT NULL,
            severity_score REAL NOT NULL,
            article_count INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS news_cluster_articles (
            cluster_id TEXT NOT NULL,
            article_id TEXT NOT NULL,
            PRIMARY KEY (cluster_id, article_id)
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS news_ingest_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at TEXT NOT NULL,
            new_count INTEGER NOT NULL,
            discarded_count INTEGER NOT NULL,
            reasons_json TEXT NOT NULL,
            coverage_countries INTEGER NOT NULL,
            sources_json TEXT NOT NULL,
            coverage_country_list_json TEXT DEFAULT '[]',
            top_rejected_domains_json TEXT DEFAULT '[]'
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS event_clusters (
            event_id TEXT PRIMARY KEY,
            representative_title TEXT NOT NULL,
            summary TEXT NOT NULL,
            top_url TEXT NOT NULL,
            source TEXT NOT NULL,
            country_code TEXT NOT NULL,
            country TEXT NOT NULL,
            region TEXT NOT NULL,
            category TEXT NOT NULL,
            severity_score REAL NOT NULL,
            factors_json TEXT NOT NULL,
            article_count INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            provenance TEXT NOT NULL
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS market_cache (
            symbol TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            asset_class TEXT NOT NULL,
            region TEXT NOT NULL,
            price REAL,
            change_pct REAL,
            updated_at TEXT NOT NULL,
            source TEXT NOT NULL,
            series_json TEXT NOT NULL,
            status TEXT NOT NULL
        )
        """
    )
    db_exec(
        """
        CREATE TABLE IF NOT EXISTS market_history_cache (
            cache_key TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            range_key TEXT NOT NULL,
            interval_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT
        )
        """
    )
    ensure_column("news_articles", "thumbnail_url", "TEXT")
    ensure_column("news_articles", "summary", "TEXT")
    ensure_column("news_articles", "paywall_flag", "INTEGER DEFAULT 0")
    ensure_column("news_clusters", "top_thumbnail_url", "TEXT")
    ensure_column("news_ingest_stats", "coverage_country_list_json", "TEXT DEFAULT '[]'")
    ensure_column("news_ingest_stats", "top_rejected_domains_json", "TEXT DEFAULT '[]'")


def purge_invalid_urls() -> None:
    rows = db_fetchall("SELECT id, url FROM articles")
    deleted_ids: List[str] = []
    for row in rows:
        url = str(row["url"])
        normalized = normalize_url(url)
        if not normalized:
            deleted_ids.append(str(row["id"]))
            continue
        domain = domain_from_url(normalized)
        if is_redirect_domain(domain):
            deleted_ids.append(str(row["id"]))
            continue
    if deleted_ids:
        db_exec(
            f"DELETE FROM articles WHERE id IN ({','.join('?' for _ in deleted_ids)})",
            tuple(deleted_ids),
        )
    cluster_rows = db_fetchall("SELECT event_id, top_url FROM event_clusters")
    delete_event_ids: List[str] = []
    for row in cluster_rows:
        normalized = normalize_url(str(row["top_url"]))
        if not normalized:
            delete_event_ids.append(str(row["event_id"]))
            continue
        if is_redirect_domain(domain_from_url(normalized)):
            delete_event_ids.append(str(row["event_id"]))
    if delete_event_ids:
        db_exec(f"DELETE FROM event_clusters WHERE event_id IN ({','.join('?' for _ in delete_event_ids)})", tuple(delete_event_ids))


def http_json(url: str, timeout: int = 8) -> Optional[Dict[str, Any]]:
    req = Request(url, headers={"User-Agent": "WorldLens/1.0"})
    try:
        with urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


def http_text(url: str, timeout: int = 8) -> Optional[str]:
    req = Request(url, headers={"User-Agent": "WorldLens/1.0"})
    try:
        with urlopen(req, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="ignore")
    except Exception:
        return None


def normalize_heading(value: Any) -> float:
    try:
        heading = float(value) % 360.0
        return heading if heading >= 0 else heading + 360.0
    except Exception:
        return 0.0


def normalize_lon(value: Any) -> float:
    try:
        lon = float(value)
    except Exception:
        return 0.0
    while lon > 180:
        lon -= 360
    while lon < -180:
        lon += 360
    return lon


def military_callsign(callsign_raw: str, icao24: str) -> bool:
    callsign = (callsign_raw or "").strip().upper()
    if not callsign:
        return False
    patterns = [
        r"^(RCH|FORTE|ASCOT|NATO|REACH|SHELL|DUKE|HAWK|SPAR|JEDI|LAGR|BOLT|CFC)",
        r"^(USAF|RAF|IAF|RFR|AME|MMF|CNV|GAF|QID)",
        r"\b(AIRFORCE|NAVY|ARMY|MIL)\b",
    ]
    if any(re.search(pattern, callsign) for pattern in patterns):
        return True
    hex_id = (icao24 or "").lower()
    return hex_id.startswith(("ae", "ad", "43c", "4b8"))


def cached_intel_items(cache_key: str) -> Optional[List[Dict[str, Any]]]:
    cached = INTEL_FEED_CACHE.get(cache_key)
    if not cached:
        return None
    ts, items = cached
    if time.time() - ts > INTEL_CACHE_SECONDS:
        return None
    return items


def store_intel_items(cache_key: str, items: List[Dict[str, Any]]) -> None:
    INTEL_FEED_CACHE[cache_key] = (time.time(), items)


def fetch_opensky_states() -> List[Dict[str, Any]]:
    cached = cached_intel_items("flights")
    if cached is not None:
        return cached

    headers = {"User-Agent": "WorldLens/1.0"}
    username = os.getenv("OPENSKY_USERNAME")
    password = os.getenv("OPENSKY_PASSWORD")
    if username and password:
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")
        headers["Authorization"] = f"Basic {token}"

    payload = None
    try:
        req = Request("https://opensky-network.org/api/states/all", headers=headers)
        with urlopen(req, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        payload = None

    states = payload.get("states") if isinstance(payload, dict) else []
    items: List[Dict[str, Any]] = []
    for state in states or []:
        try:
            icao24 = str(state[0] or "").strip()
            callsign = str(state[1] or "").strip()
            lon = state[5]
            lat = state[6]
            if not icao24 or lat is None or lon is None:
                continue
            lat_f = float(lat)
            lon_f = normalize_lon(lon)
            altitude = float(state[7] or 0)
            velocity = float(state[9] or 0)
            heading = normalize_heading(state[10] or 0)
            is_military = military_callsign(callsign, icao24)
            items.append({
                "id": icao24,
                "callsign": callsign or icao24.upper(),
                "lat": max(min(lat_f, 90.0), -90.0),
                "lon": lon_f,
                "altitude": altitude if math.isfinite(altitude) else 0.0,
                "velocity": velocity if math.isfinite(velocity) else 0.0,
                "heading": heading,
                "category": "military" if is_military else "civilian",
                "isMilitary": is_military,
                "source": "OpenSky",
            })
        except Exception:
            continue

    if items:
        store_intel_items("flights", items)
    return items


def fetch_celestrak_satellites() -> List[Dict[str, Any]]:
    cached = cached_intel_items("satellites")
    if cached is not None:
        return cached

    groups = [
        ("stations", "station", 8, "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"),
        ("active", "active", 18, "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"),
    ]
    items: List[Dict[str, Any]] = []

    for group_name, sat_type, limit, url in groups:
        bundle = http_text(url, timeout=8)
        if not bundle:
            continue
        lines = [line.strip() for line in bundle.splitlines() if line.strip()]
        count = 0
        for idx in range(0, len(lines) - 2, 3):
            if count >= limit:
                break
            name, line1, line2 = lines[idx : idx + 3]
            if not line1.startswith("1 ") or not line2.startswith("2 "):
                continue
            try:
                inc = float(line2[8:16].strip() or "0")
                raan = float(line2[17:25].strip() or "0")
                mean_motion = float(line2[52:63].strip() or "15")
                altitude = max(350000.0, min(42000000.0, (86400.0 / max(mean_motion, 0.1)) * 110.0))
                lat = max(min(90.0 - inc, 90.0), -90.0)
                lon = normalize_lon(raan)
                items.append({
                    "id": f"{group_name}-{count}",
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "altitude": altitude,
                    "type": sat_type,
                    "source": "CelesTrak",
                })
                count += 1
            except Exception:
                continue

    if items:
        store_intel_items("satellites", items)
    return items


def hash_password(password: str, salt: Optional[str] = None) -> str:
    use_salt = salt or secrets.token_hex(16)
    digest = hashlib.sha256(f"{use_salt}:{password}".encode("utf-8")).hexdigest()
    return f"{use_salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt = stored.split("$", 1)[0]
    except Exception:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def b64url_decode(raw: str) -> bytes:
    padding = "=" * ((4 - len(raw) % 4) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def create_token(payload: Dict[str, Any]) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    body = {**payload, "exp": int((datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)).timestamp())}
    h = b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p = b64url_encode(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(JWT_SECRET.encode("utf-8"), f"{h}.{p}".encode("utf-8"), hashlib.sha256).digest()
    return f"{h}.{p}.{b64url_encode(sig)}"


def decode_token(token: str) -> Dict[str, Any]:
    try:
        h, p, s = token.split(".")
        expected = b64url_encode(hmac.new(JWT_SECRET.encode("utf-8"), f"{h}.{p}".encode("utf-8"), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, s):
            raise ValueError("bad signature")
        payload = json.loads(b64url_decode(p).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        return payload
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def get_current_user(authorization: Optional[str] = Header(default=None)) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.replace("Bearer ", "", 1).strip()
    payload = decode_token(token)
    user_id = int(payload.get("uid", 0))
    user = db_fetchone("SELECT * FROM users WHERE id = ?", (user_id,))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def infer_country_code(text: str) -> str:
    low = text.lower()
    for code, keywords in COUNTRY_KEYWORDS.items():
        if any(keyword in low for keyword in keywords):
            return code
    return RNG.choice(list(COUNTRY_META.keys()))


def infer_category(text: str) -> EventCategory:
    low = text.lower()
    if any(item in low for item in ["sanction", "conflict", "military", "summit", "geopolit", "tariff"]):
        return EventCategory.geopolitics
    if any(item in low for item in ["inflation", "rate", "central bank", "gdp", "cpi", "employment", "fed", "ecb", "boj"]):
        return EventCategory.macro
    if any(item in low for item in ["oil", "opec", "commodity", "natural gas", "brent", "wti"]):
        return EventCategory.commodities
    if any(item in low for item in ["chip", "semiconductor", "ai", "cloud", "export control", "tech"]):
        return EventCategory.tech
    if any(item in low for item in ["crypto", "bitcoin", "ethereum", "exchange", "token", "sec"]):
        return EventCategory.crypto
    return EventCategory.earnings


def macro_allowed(title: str) -> bool:
    low = title.lower()
    if any(word in low for word in DENY_KEYWORDS):
        return False
    return any(word in low for word in MACRO_ALLOW)


def domain_from_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        return parsed.netloc.lower().replace("www.", "")
    except Exception:
        return "unknown"


def normalize_url(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme not in {"http", "https"}:
            return None
        q_items = []
        for pair in parsed.query.split("&"):
            if not pair:
                continue
            key = pair.split("=")[0].lower()
            if key.startswith("utm_") or key in {"gclid", "fbclid"}:
                continue
            q_items.append(pair)
        query = "&".join(q_items)
        clean = parsed._replace(query=query, fragment="")
        return urlunparse(clean)
    except Exception:
        return None


def is_redirect_domain(domain: str) -> bool:
    return any(domain == blocked or domain.endswith(f".{blocked}") for blocked in REDIRECT_BLOCKLIST)


def is_allowed_domain(country_code: str, domain: str) -> bool:
    country_allow = COUNTRY_DOMAIN_ALLOWLIST.get(country_code.upper(), [])
    global_allow = COUNTRY_DOMAIN_ALLOWLIST.get("GLOBAL", [])
    allow = country_allow or global_allow
    return any(domain == item or domain.endswith(f".{item}") for item in allow)


def build_factor_vector(category: EventCategory, severity: float) -> Dict[str, float]:
    template = {
        EventCategory.geopolitics: {"Market": -0.35, "InterestRate": 0.1, "USD": 0.35, "Oil": 0.55, "Volatility": 0.8, "Liquidity": -0.3},
        EventCategory.macro: {"Market": -0.2, "InterestRate": 0.85, "USD": 0.45, "Oil": 0.0, "Volatility": 0.45, "Liquidity": -0.2},
        EventCategory.commodities: {"Market": -0.1, "InterestRate": 0.2, "USD": -0.15, "Oil": 1.0, "Volatility": 0.3, "Liquidity": -0.1},
        EventCategory.tech: {"Market": 0.45, "InterestRate": -0.35, "USD": -0.15, "Oil": 0.0, "Volatility": 0.5, "Liquidity": 0.3},
        EventCategory.crypto: {"Market": -0.15, "InterestRate": 0.05, "USD": 0.2, "Oil": 0.0, "Volatility": 1.0, "Liquidity": -0.65},
        EventCategory.earnings: {"Market": 0.55, "InterestRate": -0.15, "USD": 0.0, "Oil": 0.0, "Volatility": 0.4, "Liquidity": 0.15},
    }[category]

    return {k: round(max(-1.0, min(1.0, v + RNG.uniform(-0.13, 0.13))) * max(0.5, severity), 3) for k, v in template.items()}


def normalize_title(title: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9\s]", " ", title.lower())
    tokens = [t for t in clean.split() if len(t) > 3 and t not in {"with", "from", "after", "into", "this", "that"}]
    return " ".join(tokens[:8])


def _tokenize(text: str) -> List[str]:
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", " ", text.lower())
    return [tok for tok in cleaned.split() if len(tok) > 2]


def parse_time_to_iso(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return now_iso()
    for fmt in ("%a, %d %b %Y %H:%M:%S %Z", "%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except Exception:
            continue
    try:
        dt = datetime.fromisoformat(value)
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()
    except Exception:
        return now_iso()


def extract_thumbnail_from_html(html: str) -> Optional[str]:
    if not html:
        return None
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE)
        if match:
            candidate = normalize_url(match.group(1).strip())
            if candidate:
                return candidate
    return None


def extract_thumbnail_from_rss_item(item: ET.Element) -> Optional[str]:
    namespaces = {
        "media": "http://search.yahoo.com/mrss/",
        "content": "http://purl.org/rss/1.0/modules/content/",
    }
    candidates: List[str] = []
    media_content = item.find("media:content", namespaces)
    if media_content is not None and media_content.get("url"):
        candidates.append(media_content.get("url") or "")
    media_thumbnail = item.find("media:thumbnail", namespaces)
    if media_thumbnail is not None and media_thumbnail.get("url"):
        candidates.append(media_thumbnail.get("url") or "")
    enclosure = item.find("enclosure")
    if enclosure is not None and enclosure.get("url"):
        candidates.append(enclosure.get("url") or "")
    image = item.find("image")
    if image is not None and image.text:
        candidates.append(image.text)
    for value in candidates:
        normalized = normalize_url(value)
        if normalized:
            return normalized
    return None


def ensure_column(table: str, column: str, definition: str) -> None:
    columns = db_fetchall(f"PRAGMA table_info({table})")
    if any(str(row["name"]) == column for row in columns):
        return
    db_exec(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def infer_country_code_from_article(title: str, domain: str, hinted: str = "", location_hint: str = "") -> str:
    raw = (hinted or "").upper().strip()
    if len(raw) == 2 and raw.isalpha():
        return raw
    low = f"{title} {domain} {location_hint}".lower()
    for code, keywords in COUNTRY_KEYWORDS.items():
        if any(keyword in low for keyword in keywords):
            return code
    if NLP is not None:
        try:
            doc = NLP(title)
            country_names = {ent.text.lower() for ent in doc.ents if ent.label_ in {"GPE", "LOC"}}
            for name in country_names:
                for code, keywords in COUNTRY_KEYWORDS.items():
                    if any(key in name for key in keywords):
                        return code
        except Exception:
            pass
    return "ZZ"


def infer_country_mentions(title: str, summary: str, hinted_country: str = "", location_hint: str = "") -> List[str]:
    codes: set[str] = set()
    hint = (hinted_country or "").upper().strip()
    if len(hint) == 2 and hint.isalpha():
        codes.add(hint)
    text = f"{title} {summary} {location_hint}".lower()
    for code, aliases in COUNTRY_ALIASES.items():
        if any(alias in text for alias in aliases):
            codes.add(code)
    if NLP is not None:
        try:
            doc = NLP(f"{title}. {summary}")
            named_places = {ent.text.lower() for ent in doc.ents if ent.label_ in {"GPE", "LOC"}}
            for place in named_places:
                for code, aliases in COUNTRY_ALIASES.items():
                    if any(alias in place for alias in aliases):
                        codes.add(code)
        except Exception:
            pass
    if not codes:
        inferred = infer_country_code_from_article(title, "", hinted_country, location_hint)
        if inferred and inferred != "ZZ":
            codes.add(inferred)
    return sorted(codes) if codes else ["ZZ"]


def get_country_meta(country_code: str) -> Dict[str, Any]:
    cc = country_code.upper()
    if cc == "ZZ":
        return {"country": "Unknown", "region": "NA", "lat": 0.0, "lon": 0.0}
    if cc in COUNTRY_META:
        return COUNTRY_META[cc]
    seed = int(hashlib.sha1(cc.encode("utf-8")).hexdigest()[:8], 16)
    regions = ["NA", "SA", "EU", "MEA", "APAC"]
    region = regions[seed % len(regions)]
    lat = -55 + (seed % 111)
    lon = -170 + ((seed // 7) % 341)
    country_name = ISO_COUNTRIES.get(cc, cc)
    return {"country": country_name, "region": region, "lat": float(lat), "lon": float(lon)}


def score_article_severity(title: str, category: EventCategory) -> float:
    low = title.lower()
    score = 0.45
    if any(w in low for w in ["war", "sanction", "crisis", "surge", "shock", "emergency"]):
        score += 0.25
    if any(w in low for w in ["central bank", "rate", "inflation", "policy", "opec", "tariff"]):
        score += 0.15
    if category in {EventCategory.geopolitics, EventCategory.macro}:
        score += 0.08
    if any(w in low for w in DENY_KEYWORDS):
        score -= 0.2
    return max(0.0, min(1.0, round(score, 3)))


def _tfidf_vectors(texts: List[str]) -> List[Dict[str, float]]:
    token_lists = [_tokenize(text) for text in texts]
    df: Counter[str] = Counter()
    for tokens in token_lists:
        for tok in set(tokens):
            df[tok] += 1
    n_docs = max(1, len(texts))
    vectors: List[Dict[str, float]] = []
    for tokens in token_lists:
        tf = Counter(tokens)
        total = max(1, sum(tf.values()))
        vec: Dict[str, float] = {}
        for tok, count in tf.items():
            idf = math.log((1 + n_docs) / (1 + df[tok])) + 1.0
            vec[tok] = (count / total) * idf
        vectors.append(vec)
    return vectors


def _cosine(a: Dict[str, float], b: Dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(v * b.get(k, 0.0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def ingest_news(force: bool = False) -> None:
    global LAST_NEWS_SYNC
    now = time.time()
    if not force and (now - LAST_NEWS_SYNC) < NEWS_SYNC_INTERVAL_SECONDS:
        return
    LAST_NEWS_SYNC = now
    discard_reasons: Counter[str] = Counter()
    source_domains: set[str] = set()
    rejected_domains: Counter[str] = Counter()
    harvested: List[Dict[str, Any]] = []

    def accept_article(
        title: str,
        raw_url: str,
        source: str,
        published_raw: str,
        hinted_country: str,
        publisher_country: str,
        location_hint: str = "",
        summary: str = "",
        thumbnail_url: Optional[str] = None,
    ) -> None:
        normalized = normalize_url(raw_url)
        if not title.strip() or not normalized:
            discard_reasons["missing-title-or-url"] += 1
            return
        domain = domain_from_url(normalized)
        if is_redirect_domain(domain):
            discard_reasons["redirect-domain"] += 1
            return
        if "search?" in normalized.lower():
            discard_reasons["search-url"] += 1
            return

        countries = infer_country_mentions(title, summary, hinted_country, location_hint)
        allowed = any(is_allowed_domain(code, domain) for code in countries if code != "ZZ")
        if not allowed and not any(domain == item or domain.endswith(f".{item}") for item in DEFAULT_GLOBAL_DOMAINS):
            discard_reasons["domain-not-allowlisted"] += 1
            rejected_domains[domain] += 1
            return

        category = infer_category(title)
        if any(word in title.lower() for word in DENY_KEYWORDS):
            discard_reasons["denied-local-crime"] += 1
            return

        primary_country = next((code for code in countries if code != "ZZ"), None) or (publisher_country.upper()[:2] if publisher_country else "ZZ")
        if not thumbnail_url:
            html = http_text(normalized, timeout=4)
            if html:
                thumbnail_url = extract_thumbnail_from_html(html)

        meta = get_country_meta(primary_country)
        harvested.append(
            {
                "id": hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16],
                "title": title.strip(),
                "original_url": normalized,
                "domain": domain,
                "published_at": parse_time_to_iso(published_raw),
                "country_code": primary_country,
                "countries": countries,
                "publisher_country": (publisher_country or "").upper()[:2] or None,
                "country": meta["country"],
                "region": meta["region"],
                "category": category.value,
                "severity": score_article_severity(title, category),
                "source": source.strip() or domain,
                "ingested_at": now_iso(),
                "summary": summary[:400],
                "thumbnail_url": thumbnail_url,
                "paywall_flag": 1 if any(domain == blocked or domain.endswith(f".{blocked}") for blocked in PAYWALL_DOMAINS) else 0,
            }
        )
        source_domains.add(domain)

    # Source A: GDELT DOC
    gdelt_queries = [
        "(inflation OR central bank OR interest rates OR GDP OR CPI OR currency OR bond yields)",
        "(geopolitics OR sanctions OR war OR conflict OR treaty OR tariff OR export controls)",
        "(oil OR gas OR OPEC OR commodities OR shipping OR energy markets)",
        "(semiconductor OR AI OR regulation OR antitrust OR cloud OR cyber)",
        "(crypto regulation OR bitcoin ETF OR SEC OR stablecoin OR exchange)",
    ]
    gdelt_ok = False
    for query in gdelt_queries:
        gdelt_params = {
            "query": query,
            "mode": "ArtList",
            "maxrecords": "250",
            "format": "json",
            "sort": "DateDesc",
            "formatting": "json",
        }
        gdelt = http_json(f"https://api.gdeltproject.org/api/v2/doc/doc?{urlencode(gdelt_params)}")
        if not gdelt or not isinstance(gdelt.get("articles"), list):
            continue
        gdelt_ok = True
        for article in gdelt["articles"]:
            accept_article(
                str(article.get("title", "")),
                str(article.get("url", "")),
                str(article.get("sourceCommonName") or article.get("domain") or "GDELT"),
                str(article.get("seendate") or article.get("seendateutc") or ""),
                str(article.get("sourcecountry") or ""),
                str(article.get("sourcecountry") or ""),
                str(article.get("locations") or article.get("themes") or ""),
                str(article.get("socialimage") or article.get("snippet") or ""),
                str(article.get("socialimage") or "") or None,
            )
    if not gdelt_ok:
        discard_reasons["gdelt-unavailable"] += 1

    # Source B: Regional RSS feeds (original links only)
    for rss in RSS_SOURCES:
        xml_text = http_text(rss["url"])
        if not xml_text:
            discard_reasons["rss-unavailable"] += 1
            continue
        try:
            root = ET.fromstring(xml_text)
        except Exception:
            discard_reasons["rss-parse-error"] += 1
            continue
        items = root.findall(".//item")
        for item in items[:80]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or item.findtext("guid") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            description = (item.findtext("description") or item.findtext("summary") or "").strip()
            thumb = extract_thumbnail_from_rss_item(item)
            accept_article(title, link, rss["source"], pub, rss.get("region_code", ""), rss["publisher_country"], "", description, thumb)

    # Deduplicate by URL id, keep newest instance
    by_id: Dict[str, Dict[str, Any]] = {}
    for row in harvested:
        current = by_id.get(row["id"])
        if current is None or row["published_at"] > current["published_at"]:
            by_id[row["id"]] = row
    rows = list(by_id.values())

    for row in rows:
        db_exec(
            """
            INSERT OR REPLACE INTO news_articles
            (id, title, original_url, domain, published_at, country_code, publisher_country, region, category, severity, source, ingested_at, thumbnail_url, summary, paywall_flag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["title"],
                row["original_url"],
                row["domain"],
                row["published_at"],
                row["country_code"],
                row["publisher_country"],
                row["region"],
                row["category"],
                row["severity"],
                row["source"],
                row["ingested_at"],
                row.get("thumbnail_url"),
                row.get("summary"),
                int(row.get("paywall_flag", 0)),
            ),
        )
        db_exec("DELETE FROM article_countries WHERE article_id = ?", (row["id"],))
        for cc in row.get("countries", ["ZZ"]):
            code = str(cc).upper()[:2]
            if len(code) == 2:
                db_exec("INSERT OR IGNORE INTO article_countries (article_id, country_code) VALUES (?, ?)", (row["id"], code))

    # Rebuild clusters from recent articles
    since = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    article_rows = db_fetchall(
        """
        SELECT id, title, original_url, domain, published_at, country_code, publisher_country, region, category, severity, source, thumbnail_url, summary, paywall_flag
        FROM news_articles
        WHERE published_at >= ?
        ORDER BY published_at DESC
        """,
        (since,),
    )

    db_exec("DELETE FROM news_cluster_articles")
    db_exec("DELETE FROM news_clusters")
    db_exec("DELETE FROM event_clusters")
    db_exec("DELETE FROM articles")

    grouped: Dict[Tuple[str, str], List[sqlite3.Row]] = defaultdict(list)
    for row in article_rows:
        cc_rows = db_fetchall("SELECT country_code FROM article_countries WHERE article_id = ?", (str(row["id"]),))
        mentions = [str(item["country_code"]).upper() for item in cc_rows if str(item["country_code"]).upper() != "ZZ"]
        if not mentions:
            if str(row["country_code"]).upper() != "ZZ":
                mentions = [str(row["country_code"]).upper()]
        for country_code in set(mentions):
            grouped[(country_code, str(row["category"]))].append(row)

    cluster_count = 0
    for (country_code, category_value), group in grouped.items():
        titles = [str(row["title"]) for row in group]
        vectors = _tfidf_vectors(titles)
        assigned = [-1] * len(group)
        clusters: List[List[int]] = []

        for idx in range(len(group)):
            if assigned[idx] != -1:
                continue
            cluster_id = len(clusters)
            clusters.append([idx])
            assigned[idx] = cluster_id
            centroid = dict(vectors[idx])
            for j in range(idx + 1, len(group)):
                if assigned[j] != -1:
                    continue
                sim = _cosine(centroid, vectors[j])
                if sim >= 0.22:
                    assigned[j] = cluster_id
                    clusters[cluster_id].append(j)

        for indices in clusters:
            members = [group[i] for i in indices]
            members.sort(key=lambda item: str(item["published_at"]), reverse=True)
            newest = members[0]
            ewma = 0.0
            alpha = 0.35
            for member in members:
                ewma = alpha * float(member["severity"]) + (1 - alpha) * ewma
            severity = round(max(0.0, min(1.0, ewma)), 3)
            sources = sorted({str(member["source"]) for member in members})
            summary = f"{len(members)} linked articles across {len(sources)} sources."
            cluster_basis = f"{country_code}|{category_value}|{str(newest['title'])}"
            cluster_id = f"clu_{hashlib.sha1(cluster_basis.encode('utf-8')).hexdigest()[:14]}"
            meta = get_country_meta(country_code)
            top_thumbnail = None
            for member in members:
                if member["thumbnail_url"]:
                    top_thumbnail = str(member["thumbnail_url"])
                    break

            db_exec(
                """
                INSERT OR REPLACE INTO news_clusters
                (id, country_code, country, region, category, headline, summary, top_url, top_thumbnail_url, source, severity_score, article_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cluster_id,
                    country_code,
                    meta["country"],
                    meta["region"],
                    category_value,
                    str(newest["title"]),
                    summary,
                    str(newest["original_url"]),
                    top_thumbnail,
                    str(newest["source"]),
                    severity,
                    len(members),
                    str(newest["published_at"]),
                ),
            )

            category = EventCategory(category_value)
            db_exec(
                """
                INSERT OR REPLACE INTO event_clusters
                (event_id, representative_title, summary, top_url, source, country_code, country, region,
                 category, severity_score, factors_json, article_count, updated_at, provenance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cluster_id,
                    str(newest["title"]),
                    summary,
                    str(newest["original_url"]),
                    str(newest["source"]),
                    country_code,
                    meta["country"],
                    meta["region"],
                    category_value,
                    severity,
                    json.dumps(build_factor_vector(category, severity)),
                    len(members),
                    str(newest["published_at"]),
                    "news-cluster",
                ),
            )

            for member in members:
                db_exec(
                    "INSERT OR REPLACE INTO news_cluster_articles (cluster_id, article_id) VALUES (?, ?)",
                    (cluster_id, str(member["id"])),
                )
                db_exec(
                    """
                    INSERT OR REPLACE INTO articles
                    (id, title, url, source, published_at, language, country_code, region, category, keywords_json, event_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(member["id"]),
                        str(member["title"]),
                        str(member["original_url"]),
                        str(member["source"]),
                        str(member["published_at"]),
                        "en",
                        country_code,
                        meta["region"],
                        category_value,
                        json.dumps(_tokenize(str(member["title"]))[:12]),
                        cluster_id,
                        now_iso(),
                    ),
                )
            cluster_count += 1

    coverage_codes = sorted({code for (code, _cat) in grouped.keys() if code != "ZZ"})
    coverage = len(coverage_codes)
    reasons_json = dict(discard_reasons)
    db_exec(
        """
        INSERT INTO news_ingest_stats
        (run_at, new_count, discarded_count, reasons_json, coverage_countries, sources_json, coverage_country_list_json, top_rejected_domains_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            now_iso(),
            len(rows),
            int(sum(discard_reasons.values())),
            json.dumps(reasons_json),
            coverage,
            json.dumps(sorted(source_domains)[:80]),
            json.dumps(coverage_codes),
            json.dumps(rejected_domains.most_common(20)),
        ),
    )

    print(
        "[worldlens] news_ingest",
        f"new={len(rows)}",
        f"discarded={sum(discard_reasons.values())}",
        f"reasons={discard_reasons.most_common(3)}",
        f"coverage={coverage}",
        f"sources={len(source_domains)}",
    )


def ensure_market_seed() -> None:
    existing = db_fetchone("SELECT COUNT(1) AS c FROM market_cache")
    if existing and int(existing["c"]) > 0:
        return
    for item in MARKET_CATALOG:
        db_exec(
            """
            INSERT OR REPLACE INTO market_cache
            (symbol, name, asset_class, region, price, change_pct, updated_at, source, series_json, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["symbol"],
                item["name"],
                item["asset_class"],
                item["region"],
                None,
                None,
                now_iso(),
                "uninitialized",
                json.dumps([]),
                "unavailable",
            ),
        )


def _fetch_stooq_quote(symbol: str) -> Optional[Tuple[float, Optional[float], List[float], str]]:
    item = MARKET_CATALOG_BY_SYMBOL.get(symbol.upper(), {})
    stooq_symbol = str(item.get("stooq_symbol") or symbol).lower()
    data = http_json(f"https://stooq.com/q/l/?s={stooq_symbol}&f=sd2t2ohlcv&h&e=json")
    if not data:
        return None
    try:
        if "symbols" not in data or not data["symbols"]:
            return None
        row = data["symbols"][0]
        close = row.get("close")
        if close in (None, "N/D"):
            return None
        price = float(close)
        open_px = row.get("open")
        prev = float(open_px) if open_px not in (None, "N/D") else None
        change_pct = None if prev in (None, 0) else round(((price - float(prev)) / float(prev)) * 100, 3)
        return price, change_pct, [price], "Stooq"
    except Exception:
        return None


def _fetch_yahoo_quote(symbol: str) -> Optional[Tuple[float, Optional[float], List[float], str]]:
    data = http_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{quote_plus(symbol)}?range=5d&interval=1d")
    if not data:
        return None
    try:
        result = data["chart"]["result"][0]
        meta = result.get("meta", {})
        price = float(meta.get("regularMarketPrice"))
        prev = meta.get("previousClose")
        change_pct = None if prev in (None, 0) else round(((price - float(prev)) / float(prev)) * 100, 3)
        closes = [float(x) for x in (result.get("indicators", {}).get("quote", [{}])[0].get("close", []) or []) if x is not None]
        series = closes[-36:] if closes else [price]
        return price, change_pct, series, "Yahoo Finance"
    except Exception:
        return None


def _fetch_coingecko() -> Dict[str, Tuple[float, float, List[float], str]]:
    mapping = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "SOL": "solana",
        "XRP": "ripple",
        "BNB": "binancecoin",
        "ADA": "cardano",
        "DOGE": "dogecoin",
    }
    ids = ",".join(mapping.values())
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true"
    payload = http_json(url)
    out: Dict[str, Tuple[float, float, List[float], str]] = {}
    if not payload:
        return out

    for symbol, key in mapping.items():
        if key not in payload:
            continue
        point = payload[key]
        price = float(point.get("usd", 0))
        pct = float(point.get("usd_24h_change", 0))
        out[symbol] = (price, round(pct, 3), [round(price, 6)], "CoinGecko")
    return out


def _fetch_fx() -> Dict[str, Tuple[float, float, List[float], str]]:
    payload = http_json("https://api.exchangerate.host/latest?base=USD&symbols=JPY,KRW,EUR")
    out: Dict[str, Tuple[float, float, List[float], str]] = {}
    if payload and "rates" in payload:
        rates = payload["rates"]
        usdjpy = float(rates.get("JPY", 0))
        usdkrw = float(rates.get("KRW", 0))
        eurusd = 0 if float(rates.get("EUR", 0)) == 0 else 1 / float(rates.get("EUR", 0))
        for symbol, value in {"USDJPY": usdjpy, "USDKRW": usdkrw, "EURUSD": eurusd}.items():
            if value > 0:
                out[symbol] = (round(value, 6), 0.0, [round(value, 6)], "exchangerate.host")

    if out:
        return out

    xml_text = http_text("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
    if not xml_text:
        return out
    try:
        rates: Dict[str, float] = {}
        for code in ["USD", "JPY"]:
            match = re.search(rf'currency=\"{code}\"\\s+rate=\"([0-9.]+)\"', xml_text)
            if match:
                rates[code] = float(match.group(1))
        if "USD" in rates and "JPY" in rates:
            eurusd = rates["USD"]
            usdjpy = rates["JPY"] / rates["USD"]
            out["EURUSD"] = (round(eurusd, 6), 0.0, [round(eurusd, 6)], "ECB")
            out["USDJPY"] = (round(usdjpy, 6), 0.0, [round(usdjpy, 6)], "ECB")
    except Exception:
        return {}
    return out


def update_market_cache(force: bool = False) -> None:
    global LAST_MARKET_SYNC
    now = time.time()
    if not force and (now - LAST_MARKET_SYNC) < QUOTE_CACHE_SECONDS:
        return
    LAST_MARKET_SYNC = now

    ensure_market_seed()

    crypto_data = _fetch_coingecko()
    fx_data = _fetch_fx()

    for item in MARKET_CATALOG:
        symbol = item["symbol"]
        price: Optional[float] = None
        change_pct: Optional[float] = None
        source = "unavailable"
        series: List[float] = []
        status = "unavailable"
        reason: Optional[str] = "No free provider response"

        if symbol in crypto_data:
            price, change_pct, series, source = crypto_data[symbol]
            status = "live"
            reason = None
        elif symbol in fx_data:
            price, change_pct, series, source = fx_data[symbol]
            status = "live"
            reason = None
        else:
            stooq = _fetch_stooq_quote(symbol)
            parsed = stooq or _fetch_yahoo_quote(symbol)
            if parsed:
                price, change_pct, series, source = parsed
                status = "live"
                reason = None

        if price is None:
            prev = db_fetchone("SELECT price, change_pct, series_json, updated_at, source FROM market_cache WHERE symbol = ?", (symbol,))
            if prev:
                updated_at = prev["updated_at"] if "updated_at" in prev.keys() else None
                if not updated_at and "as_of" in prev.keys():
                    updated_at = prev["as_of"]

                prev_ts = datetime(1970, 1, 1, tzinfo=timezone.utc)
                if updated_at:
                    try:
                        parsed_ts = datetime.fromisoformat(updated_at)
                        prev_ts = parsed_ts if parsed_ts.tzinfo else parsed_ts.replace(tzinfo=timezone.utc)
                    except Exception:
                        prev_ts = datetime(1970, 1, 1, tzinfo=timezone.utc)

                age = (datetime.now(timezone.utc) - prev_ts).total_seconds()
                if prev["price"] is not None and age < HISTORY_CACHE_SECONDS:
                    price = float(prev["price"])
                    change_pct = float(prev["change_pct"]) if prev["change_pct"] is not None else None
                    series = json.loads(prev["series_json"])
                    source = str(prev["source"] or "cache")
                    status = "stale"
                    reason = "Using cached quote"

        db_exec(
            """
            INSERT OR REPLACE INTO market_cache
            (symbol, name, asset_class, region, price, change_pct, updated_at, source, series_json, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                symbol,
                item["name"],
                item["asset_class"],
                item["region"],
                price,
                change_pct,
                now_iso(),
                source,
                json.dumps(series[-36:] if series else []),
                status,
            ),
        )


def _fetch_history_from_yahoo(symbol: str, range_key: str, interval_key: str) -> Optional[List[Dict[str, Any]]]:
    data = http_json(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{quote_plus(symbol)}?range={quote_plus(range_key)}&interval={quote_plus(interval_key)}"
    )
    if not data:
        return None
    try:
        result = data["chart"]["result"][0]
        timestamps = result.get("timestamp", []) or []
        quote = result.get("indicators", {}).get("quote", [{}])[0]
        opens = quote.get("open", []) or []
        highs = quote.get("high", []) or []
        lows = quote.get("low", []) or []
        closes = quote.get("close", []) or []
        volumes = quote.get("volume", []) or []
        out: List[Dict[str, Any]] = []
        for idx, ts in enumerate(timestamps):
            close = closes[idx] if idx < len(closes) else None
            if close is None:
                continue
            out.append(
                {
                    "t": datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat(),
                    "o": opens[idx] if idx < len(opens) else None,
                    "h": highs[idx] if idx < len(highs) else None,
                    "l": lows[idx] if idx < len(lows) else None,
                    "c": close,
                    "v": volumes[idx] if idx < len(volumes) else None,
                }
            )
        return out[-2000:]
    except Exception:
        return None


def _fetch_history_from_coingecko(symbol: str, range_key: str) -> Optional[List[Dict[str, Any]]]:
    item = MARKET_CATALOG_BY_SYMBOL.get(symbol.upper(), {})
    cg_id = item.get("coingecko_id")
    if not cg_id:
        return None
    days_map = {"1D": "1", "5D": "5", "1W": "7", "1M": "30", "3M": "90", "6M": "180", "1Y": "365", "5Y": "1825", "MAX": "max"}
    days = days_map.get(range_key.upper(), "30")
    payload = http_json(
        f"https://api.coingecko.com/api/v3/coins/{quote_plus(str(cg_id))}/market_chart?vs_currency=usd&days={days}"
    )
    if not payload or "prices" not in payload:
        return None
    out: List[Dict[str, Any]] = []
    for point in payload.get("prices", []):
        if not isinstance(point, list) or len(point) < 2:
            continue
        ts_ms, close = point[0], point[1]
        try:
            ts = datetime.fromtimestamp(float(ts_ms) / 1000.0, tz=timezone.utc).isoformat()
            c = float(close)
        except Exception:
            continue
        out.append({"t": ts, "o": c, "h": c, "l": c, "c": c, "v": None})
    return out[-3000:]


def _fetch_history_from_stooq(symbol: str) -> Optional[List[Dict[str, Any]]]:
    item = MARKET_CATALOG_BY_SYMBOL.get(symbol.upper(), {})
    stooq_symbol = item.get("stooq_symbol")
    if not stooq_symbol:
        return None
    csv_text = http_text(f"https://stooq.com/q/d/l/?s={quote_plus(str(stooq_symbol))}&i=d")
    if not csv_text or "Date,Open,High,Low,Close" not in csv_text:
        return None
    out: List[Dict[str, Any]] = []
    lines = [line.strip() for line in csv_text.splitlines() if line.strip()]
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        date_raw, o, h, l, c = parts[:5]
        v = parts[5] if len(parts) > 5 else None
        if c in {"", "N/D"}:
            continue
        try:
            ts = datetime.strptime(date_raw, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
            out.append(
                {
                    "t": ts,
                    "o": float(o) if o not in {"", "N/D"} else None,
                    "h": float(h) if h not in {"", "N/D"} else None,
                    "l": float(l) if l not in {"", "N/D"} else None,
                    "c": float(c),
                    "v": float(v) if v not in {None, "", "N/D"} else None,
                }
            )
        except Exception:
            continue
    return out[-3000:]


def get_market_history(symbol: str, range_key: str, interval_key: str) -> MarketHistoryResponse:
    def trim_payload(rows: List[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
        if not rows:
            return rows
        days_map = {"1W": 7, "1M": 31, "3M": 93, "6M": 186, "1Y": 370, "5Y": 1860}
        key_u = key.upper()
        if key_u not in days_map:
            return rows
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_map[key_u])
        return [item for item in rows if datetime.fromisoformat(str(item["t"])) >= cutoff]

    cache_key = f"{symbol}|{range_key}|{interval_key}"
    row = db_fetchone("SELECT * FROM market_history_cache WHERE cache_key = ?", (cache_key,))
    if row:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(row["updated_at"])).total_seconds()
        if age < HISTORY_CACHE_SECONDS:
            ohlcv = json.loads(row["payload_json"])
            return MarketHistoryResponse(
                symbol=symbol,
                range=range_key,
                interval=interval_key,
                source=row["source"],
                status=row["status"],
                updated_at=row["updated_at"],
                latency_hint="cached <=15m",
                rate_limit_hint="provider dependent",
                reason=row["reason"],
                series_type="line" if symbol in {"BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "EURUSD", "USDJPY", "USDKRW"} else "ohlcv",
                timezone="UTC",
                ohlcv=ohlcv,
                data=[[datetime.fromisoformat(item["t"]).timestamp(), item.get("o"), item.get("h"), item.get("l"), item.get("c"), item.get("v")] for item in ohlcv],
            )

    payload: Optional[List[Dict[str, Any]]] = None
    source = "unavailable"
    status = "unavailable"
    reason: Optional[str] = "No free history provider response"

    # provider priority: CoinGecko for crypto, Stooq first for listed symbols, Yahoo fallback
    payload = _fetch_history_from_coingecko(symbol, range_key)
    if payload is not None and payload:
        source = "CoinGecko"
        status = "live"
        reason = None
    else:
        payload = _fetch_history_from_stooq(symbol)
        if payload is not None and payload:
            source = "Stooq"
            status = "live"
            reason = None
        else:
            payload = _fetch_history_from_yahoo(symbol, range_key, interval_key)
            if payload is not None and payload:
                source = "Yahoo Finance"
                status = "live"
                reason = None
            else:
                payload = []

    payload = trim_payload(payload, range_key)
    now_stamp = now_iso()
    db_exec(
        """
        INSERT OR REPLACE INTO market_history_cache
        (cache_key, symbol, range_key, interval_key, payload_json, updated_at, source, status, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (cache_key, symbol, range_key, interval_key, json.dumps(payload), now_stamp, source, status, reason),
    )
    return MarketHistoryResponse(
        symbol=symbol,
        range=range_key,
        interval=interval_key,
        source=source,
        status=status,
        updated_at=now_stamp,
        latency_hint="provider dependent",
        rate_limit_hint="provider dependent",
        reason=reason,
        series_type="line" if source in {"CoinGecko", "ECB", "exchangerate.host"} else "ohlcv",
        timezone="UTC",
        ohlcv=payload,
        data=[[datetime.fromisoformat(item["t"]).timestamp(), item.get("o"), item.get("h"), item.get("l"), item.get("c"), item.get("v")] for item in payload],
    )


def get_filtered_events(
    category: Optional[EventCategory],
    region: Optional[Region],
    country_code: Optional[str],
    min_severity: float,
    since_minutes: int,
    limit: int,
) -> List[Event]:
    ingest_news()
    since = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
    normalized_country: Optional[str] = None
    if isinstance(country_code, str):
        normalized_country = country_code.upper()

    conditions = ["severity_score >= ?"]
    params: List[Any] = [min_severity]

    if category is not None:
        conditions.append("category = ?")
        params.append(category.value)
    if region is not None:
        conditions.append("region = ?")
        params.append(region.value)
    if normalized_country is not None:
        conditions.append("country_code = ?")
        params.append(normalized_country)

    conditions.append("updated_at >= ?")
    params.append(since.isoformat())

    sql = (
        "SELECT * FROM event_clusters WHERE "
        + " AND ".join(conditions)
        + " ORDER BY severity_score DESC, updated_at DESC LIMIT ?"
    )
    params.append(limit)

    rows = db_fetchall(sql, tuple(params))
    events: List[Event] = []
    for row in rows:
        meta = COUNTRY_META.get(row["country_code"], {"lat": 0.0, "lon": 0.0})
        events.append(
            Event(
                id=row["event_id"],
                ts=row["updated_at"],
                title=row["representative_title"],
                summary=row["summary"],
                source=row["source"],
                url=row["top_url"],
                category=EventCategory(row["category"]),
                region=Region(row["region"]),
                country=row["country"],
                country_code=row["country_code"],
                lat=float(meta["lat"]),
                lon=float(meta["lon"]),
                severity=float(row["severity_score"]),
                factors=json.loads(row["factors_json"]),
                article_count=int(row["article_count"]),
                updated_at=row["updated_at"],
                provenance=row["provenance"],
                top_thumbnail_url=row["top_thumbnail_url"] if "top_thumbnail_url" in row.keys() else None,
            )
        )
    return events


def get_latest_ingest_stats() -> Dict[str, Any]:
    row = db_fetchone("SELECT * FROM news_ingest_stats ORDER BY id DESC LIMIT 1")
    if not row:
        return {
            "discard_reasons": {},
            "coverage_countries": 0,
            "sources_used": [],
            "coverage_country_list": [],
            "top_rejected_domains": [],
            "as_of": now_iso(),
        }
    return {
        "discard_reasons": json.loads(row["reasons_json"] or "{}"),
        "coverage_countries": int(row["coverage_countries"]),
        "sources_used": json.loads(row["sources_json"] or "[]"),
        "coverage_country_list": json.loads(row["coverage_country_list_json"] or "[]"),
        "top_rejected_domains": json.loads(row["top_rejected_domains_json"] or "[]"),
        "as_of": row["run_at"],
    }


def normalize_portfolio(portfolio: PortfolioIn) -> PortfolioStored:
    cleaned = [Holding(ticker=item.ticker.upper().strip(), weight=item.weight) for item in portfolio.holdings if item.ticker.strip()]
    if not cleaned:
        raise HTTPException(status_code=400, detail="Portfolio must include at least one valid holding")

    total = sum(item.weight for item in cleaned)
    if total <= 0:
        raise HTTPException(status_code=400, detail="Portfolio weights must sum to a positive number")

    normalized = abs(total - 1.0) > 1e-6
    if normalized:
        cleaned = [Holding(ticker=item.ticker, weight=round(item.weight / total, 6)) for item in cleaned]

    return PortfolioStored(holdings=cleaned, normalized=normalized)


def get_betas_for_ticker(ticker: str) -> Dict[str, float]:
    return ASSET_BETAS.get(ticker.upper(), {factor: 0.0 for factor in FACTOR_KEYS})


def portfolio_exposure(portfolio: PortfolioStored) -> Dict[str, float]:
    exposure = {factor: 0.0 for factor in FACTOR_KEYS}
    for holding in portfolio.holdings:
        betas = get_betas_for_ticker(holding.ticker)
        for factor in FACTOR_KEYS:
            exposure[factor] += holding.weight * betas[factor]
    return {k: round(v, 4) for k, v in exposure.items()}


def compute_impact(event: Event, portfolio: PortfolioStored, rate_shock: float, oil_shock: float, usd_shock: float) -> ImpactResponse:
    exposure = portfolio_exposure(portfolio)

    shocks = {**event.factors}
    shocks["InterestRate"] = max(-1.0, min(1.0, shocks["InterestRate"] + rate_shock))
    shocks["Oil"] = max(-1.0, min(1.0, shocks["Oil"] + oil_shock))
    shocks["USD"] = max(-1.0, min(1.0, shocks["USD"] + usd_shock))

    shock_vector = {k: round(shocks[k] * event.severity, 4) for k in FACTOR_KEYS}
    raw_total = sum(exposure[k] * shock_vector[k] for k in FACTOR_KEYS)
    impact_score = max(0.0, min(100.0, round(50 + 50 * (raw_total / (abs(raw_total) + 1.0)), 2)))

    per_asset: List[AssetImpact] = []
    for holding in portfolio.holdings:
        betas = get_betas_for_ticker(holding.ticker)
        score = sum((holding.weight * betas[f]) * shock_vector[f] for f in FACTOR_KEYS) * 100
        per_asset.append(
            AssetImpact(
                ticker=holding.ticker,
                weight=holding.weight,
                signed_impact=round(score, 3),
                abs_impact=round(abs(score), 3),
            )
        )

    ranked = sorted(per_asset, key=lambda row: row.abs_impact, reverse=True)

    return ImpactResponse(
        event_id=event.id,
        impact_score=impact_score,
        portfolio_exposure=exposure,
        shock_vector=shock_vector,
        per_asset_contributions=per_asset,
        top_impacted_holdings=ranked[:6],
    )


class WSManager:
    def __init__(self) -> None:
        self.clients: List[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        stale: List[WebSocket] = []
        for client in self.clients:
            try:
                await client.send_json(payload)
            except Exception:
                stale.append(client)
        for client in stale:
            self.disconnect(client)


ws_events_manager = WSManager()
ws_news_manager = WSManager()
LAST_NEWS_VERSION: Dict[str, str] = {}


@app.on_event("startup")
async def startup() -> None:
    if os.getenv("API_SKIP_STARTUP") == "1":
        print("API_SKIP_STARTUP=1: skipping startup tasks")
        return

    def bootstrap_sync() -> None:
        init_db()
        purge_invalid_urls()
        ensure_market_seed()
        ingest_news(force=True)
        update_market_cache(force=True)

    async def bootstrap_loop() -> None:
        try:
            await asyncio.to_thread(bootstrap_sync)
        except Exception as exc:
            print(f"bootstrap failed: {exc}")

    async def news_loop() -> None:
        global LAST_NEWS_VERSION
        while True:
            await asyncio.sleep(NEWS_SYNC_INTERVAL_SECONDS)
            await asyncio.to_thread(ingest_news, force=True)
            latest = await asyncio.to_thread(get_filtered_events, None, None, None, 0.0, 24 * 60, 40)
            current_version = {item.id: item.updated_at for item in latest}
            upserts = [item.model_dump() for item in latest if LAST_NEWS_VERSION.get(item.id) != item.updated_at]
            removes = [event_id for event_id in LAST_NEWS_VERSION.keys() if event_id not in current_version]
            if upserts or removes:
                await ws_news_manager.broadcast({"type": "diff", "upserts": upserts, "removes": removes, "as_of": now_iso()})
            LAST_NEWS_VERSION = current_version

    async def events_loop() -> None:
        while True:
            await asyncio.sleep(12)
            latest = await asyncio.to_thread(get_filtered_events, None, None, None, 0.0, 24 * 60, 30)
            if latest:
                await ws_events_manager.broadcast({"type": "event", "event": latest[0].model_dump()})

    async def markets_loop() -> None:
        while True:
            await asyncio.sleep(90)
            await asyncio.to_thread(update_market_cache, force=True)

    asyncio.create_task(news_loop())
    asyncio.create_task(events_loop())
    asyncio.create_task(markets_loop())
    asyncio.create_task(bootstrap_loop())


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "service": "worldlens-api", "version": "2.0.0", "db": DB_PATH}


@app.post("/waitlist")
def waitlist(payload: WaitlistIn) -> Dict[str, Any]:
    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    db_exec("INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)", (email, now_iso()))
    return {"status": "ok"}


@app.post("/auth/signup", response_model=AuthResponse)
def auth_signup(payload: AuthIn) -> AuthResponse:
    email = payload.email.strip().lower()
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    if db_fetchone("SELECT id FROM users WHERE email = ?", (email,)):
        raise HTTPException(status_code=409, detail="Email already exists")

    db_exec(
        "INSERT INTO users (email, password_hash, settings_json, created_at) VALUES (?, ?, ?, ?)",
        (email, hash_password(payload.password), json.dumps({"newsletter": payload.newsletter}), now_iso()),
    )
    user = db_fetchone("SELECT id, email, created_at FROM users WHERE email = ?", (email,))
    if not user:
        raise HTTPException(status_code=500, detail="Could not create user")

    token = create_token({"uid": int(user["id"]), "email": user["email"]})
    return AuthResponse(token=token, user={"id": int(user["id"]), "email": user["email"], "created_at": user["created_at"]})


@app.post("/auth/login", response_model=AuthResponse)
def auth_login(payload: AuthIn) -> AuthResponse:
    email = payload.email.strip().lower()
    user = db_fetchone("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token({"uid": int(user["id"]), "email": user["email"]})
    return AuthResponse(token=token, user={"id": int(user["id"]), "email": user["email"], "created_at": user["created_at"]})


@app.get("/auth/me")
def auth_me(user: sqlite3.Row = Depends(get_current_user)) -> Dict[str, Any]:
    return {
        "id": int(user["id"]),
        "email": user["email"],
        "created_at": user["created_at"],
        "settings": json.loads(user["settings_json"] or "{}"),
    }


@app.post("/auth/settings")
def auth_settings(payload: UserSettingsIn, user: sqlite3.Row = Depends(get_current_user)) -> Dict[str, Any]:
    settings = json.dumps({"newsletter": payload.newsletter})
    db_exec("UPDATE users SET settings_json = ? WHERE id = ?", (settings, int(user["id"])))
    return {"status": "ok", "settings": json.loads(settings)}


@app.get("/news/events", response_model=EventListResponse)
def news_events(
    limit: int = Query(default=80, ge=1, le=400),
    category: Optional[EventCategory] = None,
    region: Optional[Region] = None,
    country_code: Optional[str] = Query(default=None, min_length=2, max_length=2),
    country: Optional[str] = Query(default=None, min_length=2, max_length=2),
    q: Optional[str] = Query(default=None, min_length=1, max_length=120),
    min_severity: float = Query(default=0.0, ge=0, le=1),
    since_minutes: int = Query(default=24 * 60, ge=10, le=7 * 24 * 60),
) -> EventListResponse:
    country_filter = country_code or country
    events = get_filtered_events(category, region, country_filter, min_severity, since_minutes, limit)
    if q:
        q_low = q.lower()
        events = [event for event in events if q_low in event.title.lower() or q_low in event.country.lower() or q_low in event.summary.lower()]
    ingest_stats = get_latest_ingest_stats()
    coverage_codes = sorted(set(ingest_stats.get("coverage_country_list", []))) or sorted({event.country_code for event in events if event.country_code != "ZZ"})
    sources_used = sorted({event.source for event in events})[:20] or list(ingest_stats.get("sources_used", []))[:20]
    coverage_warning = None
    recommended_since = None
    if since_minutes <= 24 * 60 and len(coverage_codes) < 60:
        coverage_warning = f"Coverage limited: {len(coverage_codes)} countries in last 24h."
        recommended_since = 72 * 60
    elif len(coverage_codes) < 150:
        coverage_warning = f"coverage {len(coverage_codes)} countries (<150 target)"
    return EventListResponse(
        events=events,
        clusters=events,
        source="GDELT + RSS (original publisher URLs only)",
        updated_at=now_iso(),
        status="live" if events else "unavailable",
        reason=None if events else "No qualifying clusters for current filters/provider availability",
        as_of=str(ingest_stats.get("as_of") or now_iso()),
        coverage_countries=len(coverage_codes),
        coverage_warning=coverage_warning,
        recommended_since_minutes=recommended_since,
        sources_used=sources_used,
        discard_reasons=dict(ingest_stats.get("discard_reasons", {})),
        top_rejected_domains=list(ingest_stats.get("top_rejected_domains", [])),
    )


@app.get("/news/cluster/{cluster_id}", response_model=EventWithArticles)
def news_cluster_detail(cluster_id: str) -> EventWithArticles:
    row = db_fetchone("SELECT * FROM event_clusters WHERE event_id = ?", (cluster_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")

    meta = COUNTRY_META.get(row["country_code"], {"lat": 0.0, "lon": 0.0})
    article_rows = db_fetchall(
        """
        SELECT a.id, a.title, na.original_url, na.domain, na.source, na.published_at, na.thumbnail_url, na.publisher_country, na.paywall_flag
        FROM news_cluster_articles ca
        JOIN news_articles na ON na.id = ca.article_id
        JOIN articles a ON a.id = na.id
        WHERE ca.cluster_id = ?
        ORDER BY na.published_at DESC
        """,
        (cluster_id,),
    )
    articles = [
        {
            "id": str(item["id"]),
            "title": str(item["title"]),
            "url": str(item["original_url"]),
            "original_url": str(item["original_url"]),
            "domain": str(item["domain"]),
            "source": str(item["source"]),
            "published_at": str(item["published_at"]),
            "thumbnail_url": item["thumbnail_url"],
            "publisher_country": item["publisher_country"],
            "paywall_flag": bool(item["paywall_flag"]),
        }
        for item in article_rows
    ]

    return EventWithArticles(
        id=row["event_id"],
        ts=row["updated_at"],
        title=row["representative_title"],
        summary=row["summary"],
        source=row["source"],
        url=row["top_url"],
        category=EventCategory(row["category"]),
        region=Region(row["region"]),
        country=row["country"],
        country_code=row["country_code"],
        lat=float(meta["lat"]),
        lon=float(meta["lon"]),
        severity=float(row["severity_score"]),
        factors=json.loads(row["factors_json"]),
        article_count=int(row["article_count"]),
        updated_at=row["updated_at"],
        provenance=row["provenance"],
        top_thumbnail_url=row["top_thumbnail_url"] if "top_thumbnail_url" in row.keys() else None,
        articles=articles,
    )


@app.get("/news/events/{event_id}", response_model=EventWithArticles)
def news_event_detail(event_id: str) -> EventWithArticles:
    return news_cluster_detail(event_id)


@app.get("/news/cluster/{event_id}", response_model=EventWithArticles)
def news_cluster_detail_alias(event_id: str) -> EventWithArticles:
    return news_cluster_detail(event_id)


@app.get("/events", response_model=EventListResponse)
def events_compat(
    limit: int = Query(default=80, ge=1, le=400),
    category: Optional[EventCategory] = None,
    region: Optional[Region] = None,
    country_code: Optional[str] = Query(default=None, min_length=2, max_length=2),
    min_severity: float = Query(default=0.0, ge=0, le=1),
    since_minutes: int = Query(default=24 * 60, ge=10, le=7 * 24 * 60),
) -> EventListResponse:
    return news_events(limit=limit, category=category, region=region, country_code=country_code, min_severity=min_severity, since_minutes=since_minutes)


@app.get("/geo/aggregate", response_model=GeoAggregateResponse)
def geo_aggregate(
    mode: str = Query(default="country", pattern="^(country|continent)$"),
    limit: int = Query(default=350, ge=20, le=1200),
    since_minutes: int = Query(default=24 * 60, ge=10, le=7 * 24 * 60),
) -> GeoAggregateResponse:
    events = get_filtered_events(None, None, None, 0.0, since_minutes, limit)
    ingest_stats = get_latest_ingest_stats()
    if mode == "continent":
        bucket: Dict[str, List[Event]] = defaultdict(list)
        for item in events:
            if item.country_code == "ZZ":
                continue
            bucket[item.region.value].append(item)
        centers = {
            "NA": (40.0, -95.0, "North America"),
            "SA": (-15.0, -60.0, "South America"),
            "EU": (50.0, 10.0, "Europe"),
            "MEA": (15.0, 25.0, "Middle East & Africa"),
            "APAC": (20.0, 110.0, "Asia Pacific"),
        }
        items: List[GeoAggregate] = []
        for region_code, rows in bucket.items():
            lat, lon, label = centers.get(region_code, (0.0, 0.0, region_code))
            severity = sum(item.severity * max(1, item.article_count) for item in rows) / max(1, sum(max(1, item.article_count) for item in rows))
            top = sorted(rows, key=lambda event: (event.severity, event.article_count), reverse=True)[0]
            items.append(
                GeoAggregate(
                    name=label,
                    code=region_code,
                    level="continent",
                    region=Region(region_code),
                    lat=lat,
                    lon=lon,
                    article_count=sum(max(1, item.article_count) for item in rows),
                    severity_score=round(severity, 3),
                    updated_at=max(item.updated_at for item in rows),
                    top_headline=top.title,
                )
            )
    else:
        bucket = defaultdict(list)
        for item in events:
            if item.country_code == "ZZ":
                continue
            bucket[item.country_code].append(item)
        items = []
        for code, rows in bucket.items():
            meta = get_country_meta(code)
            severity = sum(item.severity * max(1, item.article_count) for item in rows) / max(1, sum(max(1, item.article_count) for item in rows))
            top = sorted(rows, key=lambda event: (event.severity, event.article_count), reverse=True)[0]
            items.append(
                GeoAggregate(
                    name=str(meta["country"]),
                    code=code,
                    level="country",
                    region=Region(str(meta["region"])),
                    lat=float(meta["lat"]),
                    lon=float(meta["lon"]),
                    article_count=sum(max(1, item.article_count) for item in rows),
                    severity_score=round(severity, 3),
                    updated_at=max(item.updated_at for item in rows),
                    top_headline=top.title,
                )
            )

    items.sort(key=lambda item: (item.severity_score, item.article_count), reverse=True)
    coverage = len(set(ingest_stats.get("coverage_country_list", []))) or len({item.country_code for item in events if item.country_code != "ZZ"})
    warning = None
    recommended_since = None
    if since_minutes <= 24 * 60 and coverage < 60:
        warning = f"Coverage limited: {coverage} countries in last 24h."
        recommended_since = 72 * 60
    elif coverage < 150:
        warning = f"coverage {coverage} countries (<150 target)"
    return GeoAggregateResponse(
        generated_at=now_iso(),
        mode=mode,
        coverage_countries=coverage,
        coverage_warning=warning,
        recommended_since_minutes=recommended_since,
        sources_used=list(ingest_stats.get("sources_used", []))[:25],
        items=items,
    )


@app.get("/geo/country/{country_code}", response_model=GeoCountryDetailResponse)
def geo_country_detail(
    country_code: str,
    since_minutes: int = Query(default=24 * 60, ge=10, le=7 * 24 * 60),
    limit: int = Query(default=40, ge=1, le=200),
) -> GeoCountryDetailResponse:
    code = country_code.upper()
    rows = get_filtered_events(None, None, code, 0.0, since_minutes, limit)
    meta = get_country_meta(code)
    return GeoCountryDetailResponse(
        country_code=code,
        country=str(meta["country"]),
        region=Region(str(meta["region"])),
        updated_at=max((row.updated_at for row in rows), default=now_iso()),
        clusters=rows,
    )


@app.get("/markets/catalog", response_model=MarketsCatalogResponse)
def markets_catalog(q: Optional[str] = Query(default=None, min_length=1, max_length=64)) -> MarketsCatalogResponse:
    items = MARKET_CATALOG
    if q:
        ql = q.lower()
        items = [item for item in items if ql in str(item.get("symbol", "")).lower() or ql in str(item.get("name", "")).lower()]
    return MarketsCatalogResponse(updated_at=now_iso(), items=[MarketCatalogItem(**item) for item in items])


@app.get("/markets/quotes", response_model=MarketQuotesResponse)
def markets_quotes(symbols: Optional[str] = None) -> MarketQuotesResponse:
    update_market_cache()
    symbol_set = None
    if symbols:
        symbol_set = {part.strip().upper() for part in symbols.split(",") if part.strip()}

    rows = db_fetchall("SELECT * FROM market_cache ORDER BY asset_class, symbol")
    items: List[MarketQuote] = []
    for row in rows:
        if symbol_set and row["symbol"] not in symbol_set:
            continue
        items.append(
            MarketQuote(
                symbol=row["symbol"],
                name=row["name"],
                asset_class=row["asset_class"],
                region=row["region"],
                price=float(row["price"]) if row["price"] is not None else None,
                change_pct=float(row["change_pct"]) if row["change_pct"] is not None else None,
                updated_at=row["updated_at"],
                source=row["source"],
                series=[float(x) for x in json.loads(row["series_json"] or "[]")],
                status=row["status"],
                latency_hint="~60s cache",
                rate_limit_hint="free-provider limits",
                reason=None if row["status"] in {"live", "stale"} else "No reliable free quote provider response",
            )
        )

    mode = "real-source-only-no-fabrication"
    return MarketQuotesResponse(asof=now_iso(), mode=mode, items=items)


@app.get("/markets", response_model=MarketQuotesResponse)
def markets_compat() -> MarketQuotesResponse:
    return markets_quotes(None)


@app.get("/markets/history", response_model=MarketHistoryResponse)
def markets_history(
    symbol: str = Query(..., min_length=1, max_length=24),
    range: str = Query(default="1M"),
    interval: str = Query(default="1d"),
) -> MarketHistoryResponse:
    normalized_symbol = symbol.strip().upper()
    in_catalog = any(item.get("symbol", "").upper() == normalized_symbol for item in MARKET_CATALOG)
    if not in_catalog:
        return MarketHistoryResponse(
            symbol=normalized_symbol,
            range=range,
            interval=interval,
            source="unavailable",
            status="unavailable",
            updated_at=now_iso(),
            latency_hint="provider dependent",
            rate_limit_hint="provider dependent",
            reason="Symbol not in catalog",
            ohlcv=[],
            data=[],
        )
    return get_market_history(normalized_symbol, range, interval)


@app.post("/intel/chat", response_model=MacroChatOut)
def intel_chat(payload: MacroChatIn) -> MacroChatOut:
    reply, context = generate_macro_chat_reply(payload.message, payload.history)
    return MacroChatOut(reply=reply, context=context, updatedAt=now_iso())


@app.post("/intel/ai")
def intel_ai(payload: AiSummaryIn) -> Dict[str, Any]:
    analysis = generate_ai_summary(payload.timeframe)
    return {"analysis": analysis.model_dump(), "updatedAt": now_iso()}


@app.post("/portfolio", response_model=PortfolioOut)
def save_portfolio(portfolio: PortfolioIn) -> PortfolioOut:
    normalized = normalize_portfolio(portfolio)
    return PortfolioOut(portfolio=normalized, exposure=portfolio_exposure(normalized))


@app.post("/portfolio/mine", response_model=PortfolioOut)
def save_my_portfolio(portfolio: PortfolioIn, user: sqlite3.Row = Depends(get_current_user)) -> PortfolioOut:
    normalized = normalize_portfolio(portfolio)
    serialized = json.dumps([item.model_dump() for item in normalized.holdings])

    existing = db_fetchone("SELECT id FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1", (int(user["id"]),))
    if existing:
        db_exec(
            "UPDATE portfolios SET holdings_json = ?, updated_at = ? WHERE id = ?",
            (serialized, now_iso(), int(existing["id"])),
        )
    else:
        db_exec(
            "INSERT INTO portfolios (user_id, holdings_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (int(user["id"]), serialized, now_iso(), now_iso()),
        )

    return PortfolioOut(portfolio=normalized, exposure=portfolio_exposure(normalized))


@app.get("/portfolio/mine", response_model=PortfolioOut)
def get_my_portfolio(user: sqlite3.Row = Depends(get_current_user)) -> PortfolioOut:
    row = db_fetchone("SELECT holdings_json FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1", (int(user["id"]),))
    if not row:
        raise HTTPException(status_code=404, detail="No saved portfolio")
    holdings = [Holding(**item) for item in json.loads(row["holdings_json"])]
    normalized = PortfolioStored(holdings=holdings, normalized=False)
    return PortfolioOut(portfolio=normalized, exposure=portfolio_exposure(normalized))


@app.post("/impact", response_model=ImpactResponse)
def impact(payload: ImpactRequest) -> ImpactResponse:
    if not payload.event and not payload.event_id:
        raise HTTPException(status_code=400, detail="event_id or event is required")
    if not payload.portfolio:
        raise HTTPException(status_code=400, detail="portfolio is required")

    normalized = normalize_portfolio(payload.portfolio)

    event = payload.event
    if event is None and payload.event_id:
        detail = news_event_detail(payload.event_id)
        event = Event(**detail.model_dump(exclude={"articles"}))

    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    return compute_impact(
        event,
        normalized,
        rate_shock=payload.scenario_rate_shock,
        oil_shock=payload.scenario_oil_shock,
        usd_shock=payload.scenario_usd_shock,
    )


@app.get("/intel/flights")
def intel_flights() -> Dict[str, Any]:
    items = fetch_opensky_states()
    if not items:
        return {
            "items": [],
            "source": "OpenSky",
            "status": "error",
            "updatedAt": now_iso(),
            "error": "OpenSky feed unavailable",
            "diagnostics": ["backend flight route failed upstream"],
        }
    return {
        "items": items,
        "source": "OpenSky",
        "status": "online",
        "updatedAt": now_iso(),
        "diagnostics": ["backend flight route online"],
    }


@app.get("/intel/satellites")
def intel_satellites() -> Dict[str, Any]:
    items = fetch_celestrak_satellites()
    if not items:
        return {
            "items": [],
            "source": "CelesTrak",
            "status": "error",
            "updatedAt": now_iso(),
            "error": "CelesTrak feed unavailable",
            "diagnostics": ["backend satellite route failed upstream"],
        }
    return {
        "items": items,
        "source": "CelesTrak",
        "status": "online",
        "updatedAt": now_iso(),
        "diagnostics": ["backend satellite route online"],
    }


@app.get("/intel/ships")
def intel_ships() -> Dict[str, Any]:
    if not os.getenv("AISSTREAM_API_KEY"):
        return {
            "items": [],
            "source": "AISStream",
            "status": "disabled",
            "updatedAt": now_iso(),
            "error": "missing AISSTREAM_API_KEY",
            "diagnostics": ["backend ship route disabled"],
        }
    return {
        "items": [],
        "source": "AISStream",
        "status": "error",
        "updatedAt": now_iso(),
        "error": "ship websocket feed is handled by the web runtime",
        "diagnostics": ["backend ship route is informational only"],
    }


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket) -> None:
    await ws_events_manager.connect(ws)
    try:
        latest = get_filtered_events(None, None, None, 0.0, 24 * 60, 60)
        await ws.send_json({"type": "snapshot", "events": [item.model_dump() for item in latest]})
        while True:
            await asyncio.sleep(30)
            await ws.send_json({"type": "heartbeat", "ts": now_iso()})
    except (WebSocketDisconnect, RuntimeError):
        ws_events_manager.disconnect(ws)


@app.websocket("/ws/news")
async def ws_news(ws: WebSocket) -> None:
    await ws_news_manager.connect(ws)
    try:
        latest = get_filtered_events(None, None, None, 0.0, 24 * 60, 60)
        await ws.send_json({"type": "snapshot", "events": [item.model_dump() for item in latest]})
        while True:
            await asyncio.sleep(60)
            await ws.send_json({"type": "heartbeat", "ts": now_iso()})
    except (WebSocketDisconnect, RuntimeError):
        ws_news_manager.disconnect(ws)
