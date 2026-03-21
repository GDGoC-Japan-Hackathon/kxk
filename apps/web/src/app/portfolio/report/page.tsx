"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { computeImpact, fetchMarketsCatalog, fetchNewsEvents } from "@/lib/api";
import type { EventItem, Holding, ImpactResponse, MarketCatalogItem, PortfolioInput } from "@/types/worldlens";

const DRAFT_KEY = "worldlens_portfolio_draft";

type NewsMatch = {
  event: EventItem;
  score: number;
  reasons: string[];
  linkedHoldings: string[];
};

const TICKER_THEME_MAP: Record<string, string[]> = {
  AAPL: ["technology", "consumer electronics", "china", "iphone", "semiconductor"],
  MSFT: ["software", "cloud", "ai", "technology"],
  NVDA: ["ai", "semiconductor", "chips", "technology", "taiwan"],
  AMD: ["semiconductor", "chips", "technology"],
  TSM: ["semiconductor", "taiwan", "chips"],
  TSLA: ["china", "ev", "autos", "rates", "consumer"],
  META: ["advertising", "technology", "ai"],
  GOOGL: ["advertising", "cloud", "ai", "technology"],
  AMZN: ["consumer", "cloud", "shipping", "technology"],
  XOM: ["oil", "energy"],
  CVX: ["oil", "energy"],
  BA: ["aerospace", "defense", "travel"],
  JPM: ["banks", "rates", "credit"],
  GS: ["banks", "rates", "markets"],
  GLD: ["gold", "inflation", "dollar"],
  BTC: ["bitcoin", "crypto", "risk appetite"],
  ETH: ["ethereum", "crypto", "risk appetite"],
};

function normalizeTicker(value: string) {
  return value.trim().toUpperCase();
}

function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function loadDraftHoldings() {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(DRAFT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Holding[];
    return parsed
      .map((item) => ({
        ticker: normalizeTicker(item.ticker),
        weight: Number(item.weight) || 0,
      }))
      .filter((item) => item.ticker && item.weight > 0);
  } catch {
    return [];
  }
}

function holdingThemes(ticker: string, name?: string) {
  const direct = TICKER_THEME_MAP[ticker] ?? [];
  const lowerName = (name ?? "").toLowerCase();
  const inferred: string[] = [];
  if (lowerName.includes("semiconductor") || lowerName.includes("chip")) inferred.push("semiconductor", "chips");
  if (lowerName.includes("bank")) inferred.push("banks", "rates", "credit");
  if (lowerName.includes("oil") || lowerName.includes("energy")) inferred.push("oil", "energy");
  if (lowerName.includes("gold")) inferred.push("gold", "inflation");
  if (lowerName.includes("software") || lowerName.includes("cloud")) inferred.push("software", "cloud", "technology");
  if (lowerName.includes("bitcoin") || lowerName.includes("crypto")) inferred.push("crypto", "risk appetite");
  return [...new Set([...direct, ...inferred])];
}

function scoreEventForHolding(event: EventItem, holding: Holding, catalogItem?: MarketCatalogItem) {
  const haystack = `${event.title} ${event.summary} ${event.country} ${event.category}`.toLowerCase();
  const ticker = holding.ticker;
  const reasons: string[] = [];
  let score = 0;

  if (haystack.includes(ticker.toLowerCase())) {
    score += 8;
    reasons.push(`${ticker} mentioned directly`);
  }

  const themes = holdingThemes(ticker, catalogItem?.name);
  for (const theme of themes) {
    if (haystack.includes(theme)) {
      score += theme.length > 6 ? 3 : 2;
      reasons.push(`${theme} exposure`);
    }
  }

  if (catalogItem?.region === "US" && (event.region === "NA" || event.country_code === "US")) {
    score += 1;
    reasons.push("same regional exposure");
  }
  if (catalogItem?.region === "Europe" && event.region === "EU") {
    score += 1;
    reasons.push("same regional exposure");
  }
  if ((catalogItem?.region === "Japan" || catalogItem?.region === "Korea") && event.region === "APAC") {
    score += 1;
    reasons.push("same regional exposure");
  }
  if (event.category === "macro" && themes.some((theme) => ["rates", "inflation", "consumer", "credit"].includes(theme))) {
    score += 2;
    reasons.push("macro sensitivity");
  }
  if (event.category === "commodities" && themes.some((theme) => ["oil", "energy", "inflation"].includes(theme))) {
    score += 2;
    reasons.push("commodity linkage");
  }
  if (event.category === "tech" && themes.some((theme) => ["technology", "ai", "semiconductor", "cloud"].includes(theme))) {
    score += 2;
    reasons.push("sector linkage");
  }

  return { score, reasons: [...new Set(reasons)].slice(0, 3) };
}

function buildNewsMatches(events: EventItem[], holdings: Holding[], catalog: MarketCatalogItem[]) {
  const byTicker = new Map(catalog.map((item) => [normalizeTicker(item.symbol), item]));
  const matches: NewsMatch[] = [];

  for (const event of events) {
    let score = 0;
    const reasons = new Set<string>();
    const linkedHoldings = new Set<string>();

    for (const holding of holdings) {
      const result = scoreEventForHolding(event, holding, byTicker.get(holding.ticker));
      if (result.score <= 0) continue;
      score += result.score * Math.max(holding.weight / 10, 1);
      linkedHoldings.add(holding.ticker);
      for (const reason of result.reasons) reasons.add(reason);
    }

    if (!linkedHoldings.size) continue;
    matches.push({
      event,
      score,
      reasons: [...reasons].slice(0, 4),
      linkedHoldings: [...linkedHoldings].slice(0, 4),
    });
  }

  return matches.sort((a, b) => b.score - a.score || b.event.updated_at.localeCompare(a.event.updated_at)).slice(0, 8);
}

export default function PortfolioReportPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [catalog, setCatalog] = useState<MarketCatalogItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [impact, setImpact] = useState<ImpactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHoldings(loadDraftHoldings());
  }, []);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!holdings.length) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [catalogResponse, newsResponse] = await Promise.all([
          fetchMarketsCatalog(),
          fetchNewsEvents({ category: "all", region: "all", countryCode: "all", minSeverity: 0, sinceMinutes: 7 * 24 * 60 }, 80),
        ]);

        if (!active) return;
        setCatalog(catalogResponse.items);
        const nextEvents = newsResponse.events ?? newsResponse.clusters ?? [];
        setEvents(nextEvents);

        const topEvent = buildNewsMatches(nextEvents, holdings, catalogResponse.items)[0]?.event;
        if (!topEvent) {
          setImpact(null);
          return;
        }

        const normalized: PortfolioInput = {
          holdings: holdings.map((holding) => ({
            ticker: holding.ticker,
            weight: holding.weight / 100,
          })),
        };
        const report = await computeImpact({ event: topEvent, portfolio: normalized });
        if (!active) return;
        setImpact(report);
      } catch (runError) {
        if (!active) return;
        setError(runError instanceof Error ? runError.message : "Failed to build the portfolio report.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [holdings]);

  const totalWeight = useMemo(() => holdings.reduce((sum, item) => sum + item.weight, 0), [holdings]);
  const topPositions = useMemo(() => [...holdings].sort((a, b) => b.weight - a.weight).slice(0, 6), [holdings]);
  const newsMatches = useMemo(() => buildNewsMatches(events, holdings, catalog), [events, holdings, catalog]);
  const concentration = useMemo(() => holdings.reduce((sum, item) => sum + (item.weight / 100) ** 2, 0), [holdings]);

  return (
    <main className="screen-shell portfolio-report-page">
      <SiteHeader />
      <MarketStrip />

      <div className="page-head pt-28">
        <p className="kicker">Portfolio Risk Report</p>
        <h1>News-linked portfolio risk dashboard</h1>
        <p>Input holdings are mapped to current headlines, exposure reasons, and the most relevant macro shock.</p>
      </div>

      <section className="portfolio-report-shell">
        <section className="panel portfolio-report-summary">
          <div className="portfolio-report-summary-head">
            <div>
              <p className="kicker">Portfolio</p>
              <h2>Current input</h2>
            </div>
            <Link href="/portfolio" className="btn-secondary">Edit Input</Link>
          </div>

          {!holdings.length ? (
            <div className="portfolio-report-empty">
              <strong>No portfolio input found.</strong>
              <span>Go back to input, add holdings, and open the report again.</span>
            </div>
          ) : (
            <>
              <div className="portfolio-report-metrics">
                <div>
                  <span>Holdings</span>
                  <strong>{holdings.length}</strong>
                </div>
                <div>
                  <span>Weight Sum</span>
                  <strong>{totalWeight.toFixed(1)}%</strong>
                </div>
                <div>
                  <span>Concentration</span>
                  <strong>{concentration.toFixed(3)}</strong>
                </div>
              </div>

              <div className="portfolio-report-positions">
                {topPositions.map((holding) => (
                  <div key={holding.ticker} className="portfolio-report-position">
                    <strong>{holding.ticker}</strong>
                    <span>{formatPct(holding.weight)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel portfolio-report-impact">
          <div className="portfolio-report-summary-head">
            <div>
              <p className="kicker">Risk Signal</p>
              <h2>Most relevant live shock</h2>
            </div>
          </div>

          {loading ? <p className="state-msg">Building the risk report...</p> : null}
          {error ? <p className="state-msg text-red-300">{error}</p> : null}
          {!loading && !error && !impact ? <p className="state-msg">No strong portfolio-linked live event was found yet.</p> : null}

          {impact ? (
            <>
              <div className="portfolio-report-impact-score">
                <strong>{impact.impact_score.toFixed(1)}</strong>
                <span>Impact score</span>
              </div>

              <div className="portfolio-report-factor-grid">
                {Object.entries(impact.portfolio_exposure).map(([factor, value]) => (
                  <div key={factor}>
                    <span>{factor}</span>
                    <div className="factor-track"><i style={{ width: `${Math.min(100, Math.abs(value) * 100)}%` }} /></div>
                    <small>{value.toFixed(2)}</small>
                  </div>
                ))}
              </div>

              <table className="mini-table mt-4">
                <thead>
                  <tr><th>Holding</th><th>Weight</th><th>Risk Contribution</th></tr>
                </thead>
                <tbody>
                  {impact.top_impacted_holdings.map((row) => (
                    <tr key={row.ticker}>
                      <td>{row.ticker}</td>
                      <td>{formatPct(row.weight * 100)}</td>
                      <td className={row.signed_impact >= 0 ? "down" : "up"}>{row.signed_impact.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>

        <section className="panel portfolio-report-news">
          <div className="portfolio-report-summary-head">
            <div>
              <p className="kicker">Relevant News</p>
              <h2>Why these headlines matter to this portfolio</h2>
            </div>
          </div>

          {!loading && !newsMatches.length ? (
            <p className="state-msg">No matched headlines yet.</p>
          ) : (
            <div className="portfolio-news-list">
              {newsMatches.map((match) => (
                <article key={match.event.id} className="portfolio-news-card">
                  <div className="portfolio-news-card-head">
                    <div>
                      <span>{match.event.country}</span>
                      <strong>{match.event.title}</strong>
                    </div>
                    <em>{match.score.toFixed(1)}</em>
                  </div>

                  <p>{match.event.summary}</p>

                  <div className="portfolio-news-meta">
                    <span>{match.event.source}</span>
                    <span>{match.event.article_count} linked articles</span>
                    <span>{match.event.category}</span>
                  </div>

                  <div className="portfolio-news-reasons">
                    <h3>Why this is relevant</h3>
                    <ul>
                      {match.reasons.map((reason) => (
                        <li key={`${match.event.id}-${reason}`}>{reason}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="portfolio-news-linked">
                    {match.linkedHoldings.map((ticker) => (
                      <span key={`${match.event.id}-${ticker}`}>{ticker}</span>
                    ))}
                  </div>

                  <a href={match.event.url} target="_blank" rel="noreferrer" className="btn-secondary">
                    Open Source
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
