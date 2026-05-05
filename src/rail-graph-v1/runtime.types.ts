// ============================================================
// Rail Graph v1 — Runtime Spec / Resolved Path Types
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type { GeoJSONLineString, GeoJSONPosition } from "./geojson";
import type { DirectionLabel, EdgeMeasure, EntityRef, MeasureRange } from "./primitives";
import type { EventPolicyRef } from "./event.types";
import type { ServicePathSegment, ServiceTraceEntry } from "./service-template.types";

export interface RunSpec {
  systemId: string;
  patternRef: EntityRef;
  startStationRef: EntityRef;
  endStationRef: EntityRef;
  viaRefs?: EntityRef[];
  directionHint?: DirectionLabel;
  timetableAnchors?: TimetableAnchor[];
  eventPolicy?: EventPolicyRef[];
  /** 仅管理员/debug 使用；普通用户运行不靠 override 猜测路径。 */
  pathOverride?: ManualPathOverride;
}

export interface ManualPathOverride {
  edgeSequence: EntityRef[];
  traceSequence?: ServiceTraceEntry[];
}

export interface TimetableAnchor {
  stationRef: EntityRef;
  arrivalTime?: string;
  departureTime?: string;
  dwellSeconds?: number;
}

export interface RunPath {
  patternRef: EntityRef;
  edgeSequence: EntityRef[];
  traceSequence: ServiceTraceEntry[];
  pathSegments: ServicePathSegment[];
  chosenDirection: string;
  resolvedBy: "confirmed_template" | "manual_override" | "admin_generated";
  loopDecision?: LoopDecision;
}

export interface LoopDecision {
  isLoopRun: boolean;
  viaRefUsed?: EntityRef;
  directionSource: "explicit" | "via_inference" | "template_default";
  fullCycleDistanceMeters: number;
  chosenDistanceMeters: number;
  alternativeDistanceMeters?: number;
}

export interface ResolvedGeoJsonPath {
  pathId: string;
  sourceGraphId: string;
  patternRef: EntityRef;
  direction: DirectionLabel;
  geometry: GeoJSONLineString;
  segments: ResolvedGeoJsonPathSegment[];
  stationPassages: ResolvedStationPassage[];
  semanticRefs: ResolvedPathSemanticRef[];
  totalDistanceMeters: number;
  diagnostics: Diagnostic[];
}

export interface ResolvedGeoJsonPathSegment {
  orderIndex: number;
  edgeRef: EntityRef;
  geometry: GeoJSONLineString;
  measureRange: MeasureRange;
  distanceMeters: number;
  stationRef?: EntityRef;
  platformRef?: EntityRef;
  stoppingPointRef?: EntityRef;
  specialSectionRefs?: EntityRef[];
}

export interface ResolvedStationPassage {
  orderIndex: number;
  passageType: "stop" | "pass";
  stationRef: EntityRef;
  edgeRef: EntityRef;
  platformRef?: EntityRef;
  stoppingPointRef?: EntityRef;
  distanceMetersFromStart: number;
  arrivalTime?: string;
  departureTime?: string;
}

export interface ResolvedPathSemanticRef {
  kind: "station" | "platform" | "stopping_point" | "special_section" | "operation" | "event_anchor";
  entityRef: EntityRef;
  segmentIndex?: number;
  orderIndex?: number;
  payload?: Record<string, unknown>;
}

export interface RenderGeometryPlan {
  geometrySource: "physical_edges" | "dynamic_offset" | "mixed";
  stitchedEdgeRefs: EntityRef[];
  offsetSegments: OffsetGeometrySegment[];
  smoothing: OffsetSmoothingPlan[];
  diagnostics: Diagnostic[];
}

export interface OffsetGeometrySegment {
  edgeRef: EntityRef;
  offsetMeters: number;
  offsetSide: "left" | "right";
  startMeasure: EdgeMeasure;
  endMeasure: EdgeMeasure;
}

export interface OffsetSmoothingPlan {
  startMeasure: EdgeMeasure;
  endMeasure: EdgeMeasure;
  joinStrategy: "bezier" | "arc" | "linear_blend";
  transitionMeters: number;
  controlPoints?: GeoJSONPosition[];
}
