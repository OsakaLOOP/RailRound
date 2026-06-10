// ============================================================
// Rail Graph v1 — GeoJSON Feature Annotation Schema
//
// 这一层定义"标注后的 GeoJSON Feature"的 schema。
// 标注后的 Feature 是 Layer 1 (BaseTopology) 的输入源,
// MVP 工具和后续 admin 编辑器都消费同一份 schema。
// ============================================================

import type { GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONGeometry } from "./geojson";
import type {
  PlatformType,
  TopologyEdgeRole,
  TraversalDirection,
  TrackDirectionRole,
  TrackFunctionalUse,
  TrackPhysicalKind,
} from "./base-topology.types";
import type { EdgeMeasure } from "./primitives";

/**
 * Feature 的语义类别。决定该 Feature 在编译期被解释为哪种 topo 实体。
 * - track_geometry:    编译为 TopologyEdge
 * - station_point:     编译为 Station
 * - platform_area:     编译为 Platform
 * - signal_point:      编译为 Signal (不参与寻径)
 * - station_entrance:  车站出入口 (Point), 仅 UI/可视用, 不参与寻径
 * - switch_point:      将编译为 junction TopologyNode (MVP 阶段尚未实现)
 * - special_section:   将编译为 SpecialSection (MVP 阶段尚未实现)
 * - unknown:           未标注, 编译期跳过并发 warn
 */
export type RailGraphFeatureKind =
  | "track_geometry"
  | "station_point"
  | "platform_area"
  | "signal_point"
  | "station_entrance"
  | "switch_point"
  | "special_section"
  | "unknown";

/**
 * 股道 annotation. 所有"角色维度"必须显式声明,
 * 编译期不得从位置或 binding 状态反推。
 */
export interface RailGraphTrackAnnotation {
  /** 旧的一维 role 标签, 保留作过渡。新代码优先使用三维显式声明。 */
  role: TopologyEdgeRole;
  traversal: TraversalDirection;
  name?: string;
  trackCode?: string;
  physicalKind?: TrackPhysicalKind;
  functionalUse?: TrackFunctionalUse[];
  directionRole?: TrackDirectionRole;
  geometryReversed?: boolean;
}

export interface RailGraphStationAnnotation {
  name: string;
}

/**
 * 车站出入口 annotation (subway_entrance / train_station_entrance / station_entrance).
 * stationRef 可选: 若 OSM 数据有 nearest_station 字段, ingest 时会反查 LOD station 填入.
 * 不参与寻径与编译, 仅作 UI / 地图可视化的辅助.
 */
export interface RailGraphStationEntranceAnnotation {
  stationRef?: string;
  name?: string;
  /** 出入口编号 (例: "A1" / "南口" / "北口"), 来自 OSM ref 标签. */
  ref?: string;
}

export interface RailGraphPlatformAnnotation {
  stationRef?: string;
  name?: string;
  number?: number;
  /** 必须显式声明; 缺失编译期发 warn 但 fallback 为 "unknown"。 */
  type?: PlatformType;
}

/**
 * 信号机 annotation. edgeRef + measure 必须显式提供 (MVP 不空间投影)。
 * geometry 可为 Point (供地图可视化定位 fallback), 但编译期以 edgeRef + measure 为准。
 */
export interface RailGraphSignalAnnotation {
  edgeRef: string;
  measure: EdgeMeasure;
  facing: "forward" | "reverse" | "both";
  name?: string;
}

/**
 * 写入 Feature.properties.railGraph 的标注。
 */
export interface RailGraphAnnotation {
  kind: RailGraphFeatureKind;
  schemaVersion: "rail-graph-v1";
  /** 稳定 ID, 应能跨编辑会话保持一致。 */
  id: string;
  /** 来源标识, 例如 "manual", "demo", "orm:ja-jr-east"。 */
  source: string;
  track?: RailGraphTrackAnnotation;
  station?: RailGraphStationAnnotation;
  platform?: RailGraphPlatformAnnotation;
  signal?: RailGraphSignalAnnotation;
  entrance?: RailGraphStationEntranceAnnotation;
  preSplitOriginalId?: string;
  preSplitStartMeasure?: number;
  preSplitEndMeasure?: number;
}

/**
 * 标注后的 Feature.properties。`railGraph` 字段是核心,
 * 其余字段 (例如 name) 是 GeoJSON 透传。
 */
export type AnnotatedFeatureProperties = Record<string, unknown> & {
  railGraph?: RailGraphAnnotation;
  name?: string;
};

export type AnnotatedFeature = GeoJSONFeature<GeoJSONGeometry, AnnotatedFeatureProperties>;
export type AnnotatedFeatureCollection = GeoJSONFeatureCollection<GeoJSONGeometry, AnnotatedFeatureProperties>;
