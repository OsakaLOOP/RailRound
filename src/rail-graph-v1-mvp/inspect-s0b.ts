import * as fs from "node:fs";
import { resolve } from "node:path";

const file = "d:\\Downloads\\senseki-demo-2026-05-19T11-36-40.railround.json";
const raw = fs.readFileSync(file, "utf-8");
const snapshot = JSON.parse(raw);

const s0b = snapshot.pathfindingResults.find(s => s.name.includes("S0b"));
const best = s0b.candidates[0];

console.log("Candidate 0 edges:");
for (let i = 0; i < 12; i++) {
  const e = best.edges[i];
  console.log(`  ${i}: id=${e.edgeId} ref=${e.sourceFeatureRef} dir=${e.directionRole}`);
}
console.log("Turnback events:", best.turnbackEvents);
