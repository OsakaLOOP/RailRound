// ============================================================
// MVP 可视化 — Leaflet 地图视图
//
// 输入 BaseTopologyLayer + AnnotatedFeatureCollection, 把所有
// station / platform / edge 渲染为 Leaflet 图层。
// 暴露 hover / click 事件 + 高亮 API 给外部 (list-view) 联动。
// ============================================================

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

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

// ── 1. 颜色 / 样式常量 ──────────────────────────────────────

const COLORS = {
  up_main: "#1d4ed8",
  down_main: "#b91c1c",
  reversible: "#7e22ce",
  siding: "#7e22ce",
  connector: "#94a3b8",
  station: "#000000",
  platform: "#fde047",
  highlight_primary_stroke: "#ffffff",
  highlight_related: "#f59e0b",
  highlight_path: "#16a34a",
  highlight_path_endpoint: "#15803d",
} as const;

const POSITRON_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const POSITRON_ATTR = "&copy; OpenStreetMap contributors &copy; CARTO";

// ── 2. Public API ───────────────────────────────────────────

export interface MapView {
  update(topo: BaseTopologyLayer, geoJson: AnnotatedFeatureCollection): void;
  highlightEntities(primaryRefs: EntityRef[], relatedRefs?: EntityRef[]): void;
  highlightPath(edgeSequence: EntityRef[]): void;
  clearHighlight(): void;
  onHover(handler: (ref: EntityRef | null) => void): void;
  onClick(handler: (ref: EntityRef) => void): void;
  setBaseLayer(kind: "positron" | "plain"): void;
  fitToData(): void;
  destroy(): void;
}

// ── 3. Internal state ───────────────────────────────────────

interface LayerEntry {
  layer: L.Path;          // polyline/polygon/circleMarker (都继承 L.Path)
  baseStyle: L.PathOptions;
  kind: "station" | "platform" | "edge";
}

interface InternalState {
  map: L.Map;
  tileLayer: L.TileLayer | null;
  baseLayerKind: "positron" | "plain";
  entityLayers: Map<string, LayerEntry>;
  featureGroup: L.FeatureGroup;        // 容纳所有 entity layers, 用于 fitBounds
  pathHighlightGroup: L.LayerGroup;    // 路径高亮 (绿色叠加)
  pathEndpointGroup: L.LayerGroup;     // 路径端点 marker
  highlightedPrimaries: Set<string>;
  highlightedRelated: Set<string>;
  hoverHandlers: Array<(ref: EntityRef | null) => void>;
  clickHandlers: Array<(ref: EntityRef) => void>;
}

// ── 4. Factory ──────────────────────────────────────────────

export function createMapView(container: HTMLElement): MapView {
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
    featureGroup: L.featureGroup().addTo(map),
    pathHighlightGroup: L.layerGroup().addTo(map),
    pathEndpointGroup: L.layerGroup().addTo(map),
    highlightedPrimaries: new Set(),
    highlightedRelated: new Set(),
    hoverHandlers: [],
    clickHandlers: [],
  };

  applyBaseLayer(state, "positron");

  return {
    update(topo, geoJson) {
      rebuildLayers(state, topo, geoJson);
    },
    highlightEntities(primary, related) {
      applyHighlight(state, primary, related ?? []);
    },
    highlightPath(edgeSequence) {
      applyPathHighlight(state, edgeSequence);
    },
    clearHighlight() {
      clearAllHighlight(state);
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
    destroy() {
      map.remove();
    },
  };
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
): void {
  // 清空旧 layers
  state.featureGroup.clearLayers();
  state.entityLayers.clear();
  clearAllHighlight(state);

  const annotationIdToFeature = new Map<string, AnnotatedFeature>();
  for (const feature of geoJson.features) {
    const id = feature.properties.railGraph?.id;
    if (id) annotationIdToFeature.set(id, feature);
  }

  // 1) Edges (track polylines)
  for (const edge of topo.edges) {
    const sourceRef = edge.sourceSlice?.sourceFeatureRef;
    if (!sourceRef) continue;
    const feature = annotationIdToFeature.get(sourceRef);
    if (!feature) continue;
    const coords = extractEdgeCoordinates(feature, edge.sourceSlice?.multiLineIndex);
    if (!coords || coords.length < 2) continue;

    const latLngs = coords.map((c) => [c[1], c[0]] as [number, number]);
    const baseStyle = edgeBaseStyle(edge);
    const polyline = L.polyline(latLngs, baseStyle);
    polyline.bindTooltip(
      `<b>${escapeHtml(edge.name ?? edge.id)}</b><br/>` +
      `role: ${edge.role}<br/>` +
      `directionRole: ${edge.directionRole ?? "(none)"}<br/>` +
      `traversal: ${edge.traversal}<br/>` +
      `length: ${Math.round(edge.lengthMeters)} m`,
      { sticky: true, direction: "top" },
    );
    bindLayerEvents(state, polyline, edge.id);
    polyline.addTo(state.featureGroup);
    state.entityLayers.set(edge.id, { layer: polyline, baseStyle, kind: "edge" });
  }

  // 2) Platforms (polygon)
  for (const platform of topo.platforms) {
    const feature = annotationIdToFeature.get(platform.id);
    if (!feature) continue;
    const ring = extractPolygonRing(feature);
    if (!ring) continue;
    const latLngs = ring.map((c) => [c[1], c[0]] as [number, number]);
    const baseStyle: L.PathOptions = {
      color: "#a16207",
      weight: 1.5,
      fillColor: COLORS.platform,
      fillOpacity: 0.55,
    };
    const polygon = L.polygon([latLngs], baseStyle);
    polygon.bindTooltip(
      `<b>${escapeHtml(platform.name ?? platform.id)}</b><br/>` +
      `type: ${platform.type}<br/>` +
      `station: ${escapeHtml(platform.stationRef)}`,
      { sticky: true, direction: "top" },
    );
    bindLayerEvents(state, polygon, platform.id);
    polygon.addTo(state.featureGroup);
    state.entityLayers.set(platform.id, { layer: polygon, baseStyle, kind: "platform" });
  }

  // 3) Stations (point)
  for (const station of topo.stations) {
    const feature = annotationIdToFeature.get(station.id);
    if (!feature || feature.geometry.type !== "Point") continue;
    const coord = (feature.geometry as GeoJSONPoint).coordinates;
    const baseStyle: L.PathOptions = {
      color: COLORS.station,
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 1,
      radius: 6,
    } as L.PathOptions & { radius: number };
    const marker = L.circleMarker([coord[1], coord[0]], baseStyle as L.CircleMarkerOptions);
    marker.bindTooltip(
      `<b>${escapeHtml(station.name)}</b><br/>` +
      `platforms: ${station.platformRefs.length}`,
      { sticky: true, direction: "top", permanent: false },
    );
    bindLayerEvents(state, marker, station.id);
    marker.addTo(state.featureGroup);
    state.entityLayers.set(station.id, { layer: marker, baseStyle, kind: "station" });
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

function extractPolygonRing(feature: AnnotatedFeature): GeoJSONPosition[] | null {
  if (feature.geometry.type === "Polygon") {
    return (feature.geometry as GeoJSONPolygon).coordinates[0] ?? null;
  }
  return null;
}

function edgeBaseStyle(edge: TopologyEdge): L.PathOptions {
  const color = colorForDirectionRole(edge.directionRole, edge.role);
  const isDashed = edge.directionRole === "reversible" || edge.directionRole === "siding";
  const isConnector = edge.role === "connector";
  return {
    color,
    weight: isConnector ? 2 : 4,
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
  if (directionRole === "up_main") return COLORS.up_main;
  if (directionRole === "down_main") return COLORS.down_main;
  if (directionRole === "reversible") return COLORS.reversible;
  if (directionRole === "siding") return COLORS.siding;
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
    state.clickHandlers.forEach((h) => h(ref as EntityRef));
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
  }
}

function resetHighlightedStyles(state: InternalState): void {
  const allRefs = new Set<string>([
    ...state.highlightedPrimaries,
    ...state.highlightedRelated,
  ]);
  for (const ref of allRefs) {
    const entry = state.entityLayers.get(ref);
    if (entry) {
      entry.layer.setStyle(entry.baseStyle);
    }
  }
  state.highlightedPrimaries.clear();
  state.highlightedRelated.clear();
}

function applyPathHighlight(state: InternalState, edgeSequence: EntityRef[]): void {
  clearPathHighlight(state);
  if (edgeSequence.length === 0) return;

  let firstPoint: L.LatLng | null = null;
  let lastPoint: L.LatLng | null = null;

  for (const edgeRef of edgeSequence) {
    const entry = state.entityLayers.get(edgeRef);
    if (!entry || entry.kind !== "edge") continue;
    const polyline = entry.layer as L.Polyline;
    const latLngs = polyline.getLatLngs() as L.LatLng[];
    if (latLngs.length === 0) continue;

    const overlay = L.polyline(latLngs, {
      color: COLORS.highlight_path,
      weight: 7,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    });
    overlay.addTo(state.pathHighlightGroup);
    if (!firstPoint) firstPoint = latLngs[0];
    lastPoint = latLngs[latLngs.length - 1];
  }

  // 起点 / 终点 marker
  if (firstPoint) {
    L.circleMarker(firstPoint, {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: COLORS.highlight_path_endpoint,
      fillOpacity: 1,
    }).bindTooltip("Start", { permanent: false, direction: "top" }).addTo(state.pathEndpointGroup);
  }
  if (lastPoint && (!firstPoint || !lastPoint.equals(firstPoint))) {
    L.circleMarker(lastPoint, {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: COLORS.highlight_path_endpoint,
      fillOpacity: 1,
    }).bindTooltip("End", { permanent: false, direction: "top" }).addTo(state.pathEndpointGroup);
  }
}

function clearPathHighlight(state: InternalState): void {
  state.pathHighlightGroup.clearLayers();
  state.pathEndpointGroup.clearLayers();
}

function clearAllHighlight(state: InternalState): void {
  resetHighlightedStyles(state);
  clearPathHighlight(state);
}

// ── 9. Utils ────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch] ?? ch));
}
