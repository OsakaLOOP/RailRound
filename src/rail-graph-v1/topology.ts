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
  EntityRef,
  Platform,
  PlatformTrackBinding,
  Station,
  StoppingPoint,
  TopologyEdge,
  TopologyHardConstraint,
  TopologyNode,
} from "./base-topology.types";
import type { Diagnostic } from "./diagnostic-types";
import type { EntityRef } from "./primitives";
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
  stoppingPointsByEdge: Record<string, StoppingPoint[]>;
  doubleTrackPairsByEdge: Record<string, DoubleTrackPair[]>;
  hardConstraintsByTarget: Record<string, TopologyHardConstraint[]>;
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
  const stoppingPointsByEdge: Record<string, StoppingPoint[]> = {};
  const doubleTrackPairsByEdge: Record<string, DoubleTrackPair[]> = {};
  const hardConstraintsByTarget: Record<string, TopologyHardConstraint[]> = {};

  for (const node of topo.nodes) {
    nodesById[node.id] = node;
  }

  for (const edge of topo.edges) {
    edgesById[edge.id] = edge;
  }

  for (const station of topo.stations) {
    stationsById[station.id] = station;
  }

  for (const platform of topo.platforms) {
    platformsById[platform.id] = platform;
  }

  for (const binding of topo.platformTrackBindings) {
    (bindingsByEdge[binding.edgeRef] ??= []).push(binding);
  }

  for (const stoppingPoint of topo.stoppingPoints) {
    (stoppingPointsByEdge[stoppingPoint.edgeRef] ??= []).push(stoppingPoint);
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
    stoppingPointsByEdge,
    doubleTrackPairsByEdge,
    hardConstraintsByTarget,
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
