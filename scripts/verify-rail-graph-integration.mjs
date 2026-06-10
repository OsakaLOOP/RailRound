import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const startedAt = new Date();
const verifyDir = path.resolve("src", "rail-graph-aggregate", ".verify");
const summaryPath = path.join(verifyDir, "integration-summary.md");

const vitestTestFiles = [
  "src/__tests__/rail-graph-system-context.test.ts",
  "src/__tests__/rail-graph-service-template.test.ts",
  "src/__tests__/rail-graph-render-geometry.test.ts",
  "src/__tests__/rail-graph-runtime-events.test.ts",
  "src/__tests__/rail-graph-deployment.test.ts",
  "src/__tests__/rail-graph-deployment-export-script.test.ts",
  "src/__tests__/rail-graph-trip-planner.test.ts",
  "src/__tests__/rail-graph-app-route-planner.test.ts",
  "src/__tests__/rail-graph-saved-trip-roundtrip.test.ts",
  "src/__tests__/rail-graph-export-load-smoke.test.ts",
  "src/__tests__/mileage-events-runtime-adapter.test.ts",
  "src/__tests__/trip-product-projection.test.ts",
  "src/__tests__/core/railwayRouting.test.ts",
];

const commands = [
  ["npm", ["run", "rail:mvp:clean-verify:senseki"], "MVP Senseki clean verify"],
  ["npm", ["run", "rail:aggregate:verify:patterns"], "Aggregate ServicePattern verify"],
  ["npm", ["run", "rail:aggregate:verify:compiled-topology"], "Aggregate compiled topology verify"],
  ["npm", ["run", "rail:aggregate:verify:cross-pf"], "Aggregate cross-pattern pathfinding verify"],
  ["npm", ["run", "rail:aggregate:verify:events"], "Aggregate event verify"],
  ["npm", ["run", "rail:events:mileage-verify"], "Mileage UserEvent verify"],
  ["npm", [
    "run",
    "rail:deployment:build",
    "--",
    "--aggregate-key",
    "senseki-tohoku",
    "--output",
    "src/rail-graph-aggregate/.verify/deployed-system.verify.json",
    "--allow-no-direction-verify",
  ], "Aggregate deployment bundle build verify"],
  ["npm", ["run", "rail:deployment:assert"], "Default deployment bundle assert"],
  ["npm", ["run", "rail:exports:load-smoke"], "MVP/aggregate export load smoke"],
  ["npx", ["vitest", "run", ...vitestTestFiles], "Runtime/app rail-graph vitest gate"],
  ["npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], "TypeScript no-emit"],
  ["npm", ["run", "build"], "Root src/blog production build"],
];

const results = [];

for (const [command, args, label] of commands) {
  const started = Date.now();
  console.log("");
  console.log(`====================================================`);
  console.log(`[rail:integration] ${label}`);
  console.log(`$ ${[command, ...args].join(" ")}`);
  console.log(`====================================================`);
  const code = await run(command, args);
  const elapsedMs = Date.now() - started;
  results.push({ label, command: [command, ...args].join(" "), code, elapsedMs });
  writeSummary(results, code === 0 ? null : label);
  if (code !== 0) {
    console.error(`[rail:integration] FAILED: ${label}`);
    process.exit(code);
  }
}

writeSummary(results, null);
console.log("");
console.log("====================================================");
console.log("RAIL GRAPH INTEGRATION VERIFY: PASS");
console.log("====================================================");
console.log(`Report: ${summaryPath}`);

function run(command, args) {
  return new Promise((resolve) => {
    const invocation = getInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function getInvocation(command, args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && command === "npm") {
    return { command: process.execPath, args: [npmCli, ...args] };
  }
  if (npmCli && command === "npx") {
    return { command: process.execPath, args: [npmCli, "exec", "--", ...args] };
  }
  return { command, args };
}

function writeSummary(currentResults, failedLabel) {
  fs.mkdirSync(verifyDir, { recursive: true });
  const endedAt = new Date();
  const lines = [];
  lines.push("# Rail Graph Integration Verify Summary");
  lines.push("");
  lines.push(`- startedAt: \`${startedAt.toISOString()}\``);
  lines.push(`- updatedAt: \`${endedAt.toISOString()}\``);
  lines.push(`- status: **${failedLabel ? "FAIL" : currentResults.length === commands.length ? "PASS" : "RUNNING"}**`);
  if (failedLabel) lines.push(`- failedAt: \`${failedLabel}\``);
  lines.push("");
  lines.push("## Commands");
  for (const result of currentResults) {
    lines.push(`- ${result.code === 0 ? "PASS" : "FAIL"} \`${result.command}\` (${Math.round(result.elapsedMs / 1000)}s)`);
  }
  for (const [command, args, label] of commands.slice(currentResults.length)) {
    lines.push(`- PENDING \`${[command, ...args].join(" ")}\` (${label})`);
  }
  lines.push("");
  lines.push("## Acceptance");
  lines.push("- no-direction fallback remains verify-only.");
  lines.push("- compiled topology enters SystemContext.");
  lines.push("- confirmed ServicePattern resolves geometry, timeline, and events.");
  lines.push("- deployed preset can be consumed by the trip planner.");
  lines.push("- aggregate workspace can build a deployment bundle; no-direction output remains explicit verify-only.");
  lines.push("- default deployment bundle is present, app-consumable, and not built from no-direction verify data.");
  lines.push("- MVP snapshot export/import and aggregate deployment export are loadable by real loaders.");
  lines.push("- default deployment bundle can drive app route planning against current GeoJSON railwayData with source=rail_graph.");
  lines.push("- railGraphLoadState records loaded/fallback status without disabling legacy fallback.");
  lines.push("- transfer scorer supports explicit penalty, forbidden relations, walk/wait costs, and product transfer event diagnostics.");
  lines.push("- saved app trips preserve rail-graph TripResult product snapshots through API/load round-trip without default runtime artifacts.");
  lines.push("- records/search/stats product projections can consume saved rail-graph TripResult snapshots even when legacy segments are stale.");
  lines.push("- mileage UserEvent projects to rail-graph TripResult and directly loaded legacy GeoJSON app-line data remains compatible.");
  fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}
