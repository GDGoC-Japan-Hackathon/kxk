import * as satellite from "satellite.js";

export interface SatelliteState {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  type: string;
  source: string;
}

export type SatelliteFeedResult = {
  items: SatelliteState[];
  source: string;
  status: "online" | "error";
  updatedAt: string;
  error?: string;
  diagnostics: string[];
};

type TleGroup = {
  name: string;
  type: string;
  limit: number;
  url: string;
};

const GROUPS: TleGroup[] = [
  {
    name: "stations",
    type: "station",
    limit: 8,
    url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
  },
  {
    name: "active",
    type: "active",
    limit: 18,
    url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
  },
];
const TTL_MS = 120_000;

let cache: { ts: number; data: SatelliteState[] } | null = null;

export async function fetchSatellites(): Promise<SatelliteFeedResult> {
  const now = Date.now();
  if (cache && now - cache.ts < TTL_MS) {
    return {
      items: cache.data,
      source: "CelesTrak",
      status: "online",
      updatedAt: new Date(cache.ts).toISOString(),
      diagnostics: ["server cache hit"],
    };
  }

  try {
    const items = (await Promise.all(GROUPS.map(fetchGroup)))
      .flat()
      .sort((a, b) => {
        if (a.type === "station" && b.type !== "station") return -1;
        if (a.type !== "station" && b.type === "station") return 1;
        return a.name.localeCompare(b.name);
      });

    cache = { ts: now, data: items };
    return {
      items,
      source: "CelesTrak",
      status: "online",
      updatedAt: new Date().toISOString(),
      diagnostics: GROUPS.map((group) => `${group.name} group loaded`),
    };
  } catch (error) {
    if (cache?.data.length) {
      return {
        items: cache.data,
        source: "CelesTrak",
        status: "online",
        updatedAt: new Date(cache.ts).toISOString(),
        diagnostics: ["using stale cached satellites"],
        error: error instanceof Error ? error.message : "satellite refresh failed",
      };
    }

    return {
      items: [],
      source: "CelesTrak",
      status: "error",
      updatedAt: new Date().toISOString(),
      diagnostics: ["CelesTrak upstream failed"],
      error: error instanceof Error ? error.message : "satellite refresh failed",
    };
  }
}

async function fetchGroup(group: TleGroup): Promise<SatelliteState[]> {
  const response = await fetch(group.url, {
    cache: "no-store",
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`${group.name} request failed (${response.status})`);
  }

  const text = await response.text();
  return parseAndCompute(text, group);
}

function parseAndCompute(raw: string, group: TleGroup): SatelliteState[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const now = new Date();
  const items: SatelliteState[] = [];

  for (let index = 0; index + 2 < lines.length && items.length < group.limit; index += 3) {
    const [name, line1, line2] = lines.slice(index, index + 3);
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;

    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      const positionAndVelocity = satellite.propagate(satrec, now);
      if (!positionAndVelocity) continue;
      const position = positionAndVelocity.position;
      if (!position) continue;

      const gmst = satellite.gstime(now);
      const geodetic = satellite.eciToGeodetic(position, gmst);
      const lon = satellite.degreesLong(geodetic.longitude);
      const lat = satellite.degreesLat(geodetic.latitude);
      const altitude = geodetic.height * 1000;

      if (![lat, lon, altitude].every(Number.isFinite)) continue;

      items.push({
        id: `${group.name}-${name}-${items.length}`,
        name,
        lat,
        lon,
        altitude,
        type: group.type,
        source: "CelesTrak",
      });
    } catch {
      // ignore malformed TLEs
    }
  }

  return items;
}
