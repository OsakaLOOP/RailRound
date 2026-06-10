import type {
  BoundMileageEvent,
  MileagePlaceQuery,
  MileageProjectionContext,
  MileageRunPathLike,
  MileageUserEventKind,
  MileageUserEventVisibility,
  UserEventV2,
} from "../rail-graph-v1/mileage-event.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { TripResult as RailGraphTripResult, TripResultSegment } from "../rail-graph-v1/user-facing.types";
import {
  compareBoundMileageEvents,
  inferScenicViewpointPayload,
  projectEventToRunPath,
  queryEventsByMileage as queryCoreEventsByMileage,
  queryEventsByTime as queryCoreEventsByTime,
  queryEventsNearPlace as queryCoreEventsNearPlace,
  resolvePlaceToMileage,
} from "../rail-graph-v1/mileage-events";
import type { RailwayLine, RailwayMap, Station, Trip, TripSegment } from "../store";
import { getTripRailGraphSnapshot } from "./railGraphTripPersistence";

export interface AppMileageLineContext {
  source?: "legacy_app";
  lineKey: string;
  line: RailwayLine;
  context: MileageProjectionContext;
  runPath: MileageRunPathLike;
  totalMeters: number;
}

export interface RailGraphMileageLineContext {
  source: "rail_graph_runtime";
  lineKey: string;
  tripId?: string;
  segmentIndex: number;
  segment: TripResultSegment;
  context: MileageProjectionContext;
  runPath: MileageRunPathLike;
  totalMeters: number;
}

export type MileageLineContextLike = AppMileageLineContext | RailGraphMileageLineContext;

export interface DisplayMileageEventProjection {
  bound: BoundMileageEvent;
  lineContext: MileageLineContextLike;
  trip?: Trip;
}

export interface MileageEventDraft {
  title?: string;
  body?: string;
  kind?: MileageUserEventKind;
  visibility?: MileageUserEventVisibility;
  tags?: string[];
  mediaUrl?: string;
  tripId?: string | number;
  lineKey?: string;
}

export interface MileageEventSearchFilters {
  query?: string;
  tags?: string[];
  kind?: MileageUserEventKind | "all";
  visibility?: MileageUserEventVisibility | "all";
  lineKey?: string;
  fromKm?: number | null;
  toKm?: number | null;
  tripId?: string | number | null;
}

export interface MileageEventQualitySummary {
  missingTitle: number;
  missingTags: number;
  unlinkedTrip: number;
  estimatedTime: number;
  unstableProjection: number;
}

export type MileageEventProjectionStatusCode =
  | "projected"
  | "linear_time"
  | "unknown_time"
  | "missing_line"
  | "missing_line_data"
  | "unsupported_scope"
  | "out_of_range"
  | "unresolved";

export interface MileageEventProjectionStatus {
  state: "ok" | "warning" | "failed";
  code: MileageEventProjectionStatusCode;
  lineKey: string | null;
  distanceMeters: number;
  totalMeters?: number;
  diagnostics: BoundMileageEvent["diagnostics"];
}

const DEFAULT_START_TIME = "2026-01-01T08:00:00.000Z";
const DEFAULT_END_TIME = "2026-01-01T09:00:00.000Z";

export function buildAppMileageLineContext(railwayData: RailwayMap, lineKey: string): AppMileageLineContext | null {
  const line = railwayData[lineKey];
  if (!line || !Array.isArray(line.stations) || line.stations.length === 0) return null;

  const systemRef = appSystemRef(lineKey);
  const lineRef = appLineRef(lineKey);
  const edgeMileage: MileageProjectionContext["edgeMileage"] = {};
  const stationMileage: MileageProjectionContext["stationMileage"] = {};
  const edgeSequence: EntityRef[] = [];
  const stationSequence: EntityRef[] = [];
  let cursor = 0;

  for (const [index, station] of line.stations.entries()) {
    const stationRef = appStationRef(lineKey, station.id);
    stationSequence.push(stationRef);
    stationMileage[stationRef] = {
      stationRef,
      distanceMeters: cursor,
      coordinates: [station.lng, station.lat],
      name: station.name_ja,
    };

    const next = line.stations[index + 1];
    if (!next) continue;
    const edgeRef = appEdgeRef(lineKey, station.id, next.id);
    const segmentMeters = segmentMetersBetween(station, next);
    edgeSequence.push(edgeRef);
    edgeMileage[edgeRef] = {
      edgeRef,
      startMeters: cursor,
      endMeters: cursor + segmentMeters,
      coordinates: [
        [station.lng, station.lat],
        [next.lng, next.lat],
      ],
    };
    cursor += segmentMeters;
  }

  const context: MileageProjectionContext = {
    systemRef,
    lineRef,
    edgeMileage,
    stationMileage,
    linearTimeRange: {
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
      startMeters: 0,
      endMeters: Math.max(1, cursor),
    },
  };

  return {
    source: "legacy_app",
    lineKey,
    line,
    context,
    runPath: {
      systemRef,
      lineRef,
      edgeSequence,
      stationSequence,
    },
    totalMeters: cursor,
  };
}

export function buildRailGraphMileageLineContext(
  tripResult: RailGraphTripResult,
  segmentIndex = 0,
): RailGraphMileageLineContext | null {
  const segment = tripResult.segments[segmentIndex];
  if (!segment) return null;
  return buildRailGraphMileageSegmentContext(segment, {
    tripId: tripResult.tripId,
    segmentIndex,
  });
}

export function buildRailGraphMileageSegmentContext(
  segment: TripResultSegment,
  options: { tripId?: string; segmentIndex?: number } = {},
): RailGraphMileageLineContext {
  const context = mileageContextFromResolvedPath(segment);
  return {
    source: "rail_graph_runtime",
    lineKey: `rail-graph:${segment.mileageProfile.patternRef ?? segment.segmentId}`,
    tripId: options.tripId,
    segmentIndex: options.segmentIndex ?? 0,
    segment,
    context,
    runPath: {
      systemRef: segment.mileageProfile.systemRef,
      lineRef: segment.mileageProfile.lineRef,
      patternRef: segment.mileageProfile.patternRef,
      direction: segment.mileageProfile.direction,
      edgeSequence: segment.mileageProfile.edgeSequence,
      stationSequence: segment.mileageProfile.stationSequence,
    },
    totalMeters: segment.mileageProfile.totalDistanceMeters,
  };
}

export function createMileageEventFromStation(args: {
  lineContext: MileageLineContextLike;
  stationId: string;
  title: string;
  body?: string;
  kind?: MileageUserEventKind;
  visibility?: MileageUserEventVisibility;
  tags?: string[];
  mediaUrl?: string;
  tripId?: string | number;
}): UserEventV2 | null {
  const stationRef = stationRefForContext(args.lineContext, args.stationId);
  const station = args.lineContext.context.stationMileage[stationRef];
  if (!station) return null;
  return createMileageEventAtResolvedDistance({
    lineContext: args.lineContext,
    distanceMeters: station.distanceMeters,
    id: `app:event:${slug(args.lineContext.lineKey)}:${slug(args.stationId)}:${Date.now().toString(36)}` as EntityRef,
    draft: args,
    payload: {
      createdFrom: "station",
      stationRef,
      stationId: args.stationId,
    },
  });
}

export function createMileageEventAtDistance(args: {
  lineContext: MileageLineContextLike;
  distanceMeters: number;
  title: string;
  body?: string;
  kind?: MileageUserEventKind;
  visibility?: MileageUserEventVisibility;
  tags?: string[];
  mediaUrl?: string;
  tripId?: string | number;
}): UserEventV2 {
  return createMileageEventAtResolvedDistance({
    lineContext: args.lineContext,
    distanceMeters: Math.max(0, Math.min(args.lineContext.totalMeters, args.distanceMeters)),
    id: `app:event:${slug(args.lineContext.lineKey)}:${Math.round(args.distanceMeters)}:${Date.now().toString(36)}` as EntityRef,
    draft: args,
    payload: {
      createdFrom: "mileage",
    },
  });
}

export function createMileageEventFromCoordinates(args: {
  lineContext: MileageLineContextLike;
  coordinates: [number, number];
  title: string;
  body?: string;
  kind?: MileageUserEventKind;
  visibility?: MileageUserEventVisibility;
  tags?: string[];
  mediaUrl?: string;
  tripId?: string | number;
}): UserEventV2 | null {
  const resolved = resolvePlaceToMileage({ coordinates: args.coordinates }, args.lineContext.context);
  if (!resolved) return null;
  return createMileageEventAtResolvedDistance({
    lineContext: args.lineContext,
    distanceMeters: resolved.mileage.distanceMeters,
    id: `app:event:${slug(args.lineContext.lineKey)}:map:${Date.now().toString(36)}` as EntityRef,
    draft: args,
    payload: {
      createdFrom: "map_point",
      targetCoordinates: args.coordinates,
      projectedCoordinates: resolved.coordinates,
      projectionMethod: resolved.method,
      projectionDiagnostics: resolved.diagnostics,
    },
  });
}

export function createMileageEventFromPlace(args: {
  lineContext: MileageLineContextLike;
  place: MileagePlaceQuery;
  title: string;
  body?: string;
  kind?: MileageUserEventKind;
  visibility?: MileageUserEventVisibility;
  tags?: string[];
  mediaUrl?: string;
  tripId?: string | number;
}): UserEventV2 | null {
  const resolved = resolvePlaceToMileage(args.place, args.lineContext.context);
  if (!resolved) return null;
  const createdFrom = resolved.method === "coordinates" ? "map_point" : resolved.method;
  return createMileageEventAtResolvedDistance({
    lineContext: args.lineContext,
    distanceMeters: resolved.mileage.distanceMeters,
    id: `app:event:${slug(args.lineContext.lineKey)}:${slug(createdFrom)}:${Date.now().toString(36)}` as EntityRef,
    draft: args,
    payload: {
      createdFrom,
      projectionMethod: resolved.method,
      projectionDiagnostics: resolved.diagnostics,
      ...(args.place.coordinates ? { targetCoordinates: args.place.coordinates } : {}),
      ...(resolved.coordinates ? { projectedCoordinates: resolved.coordinates } : {}),
      ...(resolved.stationRef ? { stationRef: resolved.stationRef, stationId: stationIdFromRef(resolved.stationRef) } : {}),
      ...(resolved.edgeRef ? { edgeRef: resolved.edgeRef } : {}),
    },
  });
}

export function createMileageEventFromTripPosition(args: {
  railwayData: RailwayMap;
  trip: Trip;
  segmentIndex?: number;
  ratio?: number;
  title: string;
  body?: string;
  kind?: MileageUserEventKind;
  visibility?: MileageUserEventVisibility;
  tags?: string[];
  mediaUrl?: string;
}): UserEventV2 | null {
  const railGraphTrip = getTripRailGraphSnapshot(args.trip)?.tripResult;
  if (railGraphTrip) {
    const segmentIndex = Math.max(0, Math.min(railGraphTrip.segments.length - 1, args.segmentIndex ?? 0));
    const lineContext = buildRailGraphMileageLineContext(railGraphTrip, segmentIndex);
    if (!lineContext) return null;
    const ratio = Math.max(0, Math.min(1, args.ratio ?? 0));
    const segment = railGraphTrip.segments[segmentIndex];
    return createMileageEventAtResolvedDistance({
      lineContext,
      distanceMeters: lineContext.totalMeters * ratio,
      id: `app:event:${slug(lineContext.lineKey)}:trip:${slug(String(args.trip.id))}:${Date.now().toString(36)}` as EntityRef,
      draft: { ...args, tripId: args.trip.id },
      payload: {
        createdFrom: "trip_position",
        tripId: args.trip.id,
        segmentIndex,
        ratio,
        source: "rail_graph",
        lineLabel: segment.lineLabel,
        patternRef: segment.mileageProfile.patternRef,
        direction: segment.mileageProfile.direction,
        fromId: String(segment.fromStation.stationRef),
        toId: String(segment.toStation.stationRef),
      },
    });
  }

  const segments = normalizeTripSegments(args.trip);
  const segment = segments[Math.max(0, Math.min(segments.length - 1, args.segmentIndex ?? 0))];
  if (!segment?.lineKey) return null;
  const lineContext = buildAppMileageLineContext(args.railwayData, segment.lineKey);
  if (!lineContext) return null;
  const window = segmentMileageWindow(lineContext, segment);
  if (!window) return null;
  const ratio = Math.max(0, Math.min(1, args.ratio ?? 0));
  const distanceMeters = window.fromMeters + (window.toMeters - window.fromMeters) * ratio;
  return createMileageEventAtResolvedDistance({
    lineContext,
    distanceMeters,
    id: `app:event:${slug(lineContext.lineKey)}:trip:${slug(String(args.trip.id))}:${Date.now().toString(36)}` as EntityRef,
    draft: { ...args, tripId: args.trip.id },
    payload: {
      createdFrom: "trip_position",
      tripId: args.trip.id,
      segmentIndex: args.segmentIndex ?? 0,
      ratio,
      fromId: segment.fromId,
      toId: segment.toId,
    },
  });
}

export function updateMileageEventFromDraft(event: UserEventV2, draft: MileageEventDraft): UserEventV2 {
  const nextPayload = {
    ...(event.payload ?? {}),
    ...(draft.mediaUrl ? { mediaUrl: draft.mediaUrl.trim() } : {}),
    ...(draft.tripId !== undefined && draft.tripId !== "" ? { tripId: draft.tripId } : {}),
  };
  if (draft.mediaUrl !== undefined && draft.mediaUrl.trim() === "") delete nextPayload.mediaUrl;
  if (draft.tripId === null || draft.tripId === "") delete nextPayload.tripId;
  return {
    ...event,
    kind: draft.kind ?? event.kind,
    title: cleanTitle(draft.title ?? event.title),
    body: cleanOptional(draft.body) ?? undefined,
    visibility: draft.visibility ?? event.visibility,
    tags: normalizeTags(draft.tags ?? event.tags),
    payload: nextPayload,
    updatedAt: new Date().toISOString(),
  };
}

export function eventsForLine(events: readonly UserEventV2[], lineContext: MileageLineContextLike): BoundMileageEvent[] {
  return events
    .map((event) => projectEventToRunPath(event, lineContext.runPath, lineContext.context))
    .filter((event): event is BoundMileageEvent => event !== null)
    .sort(compareBoundMileageEvents);
}

export function queryEventsNearPlace(args: {
  events: readonly UserEventV2[];
  lineContext: MileageLineContextLike;
  place: MileagePlaceQuery;
  radiusMeters: number;
}) {
  return queryCoreEventsNearPlace(args.events, args.place, args.lineContext.context, args.radiusMeters);
}

export function queryLineEventsByStation(args: {
  events: readonly UserEventV2[];
  lineContext: MileageLineContextLike;
  stationId: string;
  radiusMeters: number;
}) {
  const stationRef = stationRefForContext(args.lineContext, args.stationId);
  return queryEventsNearPlace({
    events: args.events,
    lineContext: args.lineContext,
    place: { stationRef },
    radiusMeters: args.radiusMeters,
  });
}

export function queryEventsByMileage(args: {
  events: readonly UserEventV2[];
  lineContext: MileageLineContextLike;
  fromMeters: number;
  toMeters: number;
}) {
  return queryCoreEventsByMileage(args.events, {
    systemRef: args.lineContext.context.systemRef,
    lineRef: args.lineContext.context.lineRef,
    patternRef: args.lineContext.context.patternRef,
    fromMeters: args.fromMeters,
    toMeters: args.toMeters,
  });
}

export function queryLineEventsByMileage(args: {
  events: readonly UserEventV2[];
  lineContext: MileageLineContextLike;
  fromMeters: number;
  toMeters: number;
}) {
  return queryEventsByMileage(args);
}

export function queryEventsByTime(args: {
  events: readonly UserEventV2[];
  lineContext: MileageLineContextLike;
  fromTime: string;
  toTime: string;
}) {
  return queryCoreEventsByTime(args.events, args.lineContext.context.timeline, args.lineContext.context, {
    fromTime: normalizeTimeInput(args.fromTime),
    toTime: normalizeTimeInput(args.toTime),
  });
}

export function queryLineEventsByTime(args: {
  events: readonly UserEventV2[];
  lineContext: MileageLineContextLike;
  fromTime: string;
  toTime: string;
}) {
  return queryEventsByTime(args);
}

export function projectEventsToTrip(
  events: readonly UserEventV2[],
  tripResult: RailGraphTripResult,
): BoundMileageEvent[];
export function projectEventsToTrip(
  events: readonly UserEventV2[],
  railwayData: RailwayMap,
  trip: Trip,
): BoundMileageEvent[];
export function projectEventsToTrip(
  events: readonly UserEventV2[],
  tripOrRailwayData: RailwayMap | RailGraphTripResult,
  trip?: Trip,
): BoundMileageEvent[] {
  if (isRailGraphTripResult(tripOrRailwayData)) {
    return projectEventsToRailGraphTrip(events, tripOrRailwayData);
  }
  if (trip) {
    const railGraphTrip = trip.railGraph?.tripResult ?? null;
    if (railGraphTrip) {
      return projectEventsToRailGraphTrip(events, railGraphTrip);
    }
  }
  const railwayData = tripOrRailwayData;
  if (!trip) return [];
  let cursor = 0;
  const output: BoundMileageEvent[] = [];
  for (const [segmentIndex, segment] of normalizeTripSegments(trip).entries()) {
    if (!segment.lineKey) continue;
    const lineContext = buildAppMileageLineContext(railwayData, segment.lineKey);
    if (!lineContext) continue;
    const window = segmentMileageWindow(lineContext, segment);
    if (!window) continue;

    const segmentEvents = queryLineEventsByMileage({
      events,
      lineContext,
      fromMeters: Math.min(window.fromMeters, window.toMeters),
      toMeters: Math.max(window.fromMeters, window.toMeters),
    }).items;

    for (const event of segmentEvents) {
      const bound = projectEventToRunPath(event, lineContext.runPath, lineContext.context);
      if (!bound) continue;
      const localDistance = window.fromMeters <= window.toMeters
        ? event.mileage.distanceMeters - window.fromMeters
        : window.fromMeters - event.mileage.distanceMeters;
      output.push({
        ...bound,
        distanceMetersFromRunStart: cursor + Math.max(0, localDistance),
        orderIndex: segmentIndex,
      });
    }
    cursor += Math.abs(window.toMeters - window.fromMeters);
  }
  return output.sort(compareBoundMileageEvents);
}

export function queryEventsByTrip(
  events: readonly UserEventV2[],
  railwayData: RailwayMap,
  trip: Trip,
): BoundMileageEvent[] {
  return projectEventsToTrip(events, railwayData, trip);
}

export function boundMileageEventForDisplay(
  event: UserEventV2,
  railwayData: RailwayMap,
): { bound: BoundMileageEvent; lineContext: AppMileageLineContext } | null {
  const lineContext = lineContextForEvent(railwayData, event);
  if (!lineContext) return null;
  const bound = projectEventToRunPath(event, lineContext.runPath, lineContext.context);
  return bound ? { bound, lineContext } : null;
}

export function boundMileageEventsForDisplay(
  events: readonly UserEventV2[],
  railwayData: RailwayMap,
): Array<{ bound: BoundMileageEvent; lineContext: AppMileageLineContext }> {
  return events
    .map((event) => boundMileageEventForDisplay(event, railwayData))
    .filter((entry): entry is { bound: BoundMileageEvent; lineContext: AppMileageLineContext } => entry !== null)
    .sort((left, right) => compareBoundMileageEvents(left.bound, right.bound));
}

export function boundMileageEventForRichDisplay(
  event: UserEventV2,
  railwayData: RailwayMap,
  trips: readonly Trip[] = [],
): DisplayMileageEventProjection | null {
  const legacy = boundMileageEventForDisplay(event, railwayData);
  if (legacy) return legacy;
  return boundMileageEventForTripSnapshots(event, trips);
}

export function boundMileageEventsForRichDisplay(
  events: readonly UserEventV2[],
  railwayData: RailwayMap,
  trips: readonly Trip[] = [],
): DisplayMileageEventProjection[] {
  const output: DisplayMileageEventProjection[] = [];
  const seen = new Set<string>();

  for (const entry of boundMileageEventsForDisplay(events, railwayData)) {
    output.push(entry);
    seen.add(entry.bound.event.id);
  }

  for (const trip of trips) {
    const snapshot = getTripRailGraphSnapshot(trip)?.tripResult;
    if (!snapshot) continue;
    const candidates = events.filter((event) => {
      if (seen.has(event.id)) return false;
      const linkedTripId = event.payload?.tripId;
      return linkedTripId === undefined || String(linkedTripId) === String(trip.id);
    });
    if (candidates.length === 0) continue;
    for (const bound of projectEventsToTrip(candidates, snapshot)) {
      if (seen.has(bound.event.id)) continue;
      const segmentIndex = bound.orderIndex ?? 0;
      const lineContext = buildRailGraphMileageLineContext(snapshot, segmentIndex);
      if (!lineContext) continue;
      output.push({ bound, lineContext, trip });
      seen.add(bound.event.id);
    }
  }

  return output.sort((left, right) => compareBoundMileageEvents(left.bound, right.bound));
}

export function mileageEventProjectionStatusForDisplay(
  event: UserEventV2,
  railwayData: RailwayMap,
  trips: readonly Trip[] = [],
): MileageEventProjectionStatus {
  const projected = boundMileageEventForRichDisplay(event, railwayData, trips);
  if (!projected) return mileageEventProjectionStatus(event, railwayData);
  const lineKey = projected.lineContext.lineKey;
  const totalMeters = projected.lineContext.totalMeters;
  const base = {
    lineKey,
    distanceMeters: projected.bound.event.mileage.distanceMeters,
    totalMeters,
    diagnostics: projected.bound.diagnostics,
  };
  if (projected.bound.timestampInference === "linear") {
    return { ...base, state: "warning", code: "linear_time" };
  }
  if (projected.bound.timestampInference === "unknown") {
    return { ...base, state: "warning", code: "unknown_time" };
  }
  return { ...base, state: "ok", code: "projected" };
}

export function mileageEventProjectionStatus(
  event: UserEventV2,
  railwayData: RailwayMap,
): MileageEventProjectionStatus {
  const lineKey = findLineKeyForMileageEvent(event);
  const lineContext = lineContextForEvent(railwayData, event);
  if (!lineContext) {
    return {
      state: "failed",
      code: lineKey
        ? railwayData[lineKey]
          ? "missing_line_data"
          : "missing_line"
        : "unsupported_scope",
      lineKey,
      distanceMeters: event.mileage.distanceMeters,
      diagnostics: [],
    };
  }

  const bound = projectEventToRunPath(event, lineContext.runPath, lineContext.context);
  if (!bound) {
    const outsideMileage =
      event.mileage.distanceMeters < 0 || event.mileage.distanceMeters > lineContext.totalMeters;
    return {
      state: "failed",
      code: outsideMileage ? "out_of_range" : "unresolved",
      lineKey: lineContext.lineKey,
      distanceMeters: event.mileage.distanceMeters,
      totalMeters: lineContext.totalMeters,
      diagnostics: [],
    };
  }

  if (bound.timestampInference === "linear") {
    return {
      state: "warning",
      code: "linear_time",
      lineKey: lineContext.lineKey,
      distanceMeters: event.mileage.distanceMeters,
      totalMeters: lineContext.totalMeters,
      diagnostics: bound.diagnostics,
    };
  }
  if (bound.timestampInference === "unknown") {
    return {
      state: "warning",
      code: "unknown_time",
      lineKey: lineContext.lineKey,
      distanceMeters: event.mileage.distanceMeters,
      totalMeters: lineContext.totalMeters,
      diagnostics: bound.diagnostics,
    };
  }
  return {
    state: "ok",
    code: "projected",
    lineKey: lineContext.lineKey,
    distanceMeters: event.mileage.distanceMeters,
    totalMeters: lineContext.totalMeters,
    diagnostics: bound.diagnostics,
  };
}

export function searchMileageEvents(
  events: readonly UserEventV2[],
  railwayData: RailwayMap,
  filters: MileageEventSearchFilters,
): UserEventV2[] {
  const query = (filters.query ?? "").trim().toLowerCase();
  const requiredTags = (filters.tags ?? []).map((tag) => tag.toLowerCase()).filter(Boolean);
  const fromMeters = typeof filters.fromKm === "number" ? filters.fromKm * 1000 : null;
  const toMeters = typeof filters.toKm === "number" ? filters.toKm * 1000 : null;
  const lo = fromMeters === null || toMeters === null ? fromMeters ?? toMeters : Math.min(fromMeters, toMeters);
  const hi = fromMeters === null || toMeters === null ? fromMeters ?? toMeters : Math.max(fromMeters, toMeters);

  return events.filter((event) => {
    if (filters.kind && filters.kind !== "all" && event.kind !== filters.kind) return false;
    if (filters.visibility && filters.visibility !== "all" && event.visibility !== filters.visibility) return false;
    if (filters.lineKey && findLineKeyForMileageEvent(event) !== filters.lineKey) return false;
    if (filters.tripId !== undefined && filters.tripId !== null && event.payload?.tripId !== filters.tripId) return false;
    if (lo !== null && event.mileage.distanceMeters < lo) return false;
    if (hi !== null && event.mileage.distanceMeters > hi) return false;
    if (requiredTags.length > 0) {
      const eventTags = (event.tags ?? []).map((tag) => tag.toLowerCase());
      if (!requiredTags.every((tag) => eventTags.includes(tag))) return false;
    }
    if (query) {
      const lineKey = findLineKeyForMileageEvent(event) ?? "";
      const lineName = lineKey ? lineLabel(lineKey) : "";
      const stationName = nearestStationNameForEvent(event, railwayData) ?? "";
      const haystack = [
        event.title,
        event.body ?? "",
        event.kind,
        event.visibility,
        lineKey,
        lineName,
        stationName,
        ...(event.tags ?? []),
      ].join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort(compareMileageEventDisplayOrder);
}

export function queryEventsByText(
  events: readonly UserEventV2[],
  railwayData: RailwayMap,
  query: string,
  filters: Omit<MileageEventSearchFilters, "query"> = {},
): UserEventV2[] {
  return searchMileageEvents(events, railwayData, { ...filters, query });
}

export function mileageEventStats(
  events: readonly UserEventV2[],
  railwayData: RailwayMap,
  trips: readonly Trip[] = [],
) {
  const byKind = new Map<MileageUserEventKind, number>();
  const byVisibility = new Map<MileageUserEventVisibility, number>();
  const byLine = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const quality: MileageEventQualitySummary = {
    missingTitle: 0,
    missingTags: 0,
    unlinkedTrip: 0,
    estimatedTime: 0,
    unstableProjection: 0,
  };

  for (const event of events) {
    byKind.set(event.kind, (byKind.get(event.kind) ?? 0) + 1);
    byVisibility.set(event.visibility, (byVisibility.get(event.visibility) ?? 0) + 1);
    const lineKey = findLineKeyForMileageEvent(event);
    if (lineKey) byLine.set(lineKey, (byLine.get(lineKey) ?? 0) + 1);
    for (const tag of event.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    if (!event.title.trim()) quality.missingTitle += 1;
    if (!event.tags?.length) quality.missingTags += 1;
    if (!event.payload?.tripId) quality.unlinkedTrip += 1;
    const projected = mileageEventProjectionStatusForDisplay(event, railwayData, trips);
    if (projected.state === "failed") {
      quality.unstableProjection += 1;
    } else if (projected.code === "linear_time") {
      quality.estimatedTime += 1;
    } else if (projected.code === "unknown_time") {
      quality.unstableProjection += 1;
    }
  }

  return {
    total: events.length,
    byKind: Array.from(byKind.entries()).sort((a, b) => b[1] - a[1]),
    byVisibility: Array.from(byVisibility.entries()).sort((a, b) => b[1] - a[1]),
    byLine: Array.from(byLine.entries()).sort((a, b) => b[1] - a[1]),
    tags: Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]),
    quality,
  };
}

export function findLineKeyForMileageEvent(event: UserEventV2): string | null {
  const payloadLineKey = event.payload?.lineKey;
  if (typeof payloadLineKey === "string" && payloadLineKey) return payloadLineKey;
  const lineRef = event.mileage.lineRef;
  if (typeof lineRef === "string" && lineRef.startsWith("app-line:")) {
    return lineRef.slice("app-line:".length);
  }
  return null;
}

export function lineContextForEvent(railwayData: RailwayMap, event: UserEventV2): AppMileageLineContext | null {
  const lineKey = findLineKeyForMileageEvent(event);
  if (lineKey) return buildAppMileageLineContext(railwayData, lineKey);
  for (const candidate of Object.keys(railwayData)) {
    const context = buildAppMileageLineContext(railwayData, candidate);
    if (!context) continue;
    if (
      event.mileage.systemRef === context.context.systemRef
      && (!event.mileage.lineRef || event.mileage.lineRef === context.context.lineRef)
    ) {
      return context;
    }
  }
  return null;
}

export function nearestStationNameForEvent(event: UserEventV2, railwayData: RailwayMap): string | null {
  const entry = boundMileageEventForDisplay(event, railwayData);
  if (!entry) return null;
  return stationNameForBoundEvent(entry.bound, entry.lineContext);
}

export function stationNameForBoundEvent(bound: BoundMileageEvent, lineContext: MileageLineContextLike): string | null {
  const stationRef = bound.stationRef;
  if (lineContext.source === "rail_graph_runtime") {
    if (stationRef) {
      const station = lineContext.context.stationMileage[stationRef];
      if (station?.name) return station.name;
    }
    let best: { name?: string; delta: number } | null = null;
    for (const station of Object.values(lineContext.context.stationMileage)) {
      const delta = Math.abs(station.distanceMeters - bound.event.mileage.distanceMeters);
      if (!best || delta < best.delta) best = { name: station.name, delta };
    }
    return best?.name ?? null;
  }

  if (stationRef) {
    const stationId = stationIdFromRef(stationRef);
    const station = lineContext.line.stations.find((candidate) => candidate.id === stationId);
    if (station) return station.name_ja;
  }
  let best: { station: Station; delta: number } | null = null;
  for (const station of lineContext.line.stations) {
    const stationMileage = lineContext.context.stationMileage[appStationRef(lineContext.lineKey, station.id)];
    if (!stationMileage) continue;
    const delta = Math.abs(stationMileage.distanceMeters - bound.event.mileage.distanceMeters);
    if (!best || delta < best.delta) best = { station, delta };
  }
  return best?.station.name_ja ?? null;
}

export function lineLabel(lineKey: string): string {
  return lineKey.includes(":") ? lineKey.split(":").slice(1).join(":") : lineKey;
}

export function formatKm(meters: number, digits = 1): string {
  return `${(Math.max(0, meters) / 1000).toFixed(digits)} km`;
}

export function normalizeTags(tags: string[] | undefined): string[] | undefined {
  const unique = Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

export function tagsFromInput(input: string): string[] | undefined {
  return normalizeTags(input.split(/[,\s#，、]+/g));
}

export function tagsToInput(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

export function appStationPlace(lineKey: string, stationId: string): MileagePlaceQuery {
  return { stationRef: appStationRef(lineKey, stationId) };
}

export function appSystemRef(lineKey: string): EntityRef {
  return `app-system:${lineKey}` as EntityRef;
}

export function appLineRef(lineKey: string): EntityRef {
  return `app-line:${lineKey}` as EntityRef;
}

export function appStationRef(lineKey: string, stationId: string): EntityRef {
  return `app-station:${lineKey}:${stationId}` as EntityRef;
}

export function appEdgeRef(lineKey: string, fromStationId: string, toStationId: string): EntityRef {
  return `app-edge:${lineKey}:${fromStationId}:${toStationId}` as EntityRef;
}

export function normalizeTimeInput(value: string): string {
  const trimmed = value.trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `2026-01-01T${trimmed}:00.000Z`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return `2026-01-01T${trimmed}.000Z`;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : DEFAULT_START_TIME;
}

function createMileageEventAtResolvedDistance(args: {
  lineContext: MileageLineContextLike;
  distanceMeters: number;
  id: EntityRef;
  draft: MileageEventDraft;
  payload?: Record<string, unknown>;
}): UserEventV2 {
  const now = new Date().toISOString();
  const mediaUrl = args.draft.mediaUrl?.trim();
  const tripId = args.draft.tripId;
  const kind = args.draft.kind ?? "user_note";
  const basePayload: Record<string, unknown> = {
    ...(args.payload ?? {}),
    lineKey: args.lineContext.lineKey,
    contextSource: args.lineContext.source ?? "legacy_app",
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(tripId !== undefined && tripId !== "" ? { tripId } : {}),
  };
  const viewpoint = kind === "scenic"
    ? inferScenicViewpointPayload({
      context: args.lineContext.context,
      distanceMeters: args.distanceMeters,
      targetCoordinates: Array.isArray(basePayload.targetCoordinates)
        ? basePayload.targetCoordinates as [number, number]
        : undefined,
      source: args.lineContext.source === "rail_graph_runtime" ? "inferred_from_route" : "inferred_from_geojson",
    })
    : undefined;
  return {
    schemaVersion: "mileage-user-event-v1",
    id: args.id,
    kind,
    title: cleanTitle(args.draft.title),
    body: cleanOptional(args.draft.body),
    mileage: {
      systemRef: args.lineContext.context.systemRef,
      lineRef: args.lineContext.context.lineRef,
      patternRef: args.lineContext.context.patternRef,
      direction: args.lineContext.context.direction,
      distanceMeters: Math.max(0, Math.min(args.lineContext.totalMeters, args.distanceMeters)),
    },
    visibility: args.draft.visibility ?? "private",
    tags: normalizeTags(args.draft.tags),
    payload: {
      ...basePayload,
      ...(viewpoint ? { viewpoint } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
}

function compareMileageEventDisplayOrder(left: UserEventV2, right: UserEventV2): number {
  return left.mileage.distanceMeters - right.mileage.distanceMeters || left.id.localeCompare(right.id);
}

function cleanTitle(value: string | undefined): string {
  return value?.trim() || "Mileage event";
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeTripSegments(trip: Trip): TripSegment[] {
  return trip.segments?.length
    ? trip.segments
    : [{ id: "legacy", lineKey: trip.lineKey || "", fromId: trip.fromId || "", toId: trip.toId || "" }];
}

function projectEventsToRailGraphTrip(
  events: readonly UserEventV2[],
  tripResult: RailGraphTripResult,
): BoundMileageEvent[] {
  let cursor = 0;
  const output: BoundMileageEvent[] = [];
  for (const [segmentIndex, segment] of tripResult.segments.entries()) {
    const lineContext = buildRailGraphMileageSegmentContext(segment, {
      tripId: tripResult.tripId,
      segmentIndex,
    });
    const segmentEvents = queryEventsByMileage({
      events,
      lineContext,
      fromMeters: 0,
      toMeters: lineContext.totalMeters,
    }).items;
    for (const event of segmentEvents) {
      const bound = projectEventToRunPath(event, lineContext.runPath, lineContext.context);
      if (!bound) continue;
      output.push({
        ...bound,
        distanceMetersFromRunStart: cursor + bound.distanceMetersFromRunStart,
        orderIndex: segmentIndex,
      });
    }
    cursor += lineContext.totalMeters;
  }
  return output.sort(compareBoundMileageEvents);
}

function boundMileageEventForTripSnapshots(
  event: UserEventV2,
  trips: readonly Trip[],
): DisplayMileageEventProjection | null {
  for (const trip of trips) {
    const linkedTripId = event.payload?.tripId;
    if (linkedTripId !== undefined && String(linkedTripId) !== String(trip.id)) continue;
    const snapshot = getTripRailGraphSnapshot(trip)?.tripResult;
    if (!snapshot) continue;
    const [bound] = projectEventsToTrip([event], snapshot);
    if (!bound) continue;
    const segmentIndex = bound.orderIndex ?? 0;
    const lineContext = buildRailGraphMileageLineContext(snapshot, segmentIndex);
    if (!lineContext) continue;
    return { bound, lineContext, trip };
  }
  return null;
}

function mileageContextFromResolvedPath(segment: TripResultSegment): MileageProjectionContext {
  return {
    systemRef: segment.mileageProfile.systemRef,
    lineRef: segment.mileageProfile.lineRef,
    patternRef: segment.mileageProfile.patternRef,
    direction: segment.mileageProfile.direction,
    edgeMileage: segment.mileageProfile.edgeMileage,
    stationMileage: withStationDisplayMeta(segment),
    timeline: segment.mileageProfile.timeline,
    linearTimeRange: segment.mileageProfile.linearTimeRange ?? {
      startTime: segment.viaStations[0]?.departureTime ?? segment.viaStations[0]?.arrivalTime ?? DEFAULT_START_TIME,
      endTime: segment.viaStations[segment.viaStations.length - 1]?.arrivalTime
        ?? segment.viaStations[segment.viaStations.length - 1]?.departureTime
        ?? DEFAULT_END_TIME,
      startMeters: 0,
      endMeters: Math.max(1, segment.mileageProfile.totalDistanceMeters),
    },
  };
}

function withStationDisplayMeta(segment: TripResultSegment): MileageProjectionContext["stationMileage"] {
  const stationMileage = { ...segment.mileageProfile.stationMileage };
  for (const stop of segment.viaStations) {
    const current = stationMileage[stop.station.stationRef];
    if (!current) continue;
    stationMileage[stop.station.stationRef] = {
      ...current,
      coordinates: current.coordinates ?? stop.station.coordinates,
      name: current.name ?? stop.station.name,
    };
  }
  return stationMileage;
}

function stationRefForContext(lineContext: MileageLineContextLike, stationId: string): EntityRef {
  if (lineContext.source === "rail_graph_runtime") {
    const exact = Object.keys(lineContext.context.stationMileage).find((stationRef) =>
      stationRef === stationId || stationRef.endsWith(`:${stationId}`)
    );
    return (exact ?? stationId) as EntityRef;
  }
  return appStationRef(lineContext.lineKey, stationId);
}

function isRailGraphTripResult(value: RailwayMap | RailGraphTripResult): value is RailGraphTripResult {
  return !!value
    && typeof value === "object"
    && "tripId" in value
    && "segments" in value
    && Array.isArray((value as RailGraphTripResult).segments)
    && (value as RailGraphTripResult).segments.some((segment) => !!segment.mileageProfile);
}

export function tripOrTripSnapshotToRailGraphTrip(trip: Trip): RailGraphTripResult | null {
  return getTripRailGraphSnapshot(trip)?.tripResult ?? null;
}

function segmentMileageWindow(lineContext: AppMileageLineContext, segment: Pick<TripSegment, "fromId" | "toId">): {
  fromMeters: number;
  toMeters: number;
} | null {
  const from = lineContext.context.stationMileage[appStationRef(lineContext.lineKey, segment.fromId)];
  const to = lineContext.context.stationMileage[appStationRef(lineContext.lineKey, segment.toId)];
  if (!from || !to) return null;
  return { fromMeters: from.distanceMeters, toMeters: to.distanceMeters };
}

function stationIdFromRef(stationRef: EntityRef): string {
  return String(stationRef).split(":").pop() || String(stationRef);
}

function segmentMetersBetween(station: Station, next: Station): number {
  const storedKm = typeof station.distToNext === "number" && Number.isFinite(station.distToNext)
    ? station.distToNext
    : null;
  return Math.max(1, (storedKm ?? haversineKm(station.lat, station.lng, next.lat, next.lng)) * 1000);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function slug(value: string): string {
  return String(value || "event").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "event";
}
