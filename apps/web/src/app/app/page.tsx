"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EventInspector } from "@/components/EventInspector";
import { EventStreamPanel } from "@/components/EventStreamPanel";
import { MarketStrip } from "@/components/MarketStrip";
import { PortfolioIntelligencePanel } from "@/components/PortfolioIntelligencePanel";
import { SiteHeader } from "@/components/SiteHeader";
import { WorldMap } from "@/components/WorldMap";
import { computeImpact, fetchMyPortfolio, saveMyPortfolio, savePortfolio } from "@/lib/api";
import { useAuthProfile, useGeoAggregate, useLiveEvents } from "@/lib/hooks";
import { EventFilter, EventItem, Holding, ImpactResponse } from "@/types/worldlens";

const DEFAULT_HOLDINGS: Holding[] = [
  { ticker: "SPY", weight: 0.24 },
  { ticker: "QQQ", weight: 0.16 },
  { ticker: "AAPL", weight: 0.13 },
  { ticker: "TSLA", weight: 0.09 },
  { ticker: "GLD", weight: 0.12 },
  { ticker: "BTC", weight: 0.12 },
  { ticker: "ETH", weight: 0.08 },
  { ticker: "XOM", weight: 0.06 },
];

export default function AppDashboardPage() {
  const [filters, setFilters] = useState<EventFilter>({
    category: "all",
    region: "all",
    countryCode: "all",
    minSeverity: 0.25,
    sinceMinutes: 24 * 60,
  });

  const { events, loading, error, countryOptions } = useLiveEvents(filters, "events");
  const { countries } = useGeoAggregate(filters.sinceMinutes, "country");
  const { profile } = useAuthProfile();

  const [selectedEvent, setSelectedEvent] = useState<EventItem | undefined>();
  const [hoveredEvent, setHoveredEvent] = useState<EventItem | undefined>();
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | undefined>();
  const [hoveredCountry, setHoveredCountry] = useState<(typeof countries)[number] | undefined>();

  const [holdings, setHoldings] = useState<Holding[]>(DEFAULT_HOLDINGS);
  const [impact, setImpact] = useState<ImpactResponse | undefined>();
  const [impactError, setImpactError] = useState<string | undefined>();
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [savingPortfolio, setSavingPortfolio] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "stream">("map");
  const [scenarioRateShock, setScenarioRateShock] = useState(0);
  const [scenarioOilShock, setScenarioOilShock] = useState(0);
  const [scenarioUsdShock, setScenarioUsdShock] = useState(0);

  useEffect(() => {
    if (!selectedEvent && events.length > 0) setSelectedEvent(events[0]);
  }, [events, selectedEvent]);

  useEffect(() => {
    if (!profile) return;
    fetchMyPortfolio()
      .then((saved) => {
        if (saved.holdings.length > 0) setHoldings(saved.holdings);
      })
      .catch(() => {
        // ignore
      });
  }, [profile]);

  useEffect(() => {
    if (!selectedEvent) return;
    const validHoldings = holdings.filter((item) => item.ticker.trim() && item.weight > 0);
    if (!validHoldings.length) return;

    setLoadingImpact(true);
    computeImpact({
      event: selectedEvent,
      portfolio: { holdings: validHoldings },
      scenarioRateShock,
      scenarioOilShock,
      scenarioUsdShock,
    })
      .then((response) => {
        setImpact(response);
        setImpactError(undefined);
      })
      .catch((err: Error) => {
        setImpact(undefined);
        setImpactError(err.message || "Impact computation failed");
      })
      .finally(() => setLoadingImpact(false));
  }, [selectedEvent, holdings, scenarioRateShock, scenarioOilShock, scenarioUsdShock]);

  const applyPortfolio = async () => {
    const validHoldings = holdings.filter((item) => item.ticker.trim() && item.weight > 0);
    if (!validHoldings.length) {
      setImpactError("Add at least one valid holding.");
      return;
    }

    setSavingPortfolio(true);
    try {
      if (profile) {
        await saveMyPortfolio({ holdings: validHoldings });
      } else {
        await savePortfolio({ holdings: validHoldings });
      }
      setImpactError(undefined);
    } catch (err) {
      const parsed = err as Error;
      setImpactError(parsed.message || "Failed to save portfolio");
    } finally {
      setSavingPortfolio(false);
    }
  };

  const selectedCountryEvents = useMemo(() => {
    if (!selectedCountryCode) return [];
    return events.filter((item) => item.country_code === selectedCountryCode);
  }, [events, selectedCountryCode]);

  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />

      <div className="page-head pt-28 flex items-end justify-between gap-3">
        <div>
          <p className="kicker">Portfolio Command</p>
          <h1>Institutional Event-to-Risk Dashboard</h1>
        </div>
        {!profile && (
          <Link href="/login" className="btn-secondary">
            Sign in to save portfolio
          </Link>
        )}
      </div>

      <div className="app-grid">
        <section className="panel app-main-panel">
          <div className="tab-header">
            <button type="button" className={activeTab === "map" ? "active" : ""} onClick={() => setActiveTab("map")}>
              Map
            </button>
            <button type="button" className={activeTab === "stream" ? "active" : ""} onClick={() => setActiveTab("stream")}>
              Stream
            </button>
          </div>

          <div className="app-main-content">
            {activeTab === "map" ? (
              <div className="map-stage">
                <WorldMap
                  events={events}
                  aggregates={countries}
                  selectedEventId={selectedEvent?.id}
                  onHoverEvent={setHoveredEvent}
                  onSelectEvent={setSelectedEvent}
                  onHoverCountry={setHoveredCountry}
                  onSelectCountry={(country) => setSelectedCountryCode(country?.code)}
                  className="h-[610px] w-full rounded-xl"
                />
                <EventInspector
                  event={hoveredEvent ?? selectedEvent}
                  country={hoveredCountry ?? countries.find((item) => item.code === selectedCountryCode)}
                  countryEvents={selectedCountryEvents}
                  compact
                />
              </div>
            ) : (
              <EventStreamPanel
                events={events}
                loading={loading}
                error={error}
                selectedId={selectedEvent?.id}
                filters={filters}
                countries={countryOptions}
                onFilterChange={setFilters}
                onSelectEvent={setSelectedEvent}
                onHoverEvent={setHoveredEvent}
              />
            )}
          </div>
        </section>

        <PortfolioIntelligencePanel
          holdings={holdings}
          onChangeHoldings={setHoldings}
          onApply={applyPortfolio}
          applying={savingPortfolio}
          selectedEventTitle={selectedEvent?.title}
          impact={impact}
          loadingImpact={loadingImpact}
          impactError={impactError}
          scenarioRateShock={scenarioRateShock}
          scenarioOilShock={scenarioOilShock}
          scenarioUsdShock={scenarioUsdShock}
          onScenarioChange={({ rateShock, oilShock, usdShock }) => {
            setScenarioRateShock(rateShock);
            setScenarioOilShock(oilShock);
            setScenarioUsdShock(usdShock);
          }}
        />
      </div>
    </main>
  );
}
