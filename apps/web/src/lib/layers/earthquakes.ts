export type EarthquakePoint = {
  id: string;
  title: string;
  magnitude: number;
  latitude: number;
  longitude: number;
  depthKm: number;
  place: string;
  time: string;
  url: string;
  color: string;
  pixelSize: number;
};

type UsgsFeatureCollection = {
  features?: Array<{
    id?: string;
    geometry?: {
      coordinates?: [number, number, number?];
    };
    properties?: {
      mag?: number | null;
      place?: string | null;
      time?: number | null;
      title?: string | null;
      url?: string | null;
    };
  }>;
};

const USGS_ALL_DAY_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

function quakeStyle(magnitude: number) {
  if (magnitude >= 5) {
    return { color: "#ff4d4f", pixelSize: 14 };
  }

  if (magnitude >= 3) {
    return { color: "#ff8f3f", pixelSize: 10 };
  }

  return { color: "#f7b955", pixelSize: 7 };
}

export async function fetchEarthquakes(signal?: AbortSignal): Promise<EarthquakePoint[]> {
  const response = await fetch(USGS_ALL_DAY_URL, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`USGS request failed: ${response.status}`);
  }

  const payload = (await response.json()) as UsgsFeatureCollection;

  return (payload.features ?? [])
    .map((feature): EarthquakePoint | null => {
      const [longitude, latitude, depthKm = 0] = feature.geometry?.coordinates ?? [];
      const magnitude = feature.properties?.mag ?? 0;

      if (typeof longitude !== "number" || typeof latitude !== "number") {
        return null;
      }

      const style = quakeStyle(magnitude);

      return {
        id: feature.id ?? `${longitude}:${latitude}:${feature.properties?.time ?? Date.now()}`,
        title: feature.properties?.title ?? "Earthquake",
        magnitude,
        latitude,
        longitude,
        depthKm,
        place: feature.properties?.place ?? "Unknown location",
        time: new Date(feature.properties?.time ?? Date.now()).toISOString(),
        url: feature.properties?.url ?? "https://earthquake.usgs.gov/",
        color: style.color,
        pixelSize: style.pixelSize,
      };
    })
    .filter((item): item is EarthquakePoint => item !== null);
}
