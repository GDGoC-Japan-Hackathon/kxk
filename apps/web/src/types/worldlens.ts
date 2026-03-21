export type EventCategory = "geopolitics" | "macro" | "commodities" | "tech" | "crypto" | "earnings";

export type Region = "NA" | "SA" | "EU" | "MEA" | "APAC";

export type FactorKey = "Market" | "InterestRate" | "USD" | "Oil" | "Volatility" | "Liquidity";

export type FactorVector = Record<FactorKey, number>;

export interface EventItem {
  id: string;
  ts: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  category: EventCategory;
  region: Region;
  country: string;
  country_code: string;
  lat: number;
  lon: number;
  severity: number;
  factors: FactorVector;
  article_count: number;
  updated_at: string;
  provenance: string;
  top_thumbnail_url?: string | null;
}

export interface EventDetail extends EventItem {
  articles: Array<{
    id: string;
    title: string;
    url: string;
    original_url?: string;
    source: string;
    domain?: string;
    thumbnail_url?: string | null;
    publisher_country?: string | null;
    paywall_flag?: boolean;
    published_at: string;
  }>;
}

export interface NewsEventsResponse {
  events: EventItem[];
  clusters?: EventItem[];
  source: string;
  updated_at: string;
  as_of?: string;
  coverage_countries?: number;
  coverage_warning?: string;
  recommended_since_minutes?: number;
  sources_used?: string[];
  discard_reasons?: Record<string, number>;
  top_rejected_domains?: Array<[string, number]>;
}

export interface Holding {
  ticker: string;
  weight: number;
}

export interface PortfolioInput {
  holdings: Holding[];
}

export interface AssetImpact {
  ticker: string;
  weight: number;
  signed_impact: number;
  abs_impact: number;
}

export interface ImpactResponse {
  event_id: string;
  impact_score: number;
  portfolio_exposure: FactorVector;
  shock_vector: FactorVector;
  per_asset_contributions: AssetImpact[];
  top_impacted_holdings: AssetImpact[];
}

export interface EventFilter {
  category: "all" | EventCategory;
  region: "all" | Region;
  countryCode: "all" | string;
  minSeverity: number;
  sinceMinutes: number;
}

export interface MarketItem {
  symbol: string;
  name: string;
  asset_class: string;
  region: string;
  price: number | null;
  change_pct: number | null;
  updated_at: string;
  source: string;
  series: number[];
  status: "live" | "delayed" | "stale" | "unavailable";
  latency_hint?: string;
  rate_limit_hint?: string;
  reason?: string | null;
}

export interface MarketsResponse {
  asof: string;
  mode: string;
  items: MarketItem[];
}

export interface MarketCatalogItem {
  symbol: string;
  name: string;
  asset_class: string;
  region: string;
  type?: string;
  currency?: string;
  exchange?: string;
  provider_priority?: string[];
}

export interface MarketsCatalogResponse {
  updated_at: string;
  items: MarketCatalogItem[];
}

export interface CountryAggregate {
  name: string;
  code: string;
  level: "country" | "continent";
  region: Region;
  lat: number;
  lon: number;
  article_count: number;
  severity_score: number;
  updated_at: string;
  top_headline?: string;
}

export interface GeoAggregateResponse {
  generated_at: string;
  mode: "country" | "continent";
  coverage_countries: number;
  coverage_warning?: string;
  recommended_since_minutes?: number;
  sources_used?: string[];
  items: CountryAggregate[];
}

export interface GeoCountryDetailResponse {
  country_code: string;
  country: string;
  region: Region;
  updated_at: string;
  clusters: EventItem[];
}

export interface AuthResponse {
  token: string;
  user: {
    id: number;
    email: string;
    created_at: string;
  };
}

export interface MarketHistoryPoint {
  t: string;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c: number;
  v?: number | null;
}

export interface MarketHistoryResponse {
  symbol: string;
  range: string;
  interval: string;
  source: string;
  status: "live" | "delayed" | "stale" | "unavailable";
  updated_at: string;
  latency_hint: string;
  rate_limit_hint: string;
  reason?: string | null;
  series_type?: "ohlcv" | "line";
  timezone?: string;
  ohlcv: MarketHistoryPoint[];
  data?: Array<[number, number | null, number | null, number | null, number | null, number | null]>;
}

export interface UserProfile {
  id: number;
  email: string;
  created_at: string;
  settings: {
    newsletter?: boolean;
  };
}
