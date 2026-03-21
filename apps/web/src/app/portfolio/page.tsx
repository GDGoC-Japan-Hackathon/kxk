"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { fetchMarketsCatalog, saveMyPortfolio, savePortfolio } from "@/lib/api";
import { useAuthProfile } from "@/lib/hooks";
import { Holding, MarketCatalogItem } from "@/types/worldlens";

type PortfolioRow = {
  ticker: string;
  quantity: number;
};

const DRAFT_KEY = "worldlens_portfolio_quantity_draft";
const REPORT_DRAFT_KEY = "worldlens_portfolio_draft";
const PIE_COLORS = ["#7ce3bb", "#6fa8ff", "#fbbf24", "#fb7185", "#38bdf8", "#a78bfa", "#34d399", "#f97316"];

function normalizeTicker(value: string) {
  return value.trim().toUpperCase();
}

function buildPieGradient(values: number[]) {
  if (!values.length) return "conic-gradient(#1f2937 0deg 360deg)";

  let start = 0;
  const slices = values.map((value, index) => {
    const end = start + value * 3.6;
    const color = PIE_COLORS[index % PIE_COLORS.length];
    const slice = `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    start = end;
    return slice;
  });

  return `conic-gradient(${slices.join(", ")})`;
}

export default function PortfolioInputPage() {
  const { profile } = useAuthProfile();
  const [catalog, setCatalog] = useState<MarketCatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PortfolioRow[]>([
    { ticker: "AAPL", quantity: 10 },
    { ticker: "MSFT", quantity: 8 },
    { ticker: "NVDA", quantity: 5 },
  ]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    fetchMarketsCatalog().then((res) => setCatalog(res.items)).catch(() => setCatalog([]));
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Array<PortfolioRow | Holding>;
        if (!parsed.length) return;
        const nextRows = parsed.map((item) => ({
          ticker: normalizeTicker(item.ticker),
          quantity: "quantity" in item ? Number(item.quantity) : Number(item.weight),
        }));
        if (nextRows.length) setRows(nextRows);
      } catch {
        // ignore broken drafts
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(rows));
    const saveable = rows
      .map((row) => ({ ticker: normalizeTicker(row.ticker), quantity: Number(row.quantity) || 0 }))
      .filter((row) => row.ticker && row.quantity > 0);
    const quantityTotal = saveable.reduce((sum, row) => sum + row.quantity, 0);
    const holdings =
      quantityTotal > 0
        ? saveable.map((row) => ({
            ticker: row.ticker,
            weight: (row.quantity / quantityTotal) * 100,
          }))
        : [];
    localStorage.setItem(REPORT_DRAFT_KEY, JSON.stringify(holdings));
  }, [rows]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((item) => item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)).slice(0, 8);
  }, [catalog, query]);

  const normalizedRows = useMemo(
    () =>
      rows
        .map((row) => ({ ticker: normalizeTicker(row.ticker), quantity: Number(row.quantity) || 0 }))
        .filter((row) => row.ticker || row.quantity > 0),
    [rows],
  );

  const totalQuantity = normalizedRows.reduce((sum, row) => sum + Math.max(0, row.quantity), 0);

  const slices = useMemo(
    () =>
      normalizedRows
        .filter((row) => row.ticker && row.quantity > 0)
        .map((row, index) => {
          const details = catalog.find((item) => item.symbol === row.ticker);
          const allocation = totalQuantity > 0 ? (row.quantity / totalQuantity) * 100 : 0;
          return {
            ...row,
            name: details?.name ?? "Custom holding",
            allocation,
            color: PIE_COLORS[index % PIE_COLORS.length],
          };
        })
        .sort((a, b) => b.allocation - a.allocation),
    [catalog, normalizedRows, totalQuantity],
  );

  const pieStyle = useMemo(() => buildPieGradient(slices.map((item) => item.allocation)), [slices]);

  const addEmptyRow = () => {
    setRows((current) => [...current, { ticker: "", quantity: 0 }]);
  };

  const upsertTicker = (ticker: string) => {
    const normalized = normalizeTicker(ticker);
    if (rows.some((item) => normalizeTicker(item.ticker) === normalized)) {
      setQuery("");
      return;
    }
    setRows((current) => [...current, { ticker: normalized, quantity: 0 }]);
    setQuery("");
  };

  const updateRow = (index: number, patch: Partial<PortfolioRow>) => {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const save = async () => {
    const saveable = normalizedRows.filter((row) => row.ticker && row.quantity > 0);
    const quantityTotal = saveable.reduce((sum, row) => sum + row.quantity, 0);

    if (!saveable.length || quantityTotal <= 0) {
      setMessage("Add at least one holding with quantity above zero.");
      return;
    }

    setSaving(true);
    setMessage(undefined);

    try {
      const holdings = saveable.map((row) => ({
        ticker: row.ticker,
        weight: row.quantity / quantityTotal,
      }));

      if (profile) await saveMyPortfolio({ holdings });
      else await savePortfolio({ holdings });

      setMessage("Portfolio saved.");
    } catch (error) {
      setMessage((error as Error).message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="screen-shell portfolio-builder-page">
      <SiteHeader />
      <MarketStrip />

      <div className="page-head pt-28">
        <p className="kicker">Portfolio Builder</p>
        <h1>Build Your Portfolio</h1>
      </div>

      <section className="portfolio-builder-shell">
        <section className="panel portfolio-builder-panel">
          <div className="portfolio-builder-head">
            <div>
              <p className="kicker">Input Holdings</p>
              <h2>Add a symbol and quantity</h2>
            </div>
            <div className="portfolio-builder-actions">
              <button className="btn-secondary" type="button" onClick={addEmptyRow}>
                Add Row
              </button>
              <button className="btn-primary" onClick={save} disabled={saving} type="button">
                {saving ? "Saving..." : "Save Portfolio"}
              </button>
              <Link href="/portfolio/report" className="btn-secondary">
                Open Report
              </Link>
            </div>
          </div>

          <div className="portfolio-search-row">
            <label className="portfolio-search-field">
              <span>Find symbol</span>
              <input
                className="text-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search ticker or company name"
              />
            </label>
          </div>

          {matches.length > 0 ? (
            <ul className="symbol-suggest">
              {matches.map((item) => (
                <li key={item.symbol}>
                  <button type="button" onClick={() => upsertTicker(item.symbol)}>
                    <strong>{item.symbol}</strong>
                    <span>{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="portfolio-row-list">
            {rows.map((row, index) => {
              const match = catalog.find((item) => item.symbol === normalizeTicker(row.ticker));
              return (
                <div key={`${row.ticker}-${index}`} className="portfolio-row-card">
                  <label>
                    <span>Symbol</span>
                    <input
                      className="text-input"
                      value={row.ticker}
                      onChange={(event) => updateRow(index, { ticker: normalizeTicker(event.target.value) })}
                      placeholder="AAPL"
                    />
                  </label>

                  <label>
                    <span>Quantity</span>
                    <input
                      className="text-input"
                      type="number"
                      min={0}
                      step={1}
                      value={row.quantity}
                      onChange={(event) => updateRow(index, { quantity: Number(event.target.value) })}
                      placeholder="10"
                    />
                  </label>

                  <div className="portfolio-row-meta">
                    <span>{match?.name ?? "Custom holding"}</span>
                    <button type="button" className="btn-secondary" onClick={() => removeRow(index)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="portfolio-builder-note">
            <span>{rows.length} holdings</span>
            <span>Total quantity: {totalQuantity.toLocaleString()}</span>
            {message ? <strong>{message}</strong> : null}
          </div>
        </section>

        <section className="panel portfolio-visual-panel">
          <div className="portfolio-visual-head">
            <div>
              <p className="kicker">Live Allocation</p>
              <h2>Portfolio at a glance</h2>
            </div>
          </div>

          <div className="portfolio-visual-body">
            <div className="portfolio-pie-wrap">
              <div className="portfolio-pie-chart" style={{ backgroundImage: pieStyle }}>
                <div className="portfolio-pie-center">
                  <strong>{slices.length}</strong>
                  <span>Positions</span>
                </div>
              </div>
            </div>

            <div className="portfolio-allocation-list">
              {slices.length ? (
                slices.map((item) => (
                  <div key={item.ticker} className="portfolio-allocation-item">
                    <i style={{ background: item.color }} />
                    <div>
                      <strong>{item.ticker}</strong>
                      <span>{item.name}</span>
                    </div>
                    <div>
                      <strong>{item.allocation.toFixed(1)}%</strong>
                      <span>{item.quantity.toLocaleString()} units</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="portfolio-empty-state">
                  <strong>No positions yet</strong>
                  <span>Add a ticker and quantity to see the portfolio chart.</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
