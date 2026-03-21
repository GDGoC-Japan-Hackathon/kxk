import * as satellite from "satellite.js";

export type SatelliteTle = {
  id: string;
  name: string;
  line1: string;
  line2: string;
};

export type SatellitePoint = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeKm: number;
};

const DEFAULT_LIMIT = 10;

function parseTleBundle(raw: string, limit = DEFAULT_LIMIT): SatelliteTle[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const satellites: SatelliteTle[] = [];

  for (let index = 0; index + 2 < lines.length && satellites.length < limit; index += 3) {
    const [name, line1, line2] = lines.slice(index, index + 3);

    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) {
      continue;
    }

    satellites.push({
      id: `${name}-${satellites.length}`,
      name,
      line1,
      line2,
    });
  }

  return satellites;
}

export async function fetchSatelliteTles(signal?: AbortSignal, limit = DEFAULT_LIMIT): Promise<SatelliteTle[]> {
  const response = await fetch(`/api/celestrak?limit=${limit}`, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`CelesTrak request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { tle?: string; error?: string };

  if (!payload.tle || payload.error) {
    throw new Error(payload.error ?? "No TLE payload returned");
  }

  return parseTleBundle(payload.tle, limit);
}

export function computeSatellitePositions(tles: SatelliteTle[], now = new Date()): SatellitePoint[] {
  return tles
    .map((item): SatellitePoint | null => {
      const satrec = satellite.twoline2satrec(item.line1, item.line2);
      const positionAndVelocity = satellite.propagate(satrec, now);
      if (!positionAndVelocity) {
        return null;
      }

      const eci = positionAndVelocity.position;

      if (!eci) {
        return null;
      }

      const gmst = satellite.gstime(now);
      const geodetic = satellite.eciToGeodetic(eci, gmst);
      const longitude = satellite.degreesLong(geodetic.longitude);
      const latitude = satellite.degreesLat(geodetic.latitude);
      const altitudeKm = geodetic.height;

      if (![longitude, latitude, altitudeKm].every(Number.isFinite)) {
        return null;
      }

      return {
        id: item.id,
        name: item.name,
        latitude,
        longitude,
        altitudeKm,
      };
    })
    .filter((item): item is SatellitePoint => item !== null);
}
