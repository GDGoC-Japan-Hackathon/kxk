"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData, UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { fetchMarketHistory, fetchMarkets, fetchMarketsCatalog } from "@/lib/api";
import { MarketCatalogItem, MarketHistoryPoint, MarketItem } from "@/types/worldlens";

const ranges = ["1W", "1M", "3M", "1Y", "5Y", "MAX"];

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

function toTs(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

function MarketChart({ points, seriesType }: { points: MarketHistoryPoint[]; seriesType: "ohlcv" | "line" }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#c9d7ee" },
      grid: { vertLines: { color: "rgba(76, 95, 128, 0.16)" }, horzLines: { color: "rgba(76, 95, 128, 0.16)" } },
      rightPriceScale: { borderColor: "rgba(76,95,128,0.3)" },
      timeScale: { borderColor: "rgba(76,95,128,0.3)", timeVisible: true },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    candleRef.current = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
    lineRef.current = chart.addLineSeries({ color: "#7ce3bb", lineWidth: 2 });
    volRef.current = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
    volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      lineRef.current = null;
      volRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !candleRef.current || !lineRef.current || !volRef.current) return;

    const candleData: CandlestickData[] = points
      .filter((p) => p.o != null && p.h != null && p.l != null && p.c != null)
      .map((p) => ({ time: toTs(p.t), open: Number(p.o), high: Number(p.h), low: Number(p.l), close: Number(p.c) }));
    const lineData: LineData[] = points.filter((p) => p.c != null).map((p) => ({ time: toTs(p.t), value: Number(p.c) }));
    const volumeData: HistogramData[] = points
      .filter((p) => p.v != null)
      .map((p) => ({ time: toTs(p.t), value: Number(p.v), color: p.o != null && p.c != null && p.c >= p.o ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)" }));

    if (seriesType === "ohlcv" && candleData.length) {
      candleRef.current.setData(candleData);
      lineRef.current.setData([]);
    } else {
      lineRef.current.setData(lineData);
      candleRef.current.setData([]);
    }
    volRef.current.setData(volumeData);
    chartRef.current.timeScale().fitContent();
  }, [points, seriesType]);

  return <div ref={containerRef} className="market-tv-chart" aria-label="market history chart" />;
}

export default function MarketDetailPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol || "").toUpperCase();

  const [catalogItem, setCatalogItem] = useState<MarketCatalogItem | null>(null);
  const [quote, setQuote] = useState<MarketItem | null>(null);
  const [range, setRange] = useState("1M");
  const [interval, setInterval] = useState("1d");
  const [history, setHistory] = useState<MarketHistoryPoint[]>([]);
  const [status, setStatus] = useState<{ source: string; updated: string; state: string; reason?: string | null; seriesType: "ohlcv" | "line" }>({
    source: "unavailable",
    updated: new Date().toISOString(),
    state: "unavailable",
    reason: "history unavailable",
    seriesType: "line",
  });

  useEffect(() => {
    fetchMarketsCatalog()
      .then((res) => setCatalogItem(res.items.find((i) => i.symbol.toUpperCase() === symbol) ?? null))
      .catch(() => setCatalogItem(null));
  }, [symbol]);

  useEffect(() => {
    fetchMarkets([symbol])
      .then((res) => setQuote(res.items.find((item) => item.symbol.toUpperCase() === symbol) ?? null))
      .catch(() => setQuote(null));
  }, [symbol]);

  useEffect(() => {
    fetchMarketHistory(symbol, range, interval)
      .then((res) => {
        setHistory(res.ohlcv ?? []);
        setStatus({
          source: res.source,
          updated: res.updated_at,
          state: res.status,
          reason: res.reason,
          seriesType: res.series_type ?? "line",
        });
      })
      .catch(() => {
        setHistory([]);
        setStatus({
          source: "unavailable",
          updated: new Date().toISOString(),
          state: "unavailable",
          reason: "history request failed",
          seriesType: "line",
        });
      });
  }, [symbol, range, interval]);

  const updatedText = useMemo(() => formatUtc(quote?.updated_at ?? status.updated), [quote?.updated_at, status.updated]);

  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />

      <div className="page-head pt-28">
        <p className="kicker">Asset Detail</p>
        <h1>{catalogItem?.name ?? symbol}</h1>
        <p className="text-sm text-[var(--wl-muted)]">
          {symbol} · {catalogItem?.asset_class ?? "Unknown"} · {catalogItem?.exchange ?? "N/A"} · {catalogItem?.currency ?? "N/A"}
        </p>
        <p className="text-xs text-[var(--wl-muted)] mt-1">
          Source: {quote?.source ?? status.source} · Updated {updatedText} UTC · Status: {quote?.status ?? status.state}
        </p>
      </div>

      <section className={`panel max-w-6xl mx-auto ${status.state !== "live" ? "card-muted" : ""}`}>
        <div className="detail-toolbar">
          <div className="range-row">
            {ranges.map((item) => (
              <button key={item} type="button" className={range === item ? "active" : ""} onClick={() => setRange(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="range-row">
            {["1d", "1h", "15m"].map((item) => (
              <button key={item} type="button" className={interval === item ? "active" : ""} onClick={() => setInterval(item)} disabled={item !== "1d" && status.seriesType === "ohlcv"}>
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="detail-price-row">
          <strong>{quote?.price == null ? "N/A" : quote.price.toLocaleString()}</strong>
          <span className={(quote?.change_pct ?? 0) >= 0 ? "up" : "down"}>{quote?.change_pct == null ? "N/A" : `${quote.change_pct >= 0 ? "+" : ""}${quote.change_pct.toFixed(2)}%`}</span>
        </div>

        <MarketChart points={history} seriesType={status.seriesType} />

        {!history.length ? <p className="state-msg">N/A — {status.reason ?? "missing history from provider"}</p> : null}

        <div className="detail-meta-grid">
          <span>Source: {status.source}</span>
          <span>Status: {status.state}</span>
          <span>Series: {status.seriesType}</span>
          <span>Updated: {updatedText} UTC</span>
        </div>

        <div className="mt-5 flex gap-3">
          <Link href="/markets" className="btn-secondary">Back to Markets</Link>
          <Link href="/portfolio" className="btn-secondary">Add to Portfolio</Link>
        </div>
      </section>
    </main>
  );
}
