export interface FlightState {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number;
  velocity: number;
  heading: number;
  category: string;
  isMilitary: boolean;
  source: string;
}

export type FeedResult<T> = {
  items: T[];
  source: string;
  status: "online" | "error" | "disabled";
  updatedAt: string;
  error?: string;
  diagnostics: string[];
};

type OpenSkyStatesResponse = {
  time?: number;
  states?: Array<[
    string | null,
    string | null,
    string | null,
    number | null,
    number | null,
    number | null,
    number | null,
    number | null,
    boolean | null,
    number | null,
    number | null,
    number | null,
    number | null,
    number | null,
    string | null,
    boolean | null,
    number | null,
  ]>;
};

type BackendFlightPayload = {
  items?: FlightState[];
  source?: string;
  status?: string;
  updatedAt?: string;
  error?: string;
  diagnostics?: string[];
};

const MILITARY_CALLSIGN_PATTERNS = [
  /^(RCH|FORTE|ASCOT|NATO|REACH|SHELL|DUKE|HAWK|SPAR|JEDI|LAGR|BOLT|CFC)/,
  /^(USAF|RAF|IAF|RFR|AME|MMF|CNV|GAF|QID)/,
  /\b(AIRFORCE|NAVY|ARMY|MIL)\b/,
];
const TTL_MS = 20_000;
const FALLBACK_FLIGHTS = buildFallbackFlights();

let cache: { ts: number; data: FlightState[] } | null = null;

function isMilitary(callsignRaw: string, icao24: string): boolean {
  const callsign = callsignRaw.trim().toUpperCase();
  if (!callsign) return false;
  if (MILITARY_CALLSIGN_PATTERNS.some((pattern) => pattern.test(callsign))) return true;

  const hex = icao24.toLowerCase();
  if (hex.startsWith("ae") || hex.startsWith("ad") || hex.startsWith("43c") || hex.startsWith("4b8")) return true;

  return false;
}

function normalizeState(state: NonNullable<OpenSkyStatesResponse["states"]>[number]): FlightState | null {
  const icao24 = state[0] ?? "";
  const callsign = (state[1] ?? "").trim();
  const lon = state[5];
  const lat = state[6];
  const altitude = Number(state[7] ?? 0);
  const velocity = Number(state[9] ?? 0);
  const heading = Number(state[10] ?? 0);

  if (!icao24 || lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    id: icao24,
    callsign: callsign || icao24.toUpperCase(),
    lat: clamp(lat, -90, 90),
    lon: normalizeLon(lon),
    altitude: Number.isFinite(altitude) ? altitude : 0,
    velocity: Number.isFinite(velocity) ? velocity : 0,
    heading: normalizeHeading(heading),
    category: isMilitary(callsign, icao24) ? "military" : "civilian",
    isMilitary: isMilitary(callsign, icao24),
    source: "OpenSky",
  };
}

function normalizeBackendFlights(items: FlightState[] | undefined, source: string): FlightState[] {
  return (items ?? [])
    .map((item) => {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return null;
      return {
        id: item.id,
        callsign: item.callsign || item.id,
        lat: clamp(item.lat, -90, 90),
        lon: normalizeLon(item.lon),
        altitude: Number(item.altitude ?? 0),
        velocity: Number(item.velocity ?? 0),
        heading: normalizeHeading(Number(item.heading ?? 0)),
        category: item.category || (item.isMilitary ? "military" : "civilian"),
        isMilitary: Boolean(item.isMilitary),
        source: item.source || source,
      };
    })
    .filter((item): item is FlightState => item !== null);
}

function normalizeLon(value: number) {
  if (!Number.isFinite(value)) return 0;
  let lon = value;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

function normalizeHeading(value: number) {
  if (!Number.isFinite(value)) return 0;
  const heading = value % 360;
  return heading < 0 ? heading + 360 : heading;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildFallbackFlights(): FlightState[] {
  const civilianSeeds = [
    { callsign: "DAL204", lat: 40.64, lon: -73.78, heading: 72 },
    { callsign: "BAW117", lat: 51.47, lon: -0.45, heading: 102 },
    { callsign: "DLH401", lat: 50.03, lon: 8.57, heading: 136 },
    { callsign: "UAE215", lat: 25.25, lon: 55.36, heading: 118 },
    { callsign: "JAL43", lat: 35.55, lon: 139.78, heading: 84 },
    { callsign: "SIA318", lat: 1.36, lon: 103.99, heading: 64 },
    { callsign: "QFA11", lat: -33.95, lon: 151.18, heading: 38 },
    { callsign: "TAM8084", lat: -23.43, lon: -46.47, heading: 141 },
    { callsign: "UAL933", lat: 41.97, lon: -87.9, heading: 96 },
    { callsign: "AFR22", lat: 49.01, lon: 2.55, heading: 123 },
    { callsign: "ACA41", lat: 43.68, lon: -79.63, heading: 88 },
    { callsign: "KAL82", lat: 37.46, lon: 126.44, heading: 112 },
  ];
  const militarySeeds = [
    { callsign: "RCH452", lat: 36.08, lon: -115.15, heading: 61 },
    { callsign: "FORTE12", lat: 37.94, lon: 23.95, heading: 149 },
    { callsign: "NATO41", lat: 50.11, lon: 14.26, heading: 201 },
    { callsign: "DUKE73", lat: 25.2, lon: 51.56, heading: 98 },
    { callsign: "ASCOT91", lat: 52.31, lon: 4.76, heading: 173 },
    { callsign: "SHELL22", lat: 21.32, lon: -157.92, heading: 45 },
  ];

  const items: FlightState[] = [];

  civilianSeeds.forEach((seed, seedIndex) => {
    for (let index = 0; index < 10; index += 1) {
      items.push({
        id: `demo-civ-${seedIndex}-${index}`,
        callsign: `${seed.callsign}${index}`,
        lat: clamp(seed.lat + ((index % 5) - 2) * 1.4, -85, 85),
        lon: normalizeLon(seed.lon + (Math.floor(index / 2) - 2) * 2.1),
        altitude: 9400 + ((seedIndex + index) % 6) * 520,
        velocity: 218 + ((seedIndex * 7 + index * 5) % 38),
        heading: normalizeHeading(seed.heading + index * 11),
        category: "civilian",
        isMilitary: false,
        source: "WorldLens fallback",
      });
    }
  });

  militarySeeds.forEach((seed, seedIndex) => {
    for (let index = 0; index < 6; index += 1) {
      items.push({
        id: `demo-mil-${seedIndex}-${index}`,
        callsign: `${seed.callsign}${index}`,
        lat: clamp(seed.lat + ((index % 3) - 1) * 1.8, -85, 85),
        lon: normalizeLon(seed.lon + (index - 2) * 2.4),
        altitude: 9800 + ((seedIndex + index) % 5) * 700,
        velocity: 205 + ((seedIndex * 9 + index * 4) % 34),
        heading: normalizeHeading(seed.heading + index * 17),
        category: "military",
        isMilitary: true,
        source: "WorldLens fallback",
      });
    }
  });

  return items;
}

function getApiBaseUrl() {
  return (process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
}

async function fetchFlightsFromBackend(baseUrl: string): Promise<FeedResult<FlightState> | null> {
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}/intel/flights`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      throw new Error(`backend responded ${response.status}`);
    }

    const payload = (await response.json()) as BackendFlightPayload;
    const items = normalizeBackendFlights(payload.items, payload.source ?? "backend");

    if (!items.length && payload.status === "error") {
      throw new Error(payload.error ?? "backend returned no flight data");
    }

    return {
      items,
      source: payload.source ?? "backend",
      status: items.length ? "online" : "error",
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
      error: items.length ? undefined : payload.error ?? "backend returned no flight data",
      diagnostics: payload.diagnostics ?? [`backend ${baseUrl}`],
    };
  } catch (error) {
    return {
      items: [],
      source: "backend",
      status: "error",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "backend flight fetch failed",
      diagnostics: [`backend ${baseUrl}`],
    };
  }
}

async function fetchFlightsFromOpenSky(): Promise<FeedResult<FlightState>> {
  const username = process.env.OPENSKY_USERNAME;
  const password = process.env.OPENSKY_PASSWORD;

  const headers: HeadersInit = {};
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  const response = await fetch("https://opensky-network.org/api/states/all", {
    headers,
    cache: "no-store",
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`OpenSky request failed (${response.status})`);
  }

  const payload = (await response.json()) as OpenSkyStatesResponse;
  const items = (payload.states ?? []).map(normalizeState).filter((row): row is FlightState => row !== null);

  return {
    items,
    source: "OpenSky",
    status: "online",
    updatedAt: new Date().toISOString(),
    diagnostics: [username && password ? "authenticated OpenSky" : "anonymous OpenSky"],
  };
}

export async function fetchFlights(): Promise<FeedResult<FlightState>> {
  const now = Date.now();
  if (cache && now - cache.ts < TTL_MS) {
    return {
      items: cache.data,
      source: "cache",
      status: "online",
      updatedAt: new Date(cache.ts).toISOString(),
      diagnostics: ["server cache hit"],
    };
  }

  const diagnostics: string[] = [];
  const backend = await fetchFlightsFromBackend(getApiBaseUrl());
  if (backend) {
    diagnostics.push(...backend.diagnostics);
    if (backend.status === "online" && backend.items.length) {
      cache = { ts: now, data: backend.items };
      return { ...backend, diagnostics };
    }
  }

  try {
    const direct = await fetchFlightsFromOpenSky();
    cache = { ts: now, data: direct.items };
    return {
      ...direct,
      diagnostics: [...diagnostics, ...direct.diagnostics],
    };
  } catch (error) {
    if (cache?.data.length) {
      return {
        items: cache.data,
        source: "cache",
        status: "online",
        updatedAt: new Date(cache.ts).toISOString(),
        diagnostics: [...diagnostics, "using stale cached flights"],
        error: error instanceof Error ? error.message : "flight refresh failed",
      };
    }

    return {
      items: FALLBACK_FLIGHTS,
      source: "WorldLens fallback",
      status: "online",
      updatedAt: new Date().toISOString(),
      diagnostics: [...diagnostics, "seeded fallback flights"],
      error: error instanceof Error ? error.message : "flight refresh failed",
    };
  }
}
