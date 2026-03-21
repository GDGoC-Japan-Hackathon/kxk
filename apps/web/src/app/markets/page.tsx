"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { MarketsFilter } from "@/components/MarketsFilter";
import { MarketsGrid } from "@/components/MarketsGrid";
import { SiteHeader } from "@/components/SiteHeader";
import { useMarkets } from "@/lib/hooks";

const DEFAULT_CATEGORIES = ["Crypto", "Stocks", "ETFs", "Indices", "FX", "Commodities", "Macro"];
const DEFAULT_REGIONS = ["Global", "US", "Korea", "Japan", "Europe"];

export default function MarketsPage() {
  const { items, mode } = useMarkets(12000);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [selectedRegions, setSelectedRegions] = useState<string[]>(DEFAULT_REGIONS);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [search, setSearch] = useState("");

  const favorites = new Set(["^GSPC", "^IXIC", "BTC", "ETH", "USDJPY", "WTI", "XAUUSD", "US10Y", "^VIX", "^KS11", "^N225", "^STOXX50E"]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!item.symbol.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      }
      if (!selectedCategories.includes(item.asset_class)) return false;
      if (!selectedRegions.includes(item.region)) return false;
      if (favoritesOnly && !favorites.has(item.symbol)) return false;
      return true;
    });
  }, [items, selectedCategories, selectedRegions, favoritesOnly]);

  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />

      <div className="page-head pt-28">
        <div>
          <p className="kicker">Market Matrix ({mode})</p>
          <h1>Cross-Asset Regime Monitor</h1>
          <p className="text-sm text-[var(--wl-muted)] mt-1">Real free-source data where available; otherwise clearly labeled stale/unavailable.</p>
          <div className="mt-3">
            <input className="text-input max-w-xl" placeholder="Search symbol or name" value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <div className="symbol-suggest mt-2 max-w-xl">
                {filtered.slice(0, 8).map((item) => (
                  <Link key={item.symbol} href={`/markets/${encodeURIComponent(item.symbol)}`}>
                    <strong>{item.symbol}</strong> <span>{item.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="markets-layout">
        <div>
          <MarketsFilter selected={selectedCategories} onChange={setSelectedCategories} />
          <div className="panel mt-3">
            <header className="panel-header">
              <h2>Regions</h2>
              <span>Filter</span>
            </header>
            <div className="mt-3 space-y-2">
              {["Global", "US", "Korea", "Japan", "Europe"].map((region) => (
                <label key={region} className="market-check-row">
                  <input
                    type="checkbox"
                    checked={selectedRegions.includes(region)}
                    onChange={(event) => {
                      if (event.target.checked) setSelectedRegions([...selectedRegions, region]);
                      else setSelectedRegions(selectedRegions.filter((item) => item !== region));
                    }}
                  />
                  <span>{region}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="market-check-row mt-3">
            <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
            <span>Favorites only</span>
          </label>
        </div>
        <MarketsGrid items={filtered} />
      </div>
    </main>
  );
}
