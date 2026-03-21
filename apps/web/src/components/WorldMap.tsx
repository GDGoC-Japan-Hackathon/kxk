"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import maplibregl, { Map, Popup } from "maplibre-gl";
import { CountryAggregate, EventItem } from "@/types/worldlens";

type WorldMapProps = {
  events: EventItem[];
  aggregates?: CountryAggregate[];
  continentAggregates?: CountryAggregate[];
  selectedEventId?: string;
  className?: string;
  onHoverEvent?: (event: EventItem | undefined) => void;
  onSelectEvent?: (event: EventItem) => void;
  onHoverCountry?: (country: CountryAggregate | undefined) => void;
  onSelectCountry?: (country: CountryAggregate | undefined) => void;
};

const MAPLIBRE_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const BATCH_INTERVAL_MS = 2000;
const SETDATA_MIN_INTERVAL_MS = 1000;

function severityColor(value: number) {
  if (value >= 0.75) return "#ef4444";
  if (value >= 0.45) return "#f59e0b";
  return "#22c55e";
}

function toGeoJson(items: CountryAggregate[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: items.map((item) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [item.lon, item.lat] },
      properties: {
        code: item.code,
        name: item.name,
        level: item.level,
        region: item.region,
        article_count: item.article_count,
        severity_score: item.severity_score,
        updated_at: item.updated_at,
        top_headline: item.top_headline ?? "",
        color: severityColor(item.severity_score),
      },
    })),
  };
}

export function WorldMap({
  events,
  aggregates = [],
  continentAggregates = [],
  className,
  onHoverEvent,
  onSelectEvent,
  onHoverCountry,
  onSelectCountry,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(true);

  const countriesRef = useRef<CountryAggregate[]>(aggregates);
  const continentsRef = useRef<CountryAggregate[]>(continentAggregates);
  const eventsRef = useRef<EventItem[]>(events);
  const pendingCountriesRef = useRef<CountryAggregate[] | null>(aggregates);
  const pendingContinentsRef = useRef<CountryAggregate[] | null>(continentAggregates);
  const lastSetDataRef = useRef(0);

  const mapStyle = useMemo(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (token) return `https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${token}`;
    return MAPLIBRE_STYLE;
  }, []);

  useEffect(() => {
    countriesRef.current = aggregates;
    pendingCountriesRef.current = aggregates;
  }, [aggregates]);

  useEffect(() => {
    continentsRef.current = continentAggregates;
    pendingContinentsRef.current = continentAggregates;
  }, [continentAggregates]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: [12, 23],
      zoom: 1.6,
      minZoom: 1,
      maxZoom: 8,
      attributionControl: false,
      fadeDuration: 0,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });

    map.on("load", () => {
      map.addSource("continent-bubbles", { type: "geojson", data: toGeoJson(continentsRef.current) });
      map.addSource("country-bubbles", { type: "geojson", data: toGeoJson(countriesRef.current) });

      map.addLayer({
        id: "continent-circle",
        type: "circle",
        source: "continent-bubbles",
        maxzoom: 2.99,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "article_count"]], 1, 14, 20, 44],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.38,
          "circle-stroke-color": "#d1d5db",
          "circle-stroke-width": 1,
        },
      });

      map.addLayer({
        id: "continent-count",
        type: "symbol",
        source: "continent-bubbles",
        maxzoom: 2.99,
        layout: { "text-field": ["to-string", ["get", "article_count"]], "text-size": 12 },
        paint: { "text-color": "#f8fafc" },
      });

      map.addLayer({
        id: "country-circle",
        type: "circle",
        source: "country-bubbles",
        minzoom: 3,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "article_count"]], 1, 8, 20, 28],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.45,
          "circle-stroke-color": "#e2e8f0",
          "circle-stroke-width": 1,
        },
      });

      map.addLayer({
        id: "country-count",
        type: "symbol",
        source: "country-bubbles",
        minzoom: 3,
        layout: { "text-field": ["to-string", ["get", "article_count"]], "text-size": 11 },
        paint: { "text-color": "#f8fafc" },
      });

      const hoverHandler = (evt: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const feature = evt.features?.[0];
        if (!feature?.properties) return;
        const code = String(feature.properties.code);
        const level = String(feature.properties.level);
        const item = (level === "continent" ? continentsRef.current : countriesRef.current).find((row) => row.code === code);
        onHoverCountry?.(item);
        popupRef.current
          ?.setLngLat((feature.geometry as Point).coordinates as [number, number])
          .setHTML(
            `<div class=\"map-tooltip\"><strong>${feature.properties.name}</strong><p>${feature.properties.article_count} issues · severity ${Number(
              feature.properties.severity_score,
            ).toFixed(2)}</p><p>${feature.properties.top_headline || ""}</p></div>`,
          )
          .addTo(map);
      };

      map.on("mousemove", "continent-circle", hoverHandler);
      map.on("mousemove", "country-circle", hoverHandler);

      map.on("mouseleave", "continent-circle", () => {
        onHoverCountry?.(undefined);
        popupRef.current?.remove();
      });
      map.on("mouseleave", "country-circle", () => {
        onHoverCountry?.(undefined);
        popupRef.current?.remove();
      });

      map.on("click", "continent-circle", (evt) => {
        const feature = evt.features?.[0];
        if (!feature) return;
        map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom: 3.4 });
      });

      map.on("click", "country-circle", (evt) => {
        const feature = evt.features?.[0];
        if (!feature?.properties) return;
        const code = String(feature.properties.code);
        const item = countriesRef.current.find((row) => row.code === code);
        if (item) onSelectCountry?.(item);
        map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom: Math.max(4.2, map.getZoom() + 0.9) });
      });

      // keep compatibility with event stream selections
      map.on("click", "country-circle", () => {
        if (eventsRef.current.length > 0) onSelectEvent?.(eventsRef.current[0]);
      });

      setLoaded(true);
    });

    mapRef.current = map;
    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyle, onHoverCountry, onSelectCountry, onHoverEvent, onSelectEvent]);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const timer = window.setInterval(() => {
      if (!live || !mapRef.current) return;
      const now = Date.now();
      if (now - lastSetDataRef.current < SETDATA_MIN_INTERVAL_MS) return;

      let changed = false;
      const pendingCountries = pendingCountriesRef.current;
      if (pendingCountries) {
        const src = mapRef.current.getSource("country-bubbles") as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(toGeoJson(pendingCountries));
          pendingCountriesRef.current = null;
          changed = true;
        }
      }

      const pendingContinents = pendingContinentsRef.current;
      if (pendingContinents) {
        const src = mapRef.current.getSource("continent-bubbles") as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(toGeoJson(pendingContinents));
          pendingContinentsRef.current = null;
          changed = true;
        }
      }

      if (changed) lastSetDataRef.current = now;
    }, BATCH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [loaded, live]);

  return (
    <div className="worldmap-shell">
      <div ref={containerRef} className={className ?? "h-full w-full"} aria-label="World map" />
      <button type="button" className="map-live-toggle" onClick={() => setLive((v) => !v)}>
        {live ? "LIVE" : "PAUSED"}
      </button>
    </div>
  );
}
