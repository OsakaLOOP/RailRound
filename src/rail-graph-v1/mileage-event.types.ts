// ============================================================
// Rail Graph v1 - Mileage-Centric User Events
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type { GeoJSONPosition } from "./geojson";
import type { DirectionLabel, EdgeMeasure, EntityRef, ISODateTime } from "./primitives";

export type MileageUserEventKind =
  | "user_note"
  | "scenic"
  | "warning"
  | "operation_hint"
  | "custom";

export type MileageUserEventVisibility = "private" | "shared" | "public";

export type MileageTimestampInference = "timeline" | "linear" | "unknown";

export type ScenicFacing = "left" | "right" | "front" | "back";
export type ScenicViewpointSource =
  | "system_anchor"
  | "user_explicit"
  | "inferred_from_route"
  | "inferred_from_geojson";
export type ScenicVisibilityStatus =
  | "visible"
  | "opposite_side"
  | "angle_mismatch"
  | "unknown"
  | "unavailable";

export interface ScenicVisibilityConstraint {
  targetBearingDegrees?: number;
  visibleBearingRangeDegrees?: [number, number];
  angleToleranceDegrees?: number;
  distanceMeters?: number;
}

export interface ScenicViewpointPayload {
  facing: ScenicFacing;
  coordinates?: GeoJSONPosition;
  targetBearingDegrees?: number;
  visibleBearingRangeDegrees?: [number, number];
  constraint?: ScenicVisibilityConstraint;
  source: ScenicViewpointSource;
  confidence?: number;
  diagnostics?: Diagnostic[];
}

export interface ScenicVisibilityResolution {
  status: ScenicVisibilityStatus;
  facing?: ScenicFacing;
  runDirectionBearingDegrees?: number;
  targetBearingDegrees?: number;
  relativeBearingDegrees?: number;
  confidence: number;
  diagnostics: Diagnostic[];
}

export interface UserEventV2Payload extends Record<string, unknown> {
  viewpoint?: ScenicViewpointPayload;
}

export interface MileageRef {
  systemRef: EntityRef;
  lineRef?: EntityRef;
  patternRef?: EntityRef;
  direction?: DirectionLabel;
  /** Meters from the stable mileage origin of the owning system/line/pattern. */
  distanceMeters: number;
}

export interface MileageRange {
  startMeters: number;
  endMeters: number;
}

export interface UserEventV2 {
  schemaVersion: "mileage-user-event-v1";
  id: EntityRef;
  kind: MileageUserEventKind;
  title: string;
  body?: string;
  mileage: MileageRef;
  range?: MileageRange;
  visibility: MileageUserEventVisibility;
  tags?: string[];
  payload?: UserEventV2Payload;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface BoundMileageEvent {
  event: UserEventV2;
  /** Meters from the selected run/path start after projection. */
  distanceMetersFromRunStart: number;
  orderIndex?: number;
  timestamp?: ISODateTime;
  timestampInference: MileageTimestampInference;
  stationRef?: EntityRef;
  edgeRef?: EntityRef;
  coordinates?: GeoJSONPosition;
  diagnostics: Diagnostic[];
  scenicVisibility?: ScenicVisibilityResolution;
}

export interface MileageEdgeSpan {
  edgeRef: EntityRef;
  startMeters: number;
  endMeters: number;
  coordinates?: GeoJSONPosition[];
}

export interface MileageStationPoint {
  stationRef: EntityRef;
  distanceMeters: number;
  coordinates?: GeoJSONPosition;
  name?: string;
}

export interface MileageTimelinePoint {
  distanceMeters: number;
  timestamp: ISODateTime;
}

export interface LinearMileageTimeRange {
  startTime: ISODateTime;
  endTime: ISODateTime;
  startMeters: number;
  endMeters: number;
}

export interface MileageProjectionContext {
  systemRef: EntityRef;
  lineRef?: EntityRef;
  patternRef?: EntityRef;
  direction?: DirectionLabel;
  edgeMileage: Record<string, MileageEdgeSpan>;
  stationMileage: Record<string, MileageStationPoint>;
  timeline?: MileageTimelinePoint[];
  linearTimeRange?: LinearMileageTimeRange;
}

export interface MileageRunPathLike {
  systemRef?: EntityRef;
  lineRef?: EntityRef;
  patternRef?: EntityRef;
  direction?: DirectionLabel;
  edgeSequence: EntityRef[];
  stationSequence?: EntityRef[];
}

export interface MileageQueryWindow {
  systemRef: EntityRef;
  lineRef?: EntityRef;
  patternRef?: EntityRef;
  fromMeters: number;
  toMeters: number;
}

export interface MileagePlaceQuery {
  systemRef?: EntityRef;
  lineRef?: EntityRef;
  patternRef?: EntityRef;
  stationRef?: EntityRef;
  edgeRef?: EntityRef;
  edgeMeasure?: EdgeMeasure;
  coordinates?: GeoJSONPosition;
  distanceMeters?: number;
}

export interface ResolvedMileagePlace {
  mileage: MileageRef;
  coordinates?: GeoJSONPosition;
  stationRef?: EntityRef;
  edgeRef?: EntityRef;
  method: "mileage" | "station" | "edge" | "coordinates";
  diagnostics: Diagnostic[];
}

export interface MileageTimeQuery {
  fromTime: ISODateTime;
  toTime: ISODateTime;
}

export interface LegacyAnchoredUserEvent {
  id: EntityRef;
  kind: "user_defined";
  title: string;
  payload?: Record<string, unknown>;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
  anchor:
    | { kind: "station"; stationRef: EntityRef }
    | { kind: "edge"; edgeRef: EntityRef; measure: EdgeMeasure };
}
