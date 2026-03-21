import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { CountryMap } from "@/components/country/CountryMap";

export default async function CountryPage({ params }: { params: Promise<{ countryCode: string }> }) {
  const { countryCode } = await params;

  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />
      <div className="page-head pt-28">
        <p className="kicker">Country Intelligence</p>
        <h1>{countryCode.toUpperCase()} Monitoring</h1>
      </div>
      <CountryMap countryCode={countryCode.toUpperCase()} />
    </main>
  );
}
