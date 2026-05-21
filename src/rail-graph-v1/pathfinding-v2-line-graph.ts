// ============================================================
// Rail Graph v1 — Pathfinding v2: Line Graph 构建
//
// 把物理图 (node + edge) 转换为 Line Graph (LG):
//   - LG 节点 = (edgeId, dir: "fromTo"|"toFrom") — 同一物理 edge 双向是两个 LG node
//   - LG 边   = transit / turnback 两类:
//       * transit: 从一条 edge 末端进入另一条 edge, 已通过角度 + 方向兼容预过滤
//       * turnback: 同一 reversible+turnback edge 上换向, 跨"层" (turnbackLayer) 使用
//
// 设计意图:
//   1. **角度过滤作为连通性预处理** (用户特别要求): calculateTurnAngle ≥ angleThresholdDeg
//      → 该 LG 边根本不创建. 算法层不需要运行时反复检查.
//   2. **方向角色保留 v1 flexible 过渡语义** (pathfinding.ts:759-769):
//      当前 LG node 是 flexible (reversible/bidirectional/undefined) 时, 允许转到任何方向.
//   3. **几何箭头一致性** (pathfinding.ts:772-780): traversal="both" + directionRole=up/down
//      时, 进入方向必须匹配箭头方向.
//   4. **传给算法层的只是 LineGraph + GraphPort**, 不直接 import 拓扑模块.
// ============================================================

import type { TrackDirectionRole, TopologyEdge } from "./base-topology.types";
import type { EntityRef } from "./primitives";
import type { GraphPort, LGDir } from "./pathfinding-v2-graph-port";
import type { Position } from "./geometry-math";

// ── 1. Types ─────────────────────────────────────────────────

/** Line Graph 节点 ID: `${edgeId}#${dir}` (唯一稳定 string) */
export type LGNodeId = string;

/** Line Graph 节点 = 物理 edge 的"一个方向化通过实例" */
export interface LineGraphNode {
  id: LGNodeId;
  edgeId: EntityRef;
  dir: LGDir;
  /** 进入此 LG node 时所在 topo node (即穿越此 edge 的起端) */
  entryNode: EntityRef;
  /** 离开此 LG node 时到达 topo node (即穿越此 edge 的终端) */
  exitNode: EntityRef;
  effectiveDirectionRole: TrackDirectionRole | undefined;
  lengthMeters: number;
  /** 退出此 LG node 时的几何坐标 (用于 A* heuristic 与 deserve 计算) */
  exitCoord: Position | null;
  /** 进入此 LG node 时的几何坐标 (用于上一条边的钝角计算) */
  entryCoord: Position | null;
}

/** Line Graph 边类型 */
export type LineGraphEdgeKind = "transit" | "turnback";

/** Line Graph 边 = 一种合法的"LG node → LG node"转移 */
export interface LineGraphEdge {
  fromLG: LGNodeId;
  toLG: LGNodeId;
  kind: LineGraphEdgeKind;
  /** 权重 = toLG.lengthMeters (transit) 或 0 (turnback) */
  weight: number;
  /** 调试/诊断用: 在连接点的转角度数 */
  turnAngleDeg?: number;
  /** 在何 topo node 连接 (transit kind 才有意义) */
  viaNode?: EntityRef;
}

/** Line Graph 整体 */
export interface LineGraph {
  /** 所有 LG 节点, keyed by id */
  nodes: Map<LGNodeId, LineGraphNode>;
  /** 出边邻接表: LG node id → LG 边数组 */
  outgoing: Map<LGNodeId, LineGraphEdge[]>;
  /** 反查: 物理 edge id → 该 edge 的 LG 节点 id 集合 (1 或 2 个) */
  lgNodesByEdge: Map<EntityRef, LGNodeId[]>;
  /** 反查: 进入 topo node N 时,可用作起点的 LG 节点 id 集合 */
  lgNodesByEntryTopoNode: Map<EntityRef, LGNodeId[]>;
  /** turnback 边索引: 物理 edge id → (fromTo↔toFrom 的 turnback 边) */
  turnbackEdges: Map<EntityRef, LineGraphEdge>;
  /** 构建统计 */
  stats: LineGraphStats;
}

export interface LineGraphStats {
  totalEdgesProcessed: number;
  totalLGNodes: number;
  totalLGEdges: number;
  transitEdges: number;
  turnbackEdges: number;
  prunedByAngle: number;
  prunedByDirection: number;
  prunedByGeometryArrow: number;
  prunedByHardConstraint: number;
  prunedByMissingCoordinates: number;
  buildTimeMs: number;
}

export interface BuildLineGraphOptions {
  /** 角度阈值 (度数). 转角 >= 此值的 LG 边不创建. 默认 90. */
  angleThresholdDeg?: number;
  /** 是否允许立刻原路返回 (同一 edge 反向, 不经过 turnback)? 默认 false. v1 一致. */
  allowImmediateReverse?: boolean;
}

// ── 2. buildLineGraph ────────────────────────────────────────

/**
 * 构建 Line Graph. 输入 GraphPort, 输出 LineGraph.
 *
 * 算法:
 *   1. 遍历所有物理 edge, 生成 LG nodes (traversal=forward 只生成 fromTo)
 *   2. 对每个 LG node, 枚举其出口端 topo node 上的 outEdges, 检查兼容性后生成 transit LG 边
 *   3. 对每条 reversible+turnback 物理 edge, 生成 fromTo↔toFrom turnback LG 边
 */
export function buildLineGraph(
  port: GraphPort,
  options: BuildLineGraphOptions = {},
): LineGraph {
  const start = nowMs();
  const angleThreshold = options.angleThresholdDeg ?? 90;
  const allowImmediateReverse = options.allowImmediateReverse ?? false;

  const stats: LineGraphStats = {
    totalEdgesProcessed: 0,
    totalLGNodes: 0,
    totalLGEdges: 0,
    transitEdges: 0,
    turnbackEdges: 0,
    prunedByAngle: 0,
    prunedByDirection: 0,
    prunedByGeometryArrow: 0,
    prunedByHardConstraint: 0,
    prunedByMissingCoordinates: 0,
    buildTimeMs: 0,
  };

  const nodes = new Map<LGNodeId, LineGraphNode>();
  const outgoing = new Map<LGNodeId, LineGraphEdge[]>();
  const lgNodesByEdge = new Map<EntityRef, LGNodeId[]>();
  const lgNodesByEntryTopoNode = new Map<EntityRef, LGNodeId[]>();
  const turnbackEdgesMap = new Map<EntityRef, LineGraphEdge>();

  // ── Pass 1: 生成 LG nodes ──
  for (const edge of port.allEdges()) {
    stats.totalEdgesProcessed += 1;
    const dirs: LGDir[] = edge.traversal === "forward" ? ["fromTo"] : ["fromTo", "toFrom"];
    for (const dir of dirs) {
      const lgNode = createLGNode(edge, dir, port);
      nodes.set(lgNode.id, lgNode);
      pushToMapArray(lgNodesByEdge, edge.id, lgNode.id);
      pushToMapArray(lgNodesByEntryTopoNode, lgNode.entryNode, lgNode.id);
      stats.totalLGNodes += 1;
    }
  }

  // ── Pass 2: 生成 transit LG 边 ──
  for (const a of nodes.values()) {
    const candidates = lgNodesByEntryTopoNode.get(a.exitNode) ?? [];
    for (const bId of candidates) {
      const b = nodes.get(bId);
      if (!b) continue;

      // 同物理 edge 反向: 不通过 transit, 由 turnback 边专门处理
      if (b.edgeId === a.edgeId) {
        if (!allowImmediateReverse) continue;
      }

      const transit = tryCreateTransitEdge(a, b, port, angleThreshold, stats);
      if (!transit) continue;

      pushToMapArray(outgoing, a.id, transit);
      stats.transitEdges += 1;
      stats.totalLGEdges += 1;
    }
  }

  // ── Pass 3: 生成 turnback LG 边 (跨层用) ──
  for (const edge of port.allEdges()) {
    if (!port.isTurnbackEdge(edge.id)) continue;
    const fromToId = lgNodeId(edge.id, "fromTo");
    const toFromId = lgNodeId(edge.id, "toFrom");
    if (!nodes.has(fromToId) || !nodes.has(toFromId)) continue;

    // 双向 turnback 边
    const e1: LineGraphEdge = {
      fromLG: fromToId,
      toLG: toFromId,
      kind: "turnback",
      weight: 0,
    };
    const e2: LineGraphEdge = {
      fromLG: toFromId,
      toLG: fromToId,
      kind: "turnback",
      weight: 0,
    };
    pushToMapArray(outgoing, fromToId, e1);
    pushToMapArray(outgoing, toFromId, e2);
    turnbackEdgesMap.set(edge.id, e1);
    stats.turnbackEdges += 2;
    stats.totalLGEdges += 2;
  }

  stats.buildTimeMs = nowMs() - start;

  return {
    nodes,
    outgoing,
    lgNodesByEdge,
    lgNodesByEntryTopoNode,
    turnbackEdges: turnbackEdgesMap,
    stats,
  };
}

// ── 3. Helpers ───────────────────────────────────────────────

export function lgNodeId(edgeId: EntityRef, dir: LGDir): LGNodeId {
  return `${edgeId}#${dir}`;
}

export function parseLGNodeId(id: LGNodeId): { edgeId: EntityRef; dir: LGDir } {
  const idx = id.lastIndexOf("#");
  return {
    edgeId: id.slice(0, idx) as EntityRef,
    dir: id.slice(idx + 1) as LGDir,
  };
}

function createLGNode(edge: TopologyEdge, dir: LGDir, port: GraphPort): LineGraphNode {
  const entryNode = dir === "fromTo" ? edge.fromNodeRef : edge.toNodeRef;
  const exitNode = dir === "fromTo" ? edge.toNodeRef : edge.fromNodeRef;
  return {
    id: lgNodeId(edge.id, dir),
    edgeId: edge.id,
    dir,
    entryNode,
    exitNode,
    effectiveDirectionRole: edge.directionRole,
    lengthMeters: edge.lengthMeters,
    exitCoord: port.edgeExitCoord(edge.id, dir),
    entryCoord: port.edgeEntryCoord(edge.id, dir),
  };
}

/**
 * 尝试创建从 a 到 b 的 transit LG 边. 返回 null 表示被剪枝.
 * 同时累计 stats 计数器.
 */
function tryCreateTransitEdge(
  a: LineGraphNode,
  b: LineGraphNode,
  port: GraphPort,
  angleThreshold: number,
  stats: LineGraphStats,
): LineGraphEdge | null {
  const sharedNode = a.exitNode; // === b.entryNode (我们查询前提)
  const edgeA = port.getEdge(a.edgeId);
  const edgeB = port.getEdge(b.edgeId);
  if (!edgeA || !edgeB) return null;

  // (1) 几何箭头一致性 (对 traversal="both" + directionRole=up/down 的 b edge):
  //     edgeB 的几何箭头 fromNode→toNode 决定 dir 必须匹配
  if (
    edgeB.traversal === "both" &&
    (edgeB.directionRole === "up" || edgeB.directionRole === "down")
  ) {
    const enteringFromNodeOfB = b.entryNode === edgeB.fromNodeRef;
    const directionIsFromTo = b.dir === "fromTo";
    if (enteringFromNodeOfB !== directionIsFromTo) {
      stats.prunedByGeometryArrow += 1;
      return null;
    }
  }

  // (2) 角度过滤 (用户特别要求: 作为连通性预处理)
  const angle = port.calculateTurnAngleAt(a.edgeId, b.edgeId, sharedNode);
  if (angle >= angleThreshold) {
    stats.prunedByAngle += 1;
    return null;
  }

  // (3) directionRole 兼容性 (保留 v1 flexible 过渡语义):
  //     若 a 是 flexible (reversible/bidirectional/undefined), 允许转到任何 role
  //     否则要求 isDirectionCompatible(a.role, b.role)
  if (!isLGRoleCompatible(a.effectiveDirectionRole, b.effectiveDirectionRole, port)) {
    stats.prunedByDirection += 1;
    return null;
  }

  // (4) hard constraint
  if (port.isTraversalForbidden(b.edgeId, b.entryNode, b.exitNode)) {
    stats.prunedByHardConstraint += 1;
    return null;
  }

  return {
    fromLG: a.id,
    toLG: b.id,
    kind: "transit",
    weight: b.lengthMeters,
    turnAngleDeg: angle,
    viaNode: sharedNode,
  };
}

/**
 * 判断 LG 边两端 directionRole 是否兼容.
 *
 * 语义沿用 v1 (pathfinding.ts:759-769):
 *   - 当前 LG node 是 flexible (reversible/bidirectional/undefined) → 允许过渡到任何方向
 *   - 否则使用 GraphPort.isDirectionCompatible
 */
export function isLGRoleCompatible(
  current: TrackDirectionRole | undefined,
  candidate: TrackDirectionRole | undefined,
  port: GraphPort,
): boolean {
  if (port.isFlexibleDirection(current)) return true;
  return port.isDirectionCompatible(current, candidate);
}

// ── 4. Utility ───────────────────────────────────────────────

function pushToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) {
    arr.push(value);
  } else {
    map.set(key, [value]);
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
