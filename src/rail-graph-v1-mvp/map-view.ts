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
  update(topo: BaseTopologyLayer, geoJson: AnnotatedFeatureCollection): void;
  highlightEntities(primaryRefs: EntityRef[], relatedRefs?: EntityRef[]): void;
  highlightPath(edgeSequence: EntityRef[], turnbackEdgeIndices?: number[]): void;
  clearHighlight(): void;
  clearEntityHighlight(): void;
  clearPathHighlight(): void;
  onHover(handler: (ref: EntityRef | null) => void): void;
  onClick(handler: (ref: EntityRef) => void): void;
  setBaseLayer(kind: "positron" | "plain"): void;
  fitToData(): void;
  destroy(): void;
}

// ── 3. Internal state ───────────────────────────────────────

type LayerKind = "station" | "platform" | "edge" | "signal";

interface LayerEntry {
  layer: L.Path;          // polyline/polygon/circleMarker (都继承 L.Path)
  baseStyle: L.PathOptions;
  kind: LayerKind;
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
  };

  applyBaseLayer(state, "positron");

  return {
    update(topo, geoJson) {
      rebuildLayers(state, topo, geoJson);
    },
    highlightEntities(primary, related) {
      applyHighlight(state, primary, related ?? []);
    },
    highlightPath(edgeSequence, turnbackEdgeIndices) {
      applyPathHighlight(state, edgeSequence, turnbackEdgeIndices);
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
    state.edgeById.set(edge.id, edge);

    // 记录端点 LatLng 用于 path 方向计算
    state.nodeLatLngById.set(edge.fromNodeRef, L.latLng(coords[0][1], coords[0][0]));
    state.nodeLatLngById.set(edge.toNodeRef, L.latLng(coords[coords.length - 1][1], coords[coords.length - 1][0]));

    // 方向箭头 marker (中点 + bearing)
    const midLatLng = midpointAlong(coords);
    const bearing = computeBearing(coords[0], coords[coords.length - 1]);
    const arrowMarker = buildArrowMarker(midLatLng, edge, bearing);
    arrowMarker.addTo(state.arrowLayer);
    state.arrowById.set(edge.id, arrowMarker);
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

  // 4) Signals (CircleMarker on edge measure, with facing 视觉 + edge bearing 对齐)
  for (const signal of topo.signals) {
    const edgeCoords = getEdgeCoords(signal.edgeRef, topo, annotationIdToFeature);
    if (!edgeCoords) continue;
    const latLng = interpolateAlong(edgeCoords, signal.measure);
    const edgeBearing = computeBearing(edgeCoords[0], edgeCoords[edgeCoords.length - 1]);

    // 用 L.divIcon SVG 实现 facing 指示
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
    // signal 用 CircleMarker-shaped 数据但实际是 divIcon Marker; 占位 baseStyle 保留
    // entityLayers 用 layer cast 为 L.Path 仅为 typing 兼容; signal 类型有专属 highlight 分支
    state.entityLayers.set(signal.id, {
      layer: marker as unknown as L.Path,
      baseStyle: { facing: signal.facing, edgeBearing } as L.PathOptions & { facing?: string; edgeBearing?: number },
      kind: "signal",
    });
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
): void {
  clearPathHighlight(state);
  if (edgeSequence.length === 0) return;

  const turnbackSet = new Set(turnbackEdgeIndices ?? []);

  // 1) 推算每条 edge 在 path 中的实际行进方向 (entry node → exit node)
  // 由 edge 的 fromNode/toNode 与相邻 edge 共享节点确定.
  // 关键: turnback edge 上, 列车在 edge 上停车反向, exit = entry (从原入口端离开).
  //       下一条 edge 的 entry node = 本条 edge 的 entry node (而非 toNode).
  type Dir = "forward" | "reverse";  // forward = 沿 edge.fromNode→toNode; reverse = 反向
  const directions: Dir[] = [];
  /** 每条 edge 的真实"出口节点" (turnback edge 上 = 入口节点) */
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
      // 上条 edge 的 exit node 必然是本条 edge 的 entry node
      if (edge.fromNodeRef === prevExitNode) dir = "forward";
      else if (edge.toNodeRef === prevExitNode) dir = "reverse";
      else dir = "forward";  // 不连通, fallback (理论上不应发生)
    } else if (i + 1 < edgeSequence.length) {
      // 第一条 edge: 用第二条 edge 反推共享节点
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

    // 计算 exit node:
    //   turnback edge: 列车反向出原入口, exit = entry
    //   普通 edge:     exit = 另一端
    const entryNode = dir === "forward" ? edge.fromNodeRef : edge.toNodeRef;
    const oppositeNode = dir === "forward" ? edge.toNodeRef : edge.fromNodeRef;
    const exitNode = turnbackSet.has(i) ? entryNode : oppositeNode;
    exitNodes.push(exitNode);
    prevExitNode = exitNode;
  }

  // 2) 渲染绿色叠加 + 方向箭头 + dim 原 arrow
  let firstPoint: L.LatLng | null = null;
  let lastPoint: L.LatLng | null = null;

  for (let i = 0; i < edgeSequence.length; i += 1) {
    const edgeRef = edgeSequence[i];
    const entry = state.entityLayers.get(edgeRef);
    if (!entry || entry.kind !== "edge") continue;
    const polyline = entry.layer as L.Polyline;
    const latLngs = polyline.getLatLngs() as L.LatLng[];
    if (latLngs.length === 0) continue;

    // 绿色叠加 (覆盖原 polyline)
    const overlay = L.polyline(latLngs, {
      color: COLORS.highlight_path,
      weight: 7,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    });
    overlay.addTo(state.pathHighlightGroup);

    // path 实际行进方向的 entry / exit LatLng
    const dir = directions[i];
    const entryLatLng = dir === "forward" ? latLngs[0] : latLngs[latLngs.length - 1];
    const exitLatLng = dir === "forward" ? latLngs[latLngs.length - 1] : latLngs[0];
    if (i === 0) firstPoint = entryLatLng;
    lastPoint = exitLatLng;

    // 方向箭头: 中点 + 朝实际行进方向
    const midPoint = midpointAlongLatLng(latLngs);
    const isTurnback = turnbackSet.has(i);

    let svg: string;
    if (isTurnback) {
      // 绿色 U-turn 加粗换向标记 (实线, 与原方向箭头同语义)
      svg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M 8 26 L 8 15 A 7 7 0 0 1 22 15 L 22 20" stroke="${COLORS.highlight_path_endpoint}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <polygon points="22,27 17,19 27,19" fill="${COLORS.highlight_path_endpoint}"/>
        <circle cx="8" cy="26" r="2.4" fill="${COLORS.highlight_path_endpoint}"/>
      </svg>`;
    } else {
      // 绿色 ▶ 朝行进方向
      const pathBearing = computeBearingFromLatLng(entryLatLng, exitLatLng);
      svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <g transform="rotate(${pathBearing} 12 12)">
          <polygon points="12,3 5,19 19,19" fill="${COLORS.highlight_path}" stroke="${COLORS.highlight_path_endpoint}" stroke-width="1.5" stroke-linejoin="round"/>
        </g>
      </svg>`;
    }
    L.marker(midPoint, {
      icon: L.divIcon({
        className: isTurnback ? "mvp-path-arrow mvp-path-arrow--turnback" : "mvp-path-arrow",
        html: svg,
        iconSize: isTurnback ? [32, 32] : [24, 24],
        iconAnchor: isTurnback ? [16, 16] : [12, 12],
      }),
      interactive: false,
    }).addTo(state.pathArrowLayer);

    // 暗淡 / 隐藏原箭头
    const arrowMarker = state.arrowById.get(edgeRef);
    if (arrowMarker) {
      const edge = state.edgeById.get(edgeRef);
      const isBidir = edge?.directionRole === "bidirectional" || edge?.directionRole === "reversible";
      // bidirectional/reversible 路径覆盖时半透明 (反向那一半仍可见); 单向完全隐藏
      arrowMarker.setOpacity(isBidir ? 0.2 : 0);
      state.dimmedArrowKeys.add(edgeRef);
    }
  }

  // 3) 起点 / 终点 marker
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

function computeBearingFromLatLng(a: L.LatLng, b: L.LatLng): number {
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function midpointAlong(coords: GeoJSONPosition[]): [number, number] {
  return interpolateAlong(coords, 0.5);
}

function midpointAlongLatLng(latLngs: L.LatLng[]): L.LatLng {
  if (latLngs.length === 1) return latLngs[0];
  // 简单等距找累计长度 50% 点
  let total = 0;
  const segLen: number[] = [];
  for (let i = 1; i < latLngs.length; i += 1) {
    const d = latLngs[i - 1].distanceTo(latLngs[i]);
    segLen.push(d);
    total += d;
  }
  let remaining = total / 2;
  for (let i = 0; i < segLen.length; i += 1) {
    if (remaining <= segLen[i]) {
      const t = segLen[i] > 0 ? remaining / segLen[i] : 0;
      return L.latLng(
        latLngs[i].lat + (latLngs[i + 1].lat - latLngs[i].lat) * t,
        latLngs[i].lng + (latLngs[i + 1].lng - latLngs[i].lng) * t,
      );
    }
    remaining -= segLen[i];
  }
  return latLngs[latLngs.length - 1];
}

function clearPathHighlight(state: InternalState): void {
  state.pathHighlightGroup.clearLayers();
  state.pathEndpointGroup.clearLayers();
  state.pathArrowLayer.clearLayers();
  // 还原被 dim 的原箭头
  for (const edgeRef of state.dimmedArrowKeys) {
    const marker = state.arrowById.get(edgeRef);
    if (marker) marker.setOpacity(1);
  }
  state.dimmedArrowKeys.clear();
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
  if (!edge?.sourceSlice) return null;
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
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch] ?? ch));
}
