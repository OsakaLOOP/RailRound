// ============================================================
// PoC Pathfinding Scenarios: 4 种情形验证
//
// 1. 纯上行   PA → PC
// 2. 纯下行   PD → PB
// 3. 上→下换向 PA → PB (经 2番B 换向)
// 4. 下→上换向 PD → PA (经 2番B 换向)
// ============================================================

import type { BaseTopologyLayer } from "../rail-graph-v1/base-topology.types";
import type { PathSeed, PathfindingResult } from "../rail-graph-v1/pathfinding";
import { findPaths } from "../rail-graph-v1/pathfinding";
import { buildTopologyLookup } from "../rail-graph-v1/topology";
import { TwoStationRefs } from "./poc-twostation";

export interface PathfindingScenario {
  name: string;
  description: string;
  startSeed: PathSeed;
  endSeed: PathSeed;
  expectedPhaseKinds: ("up_run" | "down_run" | "turnback")[];
  /** 是否期望在 2番B 上发生 turnback */
  expectsTurnbackOnB2: boolean;
}

export const SCENARIOS: PathfindingScenario[] = [
  {
    name: "Scenario 1: 纯上行 (PA → PC)",
    description: "上行列车从站 A PA (上行) 出发, 经 1番A 与 上行联络段 抵达站 B PC (上行).",
    startSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_A, direction: "up" },
    endSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_C, direction: "up" },
    expectedPhaseKinds: ["up_run"],
    expectsTurnbackOnB2: false,
  },
  {
    name: "Scenario 2: 纯下行 (PD → PB)",
    description: "下行列车从站 B PD (下行) 出发, 经 3番B 与 下行联络段 抵达站 A PB (下行).",
    startSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_D, direction: "down" },
    endSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_B, direction: "down" },
    expectedPhaseKinds: ["down_run"],
    expectsTurnbackOnB2: false,
  },
  {
    name: "Scenario 3: 上→下换向 (PA → PB)",
    description: "上行列车从 PA 出发, 在站 B 2番B 中線 停车换向, 反向沿下行返回站 A PB.",
    startSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_A, direction: "up" },
    endSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_B, direction: "down" },
    expectedPhaseKinds: ["up_run", "turnback", "down_run"],
    expectsTurnbackOnB2: true,
  },
  {
    name: "Scenario 4: 下→上换向 (PD → PC, 同站)",
    description: "下行列车从 PD 出发, 进 2番B 中線 停车换向, 反向沿上行抵达同站的 PC. PoC 拓扑下跨站下→上换向无解 (上行 A→B 与下行 B→A 单线), 同站换向是真实场景.",
    startSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_D, direction: "down" },
    endSeed: { kind: "platform", platformRef: TwoStationRefs.PLATFORM_C, direction: "up" },
    expectedPhaseKinds: ["down_run", "turnback", "up_run"],
    expectsTurnbackOnB2: true,
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

    results.push({
      scenario,
      candidates,
      best,
      passed: matchedShape && turnbackOk,
      reason: matchedShape && turnbackOk
        ? undefined
        : `phases expected ${scenario.expectedPhaseKinds.join(",")} got ${actualPhases.join(",")}${scenario.expectsTurnbackOnB2 ? "; expects turnback on 2番B" : ""}`,
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
      edgeSequence: r.best.edgeSequence,
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
