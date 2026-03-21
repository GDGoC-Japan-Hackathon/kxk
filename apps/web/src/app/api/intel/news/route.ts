import { NextRequest, NextResponse } from "next/server";
import { fetchGlobalNews } from "@/services/newsService";

type BackendEventCategory = "geopolitics" | "macro" | "commodities" | "tech" | "crypto" | "earnings";
type NewsCategory = "politics" | "economy" | "technology" | "energy" | "security" | "crypto";

type BackendEventItem = {
  title: string;
  summary: string;
  url: string;
  source: string;
  ts: string;
  updated_at: string;
  country: string;
  country_code: string;
  region?: string;
  category: BackendEventCategory;
  top_thumbnail_url?: string | null;
};

type BackendNewsResponse = {
  events?: BackendEventItem[];
  clusters?: BackendEventItem[];
};

const REGION_TO_CONTINENT: Record<string, string> = {
  NA: "North America",
  SA: "South America",
  EU: "Europe",
  MEA: "Africa",
  APAC: "Asia",
};

function toNewsCategory(value: BackendEventCategory): NewsCategory {
  if (value === "geopolitics") return "politics";
  if (value === "macro") return "economy";
  if (value === "commodities") return "energy";
  if (value === "tech") return "technology";
  if (value === "crypto") return "crypto";
  return "security";
}

function inferContinent(event: BackendEventItem): string {
  const code = event.country_code.toUpperCase();
  if (code === "GL" || code === "ZZ") return "Global";
  return REGION_TO_CONTINENT[event.region ?? ""] ?? "Global";
}

type IntelNewsItem = {
  title: string;
  description: string;
  url: string;
  image: string | null;
  source: string;
  publishedAt: string;
  country: string;
  countryCode: string;
  continent: string;
  category: NewsCategory;
};

const CATEGORY_THEME: Record<NewsCategory, { start: string; end: string; accent: string }> = {
  politics: { start: "#10233f", end: "#224f86", accent: "#dbeafe" },
  economy: { start: "#1d2a3b", end: "#0f766e", accent: "#ccfbf1" },
  technology: { start: "#1b1f3b", end: "#4338ca", accent: "#e0e7ff" },
  energy: { start: "#3b1d14", end: "#b45309", accent: "#ffedd5" },
  security: { start: "#2b1220", end: "#9f1239", accent: "#ffe4e6" },
  crypto: { start: "#2f1f4a", end: "#7c3aed", accent: "#f3e8ff" },
};

const BACKEND_NEWS_TIMEOUT_MS = 6000;

function sanitizeJsonText(raw: string) {
  return raw.replace(/[\u0000-\u001f]/g, "");
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  return JSON.parse(sanitizeJsonText(raw)) as T;
}

async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = BACKEND_NEWS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function applyFilters(items: IntelNewsItem[], continent?: string | null, country?: string | null): IntelNewsItem[] {
  return items.filter((item) => {
    if (continent && continent !== "all" && item.continent.toLowerCase() !== continent) return false;
    if (country && country !== "ALL" && item.countryCode.toUpperCase() !== country) return false;
    return true;
  });
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourceBadge(source: string) {
  return source
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase() || "WL";
}

function clampText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value;
}

function buildFallbackThumbnailUrl(item: IntelNewsItem) {
  const params = new URLSearchParams({
    title: clampText(item.title, 90),
    source: item.source,
    country: item.country,
    category: item.category,
  });
  return `/api/intel/news/thumb?${params.toString()}`;
}

function withUsableImage(item: IntelNewsItem): IntelNewsItem {
  if (item.image && item.image.trim()) return item;
  return {
    ...item,
    image: buildFallbackThumbnailUrl(item),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const continent = searchParams.get("continent")?.toLowerCase();
  const country = searchParams.get("country")?.toUpperCase();
  const limit = Number(searchParams.get("limit") ?? "300");

  try {
    const baseUrl = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const backendUrl = new URL("/news/events", baseUrl);
    backendUrl.searchParams.set("limit", String(Math.max(limit * 2, 300)));
    backendUrl.searchParams.set("min_severity", "0");
    backendUrl.searchParams.set("since_minutes", String(7 * 24 * 60));

    const response = await fetchWithTimeout(backendUrl.toString(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Upstream /news/events failed (${response.status})`);
    }

    const payload = await parseJsonResponse<BackendNewsResponse>(response);
    const rawItems = payload.events ?? payload.clusters ?? [];
    const backendItems = rawItems.map((item) => ({
      title: item.title,
      description: item.summary ?? "",
      url: item.url,
      image: item.top_thumbnail_url ?? null,
      source: item.source,
      publishedAt: item.updated_at ?? item.ts,
      country: item.country,
      countryCode: item.country_code,
      continent: inferContinent(item),
      category: toNewsCategory(item.category),
    }));

    let fallbackItems: IntelNewsItem[] = [];
    try {
      fallbackItems = await fetchGlobalNews();
    } catch {
      fallbackItems = [];
    }
    const merged = new Map<string, IntelNewsItem>();

    for (const item of [...backendItems, ...fallbackItems]) {
      const current = merged.get(item.url);
      if (!current) {
        merged.set(item.url, item);
        continue;
      }

      merged.set(item.url, {
        ...current,
        ...item,
        image: current.image ?? item.image ?? null,
        description: current.description || item.description,
        source: current.source || item.source,
        country: current.country || item.country,
        countryCode: current.countryCode || item.countryCode,
        continent: current.continent || item.continent,
      });
    }

    const filtered = applyFilters([...merged.values()], continent, country).map(withUsableImage);

    return NextResponse.json({ items: filtered.slice(0, limit), updatedAt: new Date().toISOString() });
  } catch (error) {
    try {
      const fallback = await fetchGlobalNews();
      const filtered = applyFilters(fallback, continent, country).map(withUsableImage);
      return NextResponse.json({
        items: filtered.slice(0, limit),
        updatedAt: new Date().toISOString(),
        source: "newsapi-fallback",
        reason: error instanceof Error ? error.message : "backend unavailable",
      });
    } catch (fallbackError) {
      return NextResponse.json(
        {
          items: [],
          error: fallbackError instanceof Error ? fallbackError.message : "Failed to fetch news",
          reason: error instanceof Error ? error.message : "backend unavailable",
        },
        { status: 500 },
      );
    }
  }
}
