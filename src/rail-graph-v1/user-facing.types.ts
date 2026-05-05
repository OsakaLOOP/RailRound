// ============================================================
// Rail Graph v1 — User-Facing Result Types
// ============================================================

import type { RunEventType } from "./event.types";
import type { GeoJSONLineString, GeoJSONPosition } from "./geojson";
import type { DirectionLabel, EntityRef } from "./primitives";
import type { ResolvedGeoJsonPath, RunPath } from "./runtime.types";
import type { ServiceType } from "./service-template.types";

export type RouteFingerprint = string;

export interface TripResult {
  tripId: string;
  presetId?: string;
  planUsed: "preset" | "confirmed_template" | "admin_override";
  segments: TripResultSegment[];
  totalDistanceKm: number;
  totalTimeMinutes: number;
  routeFingerprint: RouteFingerprint;
  departureTime?: string;
  arrivalTime?: string;
  timeOfDay?: "morning" | "afternoon" | "evening" | "night";
  eventTypeSummary: RunEventType[];
  internalRunPaths: RunPath[];
}

export interface TripResultSegment {
  lineRef: EntityRef;
  patternRef: EntityRef;
  systemRef: EntityRef;
  companyRef?: EntityRef;
  lineLabel: string;
  displayColor: string;
  serviceType: ServiceType;
  direction: DirectionLabel;
  fromStation: StationMeta;
  toStation: StationMeta;
  viaStations: StationStop[];
  landmarkLabel?: string;
  distanceKm: number;
  timeMinutes: number;
  resolvedPath: ResolvedGeoJsonPath;
  geometry: GeoJSONLineString;
  events: TripEvent[];
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
