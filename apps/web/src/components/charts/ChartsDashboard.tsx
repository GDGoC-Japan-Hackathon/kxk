"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y";

type ChartInstrument = {
  id: string;
  label: string;
  subtitle: string;
  tvSymbol: string;
};

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => unknown;
    };
  }
}

const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "6M", "1Y"];

const TIMEFRAME_TO_INTERVAL: Record<Timeframe, string> = {
  "1D": "15",
  "1W": "60",
  "1M": "D",
  "3M": "D",
  "6M": "D",
  "1Y": "W",
};

const MARKETS: ChartInstrument[] = [
  { id: "sp500", label: "S&P 500", subtitle: "US large cap benchmark", tvSymbol: "SP:SPX" },
  { id: "nasdaq", label: "NASDAQ", subtitle: "US tech composite", tvSymbol: "NASDAQ:IXIC" },
  { id: "nikkei", label: "Nikkei", subtitle: "Japan equities", tvSymbol: "INDEX:NI225" },
  { id: "kospi", label: "KOSPI", subtitle: "Korea equities", tvSymbol: "INDEX:KOSPI" },
  { id: "eurostoxx", label: "EuroStoxx", subtitle: "Euro area blue chips", tvSymbol: "TVC:SX5E" },
  { id: "dax", label: "DAX", subtitle: "Germany large cap", tvSymbol: "XETR:DAX" },
  { id: "ftse", label: "FTSE", subtitle: "UK benchmark", tvSymbol: "TVC:UKX" },
  { id: "crypto", label: "Crypto", subtitle: "Bitcoin / USD", tvSymbol: "BITSTAMP:BTCUSD" },
];

let tradingViewScriptPromise: Promise<void> | null = null;

async function loadTradingViewScript(maxRetries = 3) {
  if (window.TradingView?.widget) return;
  if (tradingViewScriptPromise) return tradingViewScriptPromise;

  tradingViewScriptPromise = new Promise<void>((resolve, reject) => {
    let attempt = 0;

    const inject = () => {
      attempt += 1;

      const existing = document.querySelector<HTMLScriptElement>('script[data-tv-widget="true"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("TradingView script failed to load.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.dataset.tvWidget = "true";
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        if (attempt < maxRetries) {
          window.setTimeout(inject, attempt * 600);
          return;
        }
        tradingViewScriptPromise = null;
        reject(new Error("TradingView script failed to load."));
      };

      document.head.appendChild(script);
    };

    inject();
  });

  return tradingViewScriptPromise;
}

function ChartSkeleton() {
  return (
    <div className="h-[260px] rounded-xl border border-[rgba(88,108,140,0.18)] bg-[rgba(7,14,28,0.82)] p-4">
      <div className="h-full animate-pulse rounded-lg bg-[linear-gradient(135deg,rgba(24,38,63,0.84),rgba(10,19,35,0.92))]" />
    </div>
  );
}

function TradingViewCard({ instrument, timeframe }: { instrument: ChartInstrument; timeframe: Timeframe }) {
  const rawId = useId();
  const containerId = `tv-${rawId.replace(/[:]/g, "")}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    let observer: MutationObserver | null = null;

    const mount = async () => {
      setStatus("loading");

      try {
        await loadTradingViewScript();
        if (cancelled || !containerRef.current || !window.TradingView?.widget) return;

        containerRef.current.innerHTML = "";

        observer = new MutationObserver(() => {
          if (!containerRef.current) return;
          if (containerRef.current.querySelector("iframe")) {
            setStatus("ready");
            if (observer) observer.disconnect();
          }
        });
        observer.observe(containerRef.current, { childList: true, subtree: true });

        new window.TradingView.widget({
          autosize: true,
          container_id: containerId,
          symbol: instrument.tvSymbol,
          interval: TIMEFRAME_TO_INTERVAL[timeframe],
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          enable_publishing: false,
          allow_symbol_change: false,
          hide_top_toolbar: true,
          hide_legend: false,
          save_image: false,
          details: false,
          studies: [],
          withdateranges: false,
          backgroundColor: "#0a1323",
          gridColor: "rgba(148, 163, 184, 0.10)",
          watchlist: [],
          width: "100%",
          height: 260,
        });

        timeoutId = window.setTimeout(() => {
          if (cancelled) return;
          if (!containerRef.current?.querySelector("iframe")) {
            setStatus("error");
          }
        }, 8000);
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void mount();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      observer?.disconnect();
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [containerId, instrument.tvSymbol, timeframe]);

  return (
    <article className="chart-card">
      <header>
        <div>
          <h3>{instrument.label}</h3>
          <p>{instrument.subtitle}</p>
        </div>
        <div className="chart-header-metrics">
          <span className={`chart-status ${status === "ready" ? "chart-status-ok" : status === "loading" ? "chart-status-ok" : "chart-status-warn"}`}>
            {status === "ready" ? "LIVE" : status === "loading" ? "LOADING" : "ERROR"}
          </span>
          <strong className={status === "error" ? "down" : "up"}>{status === "error" ? "Fallback" : timeframe}</strong>
        </div>
      </header>

      {status !== "ready" ? <ChartSkeleton /> : null}
      <div
        ref={containerRef}
        id={containerId}
        className={status === "ready" ? "chart-canvas" : "hidden"}
      />

      {status === "error" ? (
        <p className="chart-note">
          Live widget load failed. Open
          {" "}
          <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(instrument.tvSymbol)}`} target="_blank" rel="noreferrer">
            {instrument.label}
          </a>
          {" "}
          in TradingView.
        </p>
      ) : (
        <p className="chart-note">Source: TradingView · realtime widget embed</p>
      )}
    </article>
  );
}

export function ChartsDashboard() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      setLoading(true);
      setError(null);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetch("/api/markets/catalog", { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`catalog request failed (${response.status})`);
          }
          await response.json();
          if (!cancelled) {
            setCatalogReady(true);
            setLoading(false);
          }
          return;
        } catch (fetchError) {
          if (attempt === 3 && !cancelled) {
            setCatalogReady(false);
            setError(fetchError instanceof Error ? fetchError.message : "Failed to initialize charts.");
            setLoading(false);
          }
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 500));
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(() => MARKETS, []);

  return (
    <section>
      <div className="chart-timeframe-row">
        {TIMEFRAMES.map((value) => (
          <button key={value} type="button" className={value === timeframe ? "active" : ""} onClick={() => setTimeframe(value)}>
            {value}
          </button>
        ))}
      </div>

      <p className="chart-menu-copy">
        S&amp;P 500, NASDAQ, Nikkei, KOSPI, EuroStoxx, DAX, FTSE, and Crypto are rendered with TradingView embeds to bypass the broken history proxy.
      </p>

      {loading ? <p className="state-msg">Initializing chart widgets...</p> : null}
      {error ? <p className="state-msg text-red-300">Catalog probe failed after retry: {error}</p> : null}
      {!loading && !catalogReady ? <p className="state-msg">Charts are using direct widget fallback mode.</p> : null}

      <div className="charts-grid">
        {cards.map((instrument) => (
          <TradingViewCard key={instrument.id} instrument={instrument} timeframe={timeframe} />
        ))}
      </div>
    </section>
  );
}
