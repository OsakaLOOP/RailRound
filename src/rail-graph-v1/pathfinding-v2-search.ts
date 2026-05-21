// ============================================================
// Rail Graph v1 — Pathfinding v2: A* + Yen K-Shortest 搜索内核
//
// 在 Line Graph (LG) + 乘积图状态 上做最短路径 / K 最短路径搜索.
//
// 状态空间:
//   SearchState = (lgNodeId, chainProgressIndex, turnbackLayer, blockedFlipUntilLength)
//   - lgNodeId: 当前所在的 LG node
//   - chainProgressIndex: 已满足的 IntentionChain.nodes 上界 (单调递增)
//   - turnbackLayer: 已发生的 turnback 次数 (硬上限 = chain 中 reversal 数)
//   - blockedFlipUntilLength: crossover S-flip 防御 — 触发 direction flip 后, 在路径长度
//     增长到此值之前禁止再次反向 flip. 0 表示无限制.
//
// 算法:
//   - aStarSearch: 用 admissible haversine heuristic 跑单条最短路径
//   - aStarSearchWithBans: 禁用一组 LG 边 / LG 节点, 给 Yen's 用
//   - yensKShortest: Yen's loopless K-shortest paths, 在乘积图上
// ============================================================

import type { EntityRef } from "./primitives";
import type { GraphPort } from "./pathfinding-v2-graph-port";
import type {
  LineGraph,
  LineGraphEdge,
  LGNodeId,
} from "./pathfinding-v2-line-graph";

// ── 1. Types ─────────────────────────────────────────────────

/** 搜索状态: 乘积图节点 */
export interface SearchState {
  lgNodeId: LGNodeId;
  chainProgressIndex: number;
  turnbackLayer: number;
  /** 触发 direction flip 后保留的距离阈值. 在 gScore < 此值时禁止反向 flip. */
  blockedFlipUntilLength: number;
}

/** 路径上的一步: 当前 LG node + 到此处的 g 距离 */
export interface SearchPathStep {
  state: SearchState;
  edgeInto: LineGraphEdge | null; // null = 起点
  gScore: number;
}

/** 搜索结果: 一条完整路径 */
export interface SearchPath {
  steps: SearchPathStep[];
  totalDistance: number;
  /** 在 steps 中 turnback 边的索引集合 */
  turnbackStepIndices: number[];
}

/** Yen K-shortest 输出 */
export interface KShortestResult {
  paths: SearchPath[];
  /** A* 搜索次数 (Yen 内部一次 + spur 多次) */
  searchInvocations: number;
  /** 总扩展节点数 */
  totalExpansions: number;
}

/** 起点描述 */
export interface SearchStart {
  state: SearchState;
  /** 起点距离基线 (一般 0; 若起点已穿过某段, 可加偏置) */
  gScoreBias?: number;
}

/** 终点判定函数 — 用 closure 表达, 支持多目标 / chain 终态约束 */
export type SearchGoalPredicate = (state: SearchState, lg: LineGraph) => boolean;

/** A* heuristic 函数 — admissible (lower bound on remaining distance) */
export type SearchHeuristic = (state: SearchState, lg: LineGraph) => number;

/** 状态转移 hook — 决定从 (state, edge) 后的新 state, 或 null 拒绝 */
export type StateTransitionFn = (
  prev: SearchState,
  edge: LineGraphEdge,
  lg: LineGraph,
) => SearchState | null;

export interface AStarOptions {
  lg: LineGraph;
  starts: SearchStart[];
  isGoal: SearchGoalPredicate;
  heuristic: SearchHeuristic;
  transition: StateTransitionFn;
  /** 禁用的 LG 边集合 (Yen spur search 用) */
  bannedEdges?: Set<string>;
  /** 禁用的 LG node 集合 (Yen spur 防回环用) */
  bannedNodes?: Set<LGNodeId>;
  /** 最大扩展节点数 (防爆炸 fallback). 默认 200_000 */
  maxExpansions?: number;
  /** 全局 timeout (ms). 默认 5000 */
  timeoutMs?: number;
  /** Debug 钩子: 输出每次扩展的详情 */
  debug?: boolean;
}

// ── 2. Binary Heap (手写, 避免外部依赖) ──────────────────────

interface HeapItem<T> {
  priority: number;
  value: T;
}

class MinHeap<T> {
  private items: HeapItem<T>[] = [];

  get length(): number {
    return this.items.length;
  }

  push(priority: number, value: T): void {
    this.items.push({ priority, value });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapItem<T> | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[i].priority < this.items[parent].priority) {
        [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  private bubbleDown(i: number): void {
    const n = this.items.length;
    while (true) {
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      let best = i;
      if (l < n && this.items[l].priority < this.items[best].priority) best = l;
      if (r < n && this.items[r].priority < this.items[best].priority) best = r;
      if (best === i) break;
      [this.items[i], this.items[best]] = [this.items[best], this.items[i]];
      i = best;
    }
  }
}

// ── 3. A* Search ─────────────────────────────────────────────

/**
 * 单条最短路径 A*. 返回 null 表示找不到.
 *
 * 关键设计:
 *   - 状态 closeSet 用复合 key 防止乘积图同状态重复扩展
 *   - bannedEdges / bannedNodes 给 Yen spur search 用
 *   - heuristic 必须 admissible (≤ 实际剩余距离)
 */
export function aStarSearch(opts: AStarOptions): SearchPath | null {
  const {
    lg,
    starts,
    isGoal,
    heuristic,
    transition,
    bannedEdges,
    bannedNodes,
    maxExpansions = 200_000,
    timeoutMs = 5000,
    debug = false,
  } = opts;

  const startTime = nowMs();
  const heap = new MinHeap<{
    state: SearchState;
    edgeInto: LineGraphEdge | null;
    gScore: number;
    parent: { state: SearchState; edgeInto: LineGraphEdge | null; parent: any } | null;
  }>();

  // closed set: stateKey → 已知最优 g
  const closed = new Map<string, number>();

  for (const s of starts) {
    const h = heuristic(s.state, lg);
    heap.push((s.gScoreBias ?? 0) + h, {
      state: s.state,
      edgeInto: null,
      gScore: s.gScoreBias ?? 0,
      parent: null,
    });
  }

  let expansions = 0;
  let rejectedByTransition = 0;
  while (heap.length > 0) {
    if (expansions >= maxExpansions) {
      if (debug) console.log("[A* debug] reached maxExpansions=%d", maxExpansions);
      break;
    }
    if (nowMs() - startTime > timeoutMs) {
      if (debug) console.log("[A* debug] timeout");
      break;
    }

    const top = heap.pop()!.value;
    const key = stateKey(top.state);
    const prevG = closed.get(key);
    if (prevG !== undefined && prevG <= top.gScore) continue;
    closed.set(key, top.gScore);
    expansions += 1;

    if (isGoal(top.state, lg)) {
      if (debug) console.log("[A* debug] GOAL at %s after %d expansions", key, expansions);
      return reconstructPath(top);
    }

    const outEdges = lg.outgoing.get(top.state.lgNodeId) ?? [];
    for (const edge of outEdges) {
      if (bannedEdges?.has(lgEdgeKey(edge))) continue;
      if (bannedNodes?.has(edge.toLG)) continue;

      const nextState = transition(top.state, edge, lg);
      if (!nextState) {
        rejectedByTransition += 1;
        continue;
      }

      const newG = top.gScore + edge.weight;
      const nextKey = stateKey(nextState);
      const prevNG = closed.get(nextKey);
      if (prevNG !== undefined && prevNG <= newG) continue;

      const h = heuristic(nextState, lg);
      heap.push(newG + h, {
        state: nextState,
        edgeInto: edge,
        gScore: newG,
        parent: top,
      });
    }
  }
  if (debug) {
    console.log("[A* debug] EXHAUSTED. expansions=%d rejectedByTransition=%d",
      expansions, rejectedByTransition);
  }
  return null;
}

// ── 4. Yen K-Shortest ────────────────────────────────────────

export interface YensOptions {
  lg: LineGraph;
  starts: SearchStart[];
  isGoal: SearchGoalPredicate;
  heuristic: SearchHeuristic;
  transition: StateTransitionFn;
  /** K = 期望返回的路径数 */
  K: number;
  /** 单次 A* 最大扩展数 */
  maxExpansions?: number;
  /** 全局总 timeout */
  timeoutMs?: number;
  /** Debug 输出 */
  debug?: boolean;
}

export function yensKShortest(opts: YensOptions): KShortestResult {
  const { lg, starts, isGoal, heuristic, transition, K, maxExpansions, timeoutMs, debug } = opts;
  const startTime = nowMs();

  const confirmed: SearchPath[] = [];
  const pool = new MinHeap<SearchPath>();
  const dedup = new Set<string>();
  let searchInvocations = 0;
  let totalExpansions = 0;

  // 第 1 条最短
  const first = aStarSearch({
    lg, starts, isGoal, heuristic, transition,
    maxExpansions, timeoutMs, debug,
  });
  searchInvocations += 1;
  if (!first) {
    return { paths: [], searchInvocations, totalExpansions };
  }
  confirmed.push(first);
  dedup.add(pathHash(first));

  for (let k = 1; k < K; k++) {
    if (nowMs() - startTime > (timeoutMs ?? 5000)) break;
    const prev = confirmed[k - 1];

    for (let i = 0; i < prev.steps.length - 1; i++) {
      // spur node: prev.steps[i]
      // root path: prev.steps[0..i]
      const spurStart = prev.steps[i];
      const rootSteps = prev.steps.slice(0, i + 1);

      // 禁用所有 confirmed 路径中 root 段相同时第 i+1 条边
      const bannedEdges = new Set<string>();
      for (const cp of confirmed) {
        if (cp.steps.length > i + 1 && stepsEqualUpTo(cp.steps, rootSteps, i + 1)) {
          const banEdge = cp.steps[i + 1].edgeInto;
          if (banEdge) bannedEdges.add(lgEdgeKey(banEdge));
        }
      }

      // 禁用 root 上已访问的 LG node (防止 spur 路径成环)
      const bannedNodes = new Set<LGNodeId>();
      for (let j = 0; j < i; j++) {
        bannedNodes.add(rootSteps[j].state.lgNodeId);
      }

      const spurPath = aStarSearch({
        lg,
        starts: [{ state: spurStart.state, gScoreBias: spurStart.gScore }],
        isGoal,
        heuristic,
        transition,
        bannedEdges,
        bannedNodes,
        maxExpansions,
        timeoutMs,
        // 不开 debug 输出 (spur 多次会噪声)
      });
      searchInvocations += 1;
      if (!spurPath) continue;

      const fullPath = concatPaths(rootSteps, spurPath);
      const h = pathHash(fullPath);
      if (dedup.has(h)) continue;
      dedup.add(h);

      pool.push(fullPath.totalDistance, fullPath);
    }

    if (pool.length === 0) break;
    confirmed.push(pool.pop()!.value);
  }

  return { paths: confirmed, searchInvocations, totalExpansions };
}

// ── 5. Helpers ───────────────────────────────────────────────

export function stateKey(s: SearchState): string {
  return `${s.lgNodeId}|${s.chainProgressIndex}|${s.turnbackLayer}|${s.blockedFlipUntilLength}`;
}

export function lgEdgeKey(e: LineGraphEdge): string {
  return `${e.fromLG}|${e.toLG}|${e.kind}`;
}

function reconstructPath(node: any): SearchPath {
  const steps: SearchPathStep[] = [];
  let cur: any = node;
  while (cur) {
    steps.unshift({
      state: cur.state,
      edgeInto: cur.edgeInto,
      gScore: cur.gScore,
    });
    cur = cur.parent;
  }
  const turnbackIdx: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].edgeInto?.kind === "turnback") turnbackIdx.push(i);
  }
  return {
    steps,
    totalDistance: steps[steps.length - 1].gScore,
    turnbackStepIndices: turnbackIdx,
  };
}

function pathHash(p: SearchPath): string {
  return p.steps.map((s) => s.state.lgNodeId).join("→");
}

function stepsEqualUpTo(
  a: SearchPathStep[],
  b: SearchPathStep[],
  n: number,
): boolean {
  for (let i = 0; i < n; i++) {
    if (a[i].state.lgNodeId !== b[i].state.lgNodeId) return false;
    if (a[i].state.chainProgressIndex !== b[i].state.chainProgressIndex) return false;
    if (a[i].state.turnbackLayer !== b[i].state.turnbackLayer) return false;
  }
  return true;
}

function concatPaths(root: SearchPathStep[], spur: SearchPath): SearchPath {
  // root 的最后一个 step 与 spur 的第一个 step 是同一个状态 (spurStart). 去重.
  const merged: SearchPathStep[] = [...root, ...spur.steps.slice(1)];
  const turnbackIdx: number[] = [];
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].edgeInto?.kind === "turnback") turnbackIdx.push(i);
  }
  return {
    steps: merged,
    totalDistance: merged[merged.length - 1].gScore,
    turnbackStepIndices: turnbackIdx,
  };
}

// ── 6. Default Heuristic 工厂 ────────────────────────────────

/**
 * 默认 admissible heuristic: 当前 LG node 的 exitCoord 到任一 goal 坐标的最小球面距离.
 * goal 坐标列表可包含 target nodes / target edges 的几何坐标.
 */
export function createHaversineHeuristic(
  port: GraphPort,
  goalCoords: Array<[number, number]>,
): SearchHeuristic {
  if (goalCoords.length === 0) {
    return () => 0;
  }
  return (state: SearchState, lg: LineGraph): number => {
    const node = lg.nodes.get(state.lgNodeId);
    if (!node || !node.exitCoord) return 0;
    let min = Infinity;
    for (const g of goalCoords) {
      const d = port.haversineDistanceBetween(node.exitCoord, g);
      if (d < min) min = d;
    }
    return min;
  };
}

// ── 7. Utility ───────────────────────────────────────────────

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
