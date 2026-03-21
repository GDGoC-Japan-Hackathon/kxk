"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Geometry, Point } from "geojson";
import maplibregl, { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { fetchGeoCountryDetail } from "@/lib/api";
import { isoA3ToA2 } from "@/lib/iso";
import { CountryAggregate, EventItem } from "@/types/worldlens";

type WorldNewsMapProps = {
  events: EventItem[];
  aggregates?: CountryAggregate[];
  sinceMinutes?: number;
  className?: string;
};

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
  category: "politics" | "economy" | "technology" | "energy" | "security" | "crypto";
};

type CountryGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type CountryFeature = {
  type: "Feature";
  properties: {
    ADMIN?: string;
    ISO_A2?: string;
    ISO_A3?: string;
    ["ISO3166-1-Alpha-2"]?: string;
    ["ISO3166-1-Alpha-3"]?: string;
    ADMIN_EN?: string;
    SOVEREIGNT?: string;
    name?: string;
  };
  geometry: CountryGeometry;
};

type CountryFeatureCollection = {
  type: "FeatureCollection";
  features: CountryFeature[];
};

type CountryRecord = {
  code: string;
  name: string;
  center: [number, number];
  bounds: LngLatBoundsLike;
  geometry: CountryGeometry;
};

const COUNTRY_CODE_BY_NAME: Record<string, string> = {
  "AUSTRALIA": "AU",
  "CHINA": "CN",
  "JAPAN": "JP",
  "SOUTH KOREA": "KR",
  "NORTH KOREA": "KP",
  "UNITED STATES OF AMERICA": "US",
  "UNITED STATES": "US",
  "RUSSIA": "RU",
  "RUSSIAN FEDERATION": "RU",
  "UNITED KINGDOM": "GB",
  "FRANCE": "FR",
  "GERMANY": "DE",
  "BRAZIL": "BR",
  "INDIA": "IN",
  "CANADA": "CA",
  "MEXICO": "MX",
  "INDONESIA": "ID",
  "SOUTH AFRICA": "ZA",
};

type CountryBubble = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  articleCount: number;
  severity: number;
  topHeadline: string;
};

const WORLD_RASTER_TILE_URL =
  process.env.NEXT_PUBLIC_WORLD_RASTER_TILE_URL ??
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const MAJOR_COUNTRY_CODES = [
  "US", "CA", "MX", "GT", "PA", "CU",
  "BR", "AR", "CL", "CO", "PE", "VE", "EC", "UY", "PY", "BO",
  "GB", "FR", "DE", "ES", "IT", "NL", "BE", "CH", "AT", "NO", "SE", "FI", "PL", "UA", "RO", "GR",
  "TR", "RU",
  "MA", "DZ", "TN", "EG", "NG", "GH", "CI", "CM", "ET", "KE", "TZ", "UG", "ZA", "AO", "MZ",
  "SA", "AE", "IL", "IR", "IQ", "QA",
  "IN", "PK", "BD", "CN", "JP", "KR", "TW", "TH", "VN", "MY", "SG", "ID", "PH",
  "AU", "NZ",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function flattenGeometry(geometry: CountryGeometry) {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as number[][][]).flat()
    : (geometry.coordinates as number[][][][]).flat(2);
}

function geometryCenter(geometry: CountryGeometry): [number, number] {
  const coordinates = flattenGeometry(geometry);
  let lonSum = 0;
  let latSum = 0;
  let count = 0;

  for (const [lon, lat] of coordinates) {
    lonSum += lon;
    latSum += lat;
    count += 1;
  }

  return [lonSum / Math.max(count, 1), latSum / Math.max(count, 1)];
}

function geometryBounds(geometry: CountryGeometry): LngLatBoundsLike {
  const coordinates = flattenGeometry(geometry);
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;

  for (const [lon, lat] of coordinates) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function normalizeCountryName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function toCode(feature: CountryFeature) {
  const alpha2 =
    feature.properties.ISO_A2 ??
    feature.properties["ISO3166-1-Alpha-2"];
  if (alpha2 && /^[A-Z]{2}$/i.test(alpha2) && alpha2 !== "-99") return alpha2.toUpperCase();

  const alpha3 =
    feature.properties.ISO_A3 ??
    feature.properties["ISO3166-1-Alpha-3"];
  const alpha3ToA2 = isoA3ToA2(alpha3);
  if (alpha3ToA2) return alpha3ToA2;

  const byName = normalizeCountryName(
    feature.properties.name ??
    feature.properties.ADMIN ??
    feature.properties.ADMIN_EN ??
    feature.properties.SOVEREIGNT,
  );

  return COUNTRY_CODE_BY_NAME[byName] ?? "";
}

function fallbackNewsItems(events: EventItem[]): IntelNewsItem[] {
  return events.map((event) => ({
    title: event.title,
    description: event.summary,
    url: event.url,
    image: event.top_thumbnail_url ?? null,
    source: event.source,
    publishedAt: event.updated_at,
    country: event.country,
    countryCode: event.country_code,
    continent: event.region,
    category:
      event.category === "macro"
        ? "economy"
        : event.category === "tech"
          ? "technology"
          : event.category === "commodities"
            ? "energy"
            : event.category === "earnings"
              ? "security"
              : event.category === "crypto"
                ? "crypto"
                : "politics",
  }));
}

function mergeNewsFeeds(primary: IntelNewsItem[], fallback: IntelNewsItem[]) {
  const merged = new Map<string, IntelNewsItem>();
  for (const item of primary) merged.set(item.url, item);
  for (const item of fallback) {
    const current = merged.get(item.url);
    if (!current) {
      merged.set(item.url, item);
      continue;
    }

    merged.set(item.url, {
      ...current,
      image: current.image ?? item.image ?? null,
      description: current.description || item.description,
      source: current.source || item.source,
      country: current.country || item.country,
      countryCode: current.countryCode || item.countryCode,
      continent: current.continent || item.continent,
    });
  }
  return [...merged.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function bubbleColor(severity: number) {
  if (severity >= 0.75) return "#ef4444";
  if (severity >= 0.45) return "#f59e0b";
  return "#22c55e";
}

function aggregateNews(
  items: IntelNewsItem[],
  countryLookup: Map<string, CountryRecord>,
  aggregateFallback: CountryAggregate[],
): CountryBubble[] {
  const grouped = new Map<string, { items: IntelNewsItem[]; name: string }>();

  for (const item of items) {
    const code = item.countryCode.toUpperCase();
    if (!code || code === "GL" || !countryLookup.has(code)) continue;
    const current = grouped.get(code);
    if (current) {
      current.items.push(item);
    } else {
      grouped.set(code, { items: [item], name: item.country });
    }
  }

  const merged = new Map<string, CountryBubble>();

  const newsBubbles = [...grouped.entries()].map(([code, value]) => {
    const country = countryLookup.get(code)!;
    return {
      code,
      name: value.name || country.name,
      lon: country.center[0],
      lat: country.center[1],
      articleCount: value.items.length,
      severity: clamp(0.28 + value.items.length / 10, 0.28, 1),
      topHeadline: value.items[0]?.title ?? country.name,
    };
  });

  for (const bubble of newsBubbles) {
    merged.set(bubble.code, bubble);
  }

  for (const item of aggregateFallback.filter((row) => row.level === "country" && countryLookup.has(row.code))) {
    const existing = merged.get(item.code);
    if (existing) {
      existing.articleCount = Math.max(existing.articleCount, item.article_count);
      existing.severity = Math.max(existing.severity, item.severity_score);
      if (!existing.topHeadline && item.top_headline) existing.topHeadline = item.top_headline;
      continue;
    }

    merged.set(item.code, {
      code: item.code,
      name: item.name,
      lon: item.lon,
      lat: item.lat,
      articleCount: item.article_count,
      severity: item.severity_score,
      topHeadline: item.top_headline ?? item.name,
    });
  }

  for (const code of MAJOR_COUNTRY_CODES) {
    if (merged.has(code) || !countryLookup.has(code)) continue;
    const country = countryLookup.get(code)!;
    merged.set(code, {
      code,
      name: country.name,
      lon: country.center[0],
      lat: country.center[1],
      articleCount: 1,
      severity: 0.16,
      topHeadline: country.name,
    });
  }

  return [...merged.values()].sort((a, b) => b.articleCount - a.articleCount);
}

function toBubbleGeoJson(bubbles: CountryBubble[]) {
  return {
    type: "FeatureCollection" as const,
    features: bubbles.map((bubble) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [bubble.lon, bubble.lat],
      },
      properties: {
        code: bubble.code,
        name: bubble.name,
        article_count: bubble.articleCount,
        top_headline: bubble.topHeadline,
        severity: bubble.severity,
        color: bubbleColor(bubble.severity),
      },
    })),
  } as FeatureCollection<Point>;
}

function toLabelGeoJson(
  countryLookup: Map<string, CountryRecord>,
  groupedNews: Map<string, IntelNewsItem[]>,
  bubbles: CountryBubble[],
) {
  const visibleCodes = new Set<string>([
    ...MAJOR_COUNTRY_CODES,
    ...bubbles.slice(0, 48).map((bubble) => bubble.code),
    ...[...groupedNews.keys()],
  ]);

  return {
    type: "FeatureCollection" as const,
    features: [...countryLookup.values()]
      .filter((country) => visibleCodes.has(country.code))
      .map((country) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: country.center,
        },
        properties: {
          code: country.code,
          name: country.name,
        },
      })),
  } as FeatureCollection<Point>;
}

export function WorldNewsMap({
  events,
  aggregates = [],
  sinceMinutes = 7 * 24 * 60,
  className,
}: WorldNewsMapProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const countryLookupRef = useRef<Map<string, CountryRecord>>(new Map());
  const userSelectedRef = useRef(false);
  const [countryLookup, setCountryLookup] = useState<Map<string, CountryRecord>>(new Map());
  const [newsItems, setNewsItems] = useState<IntelNewsItem[]>([]);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedCountryNews, setSelectedCountryNews] = useState<IntelNewsItem[]>([]);
  const eventFallbackFeed = useMemo(() => fallbackNewsItems(events), [events]);
  const isLandingPreview = className?.includes("landing-world-preview") ?? false;
  const isWorldPage = className?.includes("world-page-map") ?? false;
  const defaultPanelWidth = isLandingPreview ? 368 : 392;
  const [panelWidth, setPanelWidth] = useState(defaultPanelWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    setPanelWidth(defaultPanelWidth);
  }, [defaultPanelWidth]);

  useEffect(() => {
    let active = true;

    fetch("/geo/world-countries.geojson", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`World GeoJSON failed (${response.status})`);
        return (await response.json()) as CountryFeatureCollection;
      })
      .then((collection) => {
        if (!active) return;
        const lookup = new Map<string, CountryRecord>();
        for (const feature of collection.features) {
          const code = toCode(feature);
          if (!code || code === "AQ") continue;
          lookup.set(code, {
            code,
            name: feature.properties.ADMIN ?? feature.properties.name ?? code,
            center: geometryCenter(feature.geometry),
            bounds: geometryBounds(feature.geometry),
            geometry: feature.geometry,
          });
        }
        countryLookupRef.current = lookup;
        setCountryLookup(lookup);
      })
      .catch(() => {
        if (!active) return;
        countryLookupRef.current = new Map();
        setCountryLookup(new Map());
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const feedLimit = 320;

    const loadNews = async () => {
      try {
        const response = await fetch(`/api/intel/news?limit=${feedLimit}`, { cache: "no-store" });
        const payload = (await response.json()) as { items?: IntelNewsItem[]; error?: string };
        if (!active) return;
        if (!response.ok || payload.error) {
          setNewsItems(mergeNewsFeeds([], eventFallbackFeed));
          setNewsError(payload.error ?? "Failed to load free news feed.");
          return;
        }

        const nextItems = payload.items ?? [];
        setNewsItems(mergeNewsFeeds(nextItems, eventFallbackFeed));
        setNewsError(null);
      } catch {
        if (!active) return;
        setNewsItems(mergeNewsFeeds([], eventFallbackFeed));
        setNewsError("Failed to load free news feed.");
      }
    };

    void loadNews();
    const timer = window.setInterval(() => void loadNews(), 120_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [eventFallbackFeed]);

  const groupedNews = useMemo(() => {
    const grouped = new Map<string, IntelNewsItem[]>();
    for (const item of newsItems) {
      const code = item.countryCode.toUpperCase();
      if (!code || code === "GL") continue;
      const list = grouped.get(code);
      if (list) {
        list.push(item);
      } else {
        grouped.set(code, [item]);
      }
    }

    for (const list of grouped.values()) {
      list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    }

    return grouped;
  }, [newsItems]);

  const bubbles = useMemo(
    () => aggregateNews(newsItems, countryLookup, aggregates),
    [aggregates, countryLookup, newsItems],
  );

  const selectedBubble = selectedCode ? bubbles.find((item) => item.code === selectedCode) ?? null : null;
  const selectedCountry = selectedCode ? countryLookup.get(selectedCode) ?? null : null;
  const selectedNews = selectedCode ? groupedNews.get(selectedCode) ?? [] : [];

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const container = mapContainerRef.current;
    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          rasterTiles: {
            type: "raster",
            tiles: [WORLD_RASTER_TILE_URL],
            tileSize: 256,
            attribution:
              WORLD_RASTER_TILE_URL.includes("arcgisonline.com")
                ? "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
                : "&copy; OpenStreetMap contributors",
          },
        },
        layers: [{ id: "base-raster", type: "raster", source: "rasterTiles" }],
      },
      center: [8, 24],
      zoom: 1.45,
      minZoom: 1,
      maxZoom: 7.5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(container);

    map.on("load", () => {
      setMapReady(true);
      window.setTimeout(() => map.resize(), 0);
      map.addSource("countries", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("country-bubbles", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("country-labels", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "country-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": ["case", ["==", ["get", "selected"], true], "rgba(37, 99, 235, 0.28)", "rgba(15, 23, 42, 0.06)"],
          "fill-opacity": 1,
        },
      });

      map.addLayer({
        id: "country-outline",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "rgba(255,255,255,0.8)",
          "line-width": 1.35,
        },
      });

      map.addLayer({
        id: "country-label-text",
        type: "symbol",
        source: "country-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-font": ["Arial Unicode MS Bold"],
          "text-letter-spacing": 0.04,
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(3, 7, 18, 0.9)",
          "text-halo-width": 1.2,
          "text-opacity": 0.92,
        },
        minzoom: 3.1,
        maxzoom: 8,
      });

      map.addLayer({
        id: "country-bubble-circles",
        type: "circle",
        source: "country-bubbles",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["sqrt", ["get", "article_count"]],
            1,
            12,
            4,
            18,
            12,
            28,
            24,
            38,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#f8fafc",
          "circle-stroke-width": 2,
          "circle-opacity": 0.82,
        },
      });

      map.addLayer({
        id: "country-bubble-count",
        type: "symbol",
        source: "country-bubbles",
        layout: {
          "text-field": ["to-string", ["get", "article_count"]],
          "text-size": 12,
          "text-font": ["Arial Unicode MS Bold"],
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      map.on("click", "country-bubble-circles", (event) => {
        const feature = event.features?.[0];
        const code = feature?.properties?.code;
        if (!code) return;
        userSelectedRef.current = true;
        setSelectedCode(String(code));
      });

      map.on("click", "country-fill", (event) => {
        const feature = event.features?.[0];
        const code = feature?.properties?.code;
        if (!code) return;
        userSelectedRef.current = true;
        setSelectedCode(String(code));
      });

      map.on("mouseenter", "country-bubble-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "country-bubble-circles", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("mouseenter", "country-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "country-fill", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    mapRef.current = map;

    return () => {
      setMapReady(false);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded() || countryLookup.size === 0) return;

    const geojson = {
      type: "FeatureCollection" as const,
      features: [...countryLookup.values()].map((country) => ({
        type: "Feature" as const,
        properties: {
          code: country.code,
          name: country.name,
          selected: country.code === selectedCode,
        },
        geometry: country.geometry as Geometry,
      })),
    } as FeatureCollection;

    const source = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
    source?.setData(geojson);
  }, [countryLookup, mapReady, selectedCode]);

  useEffect(() => {
    if (!selectedCode) {
      setSelectedCountryNews([]);
      return;
    }

    let active = true;
    fetchGeoCountryDetail(selectedCode, sinceMinutes, 30)
      .then((detail) => {
        if (!active) return;
        setSelectedCountryNews(
          detail.clusters.map((item) => ({
            title: item.title,
            description: item.summary,
            url: item.url,
            image: item.top_thumbnail_url ?? null,
            source: item.source,
            publishedAt: item.updated_at,
            country: item.country,
            countryCode: item.country_code,
            continent: item.region,
            category:
              item.category === "macro"
                ? "economy"
                : item.category === "tech"
                  ? "technology"
                  : item.category === "commodities"
                    ? "energy"
                    : item.category === "earnings"
                      ? "security"
                      : item.category === "crypto"
                        ? "crypto"
                        : "politics",
          })),
        );
      })
      .catch(() => {
        if (!active) return;
        setSelectedCountryNews([]);
      });

    return () => {
      active = false;
    };
  }, [selectedCode, sinceMinutes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const source = map.getSource("country-bubbles") as maplibregl.GeoJSONSource | undefined;
    source?.setData(toBubbleGeoJson(bubbles));
  }, [bubbles, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const source = map.getSource("country-labels") as maplibregl.GeoJSONSource | undefined;
    source?.setData(toLabelGeoJson(countryLookup, groupedNews, bubbles));
  }, [bubbles, countryLookup, groupedNews, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    if (!selectedCode) return;
    const country = countryLookup.get(selectedCode);
    if (!country) return;
    if (!userSelectedRef.current) return;
    map.fitBounds(country.bounds, {
      padding: { top: 80, right: 80, bottom: 80, left: 80 },
      maxZoom: 5.2,
      duration: 900,
    });
  }, [countryLookup, mapReady, selectedCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => map.resize());
    return () => window.cancelAnimationFrame(frame);
  }, [panelWidth]);

  useEffect(() => {
    if (!isWorldPage) return;
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const timer = window.setTimeout(() => map.resize(), 120);
    return () => window.clearTimeout(timer);
  }, [bubbles.length, countryLookup.size, isWorldPage, mapReady, newsItems.length]);

  useEffect(() => {
    if (!isResizing) return;

    const onPointerMove = (event: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const nextWidth = rect.right - event.clientX - 7;
      const minWidth = isLandingPreview ? 300 : 320;
      const maxWidth = Math.max(minWidth, Math.min(560, rect.width * 0.48));
      setPanelWidth(clamp(nextWidth, minWidth, maxWidth));
    };

    const stopResizing = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isLandingPreview, isResizing]);

  const panelTitle = selectedBubble?.name ?? selectedCountry?.name ?? "Select a country";
  const panelItems = selectedCountryNews.length
    ? selectedCountryNews
    : selectedNews.length
      ? selectedNews
        : selectedCode
          ? fallbackNewsItems(events).filter((item) => item.countryCode === selectedCode).slice(0, 24)
        : newsItems.slice(0, 24);

  return (
    <div
      ref={shellRef}
      className={["world-news-map", className, isResizing ? "is-resizing" : ""].filter(Boolean).join(" ")}
      style={{
        ["--world-panel-width" as string]: `${panelWidth}px`,
        ["--world-panel-top-offset" as string]: "0px",
      }}
    >
      <div className="world-news-stage world-news-stage-raster">
        <div ref={mapContainerRef} className="world-news-map-canvas" aria-label="Interactive world news map" />
        <div className="world-news-livebar">
          <span>{bubbles.length.toLocaleString()} country bubbles</span>
          <span>{newsItems.length.toLocaleString()} live headlines</span>
          {newsError ? <span>{newsError}</span> : null}
        </div>
      </div>

      <button
        type="button"
        className="world-news-divider"
        aria-label="Resize map and news panel"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          event.preventDefault();
          setIsResizing(true);
        }}
        onDoubleClick={() => setPanelWidth(defaultPanelWidth)}
      >
        <span />
      </button>

      <aside className="world-news-panel">
        <div className="world-news-panel-head">
          <div>
            <p className="kicker">Country Feed</p>
            <h3>{panelTitle}</h3>
          </div>
          {selectedBubble ? (
            <div className="world-news-panel-meta">
              <span>{panelItems.length || selectedBubble.articleCount} headlines</span>
              <span>severity {selectedBubble.severity.toFixed(2)}</span>
            </div>
          ) : null}
        </div>

        <p className="world-news-panel-summary">
          {selectedBubble?.topHeadline ??
            "Global issue bubbles are live. Click a country bubble or border to open that country's linked news list."}
        </p>

        <div className="world-news-list world-news-list-media">
          {panelItems.map((item) => (
            <a key={`${item.url}-${item.publishedAt}`} className="world-news-link world-news-link-media" href={item.url} target="_blank" rel="noreferrer">
              {item.image ? (
                <img className="world-news-thumb" src={item.image} alt={item.title} loading="lazy" />
              ) : (
                <div className="world-news-thumb world-news-thumb-empty">No image</div>
              )}
              <div>
                <strong>{item.title}</strong>
                <span>{item.source}</span>
              </div>
            </a>
          ))}
          {panelItems.length === 0 ? (
            <p className="world-news-panel-state">No country headlines available yet.</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
