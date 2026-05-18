// ============================================================
// Rail Graph v1 — Chain Helpers
//
// 提供 IntentionChain 的核心算法:
//   validateChain                 — 不变量校验
//   compileChainToConstraints     — chain → DFS 约束
//   resolveChain                  — chain + path 合并为 ResolvedChain
//   inferSketchChain              — 从 path 反推 candidate chain (sketch mode)
//   chainToTraceSequence          — ResolvedChain → ServiceTraceEntry[] (兼容 view)
//   createImplicitChain           — 工厂: 仅 origin+terminus 的 sketch chain
//
// 不依赖 pathfinding.ts (避免循环), 通过 PathCandidate interface 解耦。
// pathfinding.ts 内的 RawCandidate 满足 PathCandidate 结构 (TS structural typing)。
// ============================================================

import type {
  ChainEndpointAnchor,
  ChainMode,
  IntentionChain,
  IntentionNode,
  OriginNode,
  PassageSlice,
  ResolvedChain,
  ResolvedIntentionNode,
  RunningSegment,
  TerminusNode,
} from "./chain.types";
import { ChainDiagnosticCode } from "./chain.types";
import type { Diagnostic } from "./diagnostic-types";
import type { EntityRef } from "./primitives";
import type {
  ServicePassEntry,
  ServiceStopEntry,
  ServiceTraceEntry,
} from "./service-template.types";
import type { TopologyLookup } from "./topology";

// ── 1. PathCandidate (RawCandidate 的解耦 interface) ────────

/**
 * 寻径产物的最小契约。pathfinding.RawCandidate 满足此结构。
 * chain.ts 仅消费这些字段, 不引入 pathfinding 类型依赖。
 */
export interface PathCandidate {
  edgeSequence: EntityRef[];
  turnbackAt: number[];
  startKind: "main" | "siding";
  totalDistanceMeters: number;
}

// ── 2. Chain constraints (DFS 与后过滤共用) ─────────────────

export interface ChainRequiredStop {
  platformRef: EntityRef;
  edgeRef?: EntityRef;
  order: number;
}

export interface ChainRequiredPassage {
  throughRef: EntityRef;
  throughKind: "platform" | "station";
  order: number;
}

export interface ChainReversal {
  at?: EntityRef;
  order: number;
}

export interface ChainTechnicalStop {
  edgeRef: EntityRef;
  measure: number;
  order: number;
}

export interface ChainConstraints {
  requiredStops: ChainRequiredStop[];
  requiredPassages: ChainRequiredPassage[];
  reversals: ChainReversal[];
  technicalStops: ChainTechnicalStop[];
  /** strict 时 = reversals.length;sketch 时 = Number.POSITIVE_INFINITY */
  turnbackUpperBound: number;
  mode: ChainMode;
}

// ── 3. validateChain ────────────────────────────────────────

export function validateChain(chain: IntentionChain): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (chain.nodes.length === 0) {
    out.push(diag("error", ChainDiagnosticCode.CHAIN_EMPTY, "Chain has no nodes."));
    return out;
  }
  if (chain.nodes[0].kind !== "origin") {
    out.push(diag("error", ChainDiagnosticCode.CHAIN_ORIGIN_NOT_FIRST, "First node must be 'origin'.", { firstKind: chain.nodes[0].kind }));
  }
  const last = chain.nodes[chain.nodes.length - 1];
  if (last.kind !== "terminus") {
    out.push(diag("error", ChainDiagnosticCode.CHAIN_TERMINUS_NOT_LAST, "Last node must be 'terminus'.", { lastKind: last.kind }));
  }
  let originCount = 0;
  let terminusCount = 0;
  for (let i = 0; i < chain.nodes.length; i += 1) {
    const node = chain.nodes[i];
    if (node.kind === "origin") originCount += 1;
    if (node.kind === "terminus") terminusCount += 1;
    if (node.kind === "passage" && (i === 0 || i === chain.nodes.length - 1)) {
      out.push(diag("error", ChainDiagnosticCode.CHAIN_PASSAGE_AT_BOUNDARY, "Passage node cannot be at chain boundary.", { nodeIndex: i }));
    }
  }
  if (originCount > 1) {
    out.push(diag("error", ChainDiagnosticCode.CHAIN_DUPLICATE_ORIGIN, "Chain has multiple origin nodes.", { count: originCount }));
  }
  if (terminusCount > 1) {
    out.push(diag("error", ChainDiagnosticCode.CHAIN_DUPLICATE_TERMINUS, "Chain has multiple terminus nodes.", { count: terminusCount }));
  }
  return out;
}

// ── 4. compileChainToConstraints ────────────────────────────

export function compileChainToConstraints(
  chain: IntentionChain,
  lookup: TopologyLookup,
): { constraints: ChainConstraints; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const requiredStops: ChainRequiredStop[] = [];
  const requiredPassages: ChainRequiredPassage[] = [];
  const reversals: ChainReversal[] = [];
  const technicalStops: ChainTechnicalStop[] = [];

  for (let i = 0; i < chain.nodes.length; i += 1) {
    const node = chain.nodes[i];
    switch (node.kind) {
      case "service_stop":
        requiredStops.push({ platformRef: node.at, edgeRef: node.edgeRef, order: i });
        if (!lookup.platformsById[node.at]) {
          diagnostics.push(diag("warn", ChainDiagnosticCode.CHAIN_NODE_REF_NOT_FOUND, "service_stop references unknown platform.", { nodeIndex: i, platformRef: node.at }));
        }
        break;
      case "passage":
        requiredPassages.push({ throughRef: node.through, throughKind: node.throughKind, order: i });
        if (node.throughKind === "platform" && !lookup.platformsById[node.through]) {
          diagnostics.push(diag("warn", ChainDiagnosticCode.CHAIN_NODE_REF_NOT_FOUND, "passage references unknown platform.", { nodeIndex: i, platformRef: node.through }));
        } else if (node.throughKind === "station" && !lookup.stationsById[node.through]) {
          diagnostics.push(diag("warn", ChainDiagnosticCode.CHAIN_NODE_REF_NOT_FOUND, "passage references unknown station.", { nodeIndex: i, stationRef: node.through }));
        }
        break;
      case "reversal":
        reversals.push({ at: node.at, order: i });
        if (node.at && !lookup.edgesById[node.at]) {
          diagnostics.push(diag("warn", ChainDiagnosticCode.CHAIN_NODE_REF_NOT_FOUND, "reversal references unknown edge.", { nodeIndex: i, edgeRef: node.at }));
        }
        break;
      case "technical_stop":
        technicalStops.push({ edgeRef: node.at, measure: node.measure, order: i });
        if (!lookup.edgesById[node.at]) {
          diagnostics.push(diag("warn", ChainDiagnosticCode.CHAIN_NODE_REF_NOT_FOUND, "technical_stop references unknown edge.", { nodeIndex: i, edgeRef: node.at }));
        }
        break;
      case "origin":
      case "terminus":
      case "operation":
        break;
    }
  }

  return {
    constraints: {
      requiredStops,
      requiredPassages,
      reversals,
      technicalStops,
      turnbackUpperBound: chain.mode === "strict" ? reversals.length : Number.POSITIVE_INFINITY,
      mode: chain.mode,
    },
    diagnostics,
  };
}

// ── 5. resolveChain ─────────────────────────────────────────

/**
 * 把 IntentionChain 与 PathCandidate 合并为 ResolvedChain。
 *
 * 算法 (单次扫描 path):
 * - currentDirection 由 origin.direction 初始化, 每过 reversal 翻转
 * - 节点对齐游标 pathCursor 从 0 推进 (跳过 origin/terminus 端点)
 * - service_stop 节点: 在 [pathCursor..end) 找首个匹配 platform binding 的 edge
 * - passage 节点: 同上
 * - reversal 节点: 取下一个 turnbackAt index
 * - technical_stop 节点: 找指定 edgeRef 在 path 中的位置
 * - operation 节点: 不消耗 path, resolvedEdgeRef 由其声明的 at 决定
 * - segments[i] = path[prevCursor..currentCursor]
 *
 * 失败处理: 节点对齐不到时, 该节点 resolvedEdgeRef 留 undefined, 发 diagnostic。
 */
export function resolveChain(
  chain: IntentionChain,
  candidate: PathCandidate,
  lookup: TopologyLookup,
): { resolved: ResolvedChain; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const nodes: ResolvedIntentionNode[] = [];
  const segments: RunningSegment[] = [];
  const turnbackSet = new Set(candidate.turnbackAt);
  const remainingTurnbacks = [...candidate.turnbackAt].sort((a, b) => a - b);

  // 初始方向
  const originNode = chain.nodes[0];
  let currentDirection: "up" | "down" = originNode.kind === "origin" ? originNode.direction : "up";

  let pathCursor = 0;
  const lastNodeIndex = chain.nodes.length - 1;

  // 记录每个节点对齐到的 path index (用于切分 segments); origin = -1, terminus = path.length
  const nodeToPathIdx = new Array<number>(chain.nodes.length).fill(-1);
  nodeToPathIdx[0] = -1;
  nodeToPathIdx[lastNodeIndex] = candidate.edgeSequence.length;

  for (let i = 1; i < lastNodeIndex; i += 1) {
    const node = chain.nodes[i];
    const matchIdx = alignNodeToPath(node, candidate, lookup, pathCursor, remainingTurnbacks);
    if (matchIdx === -1) {
      diagnostics.push(diag("warn", chainDiagForNode(node.kind), describeAlignFailure(node, i), { nodeIndex: i }));
      // 留 nodeToPathIdx[i] = -1; segment 切分时跳过此节点
      continue;
    }
    nodeToPathIdx[i] = matchIdx;
    if (node.kind !== "operation") {
      pathCursor = matchIdx + 1;
    }
  }

  // 构建 resolved 节点 (附加物理信息)
  for (let i = 0; i < chain.nodes.length; i += 1) {
    const node = chain.nodes[i];
    const idx = nodeToPathIdx[i];
    const resolved = enrichNode(node, i, idx, candidate, lookup);
    nodes.push(resolved);
  }

  // 构建 segments
  // 找到所有"有效对齐"的节点索引序列 (含 origin=-1 和 terminus=path.length 作为虚拟端点)
  const alignedIdxList: Array<{ nodeIndex: number; pathIdx: number }> = [];
  alignedIdxList.push({ nodeIndex: 0, pathIdx: -1 });
  for (let i = 1; i < lastNodeIndex; i += 1) {
    if (nodeToPathIdx[i] !== -1) {
      alignedIdxList.push({ nodeIndex: i, pathIdx: nodeToPathIdx[i] });
    }
  }
  alignedIdxList.push({ nodeIndex: lastNodeIndex, pathIdx: candidate.edgeSequence.length });

  for (let s = 0; s < alignedIdxList.length - 1; s += 1) {
    const from = alignedIdxList[s];
    const to = alignedIdxList[s + 1];
    // fromEdgeIdx 跳过 from 节点的 edge (因该 edge 属于 from 的 incoming segment, 不属于本段);
    // toEdgeIdx 含 to 节点的 edge (列车需跑到该 edge 上才能在此发生事件如 reversal/stop)。
    // terminus.pathIdx = candidate.edgeSequence.length, 不需 +1 也不可越界。
    const fromEdgeIdx = from.pathIdx + 1;
    const toEdgeIdx = to.nodeIndex === lastNodeIndex ? to.pathIdx : to.pathIdx + 1;
    const segEdges: EntityRef[] = [];
    let segDistance = 0;
    for (let e = fromEdgeIdx; e < toEdgeIdx; e += 1) {
      const edgeRef = candidate.edgeSequence[e];
      const edge = lookup.edgesById[edgeRef];
      if (!edge) continue;
      segEdges.push(edgeRef);
      segDistance += edge.lengthMeters;
    }
    // segment passages — turnback edge 上不产 passage (列车在该 edge 反向, 非"经过")
    const passages: PassageSlice[] = [];
    for (let e = fromEdgeIdx; e < toEdgeIdx; e += 1) {
      if (turnbackSet.has(e)) continue;
      const edgeRef = candidate.edgeSequence[e];
      const bindings = lookup.bindingsByEdge[edgeRef] ?? [];
      for (const b of bindings) {
        passages.push({
          edgeIndexInPath: e,
          platformRef: b.platformRef,
          stationRef: b.stationRef,
          declaredByNodeIndex: findDeclaringPassageNode(chain.nodes, nodeToPathIdx, e),
        });
      }
    }
    // 反转方向 (若 from 节点是 reversal)
    if (from.nodeIndex > 0) {
      const fromNode = chain.nodes[from.nodeIndex];
      if (fromNode.kind === "reversal") {
        currentDirection = currentDirection === "up" ? "down" : "up";
      }
    }
    segments.push({
      fromNodeIndex: from.nodeIndex,
      toNodeIndex: to.nodeIndex,
      edges: segEdges,
      direction: currentDirection,
      passages,
      distanceMeters: segDistance,
    });
  }

  const resolved: ResolvedChain = {
    mode: chain.mode,
    nodes,
    segments,
    edgeSequence: [...candidate.edgeSequence],
    turnbackEdgeIndices: [...candidate.turnbackAt].sort((a, b) => a - b),
  };
  return { resolved, diagnostics };
}

function findDeclaringPassageNode(
  chainNodes: IntentionNode[],
  nodeToPathIdx: number[],
  pathEdgeIdx: number,
): number | undefined {
  for (let i = 0; i < chainNodes.length; i += 1) {
    if (chainNodes[i].kind === "passage" && nodeToPathIdx[i] === pathEdgeIdx) {
      return i;
    }
  }
  return undefined;
}

function alignNodeToPath(
  node: IntentionNode,
  candidate: PathCandidate,
  lookup: TopologyLookup,
  cursor: number,
  remainingTurnbacks: number[],
): number {
  switch (node.kind) {
    case "service_stop":
      return findFirstBindingEdge(candidate, lookup, cursor, node.at, node.edgeRef);
    case "passage":
      if (node.throughKind === "platform") {
        return findFirstBindingEdge(candidate, lookup, cursor, node.through);
      }
      return findFirstStationEdge(candidate, lookup, cursor, node.through);
    case "reversal": {
      const idx = remainingTurnbacks.findIndex((tbIdx) => {
        if (tbIdx < cursor - 1) return false;
        if (node.at) {
          return candidate.edgeSequence[tbIdx] === node.at;
        }
        return true;
      });
      if (idx === -1) return -1;
      const matched = remainingTurnbacks[idx];
      remainingTurnbacks.splice(idx, 1);
      return matched;
    }
    case "technical_stop":
      for (let e = cursor; e < candidate.edgeSequence.length; e += 1) {
        if (candidate.edgeSequence[e] === node.at) return e;
      }
      return -1;
    case "operation":
      for (let e = cursor; e < candidate.edgeSequence.length; e += 1) {
        if (candidate.edgeSequence[e] === node.at) return e;
      }
      return -1;
    case "origin":
    case "terminus":
      return -1;
  }
}

function findFirstBindingEdge(
  candidate: PathCandidate,
  lookup: TopologyLookup,
  cursor: number,
  platformRef: EntityRef,
  requiredEdge?: EntityRef,
): number {
  for (let e = cursor; e < candidate.edgeSequence.length; e += 1) {
    const edgeRef = candidate.edgeSequence[e];
    if (requiredEdge && edgeRef !== requiredEdge) continue;
    const bindings = lookup.bindingsByEdge[edgeRef] ?? [];
    if (bindings.some((b) => b.platformRef === platformRef)) {
      return e;
    }
  }
  return -1;
}

function findFirstStationEdge(
  candidate: PathCandidate,
  lookup: TopologyLookup,
  cursor: number,
  stationRef: EntityRef,
): number {
  for (let e = cursor; e < candidate.edgeSequence.length; e += 1) {
    const edgeRef = candidate.edgeSequence[e];
    const bindings = lookup.bindingsByEdge[edgeRef] ?? [];
    if (bindings.some((b) => b.stationRef === stationRef)) {
      return e;
    }
  }
  return -1;
}

function enrichNode(
  node: IntentionNode,
  nodeIndex: number,
  pathIdx: number,
  candidate: PathCandidate,
  lookup: TopologyLookup,
): ResolvedIntentionNode {
  const base = { ...node, nodeIndex } as ResolvedIntentionNode;
  if (pathIdx < 0 || pathIdx >= candidate.edgeSequence.length) {
    // origin / terminus / 未对齐节点
    if (node.kind === "service_stop" || node.kind === "passage") {
      // 没对齐但仍想填 platform/station 信息 (从节点声明)
      base.resolvedPlatformRef = node.kind === "service_stop" ? node.at : (node.throughKind === "platform" ? node.through : undefined);
      base.resolvedStationRef = node.kind === "passage" && node.throughKind === "station" ? node.through : undefined;
    }
    return base;
  }
  const edgeRef = candidate.edgeSequence[pathIdx];
  base.resolvedEdgeRef = edgeRef;
  const bindings = lookup.bindingsByEdge[edgeRef] ?? [];
  switch (node.kind) {
    case "service_stop": {
      const binding = bindings.find((b) => b.platformRef === node.at) ?? bindings[0];
      base.resolvedPlatformRef = binding?.platformRef ?? node.at;
      base.resolvedStationRef = binding?.stationRef;
      const stops = lookup.stoppingPointsByEdge[edgeRef] ?? [];
      const sp = stops.find((s) => s.platformRef === node.at);
      base.resolvedStoppingPointRef = sp?.id;
      base.resolvedMeasure = sp?.measure ?? 0.5;
      break;
    }
    case "passage": {
      const binding = node.throughKind === "platform"
        ? bindings.find((b) => b.platformRef === node.through)
        : bindings.find((b) => b.stationRef === node.through);
      base.resolvedPlatformRef = binding?.platformRef;
      base.resolvedStationRef = binding?.stationRef;
      break;
    }
    case "reversal": {
      const binding = node.atPlatform ? bindings.find((b) => b.platformRef === node.atPlatform) : bindings[0];
      base.resolvedPlatformRef = binding?.platformRef;
      base.resolvedStationRef = binding?.stationRef;
      base.resolvedMeasure = 0.5;
      break;
    }
    case "technical_stop": {
      base.resolvedMeasure = node.measure;
      break;
    }
    case "operation": {
      const binding = bindings[0];
      base.resolvedPlatformRef = binding?.platformRef;
      base.resolvedStationRef = binding?.stationRef;
      break;
    }
    case "origin":
    case "terminus":
      break;
  }
  return base;
}

// ── 6. inferSketchChain ─────────────────────────────────────

/**
 * Sketch mode 反向推导: 从 path 自动生成 candidate chain。
 * 规则: turnback edge → reversal 节点; binding edge (非 turnback) → passage 节点。
 */
export function inferSketchChain(
  candidate: PathCandidate,
  origin: { at: ChainEndpointAnchor; direction: "up" | "down" },
  terminus: { at: ChainEndpointAnchor },
  lookup: TopologyLookup,
): IntentionChain {
  const nodes: IntentionNode[] = [];
  const originNode: OriginNode = { kind: "origin", at: origin.at, direction: origin.direction };
  nodes.push(originNode);

  const turnbackSet = new Set(candidate.turnbackAt);
  for (let e = 0; e < candidate.edgeSequence.length; e += 1) {
    const edgeRef = candidate.edgeSequence[e];
    if (turnbackSet.has(e)) {
      const bindings = lookup.bindingsByEdge[edgeRef] ?? [];
      const atPlatform = bindings[0]?.platformRef;
      nodes.push({
        kind: "reversal",
        at: edgeRef,
        atPlatform,
        boarding: "none",
      });
      continue;
    }
    const bindings = lookup.bindingsByEdge[edgeRef] ?? [];
    for (const b of bindings) {
      nodes.push({
        kind: "passage",
        through: b.platformRef,
        throughKind: "platform",
      });
    }
  }

  const terminusNode: TerminusNode = { kind: "terminus", at: terminus.at };
  nodes.push(terminusNode);
  return { mode: "sketch", nodes };
}

// ── 7. chainToTraceSequence ─────────────────────────────────

/**
 * 把 ResolvedChain 翻译为 ServiceTraceEntry[] 兼容 view。
 *
 * 顺序规则: 按节点+段交替, 段内 passages 按 edgeIndexInPath 升序。
 * 已声明 passage (declaredByNodeIndex !== undefined) 仅产生一次 entry, 来自 segment.passages。
 */
export function chainToTraceSequence(resolved: ResolvedChain): ServiceTraceEntry[] {
  const entries: ServiceTraceEntry[] = [];
  let orderIndex = 0;

  for (let i = 0; i < resolved.nodes.length; i += 1) {
    const node = resolved.nodes[i];

    // segment 在节点 i 之前的部分: 找以节点 i 为 toNodeIndex 的 segment
    const incomingSeg = resolved.segments.find((s) => s.toNodeIndex === i);
    if (incomingSeg) {
      const sorted = [...incomingSeg.passages].sort((a, b) => a.edgeIndexInPath - b.edgeIndexInPath);
      for (const slice of sorted) {
        if (!slice.platformRef) continue;
        entries.push(makePassEntry(orderIndex++, slice, resolved));
      }
    }

    // 节点 i 自身产生的 entry
    switch (node.kind) {
      case "service_stop":
        if (node.resolvedEdgeRef) {
          entries.push(makeStopEntry(orderIndex++, node, false));
        }
        break;
      case "reversal":
        if (node.resolvedEdgeRef) {
          entries.push(makeStopEntry(orderIndex++, node, true));
        }
        break;
      case "technical_stop":
        if (node.resolvedEdgeRef) {
          entries.push(makeStopEntry(orderIndex++, node, false));
        }
        break;
      case "origin":
      case "terminus":
      case "passage":
      case "operation":
        // 不产 entry
        break;
    }
  }

  return entries;
}

function makeStopEntry(orderIndex: number, node: ResolvedIntentionNode, isTurnback: boolean): ServiceStopEntry {
  const edgeRef = node.resolvedEdgeRef as EntityRef;
  const platformRef = (node.resolvedPlatformRef ?? edgeRef) as EntityRef;
  const stationRef = (node.resolvedStationRef ?? platformRef) as EntityRef;
  const stopEntry: ServiceStopEntry = {
    orderIndex,
    passageType: "stop",
    stopType: "mandatory_stop",
    stationRef,
    platformRef,
    edgeRef,
    stoppingPointRef: (node.resolvedStoppingPointRef ?? (`${platformRef}:${edgeRef}` as EntityRef)),
    measure: node.resolvedMeasure ?? 0.5,
  };
  if (isTurnback) {
    stopEntry.operationType = "turnback";
  }
  return stopEntry;
}

function makePassEntry(
  orderIndex: number,
  slice: PassageSlice,
  resolved: ResolvedChain,
): ServicePassEntry {
  const edgeRef = resolved.edgeSequence[slice.edgeIndexInPath];
  return {
    orderIndex,
    passageType: "pass",
    stopType: "pass_through",
    stationRef: (slice.stationRef ?? slice.platformRef ?? edgeRef) as EntityRef,
    edgeRef,
    platformRef: slice.platformRef,
  };
}

// ── 8. createImplicitChain (工厂) ──────────────────────────

/**
 * 创建一个最小 sketch chain: 仅 origin + terminus。
 * 用于 PathGoal.kind === "implicit" 的兼容入口。
 */
export function createImplicitChain(
  origin: { at: ChainEndpointAnchor; direction: "up" | "down" },
  terminus: { at: ChainEndpointAnchor },
): IntentionChain {
  return {
    mode: "sketch",
    nodes: [
      { kind: "origin", at: origin.at, direction: origin.direction },
      { kind: "terminus", at: terminus.at },
    ],
  };
}

// ── 9. 私有 helpers ─────────────────────────────────────────

function diag(level: Diagnostic["level"], code: string, message: string, context?: Record<string, unknown>): Diagnostic {
  return { level, code, stage: "chain", message, context };
}

function chainDiagForNode(kind: IntentionNode["kind"]): string {
  switch (kind) {
    case "service_stop": return ChainDiagnosticCode.CHAIN_RESOLVE_STOP_NOT_ON_PATH;
    case "passage": return ChainDiagnosticCode.CHAIN_RESOLVE_PASSAGE_NOT_ON_PATH;
    case "reversal": return ChainDiagnosticCode.CHAIN_RESOLVE_REVERSAL_MISMATCH;
    default: return ChainDiagnosticCode.CHAIN_NO_PATH_MATCHES;
  }
}

function describeAlignFailure(node: IntentionNode, nodeIndex: number): string {
  return `Chain node[${nodeIndex}] (kind=${node.kind}) could not be aligned to any position on the path.`;
}
