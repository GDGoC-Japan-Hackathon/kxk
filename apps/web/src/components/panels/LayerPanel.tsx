"use client";

type LayerKey = "earthquakes" | "satellites";

export type LayerState = Record<LayerKey, boolean>;

export type LayerStatus = {
  label: string;
  state: "live" | "loading" | "error" | "idle";
  detail: string;
};

type LayerPanelProps = {
  layers: LayerState;
  statuses: Record<LayerKey | "ships" | "weather", LayerStatus>;
  onToggle: (key: LayerKey) => void;
};

function statusClass(state: LayerStatus["state"]) {
  switch (state) {
    case "live":
      return "live";
    case "loading":
      return "loading";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export function LayerPanel({ layers, statuses, onToggle }: LayerPanelProps) {
  return (
    <aside className="wm-panel">
      <div className="wm-panel-head">
        <p>Layers</p>
        <span>Command</span>
      </div>

      <div className="wm-layer-list">
        <button className={`wm-layer-toggle ${layers.earthquakes ? "active" : ""}`} onClick={() => onToggle("earthquakes")} type="button">
          <div>
            <strong>Earthquakes</strong>
            <small>USGS GeoJSON live feed</small>
          </div>
          <span className={`wm-state-pill ${statusClass(statuses.earthquakes.state)}`}>{statuses.earthquakes.label}</span>
        </button>

        <button className={`wm-layer-toggle ${layers.satellites ? "active" : ""}`} onClick={() => onToggle("satellites")} type="button">
          <div>
            <strong>Satellites</strong>
            <small>CelesTrak TLE + satellite.js</small>
          </div>
          <span className={`wm-state-pill ${statusClass(statuses.satellites.state)}`}>{statuses.satellites.label}</span>
        </button>

        <div className="wm-layer-placeholder">
          <div>
            <strong>Ships</strong>
            <small>Reserved for next pass</small>
          </div>
          <span className={`wm-state-pill ${statusClass(statuses.ships.state)}`}>{statuses.ships.label}</span>
        </div>

        <div className="wm-layer-placeholder">
          <div>
            <strong>Weather</strong>
            <small>Reserved for next pass</small>
          </div>
          <span className={`wm-state-pill ${statusClass(statuses.weather.state)}`}>{statuses.weather.label}</span>
        </div>
      </div>

      <div className="wm-panel-section">
        <p className="wm-panel-label">Status</p>
        <ul className="wm-status-list">
          <li>{statuses.earthquakes.detail}</li>
          <li>{statuses.satellites.detail}</li>
          <li>{statuses.ships.detail}</li>
          <li>{statuses.weather.detail}</li>
        </ul>
      </div>
    </aside>
  );
}
