"use client";

import { useEffect, useState } from "react";

type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y";

type AiAnalysis = {
  marketSummary: string;
  bullishFactors: string[];
  bearishRisks: string[];
  scenarioOutlook: string;
};

export function AiAnalysisPanel() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1W");
  const [data, setData] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (tf: Timeframe) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/intel/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeframe: tf }),
      });
      const payload = (await response.json()) as { analysis?: AiAnalysis; error?: string };
      if (payload.error) {
        setError(payload.error);
        return;
      }
      setData(payload.analysis ?? null);
    } catch {
      setError("Failed to generate AI analysis");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void generate(timeframe);
  }, [timeframe]);

  return (
    <section>
      <div className="chart-timeframe-row">
        {(["1D", "1W", "1M", "3M", "6M", "1Y"] as Timeframe[]).map((value) => (
          <button key={value} type="button" className={value === timeframe ? "active" : ""} onClick={() => setTimeframe(value)}>
            {value}
          </button>
        ))}
        <button type="button" onClick={() => void generate(timeframe)}>
          Refresh
        </button>
      </div>

      {loading ? <p className="state-msg">Generating analysis...</p> : null}
      {error ? <p className="state-msg text-red-300">{error}</p> : null}

      {data ? (
        <div className="ai-grid">
          <article className="panel">
            <h2>Market Summary</h2>
            <p>{data.marketSummary}</p>
          </article>
          <article className="panel">
            <h2>Bullish Factors</h2>
            <ul>
              {data.bullishFactors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="panel">
            <h2>Bearish Risks</h2>
            <ul>
              {data.bearishRisks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="panel">
            <h2>Scenario Outlook</h2>
            <p>{data.scenarioOutlook}</p>
          </article>
        </div>
      ) : null}
    </section>
  );
}
