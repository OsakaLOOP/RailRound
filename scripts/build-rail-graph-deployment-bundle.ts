import fs from "node:fs";
import path from "node:path";
import type { AggregateState } from "../src/rail-graph-aggregate/aggregate-state";
import { sanitizeAggregateKey } from "../src/rail-graph-aggregate/storage";
import type { StoredServicePattern } from "../src/rail-graph-aggregate/service-pattern/store";
import type { Diagnostic } from "../src/rail-graph-v1/diagnostic-types";
import type { EntityRef } from "../src/rail-graph-v1/primitives";
import type { StationMeta } from "../src/rail-graph-v1/user-facing.types";
import {
  buildDeployedSystem,
  buildSystemContext,
  validateServicePatternAgainstTopology,
} from "../src/rail-graph-v1/types";

const DEFAULT_OUTPUT = path.resolve("public", "rail-graph", "deployed-system.json");

interface CliArgs {
  aggregateKey?: string;
  aggregateState?: string;
  servicePatterns?: string;
  output?: string;
  systemId?: string;
  version?: string;
  allowNoDirectionVerify: boolean;
}

const args = parseArgs(process.argv.slice(2));
if (!args.aggregateKey && !args.aggregateState) {
  console.error(
    "Usage: npm run rail:deployment:build -- --aggregate-key <key> " +
    "[--output public/rail-graph/deployed-system.json] [--system-id <id>] [--version <version>]",
  );
  console.error(
    "       or: tsx scripts/build-rail-graph-deployment-bundle.ts " +
    "--aggregate-state <aggregate-state.json> --service-patterns <service-patterns.json> [--output <bundle.json>]",
  );
  process.exit(1);
}

const aggregate = readAggregateState(args);
if (aggregate.mode === "no-direction-graph" && !args.allowNoDirectionVerify) {
  console.error(
    `Aggregate '${aggregate.aggregateKey}' is a no-direction verification graph. ` +
    "Build deployment bundles from compiled-topology data, or pass --allow-no-direction-verify only for tests.",
  );
  process.exit(1);
}

const patterns = readServicePatterns(args, aggregate.aggregateKey);
const validationDiagnostics = validatePatterns(aggregate, patterns);
const blockingValidation = blockingDiagnostics(validationDiagnostics);
if (blockingValidation.length > 0) {
  printDiagnostics("ServicePattern validation failed:", blockingValidation);
  process.exit(1);
}

const systemId = (args.systemId ?? `aggregate:system:${aggregate.aggregateKey}`) as EntityRef;
const version = args.version ?? aggregate.metadata.updatedAt ?? new Date().toISOString();
const stationDisplay = buildStationDisplay(aggregate);
const system = buildSystemContext({
  baseTopology: aggregate.topo,
  servicePatterns: patterns,
  displayStore: Object.keys(stationDisplay).length > 0 ? { stationDisplay } : undefined,
  provenance: [{
    entityRef: systemId,
    sourceRef: `aggregate:${aggregate.aggregateKey}`,
    sourceType: "aggregate-workspace",
    importedAt: aggregate.metadata.updatedAt ?? new Date().toISOString(),
    confidence: aggregate.mode === "compiled-topology" ? "manual" : "synthetic",
  }],
  diagnostics: [...aggregate.diagnostics, ...validationDiagnostics],
  sourceMode: aggregate.mode,
  allowNoDirection: args.allowNoDirectionVerify,
  noDirectionReason: args.allowNoDirectionVerify ? "verify" : undefined,
});
const deployment = buildDeployedSystem({
  system,
  systemId,
  version,
  createdAt: new Date().toISOString(),
});
const blockingDeployment = blockingDiagnostics(deployment.diagnostics);
if (blockingDeployment.length > 0) {
  printDiagnostics("Deployment build failed:", blockingDeployment);
  process.exit(1);
}

const outputPath = path.resolve(args.output ?? DEFAULT_OUTPUT);
const bundle = {
  system,
  deployed: deployment.deployed,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

console.log("Rail graph deployment bundle built from aggregate workspace.");
console.log(`aggregateKey: ${aggregate.aggregateKey}`);
console.log(`mode: ${aggregate.mode}`);
console.log(`patterns: ${patterns.length}`);
console.log(`systemId: ${deployment.deployed.systemId}`);
console.log(`graphId: ${system.graphId}`);
console.log(`contentHash: ${deployment.deployed.contentHash}`);
console.log(`output: ${outputPath}`);

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { allowNoDirectionVerify: false };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--aggregate-key") out.aggregateKey = argv[++i];
    else if (current.startsWith("--aggregate-key=")) out.aggregateKey = current.slice("--aggregate-key=".length);
    else if (current === "--aggregate-state") out.aggregateState = argv[++i];
    else if (current.startsWith("--aggregate-state=")) out.aggregateState = current.slice("--aggregate-state=".length);
    else if (current === "--service-patterns") out.servicePatterns = argv[++i];
    else if (current.startsWith("--service-patterns=")) out.servicePatterns = current.slice("--service-patterns=".length);
    else if (current === "--output") out.output = argv[++i];
    else if (current.startsWith("--output=")) out.output = current.slice("--output=".length);
    else if (current === "--system-id") out.systemId = argv[++i];
    else if (current.startsWith("--system-id=")) out.systemId = current.slice("--system-id=".length);
    else if (current === "--version") out.version = argv[++i];
    else if (current.startsWith("--version=")) out.version = current.slice("--version=".length);
    else if (current === "--allow-no-direction-verify") out.allowNoDirectionVerify = true;
  }
  return out;
}

function readAggregateState(args: CliArgs): AggregateState {
  const filePath = args.aggregateState
    ? path.resolve(args.aggregateState)
    : path.resolve("aggregates", sanitizeAggregateKey(args.aggregateKey ?? ""), "aggregate-state.json");
  return readJson<AggregateState>(filePath);
}

function readServicePatterns(args: CliArgs, aggregateKey: string): StoredServicePattern[] {
  const filePath = args.servicePatterns
    ? path.resolve(args.servicePatterns)
    : path.resolve("aggregates", sanitizeAggregateKey(aggregateKey), "service-patterns.json");
  const raw = readJson<unknown>(filePath);
  const patterns = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { servicePatterns?: unknown[] }).servicePatterns)
      ? (raw as { servicePatterns: unknown[] }).servicePatterns
      : [];
  if (patterns.length === 0) {
    console.error(`No service patterns found: ${filePath}`);
    process.exit(1);
  }
  return patterns as StoredServicePattern[];
}

function readJson<T>(filePath: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch (error) {
    console.error(`Failed to read JSON: ${filePath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function validatePatterns(
  aggregate: AggregateState,
  patterns: StoredServicePattern[],
): Diagnostic[] {
  return patterns.flatMap((pattern) =>
    validateServicePatternAgainstTopology(aggregate.topo, pattern).diagnostics
  );
}

function blockingDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diag) => diag.level === "error" || diag.level === "fatal");
}

function printDiagnostics(header: string, diagnostics: readonly Diagnostic[]): void {
  console.error(header);
  for (const diag of diagnostics) {
    console.error(`- [${diag.level}] ${diag.code}: ${diag.message}`);
    if (diag.context) console.error(`  ${JSON.stringify(diag.context)}`);
  }
}

function buildStationDisplay(aggregate: AggregateState): Record<string, StationMeta> {
  const out: Record<string, StationMeta> = {};
  for (const feature of aggregate.featureCollection.features) {
    const annotation = feature.properties?.railGraph;
    if (annotation?.kind !== "station_point" || feature.geometry.type !== "Point") continue;
    const stationRef = annotation.id;
    const station = aggregate.topo.stations.find((item) => item.id === stationRef);
    if (!station) continue;
    out[station.id] = {
      stationRef: station.id,
      name: station.name,
      nameJa: station.nameJa,
      coordinates: feature.geometry.coordinates as [number, number],
    };
  }
  return out;
}
