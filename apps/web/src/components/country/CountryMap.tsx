"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

type PoiItem = { name: string; lat: number; lon: number };
type NewsItem = {
  title: string;
  source: string;
  url: string;
  image: string | null;
  publishedAt: string;
};

type CountryPayload = {
  countryCode: string;
  countryName: string;
  center: { lat: number; lon: number; name: string };
  airports: PoiItem[];
  harbors: PoiItem[];
  localNews: NewsItem[];
};

export function CountryMap({ countryCode }: { countryCode: string }) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<CountryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/intel/country/${countryCode}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload: CountryPayload) => {
        if (active) setData(payload);
      })
      .catch(() => {
        if (active) setError("Failed to load country intelligence");
      });

    return () => {
      active = false;
    };
  }, [countryCode]);

  useEffect(() => {
    if (!data || !containerRef.current || mapRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setError("NEXT_PUBLIC_MAPBOX_TOKEN is required for /country map rendering.");
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [data.center.lon, data.center.lat],
      zoom: 4,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    data.airports.forEach((airport) => {
      new mapboxgl.Marker({ color: "#60a5fa" })
        .setLngLat([airport.lon, airport.lat])
        .setPopup(new mapboxgl.Popup().setText(`Airport: ${airport.name}`))
        .addTo(map);
    });

    data.harbors.forEach((harbor) => {
      new mapboxgl.Marker({ color: "#22d3ee" })
        .setLngLat([harbor.lon, harbor.lat])
        .setPopup(new mapboxgl.Popup().setText(`Harbor: ${harbor.name}`))
        .addTo(map);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  return (
    <div className="country-shell">
      <div className="country-map-wrap">
        <div ref={containerRef} className="country-map-canvas" />
      </div>
      <aside className="country-news-panel">
        <h2>Local News</h2>
        {error ? <p>{error}</p> : null}
        {!error && !data?.localNews.length ? <p>No local news found for this country.</p> : null}
        <ul>
          {(data?.localNews ?? []).map((item) => (
            <li key={`${item.url}-${item.publishedAt}`}>
              {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : <div className="news-thumb-empty" />}
              <div>
                <strong>{item.title}</strong>
                <p>{item.source}</p>
                <a href={item.url} target="_blank" rel="noreferrer">
                  Open source
                </a>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
