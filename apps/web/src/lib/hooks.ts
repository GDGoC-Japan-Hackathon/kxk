"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WS_EVENTS_URL, WS_NEWS_URL, fetchGeoAggregate, fetchMarkets, fetchMe, fetchNewsEvents } from "@/lib/api";
import { CountryAggregate, EventFilter, EventItem, MarketItem, UserProfile } from "@/types/worldlens";

function mergeEvents(current: EventItem[], incoming: EventItem[]) {
  const byId = new Map<string, EventItem>();
  [...incoming, ...current].forEach((item) => byId.set(item.id, item));
  return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 600);
}

function matchesFilter(event: EventItem, filter: EventFilter): boolean {
  const cutoff = Date.now() - filter.sinceMinutes * 60 * 1000;
  if (filter.category !== "all" && event.category !== filter.category) return false;
  if (filter.region !== "all" && event.region !== filter.region) return false;
  if (filter.countryCode !== "all" && event.country_code !== filter.countryCode) return false;
  if (event.severity < filter.minSeverity) return false;
  if (new Date(event.updated_at).getTime() < cutoff) return false;
  return true;
}

export function useLiveEvents(filter: EventFilter, channel: "events" | "news" = "events") {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [meta, setMeta] = useState<{
    source: string;
    coverageCountries?: number;
    coverageWarning?: string;
    recommendedSinceMinutes?: number;
    asOf?: string;
    sourcesUsed?: string[];
    discardReasons?: Record<string, number>;
    topRejectedDomains?: Array<[string, number]>;
  }>();

  const socketUrl = channel === "news" ? WS_NEWS_URL : WS_EVENTS_URL;
  const filterRef = useRef(filter);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const limit = channel === "news" ? 320 : 120;

    fetchNewsEvents(filter, limit)
      .then((response) => {
        if (!mounted) return;
        setEvents(response.events ?? response.clusters ?? []);
        setMeta({
          source: response.source,
          coverageCountries: response.coverage_countries,
          coverageWarning: response.coverage_warning,
          recommendedSinceMinutes: response.recommended_since_minutes,
          asOf: response.as_of,
          sourcesUsed: response.sources_used,
          discardReasons: response.discard_reasons,
          topRejectedDomains: response.top_rejected_domains,
        });
        setError(undefined);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || "Failed to load events");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [channel, filter]);

  useEffect(() => {
    const socket = new WebSocket(socketUrl);

    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as { type: string; events?: EventItem[]; event?: EventItem; upserts?: EventItem[]; removes?: string[] };
        if (payload.type === "snapshot" && payload.events) {
          setEvents((current) => mergeEvents(current, payload.events ?? []).filter((item) => matchesFilter(item, filterRef.current)));
        }
        if (payload.type === "diff") {
          setEvents((current) => {
            const removed = new Set(payload.removes ?? []);
            const surviving = current.filter((item) => !removed.has(item.id));
            return mergeEvents(surviving, payload.upserts ?? []).filter((item) => matchesFilter(item, filterRef.current));
          });
        }
        if (payload.type === "event" && payload.event) {
          const nextEvent = payload.event;
          setEvents((current) => mergeEvents(current, [nextEvent]).filter((item) => matchesFilter(item, filterRef.current)));
        }
      } catch {
        // ignore malformed payload
      }
    };

    return () => socket.close();
  }, [socketUrl]);

  const countryOptions = useMemo(() => {
    const map = new Map<string, string>();
    events.forEach((event) => map.set(event.country_code, event.country));
    return [...map.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [events]);

  return { events, loading, error, countryOptions, meta };
}

export function useGeoAggregate(sinceMinutes = 24 * 60, mode: "country" | "continent" = "country") {
  const [countries, setCountries] = useState<CountryAggregate[]>([]);
  const [coverageWarning, setCoverageWarning] = useState<string | undefined>();
  const [coverageCountries, setCoverageCountries] = useState<number>(0);
  const [recommendedSinceMinutes, setRecommendedSinceMinutes] = useState<number | undefined>();

  useEffect(() => {
    let mounted = true;
    fetchGeoAggregate(sinceMinutes, 350, mode)
      .then((response) => {
        if (mounted) {
          setCountries(response.items);
          setCoverageWarning(response.coverage_warning);
          setCoverageCountries(response.coverage_countries);
          setRecommendedSinceMinutes(response.recommended_since_minutes);
        }
      })
      .catch(() => {
        if (mounted) {
          setCountries([]);
          setCoverageWarning(undefined);
          setCoverageCountries(0);
          setRecommendedSinceMinutes(undefined);
        }
      });
    return () => {
      mounted = false;
    };
  }, [sinceMinutes, mode]);

  return { countries, coverageWarning, coverageCountries, recommendedSinceMinutes };
}

export function useMarkets(pollMs = 15000, symbols?: string[]) {
  const [items, setItems] = useState<MarketItem[]>([]);
  const [mode, setMode] = useState("mixed");

  useEffect(() => {
    let mounted = true;

    const tick = async () => {
      try {
        const response = await fetchMarkets(symbols);
        if (!mounted) return;
        setItems(response.items);
        setMode(response.mode);
      } catch {
        if (!mounted) return;
        setItems([]);
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, pollMs);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [pollMs, JSON.stringify(symbols ?? [])]);

  return { items, mode };
}

export function useAuthProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchMe()
      .then((me) => {
        if (mounted) setProfile(me);
      })
      .catch(() => {
        if (mounted) setProfile(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { profile, loading, setProfile };
}
