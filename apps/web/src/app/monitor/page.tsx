"use client";

import { useMemo, useState } from "react";
import { CesiumGlobe } from "@/components/globe/CesiumGlobe";
import { LayerPanel, type LayerState, type LayerStatus } from "@/components/panels/LayerPanel";

type GlobeSelection =
  | {
      type: "earthquake";
      title: string;
      subtitle: string;
      detail: string;
      url: string;
    }
  | {
      type: "satellite";
      title: string;
      subtitle: string;
      detail: string;
    }
  | null;

const defaultStatuses: Record<keyof LayerState | "ships" | "weather", LayerStatus> = {
  earthquakes: {
    label: "idle",
    state: "idle",
    detail: "USGS feed pending.",
  },
  satellites: {
    label: "idle",
    state: "idle",
    detail: "CelesTrak feed pending.",
  },
  ships: {
    label: "soon",
    state: "idle",
    detail: "Ships are intentionally left as a placeholder.",
  },
  weather: {
    label: "soon",
    state: "idle",
    detail: "Weather is intentionally left as a placeholder.",
  },
};

export default function MonitorPage() {
  const [layers, setLayers] = useState<LayerState>({
    earthquakes: true,
    satellites: true,
  });
  const [statuses, setStatuses] = useState(defaultStatuses);
  const [selection, setSelection] = useState<GlobeSelection>(null);

  const liveSummary = useMemo(() => {
    const liveCount = [statuses.earthquakes, statuses.satellites].filter((item) => item.state === "live").length;
    return `${liveCount}/2 live feeds`;
  }, [statuses]);

  return (
    <main className="world-monitor-shell">
      <CesiumGlobe
        layers={layers}
        onSelectionChange={setSelection}
        onStatusChange={(key, status) => {
          setStatuses((current) => ({ ...current, [key]: status }));
        }}
      />

      <div className="wm-topbar">
        <div className="wm-brand">
          <span className="wm-brand-mark" />
          <div>
            <p>WORLD MONITOR</p>
            <small>Cesium tactical view</small>
          </div>
        </div>

        <div className="wm-status-chip">
          <strong>STATUS</strong>
          <span>{liveSummary}</span>
        </div>
      </div>

      <div className="wm-overlay-left">
        <LayerPanel
          layers={layers}
          statuses={statuses}
          onToggle={(key) => {
            setLayers((current) => ({ ...current, [key]: !current[key] }));
          }}
        />
      </div>

      <div className="wm-bottom-card">
        {selection ? (
          <div className="wm-info-card">
            <p>{selection.type}</p>
            <strong>{selection.title}</strong>
            <span>{selection.subtitle}</span>
            <small>{selection.detail}</small>
            {"url" in selection ? (
              <a href={selection.url} target="_blank" rel="noreferrer">
                Open source
              </a>
            ) : null}
          </div>
        ) : (
          <div className="wm-info-card muted">
            <p>selection</p>
            <strong>No object selected</strong>
            <span>Click an earthquake or satellite point.</span>
          </div>
        )}
      </div>
    </main>
  );
}
