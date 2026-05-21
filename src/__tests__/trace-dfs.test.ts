/**
 * @vitest-environment jsdom
 */
import { describe, it } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from '../rail-graph-v1-mvp/app';
import { SENSEKI_RAIL } from '../rail-graph-v1-mvp/senseki-data';
import { SENSEKI_PF_OVERRIDES } from '../rail-graph-v1-mvp/poc-senseki-pathfinding';
import { buildTopologyLookup, isDirectionRoleCompatible } from '../rail-graph-v1/topology';

describe('Trace DFS', () => {
  it('should trace dfs', () => {

loadGeoJson(SENSEKI_RAIL);
Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
  const index = SENSEKI_RAIL.features.findIndex(f => f.properties?.railGraph?.id === id || f.properties?.osm_id === id.replace("osm:way:", ""));
  if (index !== -1) annotateFeature(index, annotation as any);
});

const topo = exportTopology();
const lookup = buildTopologyLookup(topo);

const edge1320 = topo.edges.find(e => e.sourceSlice?.sourceFeatureRef === "osm:way:1320551298")!;
const dead1320 = topo.adjacency.outEdges[edge1320.fromNodeRef]?.length === 1 && topo.adjacency.inEdges[edge1320.fromNodeRef]?.length === 1 ? edge1320.fromNodeRef : edge1320.toNodeRef;

console.log("Start Node:", dead1320);

// We want to go "down" from dead1320.
// Look at edges connected to dead1320.
const outEdgeIds = topo.adjacency.outEdges[dead1320] ?? [];
for (const eid of outEdgeIds) {
  const e = lookup.edgesById[eid];
  console.log(`Edge ${eid} (ref: ${e.sourceSlice?.sourceFeatureRef}) directionRole: ${e.directionRole}`);
  console.log(`  compatible with 'down'? ${isDirectionRoleCompatible("down", e.directionRole)}`);
  
  // where does it lead?
  const nextNode = e.fromNodeRef === dead1320 ? e.toNodeRef : e.fromNodeRef;
  console.log(`  leads to node: ${nextNode}`);
  
  // what's connected to nextNode?
  const nextOutEdgeIds = topo.adjacency.outEdges[nextNode] ?? [];
  for (const nEid of nextOutEdgeIds) {
    if (nEid === eid) continue; // skip the edge we just came from
    const ne = lookup.edgesById[nEid];
    console.log(`    -> Next Edge ${nEid} (ref: ${ne.sourceSlice?.sourceFeatureRef}) directionRole: ${ne.directionRole}`);
    console.log(`       compatible with 'down'? ${isDirectionRoleCompatible("down", ne.directionRole)}`);
  }
}
  });
});
