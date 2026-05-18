import type {
  AnnotatedFeature,
  AnnotatedFeatureCollection,
  RailGraphAnnotation,
  RailGraphFeatureKind,
} from "../rail-graph-v1/annotation.types";
import type {
  BaseTopologyLayer,
  PlatformTrackBinding,
  StoppingPoint,
  TopologyEdge,
  TopologyNode,
} from "../rail-graph-v1/base-topology.types";
import type { Diagnostic, DiagnosticLevel } from "../rail-graph-v1/diagnostic-types";
import type {
  PlatformTrackBindingInput,
  StoppingPointInput,
} from "../rail-graph-v1/editing.types";
import type {
  GeoJSONGeometry,
  GeoJSONPosition,
} from "../rail-graph-v1/geojson";
import type { EntityRef } from "../rail-graph-v1/primitives";
import {
  aggregateDoubleTrackPairs,
  buildAdjacency,
  buildTopologyLookup,
  type TopologyLookup,
} from "../rail-graph-v1/topology";
import { buildLiangMianSiXianGeoJson, BINDING_PLAN, STOP_PLAN } from "./poc-liangmiansixian";
import {
  buildTwoStationGeoJson,
  BINDING_PLAN as TWO_STATION_BINDING_PLAN,
  STOP_PLAN as TWO_STATION_STOP_PLAN,
} from "./poc-twostation";
import { runScenarios, summarizeScenarios } from "./poc-pathfinding";
import type { ScenarioResult } from "./poc-pathfinding";
import { SENSEKI_RAIL, SENSEKI_STATIONS } from "./senseki-data";
import { createMapView, type MapView } from "./map-view";
import { createListView, type ListView } from "./list-view";

type RailGraphKind = RailGraphFeatureKind;
type GeoJsonGeometry = GeoJSONGeometry;
type GeoJsonFeature = AnnotatedFeature;
type GeoJsonFeatureCollection = AnnotatedFeatureCollection;

interface RailGraphMvpState {
  source: GeoJsonFeatureCollection | null;
  bindings: PlatformTrackBindingInput[];
  stoppingPoints: StoppingPointInput[];
  topo: BaseTopologyLayer | null;
  diagnostics: Diagnostic[];
}

const ENDPOINT_PRECISION = 6;
const EMPTY_TOPO: BaseTopologyLayer = {
  nodes: [],
  edges: [],
  adjacency: { outEdges: {}, inEdges: {} },
  stations: [],
  platforms: [],
  platformTrackBindings: [],
  stoppingPoints: [],
  signals: [],
  specialSections: [],
  doubleTrackPairs: [],
  relations: [],
  hardConstraints: [],
};

export const state: RailGraphMvpState = {
  source: null,
  bindings: [],
  stoppingPoints: [],
  topo: null,
  diagnostics: [],
};

let mapView: MapView | null = null;
let listView: ListView | null = null;
let lastPathfindingResults: ScenarioResult[] | undefined;

export function loadGeoJson(raw: string | GeoJsonFeatureCollection): RailGraphMvpState {
  state.source = null;
  state.bindings = [];
  state.stoppingPoints = [];
  state.topo = null;
  state.diagnostics = [];
  return importGeoJson(raw);
}

export function importGeoJson(raw: string | GeoJsonFeatureCollection): RailGraphMvpState {
  const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (!isFeatureCollection(parsed)) {
    throw new Error("Input must be a GeoJSON FeatureCollection.");
  }

  const existing = state.source?.features ?? [];
  const incoming = parsed.features.map((feature, index) => ({
      ...feature,
      properties: {
        ...feature.properties,
        railGraph: normalizeAnnotation(feature, index),
      },
    }));

  const deduped = dedupeFeatures([...existing, ...incoming]);
  state.source = {
    type: "FeatureCollection",
    features: deduped.features,
  };
  state.topo = null;
  state.diagnostics = deduped.skipped > 0
    ? [diagnostic("info", "MVP_IMPORT_DEDUPED", "import", "Duplicate features were skipped.", { skipped: deduped.skipped })]
    : [];
  return state;
}

export function createFeature(input: {
  geometryType: "Point" | "LineString" | "Polygon";
  coordinates: GeoJSONPosition | GeoJSONPosition[] | GeoJSONPosition[][];
  kind?: RailGraphKind;
  name?: string;
}): RailGraphMvpState {
  const feature: GeoJsonFeature = {
    type: "Feature",
    geometry: createGeometry(input.geometryType, input.coordinates),
    properties: {
      name: input.name,
    },
  };
  const annotation = normalizeAnnotation(feature, state.source?.features.length ?? 0);
  annotation.kind = input.kind ?? "unknown";
  feature.properties.railGraph = annotation;
  return importGeoJson({ type: "FeatureCollection", features: [feature] });
}

export function annotateFeature(
  featureIndex: number,
  annotation: Partial<RailGraphAnnotation> & { kind: RailGraphKind },
): RailGraphMvpState {
  const feature = getFeature(featureIndex);
  const existing = feature.properties.railGraph ?? normalizeAnnotation(feature, featureIndex);
  feature.properties.railGraph = {
    ...existing,
    ...annotation,
    schemaVersion: "rail-graph-v1",
    id: annotation.id ?? existing.id,
    source: annotation.source ?? existing.source,
  };
  state.topo = null;
  return state;
}

export function addPlatformTrackBinding(input: PlatformTrackBindingInput): RailGraphMvpState {
  state.bindings.push(input);
  state.topo = null;
  return state;
}

export function confirmStoppingPoint(input: StoppingPointInput): RailGraphMvpState {
  state.stoppingPoints.push({
    ...input,
    measure: clampMeasure(input.measure),
  });
  state.topo = null;
  return state;
}

export function compileTopology(): BaseTopologyLayer {
  if (!state.source) {
    state.diagnostics = [diagnostic("fatal", "MVP_NO_SOURCE", "compile", "No GeoJSON source loaded.")];
    state.topo = cloneTopo(EMPTY_TOPO);
    return state.topo;
  }

  const diagnostics: Diagnostic[] = [];
  const topo = cloneTopo(EMPTY_TOPO);
  const geometryRefs = new Set<string>();

  const annotatedFeatures = state.source.features.map((feature, index) => ({
    feature,
    index,
    annotation: feature.properties.railGraph,
  }));

  for (const { annotation, index } of annotatedFeatures) {
    if (!annotation || annotation.kind === "unknown") {
      diagnostics.push(diagnostic("warn", "MVP_UNKNOWN_FEATURE", "compile", "Feature is not annotated.", { index }));
    }
  }

  for (const { feature, annotation, index } of annotatedFeatures) {
    if (annotation?.kind === "station_point") {
      addStationFeature(topo, diagnostics, feature, annotation, index);
    }
  }

  for (const { feature, annotation, index } of annotatedFeatures) {
    if (annotation?.kind === "platform_area") {
      addPlatformFeature(topo, diagnostics, feature, annotation, index);
    }
  }

  for (const { feature, annotation, index } of annotatedFeatures) {
    if (!annotation || annotation.kind === "unknown" || annotation.kind === "station_point" || annotation.kind === "platform_area") {
      continue;
    }

    if (annotation.kind === "track_geometry") {
      addTrackFeature(topo, diagnostics, feature, annotation, index, geometryRefs);
      continue;
    }

    diagnostics.push(diagnostic("info", "MVP_KIND_DEFERRED", "compile", "Kind is annotated but not compiled in MVP.", {
      index,
      kind: annotation.kind,
    }));
  }

  // signal_point 编译: 直接从 annotation 拷 (不做空间投影)
  for (const { feature, annotation, index } of annotatedFeatures) {
    if (annotation?.kind === "signal_point") {
      addSignalFeature(topo, diagnostics, annotation, index);
    }
  }

  // directionRole 自动 fallback: traversal=both 但无 directionRole → 自动填 bidirectional
  for (const edge of topo.edges) {
    if (edge.traversal === "both" && !edge.directionRole) {
      edge.directionRole = "bidirectional";
      diagnostics.push(diagnostic(
        "info",
        "MVP_TRACK_DIRECTION_ROLE_INFERRED_BIDIRECTIONAL",
        "compile",
        "Edge has traversal=both but no directionRole; auto-assigned 'bidirectional'.",
        { edgeId: edge.id },
      ));
    }
  }

  topo.adjacency = buildAdjacency(topo.edges);
  addBindings(topo, diagnostics);
  addStoppingPoints(topo, diagnostics);
  topo.doubleTrackPairs = aggregateDoubleTrackPairs(
    topo.edges,
    stableId("manual", "doubleTrackPair", "auto"),
  );

  if (topo.edges.length === 0) {
    diagnostics.push(diagnostic("error", "MVP_NO_TRACKS", "compile", "No track_geometry features were compiled."));
  }

  state.diagnostics = diagnostics;
  state.topo = topo;
  return topo;
}

export function exportAnnotatedGeoJson(): GeoJsonFeatureCollection {
  if (!state.source) {
    throw new Error("No GeoJSON source loaded.");
  }
  return JSON.parse(JSON.stringify(state.source)) as GeoJsonFeatureCollection;
}

export function exportTopology(): BaseTopologyLayer {
  return state.topo ?? compileTopology();
}

export function exportDiagnostics(): Diagnostic[] {
  if (!state.topo) {
    compileTopology();
  }
  return state.diagnostics;
}

// ── Demo state snapshot (Phase 0) ─────────────────────────────
// 完整序列化当前仙石线 demo 状态 (annotation overrides + bindings + source GeoJSON
// + 诊断 snapshot), 供用户在 ingest 重跑 / schema 升级 / 误操作前先 Export 一份
// 作为回滚依据.

export interface SensekiDemoSnapshot {
  schemaVersion: "senseki-demo-v1";
  exportedAt: string;
  app: {
    gitCommit?: string;
    sensekiDataHash?: string;
  };
  source: GeoJsonFeatureCollection;
  overrides: Record<string, RailGraphAnnotation>;
  bindings: PlatformTrackBindingInput[];
  stoppingPoints: StoppingPointInput[];
  diagnostics: Diagnostic[];
  topologySummary: {
    counts: { stations: number; platforms: number; edges: number; signals: number; bindings: number };
    diagnosticCounts: Record<DiagnosticLevel, number>;
    diagnosticCountsByCode: Record<string, number>;
  };
}

export function exportSensekiSnapshot(): SensekiDemoSnapshot {
  if (!state.source) {
    throw new Error("No GeoJSON source loaded.");
  }
  if (!state.topo) {
    compileTopology();
  }
  const topo = state.topo!;
  const overrides = loadAnnotationOverrides();

  const diagnosticCounts: Record<DiagnosticLevel, number> = { fatal: 0, error: 0, warn: 0, info: 0 };
  const diagnosticCountsByCode: Record<string, number> = {};
  for (const d of state.diagnostics) {
    diagnosticCounts[d.level] = (diagnosticCounts[d.level] ?? 0) + 1;
    diagnosticCountsByCode[d.code] = (diagnosticCountsByCode[d.code] ?? 0) + 1;
  }

  return {
    schemaVersion: "senseki-demo-v1",
    exportedAt: new Date().toISOString(),
    app: {
      sensekiDataHash: hashSensekiData(),
    },
    source: JSON.parse(JSON.stringify(state.source)) as GeoJsonFeatureCollection,
    overrides,
    bindings: state.bindings.map((b) => ({ ...b })),
    stoppingPoints: state.stoppingPoints.map((s) => ({ ...s })),
    diagnostics: state.diagnostics.map((d) => ({ ...d })),
    topologySummary: {
      counts: {
        stations: topo.stations.length,
        platforms: topo.platforms.length,
        edges: topo.edges.length,
        signals: topo.signals.length,
        bindings: topo.platformTrackBindings.length,
      },
      diagnosticCounts,
      diagnosticCountsByCode,
    },
  };
}

export interface ImportSnapshotResult {
  overridesApplied: number;
  overridesTotal: number;
  bindingsRestored: number;
  stoppingPointsRestored: number;
  hashMatch: boolean;
  exportedAt: string;
  exportedHash?: string;
  currentHash: string;
}

export function importSensekiSnapshot(snapshot: SensekiDemoSnapshot): ImportSnapshotResult {
  if (snapshot.schemaVersion !== "senseki-demo-v1") {
    throw new Error(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  if (!snapshot.source || !Array.isArray(snapshot.source.features)) {
    throw new Error("Snapshot missing source FeatureCollection.");
  }

  // 1. 写 overrides 到 localStorage (即使 source 已含合并后 annotation,
  //    overrides 仍是权威备份, 供下次刷新或重新 Import 仙石線 时复用).
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(ANNOTATION_OVERRIDES_KEY, JSON.stringify(snapshot.overrides ?? {}));
    } catch {
      // quota / privacy mode — silent, source 已含 annotation 仍可用
    }
  }

  // 2. 加载 source — loadGeoJson 会重置 bindings/stoppingPoints/topo/diagnostics
  loadGeoJson(snapshot.source);

  // 3. 重放 overrides (idempotent — snapshot.source 应已合并, 但这一步确保
  //    任何 ID 漂移情况下 overrides 仍尽力打回去).
  const { applied, total } = applyAnnotationOverrides();

  // 4. 还原 bindings / stoppingPoints (loadGeoJson 已重置, 直接覆盖)
  state.bindings = (snapshot.bindings ?? []).map((b) => ({ ...b }));
  state.stoppingPoints = (snapshot.stoppingPoints ?? []).map((s) => ({ ...s }));
  state.topo = null;

  // 5. 重编 + 刷新视图
  compileTopology();
  lastPathfindingResults = undefined;
  refreshViews();

  const currentHash = hashSensekiData();
  const exportedHash = snapshot.app?.sensekiDataHash;
  return {
    overridesApplied: applied,
    overridesTotal: total,
    bindingsRestored: state.bindings.length,
    stoppingPointsRestored: state.stoppingPoints.length,
    hashMatch: !exportedHash || exportedHash === currentHash,
    exportedAt: snapshot.exportedAt,
    exportedHash,
    currentHash,
  };
}

// 轻量 hash: 不必密码学级别, 只要能检测 senseki-data.ts 重跑后的 ID 漂移.
// 采样 features 数量 + 首/中/尾 annotation.id 拼接成稳定字符串 → djb2.
function hashSensekiData(): string {
  const features = SENSEKI_RAIL.features;
  const n = features.length;
  if (n === 0) return "00000000";
  const idAt = (idx: number): string =>
    features[idx]?.properties?.railGraph?.id ?? "";
  const sample = [
    `n=${n}`,
    `first=${idAt(0)}`,
    `mid=${idAt(Math.floor(n / 2))}`,
    `last=${idAt(n - 1)}`,
  ].join("|");
  let h = 5381;
  for (let i = 0; i < sample.length; i++) {
    h = ((h * 33) ^ sample.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

function normalizeAnnotation(feature: GeoJsonFeature, index: number): RailGraphAnnotation {
  const existing = feature.properties.railGraph;
  if (existing?.kind) {
    return {
      schemaVersion: "rail-graph-v1",
      id: existing.id || stableId("manual", "feature", String(index)),
      source: existing.source || "manual",
      ...existing,
    };
  }

  return {
    kind: "unknown",
    schemaVersion: "rail-graph-v1",
    id: stableId("manual", "feature", `${index}:${feature.geometry.type}`),
    source: "manual",
  };
}

function addTrackFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: GeoJsonFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
  geometryRefs: Set<string>,
): void {
  const lines = lineStringsFromGeometry(feature.geometry);
  if (lines.length === 0) {
    diagnostics.push(diagnostic("error", "MVP_INVALID_TRACK_GEOMETRY", "compile", "track_geometry requires LineString or MultiLineString.", {
      featureIndex,
      geometryType: feature.geometry.type,
    }));
    return;
  }

  for (const [lineIndex, coordinates] of lines.entries()) {
    if (coordinates.length < 2) {
      diagnostics.push(diagnostic("error", "MVP_SHORT_TRACK_GEOMETRY", "compile", "Track geometry needs at least two coordinates.", {
        featureIndex,
        lineIndex,
      }));
      continue;
    }

    if (!annotation.track?.functionalUse || annotation.track.functionalUse.length === 0) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_TRACK_FUNCTIONAL_USE_UNDECLARED",
        "compile",
        "Track has no explicit functionalUse. Do not infer from binding state or position.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }
    if (!annotation.track?.physicalKind) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_TRACK_PHYSICAL_KIND_UNDECLARED",
        "compile",
        "Track has no explicit physicalKind (main/siding/yard/lead/safety).",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }
    if (!annotation.track?.directionRole) {
      diagnostics.push(diagnostic(
        "info",
        "MVP_TRACK_DIRECTION_ROLE_UNDECLARED",
        "compile",
        "Track has no directionRole; it will not be aggregated into DoubleTrackPair.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }

    const edgeId = stableId("manual", "edge", `${annotation.id}:${lineIndex}`);
    const fromNodeRef = nodeIdForCoordinate(coordinates[0]);
    const toNodeRef = nodeIdForCoordinate(coordinates[coordinates.length - 1]);
    ensureNode(topo, fromNodeRef, "line_endpoint", coordinates[0]);
    ensureNode(topo, toNodeRef, "line_endpoint", coordinates[coordinates.length - 1]);

    // turnback 一致性校验: functionalUse 含 turnback 但 directionRole !== reversible
    if (
      Array.isArray(annotation.track?.functionalUse)
      && annotation.track!.functionalUse!.includes("turnback")
      && annotation.track?.directionRole !== "reversible"
    ) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_REVERSIBLE_WITHOUT_TURNBACK_ROLE",
        "compile",
        "Track has functionalUse=turnback but directionRole is not 'reversible'. turnback requires reversible direction role.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }

    const geometryRef = stableId("manual", "geometry", `${annotation.id}:${lineIndex}`);
    geometryRefs.add(geometryRef);
    topo.edges.push({
      id: edgeId,
      fromNodeRef,
      toNodeRef,
      traversal: annotation.track?.traversal ?? "both",
      role: annotation.track?.role ?? "main",
      name: annotation.track?.name || feature.properties.name as string | undefined,
      trackCode: annotation.track?.trackCode,
      geometryRef,
      lengthMeters: calculateLengthMeters(coordinates),
      physicalKind: annotation.track?.physicalKind,
      functionalUse: annotation.track?.functionalUse,
      directionRole: annotation.track?.directionRole,
      sourceSlice: {
        sourceFeatureRef: annotation.id,
        multiLineIndex: feature.geometry.type === "MultiLineString" ? lineIndex : undefined,
        startMeasure: 0,
        endMeasure: 1,
      },
      sourceTags: extractSourceTags(feature.properties),
    });
  }
}

function addStationFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: GeoJsonFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
): void {
  if (feature.geometry.type !== "Point") {
    diagnostics.push(diagnostic("error", "MVP_INVALID_STATION_GEOMETRY", "compile", "station_point requires Point geometry.", {
      featureIndex,
      geometryType: feature.geometry.type,
    }));
    return;
  }

  const id = annotation.id as EntityRef;
  topo.stations.push({
    id,
    name: annotation.station?.name || feature.properties.name as string || `Station ${featureIndex + 1}`,
    platformRefs: [],
    positionRef: stableId("manual", "position", annotation.id),
  });
}

function addPlatformFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: GeoJsonFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
): void {
  if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon" && feature.geometry.type !== "Point") {
    diagnostics.push(diagnostic("error", "MVP_INVALID_PLATFORM_GEOMETRY", "compile", "platform_area requires Polygon, MultiPolygon, or Point in MVP.", {
      featureIndex,
      geometryType: feature.geometry.type,
    }));
    return;
  }

  const id = annotation.id as EntityRef;
  const stationRef = annotation.platform?.stationRef || firstStationRef(topo);
  if (!stationRef) {
    diagnostics.push(diagnostic("warn", "MVP_PLATFORM_WITHOUT_STATION", "compile", "Platform has no stationRef.", { featureIndex }));
  }
  if (!annotation.platform?.type) {
    diagnostics.push(diagnostic(
      "warn",
      "MVP_PLATFORM_TYPE_UNDECLARED",
      "compile",
      "Platform has no explicit type (side/island/bay). Falling back to 'unknown'.",
      { featureIndex, platformName: annotation.platform?.name },
    ));
  }

  topo.platforms.push({
    id,
    stationRef: (stationRef ?? stableId("manual", "station", "missing")) as EntityRef,
    type: annotation.platform?.type ?? "unknown",
    name: annotation.platform?.name || feature.properties.name as string | undefined,
    number: annotation.platform?.number,
    areaRef: stableId("manual", "area", annotation.id),
  });

  const station = topo.stations.find((item) => item.id === stationRef);
  if (station && !station.platformRefs.includes(id)) {
    station.platformRefs.push(id);
  }
}

function addSignalFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  annotation: RailGraphAnnotation,
  featureIndex: number,
): void {
  if (!annotation.signal) {
    diagnostics.push(diagnostic("warn", "MVP_SIGNAL_NO_DATA", "compile", "signal_point feature has no signal annotation.", { featureIndex }));
    return;
  }
  // 直接从 annotation 拷, 不做空间投影
  const id = annotation.id as EntityRef;
  topo.signals.push({
    id,
    edgeRef: annotation.signal.edgeRef as EntityRef,
    measure: clampMeasure(annotation.signal.measure),
    facing: annotation.signal.facing,
    name: annotation.signal.name,
  });
}

function addBindings(topo: BaseTopologyLayer, diagnostics: Diagnostic[]): void {
  for (const [index, input] of state.bindings.entries()) {
    if (!topo.stations.some((station) => station.id === input.stationRef)) {
      diagnostics.push(diagnostic("error", "MVP_BINDING_MISSING_STATION", "compile", "Binding references a missing station.", { index, stationRef: input.stationRef }));
      continue;
    }
    if (!topo.platforms.some((platform) => platform.id === input.platformRef)) {
      diagnostics.push(diagnostic("error", "MVP_BINDING_MISSING_PLATFORM", "compile", "Binding references a missing platform.", { index, platformRef: input.platformRef }));
      continue;
    }
    if (!topo.edges.some((edge) => edge.id === input.edgeRef)) {
      diagnostics.push(diagnostic("error", "MVP_BINDING_MISSING_EDGE", "compile", "Binding references a missing edge.", { index, edgeRef: input.edgeRef }));
      continue;
    }

    const id = stableId("manual", "binding", `${input.stationRef}:${input.platformRef}:${input.edgeRef}:${index}`);
    topo.platformTrackBindings.push({
      id,
      stationRef: input.stationRef as EntityRef,
      platformRef: input.platformRef as EntityRef,
      edgeRef: input.edgeRef as EntityRef,
      side: input.side,
      servingDirection: input.servingDirection,
    });
    topo.relations.push({
      id: stableId("manual", "relation", id),
      kind: "platform_serves_track",
      fromRef: input.platformRef as EntityRef,
      toRef: input.edgeRef as EntityRef,
      payload: { stationRef: input.stationRef, side: input.side },
    });
  }
}

function addStoppingPoints(topo: BaseTopologyLayer, diagnostics: Diagnostic[]): void {
  for (const [index, input] of state.stoppingPoints.entries()) {
    if (!topo.stations.some((station) => station.id === input.stationRef)) {
      diagnostics.push(diagnostic("error", "MVP_STOP_MISSING_STATION", "compile", "Stopping point references a missing station.", { index, stationRef: input.stationRef }));
      continue;
    }
    if (!topo.platforms.some((platform) => platform.id === input.platformRef)) {
      diagnostics.push(diagnostic("error", "MVP_STOP_MISSING_PLATFORM", "compile", "Stopping point references a missing platform.", { index, platformRef: input.platformRef }));
      continue;
    }
    if (!topo.edges.some((edge) => edge.id === input.edgeRef)) {
      diagnostics.push(diagnostic("error", "MVP_STOP_MISSING_EDGE", "compile", "Stopping point references a missing edge.", { index, edgeRef: input.edgeRef }));
      continue;
    }

    const matchingBinding = topo.platformTrackBindings.find((binding) => {
      if (binding.platformRef !== input.platformRef) return false;
      if (binding.edgeRef !== input.edgeRef) return false;
      if (input.direction === "both") return true;
      if (!binding.servingDirection) return true;
      return binding.servingDirection === input.direction;
    });
    if (!matchingBinding) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_STOP_NO_MATCHING_BINDING",
        "compile",
        "Stopping point has no matching PlatformTrackBinding for (platform, edge, direction).",
        {
          index,
          platformRef: input.platformRef,
          edgeRef: input.edgeRef,
          direction: input.direction,
        },
      ));
    }

    topo.stoppingPoints.push({
      id: stableId("manual", "stoppingPoint", `${input.stationRef}:${input.platformRef}:${input.edgeRef}:${input.direction}:${input.measure}`),
      stationRef: input.stationRef as EntityRef,
      platformRef: input.platformRef as EntityRef,
      edgeRef: input.edgeRef as EntityRef,
      direction: input.direction,
      measure: clampMeasure(input.measure),
      confirmation: "confirmed",
    });
  }
}

function getFeature(featureIndex: number): GeoJsonFeature {
  if (!state.source) {
    throw new Error("No GeoJSON source loaded.");
  }
  const feature = state.source.features[featureIndex];
  if (!feature) {
    throw new Error(`Feature index ${featureIndex} does not exist.`);
  }
  return feature;
}

function ensureNode(
  topo: BaseTopologyLayer,
  nodeRef: EntityRef,
  kind: TopologyNode["kind"],
  coordinate: GeoJSONPosition,
): void {
  if (topo.nodes.some((node) => node.id === nodeRef)) {
    return;
  }
  topo.nodes.push({
    id: nodeRef,
    kind,
    geometryRef: stableId("manual", "position", coordinateKey(coordinate)),
  });
}

function firstStationRef(topo: BaseTopologyLayer): EntityRef | undefined {
  return topo.stations[0]?.id;
}

function lineStringsFromGeometry(geometry: GeoJsonGeometry): GeoJSONPosition[][] {
  if (geometry.type === "LineString") {
    return [geometry.coordinates];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates;
  }
  return [];
}

function isFeatureCollection(value: unknown): value is GeoJsonFeatureCollection {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as Partial<GeoJsonFeatureCollection>;
  return maybe.type === "FeatureCollection" && Array.isArray(maybe.features);
}

function dedupeFeatures(features: GeoJsonFeature[]): { features: GeoJsonFeature[]; skipped: number } {
  const seen = new Set<string>();
  const out: GeoJsonFeature[] = [];
  let skipped = 0;

  for (const feature of features) {
    const key = featureFingerprint(feature);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    out.push(feature);
  }

  return { features: out, skipped };
}

function featureFingerprint(feature: GeoJsonFeature): string {
  return `${feature.geometry.type}:${JSON.stringify(feature.geometry.coordinates)}:${String(feature.properties.name ?? "")}`;
}

function createGeometry(
  geometryType: "Point" | "LineString" | "Polygon",
  coordinates: GeoJSONPosition | GeoJSONPosition[] | GeoJSONPosition[][],
): GeoJsonGeometry {
  if (geometryType === "Point") {
    if (!isPosition(coordinates)) {
      throw new Error("Point coordinates must be [lng, lat].");
    }
    return { type: "Point", coordinates };
  }

  if (geometryType === "LineString") {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(isPosition)) {
      throw new Error("LineString coordinates must be [[lng, lat], ...] with at least two points.");
    }
    return { type: "LineString", coordinates };
  }

  if (!Array.isArray(coordinates) || coordinates.length < 1 || !Array.isArray(coordinates[0])) {
    throw new Error("Polygon coordinates must be [[[lng, lat], ...]].");
  }

  const ring = coordinates[0] as GeoJSONPosition[];
  if (ring.length < 4 || !ring.every(isPosition)) {
    throw new Error("Polygon outer ring needs at least four [lng, lat] points.");
  }
  return { type: "Polygon", coordinates: coordinates as GeoJSONPosition[][] };
}

function isPosition(value: unknown): value is GeoJSONPosition {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number";
}

function cloneTopo(topo: BaseTopologyLayer): BaseTopologyLayer {
  return JSON.parse(JSON.stringify(topo)) as BaseTopologyLayer;
}

function diagnostic(
  level: Diagnostic["level"],
  code: string,
  stage: string,
  message: string,
  context?: Record<string, unknown>,
): Diagnostic {
  return { level, code, stage, message, context };
}

function stableId(source: string, entityType: string, value: string): EntityRef {
  return `${source}:${entityType}:${slug(value)}` as EntityRef;
}

function nodeIdForCoordinate(coordinate: GeoJSONPosition): EntityRef {
  return stableId("manual", "node", coordinateKey(coordinate));
}

function extractSourceTags(properties: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const sourceTags = properties.sourceTags;
  if (sourceTags && typeof sourceTags === "object") {
    for (const [k, v] of Object.entries(sourceTags as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  for (const [k, v] of Object.entries(properties)) {
    if (k === "railGraph" || k === "sourceTags") continue;
    if (v === undefined || v === null || v === "") continue;
    if (out[k] !== undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function coordinateKey(coordinate: GeoJSONPosition): string {
  return `${coordinate[0].toFixed(ENDPOINT_PRECISION)},${coordinate[1].toFixed(ENDPOINT_PRECISION)}`;
}

function slug(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "id"}-${hash.toString(16)}`;
}

function clampMeasure(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function calculateLengthMeters(coordinates: GeoJSONPosition[]): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceMeters(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

function distanceMeters(left: GeoJSONPosition, right: GeoJSONPosition): number {
  const earthRadiusMeters = 6371000;
  const leftLat = toRadians(left[1]);
  const rightLat = toRadians(right[1]);
  const deltaLat = toRadians(right[1] - left[1]);
  const deltaLng = toRadians(right[0] - left[0]);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function setupShellGutters(root: HTMLElement): void {
  const shell = root.querySelector<HTMLElement>(".shell");
  if (!shell) return;
  const gutters = shell.querySelectorAll<HTMLElement>(".panel-gutter");
  gutters.forEach((gutter) => {
    const which = gutter.dataset.gutter;
    const isRight = which !== "left";
    const varName = isRight ? "--shell-right" : "--shell-left";
    setupResizableGutter(gutter, {
      direction: "horizontal",
      container: shell,
      varName,
      minSize: 200,
      defaultSize: isRight ? 380 : 320,
      anchorFromEnd: isRight,
    });
  });
}

function setupResizableGutter(
  gutter: HTMLElement,
  opts: {
    direction: "horizontal" | "vertical";
    container: HTMLElement;
    varName: string;
    minSize: number;
    defaultSize: number;
    anchorFromEnd?: boolean;
  },
): void {
  let dragging = false;
  gutter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    gutter.classList.add("dragging");
    document.body.style.cursor = opts.direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = opts.container.getBoundingClientRect();
    // 右/底锚定 panel 的宽度 = 容器右(底)边距 - 鼠标位置; 否则 = 鼠标 - 左(顶)边距
    const size = opts.direction === "horizontal"
      ? (opts.anchorFromEnd ? rect.right - e.clientX : e.clientX - rect.left)
      : (opts.anchorFromEnd ? rect.bottom - e.clientY : e.clientY - rect.top);
    // 计算可用空间 — 加上 minSize*2 是左右/上下最少各自一个 panel 的空间
    const maxSingle = opts.direction === "horizontal"
      ? rect.width - opts.minSize * 2 - 8  // 8 = 2 gutters
      : rect.height - opts.minSize * 2 - 8;
    const clamped = Math.max(opts.minSize, Math.min(maxSingle, Math.round(size)));
    opts.container.style.setProperty(opts.varName, `${clamped}px`);
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    gutter.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // 保存到本地存储
    const val = opts.container.style.getPropertyValue(opts.varName);
    if (val) {
      try { localStorage.setItem(`mvp-gutter-${opts.varName}`, val); } catch { /* ignore */ }
    }
  });
  // 恢复保存值
  try {
    const saved = localStorage.getItem(`mvp-gutter-${opts.varName}`);
    if (saved) opts.container.style.setProperty(opts.varName, saved);
  } catch { /* ignore */ }
}

function render(): void {
  const root = document.getElementById("rail-graph-mvp");
  if (!root) {
    return;
  }

  // 仅在首次渲染时建结构; 后续调用走 refreshViews() / renderFeatures()
  if (root.dataset.mounted === "true") {
    refreshViews();
    renderFeatures();
    return;
  }

  root.innerHTML = `
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #1f2937; }
      .shell { display: grid; grid-template-columns: var(--shell-left, 320px) 4px 1fr 4px var(--shell-right, 380px); gap: 0; height: 100vh; padding: 12px 12px 12px 9px; box-sizing: border-box; }
.panel-gutter { cursor: col-resize; background: transparent; transition: background 120ms; user-select: none; border-radius: 2px; }
.panel-gutter:hover, .panel-gutter.dragging { background: #93c5fd; }
      .panel { background: #fff; border: 1px solid #d7dce2; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
      .panel h1, .panel h2 { margin: 0; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
      .body { padding: 10px 12px; overflow: auto; flex: 1; min-height: 0; }
      textarea { width: 100%; min-height: 110px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; }
      button, select, input { font: inherit; }
      button { border: 1px solid #b8c2cc; background: #fff; border-radius: 6px; padding: 5px 8px; cursor: pointer; font-size: 12px; }
      button.primary { background: #155e75; color: #fff; border-color: #155e75; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 6px 0; }
      .feature { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; font-size: 11.5px; }
      .feature strong { display: block; margin-bottom: 4px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .field { display: grid; gap: 2px; font-size: 11px; }
      .field input, .field select { border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; min-width: 0; font-size: 11.5px; }
      .map-panel { padding: 0; }
      #mvp-map { flex: 1; min-height: 0; height: 100%; }
      .map-toolbar { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; display: flex; gap: 6px; align-items: center; font-size: 12px; flex-shrink: 0; background: #f8fafc; }
      .list-panel-body { padding: 0; }
    </style>
    <main class="shell">
      <section class="panel">
        <h1>Rail Graph MVP</h1>
        <div class="body">
          <textarea id="mvp-input" placeholder="Paste GeoJSON FeatureCollection"></textarea>
          <div class="row">
            <button id="mvp-load" class="primary">Load Reset</button>
            <button id="mvp-import">Import Append</button>
            <button id="mvp-sample">Sample</button>
          </div>
          <div class="row">
            <button id="mvp-liangmiansixian" class="primary">两面四線 Demo</button>
            <button id="mvp-senseki" class="primary">Import 仙石線 OSM</button>
            <button id="mvp-clear-overrides">Clear annot overrides</button>
            <button id="mvp-pathfinding" class="primary">Pathfinding 4 场景</button>
            <button id="mvp-compile">Compile</button>
          </div>
          <div class="feature">
            <strong>Create Object</strong>
            <div class="grid">
              <label class="field">Geometry
                <select id="mvp-create-geometry">
                  <option value="Point">Point</option>
                  <option value="LineString">LineString</option>
                  <option value="Polygon">Polygon</option>
                </select>
              </label>
              <label class="field">Kind
                <select id="mvp-create-kind">
                  ${kindOption("unknown")}
                  ${kindOption("station_point")}
                  ${kindOption("platform_area")}
                  ${kindOption("track_geometry")}
                  ${kindOption("switch_point")}
                  ${kindOption("special_section")}
                </select>
              </label>
            </div>
            <label class="field">Name
              <input id="mvp-create-name" placeholder="optional" />
            </label>
            <label class="field">Coordinates JSON
              <textarea id="mvp-create-coordinates" style="min-height:50px" placeholder="[139.7,35.69]"></textarea>
            </label>
            <div class="row">
              <button id="mvp-create-object">Create Into Queue</button>
            </div>
          </div>
          <div class="feature">
            <strong>Binding / Stop</strong>
            <div class="grid">
              <label class="field">Station
                <select id="mvp-station-ref">${topoOptions("stations")}</select>
              </label>
              <label class="field">Platform
                <select id="mvp-platform-ref">${topoOptions("platforms")}</select>
              </label>
              <label class="field">Edge
                <select id="mvp-edge-ref">${topoOptions("edges")}</select>
              </label>
              <label class="field">Side
                <select id="mvp-binding-side">
                  <option value="unknown">unknown</option>
                  <option value="left">left</option>
                  <option value="right">right</option>
                  <option value="both">both</option>
                </select>
              </label>
              <label class="field">Direction
                <select id="mvp-stop-direction">
                  <option value="both">both</option>
                  <option value="up">up</option>
                  <option value="down">down</option>
                </select>
              </label>
              <label class="field">Measure
                <input id="mvp-stop-measure" type="number" min="0" max="1" step="0.01" value="0.5" />
              </label>
            </div>
            <div class="row">
              <button id="mvp-add-binding">Add Binding</button>
              <button id="mvp-add-stop">Confirm Stop</button>
            </div>
          </div>
          <div class="row">
            <button id="mvp-export-geojson">Export GeoJSON</button>
            <button id="mvp-export-topo">Export Topo</button>
            <button id="mvp-export-snapshot" class="primary">Export Demo Snapshot</button>
            <button id="mvp-import-snapshot">Import Demo Snapshot</button>
            <input type="file" id="mvp-import-snapshot-file" accept=".json,.railround.json" style="display:none" />
          </div>
          <div id="mvp-features"></div>
        </div>
      </section>
      <div class="panel-gutter" data-gutter="left"></div>
      <section class="panel map-panel">
        <div class="map-toolbar">
          <strong>Map</strong>
          <span style="flex:1"></span>
          <label class="field" style="display:flex;flex-direction:row;align-items:center;gap:4px;font-size:11px">
            Base
            <select id="mvp-base-layer" style="font-size:11px">
              <option value="positron">Positron (lite)</option>
              <option value="plain">Plain</option>
            </select>
          </label>
          <button id="mvp-fit-data" style="font-size:11px">Fit</button>
        </div>
        <div id="mvp-map"></div>
      </section>
      <div class="panel-gutter" data-gutter="right"></div>
      <section class="panel list-panel-body">
        <div id="mvp-list" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
      </section>
    </main>
  `;
  root.dataset.mounted = "true";

  setupShellGutters(root);

  initViews();
  bindUi();
  renderFeatures();
  refreshViews();
}

function initViews(): void {
  const mapContainer = document.getElementById("mvp-map");
  const listContainer = document.getElementById("mvp-list");
  if (!mapContainer || !listContainer) return;

  mapView = createMapView(mapContainer);
  listView = createListView(listContainer);

  // 联动: map ↔ list
  // hover entity (map): 高亮 entity + related, 但 sticky 保留已选 path
  mapView.onHover((ref) => {
    if (!listView) return;
    listView.highlightEntity(ref);
    if (ref) {
      const related = computeRelatedRefs(ref);
      mapView?.highlightEntities([ref], related);
    } else {
      mapView?.clearEntityHighlight();
    }
  });
  mapView.onClick((ref) => {
    listView?.highlightEntity(ref);
    listView?.selectFeatureByRef(ref);
  });

  // hover entity (list): 同 map.onHover, 不动 path
  listView.onEntityHover((ref) => {
    if (ref) {
      const related = computeRelatedRefs(ref);
      mapView?.highlightEntities([ref], related);
    } else {
      mapView?.clearEntityHighlight();
    }
  });
  listView.onEntityClick((_ref) => {
    // 不做 zoom, 因为 fit-to-entity 还没实现 (后续 phase)
  });

  // hover/click path candidate: 高亮 path, 不动 entity
  listView.onPathHover((path) => {
    if (path) {
      mapView?.highlightPath(path.edgeSequence, path.turnbackEdgeIndices);
    } else {
      mapView?.clearPathHighlight();
    }
  });
  listView.onPathClick((path) => {
    mapView?.highlightPath(path.edgeSequence, path.turnbackEdgeIndices);
  });

  // Annotate tab: 写回 Feature.properties.railGraph + 持久化到 localStorage + 触发 compile/map 重渲
  listView.onAnnotationChange(({ featureIdx, annotation }) => {
    if (!state.source) return;
    const features = state.source.features;
    if (featureIdx < 0 || featureIdx >= features.length) return;
    const target = features[featureIdx];
    features[featureIdx] = {
      ...target,
      properties: {
        ...target.properties,
        railGraph: annotation,
      },
    };
    if (annotation.id) saveAnnotationOverride(annotation.id, annotation);
    try { compileTopology(); } catch (error) { handleError(error); }
    refreshViews();
  });

  // Annotate tab: 批量 annotation 变更 — 写回全部 + 编译一次
  listView.onAnnotationBatch((payloads) => {
    if (!state.source) return;
    const features = state.source.features;
    for (const { featureIdx, annotation } of payloads) {
      if (featureIdx < 0 || featureIdx >= features.length) continue;
      features[featureIdx] = {
        ...features[featureIdx],
        properties: {
          ...features[featureIdx].properties,
          railGraph: annotation,
        },
      };
      if (annotation.id) saveAnnotationOverride(annotation.id, annotation);
    }
    console.log(`[annotate] batch applied ${payloads.length} changes`);
    try { compileTopology(); } catch (error) { handleError(error); }
    refreshViews();
  });
}

// ── localStorage 持久化: annotation overrides ────────────────

const ANNOTATION_OVERRIDES_KEY = "railround:senseki:annotation-overrides:v1";

function loadAnnotationOverrides(): Record<string, RailGraphAnnotation> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(ANNOTATION_OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, RailGraphAnnotation>;
  } catch {
    return {};
  }
}

function saveAnnotationOverride(id: string, annotation: RailGraphAnnotation): void {
  if (typeof localStorage === "undefined") return;
  try {
    const overrides = loadAnnotationOverrides();
    overrides[id] = annotation;
    localStorage.setItem(ANNOTATION_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // quota / privacy mode — silent
  }
}

function applyAnnotationOverrides(): { applied: number; total: number } {
  if (!state.source) return { applied: 0, total: 0 };
  const overrides = loadAnnotationOverrides();
  const total = Object.keys(overrides).length;
  if (total === 0) return { applied: 0, total: 0 };
  let applied = 0;
  state.source = {
    ...state.source,
    features: state.source.features.map((f) => {
      const id = f.properties.railGraph?.id;
      if (id && overrides[id]) {
        applied += 1;
        return {
          ...f,
          properties: {
            ...f.properties,
            railGraph: overrides[id],
          },
        };
      }
      return f;
    }),
  };
  return { applied, total };
}

function clearAnnotationOverrides(): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(ANNOTATION_OVERRIDES_KEY); } catch {}
}

function computeRelatedRefs(ref: EntityRef): EntityRef[] {
  if (!state.topo) return [];
  const lookup: TopologyLookup = buildTopologyLookup(state.topo);
  const related: EntityRef[] = [];

  // Station ref?
  const station = lookup.stationsById[ref];
  if (station) {
    related.push(...station.platformRefs);
    for (const pid of station.platformRefs) {
      const bindings = lookup.bindingsByPlatform[pid] ?? [];
      for (const b of bindings) related.push(b.edgeRef);
    }
    return dedupe(related);
  }
  // Platform ref?
  const platform = lookup.platformsById[ref];
  if (platform) {
    related.push(platform.stationRef);
    const bindings = lookup.bindingsByPlatform[ref] ?? [];
    for (const b of bindings) related.push(b.edgeRef);
    return dedupe(related);
  }
  // Edge ref?
  const edge = lookup.edgesById[ref];
  if (edge) {
    const bindings = lookup.bindingsByEdge[ref] ?? [];
    for (const b of bindings) {
      related.push(b.platformRef);
      related.push(b.stationRef);
    }
    return dedupe(related);
  }
  return [];
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function refreshViews(): void {
  if (!mapView || !listView) return;
  if (state.topo && state.source) {
    mapView.update(state.topo, state.source);
  }
  listView.update({
    topo: state.topo,
    diagnostics: state.diagnostics,
    pathfindingResults: lastPathfindingResults,
    source: state.source,
  });
}

function bindUi(): void {
  document.getElementById("mvp-sample")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (input) {
      input.value = JSON.stringify(sampleGeoJson(), null, 2);
    }
  });

  document.getElementById("mvp-liangmiansixian")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (input) {
      input.value = JSON.stringify(buildLiangMianSiXianGeoJson(), null, 2);
    }
    const geoJson = buildLiangMianSiXianGeoJson();
    loadGeoJson(geoJson);
    compileTopology();
    for (const b of BINDING_PLAN) addPlatformTrackBinding(b);
    for (const s of STOP_PLAN) confirmStoppingPoint(s);
    compileTopology();
    lastPathfindingResults = undefined;
    renderFeatures();
    refreshViews();
    mapView?.fitToData();
  });

  document.getElementById("mvp-senseki")?.addEventListener("click", () => {
    try {
      loadGeoJson(SENSEKI_RAIL);
      importGeoJson(SENSEKI_STATIONS);
      const { applied, total } = applyAnnotationOverrides();
      compileTopology();
      if (total > 0) {
        console.log(`[senseki] applied ${applied}/${total} persisted annotation overrides`);
      }
      lastPathfindingResults = undefined;
      renderFeatures();
      refreshViews();
      mapView?.fitToData();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-clear-overrides")?.addEventListener("click", () => {
    clearAnnotationOverrides();
    console.log("[senseki] cleared all persisted annotation overrides");
  });

  document.getElementById("mvp-load")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (!input) return;
    try {
      loadGeoJson(input.value);
      lastPathfindingResults = undefined;
      compileTopology();
      renderFeatures();
      refreshViews();
      mapView?.fitToData();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-import")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (!input) return;
    try {
      importGeoJson(input.value);
      compileTopology();
      renderFeatures();
      refreshViews();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-create-object")?.addEventListener("click", () => {
    const geometryType = (selectedValue("mvp-create-geometry") || "Point") as "Point" | "LineString" | "Polygon";
    const kind = (selectedValue("mvp-create-kind") || "unknown") as RailGraphKind;
    const coordinatesText = (document.getElementById("mvp-create-coordinates") as HTMLTextAreaElement | null)?.value ?? "";
    const name = (document.getElementById("mvp-create-name") as HTMLInputElement | null)?.value ?? "";
    try {
      createFeature({
        geometryType,
        coordinates: JSON.parse(coordinatesText) as GeoJSONPosition | GeoJSONPosition[] | GeoJSONPosition[][],
        kind,
        name,
      });
      compileTopology();
      renderFeatures();
      refreshViews();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-compile")?.addEventListener("click", () => {
    compileTopology();
    renderFeatures();
    refreshViews();
  });

  document.getElementById("mvp-add-binding")?.addEventListener("click", () => {
    const topo = state.topo ?? compileTopology();
    const stationRef = selectedValue("mvp-station-ref") || topo.stations[0]?.id;
    const platformRef = selectedValue("mvp-platform-ref") || topo.platforms[0]?.id;
    const edgeRef = selectedValue("mvp-edge-ref") || topo.edges[0]?.id;
    const side = (selectedValue("mvp-binding-side") || "unknown") as PlatformTrackBinding["side"];
    if (stationRef && platformRef && edgeRef) {
      addPlatformTrackBinding({ stationRef, platformRef, edgeRef, side });
      compileTopology();
    }
    refreshViews();
  });

  document.getElementById("mvp-add-stop")?.addEventListener("click", () => {
    const topo = state.topo ?? compileTopology();
    const stationRef = selectedValue("mvp-station-ref") || topo.stations[0]?.id;
    const platformRef = selectedValue("mvp-platform-ref") || topo.platforms[0]?.id;
    const edgeRef = selectedValue("mvp-edge-ref") || topo.edges[0]?.id;
    const direction = (selectedValue("mvp-stop-direction") || "both") as StoppingPoint["direction"];
    const measure = Number((document.getElementById("mvp-stop-measure") as HTMLInputElement | null)?.value ?? "0.5");
    if (stationRef && platformRef && edgeRef) {
      confirmStoppingPoint({ stationRef, platformRef, edgeRef, direction, measure });
      compileTopology();
    }
    refreshViews();
  });

  document.getElementById("mvp-export-geojson")?.addEventListener("click", () => writeExportToInput(exportAnnotatedGeoJson()));
  document.getElementById("mvp-export-topo")?.addEventListener("click", () => writeExportToInput(exportTopology()));

  document.getElementById("mvp-export-snapshot")?.addEventListener("click", () => {
    try {
      const snapshot = exportSensekiSnapshot();
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `senseki-demo-${ts}.railround.json`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`[snapshot] exported ${filename}`, {
        counts: snapshot.topologySummary.counts,
        diagnostics: snapshot.topologySummary.diagnosticCounts,
        overrides: Object.keys(snapshot.overrides).length,
        bindings: snapshot.bindings.length,
        stoppingPoints: snapshot.stoppingPoints.length,
      });
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-import-snapshot")?.addEventListener("click", () => {
    const fileInput = document.getElementById("mvp-import-snapshot-file") as HTMLInputElement | null;
    if (!fileInput) return;
    fileInput.value = "";
    fileInput.click();
  });

  document.getElementById("mvp-import-snapshot-file")?.addEventListener("change", async (e) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== "senseki-demo-v1") {
        throw new Error("Not a valid senseki-demo-v1 snapshot.");
      }
      const snapshot = parsed as SensekiDemoSnapshot;
      const confirmMessage = [
        `Import demo snapshot exported at ${snapshot.exportedAt}?`,
        `This will REPLACE current localStorage annotation overrides, in-memory bindings and stopping points.`,
        `Tip: Export current state first if you want to keep it.`,
      ].join("\n\n");
      if (!window.confirm(confirmMessage)) return;
      const result = importSensekiSnapshot(snapshot);
      console.log(`[snapshot] imported`, result);
      if (!result.hashMatch) {
        console.warn(
          `[snapshot] senseki-data.ts hash mismatch — exported ${result.exportedHash} vs current ${result.currentHash}. ` +
          `Annotation overrides may not fully bind; check Diagnostics tab.`,
        );
        window.alert(
          `Snapshot imported, but senseki-data.ts hash differs (exported: ${result.exportedHash}, current: ${result.currentHash}).\n` +
          `Restored ${result.bindingsRestored} bindings, ${result.stoppingPointsRestored} stopping points, ` +
          `${result.overridesApplied}/${result.overridesTotal} annotation overrides matched.\n` +
          `Check Diagnostics tab for missing-binding warnings.`,
        );
      } else {
        window.alert(
          `Snapshot imported.\n` +
          `Restored ${result.bindingsRestored} bindings, ${result.stoppingPointsRestored} stopping points, ` +
          `${result.overridesApplied}/${result.overridesTotal} annotation overrides matched.`,
        );
      }
      mapView?.fitToData();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-base-layer")?.addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    mapView?.setBaseLayer(select.value as "positron" | "plain");
  });
  document.getElementById("mvp-fit-data")?.addEventListener("click", () => {
    mapView?.fitToData();
  });

  document.getElementById("mvp-pathfinding")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    const geoJson = buildTwoStationGeoJson();
    if (input) {
      input.value = JSON.stringify(geoJson, null, 2);
    }
    loadGeoJson(geoJson);
    compileTopology();
    for (const b of TWO_STATION_BINDING_PLAN) addPlatformTrackBinding(b);
    for (const s of TWO_STATION_STOP_PLAN) confirmStoppingPoint(s);
    compileTopology();

    const topo = state.topo!;
    lastPathfindingResults = runScenarios(topo);
    void summarizeScenarios;  // kept for window-side debugging
    renderFeatures();
    refreshViews();
    mapView?.fitToData();
  });
}

function renderFeatures(): void {
  const container = document.getElementById("mvp-features");
  if (!container) {
    return;
  }
  if (!state.source) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = state.source.features.map((feature, index) => {
    const annotation = feature.properties.railGraph;
    const kind = annotation?.kind ?? "unknown";
    const isTrack = kind === "track_geometry";
    const isPlatform = kind === "platform_area";
    return `
      <div class="feature" data-feature-index="${index}">
        <strong>#${index + 1} ${feature.geometry.type}</strong>
        <div class="grid">
          <label class="field">Kind
            <select data-field="kind">
              ${kindOption("unknown", annotation?.kind)}
              ${kindOption("track_geometry", annotation?.kind)}
              ${kindOption("station_point", annotation?.kind)}
              ${kindOption("platform_area", annotation?.kind)}
              ${kindOption("switch_point", annotation?.kind)}
              ${kindOption("special_section", annotation?.kind)}
            </select>
          </label>
          <label class="field">Name
            <input data-field="name" value="${escapeAttr(annotation?.station?.name || annotation?.platform?.name || annotation?.track?.name || feature.properties.name as string || "")}" />
          </label>
          ${isTrack ? `
          <label class="field">Track role
            <select data-field="role">
              ${["main", "platform", "passing", "connector", "storage", "yard"].map((role) => `<option value="${role}" ${annotation?.track?.role === role ? "selected" : ""}>${role}</option>`).join("")}
            </select>
          </label>
          <label class="field">Traversal
            <select data-field="traversal">
              <option value="both" ${annotation?.track?.traversal !== "forward" ? "selected" : ""}>both</option>
              <option value="forward" ${annotation?.track?.traversal === "forward" ? "selected" : ""}>forward</option>
            </select>
          </label>
          <label class="field">Physical kind
            <select data-field="physicalKind">
              <option value="" ${!annotation?.track?.physicalKind ? "selected" : ""}>(undeclared)</option>
              ${["main", "siding", "yard", "lead", "safety"].map((k) => `<option value="${k}" ${annotation?.track?.physicalKind === k ? "selected" : ""}>${k}</option>`).join("")}
            </select>
          </label>
          <label class="field">Direction role
            <select data-field="directionRole">
              <option value="" ${!annotation?.track?.directionRole ? "selected" : ""}>(undeclared)</option>
              ${["up_main", "down_main", "siding", "reversible"].map((k) => `<option value="${k}" ${annotation?.track?.directionRole === k ? "selected" : ""}>${k}</option>`).join("")}
            </select>
          </label>
          <label class="field" style="grid-column: span 2">Functional use (comma-sep: through,stopping,passing,turnback,storage)
            <input data-field="functionalUse" value="${escapeAttr((annotation?.track?.functionalUse ?? []).join(","))}" />
          </label>
          ` : ""}
          ${isPlatform ? `
          <label class="field">Platform type
            <select data-field="platformType">
              <option value="" ${!annotation?.platform?.type ? "selected" : ""}>(undeclared)</option>
              ${["side", "island", "bay", "unknown"].map((t) => `<option value="${t}" ${annotation?.platform?.type === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </label>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll<HTMLElement>(".feature").forEach((element) => {
    element.addEventListener("change", () => updateAnnotationFromElement(element));
    element.addEventListener("input", () => updateAnnotationFromElement(element));
  });
}

function updateAnnotationFromElement(element: HTMLElement): void {
  const featureIndex = Number(element.dataset.featureIndex);
  const kind = (element.querySelector<HTMLSelectElement>('[data-field="kind"]')?.value ?? "unknown") as RailGraphKind;
  const name = element.querySelector<HTMLInputElement>('[data-field="name"]')?.value ?? "";
  const role = element.querySelector<HTMLSelectElement>('[data-field="role"]')?.value as TopologyEdge["role"] | undefined;
  const traversal = element.querySelector<HTMLSelectElement>('[data-field="traversal"]')?.value as TopologyEdge["traversal"] | undefined;
  const physicalKindRaw = element.querySelector<HTMLSelectElement>('[data-field="physicalKind"]')?.value ?? "";
  const directionRoleRaw = element.querySelector<HTMLSelectElement>('[data-field="directionRole"]')?.value ?? "";
  const functionalUseRaw = element.querySelector<HTMLInputElement>('[data-field="functionalUse"]')?.value ?? "";
  const platformTypeRaw = element.querySelector<HTMLSelectElement>('[data-field="platformType"]')?.value ?? "";

  const functionalUse = functionalUseRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ("through" | "stopping" | "passing" | "turnback" | "storage")[];

  annotateFeature(featureIndex, {
    kind,
    track: kind === "track_geometry" ? {
      role: role ?? "main",
      traversal: traversal ?? "both",
      name,
      physicalKind: physicalKindRaw ? (physicalKindRaw as "main" | "siding" | "yard" | "lead" | "safety") : undefined,
      directionRole: directionRoleRaw ? (directionRoleRaw as "up_main" | "down_main" | "siding" | "reversible") : undefined,
      functionalUse: functionalUse.length > 0 ? functionalUse : undefined,
    } : undefined,
    station: kind === "station_point" ? { name: name || `Station ${featureIndex + 1}` } : undefined,
    platform: kind === "platform_area" ? {
      name: name || `Platform ${featureIndex + 1}`,
      type: platformTypeRaw ? (platformTypeRaw as "side" | "island" | "bay" | "unknown") : undefined,
    } : undefined,
  });
  refreshViews();
}

function kindOption(kind: RailGraphKind, selected?: RailGraphKind): string {
  return `<option value="${kind}" ${kind === selected ? "selected" : ""}>${kind}</option>`;
}

function topoOptions(kind: "stations" | "platforms" | "edges"): string {
  const topo = state.topo;
  if (!topo) {
    return `<option value="">Compile first</option>`;
  }

  const items = kind === "stations"
    ? topo.stations.map((item) => ({ id: item.id, label: item.name }))
    : kind === "platforms"
      ? topo.platforms.map((item) => ({ id: item.id, label: item.name || item.id }))
      : topo.edges.map((item) => ({ id: item.id, label: item.name || item.trackCode || item.id }));

  if (items.length === 0) {
    return `<option value="">None</option>`;
  }
  return items.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.label)}</option>`).join("");
}

function selectedValue(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement | null)?.value ?? "";
}

function writeExportToInput(value: unknown): void {
  const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
  if (input) {
    input.value = JSON.stringify(value, null, 2);
    input.scrollIntoView({ block: "nearest" });
  }
}

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[MVP]", error);
  // 软提示, 不打断
  alert(message);
}

function summary(): unknown {
  return {
    loadedFeatures: state.source?.features.length ?? 0,
    bindings: state.bindings.length,
    stoppingPoints: state.stoppingPoints.length,
    compiled: state.topo ? {
      nodes: state.topo.nodes.length,
      edges: state.topo.edges.length,
      stations: state.topo.stations.length,
      platforms: state.topo.platforms.length,
      platformTrackBindings: state.topo.platformTrackBindings.length,
      confirmedStoppingPoints: state.topo.stoppingPoints.length,
    } : null,
    diagnostics: state.diagnostics,
  };
}

void summary;  // 保留供 window-side debug 调用

function sampleGeoJson(): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [139.7000, 35.6900] },
        properties: { name: "Sample Station" },
      },
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[139.6998, 35.6899], [139.7002, 35.6899], [139.7002, 35.6901], [139.6998, 35.6901], [139.6998, 35.6899]]] },
        properties: { name: "Platform 1" },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[139.6990, 35.6900], [139.7000, 35.6900], [139.7010, 35.6900]] },
        properties: { name: "Track 1" },
      },
    ],
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    railGraphMvp: {
      state,
      loadGeoJson,
      annotateFeature,
      addPlatformTrackBinding,
      confirmStoppingPoint,
      compileTopology,
      exportAnnotatedGeoJson,
      exportTopology,
      exportDiagnostics,
    },
  });

  render();
}
