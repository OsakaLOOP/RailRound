/**
 * @vitest-environment jsdom
 */
import { describe, it } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from '../rail-graph-v1-mvp/app';
import { SENSEKI_RAIL } from '../rail-graph-v1-mvp/senseki-data';
import { SENSEKI_PF_OVERRIDES } from '../rail-graph-v1-mvp/poc-senseki-pathfinding';
import { buildTopologyLookup } from '../rail-graph-v1/topology';

describe('Step 2: Connectivity analysis of 4 objects', () => {
  it('should print full connectivity data for the 4 target objects', () => {
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      const index = SENSEKI_RAIL.features.findIndex(f => 
        f.properties?.railGraph?.id === id || 
        f.properties?.osm_id === id.replace("osm:way:", "")
      );
      if (index !== -1) {
        annotateFeature(index, annotation as any);
      }
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);

    const targetRefs = [
      'osm:way:1320551298',
      'osm:way:775723282',
      'osm:way:775723282(1)',
      'osm:way:1320551299'
    ];

    const edges = topo.edges.filter(e => targetRefs.includes(e.sourceSlice?.sourceFeatureRef || ''));

    console.log(`=== Target Edges and Nodes ===`);
    edges.forEach(e => {
      console.log(`Edge: ${e.id} (ref: ${e.sourceSlice?.sourceFeatureRef})`);
      console.log(`  fromNode: ${e.fromNodeRef} coords:`, lookup.nodesById[e.fromNodeRef]?.coordinates);
      console.log(`  toNode:   ${e.toNodeRef} coords:`, lookup.nodesById[e.toNodeRef]?.coordinates);
      console.log(`  traversal: ${e.traversal}, directionRole: ${e.directionRole}`);
    });

    // We collect all unique nodes from these edges
    const nodes = new Set<string>();
    edges.forEach(e => {
      nodes.add(e.fromNodeRef);
      nodes.add(e.toNodeRef);
    });

    console.log(`\n=== Node Adjacency Info ===`);
    nodes.forEach(nodeId => {
      const node = lookup.nodesById[nodeId];
      console.log(`Node: ${nodeId} coords: [${node?.coordinates}]`);
      
      const outEdges = topo.adjacency.outEdges[nodeId] ?? [];
      const inEdges = topo.adjacency.inEdges[nodeId] ?? [];

      console.log(`  Out edges (${outEdges.length}):`);
      outEdges.forEach(eid => {
        const e = lookup.edgesById[eid];
        console.log(`    - ${eid} (ref: ${e?.sourceSlice?.sourceFeatureRef}) directionRole=${e?.directionRole} traversal=${e?.traversal}`);
      });

      console.log(`  In edges (${inEdges.length}):`);
      inEdges.forEach(eid => {
        const e = lookup.edgesById[eid];
        console.log(`    - ${eid} (ref: ${e?.sourceSlice?.sourceFeatureRef}) directionRole=${e?.directionRole} traversal=${e?.traversal}`);
      });
    });
  });
});
