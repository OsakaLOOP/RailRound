// ============================================================
// Rail Graph v1 — Graph Containers
// ============================================================

import type {
  BaseTopologyLayer,
  Platform,
  SpecialSection,
  Station,
  StoppingPoint,
  TopologyEdge,
  TopologyNode,
} from "./base-topology.types";
import type { Diagnostic, ProvenanceRecord } from "./diagnostic-types";
import type { EventAnchor, EventPolicy, RunEvent, RunOrder, ScenicViewResolution, TimelinePoint } from "./event.types";
import type { GeoJSONLineString, GeoJSONPolygon, GeoJSONPosition } from "./geojson";
import type { BoundMileageEvent, UserEventV2 } from "./mileage-event.types";
import type { ISODateTime } from "./primitives";
import type { RenderGeometryPlan, ResolvedGeoJsonPath, RunPath, RunSpec } from "./runtime.types";
import type { ServicePattern, ServiceTemplateLayer } from "./service-template.types";
import type { StationMeta } from "./user-facing.types";

export interface RailGraphIndexes {
  nodeById: Record<string, TopologyNode>;
  edgeById: Record<string, TopologyEdge>;
  stationById: Record<string, Station>;
  platformById: Record<string, Platform>;
  stoppingPointById: Record<string, StoppingPoint>;
  sectionById: Record<string, SpecialSection>;
  patternById: Record<string, ServicePattern>;

  bindingsByEdge: Record<string, string[]>;
  stoppingPointsByEdge: Record<string, string[]>;
  stoppingPointsByPlatform: Record<string, string[]>;
  doubleTrackPairsByEdge: Record<string, string[]>;
  patternsByEdge: Record<string, string[]>;
  patternsByStation: Record<string, string[]>;
  edgesBySection: Record<string, string[]>;
}

export interface RailGraphFingerprints {
  /** Hash of the topology hot layer. This is the canonical graphId. */
  topoHash: string;
  /** Hash of geometry-only warm data. */
  geometryHash: string;
  /** Hash of display-only warm data. */
  displayHash: string;
  /** Hash of event-layer warm data. */
  eventHash: string;
  /** Hash of provenance and diagnostics cold data. */
  provenanceHash: string;
}

/**
 * 统一多层图。topo 包含固定底层事实与已确认 service 模板。
 * 管理员 draft/proposal/heuristic trace 不在这里；它们属于编辑会话。
 */
export interface RailGraph {
  schemaVersion: "rail-graph-v1";
  topo: {
    base: BaseTopologyLayer;
    serviceTemplates: ServiceTemplateLayer;
  };
  geometryStore: {
    edgeGeometries: Record<string, GeoJSONLineString>;
    nodePositions: Record<string, GeoJSONPosition>;
    platformGeometries: Record<string, GeoJSONPolygon>;
    sectionGeometries: Record<string, GeoJSONLineString | GeoJSONPolygon>;
  };
  displayStore: {
    patternDisplay: Record<string, PatternDisplayMeta>;
    stationDisplay: Record<string, StationMeta>;
  };
  eventLayer: {
    anchors: EventAnchor[];
    policies: EventPolicy[];
    /**
     * Mileage-centric user events. These are warm metadata: changing them does
     * not alter topology/pathfinding, only event projection and user-facing UI.
     */
    mileageUserEvents?: UserEventV2[];
  };
  indexes: RailGraphIndexes;
  provenance: ProvenanceRecord[];
  diagnostics: Diagnostic[];
}

export interface PatternDisplayMeta {
  displayName?: string;
  displayColor?: string;
  landmark?: boolean;
}

export interface SystemContext {
  readonly graphId: string;  // sha256(canonicalJson(RailGraph.topo))
  readonly graph: RailGraph;
  readonly fingerprints: RailGraphFingerprints;
  readonly diagnostics: readonly Diagnostic[];
  readonly createdAt: ISODateTime;
}

export interface RunContext {
  readonly runId: string;
  readonly graphId: string;
  readonly graph: RailGraph;
  readonly spec: RunSpec;
  readonly path: RunPath | null;
  readonly resolvedPath: ResolvedGeoJsonPath | null;
  readonly renderPlan: RenderGeometryPlan | null;
  readonly order: RunOrder | null;
  readonly timeline: readonly TimelinePoint[] | null;
  readonly resolvedAnchors: readonly ScenicViewResolution[] | null;
  readonly events: readonly RunEvent[] | null;
  readonly mileageUserEvents?: readonly BoundMileageEvent[] | null;
  readonly diagnostics: readonly Diagnostic[];
}
