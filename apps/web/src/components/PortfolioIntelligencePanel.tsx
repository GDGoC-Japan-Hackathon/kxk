"use client";

import { useMemo } from "react";
import { Holding, ImpactResponse } from "@/types/worldlens";

type PortfolioIntelligencePanelProps = {
  holdings: Holding[];
  onChangeHoldings: (next: Holding[]) => void;
  onApply: () => void;
  applying: boolean;
  selectedEventTitle?: string;
  impact?: ImpactResponse;
  loadingImpact: boolean;
  impactError?: string;
  scenarioRateShock: number;
  scenarioOilShock: number;
  scenarioUsdShock: number;
  onScenarioChange: (next: { rateShock: number; oilShock: number; usdShock: number }) => void;
};

export function PortfolioIntelligencePanel({
  holdings,
  onChangeHoldings,
  onApply,
  applying,
  selectedEventTitle,
  impact,
  loadingImpact,
  impactError,
  scenarioRateShock,
  scenarioOilShock,
  scenarioUsdShock,
  onScenarioChange,
}: PortfolioIntelligencePanelProps) {
  const weightSum = useMemo(() => holdings.reduce((sum, item) => sum + (Number.isFinite(item.weight) ? item.weight : 0), 0), [holdings]);

  const distribution = useMemo(() => {
    if (!impact?.per_asset_contributions.length) return [];
    const values = impact.per_asset_contributions.map((item) => item.signed_impact);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return values.map((value) => (max === min ? 50 : ((value - min) / (max - min)) * 100));
  }, [impact]);

  return (
    <section className="panel h-full">
      <header className="panel-header">
        <h2>Portfolio Intelligence</h2>
        <span>Institutional</span>
      </header>

      <div className="mt-3 space-y-2">
        <div className="grid grid-cols-[1.1fr_0.8fr_auto] gap-2 text-xs uppercase tracking-[0.12em] text-[var(--wl-muted)]">
          <span>Ticker</span>
          <span>Weight</span>
          <span />
        </div>

        {holdings.map((holding, index) => (
          <div key={`${holding.ticker}-${index}`} className="grid grid-cols-[1.1fr_0.8fr_auto] gap-2">
            <input
              className="text-input"
              value={holding.ticker}
              onChange={(event) => {
                const next = holdings.map((item, i) => (i === index ? { ...item, ticker: event.target.value.toUpperCase() } : item));
                onChangeHoldings(next);
              }}
              aria-label={`ticker-${index}`}
            />
            <input
              className="text-input"
              type="number"
              min={0}
              step={0.01}
              value={holding.weight}
              onChange={(event) => {
                const next = holdings.map((item, i) => (i === index ? { ...item, weight: Number(event.target.value) } : item));
                onChangeHoldings(next);
              }}
              aria-label={`weight-${index}`}
            />
            <button type="button" className="btn-secondary" onClick={() => onChangeHoldings(holdings.filter((_, i) => i !== index))}>
              -
            </button>
          </div>
        ))}

        <div className="flex items-center justify-between text-xs text-[var(--wl-muted)]">
          <span>Weight Sum: {weightSum.toFixed(2)}</span>
          <span>{Math.abs(weightSum - 1) < 0.001 ? "Normalized" : "Will normalize on submit"}</span>
        </div>

        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => onChangeHoldings([...holdings, { ticker: "", weight: 0 }])}>
            Add Holding
          </button>
          <button type="button" className="btn-primary" onClick={onApply} disabled={applying}>
            {applying ? "Applying..." : "Apply Portfolio"}
          </button>
        </div>
      </div>

      <div className="scenario-block">
        <h3>Scenario Layer</h3>
        <label>
          <span>Rate Shock</span>
          <input
            type="range"
            min={-0.5}
            max={0.5}
            step={0.05}
            value={scenarioRateShock}
            onChange={(event) =>
              onScenarioChange({ rateShock: Number(event.target.value), oilShock: scenarioOilShock, usdShock: scenarioUsdShock })
            }
          />
          <strong>{scenarioRateShock.toFixed(2)}</strong>
        </label>
        <label>
          <span>Oil Shock</span>
          <input
            type="range"
            min={-0.5}
            max={0.5}
            step={0.05}
            value={scenarioOilShock}
            onChange={(event) =>
              onScenarioChange({ rateShock: scenarioRateShock, oilShock: Number(event.target.value), usdShock: scenarioUsdShock })
            }
          />
          <strong>{scenarioOilShock.toFixed(2)}</strong>
        </label>
        <label>
          <span>USD Shock</span>
          <input
            type="range"
            min={-0.5}
            max={0.5}
            step={0.05}
            value={scenarioUsdShock}
            onChange={(event) =>
              onScenarioChange({ rateShock: scenarioRateShock, oilShock: scenarioOilShock, usdShock: Number(event.target.value) })
            }
          />
          <strong>{scenarioUsdShock.toFixed(2)}</strong>
        </label>
      </div>

      <div className="impact-card">
        <p className="text-xs uppercase tracking-[0.13em] text-[var(--wl-muted)]">Selected Event</p>
        <h3>{selectedEventTitle ?? "No event selected"}</h3>

        {loadingImpact && <p className="state-msg !px-0 !py-3">Recomputing impact...</p>}
        {!loadingImpact && impactError && <p className="state-msg !px-0 !py-3 text-red-300">{impactError}</p>}

        {impact && !loadingImpact && !impactError && (
          <>
            <div className="impact-headline">
              <strong>{impact.impact_score.toFixed(1)}</strong>
              <span>Impact Score (0-100)</span>
              <p className="mt-1 text-xs text-[var(--wl-muted)]">Score reflects portfolio factor exposure dot event shock vector, normalized.</p>
            </div>

            <h4 className="subtle-label mt-3">Factor Exposure</h4>
            <div className="mt-2 space-y-2">
              {Object.entries(impact.portfolio_exposure).map(([factor, value]) => (
                <div key={factor} className="factor-row">
                  <span>{factor}</span>
                  <div className="factor-bar">
                    <div className="factor-fill" style={{ width: `${Math.min(100, Math.abs(value) * 60)}%` }} />
                  </div>
                  <span>{value.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <h4 className="subtle-label mt-3">Top Contributors</h4>
            <table className="impact-table mt-2">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Weight</th>
                  <th>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {impact.top_impacted_holdings.map((row) => (
                  <tr key={row.ticker}>
                    <td>{row.ticker}</td>
                    <td>{row.weight.toFixed(2)}</td>
                    <td className={row.signed_impact >= 0 ? "up" : "down"}>{row.signed_impact.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 className="subtle-label mt-3">Impact Distribution</h4>
            <div className="distribution-mini mt-2">
              {distribution.map((value, index) => (
                <div key={`${value}-${index}`} style={{ height: `${Math.max(10, value)}%` }} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
