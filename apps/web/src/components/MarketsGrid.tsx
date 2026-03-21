"use client";

import Link from "next/link";
import { MarketItem } from "@/types/worldlens";

const formatUtc = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso));

function Sparkline({ series }: { series: number[] }) {
  if (!series.length) return <div className="sparkline sparkline-empty">N/A</div>;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const points = series
    .map((value, index) => {
      const x = (index / Math.max(1, series.length - 1)) * 100;
      const y = max === min ? 50 : 100 - ((value - min) / (max - min)) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}

type MarketsGridProps = {
  items: MarketItem[];
};

export function MarketsGrid({ items }: MarketsGridProps) {
  return (
    <section className="markets-grid">
      {items.map((market) => (
        <Link key={market.symbol} href={`/markets/${encodeURIComponent(market.symbol)}`} className={`market-card ${market.status !== "live" ? "card-muted" : ""}`}>
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--wl-muted)]">{market.asset_class}</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <h2>{market.symbol}</h2>
            <strong>{market.price == null ? "N/A" : market.price.toLocaleString()}</strong>
          </div>
          <p className="mt-1 text-sm text-[var(--wl-muted)]">{market.name}</p>
          <p className={`mt-2 ${market.change_pct != null && market.change_pct >= 0 ? "up" : "down"}`}>
            {market.change_pct == null ? "N/A" : `${market.change_pct >= 0 ? "+" : ""}${market.change_pct.toFixed(2)}%`}
          </p>
          <Sparkline series={market.series} />
          <p className="market-provenance">
            Source: {market.source} · Updated: {formatUtc(market.updated_at)} UTC · {market.status}
          </p>
          {market.reason ? <p className="market-provenance">{market.reason}</p> : null}
        </Link>
      ))}
    </section>
  );
}
