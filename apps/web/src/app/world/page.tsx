import { Suspense } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { WorldPageClient } from "@/components/world/WorldPageClient";

export default function WorldPage() {
  return (
    <main className="screen-shell world-page">
      <SiteHeader />
      <MarketStrip />
      <Suspense fallback={null}>
        <WorldPageClient />
      </Suspense>
    </main>
  );
}
