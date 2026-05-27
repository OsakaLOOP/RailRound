// ============================================================
// MVP 可视化 — Leaflet 地图视图
//
// 输入 BaseTopologyLayer + AnnotatedFeatureCollection, 把所有
// station / platform / edge 渲染为 Leaflet 图层。
// 暴露 hover / click 事件 + 高亮 API 给外部 (list-view) 联动。
// ============================================================

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { computeSpeedProfile, sampleSpeedProfile, constantSpeedDuration, type SpeedProfile } from "./path-animation-speed";

import type {
  BaseTopologyLayer,
  TopologyEdge,
} from "../rail-graph-v1/base-topology.types";
import type {
  AnnotatedFeature,
  AnnotatedFeatureCollection,
} from "../rail-graph-v1/annotation.types";
import type {
  GeoJSONLineString,
  GeoJSONMultiLineString,
  GeoJSONPoint,
  GeoJSONPolygon,
  GeoJSONPosition,
} from "../rail-graph-v1/geojson";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ResolvedChain } from "../rail-graph-v1/chain.types";

// ── 0. CSS Styles injection for Path Animation ──────────────────
const STYLE_ID = "mvp-map-view-animation-styles";
const STYLES = `
/* Train marker style */
.path-train-marker {
  display: flex;
  align-items: center;
  justify-content: center;
}
.path-train-dot {
  width: 12px;
  height: 12px;
  background: #ffffff;
  border: 3px solid #10b981;
  border-radius: 50%;
  box-shadow: 0 0 10px #10b981, 0 0 20px #10b981;
}
.path-train-pulse {
  position: absolute;
  width: 24px;
  height: 24px;
  border: 2px solid #10b981;
  border-radius: 50%;
  animation: train-pulse-anim 1.2s infinite ease-out;
  opacity: 0;
  pointer-events: none;
}
@keyframes train-pulse-anim {
  0% { transform: scale(0.5); opacity: 0.8; }
  100% { transform: scale(1.8); opacity: 0; }
}

/* Event marker style */
.path-event-marker {
  display: flex;
  align-items: center;
  justify-content: center;
}
.path-event-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
}
.path-event-dot.origin { background: #ffffff; border: 3.5px solid #0891b2; color: #0891b2; }
.path-event-dot.stop { background: #ffffff; border: 3.5px solid #16a34a; color: #16a34a; }
.path-event-dot.reversal { background: #ffffff; border: 3.5px solid #d97706; color: #d97706; }
.path-event-dot.terminus { background: #ffffff; border: 3.5px solid #ef4444; color: #ef4444; }

.path-event-pulse {
  position: absolute;
  width: 32px;
  height: 32px;
  border: 2px solid currentColor;
  border-radius: 50%;
  animation: event-pulse-anim 1.5s infinite ease-out;
  opacity: 0;
}
@keyframes event-pulse-anim {
  0% { transform: scale(0.4); opacity: 1; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* Tooltip badge styling */
.path-event-badge {
  background: #1e293b;
  color: #f8fafc;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  border: 1px solid #334155;
  white-space: nowrap;
  pointer-events: none;
}
.path-event-badge.origin { border-color: #0891b2; }
.path-event-badge.stop { border-color: #16a34a; }
.path-event-badge.reversal { border-color: #d97706; }
.path-event-badge.terminus { border-color: #ef4444; }
.leaflet-tooltip.path-event-tooltip {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
}
.leaflet-tooltip-top.path-event-tooltip::before {
  border-top-color: #1e293b;
}
`;
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// ── 1. 颜色 / 样式常量 ──────────────────────────────────────

const COLORS = {
  up: "#1d4ed8",
  down: "#b91c1c",
  bidirectional: "#94a3b8",
  reversible: "#7e22ce",
  connector: "#94a3b8",
  station: "#000000",
  platform: "#fde047",
  highlight_primary_stroke: "#ffffff",
  highlight_related: "#f59e0b",
  highlight_path: "#16a34a",
  highlight_path_endpoint: "#15803d",
  darken_opacity: 0.15,
} as const;

const POSITRON_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const POSITRON_ATTR = "&copy; OpenStreetMap contributors &copy; CARTO";

// ── 2. Public API ───────────────────────────────────────────

export interface MapView {
  /**
   * 增量更新地图. decisionsVersion 与 (topoRef, geoJsonRef) 三者全等时, update 早返回 (避免全量重绘).
   * @param decisionsVersion cleanDecisions 内容版本号; caller 自增, 避免 mapView 重算 Map 内容
   */
  update(topo: BaseTopologyLayer, geoJson: AnnotatedFeatureCollection, cleanDecisions?: Map<string, string>, decisionsVersion?: number): void;
  highlightEntities(primaryRefs: EntityRef[], relatedRefs?: EntityRef[]): void;
  highlightPath(edgeSequence: EntityRef[], turnbackEdgeIndices?: number[], resolvedChain?: ResolvedChain): void;
  clearHighlight(): void;
  clearEntityHighlight(): void;
  clearPathHighlight(): void;
  onHover(handler: (ref: EntityRef | null) => void): void;
  onClick(handler: (ref: EntityRef, fid?: string) => void): void;
  setBaseLayer(kind: "positron" | "plain"): void;
  fitToData(): void;
  fitToEntities(refs: string[]): void;
  onBoxSelect(handler: (fids: string[]) => void): void;
  clearBoxSelectHighlight(): void;
  highlightBoxSelect(fids: string[]): void;
  destroy(): void;
}

// ── 3. Internal state ───────────────────────────────────────

type LayerKind = "station" | "platform" | "edge" | "signal";

interface LayerEntry {
  layer: L.Path;          // polyline/polygon/circleMarker (都继承 L.Path)
  baseStyle: L.PathOptions;
  kind: LayerKind;
  fid?: string;
}

interface InternalState {
  map: L.Map;
  tileLayer: L.TileLayer | null;
  baseLayerKind: "positron" | "plain";
  entityLayers: Map<string, LayerEntry>;
  /** edge.id → 对应 topo edge (用于 path bearing 计算) */
  edgeById: Map<string, TopologyEdge>;
  /** node id → LatLng (用于 path entry-node 追踪) */
  nodeLatLngById: Map<string, L.LatLng>;
  featureGroup: L.FeatureGroup;         // 容纳所有 entity layers, 用于 fitBounds
  arrowLayer: L.LayerGroup;             // 方向箭头 markers
  signalLayer: L.LayerGroup;            // 信号机 markers
  arrowById: Map<string, L.Marker>;     // edgeId → 方向箭头 marker
  pathHighlightGroup: L.LayerGroup;     // 路径高亮 (绿色叠加)
  pathEndpointGroup: L.LayerGroup;      // 路径端点 marker
  pathArrowLayer: L.LayerGroup;         // 路径高亮方向箭头
  highlightedPrimaries: Set<string>;
  highlightedRelated: Set<string>;
  /** 被路径暗淡的 arrow edge.id (用于 clearPathHighlight 还原 opacity) */
  dimmedArrowKeys: Set<string>;
  hoverHandlers: Array<(ref: EntityRef | null) => void>;
  clickHandlers: Array<(ref: EntityRef, fid?: string) => void>;
  boxSelectHandlers: Array<(fids: string[]) => void>;
  boxHighlightGroup: L.LayerGroup;
  boxHighlightFidSig: string | null;
  animationFrameId?: number;
  animationTimeouts?: number[];
  originalZoom?: number;
  originalCenter?: L.LatLng;
  isAnimatingPath?: boolean;
}

// ── 4. Factory ──────────────────────────────────────────────

export function createMapView(container: HTMLElement): MapView {
  ensureStyles();
  const map = L.map(container, {
    center: [35.6900, 139.7040],
    zoom: 16,
    zoomSnap: 0.25,
    preferCanvas: false,
  });

  const state: InternalState = {
    map,
    tileLayer: null,
    baseLayerKind: "positron",
    entityLayers: new Map(),
    edgeById: new Map(),
    nodeLatLngById: new Map(),
    featureGroup: L.featureGroup().addTo(map),
    arrowLayer: L.layerGroup().addTo(map),
    signalLayer: L.layerGroup().addTo(map),
    arrowById: new Map(),
    pathHighlightGroup: L.layerGroup().addTo(map),
    pathEndpointGroup: L.layerGroup().addTo(map),
    pathArrowLayer: L.layerGroup().addTo(map),
    highlightedPrimaries: new Set(),
    highlightedRelated: new Set(),
    dimmedArrowKeys: new Set(),
    hoverHandlers: [],
    clickHandlers: [],
    boxSelectHandlers: [],
    boxHighlightGroup: L.layerGroup().addTo(map),
    boxHighlightFidSig: null,
    animationTimeouts: [],
  };

  applyBaseLayer(state, "positron");

  // Shift + drag box selection / Shift + 鼠标拖拽框选
  map.on("mousedown", (e) => {
    if (!e.originalEvent.shiftKey) return;
    map.dragging.disable();
    const start = e.latlng;
    let rect = L.rectangle(L.latLngBounds(start, start), { color: "#ff00aa", weight: 2, dashArray: "4,2" }).addTo(map);

    const mm = (ev: L.LeafletMouseEvent) => {
      rect.setBounds(L.latLngBounds(start, ev.latlng));
    };

    const mu = (ev: L.LeafletMouseEvent) => {
      map.off("mousemove", mm);
      map.off("mouseup", mu);
      map.removeLayer(rect);
      map.dragging.enable();

      const finalBounds = L.latLngBounds(start, ev.latlng);
      const hits: string[] = [];
      state.entityLayers.forEach((entry) => {
        const layer = entry.layer;
        if (!map.hasLayer(layer)) return;
        if (!entry.fid) return;
        if (layerHitsBounds(layer, finalBounds, entry.kind)) {
          hits.push(entry.fid);
        }
      });

      if (hits.length > 0) {
        state.boxSelectHandlers.forEach((h) => h(hits));
      }
    };

    map.on("mousemove", mm);
    map.on("mouseup", mu);
  });

  const mapViewInstance: MapView = {
    lastRefs: null,
    update(topo, geoJson, cleanDecisions, decisionsVersion) {
      if (
        mapViewInstance.lastRefs &&
        mapViewInstance.lastRefs.topoRef === topo &&
        mapViewInstance.lastRefs.geoJsonRef === geoJson &&
        mapViewInstance.lastRefs.decisionsVersion === decisionsVersion
      ) {
        return;
      }
      mapViewInstance.lastRefs = {
        topoRef: topo,
        geoJsonRef: geoJson,
        decisionsVersion: decisionsVersion ?? null,
      };
      rebuildLayers(state, topo, geoJson, cleanDecisions);
    },
    highlightEntities(primary, related) {
      applyHighlight(state, primary, related ?? []);
    },
    highlightPath(edgeSequence, turnbackEdgeIndices, resolvedChain) {
      applyPathHighlight(state, edgeSequence, turnbackEdgeIndices, resolvedChain);
    },
    clearHighlight() {
      clearAllHighlight(state);
    },
    clearEntityHighlight() {
      resetHighlightedStyles(state);
    },
    clearPathHighlight() {
      clearPathHighlight(state);
    },
    onHover(handler) {
      state.hoverHandlers.push(handler);
    },
    onClick(handler) {
      state.clickHandlers.push(handler);
    },
    setBaseLayer(kind) {
      applyBaseLayer(state, kind);
    },
    fitToData() {
      if (state.entityLayers.size === 0) return;
      const bounds = state.featureGroup.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    },
    fitToEntities(refs) {
      if (typeof window === "undefined") return;
      const bounds = L.latLngBounds([]);
      for (const r of refs) {
        const entry = state.entityLayers.get(r);
        if (entry) {
          if (typeof (entry.layer as any).getBounds === "function") {
            bounds.extend((entry.layer as any).getBounds());
          } else if (typeof (entry.layer as any).getLatLng === "function") {
            bounds.extend((entry.layer as any).getLatLng());
          }
        }
      }
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    },
    onBoxSelect(handler) {
      state.boxSelectHandlers.push(handler);
    },
    clearBoxSelectHighlight() {
      state.boxHighlightGroup.clearLayers();
    },
    highlightBoxSelect(fids) {
      const sig = fids.length === 0 ? "" : [...fids].sort().join("|");
      if (sig === state.boxHighlightFidSig) return;
      state.boxHighlightFidSig = sig;
      state.boxHighlightGroup.clearLayers();
      const fidSet = new Set(fids);
      state.entityLayers.forEach((entry) => {
        if (entry.fid && fidSet.has(entry.fid)) {
          let highlightLayer: L.Layer;
          if (entry.kind === "edge") {
            const poly = entry.layer as L.Polyline;
            highlightLayer = L.polyline(poly.getLatLngs() as L.LatLngExpression[], {
              color: "#ff00aa",
              weight: 5,
              opacity: 0.85,
              interactive: false,
            });
          } else if (entry.kind === "platform") {
            const poly = entry.layer as L.Polygon;
            highlightLayer = L.polygon(poly.getLatLngs() as L.LatLngExpression[], {
              color: "#ff00aa",
              weight: 2,
              fillColor: "#ff00aa",
              fillOpacity: 0.4,
              interactive: false,
            });
          } else {
            const marker = entry.layer as L.CircleMarker;
            highlightLayer = L.circleMarker(marker.getLatLng(), {
              color: "#ff00aa",
              radius: 6,
              fillOpacity: 0.6,
              interactive: false,
            });
          }
          highlightLayer.addTo(state.boxHighlightGroup);
        }
      });
    },
    destroy() {
      map.remove();
    },
  };
  return mapViewInstance;
}

// ── 5. Base layer ───────────────────────────────────────────

function applyBaseLayer(state: InternalState, kind: "positron" | "plain"): void {
  if (state.tileLayer) {
    state.map.removeLayer(state.tileLayer);
    state.tileLayer = null;
  }
  state.baseLayerKind = kind;
  if (kind === "positron") {
    state.tileLayer = L.tileLayer(POSITRON_URL, {
      attribution: POSITRON_ATTR,
      maxZoom: 19,
      subdomains: "abcd",
    });
    state.tileLayer.addTo(state.map);
    state.tileLayer.bringToBack();
  }
  // plain: 不加 tileLayer, 显示空白底
}

// ── 6. Rebuild layers (核心渲染) ────────────────────────────

function rebuildLayers(
  state: InternalState,
  topo: BaseTopologyLayer,
  geoJson: AnnotatedFeatureCollection,
  cleanDecisions?: Map<string, string>,
): void {
  // 清空旧 layers
  state.featureGroup.clearLayers();
  state.arrowLayer.clearLayers();
  state.signalLayer.clearLayers();
  state.entityLayers.clear();
  state.edgeById.clear();
  state.nodeLatLngById.clear();
  state.arrowById.clear();
  clearAllHighlight(state);

  const annotationIdToFeature = new Map<string, AnnotatedFeature>();
  for (const feature of geoJson.features) {
    const id = feature.properties.railGraph?.id;
    if (id) annotationIdToFeature.set(id, feature);
  }

  // Render raw features from geoJson directly
  for (const feature of geoJson.features) {
    const properties = (feature.properties || {}) as any;
    const annotation = properties.railGraph;
    if (!annotation) continue;
    const ref = annotation.id;
    if (!ref) continue;

    const fid = `${properties.osm_type || ""}:${properties.osm_id || ""}:${properties.class_main || ""}:${properties.source_line_name || ""}`;
    const decision = cleanDecisions?.get(fid);
    const matchLevel = properties.match_level || "all";

    if (feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString") {
      const coords = extractEdgeCoordinates(feature, undefined) ?? undefined;
      if (!coords || coords.length < 2) continue;

      const latLngs = coords.map((c) => [c[1], c[0]] as [number, number]);
      
      let baseStyle: L.PathOptions;
      if (decision === "remove") {
        baseStyle = {
          color: "#94a3b8", // gray
          weight: 1.5,
          opacity: 0.25,
          dashArray: "4,4",
        };
      } else {
        const level = matchLevel || "all";
        let color = "#2563eb"; // default blue
        if (level === "high") color = "#16a34a"; // green
        else if (level === "medium") color = "#ca8a04"; // yellow/gold
        else if (level === "low") color = "#dc2626"; // red
        
        baseStyle = {
          color,
          weight: level === "low" ? 2.5 : 4,
          opacity: 0.9,
        };
      }

      const name = properties.name || properties.osm_id || "unnamed";
      const polyline = L.polyline(latLngs, baseStyle);
      polyline.bindTooltip(
        `<b>${escapeHtml(name)}</b><br/>` +
        `class: ${escapeHtml(properties.class_main || "—")}<br/>` +
        `osm: ${escapeHtml(properties.osm_type || "")}/${escapeHtml(properties.osm_id || "")}<br/>` +
        `match: ${escapeHtml(properties.match_level || "—")} (${(properties.match_score || 0).toFixed(2)})<br/>` +
        `nearest station: ${escapeHtml(properties.nearest_station || "—")}`,
        { sticky: true, direction: "top" },
      );
      bindLayerEvents(state, polyline, ref);
      polyline.addTo(state.featureGroup);
      state.entityLayers.set(ref, { layer: polyline, baseStyle, kind: "edge", fid });
    }
    else if (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") {
      const geom = extractPlatformGeometry(feature);
      if (!geom) continue;
      
      let baseStyle: L.PathOptions;
      if (decision === "remove") {
        baseStyle = {
          color: "#94a3b8",
          weight: 1,
          fillColor: "#cbd5e1",
          fillOpacity: 0.1,
          dashArray: "2,2",
        };
      } else {
        baseStyle = {
          color: "#a16207",
          weight: 1.5,
          fillColor: COLORS.platform,
          fillOpacity: 0.55,
        };
      }

      let layer: L.Path;
      if (geom.kind === "polygon") {
        const ringsLatLng = geom.rings.map((ring) => ring.map((c) => [c[1], c[0]] as [number, number]));
        layer = L.polygon(ringsLatLng, baseStyle);
      } else if (geom.kind === "line") {
        const linesLatLng = geom.lines.map((line) => line.map((c) => [c[1], c[0]] as [number, number]));
        layer = L.polyline(linesLatLng, {
          ...baseStyle,
          weight: 4,
          opacity: 0.9,
          fillOpacity: 0,
          dashArray: "6 3",
        });
      } else {
        const [lng, lat] = geom.coord;
        layer = L.circleMarker([lat, lng], {
          ...baseStyle,
          weight: 2,
          radius: 5,
          fillOpacity: 0.8,
        });
      }

      const name = properties.name || properties.osm_id || "platform";
      layer.bindTooltip(
        `<b>${escapeHtml(name)}</b><br/>` +
        `class: platform_area<br/>` +
        `nearest station: ${escapeHtml(properties.nearest_station || "—")}`,
        { sticky: true, direction: "top" },
      );
      bindLayerEvents(state, layer, ref);
      layer.addTo(state.featureGroup);
      state.entityLayers.set(ref, { layer, baseStyle, kind: "platform", fid });
    }
    else if (feature.geometry.type === "Point") {
      const coord = (feature.geometry as any).coordinates;
      if (!coord || coord.length < 2) continue;
      
      let baseStyle: L.PathOptions;
      const isStation = properties.class_main === "station" || properties.railway === "station" || properties.railway === "halt";
      
      if (decision === "remove") {
        baseStyle = {
          color: "#94a3b8",
          weight: 1,
          fillColor: "#cbd5e1",
          fillOpacity: 0.15,
          radius: 4,
        } as L.PathOptions & { radius: number };
      } else {
        if (isStation) {
          baseStyle = {
            color: COLORS.station,
            weight: 2,
            fillColor: "#ffffff",
            fillOpacity: 1,
            radius: 6,
          } as L.PathOptions & { radius: number };
        } else {
          baseStyle = {
            color: "#475569",
            weight: 1.5,
            fillColor: "#94a3b8",
            fillOpacity: 0.8,
            radius: 4,
          } as L.PathOptions & { radius: number };
        }
      }

      const marker = L.circleMarker([coord[1], coord[0]], baseStyle as L.CircleMarkerOptions);
      const name = properties.name || properties.osm_id || "station_point";
      marker.bindTooltip(
        `<b>${escapeHtml(name)}</b><br/>` +
        `class: ${escapeHtml(properties.class_main || properties.railway || "point")}`,
        { sticky: true, direction: "top" },
      );
      bindLayerEvents(state, marker, ref);
      marker.addTo(state.featureGroup);
      state.entityLayers.set(ref, { layer: marker, baseStyle, kind: "station", fid });
    }
  }

  // Draw topology-specific overlays on top if topo is available
  if (topo && topo.edges) {
    for (const edge of topo.edges) {
      let coords = edge.coordinates;
      if (!coords) {
        const sourceRef = edge.sourceSlice?.sourceFeatureRef;
        if (sourceRef) {
          const feature = annotationIdToFeature.get(sourceRef);
          if (feature) {
            coords = extractEdgeCoordinates(feature, edge.sourceSlice?.multiLineIndex) ?? undefined;
          }
        }
      }
      if (!coords || coords.length < 2) continue;

      state.edgeById.set(edge.id, edge);
      state.nodeLatLngById.set(edge.fromNodeRef, L.latLng(coords[0][1], coords[0][0]));
      state.nodeLatLngById.set(edge.toNodeRef, L.latLng(coords[coords.length - 1][1], coords[coords.length - 1][0]));

      const midLatLng = midpointAlong(coords);
      const bearing = computeBearing(coords[0], coords[coords.length - 1]);
      const arrowMarker = buildArrowMarker(midLatLng, edge, bearing);
      arrowMarker.addTo(state.arrowLayer);
      state.arrowById.set(edge.id, arrowMarker);
    }
  }

  if (topo && topo.platforms && topo.stations) {
    const stationFeatureById = new Map<string, AnnotatedFeature>();
    for (const station of topo.stations) {
      const f = annotationIdToFeature.get(station.id);
      if (f && f.geometry.type === "Point") stationFeatureById.set(station.id, f);
    }
    for (const platform of topo.platforms) {
      if (!platform.stationRef) continue;
      const stationFeature = stationFeatureById.get(platform.stationRef);
      if (!stationFeature) continue;
      const platformFeature = annotationIdToFeature.get(platform.id);
      if (!platformFeature) continue;
      const platformCenter = platformCentroidLatLng(platformFeature);
      if (!platformCenter) continue;
      const stationCoord = (stationFeature.geometry as GeoJSONPoint).coordinates;
      const stationLatLng: [number, number] = [stationCoord[1], stationCoord[0]];
      const bindLine = L.polyline([platformCenter, stationLatLng], {
        color: "#0891b2",
        weight: 1.5,
        opacity: 0.75,
        dashArray: "4 4",
        interactive: false,
      });
      bindLine.addTo(state.featureGroup);
    }
  }

  if (topo && topo.signals) {
    for (const signal of topo.signals) {
      const edgeCoords = getEdgeCoords(signal.edgeRef, topo, annotationIdToFeature);
      if (!edgeCoords) continue;
      const latLng = interpolateAlong(edgeCoords, signal.measure);
      const edgeBearing = computeBearing(edgeCoords[0], edgeCoords[edgeCoords.length - 1]);

      const facingSvg = buildSignalSvg(signal.facing, edgeBearing);
      const marker = L.marker(latLng, {
        icon: L.divIcon({
          className: "mvp-signal-marker",
          html: facingSvg,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        keyboard: false,
      });
      marker.bindTooltip(
        `<b>${escapeHtml(signal.name ?? signal.id)}</b><br/>` +
        `edge: ${escapeHtml(signal.edgeRef)}<br/>` +
        `measure: ${signal.measure}<br/>` +
        `facing: ${signal.facing}`,
        { sticky: true, direction: "top" },
      );
      bindLayerEvents(state, marker, signal.id);
      marker.addTo(state.signalLayer);

      state.entityLayers.set(signal.id, {
        layer: marker as unknown as L.Path,
        baseStyle: { facing: signal.facing, edgeBearing } as L.PathOptions & { facing?: string; edgeBearing?: number },
        kind: "signal",
      });
    }
  }
}

function extractEdgeCoordinates(
  feature: AnnotatedFeature,
  multiLineIndex: number | undefined,
): GeoJSONPosition[] | null {
  if (feature.geometry.type === "LineString") {
    return (feature.geometry as GeoJSONLineString).coordinates;
  }
  if (feature.geometry.type === "MultiLineString") {
    const idx = multiLineIndex ?? 0;
    return (feature.geometry as GeoJSONMultiLineString).coordinates[idx] ?? null;
  }
  return null;
}

type PlatformGeom =
  | { kind: "polygon"; rings: GeoJSONPosition[][] }
  | { kind: "line"; lines: GeoJSONPosition[][] }
  | { kind: "point"; coord: GeoJSONPosition };

/** Platform 几何 → 渲染用的归一化形式. 支持 Polygon/MultiPolygon/LineString/MultiLineString/Point. */
function extractPlatformGeometry(feature: AnnotatedFeature): PlatformGeom | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Polygon") {
    const rings = (g as GeoJSONPolygon).coordinates;
    if (!rings || rings.length === 0) return null;
    return { kind: "polygon", rings };
  }
  if (g.type === "MultiPolygon") {
    const polys = (g as { coordinates: GeoJSONPosition[][][] }).coordinates;
    // 取每个 polygon 的外环, 内洞简化忽略 (MVP).
    const outerRings = polys.map((p) => p?.[0]).filter((r): r is GeoJSONPosition[] => Array.isArray(r) && r.length > 0);
    if (outerRings.length === 0) return null;
    return { kind: "polygon", rings: outerRings };
  }
  if (g.type === "LineString") {
    const line = (g as GeoJSONLineString).coordinates;
    if (!line || line.length === 0) return null;
    return { kind: "line", lines: [line] };
  }
  if (g.type === "MultiLineString") {
    const lines = (g as GeoJSONMultiLineString).coordinates;
    if (!lines || lines.length === 0) return null;
    return { kind: "line", lines };
  }
  if (g.type === "Point") {
    return { kind: "point", coord: (g as GeoJSONPoint).coordinates };
  }
  return null;
}

/** Platform 几何重心 → leaflet [lat, lng]. 兼容 Polygon (ring 平均) / LineString (中点) / Point (原坐标). */
function platformCentroidLatLng(feature: AnnotatedFeature): [number, number] | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Polygon") {
    const ring = (g as GeoJSONPolygon).coordinates[0];
    if (!ring || ring.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of ring) { sx += p[0]; sy += p[1]; }
    return [sy / ring.length, sx / ring.length];
  }
  if (g.type === "LineString") {
    const coords = (g as { coordinates: GeoJSONPosition[] }).coordinates;
    if (coords.length === 0) return null;
    const mid = coords[Math.floor(coords.length / 2)];
    return [mid[1], mid[0]];
  }
  if (g.type === "Point") {
    const c = (g as GeoJSONPoint).coordinates;
    return [c[1], c[0]];
  }
  return null;
}

function edgeBaseStyle(edge: TopologyEdge): L.PathOptions {
  const color = colorForDirectionRole(edge.directionRole, edge.role);
  const isDashed = edge.directionRole === "reversible";
  const isConnector = edge.role === "connector";
  return {
    color,
    weight: isConnector || edge.directionRole === "bidirectional" ? 2 : 4,
    opacity: isConnector ? 0.6 : 0.9,
    dashArray: isDashed ? "6,4" : undefined,
    lineCap: "round",
    lineJoin: "round",
  };
}

function colorForDirectionRole(
  directionRole: TopologyEdge["directionRole"],
  role: TopologyEdge["role"],
): string {
  if (directionRole === "up") return COLORS.up;
  if (directionRole === "down") return COLORS.down;
  if (directionRole === "reversible") return COLORS.reversible;
  if (directionRole === "bidirectional") return COLORS.bidirectional;
  if (role === "connector") return COLORS.connector;
  return COLORS.connector;
}

// ── 7. Event binding ────────────────────────────────────────

function bindLayerEvents(state: InternalState, layer: L.Layer, ref: string): void {
  layer.on("mouseover", () => {
    state.hoverHandlers.forEach((h) => h(ref as EntityRef));
  });
  layer.on("mouseout", () => {
    state.hoverHandlers.forEach((h) => h(null));
  });
  layer.on("click", (e: L.LeafletEvent) => {
    L.DomEvent.stopPropagation(e as unknown as Event);
    const entry = state.entityLayers.get(ref);
    state.clickHandlers.forEach((h) => h(ref as EntityRef, entry?.fid));
  });
}

// ── 8. Highlight implementation ─────────────────────────────

function applyHighlight(
  state: InternalState,
  primary: EntityRef[],
  related: EntityRef[],
): void {
  // 还原上次的高亮
  resetHighlightedStyles(state);

  state.highlightedPrimaries = new Set(primary);
  state.highlightedRelated = new Set(related);

  for (const ref of primary) {
    const entry = state.entityLayers.get(ref);
    if (!entry) continue;
    applyPrimaryStyle(entry);
  }
  for (const ref of related) {
    if (state.highlightedPrimaries.has(ref)) continue;
    const entry = state.entityLayers.get(ref);
    if (!entry) continue;
    applyRelatedStyle(entry);
  }
}

function applyPrimaryStyle(entry: LayerEntry): void {
  const base = entry.baseStyle;
  if (entry.kind === "edge") {
    entry.layer.setStyle({
      ...base,
      weight: (base.weight ?? 4) + 4,
      opacity: 1,
      color: base.color,
      dashArray: undefined,
    });
  } else if (entry.kind === "platform") {
    entry.layer.setStyle({
      ...base,
      weight: 3,
      color: COLORS.highlight_related,
      fillOpacity: 0.85,
    });
  } else if (entry.kind === "station") {
    entry.layer.setStyle({
      ...base,
      weight: 4,
      color: COLORS.highlight_related,
      fillColor: COLORS.platform,
    });
  } else if (entry.kind === "signal") {
    // signal 是 divIcon Marker (不是 L.Path 子类). 用 setIcon 重画带高亮边框的 SVG.
    const marker = entry.layer as unknown as L.Marker;
    const ext = base as L.PathOptions & { facing?: "forward" | "reverse" | "both"; edgeBearing?: number };
    marker.setIcon(L.divIcon({
      className: "mvp-signal-marker mvp-signal-marker--highlight",
      html: buildSignalSvg(ext.facing ?? "both", ext.edgeBearing ?? 0, true),
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    }));
  }
  entry.layer.bringToFront?.();
}

function applyRelatedStyle(entry: LayerEntry): void {
  const base = entry.baseStyle;
  if (entry.kind === "edge") {
    entry.layer.setStyle({
      ...base,
      weight: (base.weight ?? 4) + 2,
      color: COLORS.highlight_related,
      opacity: 1,
    });
  } else if (entry.kind === "platform") {
    entry.layer.setStyle({
      ...base,
      weight: 2,
      color: COLORS.highlight_related,
      fillOpacity: 0.7,
    });
  } else if (entry.kind === "station") {
    entry.layer.setStyle({
      ...base,
      weight: 3,
      color: COLORS.highlight_related,
    });
  } else if (entry.kind === "signal") {
    // related 时 signal 用橙色描边小放大
    const marker = entry.layer as unknown as L.Marker;
    const ext = base as L.PathOptions & { facing?: "forward" | "reverse" | "both"; edgeBearing?: number };
    marker.setIcon(L.divIcon({
      className: "mvp-signal-marker mvp-signal-marker--related",
      html: buildSignalSvg(ext.facing ?? "both", ext.edgeBearing ?? 0, false, COLORS.highlight_related),
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }));
  }
}

function resetHighlightedStyles(state: InternalState): void {
  const allRefs = new Set<string>([
    ...state.highlightedPrimaries,
    ...state.highlightedRelated,
  ]);
  for (const ref of allRefs) {
    const entry = state.entityLayers.get(ref);
    if (!entry) continue;
    if (entry.kind === "signal") {
      const marker = entry.layer as unknown as L.Marker;
      const ext = entry.baseStyle as L.PathOptions & { facing?: "forward" | "reverse" | "both"; edgeBearing?: number };
      marker.setIcon(L.divIcon({
        className: "mvp-signal-marker",
        html: buildSignalSvg(ext.facing ?? "both", ext.edgeBearing ?? 0),
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }));
    } else {
      entry.layer.setStyle(entry.baseStyle);
    }
  }
  state.highlightedPrimaries.clear();
  state.highlightedRelated.clear();
}

function applyPathHighlight(
  state: InternalState,
  edgeSequence: EntityRef[],
  turnbackEdgeIndices?: number[],
  resolvedChain?: ResolvedChain,
): void {
  clearPathHighlight(state);
  if (edgeSequence.length === 0) return;

  if (!state.isAnimatingPath) {
    state.originalZoom = state.map.getZoom();
    state.originalCenter = state.map.getCenter();
    state.isAnimatingPath = true;
  }

  const turnbackSet = new Set(turnbackEdgeIndices ?? []);

  // 1) 推算每条 edge 在 path 中的实际行进方向 (entry node → exit node)
  type Dir = "forward" | "reverse";
  const directions: Dir[] = [];
  const exitNodes: (EntityRef | null)[] = [];
  let prevExitNode: EntityRef | null = null;

  for (let i = 0; i < edgeSequence.length; i += 1) {
    const edgeRef = edgeSequence[i];
    const edge = state.edgeById.get(edgeRef);
    if (!edge) {
      directions.push("forward");
      exitNodes.push(null);
      continue;
    }
    let dir: Dir;
    if (prevExitNode !== null) {
      if (edge.fromNodeRef === prevExitNode) dir = "forward";
      else if (edge.toNodeRef === prevExitNode) dir = "reverse";
      else dir = "forward";
    } else if (i + 1 < edgeSequence.length) {
      const nextEdge = state.edgeById.get(edgeSequence[i + 1]);
      if (nextEdge) {
        if (edge.toNodeRef === nextEdge.fromNodeRef || edge.toNodeRef === nextEdge.toNodeRef) {
          dir = "forward";
        } else if (edge.fromNodeRef === nextEdge.fromNodeRef || edge.fromNodeRef === nextEdge.toNodeRef) {
          dir = "reverse";
        } else {
          dir = "forward";
        }
      } else {
        dir = "forward";
      }
    } else {
      dir = "forward";
    }
    directions.push(dir);

    const entryNode: EntityRef = dir === "forward" ? edge.fromNodeRef : edge.toNodeRef;
    const oppositeNode: EntityRef = dir === "forward" ? edge.toNodeRef : edge.fromNodeRef;
    const exitNode: EntityRef = turnbackSet.has(i) ? entryNode : oppositeNode;
    exitNodes.push(exitNode);
    prevExitNode = exitNode;

    // 暗淡 / 隐藏原方向箭头
    const arrowMarker = state.arrowById.get(edgeRef);
    if (arrowMarker) {
      const isBidir = edge.directionRole === "bidirectional" || edge.directionRole === "reversible";
      arrowMarker.setOpacity(isBidir ? 0.2 : 0);
      state.dimmedArrowKeys.add(edgeRef);
    }
  }

  // 2) 提取动画里程碑 (Origin, Stops, Turnbacks, Terminus)
  const milestones: Milestone[] = [];
  if (resolvedChain && resolvedChain.nodes && resolvedChain.nodes.length > 0) {
    let currentEdgeCount = 0;
    resolvedChain.nodes.forEach((node, idx) => {
      let edgeIdx = 0;
      let measure = 0;
      if (idx === 0) {
        edgeIdx = 0;
        measure = 0;
      } else if (idx === resolvedChain.nodes.length - 1) {
        edgeIdx = edgeSequence.length - 1;
        measure = 1;
      } else {
        const prevSeg = resolvedChain.segments[idx - 1];
        if (prevSeg) {
          currentEdgeCount += prevSeg.edges.length;
        }
        edgeIdx = Math.max(0, currentEdgeCount - 1);
        measure = node.resolvedMeasure !== undefined ? node.resolvedMeasure : 0.5;
      }

      let type: Milestone["type"] = "stop";
      if (node.kind === "origin") type = "origin";
      else if (node.kind === "terminus") type = "terminus";
      else if (node.kind === "reversal") type = "reversal";

      let label = "";
      if (node.kind === "origin") {
        label = "Start";
      } else if (node.kind === "terminus") {
        label = "Terminus";
      } else if (node.kind === "service_stop") {
        const namePart = node.resolvedPlatformRef ? shortId(node.resolvedPlatformRef) : shortId(node.at);
        label = `Stop: ${namePart}`;
      } else if (node.kind === "reversal") {
        const namePart = node.resolvedPlatformRef ? shortId(node.resolvedPlatformRef) : (node.at ? shortId(node.at) : "");
        label = `Turnback: ${namePart}`;
      } else if (node.kind === "technical_stop") {
        label = `Tech Stop: ${node.reason ?? ""}`;
      } else {
        return;
      }

      milestones.push({ type, edgeIdx, measure, label });
    });
  } else {
    milestones.push({ type: "origin", edgeIdx: 0, measure: 0, label: "Start" });
    for (let i = 0; i < edgeSequence.length; i++) {
      if (turnbackSet.has(i)) {
        milestones.push({ type: "reversal", edgeIdx: i, measure: 0.5, label: "Turnback" });
      }
    }
    milestones.push({ type: "terminus", edgeIdx: edgeSequence.length - 1, measure: 1, label: "Terminus" });
  }

  // 2.5) 从里程碑提取坐标作为动画放慢中心
  // 每个 milestone (origin/stop/reversal/terminus) 都是站台/站点位置
  const slowCenters: L.LatLng[] = [];
  for (const ms of milestones) {
    const edgeRef = edgeSequence[ms.edgeIdx];
    if (!edgeRef) continue;
    const entry = state.entityLayers.get(edgeRef);
    if (!entry || entry.kind !== "edge") continue;
    const lls = (entry.layer as L.Polyline).getLatLngs() as L.LatLng[];
    if (lls.length === 0) continue;
    const dists = buildDists(lls);
    const total = dists[dists.length - 1] || 1;
    const coord = interpolateAtDistance(lls, dists, ms.measure * total);
    slowCenters.push(coord);
  }

  // 3) 按照里程碑切割为 legs
  interface Leg {
    coords: L.LatLng[];
    startEvent?: Milestone;
    endEvent?: Milestone;
    /** 预计算的速度分布 (null = 恒定速度) */
    speedProfile: SpeedProfile | null;
  }
  const legs: Leg[] = [];
  for (let m = 0; m < milestones.length - 1; m++) {
    const startM = milestones[m];
    const endM = milestones[m + 1];

    const legCoords: L.LatLng[] = [];
    for (let k = startM.edgeIdx; k <= endM.edgeIdx; k++) {
      const edgeRef = edgeSequence[k];
      if (!edgeRef) continue;
      const entry = state.entityLayers.get(edgeRef);
      if (!entry || entry.kind !== "edge") continue;
      const polyline = entry.layer as L.Polyline;
      const latLngs = polyline.getLatLngs() as L.LatLng[];
      if (latLngs.length === 0) continue;

      const dir = directions[k];
      const mStart = (k === startM.edgeIdx) ? startM.measure : 0;
      let mEnd = 1;
      if (k === endM.edgeIdx) {
        mEnd = endM.measure;
      } else if (turnbackSet.has(k)) {
        mEnd = 0;
      }

      const sub = getSubCoords(latLngs, dir, mStart, mEnd);
      legCoords.push(...sub);
    }

    const deduped = deduplicateLatLngs(legCoords);
    // 预计算 speedProfile (若存在 slowCenters)
    const profile = slowCenters.length > 0
      ? computeSpeedProfile(deduped, slowCenters, {
          baseSpeed: 60,
          platformRangeMeters: 300,
          sweepMargin: 200,
          slowMultiplier: 1 / 1.5,
        })
      : null;

    legs.push({
      coords: deduped,
      startEvent: m === 0 ? startM : undefined,
      endEvent: endM,
      speedProfile: profile,
    });
  }

  // 4) 渲染全局半透明背景轨迹
  const fullCoords: L.LatLng[] = [];
  for (let i = 0; i < edgeSequence.length; i++) {
    const edgeRef = edgeSequence[i];
    const entry = state.entityLayers.get(edgeRef);
    if (!entry || entry.kind !== "edge") continue;
    const polyline = entry.layer as L.Polyline;
    const latLngs = polyline.getLatLngs() as L.LatLng[];
    if (latLngs.length === 0) continue;
    const dir = directions[i];
    const sub = getSubCoords(latLngs, dir, 0, 1);
    fullCoords.push(...sub);
  }
  if (fullCoords.length > 0) {
    const backgroundPath = L.polyline(deduplicateLatLngs(fullCoords), {
      color: COLORS.highlight_path,
      weight: 6,
      opacity: 0.15,
      lineCap: "round",
      lineJoin: "round",
    });
    backgroundPath.addTo(state.pathHighlightGroup);
  }

  // 5) 动画主循环驱动
  let traveledCoordsHistory: L.LatLng[] = [];
  const animProgressGroup = L.featureGroup().addTo(state.pathHighlightGroup);
  let trainMarker: L.Marker | null = null;

  const progressGlowPolyline = L.polyline([], {
    color: "#10b981",
    weight: 10,
    opacity: 0.4,
    lineCap: "round",
    lineJoin: "round",
  });

  const progressCorePolyline = L.polyline([], {
    color: "#ffffff",
    weight: 4,
    opacity: 1.0,
    lineCap: "round",
    lineJoin: "round",
  });

  const initAnimation = () => {
    animProgressGroup.clearLayers();
    traveledCoordsHistory = [];

    progressGlowPolyline.setLatLngs([]);
    progressCorePolyline.setLatLngs([]);
    progressGlowPolyline.addTo(animProgressGroup);
    progressCorePolyline.addTo(animProgressGroup);

    if (legs.length > 0 && legs[0].coords.length > 0) {
      trainMarker = L.marker(legs[0].coords[0], {
        icon: L.divIcon({
          className: "path-train-marker",
          html: `<div class="path-train-pulse"></div><div class="path-train-dot"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        interactive: false,
      });
      trainMarker.addTo(animProgressGroup);

      // 视角定位和放大到动画起点
      state.map.setView(legs[0].coords[0], 18, { animate: true });
    }

    playLeg(0);
  };

  const playLeg = (legIdx: number) => {
    if (legIdx >= legs.length) {
      // 完成一轮循环，停顿 5000ms (0.5x 减慢) 后重新开始
      const tId = window.setTimeout(() => {
        initAnimation();
      }, 5000);
      state.animationTimeouts?.push(tId);
      return;
    }

    const leg = legs[legIdx];

    if (legIdx > 0) {
      traveledCoordsHistory.push(...legs[legIdx - 1].coords);
    }

    if (leg.startEvent) {
      showEvent(leg.startEvent, leg.coords[0], () => {
        moveAlongLeg(leg, () => {
          handleEndEvent(leg, legIdx);
        });
      });
    } else {
      moveAlongLeg(leg, () => {
        handleEndEvent(leg, legIdx);
      });
    }
  };

  const showEvent = (evt: Milestone, latLng: L.LatLng, callback: () => void) => {
    const eventMarker = L.marker(latLng, {
      icon: L.divIcon({
        className: "path-event-marker",
        html: `
          <div class="path-event-pulse ${evt.type}" style="color: ${eventColor(evt.type)}"></div>
          <div class="path-event-dot ${evt.type}"></div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
      interactive: false,
    });
    eventMarker.addTo(animProgressGroup);

    eventMarker.bindTooltip(`
      <div class="path-event-badge ${evt.type}">${evt.label}</div>
    `, {
      permanent: true,
      direction: "top",
      className: "path-event-tooltip",
      offset: [0, -10],
    }).addTo(animProgressGroup);

    // 停顿时间减慢 0.5x
    let dwell = 2400;
    if (evt.type === "origin") dwell = 2000;
    else if (evt.type === "reversal") dwell = 3200;
    else if (evt.type === "terminus") dwell = 4000;

    const tId = window.setTimeout(callback, dwell);
    state.animationTimeouts?.push(tId);
  };

  const handleEndEvent = (leg: Leg, legIdx: number) => {
    if (leg.endEvent) {
      showEvent(leg.endEvent, leg.coords[leg.coords.length - 1], () => {
        playLeg(legIdx + 1);
      });
    } else {
      playLeg(legIdx + 1);
    }
  };

  const moveAlongLeg = (leg: Leg, callback: () => void) => {
    const coords = leg.coords;
    if (coords.length < 2) {
      callback();
      return;
    }

    const dists: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = coords[i - 1].distanceTo(coords[i]);
      totalDist += d;
      dists.push(totalDist);
    }

    // 使用预计算 speedProfile (若存在), 否则回退到恒定速度
    const profile = leg.speedProfile;
    const duration = profile
      ? profile.totalDuration
      : constantSpeedDuration(totalDist, 60);
    const startTime = performance.now();

    const frame = (now: number) => {
      const elapsed = now - startTime;

      let currentDist: number;
      let currentLatLng: L.LatLng;
      let currentTraveled: L.LatLng[];

      if (profile) {
        const sampled = sampleSpeedProfile(elapsed, profile, coords);
        currentDist = sampled.currentDist;
        currentLatLng = sampled.currentLatLng;
        currentTraveled = sampled.traveledCoords;
      } else {
        const t = Math.min(1, elapsed / duration);
        currentDist = t * totalDist;
        currentLatLng = getLatLngAtDistance(coords, dists, currentDist);
        currentTraveled = getTraveledCoords(coords, dists, currentDist);
      }

      if (trainMarker) {
        trainMarker.setLatLng(currentLatLng);
        state.map.panTo(currentLatLng, { animate: false });
      }

      const fullTraveled = [...traveledCoordsHistory, ...currentTraveled];
      progressGlowPolyline.setLatLngs(fullTraveled);
      progressCorePolyline.setLatLngs(fullTraveled);

      if (elapsed < duration) {
        state.animationFrameId = requestAnimationFrame(frame);
      } else {
        callback();
      }
    };

    state.animationFrameId = requestAnimationFrame(frame);
  };

  // 启动第一轮动画
  initAnimation();
}

interface Milestone {
  type: "origin" | "stop" | "reversal" | "terminus";
  edgeIdx: number;
  measure: number;
  label: string;
}

function shortId(ref: string): string {
  if (!ref) return "";
  const parts = ref.split(":");
  return parts[parts.length - 1];
}

function eventColor(type: string): string {
  if (type === "origin") return "#0891b2";
  if (type === "stop") return "#16a34a";
  if (type === "reversal") return "#d97706";
  if (type === "terminus") return "#ef4444";
  return "#64748b";
}

function getSubCoords(
  latLngs: L.LatLng[],
  dir: "forward" | "reverse",
  m1: number,
  m2: number
): L.LatLng[] {
  const pts = dir === "forward" ? [...latLngs] : [...latLngs].reverse();
  if (pts.length < 2) return [pts[0]];

  const dists: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i - 1].distanceTo(pts[i]);
    total += d;
    dists.push(total);
  }

  const dStart = m1 * total;
  const dEnd = m2 * total;
  const result: L.LatLng[] = [];

  if (m1 <= m2) {
    result.push(interpolateAtDistance(pts, dists, dStart));
    for (let i = 1; i < pts.length - 1; i++) {
      if (dists[i] > dStart && dists[i] < dEnd) {
        result.push(pts[i]);
      }
    }
    result.push(interpolateAtDistance(pts, dists, dEnd));
  } else {
    result.push(interpolateAtDistance(pts, dists, dStart));
    for (let i = pts.length - 2; i >= 1; i--) {
      if (dists[i] < dStart && dists[i] > dEnd) {
        result.push(pts[i]);
      }
    }
    result.push(interpolateAtDistance(pts, dists, dEnd));
  }

  return result;
}

function buildDists(pts: L.LatLng[]): number[] {
  const dists: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    dists.push(dists[i - 1] + pts[i - 1].distanceTo(pts[i]));
  }
  return dists;
}

function totalEdgeDist(pts: L.LatLng[]): number {
  if (pts.length < 2) return 0;
  const d = buildDists(pts);
  return d[d.length - 1];
}

function interpolateAtDistance(pts: L.LatLng[], dists: number[], d: number): L.LatLng {
  if (d <= 0) return pts[0];
  if (d >= dists[dists.length - 1]) return pts[pts.length - 1];
  for (let i = 1; i < dists.length; i++) {
    if (d <= dists[i]) {
      const segLen = dists[i] - dists[i - 1];
      const ratio = segLen > 0 ? (d - dists[i - 1]) / segLen : 0;
      return L.latLng(
        pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * ratio,
        pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * ratio
      );
    }
  }
  return pts[pts.length - 1];
}

function getLatLngAtDistance(coords: L.LatLng[], dists: number[], d: number): L.LatLng {
  if (d <= 0) return coords[0];
  if (d >= dists[dists.length - 1]) return coords[coords.length - 1];
  for (let i = 1; i < dists.length; i++) {
    if (d <= dists[i]) {
      const segLen = dists[i] - dists[i - 1];
      const ratio = segLen > 0 ? (d - dists[i - 1]) / segLen : 0;
      return L.latLng(
        coords[i - 1].lat + (coords[i].lat - coords[i - 1].lat) * ratio,
        coords[i - 1].lng + (coords[i].lng - coords[i - 1].lng) * ratio
      );
    }
  }
  return coords[coords.length - 1];
}

function getTraveledCoords(coords: L.LatLng[], dists: number[], d: number): L.LatLng[] {
  if (d <= 0) return [coords[0]];
  if (d >= dists[dists.length - 1]) return [...coords];
  const result: L.LatLng[] = [];
  for (let i = 0; i < coords.length; i++) {
    if (dists[i] < d) {
      result.push(coords[i]);
    } else {
      result.push(getLatLngAtDistance(coords, dists, d));
      break;
    }
  }
  return result;
}

function deduplicateLatLngs(pts: L.LatLng[]): L.LatLng[] {
  if (pts.length === 0) return [];
  const result = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].distanceTo(result[result.length - 1]) > 0.01) {
      result.push(pts[i]);
    }
  }
  return result;
}

function clearPathHighlight(state: InternalState): void {
  if (state.animationFrameId !== undefined) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = undefined;
  }
  if (state.animationTimeouts) {
    state.animationTimeouts.forEach(clearTimeout);
    state.animationTimeouts = [];
  }

  state.pathHighlightGroup.clearLayers();
  state.pathEndpointGroup.clearLayers();
  state.pathArrowLayer.clearLayers();

  for (const edgeRef of state.dimmedArrowKeys) {
    const marker = state.arrowById.get(edgeRef);
    if (marker) marker.setOpacity(1);
  }
  state.dimmedArrowKeys.clear();

  if (state.isAnimatingPath) {
    if (state.originalCenter && state.originalZoom !== undefined) {
      state.map.setView(state.originalCenter, state.originalZoom, { animate: true });
    }
    state.isAnimatingPath = false;
    state.originalCenter = undefined;
    state.originalZoom = undefined;
  }
}

function clearAllHighlight(state: InternalState): void {
  resetHighlightedStyles(state);
  clearPathHighlight(state);
}

// ── 9. Arrow / Signal helpers ───────────────────────────────

function computeBearing(a: GeoJSONPosition, b: GeoJSONPosition): number {
  if (a.length < 2 || b.length < 2) return 0;
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]), lat2 = toRad(b[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function toRad(deg: number): number { return deg * Math.PI / 180; }
function toDeg(rad: number): number { return rad * 180 / Math.PI; }

function buildArrowMarker(
  latLng: [number, number],
  edge: TopologyEdge,
  bearing: number,
): L.Marker {
  const role = edge.directionRole;
  const color = colorForDirectionRole(role, edge.role);
  let svg: string;
  if (role === "reversible") {
    // U-turn 实线标识 — 列车进入, 弯曲 180°, 反向驶出. 视觉上类似交通调头标志.
    // 实线弯弧 (避免虚线难辨识) + 末端三角箭头.
    svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M 6 19 L 6 11 A 5 5 0 0 1 16 11 L 16 15" stroke="${color}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <polygon points="16,20 12,14 20,14" fill="${color}"/>
      <circle cx="6" cy="19" r="1.8" fill="${color}"/>
    </svg>`;
  } else if (role === "bidirectional") {
    // ⇄ 双向箭头 — 水平排列, rotate(bearing - 90) 对齐 edge 走向
    svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${bearing - 90} 12 12)">
        <polygon points="16,7 23,12 16,17" fill="${color}" fill-opacity="0.75"/>
        <polygon points="8,7 1,12 8,17" fill="${color}" fill-opacity="0.75"/>
      </g>
    </svg>`;
  } else {
    // ▶ 单向 — polygon 默认顶点朝北 (上), rotate(bearing) 后顶点朝 bearing 方向
    svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${bearing} 12 12)">
        <polygon points="12,3 5,19 19,19" fill="${color}" fill-opacity="0.92"/>
      </g>
    </svg>`;
  }
  return L.marker(latLng, {
    icon: L.divIcon({ className: "mvp-arrow-marker", html: svg, iconSize: [24, 24], iconAnchor: [12, 12] }),
    interactive: false,
  });
}

function getEdgeCoords(
  edgeRef: EntityRef,
  topo: BaseTopologyLayer,
  annotationIdToFeature: Map<string, AnnotatedFeature>,
): GeoJSONPosition[] | null {
  const edge = topo.edges.find((e) => e.id === edgeRef);
  if (!edge) return null;
  if (edge.coordinates) return edge.coordinates;
  if (!edge.sourceSlice) return null;
  const feature = annotationIdToFeature.get(edge.sourceSlice.sourceFeatureRef);
  if (!feature) return null;
  return extractEdgeCoordinates(feature, edge.sourceSlice.multiLineIndex);
}

function interpolateAlong(coords: GeoJSONPosition[], measure: number): [number, number] {
  const m = Math.max(0, Math.min(1, measure));
  if (coords.length < 2) return [coords[0][1], coords[0][0]];
  let total = 0;
  const segLen: number[] = [];
  for (let i = 1; i < coords.length; i += 1) {
    const d = haversineMeters(coords[i - 1], coords[i]);
    segLen.push(d);
    total += d;
  }
  let remaining = total * m;
  for (let i = 0; i < segLen.length; i += 1) {
    if (remaining <= segLen[i]) {
      const t = segLen[i] > 0 ? remaining / segLen[i] : 0;
      return [
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
      ];
    }
    remaining -= segLen[i];
  }
  return [coords[coords.length - 1][1], coords[coords.length - 1][0]];
}

function haversineMeters(a: GeoJSONPosition, b: GeoJSONPosition): number {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aH = sinDLat * sinDLat + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinDLng * sinDLng;
  return 2 * R * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH));
}

/**
 * 信号机 SVG: 红圆点 + facing 方向短线指示 (forward=指向行进方向 / reverse=反向 / both=双向).
 * 整体按 edge bearing 旋转, 使 facing 短线对齐 edge 走向。
 * highlight=true 时尺寸 +2 + 白色描边; highlightColor 覆盖描边色.
 */
function buildSignalSvg(
  facing: "forward" | "reverse" | "both",
  edgeBearing: number,
  highlight = false,
  highlightColor?: string,
): string {
  const cx = highlight ? 14 : 12;
  const cy = highlight ? 14 : 12;
  const r = highlight ? 5 : 4;
  const dotColor = "#ef4444";
  const strokeColor = highlight ? (highlightColor ?? "#0f172a") : "#334155";
  const strokeWidth = highlight ? 2.5 : 1.5;
  // facing 短线: 沿 edge 方向延伸 (forward=朝东即默认右; reverse=朝西默认左; both=两侧)
  // SVG 默认水平短线在 y=cy, x=cx ± 8 (forward: 右侧 +; reverse: 左侧 -)
  const lineLen = 7;
  const fwdLine = facing !== "reverse" ? `<line x1="${cx}" y1="${cy}" x2="${cx + lineLen}" y2="${cy}" stroke="${dotColor}" stroke-width="2" stroke-linecap="round"/>` : "";
  const revLine = facing !== "forward" ? `<line x1="${cx}" y1="${cy}" x2="${cx - lineLen}" y2="${cy}" stroke="${dotColor}" stroke-width="2" stroke-linecap="round"/>` : "";
  const size = highlight ? 28 : 24;
  // 短线水平排布, 用 rotate(bearing - 90) 对齐 edge (bearing - 90 因为水平默认朝东 = 90°)
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(${edgeBearing - 90} ${cx} ${cy})">
      ${fwdLine}${revLine}
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${dotColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
    </g>
  </svg>`;
}

// ── 10. Utils ───────────────────────────────────────────────

function escapeHtml(value: string): string {
  const str = String(value ?? "");
  return str.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch] ?? ch));
}

function midpointAlong(coords: GeoJSONPosition[]): [number, number] {
  return interpolateAlong(coords, 0.5);
}

// Box-select hit test:
//   - station / signal (CircleMarker, kind=station|signal): 点是否在 bounds 内
//   - platform (Polygon, kind=platform): bbox 相交 (面积近似 bbox)
//   - edge (Polyline, kind=edge): 任意 vertex 在 bounds 内, OR 任意线段穿过 bounds
//     (避免直接 bbox 相交 — L 形/曲折 polyline bbox 比线大很多, 误命中严重)
function layerHitsBounds(layer: L.Path, bounds: L.LatLngBounds, kind: LayerKind): boolean {
  if (kind === "station" || kind === "signal") {
    const ll = (layer as any).getLatLng?.();
    return !!(ll && bounds.contains(ll));
  }
  if (kind === "platform") {
    const b = (layer as any).getBounds?.();
    return !!(b && bounds.intersects(b));
  }
  if (kind === "edge") {
    const poly = layer as L.Polyline;
    const latlngs = poly.getLatLngs() as L.LatLng[] | L.LatLng[][];
    const rings: L.LatLng[][] = Array.isArray(latlngs[0])
      ? (latlngs as L.LatLng[][])
      : [latlngs as L.LatLng[]];
    for (const ring of rings) {
      for (const v of ring) {
        if (bounds.contains(v)) return true;
      }
      for (let i = 0; i < ring.length - 1; i += 1) {
        if (segmentIntersectsBounds(ring[i], ring[i + 1], bounds)) return true;
      }
    }
    return false;
  }
  return false;
}

// Cohen-Sutherland line clipping: 判断线段 p1→p2 与矩形 bounds 是否相交。
// 返回 true 当且仅当至少有一部分落在矩形内 (包括边界)。
function segmentIntersectsBounds(p1: L.LatLng, p2: L.LatLng, b: L.LatLngBounds): boolean {
  const xmin = b.getWest();
  const xmax = b.getEast();
  const ymin = b.getSouth();
  const ymax = b.getNorth();
  const INSIDE = 0, LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;
  const codeOf = (x: number, y: number): number => {
    let c = INSIDE;
    if (x < xmin) c |= LEFT;
    else if (x > xmax) c |= RIGHT;
    if (y < ymin) c |= BOTTOM;
    else if (y > ymax) c |= TOP;
    return c;
  };

  let x1 = p1.lng, y1 = p1.lat;
  let x2 = p2.lng, y2 = p2.lat;
  let c1 = codeOf(x1, y1);
  let c2 = codeOf(x2, y2);
  for (let i = 0; i < 8; i += 1) {
    if (!(c1 | c2)) return true;          // 两端都在矩形内
    if (c1 & c2) return false;            // 两端在同一侧外, 不可能穿过
    const out = c1 || c2;
    let x = 0, y = 0;
    if (out & TOP) {
      x = x1 + (x2 - x1) * (ymax - y1) / (y2 - y1);
      y = ymax;
    } else if (out & BOTTOM) {
      x = x1 + (x2 - x1) * (ymin - y1) / (y2 - y1);
      y = ymin;
    } else if (out & RIGHT) {
      y = y1 + (y2 - y1) * (xmax - x1) / (x2 - x1);
      x = xmax;
    } else if (out & LEFT) {
      y = y1 + (y2 - y1) * (xmin - x1) / (x2 - x1);
      x = xmin;
    }
    if (out === c1) {
      x1 = x; y1 = y; c1 = codeOf(x1, y1);
    } else {
      x2 = x; y2 = y; c2 = codeOf(x2, y2);
    }
  }
  return false;
}
