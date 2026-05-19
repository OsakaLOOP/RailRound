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

/**
 * 股道的物理身份。与运用功能 (functionalUse) 和方向角色 (directionRole) 正交。
 * - main:   正线 (本線) — 区间线路在站内的延续
 * - siding: 到发线 (副本線/到発線) — 列车到达/始发停车用
 * - yard:   段管线 — 机务段/动车段内股道
 * - lead:   牵出线 — 调车作业用
 * - safety: 安全线 — 防止列车冲撞用的尽头线
 */
export type TrackPhysicalKind = "main" | "siding" | "yard" | "lead" | "safety";

/**
 * 股道的运用功能。一条 edge 可同时具有多个功能。
 * - through:  通过运用 — 列车直接驶过, 不停车
 * - stopping: 停车运用 — 列车在此停靠
 * - passing:  越行运用 — 快车从此越过停车的慢车
 * - turnback: 折返运用 — 列车在此折返
 * - storage:  留置运用 — 列车在此停留待发
 *
 * 编译期不得从 binding 状态或位置反推此字段。
 */
export type TrackFunctionalUse = "through" | "stopping" | "passing" | "turnback" | "storage";

/**
 * 股道的方向角色。表达"运行方向归属", 与"主/副线"正交 (后者由 physicalKind 表达)。
 *
 * - up:            仅上行单向运行
 * - down:          仅下行单向运行
 * - bidirectional: 双向可运行 — 不同列车不同时刻可走任一方向, **但不允许同一列车换向**
 *                  典型: 道岔联络 connector, 单线区间, 站间双向使用线
 * - reversible:    在 bidirectional 基础上**额外允许列车在此换向**
 *                  即 reversible ⊃ bidirectional (蕴含双向可运行能力)
 *                  典型: 国铁型中线, 折返线, 尽头型站台股道
 *
 * 与 functionalUse 的关系: functionalUse 含 "turnback" 表达"在此换向是确认的运用",
 * 与 directionRole=reversible 一起声明 (互为校验)。compile 期若 functionalUse 含
 * turnback 但 directionRole !== reversible, 发 warn (但仍允许)。
 */
export type TrackDirectionRole = "up" | "down" | "bidirectional" | "reversible";

/** 固定 topo 节点。站不是 node；站由 Station/Platform/Binding 表达。 */
export interface TopologyNode {
  id: EntityRef;
  kind: TopologyNodeKind;
  name?: string;
  geometryRef?: EntityRef;
  properties?: {
    mileageKm?: number;
  };
  /**
   * 透传的原始数据源标签 (OSM tags, KSJ 属性, etc)。
   * 仅用于调试 / UI 展示 / 后续推导;
   * **不得**直接驱动寻径或编译期决策 (那些应靠 physicalKind / functionalUse 等显式字段)。
   */
  sourceTags?: Record<string, string>;
}

/** 固定 topo 边。edge 是站线级循迹、里程和 GeoJSON 拼接的基础单位。 */
export interface TopologyEdge {
  id: EntityRef;
  fromNodeRef: EntityRef;
  toNodeRef: EntityRef;
  traversal: TraversalDirection;
  /**
   * 旧的一维角色标签。保留作过渡, 新代码应优先使用
   * physicalKind / functionalUse / directionRole 三个独立维度。
   */
  role: TopologyEdgeRole;
  name?: string;
  trackCode?: string;
  geometryRef?: EntityRef;
  lengthMeters: number;
  coordinates?: [number, number][];
  sourceSlice?: SourceGeometrySlice;
  /** 物理身份。必须由 annotation 显式声明, 不得反推。 */
  physicalKind?: TrackPhysicalKind;
  /** 运用功能, 多值。必须由 annotation 显式声明, 不得从 binding 状态反推。 */
  functionalUse?: TrackFunctionalUse[];
  /** 方向角色。编译期据此自动聚合 DoubleTrackPair。 */
  directionRole?: TrackDirectionRole;
  properties?: {
    gauge?: number;
    electrified?: boolean;
    maxSpeedKmh?: number;
  };
  /** 同 TopologyNode.sourceTags — 透传 OSM / KSJ / 其他原始数据源 tags, 仅调试 / UI 用。 */
  sourceTags?: Record<string, string>;
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

/**
 * 站台。MVP 阶段不为岛式站台拆分独立的 face 实体, 而是用同一 platformRef
 * 上的两条 PlatformTrackBinding (side=left + side=right) 表达双面靠车。
 *
 * type 必须由 annotation 显式声明; 编译期不得从几何或 binding 推断,
 * 缺失时发 warn 但 fallback 为 "unknown"。
 */
export interface Platform {
  id: EntityRef;
  stationRef: EntityRef;
  type: PlatformType;
  name?: string;
  number?: number;
  areaRef?: EntityRef;
}

/**
 * 站台与股道的固定绑定。没有 binding 的 edge 不能被推断为可停靠站线,
 * 也不能被反推为越行/通过线 — edge 的功能必须由 TopologyEdge.functionalUse
 * 显式声明, 与有无 binding 无关。
 *
 * 岛式站台 (Platform.type = "island") 通过同一 platformRef 的两条 binding
 * 来表达两个靠车面: 一条 side=left + 一条 side=right, 各服务一条相邻 edge。
 */
export interface PlatformTrackBinding {
  id: EntityRef;
  stationRef: EntityRef;
  platformRef: EntityRef;
  edgeRef: EntityRef;
  /**
   * 站台相对于该 edge 的方位。
   *
   * 参考系 (不变量): 沿 edge.fromNodeRef → edge.toNodeRef 方向观察,
   *   left  = 站台位于 edge 行进方向的左侧
   *   right = 站台位于 edge 行进方向的右侧
   *   both  = 同一站台在 edge 两侧均有靠车面 (罕见, 例如折返岛)
   *   unknown = 尚未确认
   *
   * 与列车运行方向 (servingDirection: up/down) 无关。
   * 与 annotation 编辑顺序无关。
   *
   * 不变量: 当 edge 的几何被反向重建 (fromNodeRef ↔ toNodeRef 互换) 时,
   * 所有引用该 edge 的 binding 必须同步翻转 left ↔ right。
   * 此翻转不会改变 servingDirection。
   */
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

/**
 * 信号机。固定的 topo 注解, 不参与寻径硬约束 (MVP), 仅作可视化与诊断。
 *
 * facing 含义:
 * - "forward": 控制沿 edge.fromNodeRef → edge.toNodeRef 方向行进的列车
 * - "reverse": 控制沿 to → from 方向行进的列车 (适用于 bidirectional / reversible edge)
 * - "both":    双向都控制 (例如出于简化, 或者真实双面信号机)
 *
 * 信号机必须设在道岔外 (即在 main edge 的延伸段 / 站间联络段上, 而非道岔位置)。
 * MVP 不做空间投影, edgeRef + measure 必须由 annotation 显式提供。
 */
export interface Signal {
  id: EntityRef;
  edgeRef: EntityRef;
  measure: EdgeMeasure;
  facing: "forward" | "reverse" | "both";
  name?: string;
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
  signals: Signal[];
  specialSections: SpecialSection[];
  doubleTrackPairs: DoubleTrackPair[];
  relations: BaseTopologyRelation[];
  hardConstraints: TopologyHardConstraint[];
}
