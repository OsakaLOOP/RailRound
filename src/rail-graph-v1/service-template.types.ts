// ============================================================
// Rail Graph v1 — Confirmed Service Templates
// ============================================================

import type { DirectionLabel, EdgeMeasure, EntityRef, MeasureRange } from "./primitives";

export type ServiceType = "local" | "rapid" | "express" | "limited_express" | "freight" | "maintenance";
export type TopologyType = "linear" | "cyclic" | "branching";
export type StopType = "mandatory_stop" | "pass_through" | "conditional_stop";
export type OperationType = "coupling" | "decoupling" | "turnback" | "stabling";

export interface DirectionConvention {
  forwardLabel: string;
  reverseLabel: string;
  forwardDirection?: DirectionLabel;
  reverseDirection?: DirectionLabel;
}

export interface ServicePathSegment {
  orderIndex: number;
  edgeRef: EntityRef;
  fromNodeRef?: EntityRef;
  toNodeRef?: EntityRef;
  measureRange: MeasureRange;
  distanceMeters: number;
  geometryRef?: EntityRef;
  specialSectionRefs?: EntityRef[];
}

export interface ServiceStopEntry {
  orderIndex: number;
  passageType: "stop";
  stopType: "mandatory_stop" | "conditional_stop";
  stationRef: EntityRef;
  platformRef: EntityRef;
  edgeRef: EntityRef;
  stoppingPointRef: EntityRef;
  measure: EdgeMeasure;
  platformNumber?: number;
  platformName?: string;
  landmark?: boolean;
  operationType?: OperationType;
}

export interface ServicePassEntry {
  orderIndex: number;
  passageType: "pass";
  stopType: "pass_through";
  stationRef: EntityRef;
  edgeRef: EntityRef;
  platformRef?: EntityRef;
  measureRange?: MeasureRange;
  landmark?: boolean;
}

export type ServiceTraceEntry = ServiceStopEntry | ServicePassEntry;

/**
 * 已确认 service 模板。
 * 它是管理员确认后的精确运行模板，不是普通用户运行时的猜测空间。
 */
export interface ServicePattern {
  patternId: EntityRef;
  lineRef: EntityRef;
  systemRef: EntityRef;
  companyRef?: EntityRef;
  serviceType: ServiceType;
  topologyType: TopologyType;
  directionConvention: DirectionConvention;
  edgeSequence: EntityRef[];
  traceSequence: ServiceTraceEntry[];
  pathSegments: ServicePathSegment[];
  cycleCheck?: {
    isCycle: boolean;
    modularModulo: number;
  };
  displayName?: string;
  displayColor?: string;
}

export interface ServiceTemplateLayer {
  servicePatterns: ServicePattern[];
}
