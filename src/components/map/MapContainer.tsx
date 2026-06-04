import React, { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  useStore,
  PinMode,
  StationMenuData,
  CustomFeatureCollection,
  CustomGeoJSONFeature,
} from "../../store";
import { findNearestPointOnLine } from "../../core/railwayRouting";
import { syncLeafletLayerGroup } from "../../utils/leafletSync";
import { cachedTileLayer } from "../../utils/CachedTileLayer";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { useAppRouteState } from "../../hooks/useAppRouteState";
import { boundMileageEventsForRichDisplay } from "../../utils/mileageUserEvents";
import { tripToProductSegments } from "../../utils/tripProductProjection";
import {
  customEventDetail,
  mileageEventUiEvents,
  openMileageEventsPanel,
  selectMileageEventOnMap,
  setActiveMileageLine,
  setMileageEventsMapPoint,
  type MileageEventSelectDetail,
  type MileageEventsActiveLineDetail,
} from "../../utils/mileageEventUiBridge";
import i18next from "i18next";

// 记录各域名最后一次报错的时间，用于节流
const lastTileErrorTime: Record<string, number> = {};

type FlyToLocationDetail = {
  lat: number;
  lng: number;
  zoom?: number;
};

interface Props {
  setStationMenu: (menu: StationMenuData | null) => void;
  isDraggingRef: React.MutableRefObject<boolean>;
  showDebugZoom?: boolean;
}

export const MapContainer: React.FC<Props> = ({
  setStationMenu,
  isDraggingRef,
  showDebugZoom = false,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const pinsLayer = useRef<L.LayerGroup | null>(null);
  const baseLinesLayer = useRef<L.LayerGroup | null>(null);
  const activeMileageLineLayer = useRef<L.LayerGroup | null>(null);
  const baseStationsLayer = useRef<L.LayerGroup | null>(null);
  const geoDataRef = useRef<CustomFeatureCollection | null>(null);
  const visitedStationsRef = useRef<Set<string>>(new Set());
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const mileageEventsLayer = useRef<L.LayerGroup | null>(null);
  const railLayerRef = useRef<L.TileLayer | null>(null);
  const rubberBandLayerRef = useRef<L.LayerGroup | null>(null);
  const pendingFlyToLocationRef = useRef<FlyToLocationDetail | null>(null);
  const locateFlyingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFittedBoundsRef = useRef<string>("");

  // Explicit SVG Renderers for pointer-events passthrough
  const baseLinesRendererRef = useRef<L.Renderer | null>(null);
  const activeMileageLineRendererRef = useRef<L.Renderer | null>(null);
  const baseStationsRendererRef = useRef<L.Renderer | null>(null);
  const routeRendererRef = useRef<L.Renderer | null>(null);
  const visitedStationsRendererRef = useRef<L.Renderer | null>(null);

  // For local long-press routing drag
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeDragRef = useRef<{
    active: boolean;
    startStation: CustomGeoJSONFeature | null;
    currentSnap: CustomGeoJSONFeature | null;
    rubberLine: L.Polyline | null;
    snapCircleCenter: L.CircleMarker | null;
    openedTooltips: Set<L.Layer>;
  }>({
    active: false,
    startStation: null,
    currentSnap: null,
    rubberLine: null,
    snapCircleCenter: null,
    openedTooltips: new Set(),
  });
  const wasDraggingRef = useRef(false);

  const [isMapInitialized, setIsMapInitialized] = React.useState(false);
  const [selectedMileageEventId, setSelectedMileageEventId] = React.useState<string | null>(null);
  const [activeMileageLineKey, setActiveMileageLineKey] = React.useState<string | null>(null);
  const { tab: activeTab } = useAppRouteState();

  const featureLineKey = (feature: CustomGeoJSONFeature) => {
    const company = feature.properties.company || feature.properties.operator;
    const line = feature.properties.line || feature.properties.name;
    return company && line ? `${company}:${line}` : null;
  };

  const isActiveRouteItem = (item: { lineKey?: string; source?: "rail_graph" | "legacy" | "walk" }) => {
    if (!activeMileageLineKey || item.source === "walk") return false;
    if (item.lineKey && activeMileageLineKey === item.lineKey) return true;
    return item.source === "rail_graph" && activeMileageLineKey.startsWith("rail-graph:") && !item.lineKey;
  };

  const flyToLocation = (detail: Partial<FlyToLocationDetail> | null | undefined) => {
    if (typeof detail?.lat !== "number" || typeof detail.lng !== "number") return;
    const next: FlyToLocationDetail = {
      lat: detail.lat,
      lng: detail.lng,
      zoom: typeof detail.zoom === "number" ? detail.zoom : undefined,
    };
    const map = mapInstance.current;
    if (!map) {
      pendingFlyToLocationRef.current = next;
      return;
    }

    if (locateFlyingTimerRef.current) {
      clearTimeout(locateFlyingTimerRef.current);
    }
    (map as any)._isLocateFlying = true;
    map.flyTo([next.lat, next.lng], next.zoom ?? map.getZoom(), {
      animate: true,
      duration: 1,
    });
    locateFlyingTimerRef.current = setTimeout(() => {
      if (mapInstance.current) {
        (mapInstance.current as any)._isLocateFlying = false;
      }
      locateFlyingTimerRef.current = null;
    }, 1100);
  };

  const animateRubberRetract = (
    polyline: L.Polyline,
    startLatLng: L.LatLng,
    endLatLng: L.LatLng,
    duration = 450,
  ) => {
    const dx = endLatLng.lng - startLatLng.lng;
    const dy = endLatLng.lat - startLatLng.lat;
    const startTime = performance.now();
    const jitterX = (Math.random() - 0.5) * 0.03 * Math.abs(dx || 1);
    const jitterY = (Math.random() - 0.5) * 0.03 * Math.abs(dy || 1);

    const step = (timestamp: number) => {
      const elapsed = timestamp - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const wobble = Math.sin(t * Math.PI * 4) * (1 - t) * 0.18;
      const currentT = Math.max(0, Math.min(1, 1 - ease + wobble));
      const currentLng = startLatLng.lng + dx * currentT + jitterX * (1 - t);
      const currentLat = startLatLng.lat + dy * currentT + jitterY * (1 - t);
      polyline.setLatLngs([
        [startLatLng.lat, startLatLng.lng],
        [currentLat, currentLng],
      ]);
      if (t < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  };

  const {
    geoData,
    leafletReady,
    tripSegmentsGeometry,
    mapZoom,
    setMapZoom,
    setLeafletReady,
    pins,
    editingPin,
    pinMode,
    railwayData,
    mileageUserEvents,
    trips,
    setEditingPin,
    setPinMode,
    visitedStations,
  } = useStore(
    useShallow((state) => ({
      geoData: state.geoData,
      leafletReady: state.leafletReady,
      tripSegmentsGeometry: state.tripSegmentsGeometry,
      mapZoom: state.mapZoom,
      setMapZoom: state.setMapZoom,
      setLeafletReady: state.setLeafletReady,
      pins: state.pins,
      editingPin: state.editingPin,
      pinMode: state.pinMode,
      railwayData: state.railwayData,
      mileageUserEvents: state.mileageUserEvents,
      trips: state.trips,
      setEditingPin: state.setEditingPin,
      setPinMode: state.setPinMode,
      visitedStations: state.visitedStations,
    })),
  );

  useEffect(() => {
    setLeafletReady(true);
  }, [setLeafletReady]);

  useEffect(() => {
    if (activeTab === "map" && leafletReady) {
      setTimeout(initMap, 100);
      setTimeout(() => {
        mapInstance.current?.invalidateSize();
      }, 200);
    }
  }, [activeTab, leafletReady]);

  useEffect(() => {
    geoDataRef.current = geoData;
    if (isMapInitialized && leafletReady && geoData) {
      renderBaseMap(geoData);
      renderActiveMileageLine(geoData);
    }
  }, [geoData, leafletReady, isMapInitialized, railwayData, activeMileageLineKey]);

  useEffect(() => {
    visitedStationsRef.current = visitedStations;
    if (isMapInitialized && leafletReady && geoData) {
      renderStations();
    }
  }, [geoData, leafletReady, isMapInitialized, visitedStations]);

  useEffect(() => {
    if (isMapInitialized && leafletReady && tripSegmentsGeometry) {
      renderTripRoutes();
    }
  }, [tripSegmentsGeometry, leafletReady, mapZoom, isMapInitialized, activeMileageLineKey]);

  // 仅在坐标集发生实质变化时缩放适配视口范围 / Fit bounds only when coordinates change
  useEffect(() => {
    const map = mapInstance.current;
    if (!isMapInitialized || !leafletReady || !map || !tripSegmentsGeometry) return;

    const latLngs: L.LatLng[] = [];

    tripSegmentsGeometry.forEach((seg: any) => {
      if (seg.coords && seg.coords.length > 0) {
        if (seg.isMulti) {
          seg.coords.forEach((part: any[]) => {
            part.forEach((pt: any) => {
              if (Array.isArray(pt) && pt.length >= 2) {
                latLngs.push(L.latLng(pt[0], pt[1]));
              }
            });
          });
        } else {
          seg.coords.forEach((pt: any) => {
            if (Array.isArray(pt) && pt.length >= 2) {
              latLngs.push(L.latLng(pt[0], pt[1]));
            }
          });
        }
      }
    });

    const trips = useStore.getState().trips;
    trips.forEach((t) => {
      if (t.isWalk && t.walkPath) {
        t.walkPath.forEach((pt) => {
          if (Array.isArray(pt) && pt.length >= 2) {
            latLngs.push(L.latLng(pt[0], pt[1]));
          }
        });
      }
    });

    if (latLngs.length === 0) return;

    const sortedCoordsStr = latLngs
      .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
      .sort()
      .join(";");

    if (lastFittedBoundsRef.current === sortedCoordsStr) {
      return;
    }
    lastFittedBoundsRef.current = sortedCoordsStr;

    const bounds = L.latLngBounds(latLngs);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [tripSegmentsGeometry, isMapInitialized, leafletReady]);

  useEffect(() => {
    if (isMapInitialized && leafletReady && !isDraggingRef.current)
      renderPins();
  }, [pins, editingPin, pinMode, leafletReady, isMapInitialized]);

  useEffect(() => {
    if (isMapInitialized && leafletReady) {
      renderMileageEvents();
    }
  }, [mileageUserEvents, railwayData, trips, mapZoom, selectedMileageEventId, activeMileageLineKey, leafletReady, isMapInitialized]);

  useEffect(() => {
    const handleCreateTempPin = () => {
      if (!mapInstance.current) return;
      const c = mapInstance.current.getCenter();
      setEditingPin({
        id: "temp",
        lat: c.lat,
        lng: c.lng,
        type: "photo",
        color: "#ef4444",
        isTemp: true,
      } as any);
      mapInstance.current.panBy([0, 150]);
    };

    const handleRequestMapCenter = () => {
      if (!mapInstance.current) return;
      const center = mapInstance.current.getCenter();
      setMileageEventsMapPoint({ lat: center.lat, lng: center.lng });
    };

    const handleMileageEventSelect = (event: Event) => {
      const detail = customEventDetail<MileageEventSelectDetail>(event);
      if (detail.eventId) {
        setSelectedMileageEventId(detail.eventId);
      }
      if (detail.lineKey) {
        setActiveMileageLineKey(detail.lineKey);
      } else if (detail.source === "rail_graph_runtime") {
        setActiveMileageLineKey(null);
      }
    };

    const handleActiveMileageLine = (event: Event) => {
      const detail = customEventDetail<MileageEventsActiveLineDetail>(event);
      setActiveMileageLineKey(detail.lineKey ?? null);
    };

    const handleFlyToLocation = (e: Event) => {
      const customEvent = e as CustomEvent<FlyToLocationDetail>;
      flyToLocation(customEvent.detail);
    };

      const handleShowNearbyStations = (e: Event) => {
        const customEvent = e as CustomEvent;
        const { stations } = customEvent.detail;
        if (stations && stations.length > 0 && mapInstance.current) {
            const map = mapInstance.current;
            const closest = stations[0];

            // Wait for flyTo to finish before calculating container point
            const setMenu = () => {
                const point = map.latLngToContainerPoint([closest.station.lat, closest.station.lng]);
                setStationMenu({
                    x: point.x,
                    y: point.y,
                    stationData: closest.station
                });
            };

            if ((map as any)._isLocateFlying) {
                map.once("moveend", setMenu);
            } else {
                setMenu();
            }
        }
      };

    window.addEventListener("map:create-temp-pin", handleCreateTempPin);
    window.addEventListener(mileageEventUiEvents.requestMapCenter, handleRequestMapCenter);
    window.addEventListener(mileageEventUiEvents.select, handleMileageEventSelect);
    window.addEventListener(mileageEventUiEvents.activeLine, handleActiveMileageLine);
    window.addEventListener("map:fly-to-location", handleFlyToLocation);
      window.addEventListener("map:show-nearby-stations", handleShowNearbyStations);
    return () => {
      window.removeEventListener("map:create-temp-pin", handleCreateTempPin);
      window.removeEventListener(mileageEventUiEvents.requestMapCenter, handleRequestMapCenter);
      window.removeEventListener(mileageEventUiEvents.select, handleMileageEventSelect);
      window.removeEventListener(mileageEventUiEvents.activeLine, handleActiveMileageLine);
      window.removeEventListener("map:fly-to-location", handleFlyToLocation);
        window.removeEventListener("map:show-nearby-stations", handleShowNearbyStations);
    };
  }, [setEditingPin]);

  const initMap = () => {
    if (!mapRef.current || mapInstance.current) return;

    let startLat = 35.6812;
    let startLng = 139.7671;

    const mapCenterSettings =
      useStore.getState().badgeSettings?.defaultMapCenter;

    if (mapCenterSettings) {
      if (mapCenterSettings.mode === "fixed") {
        startLat = mapCenterSettings.lat;
        startLng = mapCenterSettings.lng;
      } else if (mapCenterSettings.mode === "latest") {
        const _trips = useStore.getState().trips;
        if (_trips && _trips.length > 0) {
          const productSegments = tripToProductSegments(_trips[0], railwayData);
          const lastSegment = productSegments[productSegments.length - 1];
          const lastCoords = lastSegment?.geometry?.[lastSegment.geometry.length - 1];
          if (lastCoords) {
            startLat = lastCoords[0];
            startLng = lastCoords[1];
          } else if (lastSegment) {
            const endStation = railwayData[lastSegment.lineKey]?.stations.find(
              (station: any) => station.id === lastSegment.toId,
            );
            if (endStation) {
              startLat = endStation.lat;
              startLng = endStation.lng;
            }
          }
        }
      }
    }

    const map = L.map(mapRef.current, {
      zoomControl: true,
      preferCanvas: true,
    }).setView([startLat, startLng], 10);
    const light = cachedTileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      { attribution: "© CARTO", subdomains: ["a", "b", "c", "d"], maxZoom: 20 },
    );
    const dark = cachedTileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { attribution: "© CARTO", subdomains: ["a", "b", "c", "d"], maxZoom: 20 },
    );
    const rail = cachedTileLayer(
      "https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
      { maxZoom: 20, opacity: 0, attribution: "© OpenRailwayMap" },
    );
    railLayerRef.current = rail;

    const handleTileError = (e: any) => {
      if (!e || !e.tile || !e.tile.src) return;
      try {
        const url = new URL(e.tile.src);
        const domain = url.hostname;
        const now = Date.now();

        if (
          !lastTileErrorTime[domain] ||
          now - lastTileErrorTime[domain] > 60000
        ) {
          lastTileErrorTime[domain] = now;
          toast.error(`地图加载失败 (${domain})\n请检查网络或切换 VPN 节点`, {
            id: `tile-error-${domain}`,
            duration: 5000,
          });
        }
      } catch (err) {
        // 忽略 URL 解析错误
      }
    };

    light.on("tileerror", handleTileError);
    dark.on("tileerror", handleTileError);
    rail.on("tileerror", handleTileError);

    dark.addTo(map);
    rail.addTo(map);
    L.control
      .layers(
        { "标准 (light)": light, "暗色 (Dark)": dark },
        { "详细配线图 (OpenRailwayMap)": rail },
        { position: "topright" },
      )
      .addTo(map);

    const overlayPane = map.getPane("overlayPane")!;

    map.createPane("baseLinesPane", overlayPane);
    const baseLinesPane = map.getPane("baseLinesPane")!;
    baseLinesPane.style.zIndex = "390";
    baseLinesPane.style.pointerEvents = "none";

    map.createPane("baseStationsPane", overlayPane);
    const baseStationsPane = map.getPane("baseStationsPane")!;
    baseStationsPane.style.zIndex = "400";
    baseStationsPane.style.pointerEvents = "none";

    map.createPane("routePane", overlayPane);
    const routePane = map.getPane("routePane")!;
    routePane.style.zIndex = "410";
    routePane.style.pointerEvents = "none";

    map.createPane("activeMileageLinePane", overlayPane);
    const activeMileageLinePane = map.getPane("activeMileageLinePane")!;
    activeMileageLinePane.style.zIndex = "415";
    activeMileageLinePane.style.pointerEvents = "none";

    map.createPane("visitedStationsPane", overlayPane);
    const visitedStationsPane = map.getPane("visitedStationsPane")!;
    visitedStationsPane.style.zIndex = "420";
    visitedStationsPane.style.pointerEvents = "none";

    map.createPane("mileageEventsPane", overlayPane);
    const mileageEventsPane = map.getPane("mileageEventsPane")!;
    mileageEventsPane.style.zIndex = "430";
    mileageEventsPane.style.pointerEvents = "auto";

    mapInstance.current = map;

    baseLinesRendererRef.current = L.svg({ pane: "baseLinesPane" });
    activeMileageLineRendererRef.current = L.svg({ pane: "activeMileageLinePane" });
    baseStationsRendererRef.current = L.svg({ pane: "baseStationsPane" });
    routeRendererRef.current = L.svg({ pane: "routePane" });
    visitedStationsRendererRef.current = L.svg({ pane: "visitedStationsPane" });

    baseLinesLayer.current = L.layerGroup();
    activeMileageLineLayer.current = L.layerGroup().addTo(map);
    baseStationsLayer.current = L.layerGroup().addTo(map);
    routeLayer.current = L.layerGroup().addTo(map);
    pinsLayer.current = L.layerGroup().addTo(map);
    mileageEventsLayer.current = L.layerGroup().addTo(map);
    rubberBandLayerRef.current = L.layerGroup().addTo(map);

    const updateLayerVisibility = () => {
      const z = map.getZoom();
      if (railLayerRef.current)
        railLayerRef.current.setOpacity(z >= 15 ? 0.7 : z >= 12 ? 0.4 : 0);
      const showBaseLines = z >= 10 && z < 12;
      if (baseLinesLayer.current) {
        if (showBaseLines) {
          if (!map.hasLayer(baseLinesLayer.current)) {
            map.addLayer(baseLinesLayer.current);
            baseLinesLayer.current.invoke("bringToBack");
          }
        } else {
          if (map.hasLayer(baseLinesLayer.current))
            map.removeLayer(baseLinesLayer.current);
        }
      }

      const baseStationsPane = map.getPane("baseStationsPane");
      if (baseStationsPane) {
        baseStationsPane.style.display = z < 5 ? "none" : "";
      }
      const visitedStationsPane = map.getPane("visitedStationsPane");
      if (visitedStationsPane) {
        visitedStationsPane.style.display = z <= 7 ? "none" : "";
      }
      const mileageEventsPane = map.getPane("mileageEventsPane");
      if (mileageEventsPane) {
        mileageEventsPane.style.display = z <= 7 ? "none" : "";
      }

      setMapZoom(z);
    };

    map.on("zoomend", updateLayerVisibility);
    updateLayerVisibility();

    // Listen to moveend to update stations with new bounds
    map.on("moveend", () => {
      renderStations();
    });

    // Listen for true user interactions to interrupt locate status
    const handleUserInterruption = () => {
      if (!(map as any)._isLocateFlying) {
        window.dispatchEvent(new CustomEvent("map:user-interaction"));
      }
    };
    map.on("dragstart", handleUserInterruption);
    map.on("zoomstart", (e: any) => {
      // Check if zoom was triggered by touch/scroll/controls rather than flyTo
      if (!(map as any)._isLocateFlying) {
        handleUserInterruption();
      }
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (wasDraggingRef.current) {
        wasDraggingRef.current = false;
        return;
      }

      const currentPinMode = useStore.getState().pinMode;
      const currentEditingPin = useStore.getState().editingPin;

      if (currentPinMode !== PinMode.Idle && currentEditingPin) {
        let newPos = {
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          lineKey: currentEditingPin.lineKey,
          percentage: currentEditingPin.percentage,
        };
        if (currentPinMode === PinMode.Snap) {
          const snap = findNearestPointOnLine(
            useStore.getState().railwayData,
            newPos.lat,
            newPos.lng,
          );
          newPos = { ...newPos, ...snap };
        }
        setEditingPin({ ...currentEditingPin, ...newPos });
      } else {
        setStationMenu(null);
        setMileageEventsMapPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    // Global mouse/touch move and up listeners for localized drag
    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      if (
        !routeDragRef.current.active ||
        !routeDragRef.current.startStation ||
        !rubberBandLayerRef.current
      )
        return;

      const startStation = routeDragRef.current.startStation;
      const startLat = startStation.geometry.coordinates[1];
      const startLng = startStation.geometry.coordinates[0];

      let clientX, clientY;
      if ("touches" in e) {
        clientX = (e as TouchEvent).touches[0].clientX;
        clientY = (e as TouchEvent).touches[0].clientY;
      } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }

      const mapRect = map.getContainer().getBoundingClientRect();
      const containerPoint = L.point(
        clientX - mapRect.left,
        clientY - mapRect.top,
      );
      const mouseLatLng = map.containerPointToLatLng(containerPoint);

      // --- April Fool's Snap Trap ---
      if (useStore.getState().isAprilFool) {
        const startContainerPoint = map.latLngToContainerPoint([
          startLat,
          startLng,
        ]);
        const distToStart = containerPoint.distanceTo(startContainerPoint);
        const viewportThreshold = Math.max(mapRect.width, mapRect.height) * 0.3;

        if (distToStart > viewportThreshold) {
          // Trigger the trap!
          routeDragRef.current.active = false;

          // Close tooltips
          routeDragRef.current.openedTooltips.forEach((layer) => {
            if ((layer as any).closeTooltip) {
              const tooltip = (layer as any).getTooltip
                ? (layer as any).getTooltip()
                : null;
              if (tooltip) {
                const el = tooltip.getElement();
                if (el) el.classList.remove("tooltip-highlight");
              }
              (layer as any).closeTooltip();
            }
          });
          routeDragRef.current.openedTooltips.clear();

          let trapStyle: HTMLStyleElement | null = null;
          const rubberLine = routeDragRef.current.rubberLine;
          if (rubberLine) {
            const lineElement = rubberLine.getElement();
            if (lineElement) {
              // Inject random snap animation
              const animName = `snap-fail-rand-${Math.floor(Math.random() * 10000)}`;
              trapStyle = document.createElement("style");
              const rx = (Math.random() - 0.5) * 50;
              const ry = (Math.random() - 0.5) * 50;
              trapStyle.innerHTML = `
                                @keyframes ${animName} {
                                    0% { stroke-width: 6; opacity: 1; transform: translate(0px, 0px) scale(1); }
                                    25% { stroke-width: 15; transform: translate(${rx}px, ${ry}px) scale(1.5) skew(${rx}deg); }
                                    50% { stroke-width: 4; transform: translate(${-rx}px, ${-ry}px) scale(0.5) skew(${-rx}deg); opacity: 0.8; }
                                    75% { stroke-width: 10; transform: translate(${rx / 2}px, ${ry / 2}px) scale(1.2); opacity: 0.5; }
                                    100% { stroke-width: 2; transform: translate(0px, 0px) scale(0); opacity: 0; }
                                }
                                .${animName}-class {
                                    animation: ${animName} 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards;
                                    transform-origin: center;
                                }
                            `;
              document.head.appendChild(trapStyle);
              lineElement.classList.remove("rubber-band-line");
              lineElement.classList.add(`${animName}-class`);
            }

            const linePoints = rubberLine.getLatLngs() as L.LatLng[];
            if (linePoints.length >= 2) {
              animateRubberRetract(
                rubberLine,
                L.latLng(startLat, startLng),
                linePoints[linePoints.length - 1],
              );
            }
          }

          if (mapRef.current) {
            mapRef.current.classList.add("map-shake");
          }

          toast.error("哎呀！橡皮筋拉断了，弹到手了！💥", {
            duration: 2500,
            position: "top-center",
          });

          setTimeout(() => {
            if (mapRef.current) {
              mapRef.current.classList.remove("map-shake");
            }
            if (rubberBandLayerRef.current)
              rubberBandLayerRef.current.clearLayers();
            routeDragRef.current = {
              active: false,
              startStation: null,
              currentSnap: null,
              rubberLine: null,
              snapCircleCenter: null,
              openedTooltips: new Set(),
            };
            map.dragging.enable();
            // Clean up the dynamically created style tag
            if (trapStyle?.parentNode) {
              trapStyle.parentNode.removeChild(trapStyle);
            }
          }, 500);

          return;
        }
      }

      let nearestDist = Infinity;
      let nearestStation: any = null;
      let nearestLatLng: L.LatLng | null = null;

      const newOpenedTooltips = new Set<L.Layer>();

      if (geoDataRef.current && baseStationsLayer.current) {
        const candidates: { layer: any; dist: number }[] = [];

        // To display tooltips within 100px, we should iterate over rendered layers in baseStationsLayer
        // because we need access to the layer object to call `openTooltip()`.
        baseStationsLayer.current.eachLayer((layer: any) => {
          if (typeof layer.getLatLng === "function") {
            const latlng = layer.getLatLng();
            const stPoint = map.latLngToContainerPoint([
              latlng.lat,
              latlng.lng,
            ]);
            const dist = containerPoint.distanceTo(stPoint);

            // Tooltip logic (100px)
            if (dist <= 100) {
              candidates.push({ layer, dist });
            }
          }
        });

        // Sort by distance and limit to the closest 5
        candidates.sort((a, b) => a.dist - b.dist);
        const closestCandidates = candidates.slice(0, 5);

        closestCandidates.forEach(({ layer }, index) => {
          const tooltip = layer.getTooltip ? layer.getTooltip() : null;
          if (tooltip) {
            if (!layer.isTooltipOpen()) {
              layer.openTooltip();
            }

            const el = tooltip.getElement();
            if (el) {
              if (index === 0) {
                el.classList.add("tooltip-highlight");
              } else {
                el.classList.remove("tooltip-highlight");
              }
            }
            newOpenedTooltips.add(layer);
          }
        });

        // Original GeoData search to find nearest feature for snap logic
        geoDataRef.current.features.forEach((f: any) => {
          if (f.properties.type === "station" && f.geometry?.coordinates) {
            const lat = f.geometry.coordinates[1];
            const lng = f.geometry.coordinates[0];
            // Skip the start station itself
            if (
              f.properties.name === startStation.properties.name &&
              f.properties.line === startStation.properties.line
            )
              return;

            const stPoint = map.latLngToContainerPoint([lat, lng]);
            const dist = containerPoint.distanceTo(stPoint);

            if (dist < 40 && dist < nearestDist) {
              nearestDist = dist;
              nearestStation = f;
              nearestLatLng = L.latLng(lat, lng);
            }
          }
        });
      }

      // Close tooltips that are no longer within 100px
      routeDragRef.current.openedTooltips.forEach((layer) => {
        if (!newOpenedTooltips.has(layer) && (layer as any).closeTooltip) {
          const tooltip = (layer as any).getTooltip
            ? (layer as any).getTooltip()
            : null;
          if (tooltip) {
            const el = tooltip.getElement();
            if (el) {
              el.classList.remove("tooltip-highlight");
            }
          }
          (layer as any).closeTooltip();
        }
      });
      routeDragRef.current.openedTooltips = newOpenedTooltips;

      routeDragRef.current.currentSnap = nearestStation;

      const rubberLine = routeDragRef.current.rubberLine;
      const snapCircleCenter = routeDragRef.current.snapCircleCenter;

      if (rubberLine && snapCircleCenter) {
        if (nearestStation && nearestLatLng) {
          rubberLine.setLatLngs([[startLat, startLng], nearestLatLng]);
          snapCircleCenter
            .setLatLng(nearestLatLng)
            .setStyle({ opacity: 1, fillOpacity: 1 });

          // Clear fail class, add success class immediately if needed, but usually we just pulse
          const lineElement = rubberLine.getElement();
          if (lineElement) {
            lineElement.classList.add("rubber-band-success");
          }
        } else {
          rubberLine.setLatLngs([[startLat, startLng], mouseLatLng]);
          snapCircleCenter.setStyle({ opacity: 0, fillOpacity: 0 });
          const lineElement = rubberLine.getElement();
          if (lineElement) {
            lineElement.classList.remove("rubber-band-success");
          }
        }
      }
    };

    const handleGlobalUp = (e: MouseEvent | TouchEvent) => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;

        // If the drag wasn't active, we still disabled map dragging on mousedown, so re-enable it.
        if (!routeDragRef.current.active) {
          map.dragging.enable();
        }
      }

      if (!routeDragRef.current.active) return;

      // Immediately close dynamically opened tooltips
      routeDragRef.current.openedTooltips.forEach((layer) => {
        if ((layer as any).closeTooltip) {
          const tooltip = (layer as any).getTooltip
            ? (layer as any).getTooltip()
            : null;
          if (tooltip) {
            const el = tooltip.getElement();
            if (el) {
              el.classList.remove("tooltip-highlight");
            }
          }
          (layer as any).closeTooltip();
        }
      });
      routeDragRef.current.openedTooltips.clear();

      routeDragRef.current.active = false;
      map.dragging.enable();
      wasDraggingRef.current = true; // prevent click

      const currentSnap = routeDragRef.current.currentSnap;
      const startStation = routeDragRef.current.startStation;
      const rubberLine = routeDragRef.current.rubberLine;

      if (currentSnap && startStation) {
        // Success: Snap, animate, then trigger auto-plan and fade out
        if (rubberLine) {
          const lineElement = rubberLine.getElement();
          if (lineElement) {
            lineElement.classList.add("rubber-band-success");
            lineElement.classList.remove("rubber-band-line"); // stop dash flow
          }
        }

        setTimeout(() => {
          const snapProps = currentSnap.properties;
          const snapLineKey = `${snapProps.company}:${snapProps.line}`;
          const startLineKey = `${startStation.properties.company}:${startStation.properties.line}`;

          const startStationId =
            startStation.properties.id ||
            `${startStation.properties.company}:${startStation.properties.line}:${startStation.properties.name}`;
          const endStationId =
            snapProps.id ||
            `${snapProps.company}:${snapProps.line}:${snapProps.name}`;

          const {
            startEditingTrip,
            isAprilFool,
            setAutoRouteEasterEggType,
            setIsRouteSearching,
          } = useStore.getState();

          // --- April Fool's Map Auto-Plan Hijack ---
          const nextAutoForm = {
            startLine: startLineKey,
            startStation: startStationId,
            endLine: snapLineKey,
            endStation: endStationId,
          };

          const rand = Math.random();
          if (isAprilFool && rand < 1 / 3) {
            const type = rand < 1 / 6 ? "ufo" : "tree";
            // Open the TripEditor normally, but force it into an immediate Easter Egg searching state
            setAutoRouteEasterEggType(type);
            setIsRouteSearching(true);
            startEditingTrip(null, "auto", nextAutoForm);
          } else {
            startEditingTrip(null, "auto", nextAutoForm);
          }

          if (rubberBandLayerRef.current)
            rubberBandLayerRef.current.clearLayers();
          routeDragRef.current = {
            active: false,
            startStation: null,
            currentSnap: null,
            rubberLine: null,
            snapCircleCenter: null,
            openedTooltips: new Set(),
          };
        }, 300); // Wait for success animation
      } else {
        // Fail: Animate fail and disappear
        if (rubberLine) {
          const lineElement = rubberLine.getElement();
          if (lineElement) {
            lineElement.classList.remove("rubber-band-line");
            lineElement.classList.add("rubber-band-fail");
          }
          const linePoints = rubberLine.getLatLngs() as L.LatLng[];
          if (linePoints.length >= 2) {
            animateRubberRetract(
              rubberLine,
              linePoints[0],
              linePoints[linePoints.length - 1],
            );
          }
        }

        setTimeout(() => {
          if (rubberBandLayerRef.current)
            rubberBandLayerRef.current.clearLayers();
          routeDragRef.current = {
            active: false,
            startStation: null,
            currentSnap: null,
            rubberLine: null,
            snapCircleCenter: null,
            openedTooltips: new Set(),
          };
        }, 300);
      }
    };

    window.addEventListener("mousemove", handleGlobalMove);
    window.addEventListener("touchmove", handleGlobalMove, { passive: false });
    window.addEventListener("mouseup", handleGlobalUp);
    window.addEventListener("touchend", handleGlobalUp);

    // Store cleanup on map instance for unmounting
    (map as any)._customDragCleanup = () => {
      window.removeEventListener("mousemove", handleGlobalMove);
      window.removeEventListener("touchmove", handleGlobalMove);
      window.removeEventListener("mouseup", handleGlobalUp);
      window.removeEventListener("touchend", handleGlobalUp);
    };

    setIsMapInitialized(true);
    if (pendingFlyToLocationRef.current) {
      const pending = pendingFlyToLocationRef.current;
      pendingFlyToLocationRef.current = null;
      requestAnimationFrame(() => flyToLocation(pending));
    }
  };

  useEffect(() => {
    return () => {
      if (locateFlyingTimerRef.current) {
        clearTimeout(locateFlyingTimerRef.current);
      }
      if (
        mapInstance.current &&
        (mapInstance.current as any)._customDragCleanup
      ) {
        (mapInstance.current as any)._customDragCleanup();
      }
    };
  }, []);

  const renderStations = () => {
    if (
      !baseStationsLayer.current ||
      !mapInstance.current ||
      !geoDataRef.current
    )
      return;

    const map = mapInstance.current;
    if ((map as any)._animatingZoom) {
      return;
    }
    const currentZoom = map.getZoom();

    // At zoom < 5, strictly provide empty array to clear/hide stations
    if (currentZoom < 5) {
      syncLeafletLayerGroup<CustomGeoJSONFeature>(
        baseStationsLayer.current,
        [],
        (f) =>
          f.properties.id ||
          `${f.properties.company}:${f.properties.line}:${f.properties.name}`,
        (f) => L.circleMarker([0, 0]),
        () => {},
      );
      return;
    }

    // Calculate dynamic zoom scale
    let scale = Math.pow(2, currentZoom - 12);
    scale = Math.min(scale, 1.5);

    const baseUnvisitedRadius = 4 * scale;
    const baseVisitedRadius = 5 * Math.max(0.2, scale);
    const baseVisitedWeight = 2 * Math.max(0.3, scale);

    // Calculate 3x3 viewport bounds
    const bounds = map.getBounds();
    const latDiff = bounds.getNorth() - bounds.getSouth();
    const lngDiff = bounds.getEast() - bounds.getWest();

    const expandedBounds = L.latLngBounds(
      L.latLng(bounds.getSouth() - latDiff, bounds.getWest() - lngDiff),
      L.latLng(bounds.getNorth() + latDiff, bounds.getEast() + lngDiff),
    );

    // Filter stations within the expanded bounds
    const stationFeatures = geoDataRef.current.features.filter(
      (f: CustomGeoJSONFeature) => {
        if (f.properties.type !== "station") return false;
        const lng = f.geometry.coordinates[0];
        const lat = f.geometry.coordinates[1];
        // Since it's point data, check if it's within the expanded bounds
        return expandedBounds.contains([lat, lng]);
      },
    );

    syncLeafletLayerGroup<CustomGeoJSONFeature>(
      baseStationsLayer.current,
      stationFeatures,
      (f) => {
        const stationId =
          f.properties.id ||
          `${f.properties.company}:${f.properties.line}:${f.properties.name}`;
        const isVisited = visitedStationsRef.current.has(stationId);
        // Changing panes requires a different renderer. To avoid issues with Leaflet transferring SVG nodes,
        // we treat a station moving between visited/base as a different entity id.
        return `${stationId}_${isVisited ? "v" : "b"}`;
      },
      (f) => {
        const latlng = [
          f.geometry.coordinates[1],
          f.geometry.coordinates[0],
        ] as [number, number];
        const stationId =
          f.properties.id ||
          `${f.properties.company}:${f.properties.line}:${f.properties.name}`;
        const isVisited = visitedStationsRef.current.has(stationId);
        const lineColor = f.properties.stroke || "#64748b"; // Fallback if no stroke defined

        const targetRadius = isVisited
          ? baseVisitedRadius
          : baseUnvisitedRadius;
        const targetWeight = isVisited ? baseVisitedWeight : 0;

        const currentRenderer = isVisited
          ? visitedStationsRendererRef.current!
          : baseStationsRendererRef.current!;

        const layer = L.circleMarker(latlng, {
          renderer: currentRenderer,
          radius: targetRadius,
          color: isVisited ? "#ffffff" : "transparent",
          fillColor: isVisited ? lineColor : "#64748b",
          fillOpacity: isVisited ? 1.0 : 0.5,
          weight: targetWeight,
          className: "station-dot",
          pane: isVisited ? "visitedStationsPane" : "baseStationsPane",
        });
        // @ts-ignore
        layer._cachedIsVisited = isVisited;
        if (f.properties.name) layer.bindTooltip(f.properties.name);

        // @ts-ignore
        layer._cachedLat = latlng[0];
        // @ts-ignore
        layer._cachedLng = latlng[1];
        // @ts-ignore
        layer._cachedName = f.properties.name;
        // @ts-ignore
        layer._cachedRadius = targetRadius;
        // @ts-ignore
        layer._cachedWeight = targetWeight;

        let startX = 0;
        let startY = 0;

        const handlePointerDown = (e: L.LeafletEvent | L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);

          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);

          const me = e as L.LeafletMouseEvent;
          const originalEvent = me.originalEvent as MouseEvent | TouchEvent;
          startX =
            "clientX" in originalEvent
              ? originalEvent.clientX
              : (originalEvent as TouchEvent).touches[0].clientX;
          startY =
            "clientY" in originalEvent
              ? originalEvent.clientY
              : (originalEvent as TouchEvent).touches[0].clientY;

          wasDraggingRef.current = false;
          map.dragging.disable(); // Immediately prevent map pan

          pressTimerRef.current = setTimeout(() => {
            // Long press confirmed
            wasDraggingRef.current = true; // disable click
            routeDragRef.current.active = true;
            routeDragRef.current.startStation = f;

            if (rubberBandLayerRef.current)
              rubberBandLayerRef.current.clearLayers();

            const startLat = f.geometry.coordinates[1];
            const startLng = f.geometry.coordinates[0];
            const routeColor = "#ec4899"; // default active color

            const rubberLine = L.polyline(
              [
                [startLat, startLng],
                [startLat, startLng],
              ],
              {
                color: routeColor,
                weight: 6,
                opacity: 0.8,
                lineCap: "round",
                dashArray: "8, 8",
                className: "rubber-band-line",
              },
            ).addTo(rubberBandLayerRef.current!);

            const snapCircleCenter = L.circleMarker([0, 0], {
              radius: 8,
              color: "#fff",
              weight: 3,
              fillColor: routeColor,
              fillOpacity: 1,
              opacity: 0,
            }).addTo(rubberBandLayerRef.current!);

            routeDragRef.current.rubberLine = rubberLine;
            routeDragRef.current.snapCircleCenter = snapCircleCenter;
          }, 300); // 300ms long press
        };

        const handlePointerMove = (e: L.LeafletEvent | L.LeafletMouseEvent) => {
          if (pressTimerRef.current && !routeDragRef.current.active) {
            const me = e as L.LeafletMouseEvent;
            const originalEvent = me.originalEvent as MouseEvent | TouchEvent;
            const currentX =
              "clientX" in originalEvent
                ? originalEvent.clientX
                : (originalEvent as TouchEvent).touches[0].clientX;
            const currentY =
              "clientY" in originalEvent
                ? originalEvent.clientY
                : (originalEvent as TouchEvent).touches[0].clientY;

            // 15px tolerance
            if (
              Math.abs(currentX - startX) > 15 ||
              Math.abs(currentY - startY) > 15
            ) {
              clearTimeout(pressTimerRef.current);
              pressTimerRef.current = null;
              map.dragging.enable();
            }
          }
        };

        const handlePointerUp = (e: L.LeafletEvent | L.LeafletMouseEvent) => {
          if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;

            // If it wasn't a long press and active drag didn't start, re-enable dragging
            if (!routeDragRef.current.active) {
              map.dragging.enable();
            }
          }
        };

        layer.on("mousedown", handlePointerDown);
        layer.on("touchstart", handlePointerDown);
        layer.on("mousemove", handlePointerMove);
        layer.on("touchmove", handlePointerMove);
        layer.on("mouseup", handlePointerUp);
        layer.on("touchend", handlePointerUp);

        layer.on("click", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);

          const originalEvent = e.originalEvent as MouseEvent | TouchEvent;
          const x =
            "clientX" in originalEvent
              ? originalEvent.clientX
              : (originalEvent as TouchEvent).touches[0].clientX;
          const y =
            "clientY" in originalEvent
              ? originalEvent.clientY
              : (originalEvent as TouchEvent).touches[0].clientY;

          // If was dragged heavily, ignore click
          if (
            wasDraggingRef.current &&
            (Math.abs(x - startX) > 15 || Math.abs(y - startY) > 15)
          ) {
            wasDraggingRef.current = false;
            return;
          }
          wasDraggingRef.current = false;

          setStationMenu({
            x,
            y,
            stationData: {
              name_ja: f.properties.name || "",
              lat: f.geometry.coordinates[1],
              lng: f.geometry.coordinates[0],
            },
          });
        });
        return layer;
      },
      (layer, f) => {
        const marker = layer as any;
        const stationId =
          f.properties.id ||
          `${f.properties.company}:${f.properties.line}:${f.properties.name}`;
        const isVisited = visitedStationsRef.current.has(stationId);
        const lineColor = f.properties.stroke || "#64748b";
        const newLat = f.geometry.coordinates[1];
        const newLng = f.geometry.coordinates[0];
        const newName = f.properties.name;

        let changed = false;
        if (marker._cachedLat !== newLat || marker._cachedLng !== newLng) {
          marker.setLatLng([newLat, newLng]);
          marker._cachedLat = newLat;
          marker._cachedLng = newLng;
          changed = true;
        }

        if (marker._cachedName !== newName) {
          marker.unbindTooltip();
          if (newName) marker.bindTooltip(newName);
          marker._cachedName = newName;
          changed = true;
        }

        const targetRadius = isVisited
          ? baseVisitedRadius
          : baseUnvisitedRadius;
        const targetWeight = isVisited ? baseVisitedWeight : 0;

        if (
          marker._cachedIsVisited !== isVisited ||
          marker._cachedRadius !== targetRadius ||
          marker._cachedWeight !== targetWeight
        ) {
          marker.setStyle({
            radius: targetRadius,
            color: isVisited ? "#ffffff" : "transparent",
            fillColor: isVisited ? lineColor : "#64748b",
            fillOpacity: isVisited ? 1.0 : 0.5,
            weight: targetWeight,
          });

          // Changing panes in Leaflet requires removing and re-adding the layer to its parent layer group.
          // Since identity now includes the visited state (v/b suffix),
          // this branch will technically never be hit if isVisited changes,
          // as syncLeafletLayerGroup will remove the old marker and create a new one.
          // This is intended because transferring an SVG path node between SVG parent renderers
          // in Leaflet is error-prone.
          marker._cachedIsVisited = isVisited;
          marker._cachedRadius = targetRadius;
          marker._cachedWeight = targetWeight;
          changed = true;
        }

        // Do nothing else if not changed to optimize DOM updates
      },
    );
  };

  const renderBaseMap = (data: CustomFeatureCollection) => {
    if (!baseLinesLayer.current) return;
    baseLinesLayer.current.clearLayers();

    // Base Lines
    const lineFeatures = data.features.filter(
      (f: CustomGeoJSONFeature) =>
        f.geometry.type === "LineString" ||
        f.geometry.type === "MultiLineString",
    );
    L.geoJSON(lineFeatures as any, {
      style: (feature) => {
        const lineKey = feature ? featureLineKey(feature as CustomGeoJSONFeature) : null;
        const selected = !!activeMileageLineKey && lineKey === activeMileageLineKey;
        const selectedColor =
          (feature as CustomGeoJSONFeature | undefined)?.properties.stroke ||
          (lineKey ? railwayData[lineKey]?.meta?.color : null) ||
          "#0f766e";
        return {
          color: selected ? selectedColor : "#475569",
          weight: selected ? 4 : 1,
          opacity: selected ? 0.86 : activeMileageLineKey ? 0.18 : 0.3,
          className: selected ? "base-line-active-mileage" : "base-line-muted-mileage",
        };
      },
      pane: "baseLinesPane",
      interactive: false,
      // @ts-ignore
      renderer: baseLinesRendererRef.current,
    }).addTo(baseLinesLayer.current);
  };

  const renderActiveMileageLine = (data: CustomFeatureCollection) => {
    if (!activeMileageLineLayer.current) return;
    activeMileageLineLayer.current.clearLayers();
    if (!activeMileageLineKey || activeMileageLineKey.startsWith("rail-graph:")) return;

    const lineFeatures = data.features.filter((feature: CustomGeoJSONFeature) => {
      if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") return false;
      return featureLineKey(feature) === activeMileageLineKey;
    });
    if (lineFeatures.length === 0) return;

    const lineColor = railwayData[activeMileageLineKey]?.meta?.color || "#0f766e";
    L.geoJSON(lineFeatures as any, {
      style: () => ({
        color: lineColor,
        weight: 7,
        opacity: 0.95,
        lineCap: "round",
        className: "active-mileage-line-overlay",
      }),
      pane: "activeMileageLinePane",
      interactive: false,
      // @ts-ignore
      renderer: activeMileageLineRendererRef.current,
    }).addTo(activeMileageLineLayer.current);
  };

  const renderTripRoutes = () => {
    if (!routeLayer.current || !tripSegmentsGeometry) return;

    const currentZoom = useStore.getState().mapZoom;
    const zoomWeight =
      currentZoom < 8 ? 2 : currentZoom < 12 ? 4 : currentZoom < 15 ? 6 : 9;

    interface RouteItem {
      id: string;
      coords: any[];
      color: string;
      popup: string;
      fallback: boolean;
      lineKey?: string;
      source?: "rail_graph" | "legacy" | "walk";
      isTransfer?: boolean;
      tripId?: string | number;
      segmentIndex?: number;
    }
    const routeItems: RouteItem[] = [];

    tripSegmentsGeometry.forEach((seg: any) => {
      if (seg.isMulti) {
        seg.coords.forEach((part: any[], index: number) => {
          routeItems.push({
            id: `${seg.id}_part_${index}`,
            coords: part,
            color: seg.color,
            popup: seg.popup,
            fallback: seg.fallback,
            lineKey: seg.lineKey,
            source: seg.source,
            isTransfer: seg.isTransfer,
            tripId: seg.tripId,
            segmentIndex: seg.segmentIndex,
          });
        });
      } else {
        routeItems.push({
          id: seg.id,
          coords: seg.coords,
          color: seg.color,
          popup: seg.popup,
          fallback: seg.fallback,
          lineKey: seg.lineKey,
          source: seg.source,
          isTransfer: seg.isTransfer,
          tripId: seg.tripId,
          segmentIndex: seg.segmentIndex,
        });
      }
    });

    // Add walk paths from trips
    const trips = useStore.getState().trips;
    trips.forEach((t) => {
      if (t.isWalk && t.walkPath) {
        routeItems.push({
          id: `walk_${t.id}`,
          coords: t.walkPath,
          color: t.walkType === "tree" ? "#16a34a" : "#9333ea", // Green vs Purple
          popup: `${t.walkType === "tree" ? "环保/步行" : "UFO/步行"}: ${t.date}`,
          fallback: true, // Forces dashArray '5, 10' later in the sync renderer
          lineKey: undefined,
          source: "walk",
        });
      }
    });

    const ratioAtRoutePoint = (item: RouteItem, latlng: L.LatLng) => {
      if (!mapInstance.current || item.coords.length < 2) return 0;
      const clickPoint = mapInstance.current.latLngToLayerPoint(latlng);
      const points = item.coords.map((coord) => mapInstance.current!.latLngToLayerPoint(coord as L.LatLngExpression));
      let total = 0;
      const segmentLengths: number[] = [];
      for (let index = 1; index < points.length; index++) {
        const length = points[index - 1].distanceTo(points[index]);
        segmentLengths.push(length);
        total += length;
      }
      if (total <= 0) return 0;

      let bestDistance = Number.POSITIVE_INFINITY;
      let bestAlong = 0;
      let cursor = 0;
      for (let index = 1; index < points.length; index++) {
        const start = points[index - 1];
        const end = points[index];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSq = dx * dx + dy * dy;
        const localT = lengthSq <= 0
          ? 0
          : Math.max(0, Math.min(1, ((clickPoint.x - start.x) * dx + (clickPoint.y - start.y) * dy) / lengthSq));
        const projected = L.point(start.x + dx * localT, start.y + dy * localT);
        const distance = clickPoint.distanceTo(projected);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestAlong = cursor + segmentLengths[index - 1] * localT;
        }
        cursor += segmentLengths[index - 1];
      }
      return Math.max(0, Math.min(1, bestAlong / total));
    };

    const activateRouteItem = (item: RouteItem, event: L.LeafletMouseEvent) => {
      if (item.source === "walk" || item.isTransfer) return;
      L.DomEvent.stopPropagation(event);
      const projectionSource = item.source === "rail_graph" ? "rail_graph_runtime" : "legacy_app";
      const mapPoint = { lat: event.latlng.lat, lng: event.latlng.lng };
      const tripRatio = ratioAtRoutePoint(item, event.latlng);
      setActiveMileageLine({ lineKey: item.lineKey ?? null, source: projectionSource });
      openMileageEventsPanel({
        mode: "create",
        lineKey: item.lineKey,
        source: projectionSource,
        create: {
          source: item.source === "rail_graph" ? "trip" : "map",
          tripId: item.tripId,
          tripSegmentIndex: item.segmentIndex,
          tripRatio,
          lineKey: item.source === "legacy" ? item.lineKey : undefined,
          mapPoint,
          title: i18next.t("mileageEvents.routeDraftTitle", "Route event"),
          tags: ["trip-event"],
        },
      });
    };

    syncLeafletLayerGroup<RouteItem>(
      routeLayer.current,
      routeItems,
      (item) => item.id,
      (item) => {
        const isTransfer = item.isTransfer;
        const activeRoute = isActiveRouteItem(item);
        const dimRoute = !!activeMileageLineKey && !activeRoute && item.source !== "walk";
        const targetWeight = activeRoute ? zoomWeight + 4 : zoomWeight;
        const targetOpacity = activeRoute ? 1 : dimRoute ? 0.24 : isTransfer ? 0.5 : 0.9;
        const options = {
          renderer: routeRendererRef.current,
          color: item.color,
          weight: targetWeight,
          opacity: targetOpacity,
          lineCap: "round",
          smoothFactor: 0.2,
          dashArray: item.fallback ? "5, 10" : isTransfer ? "4, 8" : undefined,
          className: `rail-route-line rail-route-${item.source ?? "legacy"}${item.fallback ? " rail-route-fallback" : ""}${activeRoute ? " rail-route-active-mileage" : ""}`,
          pane: "routePane",
        };
        const pl = L.polyline(
          item.coords,
          options as L.PolylineOptions,
        ).bindPopup(item.popup);
        if (item.source !== "walk" && !item.isTransfer) {
          const routeClickHandler = (event: L.LeafletMouseEvent) => activateRouteItem(item, event);
          pl.on("click", routeClickHandler);
          (pl as any)._routeClickHandler = routeClickHandler;
        }
        (pl as any)._cachedCoords = item.coords;
        return pl;
      },
      (layer, item) => {
        const pl = layer as L.Polyline & {
          _cachedCoords?: any[];
          _routeClickHandler?: (event: L.LeafletMouseEvent) => void;
        };

        // setLatLngs is an extremely expensive operation in Leaflet.
        // Only call it if the coordinates actually changed (reference check).
        if (pl._cachedCoords !== item.coords) {
          pl.setLatLngs(item.coords);
          pl._cachedCoords = item.coords;
        }

        // setStyle triggers DOM updates. Check before applying.
        const currentWeight = (pl.options as L.PolylineOptions).weight;
        const currentColor = (pl.options as L.PolylineOptions).color;
        const currentDash = (pl.options as L.PolylineOptions).dashArray;
        const currentOpacity = (pl.options as L.PolylineOptions).opacity;

        const isTransfer = item.isTransfer;
        const activeRoute = isActiveRouteItem(item);
        const dimRoute = !!activeMileageLineKey && !activeRoute && item.source !== "walk";
        const targetWeight = activeRoute ? zoomWeight + 4 : zoomWeight;
        const targetDash = item.fallback
          ? "5, 10"
          : isTransfer
            ? "4, 8"
            : undefined;
        const targetOpacity = activeRoute ? 1 : dimRoute ? 0.24 : isTransfer ? 0.5 : 0.9;

        if (
          currentWeight !== targetWeight ||
          currentColor !== item.color ||
          currentDash !== targetDash ||
          currentOpacity !== targetOpacity
        ) {
          pl.setStyle({
            color: item.color,
            weight: targetWeight,
            dashArray: targetDash,
            opacity: targetOpacity,
          });
        }

        const routeElement = pl.getElement();
        if (routeElement) {
          routeElement.classList.toggle("rail-route-active-mileage", activeRoute);
        }

        if (pl.getPopup()?.getContent() !== item.popup) {
          pl.bindPopup(item.popup);
        }

        if (pl._routeClickHandler) {
          pl.off("click", pl._routeClickHandler);
          pl._routeClickHandler = undefined;
        }
        if (item.source !== "walk" && !item.isTransfer) {
          const routeClickHandler = (event: L.LeafletMouseEvent) => activateRouteItem(item, event);
          pl.on("click", routeClickHandler);
          pl._routeClickHandler = routeClickHandler;
        }
      },
    );
  };

  const renderPins = () => {
    if (!pinsLayer.current) return;

    const list = editingPin
      ? [...pins.filter((p) => p.id !== editingPin.id), editingPin]
      : pins;

    syncLeafletLayerGroup(
      pinsLayer.current,
      list,
      (pin) => pin.id,
      (pin) => {
        const isEditing = editingPin?.id === pin.id;
        const icon = L.divIcon({
          className: "pin-marker-icon",
          html: `<div class="pin-content ${isEditing ? "dragging" : ""}" style="background:${pin.color}; border-color:${isEditing ? "#ffff00" : "white"}; transform:${isEditing ? "scale(1.2) rotate(45deg)" : ""}"> ${pin.type === "photo" ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'} </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        });

        const marker = L.marker([pin.lat, pin.lng], {
          icon,
          draggable: true,
          zIndexOffset: isEditing ? 1000 : 0,
        });
        marker.on("dragstart", () => {
          isDraggingRef.current = true;
          setEditingPin({ ...pin });
          const currentPinMode = useStore.getState().pinMode;
          if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
        });
        marker.on("dragend", (e) => {
          isDraggingRef.current = false;
          const { lat, lng } = e.target.getLatLng();
          let newPos = {
            lat,
            lng,
            lineKey: pin.lineKey,
            percentage: pin.percentage,
          };
          const currentPinMode = useStore.getState().pinMode;
          if (currentPinMode === PinMode.Snap) {
            const snap = findNearestPointOnLine(
              useStore.getState().railwayData,
              lat,
              lng,
            );
            newPos = { ...newPos, ...snap };
            e.target.setLatLng(newPos);
          }
          setEditingPin((prev) =>
            prev && prev.id === pin.id
              ? { ...prev, ...newPos }
              : { ...pin, ...newPos },
          );
          if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
        });
        marker.on("click", () => {
          setEditingPin(pin);
          const currentPinMode = useStore.getState().pinMode;
          if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
        });
        return marker;
      },
      (layer, pin) => {
        const marker = layer as L.Marker & {
          _cachedLat?: number;
          _cachedLng?: number;
          _cachedIsEditing?: boolean;
          _cachedColor?: string;
        };
        const isEditing = editingPin?.id === pin.id;

        if (marker._cachedLat !== pin.lat || marker._cachedLng !== pin.lng) {
          marker.setLatLng([pin.lat, pin.lng]);
          marker._cachedLat = pin.lat;
          marker._cachedLng = pin.lng;
        }

        if (
          marker._cachedIsEditing !== isEditing ||
          marker._cachedColor !== pin.color
        ) {
          const icon = L.divIcon({
            className: "pin-marker-icon",
            html: `<div class="pin-content ${isEditing ? "dragging" : ""}" style="background:${pin.color}; border-color:${isEditing ? "#ffff00" : "white"}; transform:${isEditing ? "scale(1.2) rotate(45deg)" : ""}"> ${pin.type === "photo" ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'} </div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
          });
          marker.setIcon(icon);
          marker.setZIndexOffset(isEditing ? 1000 : 0);

          marker._cachedIsEditing = isEditing;
          marker._cachedColor = pin.color;
        }
      },
    );
  };

  const renderMileageEvents = () => {
    if (!mileageEventsLayer.current || !mapInstance.current) return;

    const map = mapInstance.current;
    const zoom = map.getZoom() ?? mapZoom;
    const cellPx = zoom < 9 ? 132 : zoom < 11 ? 104 : zoom < 13 ? 76 : zoom < 15 ? 52 : 1;
    const projected = boundMileageEventsForRichDisplay(mileageUserEvents, railwayData, trips)
      .filter((entry) => entry.bound.coordinates);

    type EventMarkerItem = {
      id: string;
      lat: number;
      lng: number;
      color: string;
      eventIds: string[];
      titles: string[];
      lineKeys: Set<string>;
      sourceKinds: Set<"rail_graph" | "legacy">;
      selected: boolean;
      activeLine: boolean;
      dimmed: boolean;
      sumLat: number;
      sumLng: number;
    };

    const markerMatchesActiveLine = (lineKeys: Set<string>, sourceKinds: Set<"rail_graph" | "legacy">) => {
      if (!activeMileageLineKey) return false;
      if (lineKeys.has(activeMileageLineKey)) return true;
      return sourceKinds.has("rail_graph") && activeMileageLineKey.startsWith("rail-graph:");
    };

    const grouped = new Map<string, EventMarkerItem>();
    projected.forEach((entry) => {
      const coordinates = entry.bound.coordinates;
      if (!coordinates) return;
      const rawColor = entry.lineContext.source === "rail_graph_runtime"
        ? entry.lineContext.segment.displayColor || "#059669"
        : entry.lineContext.line.meta.color || "#059669";
      const lineColor = /^#[0-9a-f]{3,8}$/i.test(rawColor) ? rawColor : "#059669";
      const sourceKind = entry.lineContext.source === "rail_graph_runtime" ? "rail_graph" : "legacy";
      const activeLine = markerMatchesActiveLine(new Set([entry.lineContext.lineKey]), new Set([sourceKind]));
      const layerPoint = map.latLngToLayerPoint([coordinates[1], coordinates[0]]);
      const key = zoom >= 15
        ? [
            "exact",
            entry.lineContext.lineKey,
            Math.round(entry.bound.event.mileage.distanceMeters / 10),
          ].join(":")
        : [
            "grid",
            Math.floor(layerPoint.x / cellPx),
            Math.floor(layerPoint.y / cellPx),
          ].join(":");
      const existing = grouped.get(key);
      if (existing) {
        existing.eventIds.push(entry.bound.event.id);
        existing.titles.push(entry.bound.event.title);
        existing.lineKeys.add(entry.lineContext.lineKey);
        existing.sourceKinds.add(sourceKind);
        existing.selected = existing.selected || entry.bound.event.id === selectedMileageEventId;
        existing.activeLine = existing.activeLine || activeLine;
        existing.dimmed = !!activeMileageLineKey && !existing.activeLine && !existing.selected;
        existing.sumLat += coordinates[1];
        existing.sumLng += coordinates[0];
        existing.lat = existing.sumLat / existing.eventIds.length;
        existing.lng = existing.sumLng / existing.eventIds.length;
      } else {
        grouped.set(key, {
          id: key,
          lat: coordinates[1],
          lng: coordinates[0],
          color: lineColor,
          eventIds: [entry.bound.event.id],
          titles: [entry.bound.event.title],
          lineKeys: new Set([entry.lineContext.lineKey]),
          sourceKinds: new Set([sourceKind]),
          selected: entry.bound.event.id === selectedMileageEventId,
          activeLine,
          dimmed: !!activeMileageLineKey && !activeLine && entry.bound.event.id !== selectedMileageEventId,
          sumLat: coordinates[1],
          sumLng: coordinates[0],
        });
      }
    });

    syncLeafletLayerGroup<EventMarkerItem>(
      mileageEventsLayer.current,
      Array.from(grouped.values()),
      (item) => item.id,
      (item) => {
        const layer = L.marker([item.lat, item.lng], {
          pane: "mileageEventsPane",
          icon: createMileageEventIcon(item),
          zIndexOffset: item.selected ? 1200 : item.activeLine ? 980 : item.eventIds.length > 1 ? 900 : 800,
        });

        const title = mileageEventMarkerTitle(item);
        layer.bindTooltip(title, { className: "mileage-event-tooltip", direction: "top", offset: [0, -10] });
        layer.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          setSelectedMileageEventId(item.eventIds[0]);
          selectMileageEventOnMap({
            eventId: item.eventIds[0],
            lineKey: item.lineKeys.size === 1
              ? Array.from(item.lineKeys)[0]
              : undefined,
            source: item.sourceKinds.has("rail_graph") ? "rail_graph_runtime" : "legacy_app",
          });
        });
        (layer as any)._cachedLat = item.lat;
        (layer as any)._cachedLng = item.lng;
        (layer as any)._cachedColor = item.color;
        (layer as any)._cachedCount = item.eventIds.length;
        (layer as any)._cachedSelected = item.selected;
        (layer as any)._cachedMultiLine = item.lineKeys.size > 1;
        (layer as any)._cachedSourceKey = Array.from(item.sourceKinds).sort().join(":");
        (layer as any)._cachedTitle = title;
        return layer;
      },
      (layer, item) => {
        const marker = layer as L.Marker & {
          _cachedLat?: number;
          _cachedLng?: number;
          _cachedColor?: string;
          _cachedCount?: number;
          _cachedSelected?: boolean;
          _cachedActiveLine?: boolean;
          _cachedDimmed?: boolean;
          _cachedMultiLine?: boolean;
          _cachedSourceKey?: string;
          _cachedTitle?: string;
        };
        const count = item.eventIds.length;
        const sourceKey = Array.from(item.sourceKinds).sort().join(":");
        const title = mileageEventMarkerTitle(item);
        if (marker._cachedLat !== item.lat || marker._cachedLng !== item.lng) {
          marker.setLatLng([item.lat, item.lng]);
          marker._cachedLat = item.lat;
          marker._cachedLng = item.lng;
        }
        if (
          marker._cachedColor !== item.color ||
          marker._cachedCount !== count ||
          marker._cachedSelected !== item.selected ||
          marker._cachedActiveLine !== item.activeLine ||
          marker._cachedDimmed !== item.dimmed ||
          marker._cachedMultiLine !== item.lineKeys.size > 1 ||
          marker._cachedSourceKey !== sourceKey
        ) {
          marker.setIcon(createMileageEventIcon(item));
          marker.setZIndexOffset(item.selected ? 1200 : item.activeLine ? 980 : count > 1 ? 900 : 800);
          marker._cachedColor = item.color;
          marker._cachedCount = count;
          marker._cachedSelected = item.selected;
          marker._cachedActiveLine = item.activeLine;
          marker._cachedDimmed = item.dimmed;
          marker._cachedMultiLine = item.lineKeys.size > 1;
          marker._cachedSourceKey = sourceKey;
        }
        if (marker._cachedTitle !== title) {
          marker.unbindTooltip();
          marker.bindTooltip(title, { className: "mileage-event-tooltip", direction: "top", offset: [0, -10] });
          marker._cachedTitle = title;
        }
      },
    );
  };

  const mileageEventMarkerSourceLabel = (sourceKinds: Set<"rail_graph" | "legacy">) => {
    if (sourceKinds.size > 1) return i18next.t("mileageEvents.sourceMixed", "Mixed sources");
    if (sourceKinds.has("rail_graph")) return i18next.t("mileageEvents.sourceRailGraph", "Rail graph snapshot");
    return i18next.t("mileageEvents.sourceLegacy", "GeoJSON axis");
  };

  const mileageEventMarkerTitle = (item: {
    eventIds: string[];
    titles: string[];
    sourceKinds: Set<"rail_graph" | "legacy">;
  }) => {
    const source = mileageEventMarkerSourceLabel(item.sourceKinds);
    if (item.eventIds.length > 1) {
      return i18next.t("mileageEvents.markerClusterWithSource", "{{count}} events · {{source}}", {
        count: item.eventIds.length,
        source,
      });
    }
    return i18next.t("mileageEvents.markerSingleWithSource", "{{title}} · {{source}}", {
      title: item.titles[0],
      source,
    });
  };

  const createMileageEventIcon = (item: {
    color: string;
    eventIds: string[];
    lineKeys: Set<string>;
    sourceKinds: Set<"rail_graph" | "legacy">;
    selected: boolean;
    activeLine: boolean;
    dimmed: boolean;
  }) => {
    const count = item.eventIds.length;
    const size = item.selected ? 38 : item.activeLine ? 30 : count > 1 ? Math.min(38, 26 + Math.log2(count + 1) * 6) : 24;
    const clusterClass = count > 1 ? "is-cluster" : "is-single";
    const selectedClass = item.selected ? "is-selected" : "";
    const activeClass = item.activeLine ? "is-active-line" : "";
    const dimmedClass = item.dimmed ? "is-dimmed" : "";
    const mixedClass = item.lineKeys.size > 1 ? "is-mixed" : "";
    const sourceClass = item.sourceKinds.size > 1
      ? "is-source-mixed"
      : item.sourceKinds.has("rail_graph")
        ? "is-rail-graph"
        : "is-legacy";
    const html = `
      <div class="mileage-event-marker ${clusterClass} ${selectedClass} ${activeClass} ${dimmedClass} ${mixedClass} ${sourceClass}" style="--event-color:${item.color}; --event-size:${size}px">
        <span class="mileage-event-marker-core">${count > 1 ? count : ""}</span>
      </div>
    `;
    return L.divIcon({
      className: "mileage-event-marker-shell",
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {showDebugZoom && (
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 1000,
            backgroundColor: "rgba(15, 23, 42, 0.8)",
            color: "#f8fafc",
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: "bold",
            pointerEvents: "none",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          Zoom: {mapZoom}
        </div>
      )}
    </div>
  );
};
