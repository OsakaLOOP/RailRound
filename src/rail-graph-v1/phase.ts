// ============================================================
// Rail Graph v1 — Phase Sequence Derivation
//
// 把 ResolvedChain 翻译为 RunPhase 三原语序列 (running/dwelling/departing),
// 以及粗粒度 CoarseRunPhase[] (兼容 pathfinding.PathPhase)。
//
// 派生关系:
//   ResolvedChain
//     ↓ buildPhaseSequence
//   PhaseSequence (phases: RunPhase[], anchors: EventAnchorOnPhase[])
//     ↓ phaseSequenceToCoarsePhases
//   CoarseRunPhase[] (up_run / down_run / turnback)
//
// 不依赖 pathfinding.ts。CoarseRunPhase 与 pathfinding.PathPhase
// 结构兼容 (structural typing), pathfinding 内可直接用。
// ============================================================

import type { ResolvedChain, RunningSegment, ResolvedIntentionNode } from "./chain.types";
import type { Diagnostic } from "./diagnostic-types";
import type { EntityRef } from "./primitives";
import type {
  CoarseRunPhase,
  DepartingPhase,
  DwellingPhase,
  EventAnchorOnPhase,
  PhaseSequence,
  RunningPhase,
  RunPhase,
} from "./phase.types";
import { PhaseDiagnosticCode } from "./phase.types";
import type { TopologyLookup } from "./topology";

// ── buildPhaseSequence ──────────────────────────────────────

/**
 * ResolvedChain → PhaseSequence
 *
 * 规则:
 * - segment[i] → RunningPhase (若 edges 非空)
 * - service_stop / technical_stop / reversal 节点 → DwellingPhase + DepartingPhase 一对
 * - origin / terminus → 不产 phase, 仅参与方向初始化
 * - operation 节点 → 与同位置 dwelling 共生, 产 EventAnchorOnPhase
 * - reversal 后翻转 currentDirection
 */
export function buildPhaseSequence(
  resolved: ResolvedChain,
  lookup: TopologyLookup,
): { sequence: PhaseSequence; diagnostics: Diagnostic[] } {
  const phases: RunPhase[] = [];
  const anchors: EventAnchorOnPhase[] = [];
  const diagnostics: Diagnostic[] = [];

  const originNode = resolved.nodes[0];
  let currentDirection: "up" | "down" = originNode?.kind === "origin" ? originNode.direction : "up";

  for (let i = 0; i < resolved.nodes.length; i += 1) {
    const node = resolved.nodes[i];

    // 1. node i 之前的 segment (incoming): toNodeIndex === i
    const incomingSeg = resolved.segments.find((s) => s.toNodeIndex === i);
    if (incomingSeg) {
      const runningPhase = segmentToRunning(incomingSeg);
      if (runningPhase) {
        phases.push(runningPhase);
        currentDirection = runningPhase.direction;
      }
    }

    // 2. node i 自身的 phase
    switch (node.kind) {
      case "service_stop": {
        const dwelling = makeDwellingForServiceStop(node);
        if (dwelling) {
          phases.push(dwelling);
          const departing = makeDeparting(node, currentDirection, false);
          if (departing) phases.push(departing);
        }
        break;
      }
      case "technical_stop": {
        const dwelling = makeDwellingForTechnicalStop(node);
        if (dwelling) {
          phases.push(dwelling);
          const departing = makeDeparting(node, currentDirection, false);
          if (departing) phases.push(departing);
        }
        break;
      }
      case "reversal": {
        const dwelling = makeDwellingForReversal(node);
        if (dwelling) {
          phases.push(dwelling);
          const newDirection: "up" | "down" = currentDirection === "up" ? "down" : "up";
          const departing = makeDeparting(node, newDirection, true);
          if (departing) phases.push(departing);
          currentDirection = newDirection;
        }
        break;
      }
      case "operation": {
        // 找到最近一个 dwelling (向前查找)
        let attachIdx = -1;
        for (let p = phases.length - 1; p >= 0; p -= 1) {
          if (phases[p].kind === "dwelling") { attachIdx = p; break; }
        }
        if (attachIdx >= 0) {
          anchors.push({
            phaseIndex: attachIdx,
            anchor: {
              anchorId: (`chain:operation:${node.nodeIndex}` as EntityRef),
              kind: "fixed_operation",
              fixedOperation: {
                operationType: node.opKind,
                stationRef: node.resolvedStationRef,
                platformRef: node.resolvedPlatformRef,
              },
            },
          });
        }
        break;
      }
      case "origin":
      case "terminus":
      case "passage":
        // origin/terminus 不产 phase; passage 由 segment.passages 表达 (无独立 phase)
        break;
    }
  }

  if (phases.length === 0 && resolved.edgeSequence.length > 0) {
    diagnostics.push({
      level: "warn",
      code: PhaseDiagnosticCode.PHASE_EMPTY_SEQUENCE,
      stage: "buildPhaseSequence",
      message: "Phase sequence is empty but path has edges.",
    });
  }

  void lookup;
  return { sequence: { phases, anchors }, diagnostics };
}

function segmentToRunning(seg: RunningSegment): RunningPhase | null {
  if (seg.edges.length === 0) return null;
  return {
    kind: "running",
    edges: [...seg.edges],
    direction: seg.direction,
    passages: [...seg.passages],
    distanceMeters: seg.distanceMeters,
  };
}

function makeDwellingForServiceStop(node: ResolvedIntentionNode): DwellingPhase | null {
  if (node.kind !== "service_stop") return null;
  if (!node.resolvedEdgeRef) return null;
  if (!node.resolvedPlatformRef || !node.resolvedStationRef) return null;
  return {
    kind: "dwelling",
    edgeRef: node.resolvedEdgeRef,
    measure: node.resolvedMeasure ?? 0.5,
    atPlatform: true,
    platformRef: node.resolvedPlatformRef,
    stationRef: node.resolvedStationRef,
    boarding: node.boarding,
    duration: node.duration,
  };
}

function makeDwellingForTechnicalStop(node: ResolvedIntentionNode): DwellingPhase | null {
  if (node.kind !== "technical_stop") return null;
  if (!node.resolvedEdgeRef) return null;
  return {
    kind: "dwelling",
    edgeRef: node.resolvedEdgeRef,
    measure: node.measure,
    atPlatform: false,
    reason: node.reason === "wait" ? "technical_wait" : node.reason,
  };
}

function makeDwellingForReversal(node: ResolvedIntentionNode): DwellingPhase | null {
  if (node.kind !== "reversal") return null;
  if (!node.resolvedEdgeRef) return null;
  if (node.resolvedPlatformRef && node.resolvedStationRef && node.boarding) {
    return {
      kind: "dwelling",
      edgeRef: node.resolvedEdgeRef,
      measure: node.resolvedMeasure ?? 0.5,
      atPlatform: true,
      platformRef: node.resolvedPlatformRef,
      stationRef: node.resolvedStationRef,
      boarding: node.boarding,
    };
  }
  return {
    kind: "dwelling",
    edgeRef: node.resolvedEdgeRef,
    measure: node.resolvedMeasure ?? 0.5,
    atPlatform: false,
  };
}

function makeDeparting(
  node: ResolvedIntentionNode,
  newDirection: "up" | "down",
  isReversal: boolean,
): DepartingPhase | null {
  if (!node.resolvedEdgeRef) return null;
  return {
    kind: "departing",
    edgeRef: node.resolvedEdgeRef,
    measure: node.resolvedMeasure ?? 0.5,
    newDirection,
    isReversal,
  };
}

// ── phaseSequenceToCoarsePhases ─────────────────────────────

/**
 * PhaseSequence → CoarseRunPhase[]
 *
 * 规则:
 * - 同向 RunningPhase + DwellingPhase + 同向 DepartingPhase 合并为一段 up_run/down_run
 * - reversal DepartingPhase → 独立 turnback phase
 * - 与 pathfinding.PathPhase 结构兼容
 */
export function phaseSequenceToCoarsePhases(
  sequence: PhaseSequence,
  edgeSequence: EntityRef[],
  lookup: TopologyLookup,
): CoarseRunPhase[] {
  const out: CoarseRunPhase[] = [];
  let phaseIndex = 0;
  let coarseStartEdgeIdx = 0;
  let coarseDirection: "up" | "down" | null = null;
  let coarseStations: EntityRef[] = [];
  let coarseDistance = 0;
  let cursorEdgeIdx = 0;

  const flushCoarse = (endEdgeIdxExclusive: number): void => {
    if (coarseDirection === null) return;
    out.push({
      phaseIndex: phaseIndex++,
      kind: coarseDirection === "up" ? "up_run" : "down_run",
      directionRole: coarseDirection,
      edgeRange: { startIndex: coarseStartEdgeIdx, endIndex: Math.max(coarseStartEdgeIdx, endEdgeIdxExclusive - 1) },
      stationRefs: dedupe(coarseStations),
      distanceMeters: coarseDistance,
    });
    coarseDirection = null;
    coarseStations = [];
    coarseDistance = 0;
  };

  for (const phase of sequence.phases) {
    if (phase.kind === "running") {
      if (coarseDirection === null) {
        coarseDirection = phase.direction;
        coarseStartEdgeIdx = cursorEdgeIdx;
      } else if (coarseDirection !== phase.direction) {
        flushCoarse(cursorEdgeIdx);
        coarseDirection = phase.direction;
        coarseStartEdgeIdx = cursorEdgeIdx;
      }
      coarseDistance += phase.distanceMeters;
      for (const slice of phase.passages) {
        if (slice.stationRef) coarseStations.push(slice.stationRef);
      }
      cursorEdgeIdx += phase.edges.length;
    } else if (phase.kind === "dwelling") {
      if (phase.atPlatform) {
        coarseStations.push(phase.stationRef);
      }
      // dwelling 不推进 edgeIdx (停在某 edge 上, 该 edge 是上一 running 的最后一条)
    } else if (phase.kind === "departing") {
      if (phase.isReversal) {
        // 把当前 coarse flush, 然后插入 turnback phase
        const turnbackEdgeIdx = Math.max(0, cursorEdgeIdx - 1);
        flushCoarse(cursorEdgeIdx);
        out.push({
          phaseIndex: phaseIndex++,
          kind: "turnback",
          edgeRange: { startIndex: turnbackEdgeIdx, endIndex: turnbackEdgeIdx },
          stationRefs: [],
          distanceMeters: 0,
        });
      }
    }
  }
  flushCoarse(cursorEdgeIdx);

  void edgeSequence;
  void lookup;
  return out;
}

function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}
