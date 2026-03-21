import { NextRequest, NextResponse } from "next/server";
import { fetchGlobalNews } from "@/services/newsService";

interface PoiItem {
  name: string;
  lat: number;
  lon: number;
}

const COUNTRY_CENTERS: Record<string, { lat: number; lon: number; name: string }> = {
  US: { lat: 39.8283, lon: -98.5795, name: "United States" },
  GB: { lat: 55.3781, lon: -3.436, name: "United Kingdom" },
  DE: { lat: 51.1657, lon: 10.4515, name: "Germany" },
  FR: { lat: 46.2276, lon: 2.2137, name: "France" },
  JP: { lat: 36.2048, lon: 138.2529, name: "Japan" },
  CN: { lat: 35.8617, lon: 104.1954, name: "China" },
  KR: { lat: 35.9078, lon: 127.7669, name: "South Korea" },
  IN: { lat: 20.5937, lon: 78.9629, name: "India" },
};

async function fetchOverpassPois(countryCode: string, key: "aeroway" | "harbour", value: string, limit = 60): Promise<PoiItem[]> {
  const query = `[out:json][timeout:18];area["ISO3166-1"="${countryCode}"][admin_level=2]->.searchArea;(node["${key}"="${value}"](area.searchArea););out center ${limit};`;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
    next: { revalidate: 3600 },
  });

  if (!response.ok) return [];

  const payload = (await response.json()) as {
    elements?: Array<{ lat?: number; lon?: number; tags?: { name?: string } }>;
  };

  return (payload.elements ?? [])
    .map((item) => {
      const lat = item.lat;
      const lon = item.lon;
      if (lat == null || lon == null) return null;
      return {
        name: item.tags?.name?.trim() || "Unnamed",
        lat,
        lon,
      };
    })
    .filter((row): row is PoiItem => row !== null)
    .slice(0, limit);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ countryCode: string }> }) {
  try {
    const { countryCode: rawCountryCode } = await params;
    const countryCode = rawCountryCode.toUpperCase();

    const [airports, harbors, globalNews] = await Promise.all([
      fetchOverpassPois(countryCode, "aeroway", "aerodrome"),
      fetchOverpassPois(countryCode, "harbour", "yes"),
      fetchGlobalNews(),
    ]);

    const localNews = globalNews.filter((item) => item.countryCode === countryCode).slice(0, 20);
    const center = COUNTRY_CENTERS[countryCode] ?? {
      lat: localNews[0]?.countryCode ? 20 : 20,
      lon: localNews[0]?.countryCode ? 0 : 0,
      name: localNews[0]?.country ?? countryCode,
    };

    return NextResponse.json({
      countryCode,
      countryName: center.name,
      center,
      airports,
      harbors,
      localNews,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch country intelligence" },
      { status: 500 },
    );
  }
}
