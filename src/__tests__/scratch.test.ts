/**
 * @vitest-environment jsdom
 */
import { describe, it } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from '../rail-graph-v1-mvp/app';
import { SENSEKI_RAIL } from '../rail-graph-v1-mvp/senseki-data';
import { SENSEKI_PF_OVERRIDES } from '../rail-graph-v1-mvp/poc-senseki-pathfinding';
import { buildTopologyLookup } from '../rail-graph-v1/topology';
import { findPaths } from '../rail-graph-v1/pathfinding';

describe('Diagnostics', () => {
  it('should run S5 pathfinding at depth 200', () => {
    loadGeoJson(SENSEKI_RAIL);

    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      const index = SENSEKI_RAIL.features.findIndex(f => f.properties?.railGraph?.id === id || f.properties?.osm_id === id.replace("osm:way:", ""));
      if (index !== -1) {
        annotateFeature(index, annotation as any);
      }
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);

    const edge1320 = topo.edges.find(e => e.sourceSlice?.sourceFeatureRef === "osm:way:1320551298")!;
    const edge3513 = topo.edges.find(e => e.sourceSlice?.sourceFeatureRef === "osm:way:351315047")!;

    function findDeadEndNode(edge: any): string {
      const fromOut = topo.adjacency.outEdges[edge.fromNodeRef]?.length ?? 0;
      const fromIn = topo.adjacency.inEdges[edge.fromNodeRef]?.length ?? 0;
      const fromDegree = fromOut + fromIn;
      return fromDegree === 1 ? edge.fromNodeRef : edge.toNodeRef;
    }

    const dead1320 = findDeadEndNode(edge1320);
    const dead3513 = findDeadEndNode(edge3513);

    console.log("Running S5 with maxDepth = 200...");
    const startSeed = { kind: "node" as const, nodeRef: dead1320, alongDirection: "down" as const };
    const endSeed = { kind: "node" as const, nodeRef: dead3513 };

    const candidates = findPaths(topo, lookup, startSeed, endSeed, {
      maxCandidates: 4,
      maxDepth: 200,
      allowTurnback: true,
    });

    console.log(`S5 Candidates found: ${candidates.length}`);
    if (candidates.length > 0) {
      const best = candidates[0];
      console.log(`Best distance: ${best.totalDistanceMeters}m`);
      console.log(`Edge count: ${best.edgeSequence.length}`);
    }
  });
});
