import { loadGeoJson, exportTopology } from "./app";
import { SENSEKI_RAIL } from "./senseki-data";

loadGeoJson(SENSEKI_RAIL);
const topo = exportTopology();

const edge3513 = topo.edges.find(e => e.sourceSlice?.sourceFeatureRef === "osm:way:1320551298");
console.log("Edge 1320551298:", edge3513?.id, edge3513?.fromNodeRef, edge3513?.toNodeRef);

if (edge3513) {
  const neighbors = topo.edges.filter(e => e.fromNodeRef === edge3513.toNodeRef || e.toNodeRef === edge3513.toNodeRef || e.fromNodeRef === edge3513.fromNodeRef || e.toNodeRef === edge3513.fromNodeRef);
  console.log("Neighbors:");
  for (const n of neighbors) {
    console.log(`  ${n.id} (ref: ${n.sourceSlice?.sourceFeatureRef}) from=${n.fromNodeRef} to=${n.toNodeRef}`);
  }
}

// Dump out cross-over candidates. 
// A crossover connects down line to up line. Let's find any edge that connects from down node to up node.
