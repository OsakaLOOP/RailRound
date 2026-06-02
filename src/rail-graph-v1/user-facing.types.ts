// ============================================================
// Rail Graph v1 — User-Facing Result Types
// ============================================================

import type { GeoJSONLineString, GeoJSONPosition } from "./geojson";
import type {
  BoundMileageEvent,
  LinearMileageTimeRange,
  MileageEdgeSpan,
  MileageStationPoint,
  MileageTimelinePoint,
} from "./mileage-event.types";
import type { DirectionLabel, EntityRef } from "./primitives";
import type { ResolvedGeoJsonPath, RunPath } from "./runtime.types";
import type { ServiceType } from "./service-template.types";

export type RouteFingerprint = string;

export interface TripResult {
  tripId: string;
  presetId?: string;
  planUsed: "preset" | "auto" | "admin_override";
  segments: TripResultSegment[];
  totalDistanceKm: number;
  totalTimeMinutes: number;
  routeFingerprint: RouteFingerprint;
  departureTime?: string;
  arrivalTime?: string;
  timeOfDay?: "morning" | "afternoon" | "evening" | "night";
  eventTypeSummary: TripEvent["type"][];
}

export interface TripResultSegment {
  segmentId: string;
  lineLabel: string;
  displayColor: string;
  fromStation: StationMeta;
  toStation: StationMeta;
  viaStations: StationStop[];
  landmarkLabel?: string;
  distanceKm: number;
  timeMinutes: number;
  geometry: GeoJSONLineString;
  mileageProfile: TripSegmentMileageProfile;
  events: TripEvent[];
  mileageEvents?: BoundMileageEvent[];
}

/**
 * Product-facing mileage projection data. This is safe to persist with a trip
 * and powers user-created mileage events without exposing RunPath or
 * ResolvedGeoJsonPath internals.
 */
export interface TripSegmentMileageProfile {
  systemRef: EntityRef;
  lineRef?: EntityRef;
  patternRef?: EntityRef;
  companyRef?: EntityRef;
  serviceType?: ServiceType;
  direction?: DirectionLabel;
  totalDistanceMeters: number;
  edgeSequence: EntityRef[];
  stationSequence: EntityRef[];
  edgeMileage: Record<string, MileageEdgeSpan>;
  stationMileage: Record<string, MileageStationPoint>;
  timeline?: MileageTimelinePoint[];
  linearTimeRange?: LinearMileageTimeRange;
}

/**
 * Internal adapter/debug companion for callers that need to bridge current app
 * structures while keeping TripResult itself product-facing.
 */
export interface TripRuntimeArtifacts {
  tripId: string;
  graphId: string;
  runId: string;
  routeFingerprint: RouteFingerprint;
  segments: TripSegmentRuntimeArtifacts[];
}

export interface TripSegmentRuntimeArtifacts {
  segmentId: string;
  segmentIndex: number;
  systemRef: EntityRef;
  lineRef: EntityRef;
  patternRef: EntityRef;
  companyRef?: EntityRef;
  serviceType: ServiceType;
  direction: DirectionLabel;
  runPath: RunPath;
  resolvedPath: ResolvedGeoJsonPath;
}

export interface StationStop {
  station: StationMeta;
  stopType: "stop" | "pass";
  platformRef?: EntityRef;
  stoppingPointRef?: EntityRef;
  platformNumber?: number;
  platformName?: string;
  arrivalTime?: string;
  departureTime?: string;
}

export interface StationMeta {
  stationRef: EntityRef;
  name: string;
  nameJa?: string;
  coordinates: GeoJSONPosition;
  landmark?: boolean;
}

export type TripEvent =
  | TripStopEvent
  | TripPassEvent
  | TripTransferEvent
  | TripScenicEvent
  | TripNoteEvent;

export interface TripStopEvent {
  type: "stop";
  source: "system" | "timetable";
  stationRef: EntityRef;
  platformRef?: EntityRef;
  stoppingPointRef?: EntityRef;
  label: string;
  arrivalTime?: string;
  departureTime?: string;
  durationMinutes?: number;
  platformNumber?: number;
  platformName?: string;
}

export interface TripPassEvent {
  type: "pass";
  source: "system" | "timetable";
  stationRef: EntityRef;
  platformRef?: EntityRef;
  label: string;
  passTime?: string;
}

export interface TripTransferEvent {
  type: "transfer";
  source: "transfer";
  label: string;
  timestamp?: string;
  fromLine?: string;
  toLine?: string;
  transferMode?: "alight" | "through";
  walkMinutes?: number;
}

export interface TripScenicEvent {
  type: "scenic";
  source: "system" | "user";
  label: string;
  timestamp?: string;
  title?: string;
  description?: string;
  imageUrls?: string[];
  viewSide?: "left" | "right" | "front" | "back";
}

export interface TripNoteEvent {
  type: "note";
  source: "user";
  label: string;
  timestamp?: string;
  text?: string;
  imageUrls?: string[];
}
