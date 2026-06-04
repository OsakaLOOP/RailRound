import type { BoundMileageEvent, UserEventV2 } from "../rail-graph-v1/mileage-event.types";
import type { DirectionLabel, EntityRef } from "../rail-graph-v1/primitives";
import type { StationStop, TripEvent, TripResult, TripResultSegment } from "../rail-graph-v1/user-facing.types";
import type { RailwayMap, Trip } from "../store";
import { projectEventsToTrip } from "./mileageUserEvents";
import { getTripRailGraphSnapshot } from "./railGraphTripPersistence";
import { tripLineSummary, tripToProductSegments } from "./tripProductProjection";

export type TripDetailKind = "rail_graph" | "legacy";
export type TripDetailGeoSourceCode = "rail_graph_snapshot" | "legacy_geojson" | "missing_geometry";
export type TripDetailEventType = TripEvent["type"] | "departure" | "arrival" | "user_event";
export type TripDetailEventImportance = "key" | "detail";

export interface TripDetailModel {
  kind: TripDetailKind;
  tripId: string;
  date?: string;
  overview: TripDetailOverview;
  segments: TripDetailSegment[];
  events: TripDetailEvent[];
  geoSource: TripDetailGeoSource;
}

export interface TripDetailOverview {
  title: string;
  planUsed?: TripResult["planUsed"];
  presetId?: string;
  totalDistanceKm: number;
  totalTimeMinutes?: number;
  eventTypeSummary: TripDetailEventType[];
  userEventCount: number;
  systemEventCount: number;
  segmentCount: number;
}

export interface TripDetailSegment {
  id: string;
  index: number;
  source: TripDetailKind;
  lineKey: string;
  lineLabel: string;
  displayColor?: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  distanceKm: number;
  timeMinutes?: number;
  geometry?: [number, number][];
  systemRef?: EntityRef;
  lineRef?: EntityRef;
  patternRef?: EntityRef;
  direction?: DirectionLabel;
  serviceType?: string;
  viaStations: TripDetailStop[];
  viaStationCount: number;
  stopCount: number;
  passCount: number;
  systemEventCount: number;
  userEventCount: number;
  keyEvents: TripDetailEvent[];
  geoSource: TripDetailGeoSource;
}

export interface TripDetailStop {
  stationRef: EntityRef;
  name: string;
  stopType: "stop" | "pass";
  arrivalTime?: string;
  departureTime?: string;
  platformName?: string;
  platformNumber?: number;
}

export interface TripDetailEvent {
  id: string;
  source: "system" | "user";
  type: TripDetailEventType;
  label: string;
  segmentIndex?: number;
  distanceMeters?: number;
  timestamp?: string;
  stationRef?: EntityRef;
  stationName?: string;
  importance: TripDetailEventImportance;
  diagnosticsCount?: number;
  userEventId?: EntityRef;
}

export interface TripDetailGeoSource {
  code: TripDetailGeoSourceCode;
  hasGeometry: boolean;
  hasFallback: boolean;
  missingGeometryCount: number;
}

export function buildTripDetailModel(args: {
  trip: Trip;
  railwayData?: RailwayMap;
  userEvents?: readonly UserEventV2[];
}): TripDetailModel {
  const snapshot = getTripRailGraphSnapshot(args.trip);
  if (snapshot?.tripResult) {
    return railGraphTripToDetailModel({
      appTrip: args.trip,
      tripResult: snapshot.tripResult,
      railwayData: args.railwayData,
      userEvents: args.userEvents ?? [],
    });
  }
  return legacyTripToDetailModel({
    trip: args.trip,
    railwayData: args.railwayData,
    userEvents: args.userEvents ?? [],
  });
}

export function tripDetailKeyEvents(model: TripDetailModel, limit = 4): TripDetailEvent[] {
  return model.events.filter((event) => event.importance === "key").slice(0, limit);
}

export function railGraphTripToDetailModel(args: {
  appTrip?: Trip;
  tripResult: TripResult;
  railwayData?: RailwayMap;
  userEvents?: readonly UserEventV2[];
}): TripDetailModel {
  const productSegments = args.appTrip
    ? tripToProductSegments(args.appTrip, args.railwayData)
    : [];
  const userBounds = projectEventsToTrip(args.userEvents ?? [], args.tripResult);
  const userEventsBySegment = groupBoundEventsBySegment(userBounds);
  const segments: TripDetailSegment[] = [];
  const events: TripDetailEvent[] = [];
  let distanceCursor = 0;

  args.tripResult.segments.forEach((segment, index) => {
    const product = productSegments[index];
    const segmentStartMeters = distanceCursor;
    const systemEvents = tripSegmentSystemEvents(segment, index, segmentStartMeters);
    const userEvents = (userEventsBySegment.get(index) ?? []).map((bound) =>
      boundUserEventToDetailEvent(bound, index)
    );
    const boundaryEvents = railGraphBoundaryEvents(args.tripResult, segment, index, segmentStartMeters);
    const allSegmentEvents = [...boundaryEvents, ...systemEvents, ...userEvents];
    events.push(...allSegmentEvents);

    segments.push({
      id: segment.segmentId,
      index,
      source: "rail_graph",
      lineKey: product?.lineKey ?? String(segment.mileageProfile.lineRef ?? segment.mileageProfile.patternRef ?? segment.segmentId),
      lineLabel: segment.lineLabel,
      displayColor: segment.displayColor || product?.displayColor,
      fromId: String(segment.fromStation.stationRef),
      fromName: segment.fromStation.name,
      toId: String(segment.toStation.stationRef),
      toName: segment.toStation.name,
      distanceKm: segment.distanceKm,
      timeMinutes: segment.timeMinutes,
      geometry: segment.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      systemRef: segment.mileageProfile.systemRef,
      lineRef: segment.mileageProfile.lineRef,
      patternRef: segment.mileageProfile.patternRef,
      direction: segment.mileageProfile.direction,
      serviceType: segment.mileageProfile.serviceType,
      viaStations: segment.viaStations.map(stopToDetailStop),
      viaStationCount: segment.viaStations.length,
      stopCount: segment.viaStations.filter((stop) => stop.stopType === "stop").length,
      passCount: segment.viaStations.filter((stop) => stop.stopType === "pass").length,
      systemEventCount: systemEvents.length + boundaryEvents.length,
      userEventCount: userEvents.length,
      keyEvents: allSegmentEvents.filter((event) => event.importance === "key"),
      geoSource: segmentGeoSource(segment.geometry.coordinates.length > 1, "rail_graph_snapshot"),
    });

    distanceCursor += segment.mileageProfile.totalDistanceMeters || Math.round(segment.distanceKm * 1000);
  });

  return {
    kind: "rail_graph",
    tripId: args.appTrip ? String(args.appTrip.id) : args.tripResult.tripId,
    date: args.appTrip?.date,
    overview: {
      title: args.appTrip ? tripLineSummary(args.appTrip, args.railwayData) : railGraphTripTitle(args.tripResult),
      planUsed: args.tripResult.planUsed,
      presetId: args.tripResult.presetId,
      totalDistanceKm: args.tripResult.totalDistanceKm,
      totalTimeMinutes: args.tripResult.totalTimeMinutes,
      eventTypeSummary: uniqueEventTypes(events),
      userEventCount: userBounds.length,
      systemEventCount: events.filter((event) => event.source === "system").length,
      segmentCount: args.tripResult.segments.length,
    },
    segments,
    events: sortDetailEvents(events),
    geoSource: aggregateGeoSource(segments, "rail_graph_snapshot"),
  };
}

export function legacyTripToDetailModel(args: {
  trip: Trip;
  railwayData?: RailwayMap;
  userEvents?: readonly UserEventV2[];
}): TripDetailModel {
  const productSegments = tripToProductSegments(args.trip, args.railwayData);
  const userBounds = args.railwayData
    ? projectEventsToTrip(args.userEvents ?? [], args.railwayData, args.trip)
    : [];
  const userEventsBySegment = groupBoundEventsBySegment(userBounds);
  const segments: TripDetailSegment[] = [];
  const events: TripDetailEvent[] = [];
  let distanceCursor = 0;

  productSegments.forEach((segment, index) => {
    const segmentMeters = Math.round(Math.max(0, segment.distanceKm) * 1000);
    const boundaryEvents = legacyBoundaryEvents(segment, index, distanceCursor);
    const userEvents = (userEventsBySegment.get(index) ?? []).map((bound) =>
      boundUserEventToDetailEvent(bound, index)
    );
    const allSegmentEvents = [...boundaryEvents, ...userEvents];
    events.push(...allSegmentEvents);

    segments.push({
      id: segment.id,
      index,
      source: "legacy",
      lineKey: segment.lineKey,
      lineLabel: segment.lineLabel,
      displayColor: segment.displayColor,
      fromId: segment.fromId,
      fromName: segment.fromName,
      toId: segment.toId,
      toName: segment.toName,
      distanceKm: segment.distanceKm,
      geometry: segment.geometry,
      viaStations: [],
      viaStationCount: 0,
      stopCount: 0,
      passCount: 0,
      systemEventCount: boundaryEvents.length,
      userEventCount: userEvents.length,
      keyEvents: allSegmentEvents,
      geoSource: segmentGeoSource(!!segment.geometry?.length, "legacy_geojson"),
    });
    distanceCursor += segmentMeters;
  });

  return {
    kind: "legacy",
    tripId: String(args.trip.id),
    date: args.trip.date,
    overview: {
      title: tripLineSummary(args.trip, args.railwayData),
      totalDistanceKm: productSegments.reduce((sum, segment) => sum + segment.distanceKm, 0),
      eventTypeSummary: uniqueEventTypes(events),
      userEventCount: userBounds.length,
      systemEventCount: events.filter((event) => event.source === "system").length,
      segmentCount: productSegments.length,
    },
    segments,
    events: sortDetailEvents(events),
    geoSource: aggregateGeoSource(segments, "legacy_geojson"),
  };
}

function tripSegmentSystemEvents(
  segment: TripResultSegment,
  segmentIndex: number,
  segmentStartMeters: number,
): TripDetailEvent[] {
  return segment.events.map((event, eventIndex) => {
    const stationRef = eventStationRef(event);
    const stationMileage = stationRef ? segment.mileageProfile.stationMileage[stationRef] : undefined;
    return {
      id: `${segment.segmentId}:system:${eventIndex}`,
      source: "system",
      type: event.type,
      label: eventLabel(event),
      segmentIndex,
      distanceMeters: stationMileage ? segmentStartMeters + stationMileage.distanceMeters : undefined,
      timestamp: eventTimestamp(event),
      stationRef,
      stationName: stationRef ? stationNameForRef(segment, stationRef) : undefined,
      importance: isKeySystemEvent(event) ? "key" : "detail",
    };
  });
}

function railGraphBoundaryEvents(
  trip: TripResult,
  segment: TripResultSegment,
  segmentIndex: number,
  segmentStartMeters: number,
): TripDetailEvent[] {
  const events: TripDetailEvent[] = [];
  if (segmentIndex === 0) {
    events.push({
      id: `${segment.segmentId}:departure`,
      source: "system",
      type: "departure",
      label: segment.fromStation.name,
      segmentIndex,
      distanceMeters: segmentStartMeters,
      timestamp: trip.departureTime ?? segment.viaStations[0]?.departureTime ?? segment.viaStations[0]?.arrivalTime,
      stationRef: segment.fromStation.stationRef,
      stationName: segment.fromStation.name,
      importance: "key",
    });
  }
  if (segmentIndex === trip.segments.length - 1) {
    events.push({
      id: `${segment.segmentId}:arrival`,
      source: "system",
      type: "arrival",
      label: segment.toStation.name,
      segmentIndex,
      distanceMeters: segmentStartMeters + segment.mileageProfile.totalDistanceMeters,
      timestamp: trip.arrivalTime
        ?? segment.viaStations[segment.viaStations.length - 1]?.arrivalTime
        ?? segment.viaStations[segment.viaStations.length - 1]?.departureTime,
      stationRef: segment.toStation.stationRef,
      stationName: segment.toStation.name,
      importance: "key",
    });
  }
  return events;
}

function legacyBoundaryEvents(
  segment: ReturnType<typeof tripToProductSegments>[number],
  segmentIndex: number,
  segmentStartMeters: number,
): TripDetailEvent[] {
  const segmentMeters = Math.round(Math.max(0, segment.distanceKm) * 1000);
  return [{
    id: `${segment.id}:departure`,
    source: "system",
    type: segmentIndex === 0 ? "departure" : "transfer",
    label: segment.fromName || segment.fromId,
    segmentIndex,
    distanceMeters: segmentStartMeters,
    stationName: segment.fromName,
    importance: "key",
  }, {
    id: `${segment.id}:arrival`,
    source: "system",
    type: "arrival",
    label: segment.toName || segment.toId,
    segmentIndex,
    distanceMeters: segmentStartMeters + segmentMeters,
    stationName: segment.toName,
    importance: "key",
  }];
}

function boundUserEventToDetailEvent(bound: BoundMileageEvent, fallbackSegmentIndex: number): TripDetailEvent {
  return {
    id: `user:${bound.event.id}`,
    source: "user",
    type: "user_event",
    label: bound.event.title,
    segmentIndex: typeof bound.orderIndex === "number" ? bound.orderIndex : fallbackSegmentIndex,
    distanceMeters: bound.distanceMetersFromRunStart,
    timestamp: bound.timestamp,
    stationRef: bound.stationRef,
    importance: "key",
    diagnosticsCount: bound.diagnostics.length,
    userEventId: bound.event.id,
  };
}

function groupBoundEventsBySegment(events: readonly BoundMileageEvent[]): Map<number, BoundMileageEvent[]> {
  const map = new Map<number, BoundMileageEvent[]>();
  for (const event of events) {
    const index = typeof event.orderIndex === "number" ? event.orderIndex : 0;
    const current = map.get(index);
    if (current) current.push(event);
    else map.set(index, [event]);
  }
  return map;
}

function stopToDetailStop(stop: StationStop): TripDetailStop {
  return {
    stationRef: stop.station.stationRef,
    name: stop.station.name,
    stopType: stop.stopType,
    arrivalTime: stop.arrivalTime,
    departureTime: stop.departureTime,
    platformName: stop.platformName,
    platformNumber: stop.platformNumber,
  };
}

function eventLabel(event: TripEvent): string {
  if (event.type === "scenic") return event.title || event.label;
  if (event.type === "note") return event.text || event.label;
  return event.label;
}

function eventTimestamp(event: TripEvent): string | undefined {
  if (event.type === "stop") return event.departureTime ?? event.arrivalTime;
  if (event.type === "pass") return event.passTime;
  return event.timestamp;
}

function eventStationRef(event: TripEvent): EntityRef | undefined {
  if (event.type === "stop" || event.type === "pass") return event.stationRef;
  return undefined;
}

function stationNameForRef(segment: TripResultSegment, stationRef: EntityRef): string | undefined {
  return segment.viaStations.find((stop) => stop.station.stationRef === stationRef)?.station.name;
}

function isKeySystemEvent(event: TripEvent): boolean {
  return event.type === "transfer"
    || event.type === "scenic"
    || (event.type === "note" && event.source === "user");
}

function railGraphTripTitle(trip: TripResult): string {
  const labels = [...new Set(trip.segments.map((segment) => segment.lineLabel).filter(Boolean))];
  if (labels.length === 0) return trip.tripId;
  return labels.length > 2 ? `${labels.slice(0, 2).join(" / ")} +${labels.length - 2}` : labels.join(" / ");
}

function segmentGeoSource(hasGeometry: boolean, code: Exclude<TripDetailGeoSourceCode, "missing_geometry">): TripDetailGeoSource {
  return {
    code: hasGeometry ? code : "missing_geometry",
    hasGeometry,
    hasFallback: false,
    missingGeometryCount: hasGeometry ? 0 : 1,
  };
}

function aggregateGeoSource(
  segments: readonly TripDetailSegment[],
  code: Exclude<TripDetailGeoSourceCode, "missing_geometry">,
): TripDetailGeoSource {
  const missingGeometryCount = segments.filter((segment) => !segment.geoSource.hasGeometry).length;
  return {
    code: missingGeometryCount === segments.length && segments.length > 0 ? "missing_geometry" : code,
    hasGeometry: missingGeometryCount < segments.length,
    hasFallback: false,
    missingGeometryCount,
  };
}

function uniqueEventTypes(events: readonly TripDetailEvent[]): TripDetailEventType[] {
  return [...new Set(events.map((event) => event.type))];
}

function sortDetailEvents(events: readonly TripDetailEvent[]): TripDetailEvent[] {
  return [...events].sort((left, right) =>
    (left.distanceMeters ?? Number.POSITIVE_INFINITY) - (right.distanceMeters ?? Number.POSITIVE_INFINITY)
    || importanceRank(left.importance) - importanceRank(right.importance)
    || left.id.localeCompare(right.id)
  );
}

function importanceRank(value: TripDetailEventImportance): number {
  return value === "key" ? 0 : 1;
}
