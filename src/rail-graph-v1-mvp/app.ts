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
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import type {
  PlatformTrackBindingInput,
  StoppingPointInput,
} from "../rail-graph-v1/editing.types";
import type {
  GeoJSONGeometry,
  GeoJSONPosition,
} from "../rail-graph-v1/geojson";
import type { EntityRef } from "../rail-graph-v1/primitives";
import { aggregateDoubleTrackPairs, buildAdjacency } from "../rail-graph-v1/topology";
import { buildLiangMianSiXianGeoJson, BINDING_PLAN, STOP_PLAN } from "./poc-liangmiansixian";

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

  const id = stableId("manual", "station", annotation.id);
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

  const id = stableId("manual", "platform", annotation.id);
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

function render(): void {
  const root = document.getElementById("rail-graph-mvp");
  if (!root) {
    return;
  }

  root.innerHTML = `
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #1f2937; }
      .shell { display: grid; grid-template-columns: minmax(360px, 42%) 1fr; gap: 16px; height: 100vh; padding: 16px; box-sizing: border-box; }
      .panel { background: #fff; border: 1px solid #d7dce2; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
      .panel h1, .panel h2 { margin: 0; padding: 12px 14px; border-bottom: 1px solid #e5e7eb; font-size: 15px; }
      .body { padding: 12px 14px; overflow: auto; }
      textarea { width: 100%; min-height: 180px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; }
      button, select, input { font: inherit; }
      button { border: 1px solid #b8c2cc; background: #fff; border-radius: 6px; padding: 6px 9px; cursor: pointer; }
      button.primary { background: #155e75; color: #fff; border-color: #155e75; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
      .feature { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
      .feature strong { display: block; margin-bottom: 6px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .field { display: grid; gap: 3px; font-size: 12px; }
      .field input, .field select { border: 1px solid #cbd5e1; border-radius: 5px; padding: 5px; min-width: 0; }
      pre { background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; overflow: auto; font-size: 12px; }
      .diag-warn { color: #a16207; }
      .diag-error, .diag-fatal { color: #b91c1c; }
      .diag-info { color: #0369a1; }
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
            <button id="mvp-liangmiansixian" class="primary">两面四線 Demo</button>
            <button id="mvp-compile">Compile Topo</button>
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
              <label class="field">Name
                <input id="mvp-create-name" placeholder="optional" />
              </label>
            </div>
            <label class="field">Coordinates JSON
              <textarea id="mvp-create-coordinates" style="min-height:70px" placeholder="[139.7,35.69]"></textarea>
            </label>
            <div class="row">
              <button id="mvp-create-object">Create Into Queue</button>
            </div>
          </div>
          <div id="mvp-features"></div>
        </div>
      </section>
      <section class="panel">
        <h2>Topology</h2>
        <div class="body">
          <div class="row">
            <button id="mvp-add-binding">Add Binding</button>
            <button id="mvp-add-stop">Confirm Stop</button>
            <button id="mvp-export-geojson">Export Annotated GeoJSON</button>
            <button id="mvp-export-topo">Export Topo</button>
          </div>
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
            <label class="field">Side
              <select id="mvp-binding-side">
                <option value="unknown">unknown</option>
                <option value="left">left</option>
                <option value="right">right</option>
                <option value="both">both</option>
              </select>
            </label>
          </div>
          <pre id="mvp-output">${escapeHtml(JSON.stringify(summary(), null, 2))}</pre>
        </div>
      </section>
    </main>
  `;

  bindUi();
  renderFeatures();
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
    // Step 1: 导入并编译
    const geoJson = buildLiangMianSiXianGeoJson();
    loadGeoJson(geoJson);
    compileTopology();

    // Step 2: 自动创建所有站台-股道绑定
    for (const b of BINDING_PLAN) {
      addPlatformTrackBinding(b);
    }

    // Step 3: 自动确认所有停车标
    for (const s of STOP_PLAN) {
      confirmStoppingPoint(s);
    }

    // Step 4: 最终编译
    compileTopology();
    render();
    renderOutput(summary());

    // 额外展示设计观察
    const output = document.getElementById("mvp-output");
    if (output) {
      const topo = state.topo!;
      const obs = collectDesignObservations(topo);
      const fullOutput = {
        summary: summary(),
        designObservations: obs,
        topologySnapshot: {
          nodes: topo.nodes.map(n => ({ id: n.id, kind: n.kind })),
          edges: topo.edges.map(e => ({
            id: e.id,
            role: e.role,
            traversal: e.traversal,
            trackCode: e.trackCode,
            physicalKind: e.physicalKind,
            functionalUse: e.functionalUse,
            directionRole: e.directionRole,
            lengthMeters: Math.round(e.lengthMeters),
          })),
          stations: topo.stations.map(s => ({ id: s.id, name: s.name, platformRefs: s.platformRefs })),
          platforms: topo.platforms.map(p => ({ id: p.id, name: p.name, number: p.number, type: p.type, stationRef: p.stationRef })),
          platformTrackBindings: topo.platformTrackBindings.map(b => ({ id: b.id, platformRef: b.platformRef, edgeRef: b.edgeRef, side: b.side, servingDirection: b.servingDirection })),
          stoppingPoints: topo.stoppingPoints.map(s => ({ id: s.id, platformRef: s.platformRef, edgeRef: s.edgeRef, direction: s.direction, measure: s.measure })),
          doubleTrackPairs: topo.doubleTrackPairs,
          adjacency: {
            outEdges: topo.adjacency.outEdges,
            inEdges: topo.adjacency.inEdges,
          },
        },
      };
      output.textContent = JSON.stringify(fullOutput, null, 2);
    }
  });

  document.getElementById("mvp-load")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (!input) {
      return;
    }
    try {
      loadGeoJson(input.value);
      renderFeatures();
      renderOutput(summary());
    } catch (error) {
      renderOutput({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  document.getElementById("mvp-import")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (!input) {
      return;
    }
    try {
      importGeoJson(input.value);
      renderFeatures();
      renderOutput(summary());
    } catch (error) {
      renderOutput({ error: error instanceof Error ? error.message : String(error) });
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
      renderFeatures();
      renderOutput(summary());
    } catch (error) {
      renderOutput({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  document.getElementById("mvp-compile")?.addEventListener("click", () => {
    compileTopology();
    render();
    renderOutput(summary());
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
      render();
    }
    renderOutput(summary());
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
      render();
    }
    renderOutput(summary());
  });

  document.getElementById("mvp-export-geojson")?.addEventListener("click", () => renderOutput(exportAnnotatedGeoJson()));
  document.getElementById("mvp-export-topo")?.addEventListener("click", () => renderOutput(exportTopology()));
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
  renderOutput(summary());
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

function renderOutput(value: unknown): void {
  const output = document.getElementById("mvp-output");
  if (output) {
    output.textContent = JSON.stringify(value, null, 2);
  }
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

function collectDesignObservations(topo: BaseTopologyLayer) {
  const obs: { severity: string; target: string; problem: string; suggestion: string }[] = [];

  // 1. Switch point 物理建模仍未实现 (deferred)
  const connectorEdges = topo.edges.filter((e) => e.role === "connector");
  const hasDeferredSwitches = state.diagnostics.some(
    (d) => d.code === "MVP_KIND_DEFERRED",
  );
  if (connectorEdges.length > 0 || hasDeferredSwitches) {
    obs.push({
      severity: "major",
      target: "switch_point compilation",
      problem: "switch_point 在 MVP 中不编译, 咽喉道岔仍用 role=connector 的 track_geometry 模拟, 丢失道岔的物理语义、岔位状态、限速等信息。",
      suggestion: "实现 switch_point → junction TopologyNode 的编译, connector edges 退化为该 junction 的进出枝。",
    });
  }

  // 2. Route / 径路概念缺失 (Layer 2/3 范围)
  if (topo.stoppingPoints.length > 0 && connectorEdges.length > 0) {
    obs.push({
      severity: "critical",
      target: "Route / path through station",
      problem: "当前可表达 'edge 上某点有停车标', 但无法表达完整径路 (例如: 1番 → 西咽 1-2 → 2番 → 停 PlatformA → 东咽 1-2 → 1番)。这是退避运用的核心语义。",
      suggestion: "在 Layer 2 (服务模板) 引入 Route { segments: { edgeRef, fromMeasure, toMeasure, traversal }[], stoppingPointRefs[] }。",
    });
  }

  // 3. 站界 (station boundary) 概念缺失
  if (topo.stoppingPoints.length > 0) {
    obs.push({
      severity: "info",
      target: "Station boundary",
      problem: "StoppingPoint.measure 没有验证是否在站界 (进站信号机 ~ 出站信号机) 范围内。",
      suggestion: "在 Station 上增加 trackScopedBoundaries: { edgeRef, startMeasure, endMeasure }[]。",
    });
  }

  return obs;
}

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
