"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useGeoAggregate, useLiveEvents } from "@/lib/hooks";
import { EventFilter } from "@/types/worldlens";
import { WorldNewsMap } from "./WorldNewsMap";

const CesiumWorldGlobe = dynamic(
  () => import("@/components/world/CesiumWorldGlobe").then((mod) => mod.CesiumWorldGlobe),
  { ssr: false },
);

type WorldMode = "map" | "globe";

const worldFilter: EventFilter = {
  category: "all",
  region: "all",
  countryCode: "all",
  minSeverity: 0,
  sinceMinutes: 7 * 24 * 60,
};

function parseMode(value: string | null): WorldMode {
  return value === "globe" ? "globe" : "map";
}

export function WorldPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<WorldMode>(parseMode(searchParams.get("mode")));
  const { events } = useLiveEvents(worldFilter, "news");
  const { countries } = useGeoAggregate(worldFilter.sinceMinutes, "country");

  useEffect(() => {
    const nextMode = parseMode(searchParams.get("mode"));
    setMode((current) => (current === nextMode ? current : nextMode));
  }, [searchParams]);

  const switchMode = (nextMode: WorldMode) => {
    setMode(nextMode);
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", nextMode);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <section className="world-mode-shell">
      <div className="world-mode-head">
        <div>
          <p className="kicker">World</p>
          <h1>{mode === "map" ? "2D News Situation Room" : "3D Air & Maritime Globe"}</h1>
          <p className="world-mode-copy">
            {mode === "map"
              ? "GeoJSON world map with country clusters, linked news panels, and source-first clickthrough."
              : "Operational globe for live air, maritime, and geopolitical monitoring without leaving the World tab."}
          </p>
        </div>

        <div className="world-mode-switch" role="tablist" aria-label="World views">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "map"}
            className={mode === "map" ? "active" : ""}
            onClick={() => switchMode("map")}
          >
            2D News Situation Room
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "globe"}
            className={mode === "globe" ? "active" : ""}
            onClick={() => switchMode("globe")}
          >
            3D Air & Maritime Globe
          </button>
        </div>
      </div>

      <div className="world-page-content">
        {mode === "map" ? (
          <WorldNewsMap
            events={events.slice(0, 500)}
            aggregates={countries}
            sinceMinutes={worldFilter.sinceMinutes}
            className="landing-world-preview"
          />
        ) : (
          <CesiumWorldGlobe />
        )}
      </div>
    </section>
  );
}
