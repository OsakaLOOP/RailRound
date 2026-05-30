// ============================================================
// Rail Graph v1 - Runtime render geometry resolver
// ============================================================

import type { TopologyEdge } from "./base-topology.types";
import type { Diagnostic } from "./diagnostic-types";
import type { GeoJSONLineString, GeoJSONPosition } from "./geojson";
import type { RailGraph } from "./graph.types";
import { haversineDistance } from "./geometry-math";
import { fingerprint } from "./fingerprint";
import type { DirectionLabel, EntityRef, MeasureRange } from "./primitives";
import type {
  OffsetGeometrySegment,
  OffsetSmoothingPlan,
  RenderGeometryPlan,
  ResolvedGeoJsonPath,
  ResolvedGeoJsonPathSegment,
  ResolvedPathSemanticRef,
  ResolvedStationPassage,
  RunPath,
} from "./runtime.types";
import type { ServicePattern, ServicePathSegment, ServiceTraceEntry } from "./service-template.types";

export interface ResolveServicePatternGeometryArgs {
  graph: RailGraph;
  patternRef: EntityRef;
  sourceGraphId?: string;
  pathId?: string;
  direction?: DirectionLabel;
}

export interface ResolveRunPathGeometryArgs {
  graph: RailGraph;
  path: RunPath;
  sourceGraphId?: string;
  pathId?: string;
  direction?: DirectionLabel;
}

export interface BuildRenderGeometryPlanArgs {
  graph: RailGraph;
  path: RunPath | ServicePattern;
  edgeOffsets?: Record<string, {
    offsetMeters: number;
    offsetSide?: "left" | "right";
  }>;
}

export function resolveServicePatternGeometry(args: ResolveServicePatternGeometryArgs): ResolvedGeoJsonPath {
  const pattern = args.graph.indexes.patternById[args.patternRef];
  if (!pattern) {
    return emptyResolvedPath({
      patternRef: args.patternRef,
      sourceGraphId: args.sourceGraphId,
      pathId: args.pathId,
      direction: args.direction ?? "unknown",
      diagnostics: [diagnostic("fatal", "RG_RENDER_PATTERN_MISSING", "ServicePattern does not exist in graph.", {
        patternRef: args.patternRef,
      })],
    });
  }
  return resolveRunPathGeometry({
    graph: args.graph,
    path: createRunPathFromServicePattern(pattern, args.direction),
    sourceGraphId: args.sourceGraphId,
    pathId: args.pathId,
    direction: args.direction,
  });
}

export function createRunPathFromServicePattern(
  pattern: ServicePattern,
  direction?: DirectionLabel,
): RunPath {
  return {
    patternRef: pattern.patternId,
    edgeSequence: [...pattern.edgeSequence],
    traceSequence: [...pattern.traceSequence],
    pathSegments: [...pattern.pathSegments],
    chosenDirection: direction ?? pattern.directionConvention.forwardDirection ?? "unknown",
    resolvedBy: "confirmed_template",
    loopDecision: pattern.cycleCheck
      ? {
        isLoopRun: pattern.cycleCheck.isCycle,
        directionSource: "template_default",
        fullCycleDistanceMeters: pattern.pathSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
        chosenDistanceMeters: pattern.pathSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
      }
      : undefined,
  };
}

export function resolveRunPathGeometry(args: ResolveRunPathGeometryArgs): ResolvedGeoJsonPath {
  const diagnostics: Diagnostic[] = [];
  const pathSegments = materializePathSegments(args.graph, args.path, diagnostics);
  const resolvedSegments = pathSegments.map((segment) => resolveSegment(args.graph, segment, diagnostics));
  const geometry: GeoJSONLineString = {
    type: "LineString",
    coordinates: stitchCoordinates(resolvedSegments.map((segment) => segment.geometry.coordinates)),
  };
  const totalDistanceMeters = resolvedSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0);
  const stationPassages = buildStationPassages(args.graph, args.path.traceSequence, pathSegments, resolvedSegments);
  const semanticRefs = buildSemanticRefs(args.path, resolvedSegments);
  const direction = normalizeDirection(args.direction ?? args.path.chosenDirection);
  const sourceGraphId = args.sourceGraphId ?? "graph:unbound";
  const pathId = args.pathId ?? createPathId(sourceGraphId, args.path, direction);

  return {
    pathId,
    sourceGraphId,
    patternRef: args.path.patternRef,
    direction,
    geometry,
    segments: resolvedSegments,
    stationPassages,
    semanticRefs,
    totalDistanceMeters,
    diagnostics,
  };
}

export function buildRenderGeometryPlan(args: BuildRenderGeometryPlanArgs): RenderGeometryPlan {
  const path = "patternId" in args.path
    ? createRunPathFromServicePattern(args.path)
    : args.path;
  const diagnostics: Diagnostic[] = [];
  const pathSegments = materializePathSegments(args.graph, path, diagnostics);
  const offsetSegments: OffsetGeometrySegment[] = pathSegments.map((segment) => {
    const offset = args.edgeOffsets?.[segment.edgeRef];
    return {
      edgeRef: segment.edgeRef,
      offsetMeters: offset?.offsetMeters ?? 0,
      offsetSide: offset?.offsetSide ?? "right",
      startMeasure: segment.measureRange.startMeasure,
      endMeasure: segment.measureRange.endMeasure,
    };
  });
  const hasOffset = offsetSegments.some((segment) => Math.abs(segment.offsetMeters) > 0);
  const hasMissingGeometry = pathSegments.some((segment) => !hasSegmentGeometry(args.graph, segment));
  return {
    geometrySource: hasOffset
      ? (hasMissingGeometry ? "dynamic_offset" : "mixed")
      : "physical_edges",
    stitchedEdgeRefs: [...path.edgeSequence],
    offsetSegments,
    smoothing: buildSmoothingPlan(offsetSegments),
    diagnostics,
  };
}

function materializePathSegments(
  graph: RailGraph,
  path: RunPath,
  diagnostics: Diagnostic[],
): ServicePathSegment[] {
  if (path.pathSegments.length > 0) return [...path.pathSegments].sort((a, b) => a.orderIndex - b.orderIndex);
  diagnostics.push(diagnostic("warn", "RG_RENDER_PATH_SEGMENTS_EMPTY", "RunPath has no pathSegments; falling back to edgeSequence.", {
    patternRef: path.patternRef,
  }));
  return path.edgeSequence.flatMap((edgeRef, orderIndex) => {
    const edge = graph.indexes.edgeById[edgeRef];
    if (!edge) return [];
    return [{
      orderIndex,
      edgeRef,
      fromNodeRef: edge.fromNodeRef,
      toNodeRef: edge.toNodeRef,
      measureRange: { startMeasure: 0, endMeasure: 1 },
      distanceMeters: edge.lengthMeters,
      geometryRef: edge.geometryRef,
    }];
  });
}

function resolveSegment(
  graph: RailGraph,
  segment: ServicePathSegment,
  diagnostics: Diagnostic[],
): ResolvedGeoJsonPathSegment {
  const edge = graph.indexes.edgeById[segment.edgeRef];
  if (!edge) {
    diagnostics.push(diagnostic("error", "RG_RENDER_EDGE_MISSING", "Path segment references a missing edge.", {
      edgeRef: segment.edgeRef,
      orderIndex: segment.orderIndex,
    }));
    return {
      orderIndex: segment.orderIndex,
      edgeRef: segment.edgeRef,
      geometry: { type: "LineString", coordinates: [] },
      geometryRef: segment.geometryRef,
      geometrySource: "missing",
      measureRange: segment.measureRange,
      distanceMeters: 0,
      specialSectionRefs: segment.specialSectionRefs,
    };
  }

  const source = findSegmentGeometry(graph, edge, segment);
  if (!source) {
    diagnostics.push(diagnostic("error", "RG_RENDER_GEOMETRY_MISSING", "Path segment has no edge geometry or coordinates.", {
      edgeRef: segment.edgeRef,
      orderIndex: segment.orderIndex,
      geometryRef: segment.geometryRef ?? edge.geometryRef,
    }));
    return {
      orderIndex: segment.orderIndex,
      edgeRef: segment.edgeRef,
      geometry: { type: "LineString", coordinates: [] },
      geometryRef: segment.geometryRef ?? edge.geometryRef,
      geometrySource: "missing",
      measureRange: segment.measureRange,
      distanceMeters: 0,
      specialSectionRefs: segment.specialSectionRefs,
    };
  }

  const sliced = sliceCoordinatesByMeasure(source.geometry.coordinates, segment.measureRange);
  const oriented = shouldReverseForTraversal(edge, segment)
    ? [...sliced].reverse()
    : sliced;
  const geometry = { type: "LineString" as const, coordinates: oriented };
  const distanceMeters = resolveSegmentDistance(segment, geometry);

  if (geometry.coordinates.length < 2) {
    diagnostics.push(diagnostic("warn", "RG_RENDER_SHORT_SEGMENT_GEOMETRY", "Resolved path segment geometry has fewer than two coordinates.", {
      edgeRef: segment.edgeRef,
      orderIndex: segment.orderIndex,
    }));
  }

  return {
    orderIndex: segment.orderIndex,
    edgeRef: segment.edgeRef,
    geometry,
    geometryRef: source.geometryRef,
    geometrySource: source.source,
    measureRange: segment.measureRange,
    distanceMeters,
    specialSectionRefs: segment.specialSectionRefs,
  };
}

function findSegmentGeometry(
  graph: RailGraph,
  edge: TopologyEdge,
  segment: ServicePathSegment,
): {
  geometry: GeoJSONLineString;
  geometryRef?: EntityRef;
  source: "geometry_store" | "edge_coordinates";
} | undefined {
  const refs = [segment.geometryRef, edge.geometryRef, edge.id].filter(Boolean) as EntityRef[];
  for (const ref of refs) {
    const geometry = graph.geometryStore.edgeGeometries[ref];
    if (geometry?.coordinates?.length) {
      return {
        geometry,
        geometryRef: ref,
        source: "geometry_store",
      };
    }
  }
  if (edge.coordinates?.length) {
    return {
      geometry: { type: "LineString", coordinates: edge.coordinates },
      geometryRef: edge.geometryRef,
      source: "edge_coordinates",
    };
  }
  return undefined;
}

function hasSegmentGeometry(graph: RailGraph, segment: ServicePathSegment): boolean {
  const edge = graph.indexes.edgeById[segment.edgeRef];
  return !!edge && !!findSegmentGeometry(graph, edge, segment);
}

function shouldReverseForTraversal(edge: TopologyEdge, segment: ServicePathSegment): boolean {
  if (segment.fromNodeRef && segment.toNodeRef) {
    return segment.fromNodeRef === edge.toNodeRef && segment.toNodeRef === edge.fromNodeRef;
  }
  return segment.measureRange.startMeasure > segment.measureRange.endMeasure;
}

function resolveSegmentDistance(segment: ServicePathSegment, geometry: GeoJSONLineString): number {
  if (Number.isFinite(segment.distanceMeters) && segment.distanceMeters > 0) {
    return segment.distanceMeters;
  }
  return polylineLengthMeters(geometry.coordinates);
}

function sliceCoordinatesByMeasure(
  coordinates: GeoJSONPosition[],
  range: MeasureRange,
): GeoJSONPosition[] {
  if (coordinates.length < 2) return [...coordinates];
  const startMeasure = clamp01(Math.min(range.startMeasure, range.endMeasure));
  const endMeasure = clamp01(Math.max(range.startMeasure, range.endMeasure));
  if (startMeasure <= 0 && endMeasure >= 1) return coordinates.map(clonePosition);

  const lengths = segmentLengths(coordinates);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return coordinates.map(clonePosition);

  const startDistance = total * startMeasure;
  const endDistance = total * endMeasure;
  const out: GeoJSONPosition[] = [pointAtDistance(coordinates, lengths, startDistance)];
  let distanceBefore = 0;
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    distanceBefore += lengths[index - 1];
    if (distanceBefore > startDistance && distanceBefore < endDistance) {
      pushCoordinate(out, coordinates[index]);
    }
  }
  pushCoordinate(out, pointAtDistance(coordinates, lengths, endDistance));
  return out;
}

function pointAtDistance(
  coordinates: GeoJSONPosition[],
  lengths: number[],
  targetDistance: number,
): GeoJSONPosition {
  let distanceBefore = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    const nextDistance = distanceBefore + length;
    if (targetDistance <= nextDistance || index === lengths.length - 1) {
      const local = length > 0 ? (targetDistance - distanceBefore) / length : 0;
      const start = coordinates[index];
      const end = coordinates[index + 1];
      return [
        start[0] + (end[0] - start[0]) * clamp01(local),
        start[1] + (end[1] - start[1]) * clamp01(local),
      ];
    }
    distanceBefore = nextDistance;
  }
  return clonePosition(coordinates[coordinates.length - 1]);
}

function segmentLengths(coordinates: GeoJSONPosition[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    out.push(haversineDistance(coordinates[index], coordinates[index + 1]));
  }
  return out;
}

function stitchCoordinates(lines: GeoJSONPosition[][]): GeoJSONPosition[] {
  const out: GeoJSONPosition[] = [];
  for (const line of lines) {
    for (const coordinate of line) {
      pushCoordinate(out, coordinate);
    }
  }
  return out;
}

function pushCoordinate(out: GeoJSONPosition[], coordinate: GeoJSONPosition): void {
  const previous = out[out.length - 1];
  if (previous && sameCoordinate(previous, coordinate)) return;
  out.push(clonePosition(coordinate));
}

function sameCoordinate(left: GeoJSONPosition, right: GeoJSONPosition): boolean {
  return Math.abs(left[0] - right[0]) < 1e-10 && Math.abs(left[1] - right[1]) < 1e-10;
}

function clonePosition(position: GeoJSONPosition): GeoJSONPosition {
  return [position[0], position[1]];
}

function polylineLengthMeters(coordinates: GeoJSONPosition[]): number {
  return segmentLengths(coordinates).reduce((sum, length) => sum + length, 0);
}

function buildStationPassages(
  graph: RailGraph,
  traceSequence: ServiceTraceEntry[],
  pathSegments: ServicePathSegment[],
  segments: ResolvedGeoJsonPathSegment[],
): ResolvedStationPassage[] {
  const segmentStarts = buildSegmentDistanceStarts(segments);
  return [...traceSequence]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((trace) => {
      const segment = segments.find((item) => item.edgeRef === trace.edgeRef);
      const pathSegment = pathSegments.find((item) => item.edgeRef === trace.edgeRef);
      const startDistance = segment ? segmentStarts.get(segment.orderIndex) ?? 0 : 0;
      return {
        orderIndex: trace.orderIndex,
        passageType: trace.passageType,
        stationRef: trace.stationRef,
        edgeRef: trace.edgeRef,
        platformRef: trace.platformRef,
        stoppingPointRef: trace.passageType === "stop" ? trace.stoppingPointRef : undefined,
        distanceMetersFromStart: segment
          ? startDistance + segment.distanceMeters * measureFractionOnSegment(graph, traceMeasure(trace), pathSegment)
          : 0,
      };
    });
}

function buildSegmentDistanceStarts(segments: ResolvedGeoJsonPathSegment[]): Map<number, number> {
  const out = new Map<number, number>();
  let distance = 0;
  for (const segment of [...segments].sort((a, b) => a.orderIndex - b.orderIndex)) {
    out.set(segment.orderIndex, distance);
    distance += segment.distanceMeters;
  }
  return out;
}

function traceMeasure(trace: ServiceTraceEntry): number {
  if (trace.passageType === "stop") return trace.measure;
  if (trace.measureRange) return trace.measureRange.startMeasure;
  return 0;
}

function measureFractionOnSegment(
  graph: RailGraph,
  measure: number,
  segment: ServicePathSegment | undefined,
): number {
  if (!segment) return 0;
  const range = segment.measureRange;
  const start = Math.min(range.startMeasure, range.endMeasure);
  const end = Math.max(range.startMeasure, range.endMeasure);
  if (end === start) return 0;
  const edge = graph.indexes.edgeById[segment.edgeRef];
  const reverse = edge ? shouldReverseForTraversal(edge, segment) : range.startMeasure > range.endMeasure;
  return reverse
    ? clamp01((end - measure) / (end - start))
    : clamp01((measure - start) / (end - start));
}

function buildSemanticRefs(
  path: RunPath,
  segments: ResolvedGeoJsonPathSegment[],
): ResolvedPathSemanticRef[] {
  const out: ResolvedPathSemanticRef[] = [];
  for (const trace of path.traceSequence) {
    out.push({ kind: "station", entityRef: trace.stationRef, orderIndex: trace.orderIndex });
    if (trace.platformRef) out.push({ kind: "platform", entityRef: trace.platformRef, orderIndex: trace.orderIndex });
    if (trace.passageType === "stop") {
      out.push({ kind: "stopping_point", entityRef: trace.stoppingPointRef, orderIndex: trace.orderIndex });
      if (trace.operationType) {
        out.push({
          kind: "operation",
          entityRef: `${path.patternRef}:operation:${trace.orderIndex}:${trace.operationType}` as EntityRef,
          orderIndex: trace.orderIndex,
          payload: { operationType: trace.operationType },
        });
      }
    }
  }
  for (const segment of segments) {
    for (const sectionRef of segment.specialSectionRefs ?? []) {
      out.push({
        kind: "special_section",
        entityRef: sectionRef,
        segmentIndex: segment.orderIndex,
      });
    }
  }
  return out;
}

function buildSmoothingPlan(segments: OffsetGeometrySegment[]): OffsetSmoothingPlan[] {
  const out: OffsetSmoothingPlan[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const prev = segments[index - 1];
    const current = segments[index];
    if (prev.offsetMeters === current.offsetMeters && prev.offsetSide === current.offsetSide) continue;
    out.push({
      startMeasure: prev.endMeasure,
      endMeasure: current.startMeasure,
      joinStrategy: "linear_blend",
      transitionMeters: Math.min(20, Math.max(Math.abs(prev.offsetMeters), Math.abs(current.offsetMeters))),
    });
  }
  return out;
}

function normalizeDirection(value: string | undefined): DirectionLabel {
  if (value === "up" || value === "down" || value === "clockwise" || value === "counterclockwise") return value;
  return "unknown";
}

function createPathId(sourceGraphId: string, path: RunPath, direction: DirectionLabel): string {
  return `resolved:path:${fingerprint({
    sourceGraphId,
    patternRef: path.patternRef,
    edgeSequence: path.edgeSequence,
    traceSequence: path.traceSequence,
    direction,
  }).slice(0, 16)}`;
}

function emptyResolvedPath(args: {
  patternRef: EntityRef;
  sourceGraphId?: string;
  pathId?: string;
  direction: DirectionLabel;
  diagnostics: Diagnostic[];
}): ResolvedGeoJsonPath {
  const sourceGraphId = args.sourceGraphId ?? "graph:unbound";
  return {
    pathId: args.pathId ?? `resolved:path:${fingerprint({ sourceGraphId, patternRef: args.patternRef }).slice(0, 16)}`,
    sourceGraphId,
    patternRef: args.patternRef,
    direction: args.direction,
    geometry: { type: "LineString", coordinates: [] },
    segments: [],
    stationPassages: [],
    semanticRefs: [],
    totalDistanceMeters: 0,
    diagnostics: args.diagnostics,
  };
}

function diagnostic(
  level: Diagnostic["level"],
  code: string,
  message: string,
  context?: Record<string, unknown>,
): Diagnostic {
  return {
    level,
    code,
    stage: "render-geometry",
    message,
    context,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
