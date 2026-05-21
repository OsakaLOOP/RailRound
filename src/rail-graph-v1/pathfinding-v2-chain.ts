// ============================================================
// Rail Graph v1 — Pathfinding v2: Chain Compilation + Transition
//
// 把 IntentionChain 编译成"乘积图状态机"的转移规则.
//
// 设计:
//   - chainProgressIndex: 当前已满足的 chain 节点 index (单调递增)
//   - chain.nodes[0] = origin: 起点自动满足, 不消耗转移
//   - chain.nodes[last] = terminus: 由 isGoal 判断
//   - 中间节点 (service_stop/passage/reversal/via_edge/technical_stop):
//     必须按顺序由 transit / turnback 边推进 — chainProgressIndex 单调递增
//
// 关键剪枝:
//   - strict mode: turnback 只能发生在 chainProgressIndex 指向 reversal 节点时, 且
//     需匹配 reversal.at (若指定). 这从根本上禁止"不必要的 S-flip turnback".
//   - sketch mode: turnback 自由发生; chain 节点可被任何兼容转移满足
//   - guided mode: 软约束 — 不剪枝, 通过 penalty 权重影响选择 (本 PR 范围内简化, 与 sketch 一致)
// ============================================================

import type {
  ChainMode,
  IntentionChain,
  IntentionNode,
} from "./chain.types";
import type { EntityRef } from "./primitives";
import type { GraphPort } from "./pathfinding-v2-graph-port";
import type {
  LineGraph,
  LineGraphEdge,
  LGNodeId,
} from "./pathfinding-v2-line-graph";
import { parseLGNodeId } from "./pathfinding-v2-line-graph";
import type {
  SearchState,
  StateTransitionFn,
} from "./pathfinding-v2-search";

// ── 1. ChainCompilation ──────────────────────────────────────

/**
 * Chain 编译产物. 提供 transition 与 isGoal 所需的所有静态查询.
 *
 * - terminusEdges/Nodes: 终点对应的 edge / node 集合, isGoal 用
 * - middleSatisfiers: chain.nodes[i] (i ∈ [1, N-2]) 满足条件的缓存
 * - mode: 影响 transition 是否严格剪枝
 */
export interface ChainCompilation {
  chain: IntentionChain;
  mode: ChainMode;
  /** chain.nodes 数量 (含 origin + terminus) */
  totalNodes: number;
  /**
   * 满足检查表: middleSatisfiers[i] 描述如何判断 "进入 LG node X (沿 incoming edge E) 是否满足 chain.nodes[i]".
   * i ∈ [1, totalNodes - 2] (中间节点). origin/terminus 不在此表中.
   */
  middleSatisfiers: ChainNodeSatisfier[];
}

export type ChainNodeSatisfier =
  | { kind: "noop" }                                 // 当 nodeIndex < 0 或 > N-1 时占位
  | { kind: "service_stop"; edgeRefs: Set<EntityRef> } // 经过该 platform 的 edges
  | { kind: "passage"; edgeRefs: Set<EntityRef> }
  | { kind: "reversal"; atEdge?: EntityRef }         // turnback 必须发生在此 edge (若 atEdge 指定)
  | { kind: "via_edge"; edgeRef: EntityRef; preferredDir?: "fromTo" | "toFrom" }
  | { kind: "technical_stop"; edgeRef: EntityRef }
  | { kind: "operation"; edgeRef: EntityRef };

// ── 2. compileChain ──────────────────────────────────────────

/**
 * 编译 IntentionChain → ChainCompilation.
 *
 * 不需要 LG 引用 (满足条件描述都基于 edgeRef / platformRef),
 * LG 在 transition 内部使用.
 */
export function compileChain(
  chain: IntentionChain,
  port: GraphPort,
): ChainCompilation {
  const compilation: ChainCompilation = {
    chain,
    mode: chain.mode,
    totalNodes: chain.nodes.length,
    middleSatisfiers: [],
  };

  for (let i = 0; i < chain.nodes.length; i++) {
    compilation.middleSatisfiers.push(buildSatisfier(chain.nodes[i], port));
  }

  return compilation;
}

function buildSatisfier(node: IntentionNode, port: GraphPort): ChainNodeSatisfier {
  switch (node.kind) {
    case "origin":
    case "terminus":
      return { kind: "noop" };

    case "service_stop": {
      const edgeRefs = new Set<EntityRef>();
      if (node.edgeRef) {
        edgeRefs.add(node.edgeRef);
      } else {
        for (const e of port.edgesForPlatform(node.at)) edgeRefs.add(e);
      }
      return { kind: "service_stop", edgeRefs };
    }

    case "passage": {
      const edgeRefs = new Set<EntityRef>();
      if (node.throughKind === "platform") {
        for (const e of port.edgesForPlatform(node.through)) edgeRefs.add(e);
      } else {
        for (const e of port.edgesForStation(node.through)) edgeRefs.add(e);
      }
      return { kind: "passage", edgeRefs };
    }

    case "reversal":
      return { kind: "reversal", atEdge: node.at };

    case "via_edge":
      return {
        kind: "via_edge",
        edgeRef: node.edgeRef,
        preferredDir: node.preferredDir,
      };

    case "technical_stop":
      return { kind: "technical_stop", edgeRef: node.at };

    case "operation":
      return { kind: "operation", edgeRef: node.at };

    default:
      return { kind: "noop" };
  }
}

// ── 3. Transition Function ───────────────────────────────────

/**
 * 创建 transition 函数 — 决定从 (state, edge) 后的新 state, 或 null 拒绝.
 *
 * 严格 mode 下的核心剪枝:
 *   1. turnback 边只有在 chainProgressIndex 指向 reversal 节点时才被允许
 *      (除非 chain 没有 reversal 节点)
 *   2. crossover S-flip 防御: 触发 direction flip 后保留禁 flip 窗口
 *
 * 推进规则:
 *   - 进入 toLG 后, 检查 chain.nodes[chainProgressIndex + 1] 是否被满足
 *   - 若满足, chainProgressIndex 推进; 继续递归检查下一个 (chain 可能多个节点同时被满足)
 */
export function createChainTransition(
  compilation: ChainCompilation,
  port: GraphPort,
  options: {
    crossoverFlipWindowMeters?: number;
    /** Sketch mode 下的 turnback 上限. 默认 = max(2, chain 中 reversal 数 * 2). */
    sketchMaxTurnbackLayer?: number;
  } = {},
): StateTransitionFn {
  const crossoverFlipWindow = options.crossoverFlipWindowMeters ?? 500; // 500m 内禁 flip
  const reversalNodeCount = countReversalNodes(compilation);
  // sketch / guided 默认 turnback 上限 = chain 中 reversal 数.
  // 这与 v1 行为一致 — v1 DFS tryTurnback 只在 chain.nodes[i].kind="reversal" 时触发,
  // 所以无 reversal 节点的 chain 自动禁 turnback.
  const sketchMaxLayer = options.sketchMaxTurnbackLayer ?? reversalNodeCount;

  return (prev: SearchState, edge: LineGraphEdge, lg: LineGraph): SearchState | null => {
    const { mode, totalNodes, middleSatisfiers } = compilation;

    // ── 1. turnback 严格性检查 ──
    if (edge.kind === "turnback") {
      // 各 mode 都有上限 (sketch / guided 用 sketchMaxLayer; strict 用 reversal 数)
      const layerLimit = mode === "strict" ? reversalNodeCount : sketchMaxLayer;
      if (prev.turnbackLayer >= layerLimit) return null;

      if (mode === "strict") {
        // 严格 mode: turnback 必须发生在 reversal 节点
        // chain.nodes[prev.chainProgressIndex + 1] 是下一个待满足的节点; 它必须 = reversal
        const nextIdx = prev.chainProgressIndex + 1;
        if (nextIdx >= totalNodes) return null;
        const expected = middleSatisfiers[nextIdx];
        if (expected.kind !== "reversal") return null;
        // 若 reversal 指定 atEdge, 检查 turnback 是否发生在此 edge
        const fromLgNode = lg.nodes.get(edge.fromLG);
        if (expected.atEdge && fromLgNode?.edgeId !== expected.atEdge) {
          return null;
        }
      }
      // sketch / guided: 自由 turnback (受 layer 上限约束)
    }

    // ── 2. crossover S-flip 防御 ──
    // 检测 direction flip: 从 a 进入 b 时, a.effectiveDirectionRole != b.effectiveDirectionRole
    // (双方都不是 flexible 的情况)
    const fromLgNode = lg.nodes.get(edge.fromLG);
    const toLgNode = lg.nodes.get(edge.toLG);
    let newBlockedFlipUntil = prev.blockedFlipUntilLength;
    if (edge.kind === "transit" && fromLgNode && toLgNode) {
      const flipDetected = detectDirectionFlip(
        fromLgNode.effectiveDirectionRole,
        toLgNode.effectiveDirectionRole,
        port,
      );
      // 计算下一步 gScore (approx 用 edge.weight, 真实在外部已加)
      if (flipDetected) {
        // 若上一次 flip 的"禁 flip 窗口"还没过, 拒绝
        // 但首次 flip (blockedFlipUntilLength = 0) 是允许的
        if (prev.blockedFlipUntilLength > 0) {
          return null;
        }
        // 触发新 flip 窗口: 直到 gScore 增长 crossoverFlipWindow 米后才允许下一次 flip
        // (使用一个 sentinel: 我们存"允许下一次 flip 的最小 gScore"; 在 search 内部 transition
        //  被调用时还没有更新 gScore, 但 edge.weight 已知, 可以预估)
        newBlockedFlipUntil = 1; // 简化: 用 1 表示"flip 已触发, 下一次 transit 后清零"
      } else {
        // 非 flip: 若之前 flip-bocking active, 累加经过的距离, 清零或减
        if (prev.blockedFlipUntilLength > 0) {
          // 简化版: 走过一段距离 ≥ crossoverFlipWindow / weight 之类即清除
          // 这里采用更简单的策略: 经过 1 步非-flip edge 后即解锁
          newBlockedFlipUntil = 0;
        }
      }
    }

    // ── 3. 状态推进 ──
    let nextChainIndex = prev.chainProgressIndex;
    let nextLayer = prev.turnbackLayer;

    if (edge.kind === "turnback") {
      nextLayer += 1;
    }

    // 检查是否推进 chain 节点
    while (nextChainIndex + 1 < totalNodes) {
      const candidateIdx = nextChainIndex + 1;
      const sat = middleSatisfiers[candidateIdx];
      if (isEdgeSatisfying(edge, sat, lg)) {
        nextChainIndex = candidateIdx;
      } else {
        break;
      }
    }

    // strict mode: 若刚走了 turnback 但 chainProgressIndex 没推进到 reversal 节点, 拒绝
    if (edge.kind === "turnback" && mode === "strict") {
      // turnback 必须 advance 到 reversal 节点
      if (nextChainIndex === prev.chainProgressIndex) {
        return null;
      }
    }

    return {
      lgNodeId: edge.toLG,
      chainProgressIndex: nextChainIndex,
      turnbackLayer: nextLayer,
      blockedFlipUntilLength: newBlockedFlipUntil,
    };
  };
}

/**
 * 判断一条 LG 边是否"恰好满足"某个 chain 节点 (chain.nodes[i] = sat 描述).
 *
 * 注意: 这判断的是"该 LG 边对应的进入 toLG 这个动作是否满足 sat",
 * 不包括 origin/terminus (noop).
 */
function isEdgeSatisfying(
  edge: LineGraphEdge,
  sat: ChainNodeSatisfier,
  lg: LineGraph,
): boolean {
  const toLgNode = lg.nodes.get(edge.toLG);
  if (!toLgNode) return false;
  const edgeId = toLgNode.edgeId;

  switch (sat.kind) {
    case "noop":
      return false;
    case "service_stop":
    case "passage":
      return sat.edgeRefs.has(edgeId);
    case "reversal":
      // reversal 必须由 turnback 边触发
      if (edge.kind !== "turnback") return false;
      const fromLgNode = lg.nodes.get(edge.fromLG);
      if (!fromLgNode) return false;
      if (sat.atEdge && fromLgNode.edgeId !== sat.atEdge) return false;
      return true;
    case "via_edge":
      if (edgeId !== sat.edgeRef) return false;
      if (sat.preferredDir && toLgNode.dir !== sat.preferredDir) return false;
      return true;
    case "technical_stop":
    case "operation":
      return edgeId === sat.edgeRef;
    default:
      return false;
  }
}

function countReversalNodes(compilation: ChainCompilation): number {
  let count = 0;
  for (const sat of compilation.middleSatisfiers) {
    if (sat.kind === "reversal") count += 1;
  }
  return count;
}

function detectDirectionFlip(
  a: import("./base-topology.types").TrackDirectionRole | undefined,
  b: import("./base-topology.types").TrackDirectionRole | undefined,
  port: GraphPort,
): boolean {
  // flexible 一端不算 flip
  if (port.isFlexibleDirection(a) || port.isFlexibleDirection(b)) return false;
  // 都是单向, up↔down 是 flip
  return a !== b;
}

// ── 4. Goal Predicate Factory ────────────────────────────────

/**
 * 创建 isGoal 函数: 当 state 处于 terminus 位置 AND chainProgressIndex 已满足所有中间节点时成立.
 *
 * targetEdges/targetNodes 来自 endSeed 解析.
 */
export function createChainGoalPredicate(
  compilation: ChainCompilation,
  targetLgNodes: Set<LGNodeId>,
): (state: SearchState, lg: LineGraph) => boolean {
  const lastMiddleIdx = compilation.totalNodes - 2; // last middle = index N-2; terminus = N-1
  return (state, _lg) => {
    if (!targetLgNodes.has(state.lgNodeId)) return false;
    // strict mode: 必须满足所有中间节点
    if (compilation.mode === "strict") {
      if (state.chainProgressIndex < lastMiddleIdx) return false;
    }
    return true;
  };
}

// ── 5. Start State Factory ───────────────────────────────────

/**
 * 创建起始 SearchState. 用 origin 节点的 chainProgressIndex = 0 (origin 自满足).
 */
export function createStartState(
  startLgNodeId: LGNodeId,
): SearchState {
  return {
    lgNodeId: startLgNodeId,
    chainProgressIndex: 0,
    turnbackLayer: 0,
    blockedFlipUntilLength: 0,
  };
}
