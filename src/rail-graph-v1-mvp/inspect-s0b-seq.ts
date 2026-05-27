// @ts-nocheck
import * as fs from "node:fs";

const file = "d:\\Downloads\\senseki-demo-2026-05-19T11-36-40.railround.json";
const raw = fs.readFileSync(file, "utf-8");
const snapshot = JSON.parse(raw);

const s0b = snapshot.pathfindingResults.find(s => s.name.includes("S0b"));
const best = s0b.candidates[0];

console.log("Candidate 0 turnbackEdgeIndices:", best.turnbackEdgeIndices);
console.log("Candidate 0 edges length:", best.edges?.length || best.edgeSequence?.length);
console.log("Candidate 0 edge sequence:");
if (best.edgeSequence) {
  for (let i = 8; i <= 10; i++) console.log(i, best.edgeSequence[i]);
} else if (best.edges) {
  for (let i = 8; i <= 10; i++) console.log(i, best.edges[i].edgeId);
}
