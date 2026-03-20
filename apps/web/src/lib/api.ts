import {
  AuthResponse,
  EventDetail,
  EventFilter,
  EventItem,
  GeoAggregateResponse,
  GeoCountryDetailResponse,
  ImpactResponse,
  MarketHistoryResponse,
  MarketsCatalogResponse,
  MarketsResponse,
  NewsEventsResponse,
  PortfolioInput,
  UserProfile,
} from "@/types/worldlens";
import type { AiAnalysis, ChatRequestPayload, ChatResponsePayload } from "@/types/chat";

type RuntimeConfig = {
  apiBaseUrl?: string;
  cesiumIonToken?: string;
};

function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") return {};
  return ((window as Window & { __WORLDLENS_RUNTIME_CONFIG__?: RuntimeConfig }).__WORLDLENS_RUNTIME_CONFIG__ ?? {});
}

export function getApiUrl() {
  if (typeof window !== "undefined") {
    return "/api";
  }

  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
}

const API_URL = getApiUrl();

function getWsBaseUrl() {
  if (typeof window !== "undefined") {
    const runtimeBaseUrl = getRuntimeConfig().apiBaseUrl;
    if (runtimeBaseUrl) {
      return runtimeBaseUrl.replace(/^http/, "ws");
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  return API_URL.replace(/^http/, "ws");
}

export const WS_EVENTS_URL = `${getWsBaseUrl()}/ws/events`;
export const WS_NEWS_URL = `${getWsBaseUrl()}/ws/news`;

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("worldlens_token");
}

export function setStoredToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("worldlens_token", token);
}

export function clearStoredToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("worldlens_token");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchNewsEvents(filter: EventFilter, limit = 120): Promise<NewsEventsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    min_severity: String(filter.minSeverity),
    since_minutes: String(filter.sinceMinutes),
  });
  if (filter.category !== "all") params.set("category", filter.category);
  if (filter.region !== "all") params.set("region", filter.region);
  if (filter.countryCode !== "all") params.set("country_code", filter.countryCode);

  return request<NewsEventsResponse>(`/news/events?${params.toString()}`);
}

export async function fetchNewsEventDetail(eventId: string): Promise<EventDetail> {
  return request<EventDetail>(`/news/events/${eventId}`);
}

export async function fetchGeoAggregate(sinceMinutes = 24 * 60, limit = 350, mode: "country" | "continent" = "country"): Promise<GeoAggregateResponse> {
  return request<GeoAggregateResponse>(`/geo/aggregate?mode=${mode}&limit=${limit}&since_minutes=${sinceMinutes}`);
}

export async function fetchGeoCountryDetail(countryCode: string, sinceMinutes = 24 * 60, limit = 40): Promise<GeoCountryDetailResponse> {
  return request<GeoCountryDetailResponse>(`/geo/country/${encodeURIComponent(countryCode)}?since_minutes=${sinceMinutes}&limit=${limit}`);
}

export async function fetchMarkets(symbols?: string[]): Promise<MarketsResponse> {
  const params = new URLSearchParams();
  if (symbols?.length) params.set("symbols", symbols.join(","));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<MarketsResponse>(`/markets/quotes${suffix}`);
}

export async function fetchMarketsCatalog(): Promise<MarketsCatalogResponse> {
  return request<MarketsCatalogResponse>("/markets/catalog");
}

export async function fetchMarketHistory(symbol: string, range = "1M", interval = "1d"): Promise<MarketHistoryResponse> {
  const params = new URLSearchParams({ symbol, range, interval });
  return request<MarketHistoryResponse>(`/markets/history?${params.toString()}`);
}

export async function savePortfolio(portfolio: PortfolioInput): Promise<void> {
  await request("/portfolio", {
    method: "POST",
    body: JSON.stringify(portfolio),
  });
}

export async function saveMyPortfolio(portfolio: PortfolioInput): Promise<void> {
  await request("/portfolio/mine", {
    method: "POST",
    body: JSON.stringify(portfolio),
  });
}

export async function fetchMyPortfolio(): Promise<PortfolioInput> {
  const data = await request<{ portfolio: { holdings: PortfolioInput["holdings"] } }>("/portfolio/mine");
  return { holdings: data.portfolio.holdings };
}

export async function computeImpact(args: {
  eventId?: string;
  event?: EventItem;
  portfolio: PortfolioInput;
  scenarioRateShock?: number;
  scenarioOilShock?: number;
  scenarioUsdShock?: number;
}): Promise<ImpactResponse> {
  return request<ImpactResponse>("/impact", {
    method: "POST",
    body: JSON.stringify({
      event_id: args.eventId,
      event: args.event,
      portfolio: args.portfolio,
      scenario_rate_shock: args.scenarioRateShock ?? 0,
      scenario_oil_shock: args.scenarioOilShock ?? 0,
      scenario_usd_shock: args.scenarioUsdShock ?? 0,
    }),
  });
}

export async function signup(email: string, password: string, newsletter = true): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, newsletter }),
  });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchMe(): Promise<UserProfile> {
  return request<UserProfile>("/auth/me");
}

export async function updateSettings(newsletter: boolean): Promise<{ status: string }> {
  return request<{ status: string }>("/auth/settings", {
    method: "POST",
    body: JSON.stringify({ newsletter }),
  });
}

export async function joinWaitlist(email: string): Promise<{ status: string }> {
  return request<{ status: string }>("/waitlist", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function sendMacroChatMessage(payload: ChatRequestPayload): Promise<ChatResponsePayload> {
  const response = await fetch("/api/intel/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = (await response.json()) as ChatResponsePayload & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Chat request failed: ${response.status}`);
  }
  return data;
}

export async function fetchAiAnalysis(timeframe: string): Promise<AiAnalysis> {
  const response = await fetch("/api/intel/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeframe }),
    cache: "no-store",
  });

  const data = (await response.json()) as { analysis?: AiAnalysis; error?: string };
  if (!response.ok || !data.analysis) {
    throw new Error(data.error || `AI analysis request failed: ${response.status}`);
  }
  return data.analysis;
}
