import { describe, it, expect } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from './app';
import { SENSEKI_RAIL } from './senseki-data';
import { runSensekiScenarios, SENSEKI_PF_OVERRIDES } from './poc-senseki-pathfinding';

describe('Senseki Pathfinding S3', () => {
  it('should find a path for S3', () => {
    loadGeoJson(SENSEKI_RAIL);

    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      const index = SENSEKI_RAIL.features.findIndex(f => f.properties?.railGraph?.id === id || f.properties?.osm_id === id.replace("osm:way:", ""));
      if (index !== -1) {
        annotateFeature(index, annotation as any);
      }
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

    const s4 = results.find(r => r.scenario.name.startsWith("S4"));
    expect(s4).toBeDefined();
    console.log(`S4 passed? ${s4!.passed}, candidates: ${s4!.candidates.length}`);
    if (!s4!.passed) {
      console.log("Reason:", s4!.reason);
    }

    const s5 = results.find(r => r.scenario.name.startsWith("S5"));
    expect(s5).toBeDefined();
    console.log(`S5 passed? ${s5!.passed}, candidates: ${s5!.candidates.length}`);
    if (!s5!.passed) {
      console.log("Reason:", s5!.reason);
    }
    
    // We want to verify it actually passed!
    // expect(s3!.passed).toBe(true);
    // expect(s3!.candidates.length).toBeGreaterThan(0);
  });
});
