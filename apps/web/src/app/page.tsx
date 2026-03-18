"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { WorldNewsMap } from "@/components/world/WorldNewsMap";
import { useGeoAggregate, useLiveEvents } from "@/lib/hooks";
import { EventFilter } from "@/types/worldlens";

const landingFilter: EventFilter = {
  category: "all",
  region: "all",
  countryCode: "all",
  minSeverity: 0,
  sinceMinutes: 7 * 24 * 60,
};

export default function HomePage() {
  const { events } = useLiveEvents(landingFilter, "news");
  const { countries } = useGeoAggregate(landingFilter.sinceMinutes, "country");
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const updateScrollProgress = () => {
      const viewportHeight = Math.max(window.innerHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / viewportHeight, 0), 1);
      setScrollProgress(progress);
    };

    updateScrollProgress();
    window.addEventListener("scroll", updateScrollProgress, { passive: true });
    window.addEventListener("resize", updateScrollProgress);

    return () => {
      window.removeEventListener("scroll", updateScrollProgress);
      window.removeEventListener("resize", updateScrollProgress);
    };
  }, []);

  return (
    <main className="landing-v1" style={{ ["--landing-progress" as string]: scrollProgress.toFixed(3) }}>
      <SiteHeader />
      <MarketStrip />

      <section className="landing-hero premium-hero">
        <HeroBackdrop />
        <div className="landing-hero-copy reveal-block">
          <div className="landing-hero-panel">
            <p className="kicker">WorldLens</p>
            <h1>See the World. Know Your Risk.</h1>
            <p>Real-time macro events mapped to your portfolio&apos;s factor risk.</p>
            <p>Trusted sources, transparent provenance, and institutional-grade scenario context.</p>

            <div className="landing-hero-metrics" aria-hidden="true">
              <span>Macro Grid Live</span>
              <span>Signal Mesh Active</span>
              <span>Portfolio Context Online</span>
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/world?mode=map" className="btn-primary">Open 2D Situation Room</Link>
              <Link href="/world?mode=globe" className="btn-secondary">Open 3D Globe</Link>
            </div>
          </div>
        </div>
        <div className="landing-scroll-cue" aria-hidden="true">
          <span />
          <small>Scroll into the live map</small>
        </div>
      </section>

      <section className="landing-map-section">
        <div className="landing-map-wrap reveal-block">
          <WorldNewsMap
            events={events.slice(0, 500)}
            aggregates={countries}
            sinceMinutes={landingFilter.sinceMinutes}
            className="landing-world-preview"
          />
        </div>
      </section>
    </main>
  );
}
