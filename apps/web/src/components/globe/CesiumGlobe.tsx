"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { fetchEarthquakes, type EarthquakePoint } from "@/lib/layers/earthquakes";
import {
  computeSatellitePositions,
  fetchSatelliteTles,
  type SatellitePoint,
  type SatelliteTle,
} from "@/lib/layers/satellites";

type LayerKey = "earthquakes" | "satellites";

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

type LayerRuntimeStatus = {
  label: string;
  state: "live" | "loading" | "error" | "idle";
  detail: string;
};

type CesiumGlobeProps = {
  layers: Record<LayerKey, boolean>;
  onSelectionChange: (selection: GlobeSelection) => void;
  onStatusChange: (key: LayerKey, status: LayerRuntimeStatus) => void;
};

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;
type CesiumCustomDataSource = import("cesium").CustomDataSource;

type RuntimeConfig = {
  cesiumIonToken?: string;
};

const EARTHQUAKE_REFRESH_MS = 90_000;
const SATELLITE_REFRESH_MS = 180_000;
const SATELLITE_REPOSITION_MS = 15_000;
const SATELLITE_LIMIT = 8;

export function CesiumGlobe({ layers, onSelectionChange, onStatusChange }: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const dataSourcesRef = useRef<{
    earthquakes: CesiumCustomDataSource | null;
    satellites: CesiumCustomDataSource | null;
  }>({
    earthquakes: null,
    satellites: null,
  });
  const satelliteCacheRef = useRef<SatelliteTle[]>([]);
  const selectionHandlerRef = useRef<(() => void) | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const emitSelectionChange = useEffectEvent(onSelectionChange);
  const emitStatusChange = useEffectEvent(onStatusChange);

  useEffect(() => {
    let cancelled = false;

    async function initViewer() {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      emitStatusChange("earthquakes", { label: "loading", state: "loading", detail: "Loading USGS feed." });
      emitStatusChange("satellites", { label: "loading", state: "loading", detail: "Loading CelesTrak TLE set." });

      await waitForRenderableContainer(container);
      (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium";

      const runtimeConfig = await loadRuntimeConfig();
      const Cesium = (await import("cesium")) as CesiumModule;
      if (cancelled || !containerRef.current) {
        return;
      }

      cesiumRef.current = Cesium;
      Cesium.Ion.defaultAccessToken = runtimeConfig.cesiumIonToken ?? process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "";

      const viewer = new Cesium.Viewer(containerRef.current, {
        animation: false,
        baseLayer: new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            credit: "CARTO",
          }),
        ),
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        shadows: false,
      });

      viewerRef.current = viewer;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#02070d");
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.globe.enableLighting = false;
      if (viewer.scene.moon) {
        viewer.scene.moon.show = false;
      }
      if (viewer.scene.skyBox) {
        viewer.scene.skyBox.show = false;
      }
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#02070d");
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = "none";
      viewer.scene.globe.depthTestAgainstTerrain = false;

      const earthquakeSource = new Cesium.CustomDataSource("earthquakes");
      const satelliteSource = new Cesium.CustomDataSource("satellites");
      dataSourcesRef.current = {
        earthquakes: earthquakeSource,
        satellites: satelliteSource,
      };

      viewer.dataSources.add(earthquakeSource);
      viewer.dataSources.add(satelliteSource);

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-20, 18, 22_000_000),
        duration: 0,
      });
      viewer.resize();
      viewer.scene.requestRender();

      resizeObserverRef.current = new ResizeObserver(() => {
        viewer.resize();
        viewer.scene.requestRender();
      });
      resizeObserverRef.current.observe(containerRef.current);

      const updateSelection = () => {
        const entity = viewer.selectedEntity as CesiumEntity | undefined;
        const raw = entity?.properties?.metadata?.getValue(viewer.clock.currentTime) as GlobeSelection | undefined;
        emitSelectionChange(raw ?? null);
      };

      selectionHandlerRef.current = updateSelection;
      viewer.selectedEntityChanged.addEventListener(updateSelection);
    }

    void initViewer();

    return () => {
      cancelled = true;

      if (viewerRef.current && selectionHandlerRef.current) {
        viewerRef.current.selectedEntityChanged.removeEventListener(selectionHandlerRef.current);
      }

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      selectionHandlerRef.current = null;
      satelliteCacheRef.current = [];
      dataSourcesRef.current = { earthquakes: null, satellites: null };
    };
  }, []);

  useEffect(() => {
    const source = dataSourcesRef.current.earthquakes;
    if (source) {
      source.show = layers.earthquakes;
    }
  }, [layers.earthquakes]);

  useEffect(() => {
    const source = dataSourcesRef.current.satellites;
    if (source) {
      source.show = layers.satellites;
    }
  }, [layers.satellites]);

  useEffect(() => {
    let cancelled = false;
    let refreshId: number | undefined;

    const populateEarthquakes = async () => {
      const Cesium = cesiumRef.current;
      const viewer = viewerRef.current;
      const source = dataSourcesRef.current.earthquakes;

      if (!Cesium || !viewer || !source) {
        refreshId = window.setTimeout(populateEarthquakes, 500);
        return;
      }

      if (!layers.earthquakes) {
        source.show = false;
        emitStatusChange("earthquakes", { label: "off", state: "idle", detail: "Earthquake layer disabled." });
        return;
      }

      try {
        emitStatusChange("earthquakes", { label: "loading", state: "loading", detail: "Refreshing USGS earthquake feed." });
        const quakes = await fetchEarthquakes();
        if (cancelled) {
          return;
        }

        source.entities.removeAll();
        quakes.slice(0, 250).forEach((quake) => addEarthquakeEntity(Cesium, source, quake));
        source.show = true;

        emitStatusChange("earthquakes", {
          label: "live",
          state: "live",
          detail: `${quakes.length} earthquakes loaded from USGS.`,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error(error);
        emitStatusChange("earthquakes", {
          label: "error",
          state: "error",
          detail: "USGS feed failed. Globe remains active.",
        });
      }
    };

    void populateEarthquakes();
    const intervalId = window.setInterval(() => {
      void populateEarthquakes();
    }, EARTHQUAKE_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (refreshId) {
        window.clearTimeout(refreshId);
      }
    };
  }, [layers.earthquakes]);

  useEffect(() => {
    let cancelled = false;
    let bootstrapTimer: number | undefined;

    const renderSatellites = () => {
      const Cesium = cesiumRef.current;
      const source = dataSourcesRef.current.satellites;

      if (!Cesium || !source || !satelliteCacheRef.current.length) {
        return;
      }

      const positions = computeSatellitePositions(satelliteCacheRef.current);
      source.entities.removeAll();
      positions.forEach((item) => addSatelliteEntity(Cesium, source, item));
      source.show = layers.satellites;

      if (!cancelled) {
        emitStatusChange("satellites", {
          label: "live",
          state: "live",
          detail: `${positions.length} satellites plotted from live TLE data.`,
        });
      }
    };

    const loadSatellites = async () => {
      const source = dataSourcesRef.current.satellites;
      if (!source) {
        bootstrapTimer = window.setTimeout(loadSatellites, 500);
        return;
      }

      if (!layers.satellites) {
        source.show = false;
        emitStatusChange("satellites", { label: "off", state: "idle", detail: "Satellite layer disabled." });
        return;
      }

      try {
        emitStatusChange("satellites", { label: "loading", state: "loading", detail: "Refreshing CelesTrak TLE set." });
        satelliteCacheRef.current = await fetchSatelliteTles(undefined, SATELLITE_LIMIT);
        if (cancelled) {
          return;
        }

        renderSatellites();
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error(error);
        emitStatusChange("satellites", {
          label: "error",
          state: "error",
          detail: "CelesTrak feed failed. Globe remains active.",
        });
      }
    };

    void loadSatellites();
    const tleIntervalId = window.setInterval(() => {
      void loadSatellites();
    }, SATELLITE_REFRESH_MS);
    const positionIntervalId = window.setInterval(() => {
      if (layers.satellites && satelliteCacheRef.current.length) {
        renderSatellites();
      }
    }, SATELLITE_REPOSITION_MS);

    return () => {
      cancelled = true;
      window.clearInterval(tleIntervalId);
      window.clearInterval(positionIntervalId);
      if (bootstrapTimer) {
        window.clearTimeout(bootstrapTimer);
      }
    };
  }, [layers.satellites]);

  return <div ref={containerRef} className="wm-globe-canvas" />;
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch("/api/runtime-config", { cache: "no-store" });
    if (!response.ok) {
      return {};
    }

    return (await response.json()) as RuntimeConfig;
  } catch {
    return {};
  }
}

async function waitForRenderableContainer(container: HTMLDivElement) {
  if (container.clientWidth > 0 && container.clientHeight > 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      resolve();
    };

    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        finish();
      }
    });

    observer.observe(container);
    window.requestAnimationFrame(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        finish();
        return;
      }

      window.setTimeout(finish, 250);
    });
  });
}

function addEarthquakeEntity(Cesium: CesiumModule, source: CesiumCustomDataSource, quake: EarthquakePoint) {
  source.entities.add({
    id: quake.id,
    position: Cesium.Cartesian3.fromDegrees(quake.longitude, quake.latitude),
    point: {
      color: Cesium.Color.fromCssColorString(quake.color),
      pixelSize: quake.pixelSize,
      outlineColor: Cesium.Color.fromCssColorString("#2a0c0c"),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: quake.magnitude >= 5 ? `M${quake.magnitude.toFixed(1)}` : "",
      font: "12px var(--font-share-tech), monospace",
      fillColor: Cesium.Color.fromCssColorString("#ffd8b0"),
      pixelOffset: new Cesium.Cartesian2(0, -18),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(7, 10, 15, 0.7)"),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      metadata: {
        type: "earthquake",
        title: quake.title,
        subtitle: `${quake.place} · M${quake.magnitude.toFixed(1)}`,
        detail: `${new Date(quake.time).toLocaleString()} · Depth ${quake.depthKm.toFixed(1)} km`,
        url: quake.url,
      },
    },
  });
}

function addSatelliteEntity(Cesium: CesiumModule, source: CesiumCustomDataSource, satellitePoint: SatellitePoint) {
  source.entities.add({
    id: satellitePoint.id,
    position: Cesium.Cartesian3.fromDegrees(
      satellitePoint.longitude,
      satellitePoint.latitude,
      Math.max(satellitePoint.altitudeKm, 0) * 1000,
    ),
    point: {
      color: Cesium.Color.fromCssColorString("#79f7ff"),
      pixelSize: 6,
      outlineColor: Cesium.Color.fromCssColorString("#001418"),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: satellitePoint.name,
      font: "11px var(--font-share-tech), monospace",
      fillColor: Cesium.Color.fromCssColorString("#a8f9ff"),
      pixelOffset: new Cesium.Cartesian2(0, -16),
      style: Cesium.LabelStyle.FILL,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(4, 14, 18, 0.65)"),
      scale: 0.85,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      metadata: {
        type: "satellite",
        title: satellitePoint.name,
        subtitle: `${satellitePoint.latitude.toFixed(2)}°, ${satellitePoint.longitude.toFixed(2)}°`,
        detail: `Altitude ${satellitePoint.altitudeKm.toFixed(0)} km`,
      },
    },
  });
}
