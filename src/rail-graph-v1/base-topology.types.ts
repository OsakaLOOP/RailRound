// ============================================================
// Rail Graph v1 — Layer 1: Fixed Base Topology
// ============================================================

import type { DirectionLabel, EdgeMeasure, EntityRef } from "./primitives";

export type TopologyNodeKind =
  | "junction"
  | "line_endpoint"
  | "split_boundary"
  | "key_point";

export type TopologyEdgeRole =
  | "main"
  | "platform"
  | "passing"
  | "connector"
  | "storage"
  | "yard";

export type TraversalDirection = "both" | "forward";

/** 固定 topo 节点。站不是 node；站由 Station/Platform/Binding 表达。 */
export interface TopologyNode {
  id: EntityRef;
  kind: TopologyNodeKind;
  name?: string;
  geometryRef?: EntityRef;
  properties?: {
    mileageKm?: number;
  };
}

/** 固定 topo 边。edge 是站线级循迹、里程和 GeoJSON 拼接的基础单位。 */
export interface TopologyEdge {
  id: EntityRef;
  fromNodeRef: EntityRef;
  toNodeRef: EntityRef;
  traversal: TraversalDirection;
  role: TopologyEdgeRole;
  name?: string;
  trackCode?: string;
  geometryRef?: EntityRef;
  lengthMeters: number;
  sourceSlice?: SourceGeometrySlice;
  properties?: {
    gauge?: number;
    electrified?: boolean;
    maxSpeedKmh?: number;
  };
}

export interface SourceGeometrySlice {
  sourceFeatureRef: string;
  multiLineIndex?: number;
  startMeasure?: EdgeMeasure;
  endMeasure?: EdgeMeasure;
  stitchGroupRef?: EntityRef;
}

export interface GraphAdjacency {
  /** nodeRef -> 可出发的 edgeRef[] */
  outEdges: Record<string, EntityRef[]>;
  /** nodeRef -> 可到达的 edgeRef[] */
  inEdges: Record<string, EntityRef[]>;
}

export interface Station {
  id: EntityRef;
  name: string;
  nameJa?: string;
  platformRefs: EntityRef[];
  stationAreaRef?: EntityRef;
  positionRef?: EntityRef;
}

export type PlatformType = "side" | "island" | "bay" | "unknown";

export interface Platform {
  id: EntityRef;
  stationRef: EntityRef;
  type: PlatformType;
  name?: string;
  number?: number;
  areaRef?: EntityRef;
}

/** 站台与股道的固定绑定。没有 binding 的 platform edge 不能被当作可停靠站线。 */
export interface PlatformTrackBinding {
  id: EntityRef;
  stationRef: EntityRef;
  platformRef: EntityRef;
  edgeRef: EntityRef;
  side: "left" | "right" | "both" | "unknown";
  servingDirection?: DirectionLabel;
}

/**
 * 停车标是固定 topo 事实，不是路径生成启发式。
 * 候选可自动生成，但进入 topo 前必须已筛选/确认。
 */
export interface StoppingPoint {
  id: EntityRef;
  stationRef: EntityRef;
  platformRef: EntityRef;
  edgeRef: EntityRef;
  direction: "up" | "down" | "both";
  measure: EdgeMeasure;
  confirmation: "confirmed" | "imported_confirmed";
}

export type SpecialSectionCategory = "bridge" | "tunnel" | "viaduct" | "cutting" | "other";
export type DirectionSeparation = "none" | "up_down_split" | "multi_bore" | "unknown";

export interface SpecialSection {
  id: EntityRef;
  category: SpecialSectionCategory;
  directionSeparation: DirectionSeparation;
  name?: string;
  edgeRefs: EntityRef[];
  geometryRef?: EntityRef;
}

export type BaseTopologyRelationKind =
  | "station_contains_platform"
  | "platform_serves_track"
  | "source_geometry_slice"
  | "transfer";

export interface BaseTopologyRelation {
  id: EntityRef;
  kind: BaseTopologyRelationKind;
  fromRef: EntityRef;
  toRef: EntityRef;
  payload?: Record<string, unknown>;
}

/**
 * 硬性拓扑约束: 只能表达不可变或经人工确认的基础约束。
 * avoid / prefer / score 等路径生成偏好不放在这里。
 */
export interface TopologyHardConstraint {
  id: EntityRef;
  kind: "forbid_traversal" | "forbid_transition" | "require_binding" | "closed_edge";
  targetRefs: EntityRef[];
  reason?: string;
}

export interface DoubleTrackPair {
  id: EntityRef;
  upEdgeRefs: EntityRef[];
  downEdgeRefs: EntityRef[];
  sharedGeometryEdgeRefs?: EntityRef[];
  confirmation: "confirmed" | "imported_confirmed";
}

export interface BaseTopologyLayer {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  adjacency: GraphAdjacency;
  stations: Station[];
  platforms: Platform[];
  platformTrackBindings: PlatformTrackBinding[];
  stoppingPoints: StoppingPoint[];
  specialSections: SpecialSection[];
  doubleTrackPairs: DoubleTrackPair[];
  relations: BaseTopologyRelation[];
  hardConstraints: TopologyHardConstraint[];
}
