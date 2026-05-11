// ============================================================
// Rail Graph v1 — 固定基础循迹拓扑
//
// 拓扑层是站线级精确循迹的底层事实层，独立于输入格式
// (ORM / GeoJSON / 人工 patch)，但不是“只有连通图”。
// 它同时固定轨道连通、方向约束、站/站台/股道绑定、停车标、
// 特殊区间和硬性结构约束。路径生成启发式只消费这些事实，
// 不在这里表达 prefer / avoid / score 等候选规则。
// ============================================================

import type {
  BaseTopologyLayer,
  DoubleTrackPair,
  GraphAdjacency,
  Platform,
  PlatformTrackBinding,
  Signal,
  Station,
  StoppingPoint,
  TopologyEdge,
  TopologyHardConstraint,
  TopologyNode,
  TrackDirectionRole,
} from "./base-topology.types";
import type { Diagnostic } from "./diagnostic-types";
import type { DirectionLabel, EntityRef } from "./primitives";
import type { ServiceTraceEntry } from "./service-template.types";

// ── 0. Topology Graph ──────────────────────────────────────

export interface TopologyGraph extends BaseTopologyLayer {
  diagnostics: Diagnostic[];
}

export interface TraversalStep {
  edgeRef: EntityRef;
  fromNodeRef: EntityRef;
  toNodeRef: EntityRef;
}

export interface StationTrackBindingChain {
  station: Station;
  platform: Platform;
  binding: PlatformTrackBinding;
  stoppingPoint?: StoppingPoint;
}

export interface TopologyLookup {
  nodesById: Record<string, TopologyNode>;
  edgesById: Record<string, TopologyEdge>;
  stationsById: Record<string, Station>;
  platformsById: Record<string, Platform>;
  bindingsByEdge: Record<string, PlatformTrackBinding[]>;
  /** edge.id → 该 edge 上挂载的 PlatformTrackBinding (与 bindingsByEdge 等价, 命名保留) */
  bindingsByPlatform: Record<string, PlatformTrackBinding[]>;
  stoppingPointsByEdge: Record<string, StoppingPoint[]>;
  signalsByEdge: Record<string, Signal[]>;
  doubleTrackPairsByEdge: Record<string, DoubleTrackPair[]>;
  hardConstraintsByTarget: Record<string, TopologyHardConstraint[]>;
  /** 按 directionRole 分组的 edge id 列表; undefined directionRole 不收录 */
  edgesByDirectionRole: Record<TrackDirectionRole, EntityRef[]>;
}

// ── 1. Edge Traversal Primitives ───────────────────────────

export function canTraverseFrom(edge: TopologyEdge, nodeRef: EntityRef): boolean {
  if (edge.traversal === "both") {
    return edge.fromNodeRef === nodeRef || edge.toNodeRef === nodeRef;
  }
  return edge.fromNodeRef === nodeRef;
}

export function traverseTo(edge: TopologyEdge, fromNodeRef: EntityRef): EntityRef {
  return edge.fromNodeRef === fromNodeRef ? edge.toNodeRef : edge.fromNodeRef;
}

export function buildAdjacency(edges: TopologyEdge[]): GraphAdjacency {
  const outEdges: Record<string, EntityRef[]> = {};
  const inEdges: Record<string, EntityRef[]> = {};

  for (const edge of edges) {
    const outNodes: EntityRef[] = edge.traversal === "both"
      ? [edge.fromNodeRef, edge.toNodeRef]
      : [edge.fromNodeRef];

    for (const nodeRef of outNodes) {
      (outEdges[nodeRef] ??= []).push(edge.id);
    }

    const inNodes: EntityRef[] = edge.traversal === "both"
      ? [edge.fromNodeRef, edge.toNodeRef]
      : [edge.toNodeRef];

    for (const nodeRef of inNodes) {
      (inEdges[nodeRef] ??= []).push(edge.id);
    }
  }

  return { outEdges, inEdges };
}

export function materializeTraversalStep(edge: TopologyEdge, fromNodeRef: EntityRef): TraversalStep {
  return {
    edgeRef: edge.id,
    fromNodeRef,
    toNodeRef: traverseTo(edge, fromNodeRef),
  };
}

// ── 2. Fixed Binding Lookup ────────────────────────────────

export function buildTopologyLookup(topo: BaseTopologyLayer): TopologyLookup {
  const nodesById: Record<string, TopologyNode> = {};
  const edgesById: Record<string, TopologyEdge> = {};
  const stationsById: Record<string, Station> = {};
  const platformsById: Record<string, Platform> = {};
  const bindingsByEdge: Record<string, PlatformTrackBinding[]> = {};
  const bindingsByPlatform: Record<string, PlatformTrackBinding[]> = {};
  const stoppingPointsByEdge: Record<string, StoppingPoint[]> = {};
  const signalsByEdge: Record<string, Signal[]> = {};
  const doubleTrackPairsByEdge: Record<string, DoubleTrackPair[]> = {};
  const hardConstraintsByTarget: Record<string, TopologyHardConstraint[]> = {};
  const edgesByDirectionRole: Record<TrackDirectionRole, EntityRef[]> = {
    up: [],
    down: [],
    bidirectional: [],
    reversible: [],
  };

  for (const node of topo.nodes) {
    nodesById[node.id] = node;
  }

  for (const edge of topo.edges) {
    edgesById[edge.id] = edge;
    if (edge.directionRole) {
      edgesByDirectionRole[edge.directionRole].push(edge.id);
    }
  }

  for (const station of topo.stations) {
    stationsById[station.id] = station;
  }

  for (const platform of topo.platforms) {
    platformsById[platform.id] = platform;
  }

  for (const binding of topo.platformTrackBindings) {
    (bindingsByEdge[binding.edgeRef] ??= []).push(binding);
    (bindingsByPlatform[binding.platformRef] ??= []).push(binding);
  }

  for (const stoppingPoint of topo.stoppingPoints) {
    (stoppingPointsByEdge[stoppingPoint.edgeRef] ??= []).push(stoppingPoint);
  }

  for (const signal of topo.signals) {
    (signalsByEdge[signal.edgeRef] ??= []).push(signal);
  }

  for (const pair of topo.doubleTrackPairs) {
    for (const edgeRef of [
      ...pair.upEdgeRefs,
      ...pair.downEdgeRefs,
      ...(pair.sharedGeometryEdgeRefs ?? []),
    ]) {
      (doubleTrackPairsByEdge[edgeRef] ??= []).push(pair);
    }
  }

  for (const constraint of topo.hardConstraints) {
    for (const targetRef of constraint.targetRefs) {
      (hardConstraintsByTarget[targetRef] ??= []).push(constraint);
    }
  }

  return {
    nodesById,
    edgesById,
    stationsById,
    platformsById,
    bindingsByEdge,
    bindingsByPlatform,
    stoppingPointsByEdge,
    signalsByEdge,
    doubleTrackPairsByEdge,
    hardConstraintsByTarget,
    edgesByDirectionRole,
  };
}

/**
 * 返回某条 edge 上已确认的站/站台/停车标绑定链。
 * 这不是启发式推断；缺失结果表示底层 topo 尚未确认绑定。
 */
export function getStationTrackBindingChains(
  lookup: TopologyLookup,
  edgeRef: EntityRef,
): StationTrackBindingChain[] {
  const bindings = lookup.bindingsByEdge[edgeRef] ?? [];
  const stoppingPoints = lookup.stoppingPointsByEdge[edgeRef] ?? [];

  return bindings.flatMap((binding) => {
    const station = lookup.stationsById[binding.stationRef];
    const platform = lookup.platformsById[binding.platformRef];

    if (!station || !platform) {
      return [];
    }

    const matchingStops = stoppingPoints.filter((point) =>
      point.stationRef === station.id && point.platformRef === platform.id
    );

    if (matchingStops.length === 0) {
      return [{ station, platform, binding }];
    }

    return matchingStops.map((stoppingPoint) => ({
      station,
      platform,
      binding,
      stoppingPoint,
    }));
  });
}

export function getStoppingPointForTraceEntry(
  lookup: TopologyLookup,
  entry: ServiceTraceEntry,
): StoppingPoint | undefined {
  if (entry.passageType !== "stop") {
    return undefined;
  }
  return lookup.stoppingPointsByEdge[entry.edgeRef]
    ?.find((point) => point.id === entry.stoppingPointRef);
}

// ── 3. Hard Constraint Checks ──────────────────────────────

export function isEdgeClosed(lookup: TopologyLookup, edgeRef: EntityRef): boolean {
  return (lookup.hardConstraintsByTarget[edgeRef] ?? [])
    .some((constraint) => constraint.kind === "closed_edge");
}

export function isTraversalForbidden(
  lookup: TopologyLookup,
  edgeRef: EntityRef,
  fromNodeRef?: EntityRef,
  toNodeRef?: EntityRef,
): boolean {
  return (lookup.hardConstraintsByTarget[edgeRef] ?? []).some((constraint) => {
    if (constraint.kind === "forbid_traversal") {
      return true;
    }

    if (constraint.kind !== "forbid_transition") {
      return false;
    }

    if (!fromNodeRef || !toNodeRef) {
      return true;
    }

    return constraint.targetRefs.includes(fromNodeRef)
      && constraint.targetRefs.includes(edgeRef)
      && constraint.targetRefs.includes(toNodeRef);
  });
}

// ── 4. DirectionRole Aggregation ───────────────────────────

/**
 * 基于 TopologyEdge.directionRole 自动聚合 DoubleTrackPair。
 *
 * 行为:
 * - directionRole = "up"            → upEdgeRefs
 * - directionRole = "down"          → downEdgeRefs
 * - directionRole = "bidirectional" → sharedGeometryEdgeRefs (含 connector / 单线区间)
 * - directionRole = "reversible"    → sharedGeometryEdgeRefs (含中线换向用)
 *
 * 当且仅当存在 ≥1 条 up 与 ≥1 条 down 时, 才生成一条 DoubleTrackPair。
 * 生成的 confirmation 标为 "imported_confirmed", 表示由编译派生而非用户原始输入。
 *
 * MVP 阶段的限制: 只生成单一全局 pair, 不按 station/line 切分。
 * 后续可以扩展接受 grouping 函数。
 */
export function aggregateDoubleTrackPairs(
  edges: TopologyEdge[],
  pairId: EntityRef,
): DoubleTrackPair[] {
  const upEdgeRefs: EntityRef[] = [];
  const downEdgeRefs: EntityRef[] = [];
  const sharedGeometryEdgeRefs: EntityRef[] = [];

  for (const edge of edges) {
    switch (edge.directionRole) {
      case "up":
        upEdgeRefs.push(edge.id);
        break;
      case "down":
        downEdgeRefs.push(edge.id);
        break;
      case "bidirectional":
      case "reversible":
        sharedGeometryEdgeRefs.push(edge.id);
        break;
      default:
        // 无 directionRole 声明的 edge 不参与聚合
        break;
    }
  }

  if (upEdgeRefs.length === 0 || downEdgeRefs.length === 0) {
    return [];
  }

  return [{
    id: pairId,
    upEdgeRefs,
    downEdgeRefs,
    sharedGeometryEdgeRefs: sharedGeometryEdgeRefs.length > 0 ? sharedGeometryEdgeRefs : undefined,
    confirmation: "imported_confirmed",
  }];
}

// ── 5. Direction / Turnback Helpers ────────────────────────

/**
 * 判断该 edge 是否允许在其上换向 (turnback).
 *
 * 规则: edge.directionRole === "reversible" AND edge.functionalUse 含 "turnback"。
 * reversible 蕴含 "双向运行 + 允许换向" 两层语义; functionalUse 含 turnback
 * 表示运用上确实在此换向 — 两者必须同时声明, 编译期不得反推。
 */
export function isTurnbackAllowed(edge: TopologyEdge): boolean {
  return edge.directionRole === "reversible"
    && Array.isArray(edge.functionalUse)
    && edge.functionalUse.includes("turnback");
}

/**
 * 返回与给定 directionRole 相反的 role。
 * up ↔ down; bidirectional / reversible 没有相反值 (它们已经允许双向, 返回 undefined)。
 */
export function oppositeDirectionRole(role: TrackDirectionRole): TrackDirectionRole | undefined {
  switch (role) {
    case "up": return "down";
    case "down": return "up";
    default: return undefined;
  }
}

/**
 * 返回某 platform 沿指定方向 (DirectionLabel: "up"/"down") 服务的 edges。
 * 基于 PlatformTrackBinding.servingDirection 匹配。
 * 缺失 / "unknown" 的 servingDirection 视为该 platform 在任一方向都可服务。
 */
export function getPlatformDirectedEdges(
  lookup: TopologyLookup,
  platformRef: EntityRef,
  direction: DirectionLabel,
): { edge: TopologyEdge; binding: PlatformTrackBinding }[] {
  const bindings = lookup.bindingsByPlatform[platformRef] ?? [];
  const matched = bindings.filter((b) =>
    !b.servingDirection
    || b.servingDirection === "unknown"
    || b.servingDirection === direction,
  );
  return matched.flatMap((binding) => {
    const edge = lookup.edgesById[binding.edgeRef];
    return edge ? [{ edge, binding }] : [];
  });
}

/**
 * 判断两个 directionRole 在寻径过程中是否兼容。
 *
 * 规则 (核心: bidirectional 与 reversible 都视为"双向", 与任何方向兼容):
 * - undefined ↔ 任意: 兼容 (向后兼容)
 * - bidirectional / reversible ↔ 任意: 兼容
 * - up ↔ up: 兼容
 * - down ↔ down: 兼容
 * - up ↔ down: **不兼容** (需要换向)
 */
export function isDirectionRoleCompatible(
  current: TrackDirectionRole | undefined,
  candidate: TrackDirectionRole | undefined,
): boolean {
  if (!current || !candidate) return true;
  if (current === "bidirectional" || current === "reversible") return true;
  if (candidate === "bidirectional" || candidate === "reversible") return true;
  return current === candidate;
}
