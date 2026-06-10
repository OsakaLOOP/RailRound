/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from '../rail-graph-v1-mvp/app';
import { SENSEKI_RAIL } from '../rail-graph-v1-mvp/senseki-data';
import { runSensekiScenarios, SENSEKI_PF_OVERRIDES } from '../rail-graph-v1-mvp/poc-senseki-pathfinding';

describe('Senseki Pathfinding S3', () => {
  it('should find a path for S3', () => {
    loadGeoJson(SENSEKI_RAIL);

    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      annotateFeature(id, annotation as any);
    });

    const topo = exportTopology();
    console.log(`Topology edges: ${topo.edges.length}, nodes: ${topo.nodes.length}`);

    const results = runSensekiScenarios(topo);
    const s3 = results.find(r => r.scenario.name.startsWith("S3"));
    expect(s3).toBeDefined();
    console.log(`S3 passed? ${s3!.passed}, candidates: ${s3!.candidates.length}`);
    if (!s3!.passed) {
      console.log("Reason:", s3!.reason);
    }
    expect(s3!.passed).toBe(true);
    expect(s3!.candidates.length).toBeGreaterThan(0);

    const s4 = results.find(r => r.scenario.name.startsWith("S4"));
    expect(s4).toBeDefined();
    console.log(`S4 passed? ${s4!.passed}, candidates: ${s4!.candidates.length}`);
    if (!s4!.passed) {
      console.log("Reason:", s4!.reason);
    }
    expect(s4!.passed).toBe(true);
    expect(s4!.candidates.length).toBeGreaterThan(0);

    const s5 = results.find(r => r.scenario.name.startsWith("S5"));
    expect(s5).toBeDefined();
    console.log(`S5 passed? ${s5!.passed}, candidates: ${s5!.candidates.length}`);
    if (!s5!.passed) {
      console.log("Reason:", s5!.reason);
    }
    expect(s5!.passed).toBe(true);
    expect(s5!.candidates.length).toBeGreaterThan(0);
  });
});
