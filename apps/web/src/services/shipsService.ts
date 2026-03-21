import WebSocket from "ws";

export interface ShipState {
  id: string;
  name: string;
  mmsi: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  vesselType: string;
  source: string;
}

export type ShipFeedResult = {
  items: ShipState[];
  source: string;
  status: "online" | "error" | "disabled";
  updatedAt: string;
  error?: string;
  diagnostics: string[];
};

type AisMessage = {
  MessageType?: string;
  Message?: {
    PositionReport?: {
      UserID?: string | number;
      Latitude?: number;
      Longitude?: number;
      Sog?: number;
      Cog?: number;
    };
    ShipStaticData?: {
      UserID?: string | number;
      Name?: string;
      Destination?: string;
      Type?: number | string;
    };
  };
};

const cache: { ts: number; data: ShipState[] } = { ts: 0, data: [] };
const TTL_MS = 30_000;
const MAX_SHIPS = 450;
const FALLBACK_SHIPS = buildFallbackShips();

export async function fetchShips(): Promise<ShipFeedResult> {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    return {
      items: FALLBACK_SHIPS,
      source: "WorldLens fallback",
      status: "online",
      updatedAt: new Date().toISOString(),
      error: "missing AISSTREAM_API_KEY",
      diagnostics: ["seeded fallback ships"],
    };
  }

  const now = Date.now();
  if (now - cache.ts < TTL_MS && cache.data.length > 0) {
    return {
      items: cache.data,
      source: "AISStream",
      status: "online",
      updatedAt: new Date(cache.ts).toISOString(),
      diagnostics: ["server cache hit"],
    };
  }

  try {
    const ships = await fetchFromAisStream(apiKey);
    cache.ts = now;
    cache.data = ships;
    return {
      items: ships,
      source: "AISStream",
      status: "online",
      updatedAt: new Date().toISOString(),
      diagnostics: ["live AISStream websocket"],
    };
  } catch (error) {
    if (cache.data.length > 0) {
      return {
        items: cache.data,
        source: "AISStream",
        status: "online",
        updatedAt: new Date(cache.ts).toISOString(),
        error: error instanceof Error ? error.message : "ship refresh failed",
        diagnostics: ["using stale cached ships"],
      };
    }

    return {
      items: FALLBACK_SHIPS,
      source: "WorldLens fallback",
      status: "online",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "ship refresh failed",
      diagnostics: ["AISStream websocket failed", "seeded fallback ships"],
    };
  }
}

function fetchFromAisStream(apiKey: string): Promise<ShipState[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const staticMeta = new Map<string, { name: string; vesselType: string }>();
    const states = new Map<string, ShipState>();

    const finish = () => {
      const items = [...states.values()]
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
        .slice(0, MAX_SHIPS);
      resolve(items);
    };

    const timeout = setTimeout(() => {
      socket.close();
    }, 4_500);

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        }),
      );
    });

    socket.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as AisMessage;

        if (payload.MessageType === "ShipStaticData") {
          const msg = payload.Message?.ShipStaticData;
          const mmsi = String(msg?.UserID ?? "");
          if (!mmsi) return;

          staticMeta.set(mmsi, {
            name: msg?.Name?.trim() || `MMSI ${mmsi}`,
            vesselType: mapVesselType(msg?.Type),
          });
          return;
        }

        if (payload.MessageType === "PositionReport") {
          const msg = payload.Message?.PositionReport;
          const mmsi = String(msg?.UserID ?? "");
          const lat = Number(msg?.Latitude);
          const lon = Number(msg?.Longitude);
          if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

          const meta = staticMeta.get(mmsi);
          states.set(mmsi, {
            id: mmsi,
            name: meta?.name ?? `MMSI ${mmsi}`,
            mmsi,
            lat: clamp(lat, -90, 90),
            lon: normalizeLon(lon),
            speed: Number(msg?.Sog ?? 0),
            heading: normalizeHeading(Number(msg?.Cog ?? 0)),
            vesselType: meta?.vesselType ?? "Unknown",
            source: "AISStream",
          });

          if (states.size >= MAX_SHIPS) {
            socket.close();
          }
        }
      } catch {
        // ignore malformed message
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      finish();
    });
  });
}

function mapVesselType(value: number | string | undefined) {
  const code = Number(value);
  if (!Number.isFinite(code)) return "Unknown";
  if (code >= 70 && code < 80) return "Cargo";
  if (code >= 80 && code < 90) return "Tanker";
  if (code >= 60 && code < 70) return "Passenger";
  if (code >= 30 && code < 40) return "Fishing";
  return "Vessel";
}

function normalizeLon(value: number) {
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

function buildFallbackShips(): ShipState[] {
  const seeds = [
    { name: "Pacific Meridian", lat: 1.18, lon: 103.74, heading: 92, vesselType: "Cargo" },
    { name: "Hormuz Star", lat: 26.62, lon: 56.28, heading: 134, vesselType: "Tanker" },
    { name: "Aegean Vector", lat: 36.92, lon: 24.58, heading: 287, vesselType: "Cargo" },
    { name: "North Sea Relay", lat: 50.95, lon: 1.14, heading: 61, vesselType: "Passenger" },
    { name: "Yokohama Wind", lat: 34.78, lon: 139.92, heading: 118, vesselType: "Cargo" },
    { name: "Atlantic Span", lat: 40.12, lon: -70.44, heading: 244, vesselType: "Tanker" },
    { name: "Santos Horizon", lat: -23.98, lon: -45.22, heading: 36, vesselType: "Cargo" },
    { name: "Cape Route", lat: -33.72, lon: 18.42, heading: 79, vesselType: "Tanker" },
    { name: "Malacca Bridge", lat: 3.02, lon: 100.98, heading: 84, vesselType: "Cargo" },
    { name: "Busan Current", lat: 35.01, lon: 129.44, heading: 121, vesselType: "Cargo" },
  ];

  const items: ShipState[] = [];

  seeds.forEach((seed, seedIndex) => {
    for (let index = 0; index < 8; index += 1) {
      items.push({
        id: `fallback-ship-${seedIndex}-${index}`,
        name: `${seed.name} ${index + 1}`,
        mmsi: `900${seedIndex.toString().padStart(2, "0")}${index.toString().padStart(4, "0")}`,
        lat: clamp(seed.lat + ((index % 4) - 1.5) * 1.2, -85, 85),
        lon: normalizeLon(seed.lon + (Math.floor(index / 2) - 1.5) * 2.4),
        speed: 10 + ((seedIndex * 3 + index) % 9) + 0.4,
        heading: normalizeHeading(seed.heading + index * 13),
        vesselType: seed.vesselType,
        source: "WorldLens fallback",
      });
    }
  });

  return items;
}
