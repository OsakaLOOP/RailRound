// ============================================================
// Rail Graph v1 — Layer 2: Admin Editing, Heuristics & Patches
// ============================================================

import type {
  BaseTopologyRelation,
  DoubleTrackPair,
  Platform,
  PlatformTrackBinding,
  SpecialSection,
  Station,
  StoppingPoint,
  TopologyEdge,
  TopologyHardConstraint,
  TopologyNode,
} from "./base-topology.types";
import type { Diagnostic } from "./diagnostic-types";
import type { GeoJSONLineString, GeoJSONPolygon } from "./geojson";
import type { DirectionLabel, EntityRef } from "./primitives";
import type { ResolvedGeoJsonPath, RunPath, RunSpec } from "./runtime.types";
import type { EventAnchor, EventPolicy } from "./event.types";
import type { ServicePathSegment, ServicePattern, ServiceTraceEntry } from "./service-template.types";

export type TemplateDraftStatus = "draft" | "reviewing" | "confirmed" | "rejected";

/**
 * 用户在 admin 工具中提交一条 PlatformTrackBinding 时的输入 wrapper。
 * 编译器据此生成正式 PlatformTrackBinding (附加 id 与校验)。
 */
export interface PlatformTrackBindingInput {
  stationRef: string;
  platformRef: string;
  edgeRef: string;
  side: PlatformTrackBinding["side"];
  servingDirection?: DirectionLabel;
}

/**
 * 用户在 admin 工具中确认一个 StoppingPoint 时的输入 wrapper。
 * 编译器据此生成正式 StoppingPoint (confirmation: "confirmed")。
 */
export interface StoppingPointInput {
  stationRef: string;
  platformRef: string;
  edgeRef: string;
  direction: StoppingPoint["direction"];
  /** 0-1 的 EdgeMeasure, 编译期会 clamp。 */
  measure: number;
}

export interface ServiceTemplateDraft {
  draftId: EntityRef;
  baseGraphId: string;
  status: TemplateDraftStatus;
  seed?: PathGenerationSeed;
  lockedSegments: ServicePathSegment[];
  lockedTraceEntries: ServiceTraceEntry[];
  candidateProposalRefs: EntityRef[];
  diagnostics: Diagnostic[];
}

export interface PathGenerationSeed {
  lineRef?: EntityRef;
  systemRef?: EntityRef;
  startRef: EntityRef;
  endRef: EntityRef;
  viaRefs?: EntityRef[];
  directionHint?: DirectionLabel;
}

export type PathGenerationConstraint =
  | { kind: "lock_edge"; edgeRef: EntityRef; orderHint?: number }
  | { kind: "lock_stop"; stoppingPointRef: EntityRef; orderHint?: number }
  | { kind: "prefer_edge"; edgeRef: EntityRef; weight?: number }
  | { kind: "avoid_edge"; edgeRef: EntityRef; weight?: number }
  | { kind: "prefer_platform"; platformRef: EntityRef; weight?: number }
  | { kind: "avoid_platform"; platformRef: EntityRef; weight?: number };

export interface PathGenerationRequest {
  requestId: EntityRef;
  baseGraphId: string;
  seed: PathGenerationSeed;
  constraints: PathGenerationConstraint[];
  maxCandidates?: number;
}

export interface PathGenerationProposal {
  proposalId: EntityRef;
  requestId: EntityRef;
  candidateIndex: number;
  edgeSequence: EntityRef[];
  traceSequence: ServiceTraceEntry[];
  pathSegments: ServicePathSegment[];
  score: PathGenerationScore;
  ruleTrace: PathGenerationRuleTrace[];
  diagnostics: Diagnostic[];
}

export interface PathGenerationScore {
  totalWeight: number;
  totalDistanceMeters: number;
  penalties: PathGenerationScoreTerm[];
  bonuses: PathGenerationScoreTerm[];
}

export interface PathGenerationScoreTerm {
  ruleId: string;
  weight: number;
  reason: string;
  entityRefs?: EntityRef[];
}

/** 这里才是启发式痕迹。它解释候选如何生成/排序，不进入普通用户运行输出。 */
export interface PathGenerationRuleTrace {
  ruleId: string;
  ruleKind: "hard_filter" | "preference" | "tie_breaker" | "diagnostic";
  message: string;
  entityRefs?: EntityRef[];
}

export interface ServiceTemplateEditSession {
  sessionId: EntityRef;
  baseGraphId: string;
  drafts: ServiceTemplateDraft[];
  requests: PathGenerationRequest[];
  proposals: PathGenerationProposal[];
  patches: PatchSet[];
  diagnostics: Diagnostic[];
}

export interface PatchSet {
  patchId: string;
  baseSnapshotId?: string;
  source: "manual" | "topology_import" | "path_generation" | "debug_tool";
  ops: PatchOp[];
  diagnostics: Diagnostic[];
}

export type PatchOp =
  | { op: "add_entity"; entity: NormalizedEntity }
  | { op: "update_entity"; entityRef: EntityRef; set: Record<string, unknown> }
  | { op: "replace_geometry"; entityRef: EntityRef; geometry: GeoJSONLineString | GeoJSONPolygon }
  | { op: "link"; relation: BaseTopologyRelation }
  | { op: "unlink"; relationRef: EntityRef }
  | { op: "add_service_pattern"; pattern: ServicePattern }
  | { op: "update_service_pattern"; patternRef: EntityRef; set: Partial<ServicePattern> }
  | { op: "add_event_anchor"; anchor: EventAnchor }
  | { op: "update_event_policy"; policyRef: EntityRef; set: Partial<EventPolicy> };

export type NormalizedEntity =
  | { entityType: "node"; data: TopologyNode }
  | { entityType: "edge"; data: TopologyEdge }
  | { entityType: "station"; data: Station }
  | { entityType: "platform"; data: Platform }
  | { entityType: "platformTrackBinding"; data: PlatformTrackBinding }
  | { entityType: "stoppingPoint"; data: StoppingPoint }
  | { entityType: "section"; data: SpecialSection }
  | { entityType: "doubleTrackPair"; data: DoubleTrackPair }
  | { entityType: "relation"; data: BaseTopologyRelation }
  | { entityType: "hardConstraint"; data: TopologyHardConstraint }
  | { entityType: "servicePattern"; data: ServicePattern }
  | { entityType: "eventAnchor"; data: EventAnchor };

export interface PatchPreview {
  affectedEntities: EntityRef[];
  estimatedGraphId?: string;
  diagnostics: Diagnostic[];
}

export interface EditableRailGraphSnapshot {
  snapshotId: string;
  graphId: string;
  editSession?: ServiceTemplateEditSession;
  runPlans?: RunPlanSnapshot[];
  pendingPatches: PatchSet[];
  diagnostics: Diagnostic[];
}

export interface RunPlanSnapshot {
  runId: string;
  spec: RunSpec;
  path: RunPath | null;
  resolvedPath?: ResolvedGeoJsonPath | null;
}
