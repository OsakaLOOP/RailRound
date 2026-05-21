import { SENSEKI_RAIL } from "./senseki-data";
import { buildTopologyLayer } from "../rail-graph-v1/topology";

// Build topology
const topo = buildTopologyLayer({
  features: SENSEKI_RAIL.features
} as any, {
  toleranceMeters: 1.0,
  splitWaysAtNodes: true,
  // we pass an empty overrides map or a partial one
  annotations: {}
});

console.log(`Topology built with ${topo.edges.length} edges and ${topo.nodes.length} nodes.`);

const edges1320 = topo.edges.filter(e => e.sourceSlice?.sourceFeatureRef?.includes("1320551298"));
const edges7757 = topo.edges.filter(e => e.sourceSlice?.sourceFeatureRef?.includes("775723282"));
const edges7757_30626 = topo.edges.filter(e => e.sourceSlice?.sourceFeatureRef?.includes("775730626"));

console.log("\nEdges for 1320551298:");
for (const e of edges1320) {
  console.log(`  edge ${e.id} length=${e.lengthMeters.toFixed(1)} ref=${e.sourceSlice?.sourceFeatureRef}`);
}

console.log("\nEdges for 775723282 (including (1)):");
for (const e of edges7757) {
  console.log(`  edge ${e.id} length=${e.lengthMeters.toFixed(1)} ref=${e.sourceSlice?.sourceFeatureRef}`);
}

console.log("\nEdges for 775730626:");
for (const e of edges7757_30626) {
  console.log(`  edge ${e.id} length=${e.lengthMeters.toFixed(1)} ref=${e.sourceSlice?.sourceFeatureRef}`);
}

// dump outEdges of the crossover to see connectivity
// 1320551298 connects to what?
