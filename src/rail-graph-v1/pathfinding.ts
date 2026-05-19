// ============================================================
// Rail Graph v1 — Pathfinding (Layer 2 admin editing 初步)
//
// 在固定的 BaseTopologyLayer 上做带方向语义的全量简单路径枚举。
// 输入: PathSeed (起点 / 终点描述符), 输出: PathfindingResult[]
//   - traceSequence 复用 ServiceTraceEntry, 保留 "停留 X 站 X 站台" 语义
//   - phases 区分 up_run / down_run / turnback, 表达 "上行经过 / 下行经过 / 换向"
//
// 设计原则 (来自 docs/rail-graph-v1-plan/10-拓扑分层与启发式边界补丁.md):
//   - 寻径属于 Layer 2 admin editing, 不污染 Layer 1 base topology
//   - 不从位置/binding 反推 edge 角色, 仅依据 annotation 显式声明
//   - 换向 (turnback) 必须由 edge.functionalUse 显式声明, 不可推断
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type {
  BaseTopologyLayer,
  TopologyEdge,
  TrackDirectionRole,
} from "./base-topology.types";
import type { EntityRef } from "./primitives";
import type {
  ServicePathSegment,
  ServicePassEntry,
  ServiceStopEntry,
  ServiceTraceEntry,
} from "./service-template.types";
import type { PathGenerationRuleTrace } from "./editing.types";
import type { TopologyLookup } from "./topology";
import {
  isDirectionRoleCompatible,
  isTurnbackAllowed,
  oppositeDirectionRole,
} from "./topology";
import { calculateTurnAngle } from "./geometry-math";
import type {
  ChainEndpointAnchor,
  IntentionChain,
  IntentionNode,
  ResolvedChain,
} from "./chain.types";
import type { PhaseSequence, CoarseRunPhase } from "./phase.types";
import {
  chainToTraceSequence,
  compileChainToConstraints,
  createImplicitChain,
  inferSketchChain,
  resolveChain,
  validateChain,
} from "./chain";
import { buildPhaseSequence, phaseSequenceToCoarsePhases } from "./phase";

// ── 1. Path Seed ────────────────────────────────────────────

/**
 * 起点 / 终点描述符。三种 kind 表达不同的起点语义:
 *
 * - `node`:        从某 TopologyNode 出发, 可选 alongDirection 提示期望的方向角色
 *                  (例如 "上行线起点往前" → fromNode + alongDirection: "up_main")
 * - `platform`:    从某站台沿指定方向出发, 内部 resolve 到具体 binding edges
 *                  (例如 "PlatformC 往上行" → platform: PC + direction: "up")
 *                  ← MVP UI 主要入口
 * - `edgeMeasure`: 从某 edge 的某端点出发 (admin / debug 用)
 *                  measure 仅接受 0 (= fromNode) 或 1 (= toNode), 不切分 edge
 */
export type PathSeed =
  | PathSeedNode
  | PathSeedPlatform
  | PathSeedEdgeMeasure;

export interface PathSeedNode {
  kind: "node";
  nodeRef: EntityRef;
  /** 期望此处的运行方向角色, 用于约束第一条 edge 的选择 */
  alongDirection?: TrackDirectionRole;
}

export interface PathSeedPlatform {
  kind: "platform";
  platformRef: EntityRef;
  /** "up" / "down" 对应 PlatformTrackBinding.servingDirection 匹配 */
  direction: "up" | "down";
}

export interface PathSeedEdgeMeasure {
  kind: "edgeMeasure";
  edgeRef: EntityRef;
  /** 0 = fromNode 端开始; 1 = toNode 端开始。中部起点 MVP 暂不支持。 */
  measure: 0 | 1;
  /** true 沿 from→to 方向; false 沿 to→from 方向 */
  alongFromTo: boolean;
}

/**
 * Seed 解析后的内部规范态。 findPaths 内部使用。
 *
 * entryPoints 数组允许同一 seed 展开为多个候选起点
 * (例如岛式 platform 同时绑定两条 edge, 各对应一个 entryPoint)。
 * 算法将对每个 entryPoint 独立 DFS, 最后合并候选。
 */
export interface SeedResolution {
  entryPoints: SeedEntryPoint[];
  /** 期望的初始方向角色 (若 seed 暗示, 用于过滤首步) */
  initialDirectionRole?: TrackDirectionRole;
  /** 解析过程的诊断 */
  diagnostics: Diagnostic[];
}

export interface SeedEntryPoint {
  /** 寻径从此 node 出发 */
  startNodeRef: EntityRef;
  /**
   * 第一步必须经过的 edge。若 undefined, 算法自由选 outEdge。
   * 用于 platform / edgeMeasure seed 这类已经锁定首条 edge 的语义。
   */
  firstEdge?: EntityRef;
  /**
   * 起点对应 edge 的 physicalKind, 用于区分主线起步 vs 副线起步。
   * 主线起步是寻径默认推荐, 副线起步作为备选 (通常源于列车停留在到发线/中线).
   */
  startKind?: "main" | "siding";
}

// ── 2. Options ──────────────────────────────────────────────

export interface PathfindingOptions {
  /** 最大返回候选数, 默认 16 */
  maxCandidates?: number;
  /** 最大搜索深度 (edge 数), 默认 32 */
  maxDepth?: number;
  /** 允许中途换向, 默认 true */
  allowTurnback?: boolean;
  /** 每次换向时是否要求 edge 上已有 StoppingPoint, 默认 false (无 stopping point 也允许换向, 仅发 warn) */
  requireStoppingPointForTurnback?: boolean;
  /**
   * 是否接受副线 (siding) 起步候选, 默认 true.
   * 默认 true 时: 主线和副线起步候选都会出现, 主线优先排序.
   * 设 false 时: 仅返回主线起步候选, 副线 binding 被过滤掉.
   */
  allowSidingStarts?: boolean;
  /** 寻径目标规范 (停几次, 怎么停, 是否/如何换向). 默认 undefined = implicit = 不约束. */
  pathGoal?: PathGoal;
  /**
   * 运行意图链 — 比 pathGoal 更强表达。
   * 若同时提供 intentionChain 与 pathGoal, intentionChain 优先。
   * 二者皆缺时, 内部使用 createImplicitChain (origin + terminus 的 sketch chain)。
   */
  intentionChain?: IntentionChain;
}

// ── 3. Result ───────────────────────────────────────────────

export type PathPhaseKind = "up_run" | "down_run" | "turnback";

/**
 * 路径的一段, 对应 "上行经过 / 下行经过 / 换向" 语义。
 * - up_run / down_run: 一段连续同向运行, 经过若干 station/platform
 * - turnback:          在某 edge 上停车并反向, 不消耗距离, 但消耗一个 stop entry
 */
export interface PathPhase {
  phaseIndex: number;
  kind: PathPhaseKind;
  directionRole?: TrackDirectionRole;
  /** 在 edgeSequence 中的切片 (turnback phase 的 start === end, 表示就在该 edge 上换向) */
  edgeRange: { startIndex: number; endIndex: number };
  stationRefs: EntityRef[];
  distanceMeters: number;
}

/**
 * 寻径单条结果。
 *
 * - edgeSequence:  与 RunPath.edgeSequence 同形, 是底层 edge 顺序
 * - traceSequence: 与 RunPath.traceSequence 同形, 含 stop/pass entries
 *                  turnback 会生成一个 ServiceStopEntry { operationType: "turnback" }
 * - pathSegments:  与 RunPath.pathSegments 同形
 * - phases:        新增, 把 edgeSequence 切成可解释的方向段
 */
export interface PathfindingResult {
  edgeSequence: EntityRef[];
  traceSequence: ServiceTraceEntry[];
  pathSegments: ServicePathSegment[];
  phases: PathPhase[];
  totalDistanceMeters: number;
  /** 候选路径的起步类型 (main = 主线起步, siding = 副线/中线起步) */
  startKind: "main" | "siding";
  /** edgeSequence 中发生换向的索引集合 (供 view 层画 ⟲ 符号) */
  turnbackEdgeIndices: number[];
  ruleTrace: PathGenerationRuleTrace[];
  diagnostics: Diagnostic[];
  /** chain × path 合并产物 — 事件派生真源。 */
  resolvedChain?: ResolvedChain;
  /** RunPhase 三原语序列 (running / dwelling / departing) — phases 的细粒度真源。 */
  phaseSequence?: PhaseSequence;
}

// ── 4. Diagnostic Codes ─────────────────────────────────────

/**
 * Pathfinding 诊断 code 命名空间, MVP 阶段以字符串字面量使用。
 */
export const PathfindingDiagnosticCode = {
  SEED_PLATFORM_NO_BINDING: "PF_SEED_PLATFORM_NO_BINDING",
  SEED_PLATFORM_NO_DIRECTION_MATCH: "PF_SEED_PLATFORM_NO_DIRECTION_MATCH",
  SEED_NODE_NOT_FOUND: "PF_SEED_NODE_NOT_FOUND",
  SEED_EDGE_NOT_FOUND: "PF_SEED_EDGE_NOT_FOUND",
  NO_PATH_FOUND: "PF_NO_PATH_FOUND",
  MAX_DEPTH_REACHED: "PF_MAX_DEPTH_REACHED",
  MAX_CANDIDATES_REACHED: "PF_MAX_CANDIDATES_REACHED",
  TURNBACK_WITHOUT_STOP: "PF_TURNBACK_WITHOUT_STOP",
  TURNBACK_NOT_ALLOWED: "PF_TURNBACK_NOT_ALLOWED",
} as const;

export type PathfindingDiagnosticCodeKey = keyof typeof PathfindingDiagnosticCode;

// ── 4.1 PathGoal (寻径目标系统) ──────────────────────────────

/**
 * 寻径目标。描述"这次运行要干什么" — 停几次、在哪停、是否换向。
 * 默认为 undefined (等价 ImplicitGoal), 向后兼容。
 */
export type PathGoal = ImplicitGoal | ExplicitGoal | ShorthandGoal;

export interface ImplicitGoal {
  kind: "implicit";
}

export interface ExplicitGoal {
  kind: "explicit";
  stops: StopIntent[];
  turnback?: TurnbackIntent;
}

export type ShorthandGoal = {
  kind: "shorthand";
  pattern: ShorthandPattern;
};

export type ShorthandPattern =
  | "main_in_main_out_turnback_once"
  | "main_in_main_out_no_stop"
  | "stop_all"
  | "any";

export interface StopIntent {
  target:
    | { platformRef: EntityRef; edgeRef?: EntityRef }
    | { stationRef: EntityRef }
    | { kind: "arbitrary" };
  required: boolean;
}

export interface TurnbackIntent {
  edgeRef?: EntityRef;
  nearStationRef?: EntityRef;
  /** turnback 次数上限。DFS 中每触发一次减一, 剩余 0 时不再尝试 new turnback。undefined = 不限制 */
  count?: number;
  /** exact=true → 候选必须恰好满足 count (不足则后过滤移除); exact=false → 上限约束 */
  exact: boolean;
}

export const PathGoalDiagnosticCode = {
  NO_CANDIDATES_MEETING_GOAL: "PF_NO_CANDIDATES_MEETING_GOAL",
  REQUIRED_STOP_NOT_MET: "PF_REQUIRED_STOP_NOT_MET",
  TURNBACK_COUNT_VIOLATION: "PF_TURNBACK_COUNT_VIOLATION",
} as const;

// ── 5. Seed Resolver ───────────────────────────────────────

/**
 * 把 PathSeed 规范化为 SeedResolution。
 *
 * - node seed:        一个 entryPoint, startNodeRef = seed.nodeRef, 无 firstEdge
 * - platform seed:    每个 servingDirection 匹配的 binding 生成一个 entryPoint
 * - edgeMeasure seed: 一个 entryPoint, startNodeRef 由 measure 决定, firstEdge = seed.edgeRef
 */
export function resolveSeed(
  topo: BaseTopologyLayer,
  lookup: TopologyLookup,
  seed: PathSeed,
): SeedResolution {
  const diagnostics: Diagnostic[] = [];

  if (seed.kind === "node") {
    if (!lookup.nodesById[seed.nodeRef]) {
      diagnostics.push({
        level: "fatal",
        code: PathfindingDiagnosticCode.SEED_NODE_NOT_FOUND,
        stage: "resolveSeed",
        message: "Seed node does not exist in topology.",
        context: { nodeRef: seed.nodeRef },
      });
      return { entryPoints: [], diagnostics };
    }
    // node seed (常用于"线路尽头"如延伸段远端) 默认视为 main 起步
    return {
      entryPoints: [{ startNodeRef: seed.nodeRef, startKind: "main" }],
      initialDirectionRole: seed.alongDirection,
      diagnostics,
    };
  }

  if (seed.kind === "edgeMeasure") {
    const edge = lookup.edgesById[seed.edgeRef];
    if (!edge) {
      diagnostics.push({
        level: "fatal",
        code: PathfindingDiagnosticCode.SEED_EDGE_NOT_FOUND,
        stage: "resolveSeed",
        message: "Seed edge does not exist in topology.",
        context: { edgeRef: seed.edgeRef },
      });
      return { entryPoints: [], diagnostics };
    }
    const startNodeRef = seed.alongFromTo
      ? (seed.measure === 0 ? edge.fromNodeRef : edge.toNodeRef)
      : (seed.measure === 0 ? edge.toNodeRef : edge.fromNodeRef);
    // alongFromTo true + measure 0: 从 fromNode 进入沿 from→to → start = fromNode
    // alongFromTo true + measure 1: 从 toNode 进入沿 from→to (不合理, 但允许)
    // alongFromTo false + measure 0: 从 fromNode 出发沿 to→from (不可走该 edge, 但起点合法, firstEdge 留空)
    // 简化处理: firstEdge 仅在 alongFromTo 与 measure 一致时锁定
    const firstEdge = (seed.alongFromTo && seed.measure === 0) || (!seed.alongFromTo && seed.measure === 1)
      ? seed.edgeRef
      : undefined;
    return {
      entryPoints: [{ startNodeRef, firstEdge }],
      initialDirectionRole: edge.directionRole,
      diagnostics,
    };
  }

  // seed.kind === "platform"
  const bindings = lookup.bindingsByPlatform[seed.platformRef] ?? [];
  if (bindings.length === 0) {
    diagnostics.push({
      level: "fatal",
      code: PathfindingDiagnosticCode.SEED_PLATFORM_NO_BINDING,
      stage: "resolveSeed",
      message: "Platform has no PlatformTrackBinding; cannot resolve seed.",
      context: { platformRef: seed.platformRef },
    });
    return { entryPoints: [], diagnostics };
  }

  // 过滤匹配方向的 binding. servingDirection 缺失或为 "unknown" 字符串视为通配 (双向都可服务).
  const matched = bindings.filter((b) =>
    !b.servingDirection
    || b.servingDirection === "unknown"
    || b.servingDirection === seed.direction,
  );
  if (matched.length === 0) {
    diagnostics.push({
      level: "fatal",
      code: PathfindingDiagnosticCode.SEED_PLATFORM_NO_DIRECTION_MATCH,
      stage: "resolveSeed",
      message: "Platform has no binding matching the requested servingDirection.",
      context: { platformRef: seed.platformRef, direction: seed.direction },
    });
    return { entryPoints: [], diagnostics };
  }

  const entryPoints: SeedEntryPoint[] = [];
  let inferredDirectionRole: TrackDirectionRole | undefined;
  for (const binding of matched) {
    const edge = lookup.edgesById[binding.edgeRef];
    if (!edge) continue;
    // 决定 startNodeRef:
    //   - edge.directionRole 与 seed.direction 一致 → 沿 from→to, startNode = fromNode
    //   - edge.directionRole = opposite → 沿 to→from, startNode = toNode
    //   - edge.directionRole = bidirectional / reversible / undefined → 默认 fromNode
    const isUpSeed = seed.direction === "up";
    let startNodeRef: EntityRef;
    if (
      (isUpSeed && edge.directionRole === "down")
      || (!isUpSeed && edge.directionRole === "up")
    ) {
      startNodeRef = edge.toNodeRef;
    } else {
      startNodeRef = edge.fromNodeRef;
    }
    const startKind: "main" | "siding" = edge.physicalKind === "main" ? "main" : "siding";
    entryPoints.push({ startNodeRef, firstEdge: binding.edgeRef, startKind });
    if (!inferredDirectionRole && (edge.directionRole === "up" || edge.directionRole === "down")) {
      inferredDirectionRole = edge.directionRole;
    }
  }

  if (!inferredDirectionRole) {
    inferredDirectionRole = seed.direction === "up" ? "up" : "down";
  }

  // 主线起步在前, 副线起步在后 (默认推荐主线)
  entryPoints.sort((a, b) => {
    const aMain = a.startKind === "main" ? 0 : 1;
    const bMain = b.startKind === "main" ? 0 : 1;
    return aMain - bMain;
  });

  return {
    entryPoints,
    initialDirectionRole: inferredDirectionRole,
    diagnostics,
  };
}

// ── 6. findPaths — 全量 DFS 简单路径枚举 ────────────────────

/**
 * DFS 内部状态。引用语义, 通过 push/pop 在递归中复用。
 */
interface DfsState {
  currentNode: EntityRef;
  currentDirectionRole: TrackDirectionRole | undefined;
  edgeSequence: EntityRef[];
  /** 每条 edge 进入时的 fromNode (用于换向时确定"反向后到哪里") */
  edgeEntryNodes: EntityRef[];
  /** 在 edgeSequence[i] 上发生过换向, i 加入此 set; 同一 edge 不再换向 */
  turnbackAt: Set<number>;
  segmentVisitedEdges: Set<EntityRef>;
  totalDistanceMeters: number;
  /** 起点物理类型 — 跟随 entry point 决定, 不随 DFS 推进改变 */
  startKind: "main" | "siding";
  currentIntentionIndex: number;
  directionRoleHistory: (TrackDirectionRole | undefined)[];
}

/**
 * 命中后打包的原始候选, 后续 build 步骤再转 PathfindingResult。
 */
interface RawCandidate {
  edgeSequence: EntityRef[];
  edgeEntryNodes: EntityRef[];
  turnbackAt: number[];
  totalDistanceMeters: number;
  startKind: "main" | "siding";
  localDiagnostics: Diagnostic[];
}

/**
 * 拓扑可达性预检
 */
function isReachable(
  startNode: EntityRef,
  initialRole: TrackDirectionRole | undefined,
  targetEdge: EntityRef,
  lookup: TopologyLookup,
  adjacency: Record<string, EntityRef[]> | any,
): boolean {
  const visited = new Set<string>();
  const queue: { node: EntityRef; role: TrackDirectionRole | undefined; lastEdgeId: EntityRef | null }[] = [];
  queue.push({ node: startNode, role: initialRole, lastEdgeId: null });
  visited.add(`${startNode}:${initialRole}:null`);

  while (queue.length > 0) {
    const { node, role, lastEdgeId } = queue.shift()!;
    const outEdges = adjacency.outEdges[node] ?? [];
    for (const eid of outEdges) {
      if (eid === targetEdge) {
        if (lastEdgeId) {
          const edgeIn = lookup.edgesById[lastEdgeId];
          const edgeOut = lookup.edgesById[eid];
          if (edgeIn?.coordinates && edgeOut?.coordinates) {
            const nodeCoord = edgeIn.fromNodeRef === node ? edgeIn.coordinates[0] : edgeIn.coordinates[edgeIn.coordinates.length - 1];
            const angle = calculateTurnAngle(edgeIn.coordinates, edgeOut.coordinates, nodeCoord);
            if (angle >= 90) continue;
          }
        }
        return true;
      }
      const edge = lookup.edgesById[eid];
      if (!edge) continue;
      if (!isDirectionRoleCompatible(role, edge.directionRole)) continue;

      if (lastEdgeId) {
        const edgeIn = lookup.edgesById[lastEdgeId];
        const edgeOut = edge;
        if (edgeIn?.coordinates && edgeOut?.coordinates) {
          const nodeCoord = edgeIn.fromNodeRef === node ? edgeIn.coordinates[0] : edgeIn.coordinates[edgeIn.coordinates.length - 1];
          const angle = calculateTurnAngle(edgeIn.coordinates, edgeOut.coordinates, nodeCoord);
          if (angle >= 90) continue;
        }
      }

      const nextNode = edge.fromNodeRef === node ? edge.toNodeRef : edge.fromNodeRef;
      const nextRole = (edge.directionRole === "up" || edge.directionRole === "down") ? edge.directionRole : role;
      const stateKey = `${nextNode}:${nextRole}:${eid}`;
      if (!visited.has(stateKey)) {
        visited.add(stateKey);
        queue.push({ node: nextNode, role: nextRole, lastEdgeId: eid });
      }
    }
  }
  return false;
}

/**
 * 在固定拓扑上做带方向语义的全量简单路径枚举。
 *
 * 算法骨架: DFS + visitedEdges set + 可选 turnback 状态转换。
 * 命中 endSeed 后停止该分支, 收集候选, 全部跑完后按距离排序输出 top-maxCandidates。
 */
export function findPaths(
  topo: BaseTopologyLayer,
  lookup: TopologyLookup,
  startSeed: PathSeed,
  endSeed: PathSeed,
  options: PathfindingOptions = {},
): PathfindingResult[] {
  const maxCandidates = options.maxCandidates ?? 16;
  const maxDepth = options.maxDepth ?? 32;
  const allowTurnback = options.allowTurnback ?? true;
  const requireStopForTurnback = options.requireStoppingPointForTurnback ?? false;

  const diagnostics: Diagnostic[] = [];
  const ruleTrace: PathGenerationRuleTrace[] = [];

  const startRes = resolveSeed(topo, lookup, startSeed);
  const endRes = resolveSeed(topo, lookup, endSeed);
  diagnostics.push(...startRes.diagnostics, ...endRes.diagnostics);

  if (startRes.entryPoints.length === 0 || endRes.entryPoints.length === 0) {
    return [];
  }

  const targetEdges = new Set<EntityRef>();
  const targetNodes = new Set<EntityRef>();
  for (const ep of endRes.entryPoints) {
    if (ep.firstEdge) {
      targetEdges.add(ep.firstEdge);
    } else {
      targetNodes.add(ep.startNodeRef);
    }
  }

  const candidates: RawCandidate[] = [];
  const adjacency = topo.adjacency;
  let dfsIterations = 0;
  const DFS_LOG_INTERVAL = 20000; // 每 2 万次迭代输出一次进度

  // 过滤副线起步 (若 allowSidingStarts === false)
  const allowSiding = options.allowSidingStarts ?? true;
  const filteredEntryPoints = allowSiding
    ? startRes.entryPoints
    : startRes.entryPoints.filter((ep) => ep.startKind !== "siding");

  // 解析 IntentionChain (优先 options.intentionChain, 否则从 pathGoal 适配, 否则 implicit)
  const chain: IntentionChain = options.intentionChain
    ?? fromPathGoalToChain(options.pathGoal, startSeed, endSeed)
    ?? createImplicitChain(seedToAnchor(startSeed, "up"), seedToAnchor(endSeed));

  const chainValidationDiags = validateChain(chain);
  diagnostics.push(...chainValidationDiags);
  if (chainValidationDiags.some((d) => d.level === "error" || d.level === "fatal")) {
    return [];
  }

  const { constraints: chainConstraints, diagnostics: compileDiags } = compileChainToConstraints(chain, lookup);
  diagnostics.push(...compileDiags);

  // 地理意图连通性预检: 验证是否能到达 chain 中规定的首个关键掉头/停靠点
  const reachableEntryPoints: SeedEntryPoint[] = [];
  if (chain.mode === "strict") {
    let targetEdge: EntityRef | undefined;
    for (const node of chain.nodes) {
      if (node.kind === "reversal" && node.at) {
        targetEdge = node.at;
        break;
      } else if (node.kind === "service_stop" && node.edgeRef) {
        targetEdge = node.edgeRef;
        break;
      }
    }

    if (targetEdge) {
      for (const start of filteredEntryPoints) {
        const reachable = isReachable(
          start.startNodeRef,
          startRes.initialDirectionRole,
          targetEdge,
          lookup,
          adjacency,
        );
        if (reachable) {
          reachableEntryPoints.push(start);
        } else {
          diagnostics.push({
            level: "warn",
            code: PathfindingDiagnosticCode.NO_PATH_FOUND,
            stage: "findPaths",
            message: `Geographical Conflict: Target edge '${targetEdge}' is not reachable from start node '${start.startNodeRef}' with initial direction '${startRes.initialDirectionRole}'.`,
            context: { startNode: start.startNodeRef, targetEdge, directionRole: startRes.initialDirectionRole },
          });
        }
      }
    } else {
      reachableEntryPoints.push(...filteredEntryPoints);
    }
  } else {
    reachableEntryPoints.push(...filteredEntryPoints);
  }

  for (const start of reachableEntryPoints) {
    const initState = createInitialState(start, startRes.initialDirectionRole, lookup);
    if (!initState) continue;
    dfsExplore(initState);
  }

  console.log(`[pathfinding] DFS 完成: ${dfsIterations} iterations, ${candidates.length} raw candidates`);

  if (candidates.length === 0) {
    diagnostics.push({
      level: "warn",
      code: PathfindingDiagnosticCode.NO_PATH_FOUND,
      stage: "findPaths",
      message: "No simple path found between start and end seed.",
    });
    return [];
  }

  // 后过滤: chain 约束验证 (requiredStops / requiredPassages 必须按序在 path 上找到)
  const filtered = filterByChain(candidates, chain, chainConstraints, lookup, diagnostics);

  filtered.sort((a, b) => {
    const aIsMain = a.startKind === "main" ? 0 : 1;
    const bIsMain = b.startKind === "main" ? 0 : 1;
    if (aIsMain !== bIsMain) return aIsMain - bIsMain;
    return a.totalDistanceMeters - b.totalDistanceMeters;
  });
  const top = filtered.slice(0, maxCandidates);
  if (filtered.length > maxCandidates) {
    diagnostics.push({
      level: "info",
      code: PathfindingDiagnosticCode.MAX_CANDIDATES_REACHED,
      stage: "findPaths",
      message: "More candidates exist than maxCandidates; truncated.",
      context: { totalFound: candidates.length, kept: maxCandidates },
    });
  }

  return top.map((raw) => buildResultFromCandidate(raw, topo, lookup, ruleTrace, diagnostics, chain, startSeed, endSeed));

  // ─────────── DFS 闭包 ───────────

  function checkAndAdvanceIntention(state: DfsState): boolean {
    if (state.currentIntentionIndex >= chain.nodes.length) {
      return false;
    }
    const node = chain.nodes[state.currentIntentionIndex];
    const lastEdge = state.edgeSequence[state.edgeSequence.length - 1];

    if (node.kind === "service_stop") {
      if (!lastEdge) return false;
      const bindings = lookup.bindingsByPlatform[node.at] ?? [];
      const matchPlatform = bindings.some((b) => b.edgeRef === lastEdge);
      const matchEdge = node.edgeRef ? node.edgeRef === lastEdge : true;
      if (matchPlatform && matchEdge) {
        state.currentIntentionIndex += 1;
        return true;
      }
    } else if (node.kind === "passage") {
      if (!lastEdge) return false;
      if (node.throughKind === "platform") {
        const bindings = lookup.bindingsByPlatform[node.through] ?? [];
        const matchPlatform = bindings.some((b) => b.edgeRef === lastEdge);
        if (matchPlatform) {
          state.currentIntentionIndex += 1;
          return true;
        }
      }
    }
    return false;
  }

  function dfsExplore(state: DfsState): void {
    dfsIterations += 1;
    if (dfsIterations % DFS_LOG_INTERVAL === 0) {
      console.log(`[pathfinding] DFS ${dfsIterations} iterations, depth=${state.edgeSequence.length}, candidates=${candidates.length}`);
    }

    // 意图满足判定
    let advanced = true;
    while (advanced) {
      advanced = checkAndAdvanceIntention(state);
    }

    // 终点判定 (在尝试扩展前，且必须满足除 terminus 外的所有意图节点)
    const isTerminusIntention = state.currentIntentionIndex === chain.nodes.length - 1;
    if (isTerminusIntention) {
      const lastEdge = state.edgeSequence[state.edgeSequence.length - 1];
      if (lastEdge !== undefined && targetEdges.has(lastEdge)) {
        candidates.push(snapshotCandidate(state));
        return;
      }
      if (targetNodes.has(state.currentNode) && state.edgeSequence.length > 0) {
        candidates.push(snapshotCandidate(state));
        return;
      }
    }

    if (state.edgeSequence.length >= maxDepth) {
      return;
    }

    // 1) 换向选项: 仅当当前意图指向 reversal，且到达特定边时，方可按需折返
    if (allowTurnback && state.edgeSequence.length > 0) {
      const node = chain.nodes[state.currentIntentionIndex];
      if (node && node.kind === "reversal") {
        const lastIdx = state.edgeSequence.length - 1;
        const lastEdgeId = state.edgeSequence[lastIdx];
        const lastEdgeObj = lookup.edgesById[lastEdgeId];
        
        const matchLocation = !node.at || node.at === lastEdgeId;
        
        if (lastEdgeObj && matchLocation && isTurnbackAllowed(lastEdgeObj) && !state.turnbackAt.has(lastIdx)) {
          const hasStop = (lookup.stoppingPointsByEdge[lastEdgeId] ?? []).length > 0;
          const stopOk = !requireStopForTurnback || hasStop;
          if (stopOk) {
            tryTurnback(state, lastIdx, lastEdgeObj);
          }
        }
      }
    }

    // 2) 正常 outEdges 探索
    const outEdges = adjacency.outEdges[state.currentNode] ?? [];
    for (const candidateEdgeId of outEdges) {
      const edge = lookup.edgesById[candidateEdgeId];
      if (!edge) continue;

      // 物理级防振荡: 除非刚刚发生折返，否则禁止立刻原路返回前一条边
      if (state.edgeSequence.length > 0) {
        const lastIdx = state.edgeSequence.length - 1;
        const lastEdgeId = state.edgeSequence[lastIdx];
        if (candidateEdgeId === lastEdgeId) {
          if (!state.turnbackAt.has(lastIdx)) {
            continue;
          }
        }

        // 物理级防夹角转向过滤 (钝角偏转角拦截，即转角 >= 90°)
        if (!state.turnbackAt.has(lastIdx)) {
          const edgeIn = lookup.edgesById[lastEdgeId];
          const edgeOut = edge;
          if (edgeIn?.coordinates && edgeOut?.coordinates) {
            const nodeCoord = edgeIn.fromNodeRef === state.currentNode ? edgeIn.coordinates[0] : edgeIn.coordinates[edgeIn.coordinates.length - 1];
            const angle = calculateTurnAngle(edgeIn.coordinates, edgeOut.coordinates, nodeCoord);
            if (angle >= 90) {
              continue;
            }
          }
        }
      }

      // segment-based 去重: 隔离折返前后的探索集，绝对防止当前单向阶段回环
      if (state.segmentVisitedEdges.has(candidateEdgeId)) continue;

      if (edge.traversal === "forward" && edge.fromNodeRef !== state.currentNode) continue;
      if (!isDirectionRoleCompatible(state.currentDirectionRole, edge.directionRole)) continue;

      // 几何箭头一致性
      if (
        edge.traversal === "both" &&
        (edge.directionRole === "up" || edge.directionRole === "down")
      ) {
        const matchesDirection = state.currentDirectionRole === edge.directionRole;
        const enteringFromNode = state.currentNode === edge.fromNodeRef;
        if (matchesDirection !== enteringFromNode) continue;
      }

      pushEdge(state, edge);
      dfsExplore(state);
      popEdge(state, edge);
    }
  }

  function tryTurnback(state: DfsState, lastIdx: number, lastEdge: TopologyEdge): void {
    const enteredFrom = state.edgeEntryNodes[lastIdx];
    const reversedNode = enteredFrom;

    const prevNode = state.currentNode;
    const prevRole = state.currentDirectionRole;
    const opposite = oppositeDirectionRole(state.currentDirectionRole ?? "up");

    state.turnbackAt.add(lastIdx);
    state.currentNode = reversedNode;
    state.currentDirectionRole = opposite;

    const prevIntentionIndex = state.currentIntentionIndex;
    state.currentIntentionIndex += 1;

    // 折返开启新的单向阶段探索，清空当前阶段去重集
    const prevVisited = state.segmentVisitedEdges;
    state.segmentVisitedEdges = new Set();

    dfsExplore(state);

    state.currentIntentionIndex = prevIntentionIndex;
    state.turnbackAt.delete(lastIdx);
    state.currentNode = prevNode;
    state.currentDirectionRole = prevRole;
    state.segmentVisitedEdges = prevVisited;
  }

  function pushEdge(state: DfsState, edge: TopologyEdge): void {
    state.edgeSequence.push(edge.id);
    state.edgeEntryNodes.push(state.currentNode);
    state.segmentVisitedEdges.add(edge.id);
    state.totalDistanceMeters += edge.lengthMeters;

    state.directionRoleHistory.push(state.currentDirectionRole);

    const nextNode = edge.fromNodeRef === state.currentNode ? edge.toNodeRef : edge.fromNodeRef;
    state.currentNode = nextNode;
    if (edge.directionRole === "up" || edge.directionRole === "down") {
      state.currentDirectionRole = edge.directionRole;
    }
  }

  function popEdge(state: DfsState, edge: TopologyEdge): void {
    state.edgeSequence.pop();
    const entryNode = state.edgeEntryNodes.pop();
    state.segmentVisitedEdges.delete(edge.id);
    state.totalDistanceMeters -= edge.lengthMeters;
    if (entryNode !== undefined) {
      state.currentNode = entryNode;
    }
    state.currentDirectionRole = state.directionRoleHistory.pop();
  }
}

// ── Goal helper functions ────────────────────────────────────

function expandShorthandGoal(goal: PathGoal): ExplicitGoal {
  if (goal.kind === "explicit") return goal;
  if (goal.kind === "implicit") return { kind: "explicit", stops: [] };
  // shorthand → explicit
  const p = goal.pattern;
  if (p === "main_in_main_out_turnback_once") {
    return { kind: "explicit", stops: [], turnback: { count: 1, exact: true } };
  }
  if (p === "main_in_main_out_no_stop") {
    return { kind: "explicit", stops: [], turnback: { count: 0, exact: true } };
  }
  if (p === "stop_all") return { kind: "explicit", stops: [] };
  // "any" → implicit (no constraint)
  return { kind: "explicit", stops: [] };
}

// ── Chain 接入辅助 ──────────────────────────────────────────

/**
 * 把 PathSeed 转为 chain endpoint anchor + 方向 (用于 origin/terminus 节点)。
 * - node seed: 用 nodeRef + seed.alongDirection (origin) 或仅 nodeRef (terminus)
 * - platform seed: 取 platform 的首个 binding 的 edgeRef + measure 0
 * - edgeMeasure seed: 直接 edgeRef + measure
 */
function seedToAnchor(seed: PathSeed, defaultDirection: "up" | "down" = "up"): { at: ChainEndpointAnchor; direction: "up" | "down" } {
  if (seed.kind === "node") {
    const dir = seed.alongDirection === "down" ? "down" : (seed.alongDirection === "up" ? "up" : defaultDirection);
    return { at: { nodeRef: seed.nodeRef }, direction: dir };
  }
  if (seed.kind === "edgeMeasure") {
    return { at: { edgeRef: seed.edgeRef, measure: seed.measure }, direction: defaultDirection };
  }
  // platform seed → 简化: 用 platformRef 作为 nodeRef 占位 (实际定位由 DFS 的 firstEdge 处理)
  return { at: { nodeRef: seed.platformRef }, direction: seed.direction };
}

/**
 * 旧 PathGoal 兼容入口: 转换为 IntentionChain。
 * - implicit → sketch chain (origin + terminus)
 * - shorthand →
 *     no_stop:        strict chain (0 reversal)
 *     turnback_once:  strict chain (1 reversal, at 不指定)
 *     stop_all/any:   sketch chain (允许自由发挥)
 * - explicit → strict chain (按 stops + turnback 构建)
 */
function fromPathGoalToChain(
  goal: PathGoal | undefined,
  startSeed: PathSeed,
  endSeed: PathSeed,
): IntentionChain | null {
  if (!goal) return null;
  const origin = seedToAnchor(startSeed);
  const terminus = seedToAnchor(endSeed);

  if (goal.kind === "implicit") {
    return createImplicitChain(origin, terminus);
  }

  if (goal.kind === "shorthand") {
    switch (goal.pattern) {
      case "main_in_main_out_no_stop":
        return {
          mode: "strict",
          nodes: [
            { kind: "origin", at: origin.at, direction: origin.direction },
            { kind: "terminus", at: terminus.at },
          ],
        };
      case "main_in_main_out_turnback_once":
        return {
          mode: "strict",
          nodes: [
            { kind: "origin", at: origin.at, direction: origin.direction },
            { kind: "reversal", boarding: "none" },
            { kind: "terminus", at: terminus.at },
          ],
        };
      case "stop_all":
      case "any":
      default:
        return createImplicitChain(origin, terminus);
    }
  }

  // explicit
  const nodes: IntentionNode[] = [];
  nodes.push({ kind: "origin", at: origin.at, direction: origin.direction });
  for (const si of goal.stops) {
    if ("platformRef" in si.target) {
      nodes.push({
        kind: "service_stop",
        at: si.target.platformRef,
        edgeRef: si.target.edgeRef,
        boarding: "both",
      });
    }
    // stationRef / arbitrary 暂不映射
  }
  if (goal.turnback && goal.turnback.count !== undefined && goal.turnback.count > 0) {
    for (let i = 0; i < goal.turnback.count; i += 1) {
      nodes.push({
        kind: "reversal",
        at: goal.turnback.edgeRef,
        boarding: "none",
      });
    }
  }
  nodes.push({ kind: "terminus", at: terminus.at });
  return { mode: "strict", nodes };
}

/**
 * Chain 后过滤: 把候选 path 与 chain 节点尝试对齐, 不能对齐则移除。
 *
 * 算法借用 resolveChain — 若 resolveChain 产出 warn 级 diagnostic, 视为该候选不满足 chain。
 */
function filterByChain(
  candidates: RawCandidate[],
  chain: IntentionChain,
  constraints: ChainConstraintsLike,
  lookup: TopologyLookup,
  diagnostics: Diagnostic[],
): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const raw of candidates) {
    let ok = true;

    // strict: required stops 必须全在 path 上
    if (chain.mode === "strict") {
      for (const rs of constraints.requiredStops) {
        const bindings = lookup.bindingsByPlatform[rs.platformRef] ?? [];
        const found = raw.edgeSequence.some((eid) => bindings.some((b) => b.edgeRef === eid));
        if (!found) {
          ok = false;
          raw.localDiagnostics.push({
            level: "warn",
            code: PathGoalDiagnosticCode.REQUIRED_STOP_NOT_MET,
            stage: "filterByChain",
            message: "Candidate does not pass through required stop platform.",
            context: { platformRef: rs.platformRef },
          });
          break;
        }
      }
      if (!ok) continue;

      // strict: required passages 必须全在 path 上
      for (const rp of constraints.requiredPassages) {
        if (rp.throughKind === "platform") {
          const bindings = lookup.bindingsByPlatform[rp.throughRef] ?? [];
          const found = raw.edgeSequence.some((eid) => bindings.some((b) => b.edgeRef === eid));
          if (!found) {
            ok = false;
            raw.localDiagnostics.push({
              level: "warn",
              code: PathGoalDiagnosticCode.REQUIRED_STOP_NOT_MET,
              stage: "filterByChain",
              message: "Candidate does not pass through required passage platform.",
              context: { platformRef: rp.throughRef },
            });
            break;
          }
        }
      }
      if (!ok) continue;

      // strict: 实际 turnback 次数必须等于 chain 中 reversal 节点数
      if (raw.turnbackAt.length !== constraints.reversals.length) {
        raw.localDiagnostics.push({
          level: "warn",
          code: PathGoalDiagnosticCode.TURNBACK_COUNT_VIOLATION,
          stage: "filterByChain",
          message: `Candidate has ${raw.turnbackAt.length} turnbacks, strict chain requires exactly ${constraints.reversals.length}.`,
          context: { expected: constraints.reversals.length, actual: raw.turnbackAt.length },
        });
        continue;
      }

      // strict: 若 reversal 节点指定了 at, 实际 turnback edge 必须匹配
      for (let i = 0; i < constraints.reversals.length; i += 1) {
        const rev = constraints.reversals[i];
        if (!rev.at) continue;
        const tbIdx = raw.turnbackAt[i];
        if (raw.edgeSequence[tbIdx] !== rev.at) {
          ok = false;
          raw.localDiagnostics.push({
            level: "warn",
            code: PathGoalDiagnosticCode.TURNBACK_COUNT_VIOLATION,
            stage: "filterByChain",
            message: "Candidate reversal edge does not match chain.reversal.at.",
            context: { expected: rev.at, actual: raw.edgeSequence[tbIdx] },
          });
          break;
        }
      }
      if (!ok) continue;
    }
    // sketch: 不过滤, 全保留 (resolveChain 时反向推导 candidate chain)

    out.push(raw);
  }

  if (out.length === 0 && candidates.length > 0) {
    diagnostics.push({
      level: "warn",
      code: PathGoalDiagnosticCode.NO_CANDIDATES_MEETING_GOAL,
      stage: "filterByChain",
      message: "No candidate met all IntentionChain constraints.",
    });
  }
  return out;
}

/** ChainConstraints 的最小依赖 (避免循环) */
interface ChainConstraintsLike {
  requiredStops: { platformRef: EntityRef; edgeRef?: EntityRef; order: number }[];
  requiredPassages: { throughRef: EntityRef; throughKind: "platform" | "station"; order: number }[];
  reversals: { at?: EntityRef; order: number }[];
}

function createInitialState(
  start: SeedEntryPoint,
  initialRole: TrackDirectionRole | undefined,
  lookup: TopologyLookup,
): DfsState | null {
  const startKind = start.startKind ?? "main";
  if (!start.firstEdge) {
    return {
      currentNode: start.startNodeRef,
      currentDirectionRole: initialRole,
      edgeSequence: [],
      edgeEntryNodes: [],
      turnbackAt: new Set(),
      segmentVisitedEdges: new Set(),
      totalDistanceMeters: 0,
      startKind,
      currentIntentionIndex: 1,
      directionRoleHistory: [],
    };
  }

  const edge = lookup.edgesById[start.firstEdge];
  if (!edge) return null;
  if (edge.traversal === "forward" && edge.fromNodeRef !== start.startNodeRef) return null;

  const nextNode = edge.fromNodeRef === start.startNodeRef ? edge.toNodeRef : edge.fromNodeRef;
  const role = (edge.directionRole === "up" || edge.directionRole === "down")
    ? edge.directionRole
    : initialRole;

  return {
    currentNode: nextNode,
    currentDirectionRole: role,
    edgeSequence: [start.firstEdge],
    edgeEntryNodes: [start.startNodeRef],
    turnbackAt: new Set(),
    segmentVisitedEdges: new Set([start.firstEdge]),
    totalDistanceMeters: edge.lengthMeters,
    startKind,
    currentIntentionIndex: 1,
    directionRoleHistory: [role],
  };
}

function snapshotCandidate(state: DfsState): RawCandidate {
  return {
    edgeSequence: [...state.edgeSequence],
    edgeEntryNodes: [...state.edgeEntryNodes],
    turnbackAt: [...state.turnbackAt].sort((a, b) => a - b),
    totalDistanceMeters: state.totalDistanceMeters,
    startKind: state.startKind,
    localDiagnostics: [],
  };
}

// build* 函数: chain 接入后, traceSequence / phases 改为派生自 resolvedChain
function buildResultFromCandidate(
  raw: RawCandidate,
  topo: BaseTopologyLayer,
  lookup: TopologyLookup,
  ruleTrace: PathGenerationRuleTrace[],
  diagnostics: Diagnostic[],
  chain: IntentionChain,
  startSeed: PathSeed,
  endSeed: PathSeed,
): PathfindingResult {
  const localDiagnostics: Diagnostic[] = [];

  // sketch mode: 若 chain 仅有 origin+terminus, 反向推导补全节点
  let effectiveChain = chain;
  if (chain.mode === "sketch" && chain.nodes.length === 2) {
    const origin = seedToAnchor(startSeed);
    const terminus = seedToAnchor(endSeed);
    effectiveChain = inferSketchChain(raw, origin, terminus, lookup);
  }

  // chain × path → ResolvedChain
  const { resolved, diagnostics: resolveDiags } = resolveChain(effectiveChain, raw, lookup);
  localDiagnostics.push(...resolveDiags);

  // ResolvedChain → PhaseSequence
  const { sequence: phaseSequence, diagnostics: phaseDiags } = buildPhaseSequence(resolved, lookup);
  localDiagnostics.push(...phaseDiags);

  // PhaseSequence → 兼容 view (traceSequence + phases)
  const traceSequence = chainToTraceSequence(resolved);
  const coarsePhases = phaseSequenceToCoarsePhases(phaseSequence, raw.edgeSequence, lookup);
  const phases: PathPhase[] = coarsePhases.map((p) => ({
    phaseIndex: p.phaseIndex,
    kind: p.kind,
    directionRole: p.directionRole,
    edgeRange: p.edgeRange,
    stationRefs: p.stationRefs,
    distanceMeters: p.distanceMeters,
  }));
  const pathSegments = buildPathSegments(raw, lookup);

  void topo;

  return {
    edgeSequence: raw.edgeSequence,
    traceSequence,
    pathSegments,
    phases,
    totalDistanceMeters: raw.totalDistanceMeters,
    startKind: raw.startKind,
    turnbackEdgeIndices: [...raw.turnbackAt],
    ruleTrace: [...ruleTrace],
    diagnostics: [...diagnostics, ...raw.localDiagnostics, ...localDiagnostics],
    resolvedChain: resolved,
    phaseSequence,
  };
}

// ── 7. Build helpers (legacy, retained for buildPathSegments) ────

function buildPathSegments(
  raw: RawCandidate,
  lookup: TopologyLookup,
): ServicePathSegment[] {
  const segments: ServicePathSegment[] = [];
  for (let i = 0; i < raw.edgeSequence.length; i += 1) {
    const edgeId = raw.edgeSequence[i];
    const edge = lookup.edgesById[edgeId];
    if (!edge) continue;
    const entryNode = raw.edgeEntryNodes[i];
    const exitNode = entryNode === edge.fromNodeRef ? edge.toNodeRef : edge.fromNodeRef;
    segments.push({
      orderIndex: i,
      edgeRef: edgeId,
      fromNodeRef: entryNode,
      toNodeRef: exitNode,
      measureRange: { startMeasure: 0, endMeasure: 1 },
      distanceMeters: edge.lengthMeters,
      geometryRef: edge.geometryRef,
    });
  }
  return segments;
}

