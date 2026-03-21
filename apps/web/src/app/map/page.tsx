"use client";

import { useEffect, useMemo, useState } from "react";
import { EventInspector } from "@/components/EventInspector";
import { EventStreamPanel } from "@/components/EventStreamPanel";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { WorldMap } from "@/components/WorldMap";
import { fetchGeoCountryDetail } from "@/lib/api";
import { useGeoAggregate, useLiveEvents } from "@/lib/hooks";
import { EventFilter, EventItem } from "@/types/worldlens";

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

export default function FullMapPage() {
  const [filters, setFilters] = useState<EventFilter>({
    category: "all",
    region: "all",
    countryCode: "all",
    minSeverity: 0,
    sinceMinutes: 7 * 24 * 60,
  });

  const { events, loading, error, countryOptions } = useLiveEvents(filters, "news");
  const { countries, coverageWarning, recommendedSinceMinutes } = useGeoAggregate(filters.sinceMinutes, "country");
  const { countries: continents } = useGeoAggregate(filters.sinceMinutes, "continent");

  const [selectedEvent, setSelectedEvent] = useState<EventItem | undefined>();
  const [hoveredEvent, setHoveredEvent] = useState<EventItem | undefined>();
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | undefined>();
  const [hoveredCountry, setHoveredCountry] = useState<(typeof countries)[number] | undefined>();
  const [countryInspectorEvents, setCountryInspectorEvents] = useState<EventItem[]>([]);
  const [newsItems, setNewsItems] = useState<IntelNewsItem[]>([]);
  const [newsError, setNewsError] = useState<string | null>(null);

  const selectedCountryEvents = useMemo(() => {
    if (!selectedCountryCode) return countryInspectorEvents;
    return countryInspectorEvents.length ? countryInspectorEvents : events.filter((item) => item.country_code === selectedCountryCode);
  }, [events, selectedCountryCode, countryInspectorEvents]);

  useEffect(() => {
    let active = true;

    const loadHeadlines = async () => {
      try {
        const response = await fetch("/api/intel/news?limit=80", { cache: "no-store" });
        const payload = (await response.json()) as { items?: IntelNewsItem[]; error?: string };
        if (!active) return;
        if (!response.ok || payload.error) {
          setNewsItems([]);
          setNewsError(payload.error ?? "Failed to load headline feed");
          return;
        }
        setNewsItems(payload.items ?? []);
        setNewsError(null);
      } catch {
        if (!active) return;
        setNewsItems([]);
        setNewsError("Failed to load headline feed");
      }
    };

    void loadHeadlines();
    const timer = window.setInterval(() => {
      void loadHeadlines();
    }, 120_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="map-page">
      <SiteHeader />
      <MarketStrip />
      <div className="page-head pt-28">
        <p className="kicker">2D World Map</p>
        <h1>News-First Global Situation Room</h1>
      </div>

      <div className="map-fullstage">
        <WorldMap
          events={events}
          aggregates={countries}
          continentAggregates={continents}
          selectedEventId={selectedEvent?.id}
          onHoverEvent={setHoveredEvent}
          onSelectEvent={setSelectedEvent}
          onHoverCountry={setHoveredCountry}
          onSelectCountry={(country) => {
            const code = country?.code;
            setSelectedCountryCode(code);
            if (!code || code.length !== 2) {
              setCountryInspectorEvents([]);
              return;
            }
            void fetchGeoCountryDetail(code, filters.sinceMinutes, 40)
              .then((detail) => setCountryInspectorEvents(detail.clusters))
              .catch(() => setCountryInspectorEvents([]));
          }}
          className="h-full w-full"
        />
      </div>

      <div className="map-filters">
        <EventStreamPanel
          events={events.slice(0, 24)}
          loading={loading}
          error={error}
          selectedId={selectedEvent?.id}
          filters={filters}
          countries={countryOptions}
          onFilterChange={setFilters}
          onSelectEvent={setSelectedEvent}
          onHoverEvent={setHoveredEvent}
        />
      </div>

      <div className="map-inspector">
        <EventInspector
          event={hoveredEvent ?? selectedEvent}
          country={hoveredCountry ?? countries.find((item) => item.code === selectedCountryCode)}
          countryEvents={selectedCountryEvents}
        />
      </div>

      {coverageWarning ? (
        <div className="coverage-warning">
          {coverageWarning} {recommendedSinceMinutes ? `Try ${Math.round(recommendedSinceMinutes / 60)}h.` : ""}
        </div>
      ) : null}

      {!loading && !error && events.length === 0 ? (
        <div className="coverage-warning">
          No news clusters in current slice. Increase time window or verify API server at `NEXT_PUBLIC_API_URL`.
        </div>
      ) : null}

      <section className="panel">
        <h2>Live Headline Feed</h2>
        {newsError ? <p className="state-msg text-red-300">{newsError}</p> : null}
        {!newsError && newsItems.length === 0 ? <p className="state-msg">No headline feed yet. Configure NEWS_API_KEY or backend feeds.</p> : null}
        <div className="news-card-grid mt-4">
          {newsItems.slice(0, 18).map((item) => (
            <article key={`${item.url}-${item.publishedAt}`} className="news-grid-card">
              {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : <div className="news-thumb-empty" />}
              <div className="news-grid-body">
                <strong>{item.title}</strong>
                <p>{item.source}</p>
                <p>{item.country} · {item.continent}</p>
                <a href={item.url} target="_blank" rel="noreferrer">Open link</a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="live-ticker">LIVE Situation Room · click clusters to zoom · click country bubbles for issue list</div>
    </main>
  );
}
