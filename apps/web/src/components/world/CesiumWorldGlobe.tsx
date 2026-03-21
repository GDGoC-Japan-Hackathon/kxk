"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

type LayerKey = "flights" | "ships" | "satellites" | "military" | "news";
type RuntimeStatus = "ONLINE" | "LOADING" | "ERROR" | "DISABLED";

type AircraftState = {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number;
  velocity: number;
  heading: number;
  category: string;
  isMilitary: boolean;
  source: string;
};

type ShipState = {
  id: string;
  name: string;
  mmsi: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  vesselType: string;
  source: string;
};

type SatelliteState = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  type: string;
  source: string;
};

type NewsItem = {
  title: string;
  description: string;
  url: string;
  image: string | null;
  source: string;
  publishedAt: string;
  country: string;
  countryCode: string;
  continent: string;
  category: "politics" | "economy" | "technology" | "energy" | "security" | "crypto";
};

type CountryCentroid = Record<string, { lat: number; lon: number }>;

type NewsCluster = {
  key: string;
  lat: number;
  lon: number;
  count: number;
  headlines: NewsItem[];
};

type MotionState = {
  lat: number;
  lon: number;
  altitude: number;
  speed: number;
  heading: number;
  observedAt: number;
};

type FeedResponse<T> = {
  items?: T[];
  source?: string;
  status?: "online" | "error" | "disabled";
  updatedAt?: string;
  error?: string;
  diagnostics?: string[];
};

type FeedStatus = {
  state: RuntimeStatus;
  detail: string;
  source: string;
  updatedAt: string | null;
  diagnostics: string[];
};

type Selection =
  | {
      kind: "flight";
      title: string;
      subtitle: string;
      rows: Array<[string, string]>;
    }
  | {
      kind: "ship";
      title: string;
      subtitle: string;
      rows: Array<[string, string]>;
    }
  | {
      kind: "satellite";
      title: string;
      subtitle: string;
      rows: Array<[string, string]>;
    }
  | {
      kind: "news";
      title: string;
      subtitle: string;
      headlines: NewsItem[];
      rows: Array<[string, string]>;
    }
  | null;

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumCustomDataSource = import("cesium").CustomDataSource;
type CesiumEntity = import("cesium").Entity;
type CesiumGeoJsonDataSource = import("cesium").GeoJsonDataSource;

const POLL_FLIGHTS_MS = 15_000;
const POLL_SHIPS_MS = 35_000;
const POLL_SATELLITES_MS = 120_000;
const POLL_NEWS_MS = 180_000;
const MAX_CIVILIAN_FLIGHTS = 1800;
const MAX_MILITARY_FLIGHTS = 700;
const MAX_SHIPS = 900;
const MAX_SATELLITES = 80;

const STATUS_DEFAULT: FeedStatus = {
  state: "LOADING",
  detail: "Initializing feed.",
  source: "pending",
  updatedAt: null,
  diagnostics: [],
};

type RuntimeConfig = {
  apiBaseUrl?: string;
  cesiumIonToken?: string;
};

type CountsState = {
  flights: number;
  military: number;
  ships: number;
  satellites: number;
};

type GlobeDebugState = {
  container: string;
  viewer: string;
  imagery: string;
  overlay: string;
  centroids: string;
};

type SourceMap = Record<"flights" | "military" | "ships" | "satellites" | "news", CesiumCustomDataSource | null>;
type EntityRegistry = {
  flights: Map<string, CesiumEntity>;
  military: Map<string, CesiumEntity>;
  ships: Map<string, CesiumEntity>;
  satellites: Map<string, CesiumEntity>;
  news: Map<string, CesiumEntity>;
};

export function CesiumWorldGlobe() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const countryOverlayRef = useRef<CesiumGeoJsonDataSource | null>(null);
  const selectionHandlerRef = useRef<(() => void) | null>(null);
  const occlusionHandlerRef = useRef<(() => void) | null>(null);
  const centroidsRef = useRef<CountryCentroid>({});
  const layersRef = useRef<Record<LayerKey, boolean>>({
    flights: true,
    ships: true,
    satellites: true,
    military: true,
    news: true,
  });
  const feedLocksRef = useRef({
    flights: false,
    ships: false,
    satellites: false,
    news: false,
  });
  const sourcesRef = useRef<SourceMap>({
    flights: null,
    military: null,
    ships: null,
    satellites: null,
    news: null,
  });
  const entitiesRef = useRef<EntityRegistry>({
    flights: new Map<string, CesiumEntity>(),
    military: new Map<string, CesiumEntity>(),
    ships: new Map<string, CesiumEntity>(),
    satellites: new Map<string, CesiumEntity>(),
    news: new Map<string, CesiumEntity>(),
  });

  const [bootError, setBootError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  const [debugState, setDebugState] = useState<GlobeDebugState>({
    container: "Waiting for stage sizing.",
    viewer: "Viewer not initialized.",
    imagery: "Imagery not initialized.",
    overlay: "Boundary overlay not initialized.",
    centroids: "Country centroid data not initialized.",
  });
  const [counts, setCounts] = useState<CountsState>({
    flights: 0,
    military: 0,
    ships: 0,
    satellites: 0,
  });
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    flights: true,
    ships: true,
    satellites: true,
    military: true,
    news: true,
  });
  const [statuses, setStatuses] = useState<Record<LayerKey, FeedStatus>>({
    flights: STATUS_DEFAULT,
    ships: STATUS_DEFAULT,
    satellites: STATUS_DEFAULT,
    military: { ...STATUS_DEFAULT, detail: "Mirrors the flight feed." },
    news: STATUS_DEFAULT,
  });

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    let cancelled = false;

    async function initViewer() {
      const container = containerRef.current;
      if (!container) return;

      try {
        await waitForRenderableContainer(container);
        if (!container.clientWidth || !container.clientHeight) {
          throw new Error("Cesium container has zero size after layout.");
        }
        setDebugState((current) => ({
          ...current,
          container: `Stage ready at ${container.clientWidth}x${container.clientHeight}.`,
          viewer: "Initializing Cesium viewer.",
        }));
        (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium";

        const runtimeConfig = await loadRuntimeConfig();
        const Cesium = await loadCesiumGlobal();
        if (cancelled || !containerRef.current) return;

        cesiumRef.current = Cesium;
        Cesium.Ion.defaultAccessToken = runtimeConfig.cesiumIonToken ?? process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "";

        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          requestRenderMode: false,
          sceneModePicker: false,
          scene3DOnly: true,
          selectionIndicator: false,
          shouldAnimate: false,
          timeline: false,
        });

        viewerRef.current = viewer;
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#02060d");
        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.scene.globe.showGroundAtmosphere = true;
        viewer.scene.globe.enableLighting = true;
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#01040a");
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
        viewer.scene.fog.enabled = true;
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
        if (viewer.scene.moon) viewer.scene.moon.show = false;
        viewer.scene.globe.show = true;
        viewer.scene.globe.tileCacheSize = 300;
        (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = "none";
        setDebugState((current) => ({
          ...current,
          viewer: "Cesium viewer online.",
          imagery: "Configuring globe imagery.",
        }));

        try {
          const terrainProvider = await Cesium.createWorldTerrainAsync();
          viewer.terrainProvider = terrainProvider;
        } catch {
          // Keep ellipsoid if terrain cannot be loaded.
        }

        const imageryResult = configureBaseImagery(Cesium, viewer);
        setDebugState((current) => ({
          ...current,
          imagery: imageryResult,
          overlay: "Loading country boundary overlay.",
        }));
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(-15, 22, 22_000_000),
        });
        viewer.resize();
        viewer.scene.requestRender();

        if (!cancelled) {
          setReady(true);
        }

        const feeds = {
          flights: new Cesium.CustomDataSource("flights"),
          military: new Cesium.CustomDataSource("military"),
          ships: new Cesium.CustomDataSource("ships"),
          satellites: new Cesium.CustomDataSource("satellites"),
          news: new Cesium.CustomDataSource("news"),
        };

        for (const source of Object.values(feeds)) {
          await viewer.dataSources.add(source);
        }
        sourcesRef.current = feeds;

        try {
          const countryOverlay = await Cesium.GeoJsonDataSource.load("/geo/world-countries.geojson", {
            stroke: Cesium.Color.fromCssColorString("#9ecaff").withAlpha(0.72),
            fill: Cesium.Color.fromCssColorString("#0a1320").withAlpha(0.01),
            strokeWidth: 1.3,
            clampToGround: false,
          });
          countryOverlay.show = true;
          countryOverlay.entities.values.forEach((entity) => {
            if (entity.polygon) {
              entity.polygon.material = new Cesium.ColorMaterialProperty(
                Cesium.Color.fromCssColorString("#0a1320").withAlpha(0.01),
              );
              entity.polygon.outline = new Cesium.ConstantProperty(false);
              entity.polygon.height = new Cesium.ConstantProperty(0);
            }
            if (entity.polyline) {
              entity.polyline.width = new Cesium.ConstantProperty(1.3);
              entity.polyline.material = new Cesium.ColorMaterialProperty(
                Cesium.Color.fromCssColorString("#b8ddff").withAlpha(0.8),
              );
              entity.polyline.clampToGround = new Cesium.ConstantProperty(false);
            }
          });
          countryOverlayRef.current = countryOverlay;
          await viewer.dataSources.add(countryOverlay);
          setDebugState((current) => ({
            ...current,
            overlay: `Country overlay online: ${countryOverlay.entities.values.length.toLocaleString()} features.`,
            centroids: "Loading centroid news anchors.",
          }));
        } catch (error) {
          setDebugState((current) => ({
            ...current,
            overlay: `Country overlay failed: ${error instanceof Error ? error.message : "unknown error"}`,
            centroids: "Loading centroid news anchors.",
          }));
        }

        try {
          const countryResponse = await fetch("/geo/country_centroids.json", { cache: "force-cache" });
          if (!countryResponse.ok) {
            throw new Error(`Centroid fetch failed with ${countryResponse.status}`);
          }
          const countries = (await countryResponse.json()) as Array<{
            country_code: string;
            lat: number;
            lon: number;
          }>;
          const map: CountryCentroid = {};
          countries.forEach((item) => {
            map[item.country_code] = { lat: item.lat, lon: item.lon };
          });
          centroidsRef.current = map;
          setDebugState((current) => ({
            ...current,
            centroids: `Centroid anchors online: ${countries.length.toLocaleString()} countries.`,
          }));
        } catch (error) {
          setDebugState((current) => ({
            ...current,
            centroids: `Centroid anchors failed: ${error instanceof Error ? error.message : "unknown error"}`,
          }));
        }

        const updateSelection = () => {
          const currentViewer = viewerRef.current;
          if (!currentViewer) {
            setSelected(null);
            return;
          }
          const entity = currentViewer?.selectedEntity as CesiumEntity | undefined;
          const metadata = entity?.properties?.metadata?.getValue(currentViewer.clock.currentTime) as Selection | undefined;
          setSelected(metadata ?? null);
        };

        selectionHandlerRef.current = updateSelection;
        viewer.selectedEntityChanged.addEventListener(updateSelection);
        const syncOcclusion = () => {
          syncEntityOcclusion(viewer, Cesium, entitiesRef.current, layersRef.current);
        };
        occlusionHandlerRef.current = syncOcclusion;
        viewer.scene.postRender.addEventListener(syncOcclusion);

        resizeObserverRef.current = new ResizeObserver(() => {
          viewer.resize();
          viewer.scene.requestRender();
        });
        resizeObserverRef.current.observe(containerRef.current);
        viewer.scene.requestRender();
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : "Failed to initialize the Cesium world view.");
        }
      }
    }

    void initViewer();

    return () => {
      cancelled = true;
      if (viewerRef.current && selectionHandlerRef.current) {
        viewerRef.current.selectedEntityChanged.removeEventListener(selectionHandlerRef.current);
      }
      if (viewerRef.current && occlusionHandlerRef.current) {
        viewerRef.current.scene.postRender.removeEventListener(occlusionHandlerRef.current);
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      countryOverlayRef.current = null;
      selectionHandlerRef.current = null;
      occlusionHandlerRef.current = null;
      entitiesRef.current = {
        flights: new Map<string, CesiumEntity>(),
        military: new Map<string, CesiumEntity>(),
        ships: new Map<string, CesiumEntity>(),
        satellites: new Map<string, CesiumEntity>(),
        news: new Map<string, CesiumEntity>(),
      };
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const syncVisibility = (key: keyof SourceMap, visible: boolean) => {
      const source = sourcesRef.current[key];
      if (source) source.show = visible;
    };

    syncVisibility("flights", layers.flights);
    syncVisibility("military", layers.military);
    syncVisibility("ships", layers.ships);
    syncVisibility("satellites", layers.satellites);
    syncVisibility("news", layers.news);
    if (countryOverlayRef.current) countryOverlayRef.current.show = true;

    syncEntityOcclusion(viewer, cesiumRef.current, entitiesRef.current, layersRef.current);
    viewer.scene.requestRender();
  }, [layers]);

  const loadFlights = useEffectEvent(async () => {
    if (!ready || feedLocksRef.current.flights) return;
    feedLocksRef.current.flights = true;

    setStatuses((current) => ({
      ...current,
      flights: { ...current.flights, state: "LOADING", detail: "Refreshing aircraft tracks." },
      military: { ...current.military, state: "LOADING", detail: "Refreshing military aircraft tracks." },
    }));

    try {
      const response = await fetch("/api/intel/flights", { cache: "no-store" });
      const payload = (await response.json()) as FeedResponse<AircraftState>;
      const items = sanitizeFlights(payload.items ?? []);
      const civilian = thinByGrid(items.filter((item) => !item.isMilitary), 1.1, MAX_CIVILIAN_FLIGHTS);
      const military = thinByGrid(items.filter((item) => item.isMilitary), 1.8, MAX_MILITARY_FLIGHTS);

      reconcileEntities({
        Cesium: cesiumRef.current,
        source: sourcesRef.current.flights,
        registry: entitiesRef.current.flights,
        items: civilian,
        getId: (item) => item.id,
        updateEntity: (entity, item, Cesium) => applyFlightEntity(entity, item, Cesium, false),
        createEntity: (item, Cesium) => createFlightEntity(item, Cesium, false),
      });

      reconcileEntities({
        Cesium: cesiumRef.current,
        source: sourcesRef.current.military,
        registry: entitiesRef.current.military,
        items: military,
        getId: (item) => item.id,
        updateEntity: (entity, item, Cesium) => applyFlightEntity(entity, item, Cesium, true),
        createEntity: (item, Cesium) => createFlightEntity(item, Cesium, true),
      });

      setCounts((current) => ({
        ...current,
        flights: civilian.length,
        military: military.length,
      }));

      const nextStatus: FeedStatus = {
        state: payload.status === "disabled" ? "DISABLED" : items.length ? "ONLINE" : "ERROR",
        detail:
          payload.status === "disabled"
            ? payload.error ?? "Flight feed disabled."
            : items.length
              ? `${civilian.length.toLocaleString()} aircraft plotted.`
              : payload.error ?? "Flight feed returned zero aircraft. Globe rendering remains online.",
        source: payload.source ?? "unknown",
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
        diagnostics: payload.diagnostics ?? [],
      };

      setStatuses((current) => ({
        ...current,
        flights: nextStatus,
        military: {
          ...nextStatus,
          detail:
            payload.status === "disabled"
              ? payload.error ?? "Military overlay disabled."
              : `${military.length.toLocaleString()} military aircraft tagged.`,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Flight feed failed.";
      setStatuses((current) => ({
        ...current,
        flights: { ...current.flights, state: "ERROR", detail: message },
        military: { ...current.military, state: "ERROR", detail: message },
      }));
    } finally {
      feedLocksRef.current.flights = false;
      viewerRef.current?.scene.requestRender();
    }
  });

  const loadShips = useEffectEvent(async () => {
    if (!ready || feedLocksRef.current.ships) return;
    feedLocksRef.current.ships = true;

    setStatuses((current) => ({
      ...current,
      ships: { ...current.ships, state: "LOADING", detail: "Refreshing ship tracks." },
    }));

    try {
      const response = await fetch("/api/intel/ships", { cache: "no-store" });
      const payload = (await response.json()) as FeedResponse<ShipState>;
      const items = thinByGrid(sanitizeShips(payload.items ?? []), 1.2, MAX_SHIPS);

      reconcileEntities({
        Cesium: cesiumRef.current,
        source: sourcesRef.current.ships,
        registry: entitiesRef.current.ships,
        items,
        getId: (item) => item.id,
        updateEntity: (entity, item, Cesium) => applyShipEntity(entity, item, Cesium),
        createEntity: (item, Cesium) => createShipEntity(item, Cesium),
      });

      setCounts((current) => ({ ...current, ships: items.length }));
      setStatuses((current) => ({
        ...current,
        ships: {
          state: payload.status === "disabled" ? "DISABLED" : items.length ? "ONLINE" : "ERROR",
          detail:
            payload.status === "disabled"
              ? payload.error ?? "Ships disabled."
              : items.length
                ? `${items.length.toLocaleString()} ships plotted.`
                : payload.error ?? "Ship feed returned zero tracks. Globe rendering remains online.",
          source: payload.source ?? "unknown",
          updatedAt: payload.updatedAt ?? new Date().toISOString(),
          diagnostics: payload.diagnostics ?? [],
        },
      }));
    } catch (error) {
      setStatuses((current) => ({
        ...current,
        ships: {
          ...current.ships,
          state: "ERROR",
          detail: error instanceof Error ? error.message : "Ship feed failed.",
        },
      }));
    } finally {
      feedLocksRef.current.ships = false;
      viewerRef.current?.scene.requestRender();
    }
  });

  const loadSatellites = useEffectEvent(async () => {
    if (!ready || feedLocksRef.current.satellites) return;
    feedLocksRef.current.satellites = true;

    setStatuses((current) => ({
      ...current,
      satellites: { ...current.satellites, state: "LOADING", detail: "Refreshing orbital tracks." },
    }));

    try {
      const response = await fetch("/api/intel/satellites", { cache: "no-store" });
      const payload = (await response.json()) as FeedResponse<SatelliteState>;
      const items = sanitizeSatellites(payload.items ?? []).slice(0, MAX_SATELLITES);

      reconcileEntities({
        Cesium: cesiumRef.current,
        source: sourcesRef.current.satellites,
        registry: entitiesRef.current.satellites,
        items,
        getId: (item) => item.id,
        updateEntity: (entity, item, Cesium) => applySatelliteEntity(entity, item, Cesium),
        createEntity: (item, Cesium) => createSatelliteEntity(item, Cesium),
      });

      setCounts((current) => ({ ...current, satellites: items.length }));
      setStatuses((current) => ({
        ...current,
        satellites: {
          state: payload.status === "disabled" ? "DISABLED" : items.length ? "ONLINE" : "ERROR",
          detail: items.length
            ? `${items.length.toLocaleString()} satellites plotted.`
            : payload.error ?? "Satellite feed returned zero objects. Globe rendering remains online.",
          source: payload.source ?? "unknown",
          updatedAt: payload.updatedAt ?? new Date().toISOString(),
          diagnostics: payload.diagnostics ?? [],
        },
      }));
    } catch (error) {
      setStatuses((current) => ({
        ...current,
        satellites: {
          ...current.satellites,
          state: "ERROR",
          detail: error instanceof Error ? error.message : "Satellite feed failed.",
        },
      }));
    } finally {
      feedLocksRef.current.satellites = false;
      viewerRef.current?.scene.requestRender();
    }
  });

  const loadNews = useEffectEvent(async () => {
    if (!ready || feedLocksRef.current.news) return;
    feedLocksRef.current.news = true;

    setStatuses((current) => ({
      ...current,
      news: { ...current.news, state: "LOADING", detail: "Refreshing intelligence headlines." },
    }));

    try {
      const response = await fetch("/api/intel/news?limit=800", { cache: "no-store" });
      const payload = (await response.json()) as { items?: NewsItem[] };
      const items = payload.items ?? [];
      const clusters = clusterNews(items, centroidsRef.current);

      reconcileEntities({
        Cesium: cesiumRef.current,
        source: sourcesRef.current.news,
        registry: entitiesRef.current.news,
        items: clusters,
        getId: (item) => item.key,
        updateEntity: (entity, item, Cesium) => applyNewsEntity(entity, item, Cesium),
        createEntity: (item, Cesium) => createNewsEntity(item, Cesium),
      });

      setStatuses((current) => ({
        ...current,
        news: {
          state: clusters.length ? "ONLINE" : "ERROR",
          detail: clusters.length
            ? `${clusters.length.toLocaleString()} news clusters active.`
            : "News layer returned zero clusters. Globe rendering remains online.",
          source: "WorldLens news",
          updatedAt: new Date().toISOString(),
          diagnostics: [clusters.length ? "news layer online" : "news layer empty"],
        },
      }));
    } catch (error) {
      setStatuses((current) => ({
        ...current,
        news: {
          ...current.news,
          state: "ERROR",
          detail: error instanceof Error ? error.message : "News feed failed.",
        },
      }));
    } finally {
      feedLocksRef.current.news = false;
      viewerRef.current?.scene.requestRender();
    }
  });

  useEffect(() => {
    if (!ready) return;
    void loadFlights();
    const id = window.setInterval(() => {
      void loadFlights();
    }, POLL_FLIGHTS_MS);
    return () => window.clearInterval(id);
  }, [ready, loadFlights]);

  useEffect(() => {
    if (!ready) return;
    void loadShips();
    const id = window.setInterval(() => {
      void loadShips();
    }, POLL_SHIPS_MS);
    return () => window.clearInterval(id);
  }, [ready, loadShips]);

  useEffect(() => {
    if (!ready) return;
    void loadSatellites();
    const id = window.setInterval(() => {
      void loadSatellites();
    }, POLL_SATELLITES_MS);
    return () => window.clearInterval(id);
  }, [ready, loadSatellites]);

  useEffect(() => {
    if (!ready) return;
    void loadNews();
    const id = window.setInterval(() => {
      void loadNews();
    }, POLL_NEWS_MS);
    return () => window.clearInterval(id);
  }, [ready, loadNews]);

  const diagnosticLines = useMemo(
    () =>
      [
        `Container: ${debugState.container}`,
        `Viewer: ${debugState.viewer}`,
        `Imagery: ${debugState.imagery}`,
        `Overlay: ${debugState.overlay}`,
        `Centroids: ${debugState.centroids}`,
        ...(Object.entries(statuses) as Array<[LayerKey, FeedStatus]>).flatMap(([key, value]) =>
          (value.diagnostics.length ? value.diagnostics : [value.detail]).slice(0, 2).map((line) => `${labelForLayer(key)}: ${line}`),
        ),
      ],
    [debugState, statuses],
  );

  return (
    <section className="world-ops-shell">
      <div className="world-ops-stage">
        <div className="world-ops-backdrop" />
        <div ref={containerRef} className="world-ops-canvas" />
        {!ready && !bootError ? (
          <div className="world-ops-loading">
            <div className="world-ops-loading-card">
              <strong>Loading tactical globe...</strong>
              <span>{debugState.viewer}</span>
              <span>{debugState.imagery}</span>
            </div>
          </div>
        ) : null}
        {bootError ? (
          <div className="world-ops-loading world-ops-error-overlay">
            <div className="world-ops-loading-card">
              <strong>Cesium initialization failed</strong>
              <span>{bootError}</span>
              <span>{debugState.container}</span>
            </div>
          </div>
        ) : null}
      </div>

      <aside className="world-ops-panel world-ops-left">
        <div className="world-ops-panel-head">
          <p>World Monitor</p>
          <span>Operational</span>
        </div>

        <div className="world-ops-summary">
          <div>
            <span>Flights</span>
            <strong>{counts.flights.toLocaleString()}</strong>
          </div>
          <div>
            <span>Military</span>
            <strong>{counts.military.toLocaleString()}</strong>
          </div>
          <div>
            <span>Ships</span>
            <strong>{counts.ships.toLocaleString()}</strong>
          </div>
          <div>
            <span>Satellites</span>
            <strong>{counts.satellites.toLocaleString()}</strong>
          </div>
        </div>

        <div className="world-ops-layer-list">
          {(["flights", "ships", "satellites", "military", "news"] as LayerKey[]).map((key) => (
            <button
              key={key}
              className={`world-ops-layer ${layers[key] ? "active" : ""}`}
              onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
              type="button"
            >
              <div>
                <strong>{labelForLayer(key)}</strong>
                <small>{statuses[key].detail}</small>
              </div>
              <span className={`world-ops-badge ${statusClass(statuses[key].state)}`}>{statuses[key].state}</span>
            </button>
          ))}
        </div>

        <div className="world-ops-legend">
          <p>Legend</p>
          <ul>
            <li><span className="legend-dot civilian" /> Civilian flights</li>
            <li><span className="legend-dot military" /> Military aircraft</li>
            <li><span className="legend-dot ship" /> Ships</li>
            <li><span className="legend-dot satellite" /> Satellites</li>
            <li><span className="legend-dot news" /> News clusters</li>
          </ul>
        </div>
      </aside>

      <aside className="world-ops-panel world-ops-right">
        <div className="world-ops-panel-head">
          <p>Intelligence</p>
          <span>Selected track</span>
        </div>

        {selected ? (
          <div className="world-ops-selection">
            <p className="world-ops-selection-kind">{selected.kind}</p>
            <h2>{selected.title}</h2>
            <span>{selected.subtitle}</span>
            <div className="world-ops-data-grid">
              {selected.rows.map(([label, value]) => (
                <div key={`${selected.title}-${label}`}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {"headlines" in selected ? (
              <ul className="world-ops-headlines">
                {selected.headlines.map((item) => (
                  <li key={`${item.url}-${item.publishedAt}`}>
                    <strong>{item.title}</strong>
                    <span>{item.source}</span>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Open source
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="world-ops-empty">
            <p>No object selected.</p>
            <span>Click a flight, ship, satellite, or news cluster.</span>
          </div>
        )}

        <div className="world-ops-diagnostics">
          <p>Diagnostics</p>
          <ul>
            {diagnosticLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="world-ops-feed-table">
          {(Object.entries(statuses) as Array<[LayerKey, FeedStatus]>).map(([key, status]) => (
            <div key={key} className="world-ops-feed-row">
              <div>
                <strong>{labelForLayer(key)}</strong>
                <span>{status.source}</span>
              </div>
              <div>
                <em className={`world-ops-badge ${statusClass(status.state)}`}>{status.state}</em>
                <small>{status.updatedAt ? new Date(status.updatedAt).toLocaleTimeString() : "pending"}</small>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}

type ReconcileArgs<T> = {
  Cesium: CesiumModule | null;
  source: CesiumCustomDataSource | null;
  registry: Map<string, CesiumEntity>;
  items: T[];
  getId: (item: T) => string;
  createEntity: (item: T, Cesium: CesiumModule) => CesiumEntity;
  updateEntity: (entity: CesiumEntity, item: T, Cesium: CesiumModule) => void;
};

function reconcileEntities<T>({
  Cesium,
  source,
  registry,
  items,
  getId,
  createEntity,
  updateEntity,
}: ReconcileArgs<T>) {
  if (!Cesium || !source) return;

  const seen = new Set<string>();

  for (const item of items) {
    const id = getId(item);
    seen.add(id);
    const existing = registry.get(id);

    if (existing) {
      updateEntity(existing, item, Cesium);
      continue;
    }

    const entity = createEntity(item, Cesium);
    source.entities.add(entity);
    registry.set(id, entity);
  }

  for (const [id, entity] of registry.entries()) {
    if (seen.has(id)) continue;
    source.entities.remove(entity);
    registry.delete(id);
  }
}

function syncEntityOcclusion(
  viewer: CesiumViewer,
  Cesium: CesiumModule | null,
  registry: EntityRegistry,
  layers: Record<LayerKey, boolean>,
) {
  if (!Cesium) return;
  const ellipsoid = Cesium.Ellipsoid.WGS84;
  const cameraNormal = Cesium.Cartesian3.normalize(viewer.camera.positionWC, new Cesium.Cartesian3());
  const currentTime = viewer.clock.currentTime;
  const groups: Array<[LayerKey, Map<string, CesiumEntity>]> = [
    ["flights", registry.flights],
    ["military", registry.military],
    ["ships", registry.ships],
    ["satellites", registry.satellites],
    ["news", registry.news],
  ];

  for (const [layer, entities] of groups) {
    const layerVisible = layers[layer];
    for (const entity of entities.values()) {
      if (!layerVisible) {
        entity.show = false;
        continue;
      }
      const position = entity.position?.getValue(currentTime);
      if (!position) {
        entity.show = false;
        continue;
      }
      const surface = ellipsoid.scaleToGeodeticSurface(position, new Cesium.Cartesian3()) ?? position;
      const surfaceNormal = ellipsoid.geodeticSurfaceNormal(surface, new Cesium.Cartesian3());
      const hemisphereDot = Cesium.Cartesian3.dot(cameraNormal, surfaceNormal);
      entity.show = hemisphereDot > 0.08;
    }
  }
}

function createFlightEntity(flight: AircraftState, Cesium: CesiumModule, military: boolean) {
  const entity = new Cesium.Entity({ id: `${military ? "military" : "flight"}-${flight.id}` });
  applyFlightEntity(entity, flight, Cesium, military);
  return entity;
}

function applyFlightEntity(entity: CesiumEntity, flight: AircraftState, Cesium: CesiumModule, military: boolean) {
  const motion: MotionState = {
    lat: flight.lat,
    lon: flight.lon,
    altitude: visualAltitudeForFlight(flight.altitude, military),
    speed: Math.max(0, flight.velocity),
    heading: flight.heading,
    observedAt: Date.now(),
  };
  entity.position = createMotionProperty(Cesium, motion, "flight");
  entity.billboard = new Cesium.BillboardGraphics({
    image: aircraftIcon(military),
    rotation: Cesium.Math.toRadians(flight.heading),
    scale: military ? 0.84 : 0.7,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  entity.polyline = new Cesium.PolylineGraphics({
    positions: createTrailProperty(Cesium, motion, "flight"),
    width: military ? 2.2 : 1.8,
    material: Cesium.Color.fromCssColorString(military ? "#ffb36b" : "#84e8ff").withAlpha(0.75),
    clampToGround: false,
  });
  entity.label = military
    ? new Cesium.LabelGraphics({
        text: flight.callsign.slice(0, 12),
        font: "11px var(--font-share-tech), monospace",
        fillColor: Cesium.Color.fromCssColorString("#ffd5a6"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(51, 22, 8, 0.82)"),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
    : undefined;
  setMetadata(entity, flightSelection(flight), Cesium);
}

function createShipEntity(ship: ShipState, Cesium: CesiumModule) {
  const entity = new Cesium.Entity({ id: `ship-${ship.id}` });
  applyShipEntity(entity, ship, Cesium);
  return entity;
}

function applyShipEntity(entity: CesiumEntity, ship: ShipState, Cesium: CesiumModule) {
  const motion: MotionState = {
    lat: ship.lat,
    lon: ship.lon,
    altitude: 180,
    speed: Math.max(0, ship.speed),
    heading: ship.heading,
    observedAt: Date.now(),
  };
  entity.position = createMotionProperty(Cesium, motion, "ship");
  entity.billboard = new Cesium.BillboardGraphics({
    image: shipIcon(),
    rotation: Cesium.Math.toRadians(ship.heading),
    scale: 0.68,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  entity.polyline = new Cesium.PolylineGraphics({
    positions: createTrailProperty(Cesium, motion, "ship"),
    width: 1.5,
    material: Cesium.Color.fromCssColorString("#7de7ff").withAlpha(0.7),
    clampToGround: false,
  });
  entity.label = undefined;
  setMetadata(entity, shipSelection(ship), Cesium);
}

function createSatelliteEntity(item: SatelliteState, Cesium: CesiumModule) {
  const entity = new Cesium.Entity({ id: `satellite-${item.id}` });
  applySatelliteEntity(entity, item, Cesium);
  return entity;
}

function applySatelliteEntity(entity: CesiumEntity, item: SatelliteState, Cesium: CesiumModule) {
  entity.position = new Cesium.ConstantPositionProperty(
    Cesium.Cartesian3.fromDegrees(item.lon, item.lat, Math.max(200000, item.altitude)),
  );
  entity.point = new Cesium.PointGraphics({
    color: Cesium.Color.fromCssColorString(item.type === "station" ? "#8affc1" : "#7dddff"),
    pixelSize: item.type === "station" ? 8 : 6,
    outlineColor: Cesium.Color.fromCssColorString("#031014"),
    outlineWidth: 1.5,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  entity.label = new Cesium.LabelGraphics({
    text: item.name,
    font: "11px var(--font-share-tech), monospace",
    fillColor: Cesium.Color.fromCssColorString("#b8efff"),
    showBackground: true,
    backgroundColor: Cesium.Color.fromCssColorString("rgba(2, 16, 25, 0.78)"),
    pixelOffset: new Cesium.Cartesian2(0, -16),
    scale: 0.82,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  setMetadata(entity, satelliteSelection(item), Cesium);
}

function createNewsEntity(cluster: NewsCluster, Cesium: CesiumModule) {
  const entity = new Cesium.Entity({ id: `news-${cluster.key}` });
  applyNewsEntity(entity, cluster, Cesium);
  return entity;
}

function applyNewsEntity(entity: CesiumEntity, cluster: NewsCluster, Cesium: CesiumModule) {
  entity.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(cluster.lon, cluster.lat));
  entity.point = new Cesium.PointGraphics({
    color: Cesium.Color.fromCssColorString("#fbbf24"),
    pixelSize: Math.min(18, 8 + cluster.count / 18),
    outlineColor: Cesium.Color.fromCssColorString("#271302"),
    outlineWidth: 2,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  entity.label = new Cesium.LabelGraphics({
    text: `${cluster.key} ${cluster.count}`,
    font: "11px var(--font-share-tech), monospace",
    fillColor: Cesium.Color.fromCssColorString("#ffe19c"),
    showBackground: true,
    backgroundColor: Cesium.Color.fromCssColorString("rgba(35, 21, 4, 0.82)"),
    pixelOffset: new Cesium.Cartesian2(0, -18),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  setMetadata(entity, newsSelection(cluster), Cesium);
}

function setMetadata(entity: CesiumEntity, selection: Exclude<Selection, null>, Cesium: CesiumModule) {
  entity.properties = new Cesium.PropertyBag({
    metadata: new Cesium.ConstantProperty(selection),
  });
}

function createMotionProperty(Cesium: CesiumModule, motion: MotionState, kind: "flight" | "ship") {
  return new Cesium.CallbackPositionProperty(() => {
    const elapsedSeconds = Math.max(0, (Date.now() - motion.observedAt) / 1000);
    const speedMps = kind === "ship" ? motion.speed * 0.514444 : motion.speed;
    const distanceMeters = speedMps * elapsedSeconds;
    const next = projectMotion(motion.lat, motion.lon, motion.heading, distanceMeters);
    return Cesium.Cartesian3.fromDegrees(next.lon, next.lat, motion.altitude);
  }, false);
}

function createTrailProperty(Cesium: CesiumModule, motion: MotionState, kind: "flight" | "ship") {
  return new Cesium.CallbackProperty(() => {
    const elapsedSeconds = Math.max(0, (Date.now() - motion.observedAt) / 1000);
    const speedMps = kind === "ship" ? motion.speed * 0.514444 : motion.speed;
    const distanceMeters = speedMps * elapsedSeconds;
    const current = projectMotion(motion.lat, motion.lon, motion.heading, distanceMeters);
    const trailMeters =
      kind === "flight"
        ? Math.max(40_000, speedMps * 220)
        : Math.max(8_000, speedMps * 900);
    const previous = projectMotion(current.lat, current.lon, normalizeHeading(motion.heading + 180), trailMeters);

    return [
      Cesium.Cartesian3.fromDegrees(previous.lon, previous.lat, Math.max(0, motion.altitude * 0.94)),
      Cesium.Cartesian3.fromDegrees(current.lon, current.lat, motion.altitude),
    ];
  }, false);
}

function projectMotion(lat: number, lon: number, heading: number, distanceMeters: number) {
  const earthRadius = 6_371_000;
  const angularDistance = distanceMeters / earthRadius;
  const bearing = (heading * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAd = Math.sin(angularDistance);
  const cosAd = Math.cos(angularDistance);

  const lat2 = Math.asin(sinLat1 * cosAd + cosLat1 * sinAd * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * sinAd * cosLat1,
      cosAd - sinLat1 * Math.sin(lat2),
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: normalizeDegreesLon((lon2 * 180) / Math.PI),
  };
}

function normalizeDegreesLon(lon: number) {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function normalizeHeading(value: number) {
  if (!Number.isFinite(value)) return 0;
  const heading = value % 360;
  return heading < 0 ? heading + 360 : heading;
}

function visualAltitudeForFlight(rawAltitude: number, military: boolean) {
  const safeAltitude = Number.isFinite(rawAltitude) ? Math.max(rawAltitude, 900) : 900;
  const base = military ? 150_000 : 110_000;
  const scale = military ? 10 : 8;
  return base + safeAltitude * scale;
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch("/api/runtime-config", { cache: "no-store" });
    if (!response.ok) return {};
    return (await response.json()) as RuntimeConfig;
  } catch {
    return {};
  }
}

async function loadCesiumGlobal(): Promise<CesiumModule> {
  const existing = (window as Window & { Cesium?: CesiumModule }).Cesium;
  if (existing) return existing;

  await new Promise<void>((resolve, reject) => {
    const current = document.querySelector('script[data-cesium-runtime="true"]') as HTMLScriptElement | null;
    if (current) {
      current.addEventListener("load", () => resolve(), { once: true });
      current.addEventListener("error", () => reject(new Error("Cesium runtime script failed to load.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.dataset.cesiumRuntime = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Cesium runtime script failed to load."));
    document.head.appendChild(script);
  });

  const loaded = (window as Window & { Cesium?: CesiumModule }).Cesium;
  if (!loaded) {
    throw new Error("Cesium runtime loaded without exposing window.Cesium.");
  }
  return loaded;
}

function configureBaseImagery(Cesium: CesiumModule, viewer: CesiumViewer) {
  try {
    viewer.imageryLayers.removeAll();
    const imageryProvider = new Cesium.UrlTemplateImageryProvider({
      url: "/cesium/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg",
      tilingScheme: new Cesium.GeographicTilingScheme(),
      rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
      maximumLevel: 2,
    });
    const imageryLayer = viewer.imageryLayers.addImageryProvider(imageryProvider);
    imageryLayer.brightness = 0.95;
    imageryLayer.contrast = 1.04;
    imageryLayer.saturation = 1;
    return "Local NaturalEarthII imagery online.";
  } catch (error) {
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new Cesium.SingleTileImageryProvider({
        url: "data:image/svg+xml;utf8," + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024" viewBox="0 0 2048 1024">
            <defs>
              <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#0a1830" />
                <stop offset="100%" stop-color="#07111f" />
              </linearGradient>
            </defs>
            <rect width="2048" height="1024" fill="url(#ocean)" />
            <ellipse cx="1024" cy="520" rx="760" ry="290" fill="rgba(94,170,255,0.08)" />
          </svg>
        `),
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
      }),
    );
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#17304d");
    return `Imagery fallback degraded: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

async function waitForRenderableContainer(container: HTMLDivElement) {
  if (container.clientWidth > 0 && container.clientHeight > 0) return;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      resolve();
    };

    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) finish();
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

function sanitizeFlights(items: AircraftState[]) {
  return items.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.id);
}

function sanitizeShips(items: ShipState[]) {
  return items.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.id);
}

function sanitizeSatellites(items: SatelliteState[]) {
  return items.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && Number.isFinite(item.altitude) && item.id);
}

function labelForLayer(key: LayerKey) {
  switch (key) {
    case "flights":
      return "Flights";
    case "ships":
      return "Ships";
    case "satellites":
      return "Satellites";
    case "military":
      return "Military Aircraft";
    case "news":
      return "Global News";
  }
}

function statusClass(state: RuntimeStatus) {
  switch (state) {
    case "ONLINE":
      return "online";
    case "LOADING":
      return "loading";
    case "DISABLED":
      return "disabled";
    default:
      return "error";
  }
}

function clusterNews(news: NewsItem[], centroids: CountryCentroid): NewsCluster[] {
  const map = new Map<string, NewsCluster>();

  news.forEach((item) => {
    const key = item.countryCode || item.country || item.continent;
    const centroid = centroids[item.countryCode];
    const lat = centroid?.lat ?? fallbackLatByContinent(item.continent);
    const lon = centroid?.lon ?? fallbackLonByContinent(item.continent);

    if (!map.has(key)) {
      map.set(key, { key, lat, lon, count: 0, headlines: [] });
    }

    const cluster = map.get(key);
    if (!cluster) return;
    cluster.count += 1;
    if (cluster.headlines.length < 5) cluster.headlines.push(item);
  });

  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 140);
}

function fallbackLatByContinent(continent: string): number {
  switch (continent) {
    case "North America":
      return 45;
    case "South America":
      return -15;
    case "Europe":
      return 51;
    case "Africa":
      return 5;
    case "Asia":
      return 34;
    case "Oceania":
      return -25;
    default:
      return 0;
  }
}

function fallbackLonByContinent(continent: string): number {
  switch (continent) {
    case "North America":
      return -100;
    case "South America":
      return -60;
    case "Europe":
      return 11;
    case "Africa":
      return 20;
    case "Asia":
      return 94;
    case "Oceania":
      return 135;
    default:
      return 0;
  }
}

function thinByGrid<T extends { lat: number; lon: number }>(items: T[], degrees: number, limit: number) {
  const buckets = new Map<string, T>();
  for (const item of items) {
    const key = `${Math.round(item.lat / degrees)}:${Math.round(item.lon / degrees)}`;
    if (!buckets.has(key)) buckets.set(key, item);
    if (buckets.size >= limit) break;
  }
  return [...buckets.values()];
}

function aircraftIcon(military: boolean) {
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <g transform="translate(24 24)">
        <path
          d="M0 -20 L4 -7 L16 -2 L16 2 L4 4 L2 18 L6 20 L6 23 L0 21 L-6 23 L-6 20 L-2 18 L-4 4 L-16 2 L-16 -2 L-4 -7 Z"
          fill="${military ? "#ffad5a" : "#8ce7ff"}"
          stroke="${military ? "#4a1a05" : "#0a2b35"}"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <path d="M0 -17 L1 -2 L0 16 L-1 -2 Z" fill="${military ? "#ffe0ba" : "#dffbff"}" opacity="0.9" />
      </g>
    </svg>
  `)}`;
}

function shipIcon() {
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <g fill="none" stroke-linejoin="round" stroke-linecap="round">
        <path d="M10 26 H34 L30 33 H14 Z" fill="#79e6ff" stroke="#082a34" stroke-width="2" />
        <path d="M18 16 H28 V26 H18 Z" fill="#b7f4ff" stroke="#082a34" stroke-width="2" />
        <path d="M22 10 V16" stroke="#082a34" stroke-width="2.2" />
        <path d="M22 10 L28 14" stroke="#082a34" stroke-width="2" />
        <path d="M8 35 C12 38 16 38 20 35 C24 38 28 38 32 35 C35 38 38 38 40 36" stroke="#79e6ff" stroke-width="2.2" />
      </g>
    </svg>
  `)}`;
}

function flightSelection(flight: AircraftState): Exclude<Selection, null> {
  return {
    kind: "flight",
    title: flight.callsign || flight.id,
    subtitle: flight.isMilitary ? "Military aircraft" : "Civilian flight",
    rows: [
      ["Altitude", `${Math.round(flight.altitude).toLocaleString()} m`],
      ["Speed", `${Math.round(flight.velocity).toLocaleString()} m/s`],
      ["Heading", `${Math.round(flight.heading)}°`],
      ["Source", flight.source],
      ["Track", `${flight.lat.toFixed(2)}, ${flight.lon.toFixed(2)}`],
    ],
  };
}

function shipSelection(ship: ShipState): Exclude<Selection, null> {
  return {
    kind: "ship",
    title: ship.name,
    subtitle: ship.vesselType,
    rows: [
      ["MMSI", ship.mmsi],
      ["Speed", `${Math.round(ship.speed)} kn`],
      ["Heading", `${Math.round(ship.heading)}°`],
      ["Source", ship.source],
      ["Track", `${ship.lat.toFixed(2)}, ${ship.lon.toFixed(2)}`],
    ],
  };
}

function satelliteSelection(item: SatelliteState): Exclude<Selection, null> {
  return {
    kind: "satellite",
    title: item.name,
    subtitle: item.type,
    rows: [
      ["Altitude", `${Math.round(item.altitude / 1000).toLocaleString()} km`],
      ["Source", item.source],
      ["Type", item.type],
      ["Track", `${item.lat.toFixed(2)}, ${item.lon.toFixed(2)}`],
    ],
  };
}

function newsSelection(cluster: NewsCluster): Exclude<Selection, null> {
  return {
    kind: "news",
    title: `${cluster.key} cluster`,
    subtitle: `${cluster.count} linked headlines`,
    rows: [
      ["Latitude", cluster.lat.toFixed(2)],
      ["Longitude", cluster.lon.toFixed(2)],
      ["Coverage", `${cluster.count} articles`],
    ],
    headlines: cluster.headlines,
  };
}
