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
  ServiceTraceEntry,
} from "./service-template.types";
import type { PathGenerationRuleTrace } from "./editing.types";
import type { TopologyLookup } from "./topology";
import {
  isDirectionRoleCompatible,
  isTurnbackAllowed,
  oppositeDirectionRole,
} from "./topology";

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
    return {
      entryPoints: [{ startNodeRef: seed.nodeRef }],
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
  visitedEdges: Set<EntityRef>;
  totalDistanceMeters: number;
  /** 起点物理类型 — 跟随 entry point 决定, 不随 DFS 推进改变 */
  startKind: "main" | "siding";
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

  // 过滤副线起步 (若 allowSidingStarts === false)
  const allowSiding = options.allowSidingStarts ?? true;
  const filteredEntryPoints = allowSiding
    ? startRes.entryPoints
    : startRes.entryPoints.filter((ep) => ep.startKind !== "siding");

  for (const start of filteredEntryPoints) {
    const initState = createInitialState(start, startRes.initialDirectionRole, lookup);
    if (!initState) continue;
    dfsExplore(initState);
  }

  if (candidates.length === 0) {
    diagnostics.push({
      level: "warn",
      code: PathfindingDiagnosticCode.NO_PATH_FOUND,
      stage: "findPaths",
      message: "No simple path found between start and end seed.",
    });
    return [];
  }

  candidates.sort((a, b) => a.totalDistanceMeters - b.totalDistanceMeters);
  const top = candidates.slice(0, maxCandidates);
  if (candidates.length > maxCandidates) {
    diagnostics.push({
      level: "info",
      code: PathfindingDiagnosticCode.MAX_CANDIDATES_REACHED,
      stage: "findPaths",
      message: "More candidates exist than maxCandidates; truncated.",
      context: { totalFound: candidates.length, kept: maxCandidates },
    });
  }

  return top.map((raw) => buildResultFromCandidate(raw, topo, lookup, ruleTrace, diagnostics));

  // ─────────── DFS 闭包 ───────────

  function dfsExplore(state: DfsState): void {
    // 终点判定 (在尝试扩展前)
    const lastEdge = state.edgeSequence[state.edgeSequence.length - 1];
    if (lastEdge !== undefined && targetEdges.has(lastEdge)) {
      candidates.push(snapshotCandidate(state));
      return;
    }
    if (targetNodes.has(state.currentNode) && state.edgeSequence.length > 0) {
      candidates.push(snapshotCandidate(state));
      return;
    }

    if (state.edgeSequence.length >= maxDepth) {
      return;
    }

    // 1) 换向选项: 若上一条 edge 允许 turnback 且未曾换向过
    if (allowTurnback && state.edgeSequence.length > 0) {
      const lastIdx = state.edgeSequence.length - 1;
      const lastEdgeId = state.edgeSequence[lastIdx];
      const lastEdgeObj = lookup.edgesById[lastEdgeId];
      if (lastEdgeObj && isTurnbackAllowed(lastEdgeObj) && !state.turnbackAt.has(lastIdx)) {
        const hasStop = (lookup.stoppingPointsByEdge[lastEdgeId] ?? []).length > 0;
        const stopOk = !requireStopForTurnback || hasStop;
        if (stopOk) {
          tryTurnback(state, lastIdx, lastEdgeObj);
        }
      }
    }

    // 2) 正常 outEdges 探索
    const outEdges = adjacency.outEdges[state.currentNode] ?? [];
    for (const candidateEdgeId of outEdges) {
      if (state.visitedEdges.has(candidateEdgeId)) continue;
      const edge = lookup.edgesById[candidateEdgeId];
      if (!edge) continue;

      if (edge.traversal === "forward" && edge.fromNodeRef !== state.currentNode) continue;
      if (!isDirectionRoleCompatible(state.currentDirectionRole, edge.directionRole)) continue;

      pushEdge(state, edge);
      dfsExplore(state);
      popEdge(state, edge);
    }
  }

  function tryTurnback(state: DfsState, lastIdx: number, lastEdge: TopologyEdge): void {
    const enteredFrom = state.edgeEntryNodes[lastIdx];
    const newNode = enteredFrom === lastEdge.fromNodeRef ? lastEdge.toNodeRef : lastEdge.fromNodeRef;
    // newNode === enteredFrom 表示反向后回到原入口, 即"在 edge 上 turnback"
    // 但 newNode 实际上应等于 enteredFrom: 列车从 enteredFrom 进入, 走到另一端,
    // turnback 后又从另一端回到 enteredFrom 端。
    const reversedNode = enteredFrom;

    const prevNode = state.currentNode;
    const prevRole = state.currentDirectionRole;
    const opposite = oppositeDirectionRole(state.currentDirectionRole ?? "up");

    state.turnbackAt.add(lastIdx);
    state.currentNode = reversedNode;
    state.currentDirectionRole = opposite;

    dfsExplore(state);

    state.turnbackAt.delete(lastIdx);
    state.currentNode = prevNode;
    state.currentDirectionRole = prevRole;
    void newNode;
  }

  function pushEdge(state: DfsState, edge: TopologyEdge): void {
    state.edgeSequence.push(edge.id);
    state.edgeEntryNodes.push(state.currentNode);
    state.visitedEdges.add(edge.id);
    state.totalDistanceMeters += edge.lengthMeters;
    const nextNode = edge.fromNodeRef === state.currentNode ? edge.toNodeRef : edge.fromNodeRef;
    state.currentNode = nextNode;
    if (edge.directionRole === "up" || edge.directionRole === "down") {
      state.currentDirectionRole = edge.directionRole;
    }
  }

  function popEdge(state: DfsState, edge: TopologyEdge): void {
    state.edgeSequence.pop();
    const entryNode = state.edgeEntryNodes.pop();
    state.visitedEdges.delete(edge.id);
    state.totalDistanceMeters -= edge.lengthMeters;
    if (entryNode !== undefined) {
      state.currentNode = entryNode;
    }
    // currentDirectionRole 回溯: 找前一条 edge 的 directionRole, 或回到 initial
    state.currentDirectionRole = recomputeDirectionRole(state, lookup, startRes.initialDirectionRole);
  }
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
      visitedEdges: new Set(),
      totalDistanceMeters: 0,
      startKind,
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
    visitedEdges: new Set([start.firstEdge]),
    totalDistanceMeters: edge.lengthMeters,
    startKind,
  };
}

function recomputeDirectionRole(
  state: DfsState,
  lookup: TopologyLookup,
  fallback: TrackDirectionRole | undefined,
): TrackDirectionRole | undefined {
  for (let i = state.edgeSequence.length - 1; i >= 0; i -= 1) {
    const edge = lookup.edgesById[state.edgeSequence[i]];
    if (edge?.directionRole === "up" || edge?.directionRole === "down") {
      return edge.directionRole;
    }
  }
  return fallback;
}

function snapshotCandidate(state: DfsState): RawCandidate {
  return {
    edgeSequence: [...state.edgeSequence],
    edgeEntryNodes: [...state.edgeEntryNodes],
    turnbackAt: [...state.turnbackAt].sort((a, b) => a - b),
    totalDistanceMeters: state.totalDistanceMeters,
    startKind: state.startKind,
  };
}

// build* 函数由 Phase E 提供
function buildResultFromCandidate(
  raw: RawCandidate,
  topo: BaseTopologyLayer,
  lookup: TopologyLookup,
  ruleTrace: PathGenerationRuleTrace[],
  diagnostics: Diagnostic[],
): PathfindingResult {
  const localDiagnostics: Diagnostic[] = [];
  const turnbackSet = new Set(raw.turnbackAt);

  const traceSequence = buildTraceSequence(raw, turnbackSet, lookup, localDiagnostics);
  const pathSegments = buildPathSegments(raw, lookup);
  const phases = buildPhases(raw, turnbackSet, lookup);

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
    diagnostics: [...diagnostics, ...localDiagnostics],
  };
}

// ── 7. Build helpers (Phase E) ──────────────────────────────

function buildTraceSequence(
  raw: RawCandidate,
  turnbackSet: Set<number>,
  lookup: TopologyLookup,
  diagnostics: Diagnostic[],
): ServiceTraceEntry[] {
  const entries: ServiceTraceEntry[] = [];
  let orderIndex = 0;

  for (let i = 0; i < raw.edgeSequence.length; i += 1) {
    const edgeId = raw.edgeSequence[i];
    const edge = lookup.edgesById[edgeId];
    if (!edge) continue;

    const bindings = lookup.bindingsByEdge[edgeId] ?? [];
    const stoppingPoints = lookup.stoppingPointsByEdge[edgeId] ?? [];

    for (const binding of bindings) {
      const platform = lookup.platformsById[binding.platformRef];
      const matchingStop = stoppingPoints.find((sp) => sp.platformRef === binding.platformRef);
      if (matchingStop) {
        entries.push({
          orderIndex: orderIndex++,
          passageType: "stop",
          stopType: "mandatory_stop",
          stationRef: binding.stationRef,
          platformRef: binding.platformRef,
          edgeRef: edgeId,
          stoppingPointRef: matchingStop.id,
          measure: matchingStop.measure,
          platformNumber: platform?.number,
          platformName: platform?.name,
        });
      } else {
        entries.push({
          orderIndex: orderIndex++,
          passageType: "pass",
          stopType: "pass_through",
          stationRef: binding.stationRef,
          edgeRef: edgeId,
          platformRef: binding.platformRef,
          measureRange: { startMeasure: 0, endMeasure: 1 },
        });
      }
    }

    // 在该 edge 上发生换向 → 追加 turnback stop entry
    if (turnbackSet.has(i)) {
      // 选一个 binding 来挂 turnback (若无 binding, 仍然生成但 platformRef 用 undefined-like fallback)
      const anchorBinding = bindings[0];
      const stoppingPointForTurnback = stoppingPoints[0];
      if (!anchorBinding) {
        diagnostics.push({
          level: "warn",
          code: PathfindingDiagnosticCode.TURNBACK_WITHOUT_STOP,
          stage: "buildTraceSequence",
          message: "Turnback occurred on an edge without any PlatformTrackBinding.",
          context: { edgeRef: edgeId },
        });
      }
      if (!stoppingPointForTurnback) {
        diagnostics.push({
          level: "warn",
          code: PathfindingDiagnosticCode.TURNBACK_WITHOUT_STOP,
          stage: "buildTraceSequence",
          message: "Turnback occurred on an edge without StoppingPoint.",
          context: { edgeRef: edgeId },
        });
      }
      const platform = anchorBinding ? lookup.platformsById[anchorBinding.platformRef] : undefined;
      entries.push({
        orderIndex: orderIndex++,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: anchorBinding?.stationRef ?? (edge.fromNodeRef as EntityRef),
        platformRef: anchorBinding?.platformRef ?? (edge.fromNodeRef as EntityRef),
        edgeRef: edgeId,
        stoppingPointRef: stoppingPointForTurnback?.id ?? (`${edgeId}:turnback` as EntityRef),
        measure: stoppingPointForTurnback?.measure ?? 0.5,
        platformNumber: platform?.number,
        platformName: platform?.name,
        operationType: "turnback",
      });
    }
  }

  return entries;
}

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

function buildPhases(
  raw: RawCandidate,
  turnbackSet: Set<number>,
  lookup: TopologyLookup,
): PathPhase[] {
  const phases: PathPhase[] = [];
  if (raw.edgeSequence.length === 0) return phases;

  let segmentStart = 0;
  let phaseIndex = 0;

  const flushRunPhase = (start: number, endExclusive: number): void => {
    if (start >= endExclusive) return;
    const role = inferPhaseDirectionRole(raw.edgeSequence, start, endExclusive, lookup);
    const stationRefs = collectStationRefs(raw.edgeSequence, start, endExclusive, lookup);
    const distanceMeters = sumDistance(raw.edgeSequence, start, endExclusive, lookup);
    phases.push({
      phaseIndex: phaseIndex++,
      kind: role === "down" ? "down_run" : "up_run",
      directionRole: role,
      edgeRange: { startIndex: start, endIndex: endExclusive - 1 },
      stationRefs,
      distanceMeters,
    });
  };

  for (let i = 0; i < raw.edgeSequence.length; i += 1) {
    if (turnbackSet.has(i)) {
      // up_run / down_run phase 在该 turnback edge 处结束 (含该 edge)
      flushRunPhase(segmentStart, i + 1);
      // turnback phase 单独占位
      phases.push({
        phaseIndex: phaseIndex++,
        kind: "turnback",
        directionRole: undefined,
        edgeRange: { startIndex: i, endIndex: i },
        stationRefs: collectStationRefs(raw.edgeSequence, i, i + 1, lookup),
        distanceMeters: 0,
      });
      segmentStart = i + 1;
    }
  }
  flushRunPhase(segmentStart, raw.edgeSequence.length);

  return phases;
}

function inferPhaseDirectionRole(
  edgeSequence: EntityRef[],
  start: number,
  endExclusive: number,
  lookup: TopologyLookup,
): TrackDirectionRole | undefined {
  for (let i = start; i < endExclusive; i += 1) {
    const edge = lookup.edgesById[edgeSequence[i]];
    if (edge?.directionRole === "up" || edge?.directionRole === "down") {
      return edge.directionRole;
    }
  }
  return undefined;
}

function collectStationRefs(
  edgeSequence: EntityRef[],
  start: number,
  endExclusive: number,
  lookup: TopologyLookup,
): EntityRef[] {
  const refs: EntityRef[] = [];
  const seen = new Set<EntityRef>();
  for (let i = start; i < endExclusive; i += 1) {
    const bindings = lookup.bindingsByEdge[edgeSequence[i]] ?? [];
    for (const b of bindings) {
      if (!seen.has(b.stationRef)) {
        seen.add(b.stationRef);
        refs.push(b.stationRef);
      }
    }
  }
  return refs;
}

function sumDistance(
  edgeSequence: EntityRef[],
  start: number,
  endExclusive: number,
  lookup: TopologyLookup,
): number {
  let total = 0;
  for (let i = start; i < endExclusive; i += 1) {
    const edge = lookup.edgesById[edgeSequence[i]];
    if (edge) total += edge.lengthMeters;
  }
  return total;
}
