// ============================================================
// Rail Graph v1 — IntentionChain (Pathfinding Intent Layer)
//
// chain 是 admin 视角的"运行剧本": 有序的运行意图节点列表 (IntentionNode[])。
// 节点之间隐含 running 段, 把列车从上一节点位置接续到下一节点位置。
//
// 关键关系:
//   chain (intent)       — 用户输入的有序运行节点
//   path  (physical)     — DFS 找到的 edge 序列 + turnback indices
//   resolved chain       — chain ⊕ path 合并产物, 事件派生真源
//   phase sequence       — resolved chain 的机械展开 (running/dwelling/departing)
//
// 与 ServiceTraceEntry / PathPhase 的关系: 后两者为 chain 的派生 view, 不是真源。
// 当前 PathGoal (explicit/shorthand/implicit) 退化为 chain 的兼容入口
// (via chain.ts: fromPathGoal / expandShorthandToChain)。
//
// 本文件仅类型, 不含任何实现逻辑。
// ============================================================

import type { EntityRef } from "./primitives";
import type { OperationType } from "./service-template.types";

// ── 1. 锚点 ─────────────────────────────────────────────────

/** 节点定位到某 edge 的某端点 (0 = fromNode 端, 1 = toNode 端)。 */
export interface EdgeMeasureAnchor {
  edgeRef: EntityRef;
  measure: 0 | 1;
}

/** 节点定位到某 node。 */
export interface NodeAnchor {
  nodeRef: EntityRef;
}

export type ChainEndpointAnchor = NodeAnchor | EdgeMeasureAnchor;

// ── 2. IntentionNode (discriminated union) ─────────────────

/** 起点节点 — chain 第一个节点, 描述列车从哪里开始, 初始方向。 */
export interface OriginNode {
  kind: "origin";
  at: ChainEndpointAnchor;
  direction: "up" | "down";
}

/** 终点节点 — chain 最后一个节点, 描述运行在哪里结束。 */
export interface TerminusNode {
  kind: "terminus";
  at: ChainEndpointAnchor;
}

/**
 * 乘降停站节点。
 *
 * - `at`: platformRef (必填) — 指定停哪个 platform
 * - `edgeRef`: 可选, 限定走该 platform 的哪条 binding edge (用于岛式同 platform 多 binding)
 * - `boarding`: 乘降模式
 * - `duration`: 可选, 停留时间 (秒); timeline 阶段消费
 *
 * 编译产物: dwelling(atPlatform=true) + departing(direction=same)
 */
export interface ServiceStopNode {
  kind: "service_stop";
  at: EntityRef;             // platformRef
  edgeRef?: EntityRef;       // 可选 binding edge 限定
  boarding: "alight" | "board" | "both";
  duration?: number;
}

/**
 * 通过站台节点 (不停)。
 *
 * 不直接生成 phase, 仅约束相邻 running 段的 passages 必须经过此 platform/station 的 binding edge。
 * 同一 platform 可以在 chain 中出现多次 (例如 PD 在反向前后各 pass 一次, 走不同 binding edge)。
 *
 * - `throughKind="platform"`: through 必须是 platformRef, 严格匹配该 platform 的 binding
 * - `throughKind="station"`: through 是 stationRef, 允许该 station 的任一 platform binding
 */
export interface PassageNode {
  kind: "passage";
  through: EntityRef;
  throughKind: "platform" | "station";
}

/**
 * 反向发车节点。
 *
 * - `at`: 可选, 限定在某条 reversible edge 上反向; 缺省则任意 reversible edge
 * - `atPlatform`: 可选, 若该 edge 同时绑 platform, 标注哪个 platform
 * - `boarding`: 反向时是否同时乘降。`"none"` = 纯换向 (机外掉头); 其他 = 乘降与换向同时
 *
 * 编译产物: dwelling + departing(newDirection=opposite)
 * 与 service_stop 的差异: departing.newDirection 反转。
 * 当前 `ServiceStopEntry { operationType: "turnback" }` 的真身。
 */
export interface ReversalNode {
  kind: "reversal";
  at?: EntityRef;            // reversible edgeRef 限定
  atPlatform?: EntityRef;    // 若 reversible edge 同时绑 platform
  boarding?: "none" | "alight" | "board" | "both";
}

/**
 * 技术停车节点 (无乘降)。
 *
 * 用于待避、信号停、跨线等待等场景。无 platform binding 也可表达。
 * - `at`: edgeRef
 * - `measure`: 0-1 在 edge 上的位置
 * - `reason`: 停车理由
 *
 * 编译产物: dwelling(atPlatform=false) + departing(direction=same)
 */
export interface TechnicalStopNode {
  kind: "technical_stop";
  at: EntityRef;             // edgeRef
  measure: number;
  reason?: "wait" | "crossing" | "signal";
}

/**
 * 作业节点 (编组/解挂/换乘务等)。
 *
 * 与同位置的 dwelling 共生 (service_stop / technical_stop / reversal 之一),
 * 产生独立 EventAnchorOnPhase, 不替代 dwelling 本身。
 */
export interface OperationNode {
  kind: "operation";
  at: EntityRef;             // edgeRef
  opKind: OperationType;
}

export type IntentionNode =
  | OriginNode
  | ServiceStopNode
  | PassageNode
  | ReversalNode
  | TechnicalStopNode
  | OperationNode
  | TerminusNode;

export type IntentionNodeKind = IntentionNode["kind"];

// ── 3. Chain mode ───────────────────────────────────────────

/**
 * - `strict`: chain 完整描述运行剧本; DFS 必须严格满足所有约束; 额外 turnback 视为编译失败
 * - `sketch`: chain 仅给关键节点; DFS 自由发挥; 候选 path 反向"对齐"成 candidate chain (auto-inserted reversal/passage)
 */
export type ChainMode = "strict" | "sketch";

export interface IntentionChain {
  mode: ChainMode;
  nodes: IntentionNode[];
}

// ── 4. Resolved chain (chain × path 合并产物) ──────────────

/**
 * resolved 节点 — 在原 IntentionNode 之上附加 path 决定的物理位置信息。
 *
 * `nodeIndex` 永远等于 chain.nodes 中的索引。
 * `resolvedEdgeRef` / `resolvedMeasure` / `resolvedStoppingPointRef`
 * 仅在节点对应 path 中的具体位置时填充; origin/terminus 等端点节点可只填 nodeIndex。
 */
export type ResolvedIntentionNode = IntentionNode & {
  nodeIndex: number;
  resolvedEdgeRef?: EntityRef;
  resolvedMeasure?: number;
  resolvedStoppingPointRef?: EntityRef;
  resolvedPlatformRef?: EntityRef;
  resolvedStationRef?: EntityRef;
};

/**
 * Running 段内部经过 platform binding 的切片。
 *
 * `edgeIndexInPath` 指向 ResolvedChain.edgeSequence 中的索引。
 * `declaredByNodeIndex` 若不为空, 表示该 passage 由 chain.nodes[i] 显式声明
 * (即对应一个 PassageNode); 否则是 path 自然经过但 chain 未声明 (隐式 pass, 仍生成 ServicePassEntry)。
 */
export interface PassageSlice {
  edgeIndexInPath: number;
  platformRef?: EntityRef;
  stationRef?: EntityRef;
  declaredByNodeIndex?: number;
}

/**
 * Chain 节点 i 与节点 i+1 之间的 running 段。
 *
 * - segments 数永远 = nodes 数 - 1 (origin..terminus 之间所有相邻对)
 * - origin/terminus 节点本身不产 phase, 但其位置仍参与定位
 * - operation 节点不消耗 running, 与同位置 dwelling 节点合并; segments 跳过它
 *   (即 operation 节点的"前后 segment"会被合并; nodeIndex 仍保留索引)
 */
export interface RunningSegment {
  fromNodeIndex: number;
  toNodeIndex: number;
  edges: EntityRef[];
  direction: "up" | "down";
  passages: PassageSlice[];
  distanceMeters: number;
}

/**
 * Resolved chain — chain 与 path 合并后的完整运行剧本。
 *
 * 事件流 (ServiceTraceEntry / RunEvent) 与 phase 序列均从此派生。
 *
 * 不变量:
 * - nodes[0].kind === "origin", nodes[length-1].kind === "terminus"
 * - segments.length === nodes.length - 1 (允许某些 segments 为空 edges 数组, 例如 origin 与首个 stop 同位置)
 * - edgeSequence === flatMap(segments, s => s.edges) 完整拼接
 * - turnbackEdgeIndices 对应 reversal 节点 (按顺序), 与 segments 切换方向位置一致
 */
export interface ResolvedChain {
  mode: ChainMode;
  nodes: ResolvedIntentionNode[];
  segments: RunningSegment[];
  edgeSequence: EntityRef[];
  turnbackEdgeIndices: number[];
}

// ── 5. 诊断 code 命名空间 ───────────────────────────────────

export const ChainDiagnosticCode = {
  CHAIN_EMPTY: "CHAIN_EMPTY",
  CHAIN_MISSING_ORIGIN: "CHAIN_MISSING_ORIGIN",
  CHAIN_MISSING_TERMINUS: "CHAIN_MISSING_TERMINUS",
  CHAIN_ORIGIN_NOT_FIRST: "CHAIN_ORIGIN_NOT_FIRST",
  CHAIN_TERMINUS_NOT_LAST: "CHAIN_TERMINUS_NOT_LAST",
  CHAIN_PASSAGE_AT_BOUNDARY: "CHAIN_PASSAGE_AT_BOUNDARY",
  CHAIN_DUPLICATE_ORIGIN: "CHAIN_DUPLICATE_ORIGIN",
  CHAIN_DUPLICATE_TERMINUS: "CHAIN_DUPLICATE_TERMINUS",
  CHAIN_NODE_REF_NOT_FOUND: "CHAIN_NODE_REF_NOT_FOUND",
  CHAIN_RESOLVE_STOP_NOT_ON_PATH: "CHAIN_RESOLVE_STOP_NOT_ON_PATH",
  CHAIN_RESOLVE_REVERSAL_MISMATCH: "CHAIN_RESOLVE_REVERSAL_MISMATCH",
  CHAIN_RESOLVE_PASSAGE_NOT_ON_PATH: "CHAIN_RESOLVE_PASSAGE_NOT_ON_PATH",
  CHAIN_STRICT_EXTRA_TURNBACK: "CHAIN_STRICT_EXTRA_TURNBACK",
  CHAIN_NO_PATH_MATCHES: "CHAIN_NO_PATH_MATCHES",
} as const;

export type ChainDiagnosticCodeKey = keyof typeof ChainDiagnosticCode;
