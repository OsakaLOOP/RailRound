// ============================================================
// Rail Graph v1 — Pathfinding v2: 主入口
//
// 把 v2 各模块串起来:
//   1. resolveSeed (复用 v1) 把 start/end seed 转换为 entry/target points
//   2. createGraphPortFromTopology → GraphPort 抽象
//   3. buildLineGraph → Line Graph
//   4. compileChain → ChainCompilation
//   5. Map seed entry points → start LG nodes; end seed → target LG nodes
//   6. yensKShortest → SearchPath[]
//   7. Convert SearchPath → RawCandidate → PathfindingResult (复用 v1 buildResultFromCandidate)
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type {
  BaseTopologyLayer,
  TopologyEdge,
  TrackDirectionRole,
} from "./base-topology.types";
import type { EntityRef } from "./primitives";
import type { TopologyLookup } from "./topology";
import { createGraphPortFromTopology } from "./pathfinding-v2-graph-port";
import {
  buildLineGraph,
  lgNodeId,
  type LineGraph,
  type LGNodeId,
} from "./pathfinding-v2-line-graph";
import {
  compileChain,
  createChainGoalPredicate,
  createChainTransition,
  createStartState,
} from "./pathfinding-v2-chain";
import {
  createHaversineHeuristic,
  yensKShortest,
  type SearchPath,
  type SearchStart,
} from "./pathfinding-v2-search";
import type {
  IntentionChain,
} from "./chain.types";

// ── 1. v2 入口数据结构 ───────────────────────────────────────

export interface FindPathsV2Args {
  topo: BaseTopologyLayer;
  lookup: TopologyLookup;
  /** 起点 entry points (已由 v1 resolveSeed 解析) */
  startEntryPoints: Array<{
    startNodeRef: EntityRef;
    firstEdge?: EntityRef;
    startKind?: "main" | "siding";
  }>;
  /** 终点 entry points (已由 v1 resolveSeed 解析) */
  endEntryPoints: Array<{
    startNodeRef: EntityRef;
    firstEdge?: EntityRef;
  }>;
  /** 已编译 / 推断好的 IntentionChain */
  chain: IntentionChain;
  /** 可选: 起始 direction role 提示 */
  initialDirectionRole?: TrackDirectionRole;
  /** K = maxCandidates */
  maxCandidates?: number;
  /** 角度过滤阈值 (默认 90°) */
  angleThresholdDeg?: number;
  /** 单次 A* 最大扩展数 */
  maxExpansions?: number;
  /** 全局 timeout (ms) */
  timeoutMs?: number;
  /** 启用 debug 输出 */
  debug?: boolean;
}

/** v2 内部输出: 与 v1 RawCandidate 同构, 供 buildResultFromCandidate 消费 */
export interface RawCandidateV2 {
  edgeSequence: EntityRef[];
  edgeEntryNodes: EntityRef[];
  turnbackAt: number[];
  totalDistanceMeters: number;
  startKind: "main" | "siding";
  localDiagnostics: Diagnostic[];
}

export interface FindPathsV2Result {
  candidates: RawCandidateV2[];
  diagnostics: Diagnostic[];
  stats: {
    lgBuildTimeMs: number;
    searchInvocations: number;
    totalExpansions: number;
  };
}

// ── 2. 主函数 ────────────────────────────────────────────────

export function findPathsV2(args: FindPathsV2Args): FindPathsV2Result {
  const diagnostics: Diagnostic[] = [];

  const port = createGraphPortFromTopology(args.topo, args.lookup);
  const lg = buildLineGraph(port, {
    angleThresholdDeg: args.angleThresholdDeg ?? 90,
  });

  const compilation = compileChain(args.chain, port);

  // ── 起点 LG node 集合 ──
  const starts: SearchStart[] = [];
  const startKindByLgNode = new Map<LGNodeId, "main" | "siding">();
  for (const ep of args.startEntryPoints) {
    const startKind = ep.startKind ?? "main";
    const lgIds = resolveStartLGNodes(ep.startNodeRef, ep.firstEdge, lg, args.lookup);
    if (args.debug) {
      console.log("[v2 debug] start ep %s firstEdge=%s → LG ids: %s",
        ep.startNodeRef, ep.firstEdge, lgIds.join(","));
      for (const id of lgIds) {
        const outs = lg.outgoing.get(id) ?? [];
        console.log("[v2 debug]   LG %s has %d outgoing edges", id, outs.length);
      }
    }
    for (const id of lgIds) {
      starts.push({
        state: createStartState(id),
        gScoreBias: lg.nodes.get(id)?.lengthMeters ?? 0, // 起点 LG node 自身边权计入
      });
      startKindByLgNode.set(id, startKind);
    }
  }

  if (starts.length === 0) {
    return {
      candidates: [],
      diagnostics,
      stats: { lgBuildTimeMs: lg.stats.buildTimeMs, searchInvocations: 0, totalExpansions: 0 },
    };
  }

  // ── 终点 LG node 集合 ──
  const targetLgNodes = new Set<LGNodeId>();
  for (const ep of args.endEntryPoints) {
    const lgIds = resolveEndLGNodes(ep.startNodeRef, ep.firstEdge, lg, args.lookup);
    if (args.debug) {
      console.log("[v2 debug] end ep %s firstEdge=%s → LG ids: %s",
        ep.startNodeRef, ep.firstEdge, lgIds.join(","));
    }
    for (const id of lgIds) targetLgNodes.add(id);
  }

  if (targetLgNodes.size === 0) {
    return {
      candidates: [],
      diagnostics,
      stats: { lgBuildTimeMs: lg.stats.buildTimeMs, searchInvocations: 0, totalExpansions: 0 },
    };
  }

  // ── Goal coords for heuristic ──
  const goalCoords: Array<[number, number]> = [];
  for (const id of targetLgNodes) {
    const node = lg.nodes.get(id);
    if (node?.exitCoord) goalCoords.push(node.exitCoord);
  }

  // ── 搜索 ──
  const transition = createChainTransition(compilation, port);
  const isGoal = createChainGoalPredicate(compilation, targetLgNodes);
  const heuristic = createHaversineHeuristic(port, goalCoords);

  const K = args.maxCandidates ?? 16;
  const kResult = yensKShortest({
    lg,
    starts,
    isGoal,
    heuristic,
    transition,
    K,
    maxExpansions: args.maxExpansions,
    timeoutMs: args.timeoutMs ?? 5000,
    debug: args.debug,
  });

  // ── SearchPath → RawCandidateV2 ──
  const candidates: RawCandidateV2[] = [];
  for (const path of kResult.paths) {
    const raw = searchPathToRawCandidate(path, lg, startKindByLgNode);
    if (raw) candidates.push(raw);
  }

  return {
    candidates,
    diagnostics,
    stats: {
      lgBuildTimeMs: lg.stats.buildTimeMs,
      searchInvocations: kResult.searchInvocations,
      totalExpansions: kResult.totalExpansions,
    },
  };
}

// ── 3. Seed → LG nodes 映射 ──────────────────────────────────

/**
 * 把起点 (startNodeRef + 可选 firstEdge) 映射为 LG node id 列表.
 *
 * - firstEdge 存在: 直接定位到 `${firstEdge}#${dir}`,其中 dir 由 startNodeRef 决定
 * - firstEdge 缺失: 取 startNodeRef 的所有 outEdges,每条边的 fromTo 或 toFrom 方向 LG node
 */
function resolveStartLGNodes(
  startNodeRef: EntityRef,
  firstEdge: EntityRef | undefined,
  lg: LineGraph,
  lookup: TopologyLookup,
): LGNodeId[] {
  if (firstEdge) {
    const edge = lookup.edgesById[firstEdge];
    if (!edge) return [];
    const dir = edge.fromNodeRef === startNodeRef ? "fromTo" : "toFrom";
    const id = lgNodeId(firstEdge, dir);
    return lg.nodes.has(id) ? [id] : [];
  }

  const out: LGNodeId[] = [];
  const entryList = lg.lgNodesByEntryTopoNode.get(startNodeRef) ?? [];
  for (const id of entryList) out.push(id);
  return out;
}

/**
 * 把终点 (startNodeRef + 可选 firstEdge) 映射为 LG node id 列表 (作为 isGoal 集合).
 *
 * - firstEdge 存在: `${firstEdge}#fromTo` 和 `${firstEdge}#toFrom` 都视为合法终点
 *   (因为 "到达此 edge 的 either 方向" 都算到达)
 * - firstEdge 缺失: 取 startNodeRef 的所有 inEdges (即 exitNode === startNodeRef 的 LG nodes)
 */
function resolveEndLGNodes(
  endNodeRef: EntityRef,
  firstEdge: EntityRef | undefined,
  lg: LineGraph,
  lookup: TopologyLookup,
): LGNodeId[] {
  if (firstEdge) {
    const out: LGNodeId[] = [];
    const ft = lgNodeId(firstEdge, "fromTo");
    const tf = lgNodeId(firstEdge, "toFrom");
    if (lg.nodes.has(ft)) out.push(ft);
    if (lg.nodes.has(tf)) out.push(tf);
    return out;
  }

  // 收集 exitNode === endNodeRef 的所有 LG nodes
  const out: LGNodeId[] = [];
  for (const lgNode of lg.nodes.values()) {
    if (lgNode.exitNode === endNodeRef) out.push(lgNode.id);
  }
  return out;
}

// ── 4. SearchPath → RawCandidateV2 ───────────────────────────

function searchPathToRawCandidate(
  path: SearchPath,
  lg: LineGraph,
  startKindByLgNode: Map<LGNodeId, "main" | "siding">,
): RawCandidateV2 | null {
  if (path.steps.length === 0) return null;

  const edgeSequence: EntityRef[] = [];
  const edgeEntryNodes: EntityRef[] = [];
  const turnbackAt: number[] = [];

  // 第一个 step 是起点 LG node, 它对应起点 edge (因为 LG node = 一个方向化的物理 edge)
  // 把它加进去
  const startStep = path.steps[0];
  const startLgNode = lg.nodes.get(startStep.state.lgNodeId);
  if (!startLgNode) return null;
  edgeSequence.push(startLgNode.edgeId);
  edgeEntryNodes.push(startLgNode.entryNode);

  // 后续 steps
  for (let i = 1; i < path.steps.length; i++) {
    const step = path.steps[i];
    const edge = step.edgeInto;
    if (!edge) continue;
    const toLgNode = lg.nodes.get(edge.toLG);
    if (!toLgNode) continue;

    if (edge.kind === "transit") {
      edgeSequence.push(toLgNode.edgeId);
      edgeEntryNodes.push(toLgNode.entryNode);
    } else if (edge.kind === "turnback") {
      // turnback 不消耗新 edge, 而是标记最后一条 edge 上发生了换向
      const lastIdx = edgeSequence.length - 1;
      if (lastIdx >= 0) {
        turnbackAt.push(lastIdx);
      }
    }
  }

  const startKind = startKindByLgNode.get(startStep.state.lgNodeId) ?? "main";

  return {
    edgeSequence,
    edgeEntryNodes,
    turnbackAt,
    totalDistanceMeters: path.totalDistance,
    startKind,
    localDiagnostics: [],
  };
}

// ── 5. 给 v1 入口替换用的兼容函数 ────────────────────────────

/**
 * 直接产出 PathfindingResult (与 v1 同形). 此函数复用 v1 的 buildResultFromCandidate.
 * 为了避免循环依赖, 实际的 build 在 pathfinding.ts 内做; 此处只导出 v2 中间产物.
 */
export interface V2ToV1Adapter {
  rawCandidates: RawCandidateV2[];
  diagnostics: Diagnostic[];
}
