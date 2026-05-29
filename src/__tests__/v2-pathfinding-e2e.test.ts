/**
 * @vitest-environment jsdom
 *
 * Pathfinding v2 端到端 smoke 测试:
 * 用 S3-S5 真实仙石線数据, 验证 v2 能找到候选, 性能比 v1 优.
 */
import { describe, it, expect } from "vitest";
import { loadGeoJson, exportTopology, annotateFeature } from "../rail-graph-v1-mvp/app";
import { SENSEKI_RAIL } from "../rail-graph-v1-mvp/senseki-data";
import { createGraphPortFromTopology } from "../rail-graph-v1/pathfinding-v2-graph-port";
import { buildLineGraph } from "../rail-graph-v1/pathfinding-v2-line-graph";
import { SENSEKI_PF_OVERRIDES, buildScenarios } from "../rail-graph-v1-mvp/poc-senseki-pathfinding";
import { buildTopologyLookup } from "../rail-graph-v1/topology";
// Note: createGraphPortFromTopology & buildLineGraph imported above for potential debug; not required by current tests.
void createGraphPortFromTopology;
void buildLineGraph;
import { resolveSeed } from "../rail-graph-v1/pathfinding";
import { findPathsV2 } from "../rail-graph-v1/pathfinding-v2";
import { createImplicitChain } from "../rail-graph-v1/chain";
import type { IntentionChain, ChainEndpointAnchor } from "../rail-graph-v1/chain.types";
import type { PathSeed } from "../rail-graph-v1/pathfinding";

function seedToAnchor(seed: PathSeed, direction: "up" | "down" = "up"): { at: ChainEndpointAnchor; direction: "up" | "down" } {
  if (seed.kind === "node") {
    return { at: { nodeRef: seed.nodeRef }, direction: seed.alongDirection === "down" ? "down" : "up" };
  }
  if (seed.kind === "edgeMeasure") {
    return {
      at: { edgeRef: seed.edgeRef, measure: seed.measure },
      direction,
    };
  }
  return { at: { nodeRef: "" as any }, direction: seed.direction };
}

describe("Pathfinding v2 — senseki end-to-end", () => {
  it("solves S3 (跨渡线, 无折返) in shorter iterations than v1", () => {
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      annotateFeature(id, annotation as any);
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);
    const SENSEKI_SCENARIOS = buildScenarios(topo, lookup);

    const s3 = SENSEKI_SCENARIOS.find((s) => s.name.startsWith("S3"));
    expect(s3).toBeDefined();
    if (!s3) return;

    const startRes = resolveSeed(topo, lookup, s3.startSeed);
    const endRes = resolveSeed(topo, lookup, s3.endSeed);
    expect(startRes.entryPoints.length).toBeGreaterThan(0);
    expect(endRes.entryPoints.length).toBeGreaterThan(0);

    // implicit chain (origin + terminus only, sketch mode)
    const originAnchor = seedToAnchor(s3.startSeed, "down");
    const terminusAnchor = seedToAnchor(s3.endSeed);
    const chain: IntentionChain = createImplicitChain(originAnchor, terminusAnchor);

    const t0 = performance.now();
    const result = findPathsV2({
      topo,
      lookup,
      startEntryPoints: startRes.entryPoints,
      endEntryPoints: endRes.entryPoints,
      chain,
      initialDirectionRole: startRes.initialDirectionRole,
      maxCandidates: 4,
      angleThresholdDeg: 90,
      timeoutMs: 5000,
    });
    const t1 = performance.now();
    const elapsed = t1 - t0;

    console.log("[v2 S3] elapsed=%dms", elapsed.toFixed(2));
    console.log("[v2 S3] candidates=%d, searchInvocations=%d, lgBuildMs=%d",
      result.candidates.length, result.stats.searchInvocations, result.stats.lgBuildTimeMs.toFixed(2));
    if (result.candidates.length > 0) {
      console.log("[v2 S3] best totalDistance=%dm, edgeCount=%d",
        result.candidates[0].totalDistanceMeters.toFixed(0),
        result.candidates[0].edgeSequence.length);
    }

    expect(result.candidates.length).toBeGreaterThan(0);
    // v1 baseline: 8807 iterations / 11s. v2 应该不超 5000 expansions
    expect(elapsed).toBeLessThan(2000);
  });

  it("solves S5 (跨整条线 146 edges)", () => {
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      annotateFeature(id, annotation as any);
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);
    const SENSEKI_SCENARIOS = buildScenarios(topo, lookup);

    const s5 = SENSEKI_SCENARIOS.find((s) => s.name.startsWith("S5"));
    expect(s5).toBeDefined();
    if (!s5) return;

    const startRes = resolveSeed(topo, lookup, s5.startSeed);
    const endRes = resolveSeed(topo, lookup, s5.endSeed);

    const originAnchor = seedToAnchor(s5.startSeed, "down");
    const terminusAnchor = seedToAnchor(s5.endSeed);
    const chain: IntentionChain = createImplicitChain(originAnchor, terminusAnchor);

    const t0 = performance.now();
    const result = findPathsV2({
      topo,
      lookup,
      startEntryPoints: startRes.entryPoints,
      endEntryPoints: endRes.entryPoints,
      chain,
      initialDirectionRole: startRes.initialDirectionRole,
      maxCandidates: 4,
      timeoutMs: 5000,
    });
    const t1 = performance.now();

    console.log("[v2 S5] elapsed=%dms candidates=%d searchInvocations=%d",
      (t1 - t0).toFixed(2), result.candidates.length, result.stats.searchInvocations);
    if (result.candidates.length > 0) {
      console.log("[v2 S5] best totalDistance=%dm, edgeCount=%d",
        result.candidates[0].totalDistanceMeters.toFixed(0),
        result.candidates[0].edgeSequence.length);
    }

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(t1 - t0).toBeLessThan(3000);
  });

  it("solves S1 (全程往返 1 折返) — v1 OOM/0-cand 场景", () => {
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      annotateFeature(id, annotation as any);
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);
    const SENSEKI_SCENARIOS = buildScenarios(topo, lookup);

    const s1 = SENSEKI_SCENARIOS.find((s) => s.name.startsWith("S1"));
    expect(s1).toBeDefined();
    if (!s1) return;

    const startRes = resolveSeed(topo, lookup, s1.startSeed);
    const endRes = resolveSeed(topo, lookup, s1.endSeed);

    // S1 需要 1 turnback. 用 explicit chain 表达 (origin + reversal at edge1320 + terminus)
    // 从 scenario.pathGoal 中读出 turnback.edgeRef
    const turnbackEdge = s1.pathGoal && "turnback" in s1.pathGoal ? s1.pathGoal.turnback?.edgeRef : undefined;
    expect(turnbackEdge).toBeDefined();

    const originAnchor = seedToAnchor(s1.startSeed, "up");
    const terminusAnchor = seedToAnchor(s1.endSeed);
    const chain: IntentionChain = {
      mode: "strict",
      nodes: [
        { kind: "origin", at: originAnchor.at, direction: originAnchor.direction },
        { kind: "reversal", at: turnbackEdge, boarding: "none" },
        { kind: "terminus", at: terminusAnchor.at },
      ],
    };

    const t0 = performance.now();
    const result = findPathsV2({
      topo,
      lookup,
      startEntryPoints: startRes.entryPoints,
      endEntryPoints: endRes.entryPoints,
      chain,
      initialDirectionRole: startRes.initialDirectionRole,
      maxCandidates: 4,
      timeoutMs: 5000,
    });
    const t1 = performance.now();

    console.log("[v2 S1] elapsed=%dms candidates=%d searchInvocations=%d",
      (t1 - t0).toFixed(2), result.candidates.length, result.stats.searchInvocations);
    if (result.candidates.length > 0) {
      console.log("[v2 S1] best totalDistance=%dm, edgeCount=%d, turnbackAt=%s",
        result.candidates[0].totalDistanceMeters.toFixed(0),
        result.candidates[0].edgeSequence.length,
        JSON.stringify(result.candidates[0].turnbackAt));
    }

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(t1 - t0).toBeLessThan(5000);
  });
});
