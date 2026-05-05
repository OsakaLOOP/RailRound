// ============================================================
// Rail Graph v1 — Events & Timeline Types
// ============================================================

import type { EntityRef } from "./primitives";
import type { OperationType } from "./service-template.types";

export type EventAnchorKind = "scenic_view" | "user_defined" | "fixed_operation";

export interface EventAnchor {
  anchorId: EntityRef;
  kind: EventAnchorKind;
  geometryRef?: EntityRef;
  scenicView?: ScenicViewDefinition;
  userDefined?: UserDefinedEventPayload;
  fixedOperation?: {
    operationType: OperationType;
    stationRef?: EntityRef;
    platformRef?: EntityRef;
    stoppingPointRef?: EntityRef;
  };
}

export interface ScenicViewDefinition {
  mode: "directional_view" | "fixed_map_point";
  title?: string;
  description?: string;
  imageUrls?: string[];
  side?: "left" | "right" | "front" | "back" | "unknown";
  mapBearingDegrees?: number;
  angleRangeDegrees?: [number, number];
  distanceMeters?: number;
  radiusMeters?: number;
}

export interface UserDefinedEventPayload {
  eventKey: string;
  title?: string;
  description?: string;
  entityRefs?: EntityRef[];
  customData?: Record<string, unknown>;
}

export interface EventPolicy {
  policyId: EntityRef;
  scope: {
    stationRefs?: EntityRef[];
    edgeRefs?: EntityRef[];
    eventTypes?: RunEventType[];
  };
  action: "mandatory_stop" | "pass_through" | "auto" | "skip_event";
  priority?: number;
  reason?: string;
}

export type EventPolicyRef = string;

export interface RunOrder {
  orderPoints: OrderPoint[];
  boundaries: RunBoundary[];
}

export interface OrderPoint {
  orderIndex: number;
  entityRef: EntityRef;
  pointKind: "station" | "platform" | "stopping_point" | "switch" | "section_boundary" | "system_boundary";
}

export interface RunBoundary {
  boundaryIndex: number;
  kind: "switch" | "system_change" | "line_transfer";
  entityRefs: EntityRef[];
}

export interface TimelinePoint {
  orderIndex: number;
  timestamp?: string;
  isSynthesized: boolean;
  sourceAnchorRef?: string;
  inference?: "timetable" | "speed_distance" | "dwell_time" | "constant_spacing" | "manual";
}

export type RunEventType =
  | "platform_stop"
  | "platform_pass"
  | "switch_pass"
  | "special_section_pass"
  | "system_change"
  | "service_type_change"
  | "line_transfer"
  | "through_service"
  | "coupling_operation"
  | "decoupling_operation"
  | "scenic_view"
  | "user_defined";

export interface RunEvent {
  eventId: string;
  eventType: RunEventType;
  orderIndex: number;
  timestamp?: string;
  entityRefs: EntityRef[];
  payload?: Record<string, unknown>;
  source?: {
    rule?: string;
    anchorRef?: EntityRef;
  };
}

export interface ScenicViewResolution {
  anchorRef: EntityRef;
  orderIndex?: number;
  timestamp?: string;
  entityRefs: EntityRef[];
  geometryRef?: EntityRef;
  vehicleView?: {
    side: "left" | "right" | "front" | "back" | "unknown";
    relativeBearingDegrees: number;
    runDirectionBearingDegrees: number;
  };
}

export interface BoundUserEvent {
  anchorRef: EntityRef;
  orderIndex?: number;
  timestamp?: string;
  entityRefs: EntityRef[];
}
