import fs from "node:fs";
import path from "node:path";

const DEFAULT_INPUT = path.resolve("public", "rail-graph", "deployed-system.json");
const DEFAULT_META = path.resolve("public", "rail-graph", "deployed-system.meta.json");
const DEFAULT_GEOJSON_DIR = path.resolve("public", "geojson");

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input ?? DEFAULT_INPUT);
const metaPath = path.resolve(args.meta ?? DEFAULT_META);
const geojsonDir = path.resolve(args.geojsonDir ?? DEFAULT_GEOJSON_DIR);

const errors = [];
const bundle = readJson(inputPath);
const meta = fs.existsSync(metaPath) ? readJson(metaPath) : null;

validateBundle(bundle, errors);
validateMeta(meta, errors);
validateNoDirection(bundle, meta, errors);
validateAppConsumable(bundle, geojsonDir, errors);

if (errors.length > 0) {
  console.error("Rail graph deployment assertion failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Rail graph deployment assertion passed.");
console.log(`input: ${inputPath}`);
console.log(`graphId: ${bundle.system.graphId}`);
console.log(`systemId: ${bundle.deployed.systemId}`);
console.log(`contentHash: ${bundle.deployed.contentHash}`);
console.log(`presets: ${bundle.deployed.generatedPresets.length}`);
if (meta) console.log(`coverage: ${meta.coverage?.status ?? "unknown"}`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--input") out.input = argv[++i];
    else if (current.startsWith("--input=")) out.input = current.slice("--input=".length);
    else if (current === "--meta") out.meta = argv[++i];
    else if (current.startsWith("--meta=")) out.meta = current.slice("--meta=".length);
    else if (current === "--geojson-dir") out.geojsonDir = argv[++i];
    else if (current.startsWith("--geojson-dir=")) out.geojsonDir = current.slice("--geojson-dir=".length);
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

function validateBundle(bundle, errors) {
  if (!bundle || typeof bundle !== "object") {
    errors.push("bundle must be an object.");
    return;
  }
  const { system, deployed } = bundle;
  if (!system || typeof system !== "object") errors.push("system is required.");
  if (!deployed || typeof deployed !== "object") errors.push("deployed is required.");
  if (!system || !deployed) return;
  if (typeof system.graphId !== "string" || !system.graphId) errors.push("system.graphId is required.");
  if (system.graph?.schemaVersion !== "rail-graph-v1") errors.push("system.graph.schemaVersion must be rail-graph-v1.");
  if (!system.graph?.topo?.base) errors.push("system.graph.topo.base is required.");
  if (!Array.isArray(system.graph?.topo?.serviceTemplates?.servicePatterns)) {
    errors.push("system.graph.topo.serviceTemplates.servicePatterns must be an array.");
  }
  if (typeof deployed.systemId !== "string" || !deployed.systemId) errors.push("deployed.systemId is required.");
  if (deployed.sourceGraphId !== system.graphId) errors.push("deployed.sourceGraphId must match system.graphId.");
  if (typeof deployed.contentHash !== "string" || !deployed.contentHash) errors.push("deployed.contentHash is required.");
  if (!Array.isArray(deployed.templates) || deployed.templates.length === 0) errors.push("deployed.templates must be non-empty.");
  if (!Array.isArray(deployed.stations) || deployed.stations.length < 2) errors.push("deployed.stations must contain at least two stations.");
  if (!Array.isArray(deployed.generatedPresets) || deployed.generatedPresets.length === 0) {
    errors.push("deployed.generatedPresets must be non-empty.");
  }
  if (!deployed.presetHashes || typeof deployed.presetHashes !== "object") errors.push("deployed.presetHashes is required.");
}

function validateMeta(meta, errors) {
  if (!meta || typeof meta !== "object") {
    errors.push("deployment meta JSON is required.");
    return;
  }
  if (meta.sourceMode !== "compiled-topology") {
    errors.push(`meta.sourceMode must be compiled-topology, got ${String(meta.sourceMode)}.`);
  }
  if (!meta.coverage || typeof meta.coverage !== "object") errors.push("meta.coverage is required.");
}

function validateNoDirection(bundle, meta, errors) {
  const diagnostics = [
    ...(Array.isArray(bundle?.system?.diagnostics) ? bundle.system.diagnostics : []),
    ...(Array.isArray(bundle?.system?.graph?.diagnostics) ? bundle.system.graph.diagnostics : []),
  ];
  const noDirectionDiagnostic = diagnostics.find((diag) =>
    String(diag?.code ?? "").includes("NO_DIRECTION")
    || String(diag?.message ?? "").toLowerCase().includes("no-direction")
  );
  if (noDirectionDiagnostic) {
    errors.push(`default bundle contains no-direction diagnostic: ${noDirectionDiagnostic.code ?? noDirectionDiagnostic.message}`);
  }
  const provenance = Array.isArray(bundle?.system?.graph?.provenance) ? bundle.system.graph.provenance : [];
  if (provenance.some((item) => String(item?.sourceRef ?? "").includes("no-direction"))) {
    errors.push("default bundle provenance references no-direction data.");
  }
  if (meta && String(meta.sourceMode ?? "").includes("no-direction")) {
    errors.push("default bundle meta marks sourceMode as no-direction.");
  }
}

function validateAppConsumable(bundle, geojsonDir, errors) {
  const legacyLines = buildLegacyLineIndex(geojsonDir);
  const templates = Array.isArray(bundle?.deployed?.templates) ? bundle.deployed.templates : [];
  const consumable = templates.find((template) => {
    const stations = legacyLines.get(String(template.lineRef));
    if (!stations) return false;
    const passages = template.resolvedPath?.stationPassages;
    if (!Array.isArray(passages) || passages.length < 2) return false;
    return passages.some((passage) => stations.has(String(passage.stationRef)))
      && passages.filter((passage) => stations.has(String(passage.stationRef))).length >= 2;
  });
  if (!consumable) {
    errors.push("no deployed template is consumable by current legacy GeoJSON railwayData.");
  }
}

function buildLegacyLineIndex(geojsonDir) {
  const out = new Map();
  const files = fs.readdirSync(geojsonDir).filter((name) => name.endsWith(".geojson"));
  for (const fileName of files) {
    const filePath = path.join(geojsonDir, fileName);
    const json = readJson(filePath);
    const defaultCompany = path.basename(fileName, ".geojson");
    for (const feature of json.features ?? []) {
      const props = feature.properties ?? {};
      if (props.type !== "station" || typeof props.line !== "string" || typeof props.name !== "string") continue;
      const company = typeof props.company === "string"
        ? props.company
        : typeof props.operator === "string"
          ? props.operator
          : defaultCompany;
      const lineKey = `${company}:${props.line}`;
      const stationId = typeof props.id === "string" && props.id
        ? props.id
        : `${company}:${props.line}:${props.name}`;
      const stations = out.get(lineKey) ?? new Set();
      stations.add(stationId);
      out.set(lineKey, stations);
    }
  }
  return out;
}
