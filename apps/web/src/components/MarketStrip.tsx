"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMarkets } from "@/lib/hooks";
import type { MarketItem } from "@/types/worldlens";

const KEY_SYMBOLS = ["^GSPC", "^IXIC", "^KS11", "^KQ11", "^N225", "^STOXX50E", "^FTSE", "^GDAXI", "^FCHI", "GLD", "BTC", "ETH", "^VIX"];

export function MarketStrip() {
  const { items, mode } = useMarkets(18000, KEY_SYMBOLS);

  const visible = useMemo(() => {
    const bySymbol = new Map(items.map((item) => [item.symbol, item]));
    return KEY_SYMBOLS
      .map((symbol) => bySymbol.get(symbol))
      .filter(
        (item): item is MarketItem & { price: number; change_pct: number } =>
          Boolean(item && item.price != null && item.change_pct != null),
      );
  }, [items]);

  return (
    <div className="market-strip" role="status" aria-label="Live market strip">
      <div className="market-strip-inner">
        <Link href="/markets" className="market-strip-title">
          Markets ({mode})
        </Link>
        <div className="market-marquee">
          <div className="market-strip-track">
            {[...visible, ...visible].map((market, idx) => (
              <article
                key={`${market.symbol}-${idx}`}
                className="market-pill"
                title={`Source: ${market.source} · ${market.status} · Updated ${new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: "UTC",
                }).format(new Date(market.updated_at))} UTC`}
              >
                <span>{market.symbol}</span>
                <strong>{market.price.toLocaleString()}</strong>
                <em className={market.change_pct >= 0 ? "up" : "down"}>
                  {`${market.change_pct >= 0 ? "+" : ""}${market.change_pct.toFixed(2)}%`}
                </em>
                <small>{market.source}</small>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
