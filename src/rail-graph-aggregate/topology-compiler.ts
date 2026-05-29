import type {
  AnnotatedFeature,
  AnnotatedFeatureCollection,
  RailGraphAnnotation,
} from "../rail-graph-v1/annotation.types";
import type {
  BaseTopologyLayer,
  TopologyEdge,
  TopologyNode,
} from "../rail-graph-v1/base-topology.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import type { PlatformTrackBindingInput, StoppingPointInput } from "../rail-graph-v1/editing.types";
import type { GeoJSONGeometry, GeoJSONPosition } from "../rail-graph-v1/geojson";
import type { EntityRef } from "../rail-graph-v1/primitives";
import { projectPointToPolyline, haversineDistance } from "../rail-graph-v1/geometry-math";
import { aggregateDoubleTrackPairs, buildAdjacency } from "../rail-graph-v1/topology";

export interface CompileAggregateTopologyArgs {
  source: AnnotatedFeatureCollection;
  removedFids?: ReadonlySet<string>;
  bindings?: PlatformTrackBindingInput[];
  stoppingPoints?: StoppingPointInput[];
}

export interface CompileAggregateTopologyResult {
  topo: BaseTopologyLayer;
  diagnostics: Diagnostic[];
}

const ENDPOINT_PRECISION = 6;
const SNAP_TOLERANCE_METERS = 0.5;
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

export function compileAggregateTopology(args: CompileAggregateTopologyArgs): CompileAggregateTopologyResult {
  const diagnostics: Diagnostic[] = [];
  const topo = cloneTopo(EMPTY_TOPO);
  const geometryRefs = new Set<string>();
  const bindings = args.bindings ?? [];
  const stoppingPoints = args.stoppingPoints ?? [];

  const annotatedFeatures = args.source.features
    .filter((feature) => !args.removedFids?.has(fidOfFeature(feature)))
    .map((feature, index) => ({
      feature,
      index,
      annotation: feature.properties.railGraph,
    }));

  const deferredTotals: Record<string, number> = {};
  for (const { annotation, index } of annotatedFeatures) {
    if (!annotation) {
      diagnostics.push(diagnostic("warn", "AGG_UNKNOWN_FEATURE", "compile", "Feature is not annotated.", { index }));
      continue;
    }
    if (annotation.kind !== "unknown") continue;
    const source = annotation.source ?? "";
    if (source.startsWith("osm-deferred-")) {
      const classMain = source.slice("osm-deferred-".length);
      deferredTotals[classMain] = (deferredTotals[classMain] ?? 0) + 1;
    } else {
      diagnostics.push(diagnostic("warn", "AGG_UNKNOWN_FEATURE", "compile", "Feature is not annotated.", { index }));
    }
  }

  const deferredTotal = Object.values(deferredTotals).reduce((sum, count) => sum + count, 0);
  if (deferredTotal > 0) {
    diagnostics.push(diagnostic(
      "info",
      "AGG_OSM_KIND_NOT_CONSUMED",
      "compile",
      `${deferredTotal} OSM features fall in classes aggregate topology does not consume.`,
      { totalsByClass: deferredTotals },
    ));
  }

  for (const { feature, annotation, index } of annotatedFeatures) {
    if (annotation?.kind === "station_point") addStationFeature(topo, diagnostics, feature, annotation, index);
  }
  for (const { feature, annotation, index } of annotatedFeatures) {
    if (annotation?.kind === "platform_area") addPlatformFeature(topo, diagnostics, feature, annotation, index);
  }
  for (const { feature, annotation, index } of annotatedFeatures) {
    if (
      !annotation
      || annotation.kind === "unknown"
      || annotation.kind === "station_point"
      || annotation.kind === "platform_area"
      || annotation.kind === "signal_point"
    ) {
      continue;
    }
    if (annotation.kind === "track_geometry") {
      addTrackFeature(topo, diagnostics, feature, annotation, index, geometryRefs);
      continue;
    }
    diagnostics.push(diagnostic("info", "AGG_KIND_DEFERRED", "compile", "Kind is annotated but not compiled in aggregate topology.", {
      index,
      kind: annotation.kind,
    }));
  }
  for (const { annotation } of annotatedFeatures) {
    if (annotation?.kind === "signal_point") addSignalFeature(topo, annotation);
  }

  for (const edge of topo.edges) {
    if (edge.traversal === "both" && !edge.directionRole) {
      edge.directionRole = "bidirectional";
      diagnostics.push(diagnostic(
        "info",
        "AGG_TRACK_DIRECTION_ROLE_INFERRED_BIDIRECTIONAL",
        "compile",
        "Edge has traversal=both but no directionRole; auto-assigned 'bidirectional'.",
        { edgeId: edge.id },
      ));
    }
  }

  // Snapping and splitting is now done at Data stage loading time.
  // applyCrossoverSnapping(topo, diagnostics);
  topo.adjacency = buildAdjacency(topo.edges);
  addBindings(topo, diagnostics, bindings);
  addStoppingPoints(topo, diagnostics, stoppingPoints);
  topo.doubleTrackPairs = aggregateDoubleTrackPairs(
    topo.edges,
    stableId("aggregate", "doubleTrackPair", "auto"),
  );

  if (topo.edges.length === 0) {
    diagnostics.push(diagnostic("error", "AGG_NO_TRACKS", "compile", "No track_geometry features were compiled."));
  }

  return { topo, diagnostics };
}

export function fidOfFeature(feature: AnnotatedFeature): string {
  const props = feature.properties || {};
  return `${stringValue(props.osm_type)}:${stringValue(props.osm_id)}:${stringValue(props.class_main)}:${stringValue(props.source_line_name)}`;
}

function addTrackFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: AnnotatedFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
  geometryRefs: Set<string>,
): void {
  const lines = lineStringsFromGeometry(feature.geometry);
  if (lines.length === 0) {
    diagnostics.push(diagnostic("error", "AGG_INVALID_TRACK_GEOMETRY", "compile", "track_geometry requires LineString or MultiLineString.", {
      featureIndex,
      geometryType: feature.geometry.type,
    }));
    return;
  }

  for (const [lineIndex, coordinates] of lines.entries()) {
    if (coordinates.length < 2) {
      diagnostics.push(diagnostic("error", "AGG_SHORT_TRACK_GEOMETRY", "compile", "Track geometry needs at least two coordinates.", {
        featureIndex,
        lineIndex,
      }));
      continue;
    }

    if (!annotation.track?.functionalUse || annotation.track.functionalUse.length === 0) {
      diagnostics.push(diagnostic(
        "warn",
        "AGG_TRACK_FUNCTIONAL_USE_UNDECLARED",
        "compile",
        "Track has no explicit functionalUse.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }
    if (!annotation.track?.physicalKind) {
      diagnostics.push(diagnostic(
        "warn",
        "AGG_TRACK_PHYSICAL_KIND_UNDECLARED",
        "compile",
        "Track has no explicit physicalKind.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }
    if (
      Array.isArray(annotation.track?.functionalUse)
      && annotation.track.functionalUse.includes("turnback")
      && annotation.track.directionRole !== "reversible"
    ) {
      diagnostics.push(diagnostic(
        "warn",
        "AGG_REVERSIBLE_WITHOUT_TURNBACK_ROLE",
        "compile",
        "Track has functionalUse=turnback but directionRole is not 'reversible'.",
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
      name: annotation.track?.name || stringValue(feature.properties.name) || undefined,
      trackCode: annotation.track?.trackCode,
      geometryRef,
      lengthMeters: calculateLengthMeters(coordinates),
      coordinates,
      physicalKind: annotation.track?.physicalKind,
      functionalUse: annotation.track?.functionalUse,
      directionRole: annotation.track?.directionRole,
      sourceSlice: {
        sourceFeatureRef: (annotation as any).preSplitOriginalId || annotation.id,
        multiLineIndex: feature.geometry.type === "MultiLineString" ? lineIndex : undefined,
        startMeasure: (annotation as any).preSplitStartMeasure ?? 0,
        endMeasure: (annotation as any).preSplitEndMeasure ?? 1,
      },
      sourceTags: extractSourceTags(feature.properties),
    });
  }
}

function addStationFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: AnnotatedFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
): void {
  if (feature.geometry.type !== "Point") {
    diagnostics.push(diagnostic("error", "AGG_INVALID_STATION_GEOMETRY", "compile", "station_point requires Point geometry.", {
      featureIndex,
      geometryType: feature.geometry.type,
    }));
    return;
  }
  const id = annotation.id as EntityRef;
  topo.stations.push({
    id,
    name: annotation.station?.name || stringValue(feature.properties.name) || `Station ${featureIndex + 1}`,
    platformRefs: [],
    positionRef: stableId("manual", "position", annotation.id),
  });
}

function addPlatformFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: AnnotatedFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
): void {
  const geomType = feature.geometry.type;
  const accepted = geomType === "Polygon"
    || geomType === "MultiPolygon"
    || geomType === "Point"
    || geomType === "LineString"
    || geomType === "MultiLineString";
  if (!accepted) {
    diagnostics.push(diagnostic("error", "AGG_INVALID_PLATFORM_GEOMETRY", "compile", "platform_area requires a supported geometry.", {
      featureIndex,
      geometryType: geomType,
    }));
    return;
  }

  const id = annotation.id as EntityRef;
  let stationRef: EntityRef | undefined = annotation.platform?.stationRef as EntityRef | undefined;
  let stationRefSource: "explicit" | "nearest-station-tag" | "first-fallback" | undefined = stationRef ? "explicit" : undefined;
  if (!stationRef) {
    const nearestName = stringValue(feature.properties?.sourceTags && typeof feature.properties.sourceTags === "object"
      ? (feature.properties.sourceTags as Record<string, unknown>).nearest_station
      : feature.properties?.nearest_station).trim();
    if (nearestName) {
      const found = topo.stations.find((station) => station.name === nearestName);
      if (found) {
        stationRef = found.id;
        stationRefSource = "nearest-station-tag";
      }
    }
    if (!stationRef && topo.stations[0]) {
      stationRef = topo.stations[0].id;
      stationRefSource = "first-fallback";
    }
  }

  if (!stationRef) {
    diagnostics.push(diagnostic("warn", "AGG_PLATFORM_WITHOUT_STATION", "compile", "Platform has no stationRef and no fallback station.", { featureIndex }));
  } else if (stationRefSource && stationRefSource !== "explicit") {
    diagnostics.push(diagnostic("info", "AGG_PLATFORM_STATION_FALLBACK", "compile", `Platform stationRef resolved via fallback: ${stationRefSource}.`, {
      featureIndex,
      source: stationRefSource,
      stationRef,
    }));
  }

  if (!annotation.platform?.type) {
    diagnostics.push(diagnostic("warn", "AGG_PLATFORM_TYPE_UNDECLARED", "compile", "Platform has no explicit type.", { featureIndex }));
  }

  topo.platforms.push({
    id,
    stationRef: (stationRef ?? stableId("manual", "station", "missing")) as EntityRef,
    type: annotation.platform?.type ?? "unknown",
    name: annotation.platform?.name || stringValue(feature.properties.name) || undefined,
    number: annotation.platform?.number,
    areaRef: stableId("manual", "area", annotation.id),
  });

  const station = topo.stations.find((item) => item.id === stationRef);
  if (station && !station.platformRefs.includes(id)) station.platformRefs.push(id);
}

function addSignalFeature(topo: BaseTopologyLayer, annotation: RailGraphAnnotation): void {
  if (!annotation.signal) return;
  const resolved = resolveEdgeAndMeasure(topo, annotation.signal.edgeRef, annotation.signal.measure);
  if (!resolved) return;
  topo.signals.push({
    id: annotation.id as EntityRef,
    edgeRef: resolved.edgeId as EntityRef,
    measure: resolved.measure,
    facing: annotation.signal.facing,
    name: annotation.signal.name,
  });
}

function addBindings(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  bindings: PlatformTrackBindingInput[],
): void {
  for (const [index, input] of bindings.entries()) {
    if (!topo.stations.some((station) => station.id === input.stationRef)) {
      diagnostics.push(diagnostic("error", "AGG_BINDING_MISSING_STATION", "compile", "Binding references a missing station.", { index, stationRef: input.stationRef }));
      continue;
    }
    if (!topo.platforms.some((platform) => platform.id === input.platformRef)) {
      diagnostics.push(diagnostic("error", "AGG_BINDING_MISSING_PLATFORM", "compile", "Binding references a missing platform.", { index, platformRef: input.platformRef }));
      continue;
    }

    const activeEdges = resolveAllSplitEdges(topo, input.edgeRef);
    if (activeEdges.length === 0) {
      diagnostics.push(diagnostic("error", "AGG_BINDING_MISSING_EDGE", "compile", "Binding references a missing edge.", { index, edgeRef: input.edgeRef }));
      continue;
    }

    for (const edgeId of activeEdges) {
      const id = stableId("manual", "binding", `${input.stationRef}:${input.platformRef}:${edgeId}:${index}`);
      topo.platformTrackBindings.push({
        id,
        stationRef: input.stationRef as EntityRef,
        platformRef: input.platformRef as EntityRef,
        edgeRef: edgeId as EntityRef,
        side: input.side,
        servingDirection: input.servingDirection,
      });
      topo.relations.push({
        id: stableId("manual", "relation", id),
        kind: "platform_serves_track",
        fromRef: input.platformRef as EntityRef,
        toRef: edgeId as EntityRef,
        payload: { stationRef: input.stationRef, side: input.side },
      });
    }
  }
}

function addStoppingPoints(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  stoppingPoints: StoppingPointInput[],
): void {
  for (const [index, input] of stoppingPoints.entries()) {
    if (!topo.stations.some((station) => station.id === input.stationRef)) {
      diagnostics.push(diagnostic("error", "AGG_STOP_MISSING_STATION", "compile", "Stopping point references a missing station.", { index, stationRef: input.stationRef }));
      continue;
    }
    if (!topo.platforms.some((platform) => platform.id === input.platformRef)) {
      diagnostics.push(diagnostic("error", "AGG_STOP_MISSING_PLATFORM", "compile", "Stopping point references a missing platform.", { index, platformRef: input.platformRef }));
      continue;
    }
    const resolved = resolveEdgeAndMeasure(topo, input.edgeRef, input.measure);
    if (!resolved) {
      diagnostics.push(diagnostic("error", "AGG_STOP_MISSING_EDGE", "compile", "Stopping point references a missing edge.", { index, edgeRef: input.edgeRef }));
      continue;
    }

    const matchingBinding = topo.platformTrackBindings.find((binding) => {
      if (binding.platformRef !== input.platformRef) return false;
      if (binding.edgeRef !== resolved.edgeId) return false;
      if (input.direction === "both") return true;
      if (!binding.servingDirection) return true;
      return binding.servingDirection === input.direction;
    });
    if (!matchingBinding) {
      diagnostics.push(diagnostic("warn", "AGG_STOP_NO_MATCHING_BINDING", "compile", "Stopping point has no matching PlatformTrackBinding.", {
        index,
        platformRef: input.platformRef,
        edgeRef: resolved.edgeId,
        direction: input.direction,
      }));
    }

    topo.stoppingPoints.push({
      id: stableId("manual", "stoppingPoint", `${input.stationRef}:${input.platformRef}:${resolved.edgeId}:${input.direction}:${resolved.measure}`),
      stationRef: input.stationRef as EntityRef,
      platformRef: input.platformRef as EntityRef,
      edgeRef: resolved.edgeId as EntityRef,
      direction: input.direction,
      measure: clampMeasure(resolved.measure),
      confirmation: "confirmed",
    });
  }
}

function applyCrossoverSnapping(topo: BaseTopologyLayer, diagnostics: Diagnostic[]): void {
  let snappedAny = true;
  let iterations = 0;
  const maxIterations = 100;

  while (snappedAny && iterations < maxIterations) {
    snappedAny = false;
    iterations += 1;

    const nodeDegrees: Record<string, number> = {};
    for (const edge of topo.edges) {
      nodeDegrees[edge.fromNodeRef] = (nodeDegrees[edge.fromNodeRef] ?? 0) + 1;
      nodeDegrees[edge.toNodeRef] = (nodeDegrees[edge.toNodeRef] ?? 0) + 1;
    }

    for (const node of topo.nodes) {
      if (nodeDegrees[node.id] !== 1) continue;
      const edge = topo.edges.find((item) => item.fromNodeRef === node.id || item.toNodeRef === node.id);
      if (!edge?.coordinates) continue;
      const isStart = edge.fromNodeRef === node.id;
      const nodeCoord = isStart ? edge.coordinates[0] : edge.coordinates[edge.coordinates.length - 1];

      for (const targetEdge of topo.edges) {
        if (targetEdge.id === edge.id || !targetEdge.coordinates) continue;
        const proj = projectPointToPolyline(nodeCoord, targetEdge.coordinates);
        if (proj.distance >= SNAP_TOLERANCE_METERS) continue;

        const distToStart = haversineDistance(proj.snapped, targetEdge.coordinates[0]);
        const distToEnd = haversineDistance(proj.snapped, targetEdge.coordinates[targetEdge.coordinates.length - 1]);
        if (distToStart < 0.1) {
          mergeNodes(topo, node.id, targetEdge.fromNodeRef, proj.snapped);
          diagnostics.push(diagnostic("info", "AGG_CROSSOVER_MERGE_NODE", "compile", "Crossover node merged into target start node.", {
            crossoverNode: node.id,
            targetNode: targetEdge.fromNodeRef,
            distance: proj.distance,
          }));
        } else if (distToEnd < 0.1) {
          mergeNodes(topo, node.id, targetEdge.toNodeRef, proj.snapped);
          diagnostics.push(diagnostic("info", "AGG_CROSSOVER_MERGE_NODE", "compile", "Crossover node merged into target end node.", {
            crossoverNode: node.id,
            targetNode: targetEdge.toNodeRef,
            distance: proj.distance,
          }));
        } else {
          splitEdgeAtPoint(topo, targetEdge, proj.measure, proj.snapped, node.id);
          diagnostics.push(diagnostic("info", "AGG_CROSSOVER_SPLIT_EDGE", "compile", "Edge split by crossover node.", {
            splitEdge: targetEdge.id,
            crossoverNode: node.id,
            measure: proj.measure,
            distance: proj.distance,
          }));
        }
        snappedAny = true;
        break;
      }
      if (snappedAny) break;
    }
  }
}

function mergeNodes(
  topo: BaseTopologyLayer,
  oldNodeId: EntityRef,
  newNodeId: EntityRef,
  snappedCoord: [number, number],
): void {
  for (const edge of topo.edges) {
    if (edge.fromNodeRef === oldNodeId) {
      edge.fromNodeRef = newNodeId;
      if (edge.coordinates) edge.coordinates[0] = snappedCoord;
    }
    if (edge.toNodeRef === oldNodeId) {
      edge.toNodeRef = newNodeId;
      if (edge.coordinates) edge.coordinates[edge.coordinates.length - 1] = snappedCoord;
    }
  }
  topo.nodes = topo.nodes.filter((node) => node.id !== oldNodeId);
}

function splitEdgeAtPoint(
  topo: BaseTopologyLayer,
  targetEdge: TopologyEdge,
  measure: number,
  snappedCoord: [number, number],
  crossoverNodeId: EntityRef,
): void {
  const coords = targetEdge.coordinates;
  const sourceSlice = targetEdge.sourceSlice;
  if (!coords || !sourceSlice) return;
  const proj = projectPointToPolyline(snappedCoord, coords);
  const segmentIndex = proj.segmentIndex;
  const coordsA = coords.slice(0, segmentIndex + 1);
  coordsA.push(snappedCoord);
  const coordsB = [snappedCoord, ...coords.slice(segmentIndex + 1)];

  const crossoverNode = topo.nodes.find((node) => node.id === crossoverNodeId);
  if (crossoverNode) crossoverNode.kind = "junction";

  const originalStart = sourceSlice.startMeasure ?? 0;
  const originalEnd = sourceSlice.endMeasure ?? 1;
  const splitMeasure = originalStart + measure * (originalEnd - originalStart);
  const edgeA: TopologyEdge = {
    ...targetEdge,
    id: `${targetEdge.id}:part_A` as EntityRef,
    toNodeRef: crossoverNodeId,
    coordinates: coordsA,
    lengthMeters: calculateLengthMeters(coordsA),
    sourceSlice: {
      ...sourceSlice,
      startMeasure: originalStart,
      endMeasure: splitMeasure,
    },
  };
  const edgeB: TopologyEdge = {
    ...targetEdge,
    id: `${targetEdge.id}:part_B` as EntityRef,
    fromNodeRef: crossoverNodeId,
    coordinates: coordsB,
    lengthMeters: calculateLengthMeters(coordsB),
    sourceSlice: {
      ...sourceSlice,
      startMeasure: splitMeasure,
      endMeasure: originalEnd,
    },
  };
  topo.edges = topo.edges.filter((edge) => edge.id !== targetEdge.id);
  topo.edges.push(edgeA, edgeB);
}

function resolveAllSplitEdges(topo: BaseTopologyLayer, originalEdgeId: string): string[] {
  return topo.edges
    .filter((edge) => edge.id === originalEdgeId || edge.id.startsWith(`${originalEdgeId}:`))
    .map((edge) => edge.id);
}

function resolveEdgeAndMeasure(
  topo: BaseTopologyLayer,
  originalEdgeId: string,
  originalMeasure: number,
): { edgeId: string; measure: number } | null {
  const candidates = topo.edges.filter((edge) => edge.id === originalEdgeId || edge.id.startsWith(`${originalEdgeId}:`));
  if (candidates.length === 0) return null;
  for (const edge of candidates) {
    const slice = edge.sourceSlice;
    if (!slice) continue;
    const start = slice.startMeasure ?? 0;
    const end = slice.endMeasure ?? 1;
    if (originalMeasure >= start && originalMeasure <= end) {
      const denom = end - start;
      return {
        edgeId: edge.id,
        measure: denom > 0 ? (originalMeasure - start) / denom : 0,
      };
    }
  }
  return { edgeId: candidates[0].id, measure: originalMeasure };
}

function ensureNode(
  topo: BaseTopologyLayer,
  nodeRef: EntityRef,
  kind: TopologyNode["kind"],
  coordinate: GeoJSONPosition,
): void {
  if (topo.nodes.some((node) => node.id === nodeRef)) return;
  topo.nodes.push({
    id: nodeRef,
    kind,
    geometryRef: stableId("manual", "position", coordinateKey(coordinate)),
  });
}

function lineStringsFromGeometry(geometry: GeoJSONGeometry): GeoJSONPosition[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
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
  return `${source}:${entityType}:${slug(String(value))}` as EntityRef;
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
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function calculateLengthMeters(coordinates: GeoJSONPosition[]): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += haversineDistance(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

function extractSourceTags(properties: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const sourceTags = properties.sourceTags;
  if (sourceTags && typeof sourceTags === "object") {
    for (const [key, value] of Object.entries(sourceTags as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      out[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  for (const [key, value] of Object.entries(properties)) {
    if (key === "railGraph" || key === "sourceTags") continue;
    if (value === undefined || value === null || value === "") continue;
    if (out[key] !== undefined) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cloneTopo(topo: BaseTopologyLayer): BaseTopologyLayer {
  return JSON.parse(JSON.stringify(topo)) as BaseTopologyLayer;
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}
