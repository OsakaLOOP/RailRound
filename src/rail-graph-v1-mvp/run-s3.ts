import { loadGeoJson, exportTopology, annotateFeature } from "./app";
import { SENSEKI_RAIL } from "./senseki-data";
import { runSensekiScenarios, SENSEKI_PF_OVERRIDES } from "./poc-senseki-pathfinding";

// load data
loadGeoJson(SENSEKI_RAIL);

// annotate overrides
Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
  const index = SENSEKI_RAIL.features.findIndex(f => f.properties?.railGraph?.id === id || f.properties?.osm_id === id.replace("osm:way:", ""));
  if (index !== -1) {
    annotateFeature(index, annotation as any);
  } else {
    console.warn(`Feature ${id} not found in SENSEKI_RAIL to annotate.`);
  }
});

const topo = exportTopology();
console.log(`Topology built with ${topo.edges.length} edges and ${topo.nodes.length} nodes.`);

const results = runSensekiScenarios(topo);
const s3 = results.find(r => r.scenario.name.startsWith("S3"));

if (!s3) {
  console.error("S3 not found!");
} else {
  console.log(`S3 passed? ${s3.passed}, candidates: ${s3.candidates.length}`);
  if (!s3.passed) {
    console.log("Reason:", s3.reason);
  } else {
    console.log("Best distance:", s3.best?.totalDistanceMeters);
  }
}
