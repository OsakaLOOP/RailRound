import type {
  BoundMileageEvent,
  MileagePlaceQuery,
  MileageProjectionContext,
  MileageRunPathLike,
  UserEventV2,
} from "../rail-graph-v1/mileage-event.types";
import {
  compareBoundMileageEvents,
  projectEventToRunPath,
  queryEventsByMileage,
  queryEventsByTime,
  queryEventsNearPlace,
} from "../rail-graph-v1/mileage-events";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { RailwayLine, RailwayMap, Station } from "../store";

export interface AppMileageLineContext {
  lineKey: string;
  line: RailwayLine;
  context: MileageProjectionContext;
  runPath: MileageRunPathLike;
  totalMeters: number;
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

export function createMileageEventFromStation(args: {
  lineContext: AppMileageLineContext;
  stationId: string;
  title: string;
  body?: string;
}): UserEventV2 | null {
  const stationRef = appStationRef(args.lineContext.lineKey, args.stationId);
  const station = args.lineContext.context.stationMileage[stationRef];
  if (!station) return null;
  const now = new Date().toISOString();
  return {
    schemaVersion: "mileage-user-event-v1",
    id: `app:event:${slug(args.lineContext.lineKey)}:${slug(args.stationId)}:${Date.now().toString(36)}` as EntityRef,
    kind: "user_note",
    title: args.title.trim() || "Mileage event",
    body: args.body?.trim() || undefined,
    mileage: {
      systemRef: args.lineContext.context.systemRef,
      lineRef: args.lineContext.context.lineRef,
      distanceMeters: station.distanceMeters,
    },
    visibility: "private",
    payload: {
      createdFrom: "station",
      stationRef,
      stationId: args.stationId,
      lineKey: args.lineContext.lineKey,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createMileageEventAtDistance(args: {
  lineContext: AppMileageLineContext;
  distanceMeters: number;
  title: string;
  body?: string;
}): UserEventV2 {
  const now = new Date().toISOString();
  return {
    schemaVersion: "mileage-user-event-v1",
    id: `app:event:${slug(args.lineContext.lineKey)}:${Math.round(args.distanceMeters)}:${Date.now().toString(36)}` as EntityRef,
    kind: "user_note",
    title: args.title.trim() || "Mileage event",
    body: args.body?.trim() || undefined,
    mileage: {
      systemRef: args.lineContext.context.systemRef,
      lineRef: args.lineContext.context.lineRef,
      distanceMeters: Math.max(0, Math.min(args.lineContext.totalMeters, args.distanceMeters)),
    },
    visibility: "private",
    payload: {
      createdFrom: "mileage",
      lineKey: args.lineContext.lineKey,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function eventsForLine(events: readonly UserEventV2[], lineContext: AppMileageLineContext): BoundMileageEvent[] {
  return events
    .map((event) => projectEventToRunPath(event, lineContext.runPath, lineContext.context))
    .filter((event): event is BoundMileageEvent => event !== null)
    .sort(compareBoundMileageEvents);
}

export function queryLineEventsByStation(args: {
  events: readonly UserEventV2[];
  lineContext: AppMileageLineContext;
  stationId: string;
  radiusMeters: number;
}) {
  const stationRef = appStationRef(args.lineContext.lineKey, args.stationId);
  return queryEventsNearPlace(args.events, { stationRef }, args.lineContext.context, args.radiusMeters);
}

export function queryLineEventsByMileage(args: {
  events: readonly UserEventV2[];
  lineContext: AppMileageLineContext;
  fromMeters: number;
  toMeters: number;
}) {
  return queryEventsByMileage(args.events, {
    systemRef: args.lineContext.context.systemRef,
    lineRef: args.lineContext.context.lineRef,
    fromMeters: args.fromMeters,
    toMeters: args.toMeters,
  });
}

export function queryLineEventsByTime(args: {
  events: readonly UserEventV2[];
  lineContext: AppMileageLineContext;
  fromTime: string;
  toTime: string;
}) {
  return queryEventsByTime(args.events, args.lineContext.context.timeline, args.lineContext.context, {
    fromTime: normalizeTimeInput(args.fromTime),
    toTime: normalizeTimeInput(args.toTime),
  });
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
