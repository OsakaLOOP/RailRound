import fs from "node:fs";
import path from "node:path";
import { parseRailGraphDeploymentBundle } from "../src/services/railGraphDeploymentLoader";

const DEFAULT_DEPLOYMENT = path.resolve("public", "rail-graph", "deployed-system.json");
const DEFAULT_AGGREGATE_VERIFY_BUNDLE = path.resolve("src", "rail-graph-aggregate", ".verify", "deployed-system.verify.json");
const VERIFY_DIR = path.resolve("src", "rail-graph-aggregate", ".verify");
const SUMMARY_PATH = path.join(VERIFY_DIR, "export-load-smoke-summary.md");

const args = parseArgs(process.argv.slice(2));
const results: { label: string; status: "PASS" | "FAIL"; detail: string }[] = [];

try {
  smokeDeploymentBundle(path.resolve(args.deployment ?? DEFAULT_DEPLOYMENT), "default deployment bundle");
} catch (error) {
  results.push({ label: "default deployment bundle", status: "FAIL", detail: errorMessage(error) });
}

try {
  smokeDeploymentBundle(path.resolve(args.aggregateBundle ?? DEFAULT_AGGREGATE_VERIFY_BUNDLE), "aggregate deployment export bundle");
} catch (error) {
  results.push({ label: "aggregate deployment export bundle", status: "FAIL", detail: errorMessage(error) });
}

writeSummary();
const failed = results.filter((result) => result.status === "FAIL");
if (failed.length > 0) {
  console.error("Rail graph export/load smoke failed:");
  for (const result of failed) console.error(`- ${result.label}: ${result.detail}`);
  process.exit(1);
}

console.log("Rail graph export/load smoke passed.");
console.log(`summary: ${SUMMARY_PATH}`);

function parseArgs(argv: string[]): { deployment?: string; aggregateBundle?: string } {
  const out: { deployment?: string; aggregateBundle?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--deployment") out.deployment = argv[++i];
    else if (current.startsWith("--deployment=")) out.deployment = current.slice("--deployment=".length);
    else if (current === "--aggregate-bundle") out.aggregateBundle = argv[++i];
    else if (current.startsWith("--aggregate-bundle=")) out.aggregateBundle = current.slice("--aggregate-bundle=".length);
  }
  return out;
}

function smokeDeploymentBundle(filePath: string, label: string): void {
  const bundle = readJson(filePath);
  const parsed = parseRailGraphDeploymentBundle(bundle);
  if (!parsed) throw new Error(`bundle cannot be parsed by deployment loader: ${filePath}`);
  if (parsed.deployed.generatedPresets.length === 0) throw new Error("bundle has no generated presets.");
  results.push({
    label,
    status: "PASS",
    detail: `systemId=${parsed.deployed.systemId}; graphId=${parsed.system.graphId}; presets=${parsed.deployed.generatedPresets.length}`,
  });
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeSummary(): void {
  fs.mkdirSync(VERIFY_DIR, { recursive: true });
  const lines = [
    "# Rail Graph Export Load Smoke Summary",
    "",
    `- updatedAt: \`${new Date().toISOString()}\``,
    `- status: **${results.every((result) => result.status === "PASS") ? "PASS" : "FAIL"}**`,
    "",
    "## Results",
    ...results.map((result) => `- ${result.status} ${result.label}: ${result.detail}`),
    "",
  ];
  fs.writeFileSync(SUMMARY_PATH, `${lines.join("\n")}\n`, "utf8");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
