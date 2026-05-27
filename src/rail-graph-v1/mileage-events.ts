// ============================================================
// Rail Graph v1 - Mileage-Centric User Event Projection
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type { GeoJSONPosition } from "./geojson";
import type {
  BoundMileageEvent,
  LegacyAnchoredUserEvent,
  MileageEdgeSpan,
  MileagePlaceQuery,
  MileageProjectionContext,
  MileageQueryWindow,
  MileageRef,
  MileageRunPathLike,
  MileageStationPoint,
  MileageTimeQuery,
  MileageTimelinePoint,
  ResolvedMileagePlace,
  UserEventV2,
} from "./mileage-event.types";
import type { EntityRef } from "./primitives";
import type { ServicePattern } from "./service-template.types";
import type { BaseTopologyLayer, TopologyEdge } from "./base-topology.types";

export interface MileageQueryResult<T> {
  items: T[];
  diagnostics: Diagnostic[];
}

export interface MileageIndexBuildArgs {
  systemRef: EntityRef;
  lineRef?: EntityRef;
  pattern?: ServicePattern;
  topo?: Pick<BaseTopologyLayer, "edges" | "stations">;
  edgeSequence?: EntityRef[];
  stationSequence?: EntityRef[];
  direction?: MileageProjectionContext["direction"];
}

export function buildMileageProjectionContext(args: MileageIndexBuildArgs): MileageProjectionContext {
  const edgeById = new Map((args.topo?.edges ?? []).map((edge) => [edge.id, edge] as const));
  const edgeSequence = args.edgeSequence ?? args.pattern?.edgeSequence ?? args.topo?.edges.map((edge) => edge.id) ?? [];
  const stationSequence = args.stationSequence
    ?? args.pattern?.traceSequence.map((entry) => entry.stationRef)
    ?? args.topo?.stations.map((station) => station.id)
    ?? [];

  const edgeMileage: Record<string, MileageEdgeSpan> = {};
  const stationMileage: Record<string, MileageStationPoint> = {};
  let cursor = 0;

  for (const edgeRef of edgeSequence) {
    const edge = edgeById.get(edgeRef);
    const length = finiteNonNegative(edge?.lengthMeters, 0);
    edgeMileage[edgeRef] = {
      edgeRef,
      startMeters: cursor,
      endMeters: cursor + length,
      coordinates: edge?.coordinates,
    };
    cursor += length;
  }

  const traceSequence = args.pattern?.traceSequence ?? [];
  for (const trace of traceSequence) {
    const span = edgeMileage[trace.edgeRef];
    if (!span) continue;
    const measure = "measure" in trace
      ? finiteClamp01(trace.measure)
      : finiteClamp01(trace.measureRange?.startMeasure ?? 0);
    const distanceMeters = span.startMeters + (span.endMeters - span.startMeters) * measure;
    stationMileage[trace.stationRef] = {
      stationRef: trace.stationRef,
      distanceMeters,
      coordinates: interpolateOnSpan(span, measure),
    };
  }

  if (Object.keys(stationMileage).length === 0 && stationSequence.length > 0) {
    const total = cursor;
    const step = stationSequence.length > 1 ? total / (stationSequence.length - 1) : 0;
    for (const [index, stationRef] of stationSequence.entries()) {
      stationMileage[stationRef] = {
        stationRef,
        distanceMeters: index * step,
      };
    }
  }

  return {
    systemRef: args.systemRef,
    lineRef: args.lineRef ?? args.pattern?.lineRef,
    patternRef: args.pattern?.patternId,
    direction: args.direction,
    edgeMileage,
    stationMileage,
  };
}

export function projectEventToRunPath(
  event: UserEventV2,
  runPath: MileageRunPathLike,
  context: MileageProjectionContext,
): BoundMileageEvent | null {
  if (!sameMileageScope(event.mileage, context, runPath)) return null;

  const runStart = runStartMileage(runPath, context);
  const runEnd = runEndMileage(runPath, context);
  const eventStart = eventRangeStart(event);
  const eventEnd = eventRangeEnd(event);
  if (!rangesOverlap(eventStart, eventEnd, Math.min(runStart, runEnd), Math.max(runStart, runEnd))) {
    return null;
  }

  const distanceMetersFromRunStart = runStart <= runEnd
    ? eventStart - runStart
    : runStart - eventStart;
  const nearest = nearestPathEntity(eventStart, runPath, context);
  const time = interpolateTimestamp(eventStart, context);

  return {
    event,
    distanceMetersFromRunStart: Math.max(0, distanceMetersFromRunStart),
    orderIndex: nearest.orderIndex,
    stationRef: nearest.stationRef,
    edgeRef: nearest.edgeRef,
    coordinates: nearest.coordinates,
    timestamp: time.timestamp,
    timestampInference: time.inference,
    diagnostics: time.diagnostics,
  };
}

export function queryEventsByMileage(
  events: readonly UserEventV2[],
  window: MileageQueryWindow,
): MileageQueryResult<UserEventV2> {
  const from = Math.min(window.fromMeters, window.toMeters);
  const to = Math.max(window.fromMeters, window.toMeters);
  const items = events
    .filter((event) =>
      event.mileage.systemRef === window.systemRef
      && optionalScopeMatches(event.mileage.lineRef, window.lineRef)
      && optionalScopeMatches(event.mileage.patternRef, window.patternRef)
      && rangesOverlap(eventRangeStart(event), eventRangeEnd(event), from, to)
    )
    .sort(compareMileageEvents);
  return { items, diagnostics: [] };
}

export function queryEventsNearPlace(
  events: readonly UserEventV2[],
  place: MileagePlaceQuery,
  context: MileageProjectionContext,
  radiusMeters: number,
): MileageQueryResult<BoundMileageEvent> {
  const resolved = resolvePlaceToMileage(place, context);
  if (!resolved) {
    return {
      items: [],
      diagnostics: [diagnostic("warn", "MILEAGE_PLACE_UNRESOLVED", "Could not project place query to mileage.", { place })],
    };
  }
  const query = queryEventsByMileage(events, {
    systemRef: resolved.mileage.systemRef,
    lineRef: resolved.mileage.lineRef,
    patternRef: resolved.mileage.patternRef,
    fromMeters: resolved.mileage.distanceMeters - Math.max(0, radiusMeters),
    toMeters: resolved.mileage.distanceMeters + Math.max(0, radiusMeters),
  });
  const runPath = contextToRunPath(context);
  const items = query.items
    .map((event) => projectEventToRunPath(event, runPath, context))
    .filter((item): item is BoundMileageEvent => item !== null);
  return { items, diagnostics: [...resolved.diagnostics, ...query.diagnostics] };
}

export function queryEventsByTime(
  events: readonly UserEventV2[],
  timeline: readonly MileageTimelinePoint[] | undefined,
  context: MileageProjectionContext,
  range: MileageTimeQuery,
): MileageQueryResult<BoundMileageEvent> {
  const effectiveContext = timeline ? { ...context, timeline: [...timeline] } : context;
  const projected = timeRangeToMileage(range, effectiveContext);
  if (!projected) {
    return {
      items: [],
      diagnostics: [diagnostic("warn", "MILEAGE_TIME_UNRESOLVED", "Could not project time query to mileage.", { range })],
    };
  }

  const query = queryEventsByMileage(events, {
    systemRef: effectiveContext.systemRef,
    lineRef: effectiveContext.lineRef,
    patternRef: effectiveContext.patternRef,
    fromMeters: projected.fromMeters,
    toMeters: projected.toMeters,
  });
  const runPath = contextToRunPath(effectiveContext);
  const items = query.items
    .map((event) => projectEventToRunPath(event, runPath, effectiveContext))
    .filter((item): item is BoundMileageEvent => item !== null);
  return {
    items,
    diagnostics: [
      ...projected.diagnostics,
      ...query.diagnostics,
    ],
  };
}

export function convertLegacyUserEvent(
  legacy: LegacyAnchoredUserEvent,
  context: MileageProjectionContext,
): UserEventV2 {
  const mileage = legacy.anchor.kind === "station"
    ? stationAnchorToMileage(legacy.anchor.stationRef, context)
    : edgeAnchorToMileage(legacy.anchor.edgeRef, legacy.anchor.measure, context);
  if (!mileage) {
    throw new Error(`Cannot convert legacy UserEvent ${legacy.id}: anchor cannot be projected to mileage.`);
  }
  return {
    schemaVersion: "mileage-user-event-v1",
    id: legacy.id,
    kind: "user_note",
    title: legacy.title,
    mileage,
    visibility: "private",
    payload: {
      ...(legacy.payload ?? {}),
      legacyAnchor: legacy.anchor,
    },
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
}

export function validateUserEventV2(value: unknown): UserEventV2 {
  if (!value || typeof value !== "object") throw new Error("UserEventV2 must be an object.");
  const event = value as UserEventV2;
  if (event.schemaVersion !== "mileage-user-event-v1") throw new Error("UserEventV2.schemaVersion must be mileage-user-event-v1.");
  if (!event.id) throw new Error("UserEventV2.id is required.");
  if (!event.kind) throw new Error(`UserEventV2[${event.id}].kind is required.`);
  if (!event.title) throw new Error(`UserEventV2[${event.id}].title is required.`);
  if (!event.visibility) throw new Error(`UserEventV2[${event.id}].visibility is required.`);
  if (!event.mileage || typeof event.mileage !== "object") throw new Error(`UserEventV2[${event.id}].mileage is required.`);
  if (!event.mileage.systemRef) throw new Error(`UserEventV2[${event.id}].mileage.systemRef is required.`);
  if (!Number.isFinite(event.mileage.distanceMeters)) throw new Error(`UserEventV2[${event.id}].mileage.distanceMeters must be finite.`);
  if (event.range) {
    if (!Number.isFinite(event.range.startMeters)) throw new Error(`UserEventV2[${event.id}].range.startMeters must be finite.`);
    if (!Number.isFinite(event.range.endMeters)) throw new Error(`UserEventV2[${event.id}].range.endMeters must be finite.`);
  }
  return {
    ...event,
    mileage: {
      ...event.mileage,
      distanceMeters: Math.max(0, event.mileage.distanceMeters),
    },
    range: event.range ? normalizeMileageRange(event.range.startMeters, event.range.endMeters) : undefined,
  };
}

export function normalizeMileageRange(startMeters: number, endMeters: number): { startMeters: number; endMeters: number } {
  return {
    startMeters: Math.max(0, Math.min(startMeters, endMeters)),
    endMeters: Math.max(0, Math.max(startMeters, endMeters)),
  };
}

export function resolvePlaceToMileage(
  place: MileagePlaceQuery,
  context: MileageProjectionContext,
): ResolvedMileagePlace | null {
  if (typeof place.distanceMeters === "number" && Number.isFinite(place.distanceMeters)) {
    return {
      mileage: scopedMileage(context, place.distanceMeters),
      method: "mileage",
      diagnostics: [],
    };
  }
  if (place.stationRef) {
    const station = context.stationMileage[place.stationRef];
    if (!station) return null;
    return {
      mileage: scopedMileage(context, station.distanceMeters),
      coordinates: station.coordinates,
      stationRef: place.stationRef,
      method: "station",
      diagnostics: [],
    };
  }
  if (place.edgeRef) {
    const span = context.edgeMileage[place.edgeRef];
    if (!span) return null;
    const measure = finiteClamp01(place.edgeMeasure ?? 0.5);
    return {
      mileage: scopedMileage(context, span.startMeters + (span.endMeters - span.startMeters) * measure),
      coordinates: interpolateOnSpan(span, measure),
      edgeRef: place.edgeRef,
      method: "edge",
      diagnostics: [],
    };
  }
  if (place.coordinates) {
    const nearest = nearestCoordinateOnMileage(place.coordinates, context);
    if (!nearest) return null;
    return {
      mileage: scopedMileage(context, nearest.distanceMeters),
      coordinates: nearest.coordinates,
      edgeRef: nearest.edgeRef,
      method: "coordinates",
      diagnostics: [diagnostic("info", "MILEAGE_COORDINATE_PROJECTED", "Coordinate query was projected to nearest edge mileage.", {
        edgeRef: nearest.edgeRef,
        distanceToEdgeMeters: nearest.distanceToEdgeMeters,
      })],
    };
  }
  return null;
}

export function compareBoundMileageEvents(left: BoundMileageEvent, right: BoundMileageEvent): number {
  return left.distanceMetersFromRunStart - right.distanceMetersFromRunStart
    || (left.orderIndex ?? 0) - (right.orderIndex ?? 0)
    || left.event.id.localeCompare(right.event.id);
}

export function compareMileageEvents(left: UserEventV2, right: UserEventV2): number {
  return eventRangeStart(left) - eventRangeStart(right) || left.id.localeCompare(right.id);
}

function sameMileageScope(
  mileage: MileageRef,
  context: MileageProjectionContext,
  runPath: MileageRunPathLike,
): boolean {
  return mileage.systemRef === (runPath.systemRef ?? context.systemRef)
    && optionalScopeMatches(mileage.lineRef, runPath.lineRef ?? context.lineRef)
    && optionalScopeMatches(mileage.patternRef, runPath.patternRef ?? context.patternRef);
}

function optionalScopeMatches(eventValue: EntityRef | undefined, queryValue: EntityRef | undefined): boolean {
  return !queryValue || !eventValue || eventValue === queryValue;
}

function stationAnchorToMileage(stationRef: EntityRef, context: MileageProjectionContext): MileageRef | null {
  const station = context.stationMileage[stationRef];
  return station ? scopedMileage(context, station.distanceMeters) : null;
}

function edgeAnchorToMileage(edgeRef: EntityRef, measure: number, context: MileageProjectionContext): MileageRef | null {
  const span = context.edgeMileage[edgeRef];
  if (!span) return null;
  return scopedMileage(context, span.startMeters + (span.endMeters - span.startMeters) * finiteClamp01(measure));
}

function scopedMileage(context: MileageProjectionContext, distanceMeters: number): MileageRef {
  return {
    systemRef: context.systemRef,
    lineRef: context.lineRef,
    patternRef: context.patternRef,
    direction: context.direction,
    distanceMeters,
  };
}

function eventRangeStart(event: UserEventV2): number {
  return event.range ? Math.min(event.range.startMeters, event.range.endMeters) : event.mileage.distanceMeters;
}

function eventRangeEnd(event: UserEventV2): number {
  return event.range ? Math.max(event.range.startMeters, event.range.endMeters) : event.mileage.distanceMeters;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aEnd >= bStart && aStart <= bEnd;
}

function runStartMileage(runPath: MileageRunPathLike, context: MileageProjectionContext): number {
  const firstEdge = runPath.edgeSequence[0];
  if (firstEdge && context.edgeMileage[firstEdge]) return context.edgeMileage[firstEdge].startMeters;
  const firstStation = runPath.stationSequence?.[0];
  if (firstStation && context.stationMileage[firstStation]) return context.stationMileage[firstStation].distanceMeters;
  return 0;
}

function runEndMileage(runPath: MileageRunPathLike, context: MileageProjectionContext): number {
  const lastEdge = runPath.edgeSequence[runPath.edgeSequence.length - 1];
  if (lastEdge && context.edgeMileage[lastEdge]) return context.edgeMileage[lastEdge].endMeters;
  const lastStation = runPath.stationSequence?.[runPath.stationSequence.length - 1];
  if (lastStation && context.stationMileage[lastStation]) return context.stationMileage[lastStation].distanceMeters;
  return runStartMileage(runPath, context);
}

function nearestPathEntity(distanceMeters: number, runPath: MileageRunPathLike, context: MileageProjectionContext): {
  orderIndex?: number;
  stationRef?: EntityRef;
  edgeRef?: EntityRef;
  coordinates?: GeoJSONPosition;
} {
  let bestStation: { station: MileageStationPoint; orderIndex: number; delta: number } | null = null;
  for (const [orderIndex, stationRef] of (runPath.stationSequence ?? []).entries()) {
    const station = context.stationMileage[stationRef];
    if (!station) continue;
    const delta = Math.abs(station.distanceMeters - distanceMeters);
    if (!bestStation || delta < bestStation.delta) bestStation = { station, orderIndex, delta };
  }

  const edgeRef = runPath.edgeSequence.find((candidate) => {
    const span = context.edgeMileage[candidate];
    return span && distanceMeters >= Math.min(span.startMeters, span.endMeters) && distanceMeters <= Math.max(span.startMeters, span.endMeters);
  });
  const span = edgeRef ? context.edgeMileage[edgeRef] : undefined;
  const measure = span ? (distanceMeters - span.startMeters) / Math.max(1, span.endMeters - span.startMeters) : 0;

  return {
    orderIndex: bestStation?.orderIndex ?? (edgeRef ? runPath.edgeSequence.indexOf(edgeRef) : undefined),
    stationRef: bestStation?.station.stationRef,
    edgeRef,
    coordinates: span ? interpolateOnSpan(span, measure) : bestStation?.station.coordinates,
  };
}

function interpolateTimestamp(distanceMeters: number, context: MileageProjectionContext): {
  timestamp?: string;
  inference: BoundMileageEvent["timestampInference"];
  diagnostics: Diagnostic[];
} {
  if (context.timeline && context.timeline.length >= 2) {
    const sorted = [...context.timeline].sort((a, b) => a.distanceMeters - b.distanceMeters);
    const projected = interpolateFromTimeline(distanceMeters, sorted);
    if (projected) return { timestamp: projected, inference: "timeline", diagnostics: [] };
  }
  if (context.linearTimeRange) {
    const projected = interpolateLinearTime(distanceMeters, context.linearTimeRange);
    if (projected) {
      return {
        timestamp: projected,
        inference: "linear",
        diagnostics: [diagnostic("info", "MILEAGE_TIME_LINEAR", "Timestamp inferred by linear mileage interpolation.")],
      };
    }
  }
  return {
    inference: "unknown",
    diagnostics: [diagnostic("info", "MILEAGE_TIME_UNKNOWN", "No timeline was available for this mileage event.")],
  };
}

function timeRangeToMileage(range: MileageTimeQuery, context: MileageProjectionContext): {
  fromMeters: number;
  toMeters: number;
  diagnostics: Diagnostic[];
} | null {
  const start = Date.parse(range.fromTime);
  const end = Date.parse(range.toTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);

  if (context.timeline && context.timeline.length >= 2) {
    const sorted = [...context.timeline].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const fromMeters = mileageAtTime(lo, sorted);
    const toMeters = mileageAtTime(hi, sorted);
    if (fromMeters !== null && toMeters !== null) return { fromMeters, toMeters, diagnostics: [] };
  }

  if (context.linearTimeRange) {
    const fromMeters = linearMileageAtTime(lo, context.linearTimeRange);
    const toMeters = linearMileageAtTime(hi, context.linearTimeRange);
    if (fromMeters !== null && toMeters !== null) {
      return {
        fromMeters,
        toMeters,
        diagnostics: [diagnostic("info", "MILEAGE_TIME_RANGE_LINEAR", "Time query projected with linear mileage interpolation.")],
      };
    }
  }
  return null;
}

function interpolateFromTimeline(distanceMeters: number, timeline: MileageTimelinePoint[]): string | null {
  const sorted = [...timeline].sort((a, b) => a.distanceMeters - b.distanceMeters);
  for (let i = 1; i < sorted.length; i += 1) {
    const left = sorted[i - 1];
    const right = sorted[i];
    if (distanceMeters < left.distanceMeters || distanceMeters > right.distanceMeters) continue;
    const t = (distanceMeters - left.distanceMeters) / Math.max(1, right.distanceMeters - left.distanceMeters);
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
    return new Date(leftTime + (rightTime - leftTime) * t).toISOString();
  }
  return null;
}

function mileageAtTime(timestampMs: number, timeline: MileageTimelinePoint[]): number | null {
  const sorted = [...timeline].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (let i = 1; i < sorted.length; i += 1) {
    const leftTime = Date.parse(sorted[i - 1].timestamp);
    const rightTime = Date.parse(sorted[i].timestamp);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) continue;
    if (timestampMs < leftTime || timestampMs > rightTime) continue;
    const t = (timestampMs - leftTime) / Math.max(1, rightTime - leftTime);
    return sorted[i - 1].distanceMeters + (sorted[i].distanceMeters - sorted[i - 1].distanceMeters) * t;
  }
  return null;
}

function interpolateLinearTime(distanceMeters: number, range: NonNullable<MileageProjectionContext["linearTimeRange"]>): string | null {
  const start = Date.parse(range.startTime);
  const end = Date.parse(range.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const t = (distanceMeters - range.startMeters) / Math.max(1, range.endMeters - range.startMeters);
  return new Date(start + (end - start) * Math.max(0, Math.min(1, t))).toISOString();
}

function linearMileageAtTime(timestampMs: number, range: NonNullable<MileageProjectionContext["linearTimeRange"]>): number | null {
  const start = Date.parse(range.startTime);
  const end = Date.parse(range.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const t = (timestampMs - start) / Math.max(1, end - start);
  return range.startMeters + (range.endMeters - range.startMeters) * Math.max(0, Math.min(1, t));
}

function contextToRunPath(context: MileageProjectionContext): MileageRunPathLike {
  return {
    systemRef: context.systemRef,
    lineRef: context.lineRef,
    patternRef: context.patternRef,
    direction: context.direction,
    edgeSequence: Object.values(context.edgeMileage)
      .sort((a, b) => a.startMeters - b.startMeters)
      .map((span) => span.edgeRef),
    stationSequence: Object.values(context.stationMileage)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .map((station) => station.stationRef),
  };
}

function nearestCoordinateOnMileage(coordinates: GeoJSONPosition, context: MileageProjectionContext): {
  distanceMeters: number;
  edgeRef: EntityRef;
  coordinates?: GeoJSONPosition;
  distanceToEdgeMeters: number;
} | null {
  let best: {
    distanceMeters: number;
    edgeRef: EntityRef;
    coordinates?: GeoJSONPosition;
    distanceToEdgeMeters: number;
  } | null = null;
  for (const span of Object.values(context.edgeMileage)) {
    if (!span.coordinates || span.coordinates.length < 2) continue;
    const projected = projectPointToPolyline(coordinates, span);
    if (!best || projected.distanceToEdgeMeters < best.distanceToEdgeMeters) best = projected;
  }
  return best;
}

function projectPointToPolyline(point: GeoJSONPosition, span: MileageEdgeSpan): {
  distanceMeters: number;
  edgeRef: EntityRef;
  coordinates?: GeoJSONPosition;
  distanceToEdgeMeters: number;
} {
  const coords = span.coordinates ?? [];
  let walked = 0;
  let best = {
    distanceMeters: span.startMeters,
    edgeRef: span.edgeRef,
    coordinates: coords[0],
    distanceToEdgeMeters: Number.POSITIVE_INFINITY,
  };
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    const projection = projectPointToSegment(point, a, b);
    const segLen = distanceMeters(a, b);
    const distanceToEdgeMeters = distanceMeters(point, projection.point);
    if (distanceToEdgeMeters < best.distanceToEdgeMeters) {
      best = {
        distanceMeters: span.startMeters + walked + segLen * projection.t,
        edgeRef: span.edgeRef,
        coordinates: projection.point,
        distanceToEdgeMeters,
      };
    }
    walked += segLen;
  }
  return best;
}

function interpolateOnSpan(span: MileageEdgeSpan, measure: number): GeoJSONPosition | undefined {
  const coords = span.coordinates;
  if (!coords || coords.length === 0) return undefined;
  if (coords.length === 1) return coords[0];
  const target = Math.max(0, Math.min(1, measure)) * polylineLengthMeters(coords);
  let walked = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    const segLen = distanceMeters(a, b);
    if (walked + segLen >= target) {
      const t = (target - walked) / Math.max(1, segLen);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += segLen;
  }
  return coords[coords.length - 1];
}

function projectPointToSegment(point: GeoJSONPosition, a: GeoJSONPosition, b: GeoJSONPosition): { point: GeoJSONPosition; t: number } {
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * dx + dy * dy;
  const rawT = denom === 0 ? 0 : ((point[0] - ax) * dx + (point[1] - ay) * dy) / denom;
  const t = Math.max(0, Math.min(1, rawT));
  return { point: [ax + dx * t, ay + dy * t], t };
}

function polylineLengthMeters(coordinates: GeoJSONPosition[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += distanceMeters(coordinates[i - 1], coordinates[i]);
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

function finiteClamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function diagnostic(level: Diagnostic["level"], code: string, message: string, context?: Record<string, unknown>): Diagnostic {
  return {
    level,
    code,
    stage: "mileage-events",
    message,
    context,
  };
}

export function edgeLengthForMileage(edge: TopologyEdge | undefined): number {
  return finiteNonNegative(edge?.lengthMeters, 0);
}
