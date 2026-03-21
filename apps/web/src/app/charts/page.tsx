import { ChartsDashboard } from "@/components/charts/ChartsDashboard";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";

export default function ChartsPage() {
  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />
      <div className="page-head pt-28">
        <p className="kicker">Market Charts</p>
        <h1>Cross-Asset Time Series</h1>
        <p className="chart-note mt-2">S&amp;P 500, NASDAQ, Nikkei, KOSPI, EuroStoxx, DAX, FTSE, and Crypto.</p>
      </div>
      <ChartsDashboard />
    </main>
  );
}
