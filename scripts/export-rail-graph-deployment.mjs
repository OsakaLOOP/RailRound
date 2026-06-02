import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_OUTPUT = path.resolve("public", "rail-graph", "deployed-system.json");

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error("Usage: npm run rail:deployment:export -- --input <bundle.json> [--output public/rail-graph/deployed-system.json]");
  process.exit(1);
}

const inputPath = path.resolve(args.input);
const outputPath = path.resolve(args.output ?? DEFAULT_OUTPUT);

const raw = readJson(inputPath);
const bundle = normalizeBundle(raw);
const errors = validateBundle(bundle);
if (errors.length > 0) {
  console.error("Rail graph deployment bundle is invalid:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const payload = `${JSON.stringify(bundle, null, 2)}\n`;
fs.writeFileSync(outputPath, payload, "utf8");

const hash = createHash("sha256").update(payload).digest("hex");
console.log("Rail graph deployment bundle exported.");
console.log(`input: ${inputPath}`);
console.log(`output: ${outputPath}`);
console.log(`systemId: ${bundle.deployed.systemId}`);
console.log(`graphId: ${bundle.system.graphId}`);
console.log(`contentHash: ${bundle.deployed.contentHash}`);
console.log(`sha256: ${hash}`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--input") out.input = argv[++i];
    else if (current === "--output") out.output = argv[++i];
    else if (current.startsWith("--input=")) out.input = current.slice("--input=".length);
    else if (current.startsWith("--output=")) out.output = current.slice("--output=".length);
  }
  return out;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    console.error(`Failed to read JSON: ${filePath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function normalizeBundle(value) {
  if (value?.system && value?.deployed) {
    return {
      system: value.system,
      deployed: value.deployed,
    };
  }
  if (value?.graphId && value?.graph && value?.deployment?.deployed) {
    return {
      system: value,
      deployed: value.deployment.deployed,
    };
  }
  return value;
}

function validateBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== "object") {
    return ["bundle must be an object with system and deployed fields."];
  }
  if (!bundle.system || typeof bundle.system !== "object") errors.push("system is required.");
  if (!bundle.deployed || typeof bundle.deployed !== "object") errors.push("deployed is required.");
  if (errors.length > 0) return errors;

  const { system, deployed } = bundle;
  if (typeof system.graphId !== "string" || !system.graphId) errors.push("system.graphId is required.");
  if (!system.graph || system.graph.schemaVersion !== "rail-graph-v1") errors.push("system.graph.schemaVersion must be rail-graph-v1.");
  if (!system.graph?.topo?.base) errors.push("system.graph.topo.base is required.");
  if (!Array.isArray(system.graph?.topo?.serviceTemplates?.servicePatterns)) {
    errors.push("system.graph.topo.serviceTemplates.servicePatterns must be an array.");
  }

  if (typeof deployed.systemId !== "string" || !deployed.systemId) errors.push("deployed.systemId is required.");
  if (typeof deployed.sourceGraphId !== "string" || !deployed.sourceGraphId) errors.push("deployed.sourceGraphId is required.");
  if (typeof deployed.contentHash !== "string" || !deployed.contentHash) errors.push("deployed.contentHash is required.");
  if (!Array.isArray(deployed.templates)) errors.push("deployed.templates must be an array.");
  if (!Array.isArray(deployed.stations)) errors.push("deployed.stations must be an array.");
  if (!Array.isArray(deployed.generatedPresets)) errors.push("deployed.generatedPresets must be an array.");
  if (!deployed.presetHashes || typeof deployed.presetHashes !== "object") errors.push("deployed.presetHashes is required.");
  if (system.graphId && deployed.sourceGraphId && system.graphId !== deployed.sourceGraphId) {
    errors.push("system.graphId must match deployed.sourceGraphId.");
  }
  return errors;
}
