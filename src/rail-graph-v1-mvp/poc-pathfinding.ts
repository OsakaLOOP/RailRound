// ============================================================
// PoC Pathfinding Scenarios: 4 种情形验证
//
// 起点 / 终点全部使用"延伸段远端节点" (= 主线尽头), 体现"列车从线路边界进入,
// 经站内运行, 从线路边界出去"的真实运行场景. 起点 marker 自然落在主线上,
// 不会出现"从越行线起步"的视觉歧义.
//
//   nodeA1WestExt (上行起, 西远) ─ 站 A ─ 联络 ─ 站 B ─ nodeB1EastExt (上行终, 东远)
//   nodeA4WestExt (下行终, 西远) ─ 站 A ─ 联络 ─ 站 B ─ nodeB3EastExt (下行起, 东远)
//
// 1. 纯上行   nodeA1WestExt → nodeB1EastExt (经 PA, PC)
// 2. 纯下行   nodeB3EastExt → nodeA4WestExt (经 PD, PB)
// 3. 上→下换向 nodeA1WestExt → nodeA4WestExt (经 PA, 站 B 中线换向, PB)
// 4. 下→上换向 nodeB3EastExt → nodeB1EastExt (经 PD, 站 B 中线换向, PC)
// ============================================================

import type { BaseTopologyLayer } from "../rail-graph-v1/base-topology.types";
import type { IntentionChain } from "../rail-graph-v1/chain.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { PathGoal, PathSeed, PathfindingResult } from "../rail-graph-v1/pathfinding";
import { findPaths } from "../rail-graph-v1/pathfinding";
import { buildTopologyLookup } from "../rail-graph-v1/topology";
import { TwoStationRefs } from "./poc-twostation";

export interface PathfindingScenario {
  name: string;
  description: string;
  startSeed: PathSeed;
  endSeed: PathSeed;
  /** 旧入口, 兼容期保留. 若同时提供 intentionChain, intentionChain 优先. */
  pathGoal?: PathGoal;
  /** 新入口 — 运行意图链. */
  intentionChain?: IntentionChain;
  expectedPhaseKinds: ("up_run" | "down_run" | "turnback")[];
  /** 是否期望在 2番B 上发生 turnback */
  expectsTurnbackOnB2: boolean;
  /** sketch mode 额外校验: 期望 inferSketchChain 反向补出 reversal 落在某 edge */
  expectedAutoReversalAt?: EntityRef;
}

export const SCENARIOS: PathfindingScenario[] = [
  {
    name: "Scenario 1: 纯上行 (西外 → 东外, 经 PA→PC)",
    description: "上行列车从站 A 西端线路边界进入, 经 1番A (PA) 与上行联络段, 抵达站 B 东端线路边界 (途经 PC).",
    startSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_A1_WEST_EXT, alongDirection: "up" },
    endSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_B1_EAST_EXT },
    pathGoal: { kind: "shorthand", pattern: "main_in_main_out_no_stop" },
    intentionChain: {
      mode: "strict",
      nodes: [
        { kind: "origin", at: { nodeRef: TwoStationRefs.NODE_A1_WEST_EXT }, direction: "up" },
        { kind: "terminus", at: { nodeRef: TwoStationRefs.NODE_B1_EAST_EXT } },
      ],
    },
    expectedPhaseKinds: ["up_run"],
    expectsTurnbackOnB2: false,
  },
  {
    name: "Scenario 2: 纯下行 (东外 → 西外, 经 PD→PB)",
    description: "下行列车从站 B 东端线路边界进入, 经 3番B (PD) 与下行联络段, 抵达站 A 西端线路边界 (途经 PB).",
    startSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_B3_EAST_EXT, alongDirection: "down" },
    endSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_A4_WEST_EXT },
    pathGoal: { kind: "shorthand", pattern: "main_in_main_out_no_stop" },
    intentionChain: {
      mode: "strict",
      nodes: [
        { kind: "origin", at: { nodeRef: TwoStationRefs.NODE_B3_EAST_EXT }, direction: "down" },
        { kind: "terminus", at: { nodeRef: TwoStationRefs.NODE_A4_WEST_EXT } },
      ],
    },
    expectedPhaseKinds: ["down_run"],
    expectsTurnbackOnB2: false,
  },
  {
    name: "Scenario 3: 上→下换向 (西外往返, 经 PA → 2番B 换向 → PB)",
    description: "上行列车从西端进入, 抵达站 B 后在 2番B 中线停车换向, 改沿下行返回西端线路边界 (途经 PA, 换向, PB).",
    startSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_A1_WEST_EXT, alongDirection: "up" },
    endSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_A4_WEST_EXT },
    pathGoal: { kind: "shorthand", pattern: "main_in_main_out_turnback_once" },
    intentionChain: {
      mode: "strict",
      nodes: [
        { kind: "origin", at: { nodeRef: TwoStationRefs.NODE_A1_WEST_EXT }, direction: "up" },
        { kind: "reversal", at: TwoStationRefs.TRACK_B2, boarding: "none" },
        { kind: "terminus", at: { nodeRef: TwoStationRefs.NODE_A4_WEST_EXT } },
      ],
    },
    expectedPhaseKinds: ["up_run", "turnback", "down_run"],
    expectsTurnbackOnB2: true,
  },
  {
    name: "Scenario 4: 下→上换向 (东外往返, 经 PD → 2番B 换向 → PC)",
    description: "下行列车从东端进入, 抵达站 B 后在 2番B 中线停车换向, 改沿上行返回东端线路边界 (途经 PD, 换向, PC).",
    startSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_B3_EAST_EXT, alongDirection: "down" },
    endSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_B1_EAST_EXT },
    pathGoal: { kind: "shorthand", pattern: "main_in_main_out_turnback_once" },
    intentionChain: {
      mode: "strict",
      nodes: [
        { kind: "origin", at: { nodeRef: TwoStationRefs.NODE_B3_EAST_EXT }, direction: "down" },
        { kind: "reversal", at: TwoStationRefs.TRACK_B2, boarding: "none" },
        { kind: "terminus", at: { nodeRef: TwoStationRefs.NODE_B1_EAST_EXT } },
      ],
    },
    expectedPhaseKinds: ["down_run", "turnback", "up_run"],
    expectsTurnbackOnB2: true,
  },
  {
    name: "Scenario 5 (sketch): 上→下换向, 让 DFS 自由发挥",
    description: "起终点同 S3, 但 chain 仅含 origin + terminus (sketch mode). DFS 自由探索, inferSketchChain 反向补出 reversal + passage 节点.",
    startSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_A1_WEST_EXT, alongDirection: "up" },
    endSeed: { kind: "node", nodeRef: TwoStationRefs.NODE_A4_WEST_EXT },
    intentionChain: {
      mode: "sketch",
      nodes: [
        { kind: "origin", at: { nodeRef: TwoStationRefs.NODE_A1_WEST_EXT }, direction: "up" },
        { kind: "terminus", at: { nodeRef: TwoStationRefs.NODE_A4_WEST_EXT } },
      ],
    },
    expectedPhaseKinds: ["up_run", "turnback", "down_run"],
    expectsTurnbackOnB2: true,
    expectedAutoReversalAt: TwoStationRefs.TRACK_B2,
  },
];

export interface ScenarioResult {
  scenario: PathfindingScenario;
  candidates: PathfindingResult[];
  best?: PathfindingResult;
  passed: boolean;
  reason?: string;
}

/**
 * 对每个 scenario 跑 findPaths, 比对 phase 形态, 收集结果。
 * 不依赖测试框架, 仅返回结果对象供 UI / console 消费。
 */
export function runScenarios(topo: BaseTopologyLayer): ScenarioResult[] {
  const lookup = buildTopologyLookup(topo);
  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    const candidates = findPaths(topo, lookup, scenario.startSeed, scenario.endSeed, {
      maxCandidates: 8,
      maxDepth: 32,
      allowTurnback: true,
      intentionChain: scenario.intentionChain,
      pathGoal: scenario.pathGoal,
    });

    if (candidates.length === 0) {
      results.push({
        scenario,
        candidates: [],
        passed: false,
        reason: "No candidates returned",
      });
      continue;
    }

    const best = candidates[0];
    const actualPhases = best.phases.map((p) => p.kind);
    const matchedShape = phaseShapeMatches(actualPhases, scenario.expectedPhaseKinds);
    const turnbackOk = scenario.expectsTurnbackOnB2
      ? best.phases.some((p) => p.kind === "turnback" && best.edgeSequence[p.edgeRange.startIndex] === TwoStationRefs.TRACK_B2)
      : best.phases.every((p) => p.kind !== "turnback");
    const mainStartOk = best.startKind === "main";
    const autoReversalOk = scenario.expectedAutoReversalAt
      ? (best.resolvedChain?.nodes ?? []).some((n) => n.kind === "reversal" && n.at === scenario.expectedAutoReversalAt)
      : true;

    const reasons: string[] = [];
    if (!matchedShape) reasons.push(`phases expected ${scenario.expectedPhaseKinds.join(",")} got ${actualPhases.join(",")}`);
    if (!turnbackOk) reasons.push(scenario.expectsTurnbackOnB2 ? "expects turnback on 2番B" : "did not expect turnback");
    if (!mainStartOk) reasons.push(`startKind=${best.startKind}`);
    if (!autoReversalOk) reasons.push(`expected auto-inferred reversal at ${scenario.expectedAutoReversalAt}`);

    results.push({
      scenario,
      candidates,
      best,
      passed: matchedShape && turnbackOk && mainStartOk && autoReversalOk,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    });
  }

  return results;
}

function phaseShapeMatches(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * 把 scenario results 压缩成可序列化的 summary, 便于显示。
 */
export function summarizeScenarios(results: ScenarioResult[]): unknown {
  return results.map((r) => ({
    name: r.scenario.name,
    description: r.scenario.description,
    passed: r.passed,
    reason: r.reason,
    candidatesCount: r.candidates.length,
    best: r.best ? {
      totalDistanceMeters: Math.round(r.best.totalDistanceMeters),
      startKind: r.best.startKind,
      edgeSequence: r.best.edgeSequence,
      turnbackEdgeIndices: r.best.turnbackEdgeIndices,
      phases: r.best.phases.map((p) => ({
        phaseIndex: p.phaseIndex,
        kind: p.kind,
        directionRole: p.directionRole,
        edgeRange: p.edgeRange,
        stationRefs: p.stationRefs,
        distanceMeters: Math.round(p.distanceMeters),
      })),
      traceSequence: r.best.traceSequence.map((t) => t.passageType === "stop"
        ? {
          orderIndex: t.orderIndex,
          stop: true,
          stationRef: t.stationRef,
          platformRef: t.platformRef,
          platformName: t.platformName,
          edgeRef: t.edgeRef,
          measure: t.measure,
          operationType: t.operationType,
        }
        : {
          orderIndex: t.orderIndex,
          stop: false,
          stationRef: t.stationRef,
          platformRef: t.platformRef,
          edgeRef: t.edgeRef,
        }),
      chainMode: r.best.resolvedChain?.mode,
      chainNodes: r.best.resolvedChain?.nodes.map((n) => ({
        nodeIndex: n.nodeIndex,
        kind: n.kind,
        resolvedPlatformRef: n.resolvedPlatformRef,
        resolvedEdgeRef: n.resolvedEdgeRef,
        resolvedStationRef: n.resolvedStationRef,
      })),
      chainSegments: r.best.resolvedChain?.segments.map((s) => ({
        fromNodeIndex: s.fromNodeIndex,
        toNodeIndex: s.toNodeIndex,
        direction: s.direction,
        edgesCount: s.edges.length,
        distanceMeters: Math.round(s.distanceMeters),
        passagesCount: s.passages.length,
      })),
      diagnostics: r.best.diagnostics,
    } : null,
  }));
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    pocPathfinding: {
      SCENARIOS,
      runScenarios,
      summarizeScenarios,
    },
  });
}
