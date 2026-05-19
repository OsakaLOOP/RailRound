import * as fs from "node:fs";

const file = "d:\\Downloads\\senseki-demo-2026-05-19T11-36-40.railround.json";
const raw = fs.readFileSync(file, "utf-8");
const snapshot = JSON.parse(raw);

const s0b = snapshot.pathfindingResults.find(s => s.name.includes("S0b"));

console.log("Candidate 1 edges length:", s0b.candidates[1].edges.length);
console.log("Candidate 1 turnback event:", s0b.candidates[1].turnbackEvents);
for (let i = 8; i <= 14; i++) {
  const e = s0b.candidates[1].edges[i];
  console.log(`  ${i}: ref=${e.sourceFeatureRef}`);
}
