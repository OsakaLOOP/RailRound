/**
 * @vitest-environment jsdom
 *
 * Line Graph 构建 sanity 测试:
 * 在仙石線真实数据上验证 LG 节点数、边数、剪枝统计。
 */
import { describe, it, expect } from "vitest";
import { loadGeoJson, exportTopology, annotateFeature } from "../rail-graph-v1-mvp/app";
import { SENSEKI_RAIL } from "../rail-graph-v1-mvp/senseki-data";
import { SENSEKI_PF_OVERRIDES } from "../rail-graph-v1-mvp/poc-senseki-pathfinding";
import { buildTopologyLookup } from "../rail-graph-v1/topology";
import { createGraphPortFromTopology } from "../rail-graph-v1/pathfinding-v2-graph-port";
import { buildLineGraph } from "../rail-graph-v1/pathfinding-v2-line-graph";

describe("Line Graph v2 — senseki sanity", () => {
  it("constructs LG with expected scale and pruning stats", () => {
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      const index = SENSEKI_RAIL.features.findIndex(
        (f) =>
          (f.properties as any)?.railGraph?.id === id ||
          (f.properties as any)?.osm_id === id.replace("osm:way:", ""),
      );
      if (index !== -1) annotateFeature(index, annotation as any);
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);
    const port = createGraphPortFromTopology(topo, lookup);
    const lg = buildLineGraph(port, { angleThresholdDeg: 90 });

    console.log("[LG sanity] stats =", lg.stats);
    console.log(
      "[LG sanity] nodes=%d, transit edges=%d, turnback edges=%d",
      lg.nodes.size,
      lg.stats.transitEdges,
      lg.stats.turnbackEdges,
    );
    console.log(
      "[LG sanity] pruned: angle=%d direction=%d arrow=%d hardConstraint=%d",
      lg.stats.prunedByAngle,
      lg.stats.prunedByDirection,
      lg.stats.prunedByGeometryArrow,
      lg.stats.prunedByHardConstraint,
    );

    // ── 断言 ──
    // 仙石線拓扑: 223 edges, 213 nodes. 大多数 edge 应为 traversal=both → 2 LG nodes
    expect(lg.nodes.size).toBeGreaterThan(topo.edges.length); // 至少 > edges (有些 forward, 大多 both)
    expect(lg.nodes.size).toBeLessThanOrEqual(2 * topo.edges.length);

    // 至少有一些 transit 边 (整个图不应该全部被剪掉)
    expect(lg.stats.transitEdges).toBeGreaterThan(50);

    // 至少有一些 turnback 边 (S0-S2 场景里 annotated 多条 reversible+turnback edge)
    expect(lg.stats.turnbackEdges).toBeGreaterThan(0);

    // 构建时间应远小于 v1 一次 DFS 的耗时 (v1 S2 ~1.5s)
    expect(lg.stats.buildTimeMs).toBeLessThan(500);

    // 无孤立 LG node 比例不应过高 (允许一些尽头线 dead-end LG node, 但不应超过 50%)
    let isolatedCount = 0;
    for (const id of lg.nodes.keys()) {
      const out = lg.outgoing.get(id);
      if (!out || out.length === 0) isolatedCount += 1;
    }
    console.log("[LG sanity] isolated LG nodes:", isolatedCount, "/", lg.nodes.size);
    expect(isolatedCount).toBeLessThan(lg.nodes.size * 0.5);
  });

  it("reversible+turnback edges produce paired turnback LG edges", () => {
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      const index = SENSEKI_RAIL.features.findIndex(
        (f) =>
          (f.properties as any)?.railGraph?.id === id ||
          (f.properties as any)?.osm_id === id.replace("osm:way:", ""),
      );
      if (index !== -1) annotateFeature(index, annotation as any);
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);
    const port = createGraphPortFromTopology(topo, lookup);
    const lg = buildLineGraph(port);

    let turnbackEdgeCount = 0;
    for (const edge of topo.edges) {
      if (port.isTurnbackEdge(edge.id)) {
        turnbackEdgeCount += 1;
        // 每条 reversible+turnback edge 应有 2 个 LG 节点
        const lgIds = lg.lgNodesByEdge.get(edge.id);
        expect(lgIds?.length).toBe(2);
        // 双向 turnback 边
        const fromToOut = lg.outgoing.get(`${edge.id}#fromTo`) ?? [];
        const toFromOut = lg.outgoing.get(`${edge.id}#toFrom`) ?? [];
        const hasFromToToFromBack = fromToOut.some(
          (e) => e.kind === "turnback" && e.toLG === `${edge.id}#toFrom`,
        );
        const hasToFromToFromToBack = toFromOut.some(
          (e) => e.kind === "turnback" && e.toLG === `${edge.id}#fromTo`,
        );
        expect(hasFromToToFromBack).toBe(true);
        expect(hasToFromToFromToBack).toBe(true);
      }
    }
    console.log("[LG sanity] turnback edges found:", turnbackEdgeCount);
    expect(turnbackEdgeCount).toBeGreaterThan(0);
  });
});
