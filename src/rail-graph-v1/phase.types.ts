// ============================================================
// Rail Graph v1 — RunPhase (运行原语) + EventAnchorOnPhase
//
// 三原语模型: running / dwelling / departing。
// 这是事件流的最底层语义, 比 ServiceTraceEntry 更原始。
//
// 派生关系: ResolvedChain → PhaseSequence → (兼容 view) PathPhase[] / ServiceTraceEntry[]
//
// 设计要点:
// - boarding 并入 dwelling.boarding (非独立 phase), 因物理上与 dwelling 同步
// - turnback 不存在独立 kind, 仅作 departing.isReversal 派生属性
// - 位置语义 (platform/switch/scenic/operation) 通过 EventAnchorOnPhase 正交挂载
//
// 本文件仅类型, 不含任何实现逻辑。
// ============================================================

import type { EntityRef } from "./primitives";
import type { TrackDirectionRole } from "./base-topology.types";
import type { EventAnchor } from "./event.types";
import type { PassageSlice } from "./chain.types";

// ── 1. 运行原语 ──────────────────────────────────────────────

/**
 * 运行状态 (持续) — 列车在某方向上连续行驶, 跨多条 edges。
 *
 * passages 描述运行段内经过的所有 platform binding 切片
 * (含 chain 中 PassageNode 显式声明的 + 隐式经过的)。
 */
export interface RunningPhase {
  kind: "running";
  edges: EntityRef[];
  direction: "up" | "down";
  passages: PassageSlice[];
  distanceMeters: number;
}

/** Dwelling 共有字段。 */
interface DwellingBase {
  kind: "dwelling";
  edgeRef: EntityRef;
  measure: number;
  duration?: number;
}

/**
 * 非站台停车 — 机外停车、技术停车、待避停车。
 * 物理上停下但无乘降; 不开门。
 */
export interface DwellingNoPlatform extends DwellingBase {
  atPlatform: false;
  reason?: "technical_wait" | "crossing" | "signal";
}

/**
 * 站台停车 — 列车停在 binding edge 上, 可能伴随乘降。
 *
 * boarding="none" 表示停在站台但不开门 (例如技术停车恰在 platform 上)。
 * 其他值表示开门乘降。
 */
export interface DwellingAtPlatform extends DwellingBase {
  atPlatform: true;
  platformRef: EntityRef;
  stationRef: EntityRef;
  boarding: "alight" | "board" | "both" | "none";
}

export type DwellingPhase = DwellingNoPlatform | DwellingAtPlatform;

/**
 * 发车 (瞬时) — 从 dwelling 静止状态进入下一段 running 的瞬间动作。
 *
 * `isReversal`: 派生属性。若 newDirection !== 上一 RunningPhase.direction → true。
 * 当前 ServiceStopEntry.operationType === "turnback" 的物理对应。
 */
export interface DepartingPhase {
  kind: "departing";
  edgeRef: EntityRef;
  measure: number;
  newDirection: "up" | "down";
  isReversal: boolean;
}

export type RunPhase = RunningPhase | DwellingPhase | DepartingPhase;

export type RunPhaseKind = RunPhase["kind"];

// ── 2. EventAnchor 挂载 ─────────────────────────────────────

/**
 * 事件锚点挂在某 phase 上, 不影响 phase 自身的运行状态。
 *
 * - platform anchor → 挂在 dwelling(atPlatform=true) 或 running.passages 中切片
 * - switch anchor → 挂在 running (途中经过道岔时)
 * - scenic anchor → 挂在 running (车窗景观)
 * - operation anchor → 挂在 dwelling (作业事件)
 * - user anchor → 挂在任意 phase (用户自定义)
 *
 * 当前 MVP 仅复用 EventAnchor (event.types.ts), 不限制 kind。
 */
export interface EventAnchorOnPhase {
  phaseIndex: number;
  anchor: EventAnchor;
  payload?: Record<string, unknown>;
}

/** Phase 序列容器 — buildPhaseSequence 的输出。 */
export interface PhaseSequence {
  phases: RunPhase[];
  anchors: EventAnchorOnPhase[];
}

// ── 3. CoarseRunPhase (兼容 pathfinding.PathPhase 的派生 view) ─

/**
 * 粗粒度运行段, 对应 "上行经过 / 下行经过 / 换向" 语义。
 *
 * 与 RunPhase 三原语的对应:
 * - up_run/down_run: 连续同向的 (RunningPhase + DwellingPhase + DepartingPhase) 序列
 * - turnback: 单个 DepartingPhase (isReversal=true) + 前置 DwellingPhase
 *
 * 字段与 pathfinding.PathPhase 结构兼容 (structural typing), 可直接互转。
 */
export type CoarseRunPhaseKind = "up_run" | "down_run" | "turnback";

export interface CoarseRunPhase {
  phaseIndex: number;
  kind: CoarseRunPhaseKind;
  directionRole?: TrackDirectionRole;
  edgeRange: { startIndex: number; endIndex: number };
  stationRefs: EntityRef[];
  distanceMeters: number;
}

// ── 3. 诊断 code 命名空间 ───────────────────────────────────

export const PhaseDiagnosticCode = {
  PHASE_EMPTY_SEQUENCE: "PHASE_EMPTY_SEQUENCE",
  PHASE_SEGMENT_EMPTY_EDGES: "PHASE_SEGMENT_EMPTY_EDGES",
  PHASE_REVERSAL_DIRECTION_MISMATCH: "PHASE_REVERSAL_DIRECTION_MISMATCH",
  PHASE_DWELLING_WITHOUT_PLATFORM: "PHASE_DWELLING_WITHOUT_PLATFORM",
} as const;

export type PhaseDiagnosticCodeKey = keyof typeof PhaseDiagnosticCode;
