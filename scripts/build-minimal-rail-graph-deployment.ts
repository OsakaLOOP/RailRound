import fs from "node:fs";
import path from "node:path";
import type {
  BaseTopologyLayer,
  TopologyEdge,
  TopologyNode,
} from "../src/rail-graph-v1/base-topology.types";
import type { EntityRef } from "../src/rail-graph-v1/primitives";
import type { ServicePattern, ServiceTraceEntry } from "../src/rail-graph-v1/service-template.types";
import type { StationMeta } from "../src/rail-graph-v1/user-facing.types";
import { buildAdjacency } from "../src/rail-graph-v1/topology";
import { buildDeployedSystem, buildSystemContext } from "../src/rail-graph-v1/types";

const DEFAULT_SOURCE = path.resolve("public", "geojson", "WILLER TRAINS.geojson");
const DEFAULT_OUTPUT = path.resolve("public", "rail-graph", "deployed-system.json");
const DEFAULT_META_OUTPUT = path.resolve("public", "rail-graph", "deployed-system.meta.json");

interface CliArgs {
  source: string;
  output: string;
  metaOutput: string;
  lineKey?: string;
  stationCount: number;
}

interface GeoJsonFeature {
  type: "Feature";
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
}

interface LegacyStation {
  id: string;
  name: string;
  coordinates: [number, number];
}

interface LegacyLine {
  lineKey: string;
  company: string;
  lineName: string;
  stations: LegacyStation[];
  displayColor?: string;
}

const args = parseArgs(process.argv.slice(2));
const sourcePath = path.resolve(args.source);
const source = readJson<{ features?: GeoJsonFeature[] }>(sourcePath);
const legacyLine = selectLegacyLine(source.features ?? [], path.basename(sourcePath, path.extname(sourcePath)), args);
const topology = buildTopology(legacyLine);
const pattern = buildServicePattern(legacyLine, topology);
const stationDisplay = buildStationDisplay(legacyLine);
const createdAt = new Date().toISOString();
const systemId = "railround:minimal:system:willer" as EntityRef;

const system = buildSystemContext({
  baseTopology: topology,
  servicePatterns: [pattern],
  displayStore: {
    patternDisplay: {
      [pattern.patternId]: {
        displayName: pattern.displayName,
        displayColor: pattern.displayColor,
      },
    },
    stationDisplay,
  },
  provenance: [{
    entityRef: systemId,
    sourceRef: path.relative(process.cwd(), sourcePath).replace(/\\/g, "/"),
    sourceType: "legacy_geojson",
    importedAt: createdAt,
    confidence: "derived",
  }],
  sourceMode: "compiled-topology",
  createdAt,
});

const deployment = buildDeployedSystem({
  system,
  systemId,
  version: `minimal-${createdAt.slice(0, 10)}`,
  createdAt,
});

const blocking = deployment.diagnostics.filter((diag) => diag.level === "error" || diag.level === "fatal");
if (blocking.length > 0) {
  console.error("Minimal rail graph deployment build failed:");
  for (const diag of blocking) console.error(`- [${diag.level}] ${diag.code}: ${diag.message}`);
  process.exit(1);
}

const outputPath = path.resolve(args.output);
const metaOutputPath = path.resolve(args.metaOutput);
const bundle = {
  system,
  deployed: deployment.deployed,
};
const meta = {
  schemaVersion: "rail-graph-default-deployment-meta-v1",
  sourceMode: "compiled-topology",
  source: path.relative(process.cwd(), sourcePath).replace(/\\/g, "/"),
  generatedAt: createdAt,
  contentHash: deployment.deployed.contentHash,
  graphId: system.graphId,
  systemId: deployment.deployed.systemId,
  coverage: {
    status: "minimal",
    note: "Minimal direction-aware deployment bundle for app integration smoke. It is intentionally not full network coverage.",
    lineKey: legacyLine.lineKey,
    stationCount: legacyLine.stations.length,
    presetCount: deployment.deployed.generatedPresets.length,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
fs.writeFileSync(metaOutputPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

console.log("Minimal rail graph deployment bundle built.");
console.log(`source: ${sourcePath}`);
console.log(`lineKey: ${legacyLine.lineKey}`);
console.log(`stations: ${legacyLine.stations.length}`);
console.log(`presets: ${deployment.deployed.generatedPresets.length}`);
console.log(`graphId: ${system.graphId}`);
console.log(`contentHash: ${deployment.deployed.contentHash}`);
console.log(`output: ${outputPath}`);
console.log(`meta: ${metaOutputPath}`);

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
    metaOutput: DEFAULT_META_OUTPUT,
    stationCount: 4,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--source") parsed.source = argv[++i];
    else if (current.startsWith("--source=")) parsed.source = current.slice("--source=".length);
    else if (current === "--output") parsed.output = argv[++i];
    else if (current.startsWith("--output=")) parsed.output = current.slice("--output=".length);
    else if (current === "--meta-output") parsed.metaOutput = argv[++i];
    else if (current.startsWith("--meta-output=")) parsed.metaOutput = current.slice("--meta-output=".length);
    else if (current === "--line-key") parsed.lineKey = argv[++i];
    else if (current.startsWith("--line-key=")) parsed.lineKey = current.slice("--line-key=".length);
    else if (current === "--station-count") parsed.stationCount = Number(argv[++i]);
    else if (current.startsWith("--station-count=")) parsed.stationCount = Number(current.slice("--station-count=".length));
  }
  if (!Number.isFinite(parsed.stationCount) || parsed.stationCount < 2) {
    throw new Error("--station-count must be a number >= 2.");
  }
  return parsed;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function selectLegacyLine(features: GeoJsonFeature[], defaultCompany: string, args: CliArgs): LegacyLine {
  const lines = new Map<string, LegacyLine>();
  for (const feature of features) {
    const props = feature.properties ?? {};
    if (props.type !== "station" || typeof props.line !== "string" || typeof props.name !== "string") continue;
    if (feature.geometry?.type !== "Point" || !isPosition(feature.geometry.coordinates)) continue;
    const company = typeof props.company === "string"
      ? props.company
      : typeof props.operator === "string"
        ? props.operator
        : defaultCompany;
    const lineKey = `${company}:${props.line}`;
    const line = lines.get(lineKey) ?? {
      lineKey,
      company,
      lineName: props.line,
      stations: [],
      displayColor: findLineColor(features, company, props.line),
    };
    const stationId = typeof props.id === "string" && props.id
      ? props.id
      : `${company}:${props.line}:${props.name}`;
    if (!line.stations.some((station) => station.id === stationId)) {
      line.stations.push({
        id: stationId,
        name: props.name,
        coordinates: feature.geometry.coordinates,
      });
    }
    lines.set(lineKey, line);
  }

  const candidates = [...lines.values()].filter((line) => line.stations.length >= args.stationCount);
  const selected = args.lineKey
    ? candidates.find((line) => line.lineKey === args.lineKey)
    : candidates[0];
  if (!selected) {
    const available = [...lines.values()].map((line) => `${line.lineKey} (${line.stations.length})`).join(", ");
    throw new Error(`No legacy GeoJSON line has at least ${args.stationCount} stations. Available: ${available}`);
  }
  return {
    ...selected,
    stations: selected.stations.slice(0, args.stationCount),
  };
}

function findLineColor(features: GeoJsonFeature[], company: string, lineName: string): string | undefined {
  for (const feature of features) {
    const props = feature.properties ?? {};
    const featureCompany = typeof props.company === "string"
      ? props.company
      : typeof props.operator === "string"
        ? props.operator
        : undefined;
    if (props.type !== "line" || props.name !== lineName || (featureCompany && featureCompany !== company)) continue;
    for (const key of ["stroke", "color", "lineColor"]) {
      if (typeof props[key] === "string" && props[key]) return props[key] as string;
    }
  }
  return undefined;
}

function buildTopology(line: LegacyLine): BaseTopologyLayer {
  const nodes: TopologyNode[] = line.stations.map((station, index) => ({
    id: nodeRef(index),
    kind: index === 0 || index === line.stations.length - 1 ? "line_endpoint" : "junction",
    name: station.name,
    coordinates: station.coordinates,
  }));
  const edges: TopologyEdge[] = [];
  for (let i = 0; i < line.stations.length - 1; i += 1) {
    edges.push({
      id: edgeRef(i),
      fromNodeRef: nodeRef(i),
      toNodeRef: nodeRef(i + 1),
      traversal: "both",
      role: "main",
      name: `${line.stations[i].name}-${line.stations[i + 1].name}`,
      geometryRef: edgeRef(i),
      lengthMeters: distanceMeters(line.stations[i].coordinates, line.stations[i + 1].coordinates),
      coordinates: [line.stations[i].coordinates, line.stations[i + 1].coordinates],
      physicalKind: "main",
      functionalUse: ["through", "stopping"],
      directionRole: "bidirectional",
      sourceTags: {
        lineKey: line.lineKey,
        source: "legacy_geojson_minimal",
      },
    });
  }
  return {
    nodes,
    edges,
    adjacency: buildAdjacency(edges),
    stations: line.stations.map((station, index) => ({
      id: station.id as EntityRef,
      name: station.name,
      nameJa: station.name,
      platformRefs: [platformRef(index)],
      positionRef: nodeRef(index),
    })),
    platforms: line.stations.map((station, index) => ({
      id: platformRef(index),
      stationRef: station.id as EntityRef,
      type: "unknown",
      name: station.name,
      number: index + 1,
    })),
    platformTrackBindings: line.stations.map((station, index) => ({
      id: bindingRef(index),
      stationRef: station.id as EntityRef,
      platformRef: platformRef(index),
      edgeRef: stationEdgeRef(index, line.stations.length),
      side: "unknown",
      servingDirection: "down",
    })),
    stoppingPoints: line.stations.map((station, index) => ({
      id: stoppingPointRef(index),
      stationRef: station.id as EntityRef,
      platformRef: platformRef(index),
      edgeRef: stationEdgeRef(index, line.stations.length),
      direction: "both",
      measure: index === 0 ? 0 : 1,
      confirmation: "imported_confirmed",
    })),
    signals: [],
    specialSections: [],
    doubleTrackPairs: [],
    relations: [],
    hardConstraints: [],
  };
}

function buildServicePattern(line: LegacyLine, topology: BaseTopologyLayer): ServicePattern {
  const traceSequence: ServiceTraceEntry[] = line.stations.map((station, index) => ({
    orderIndex: index,
    passageType: "stop",
    stopType: "mandatory_stop",
    stationRef: station.id as EntityRef,
    platformRef: platformRef(index),
    edgeRef: stationEdgeRef(index, line.stations.length),
    stoppingPointRef: stoppingPointRef(index),
    measure: index === 0 ? 0 : 1,
    platformNumber: index + 1,
    platformName: station.name,
  }));
  return {
    patternId: "railround:minimal:pattern:willer-main" as EntityRef,
    lineRef: line.lineKey as EntityRef,
    systemRef: "railround:minimal:system:willer" as EntityRef,
    companyRef: line.company as EntityRef,
    serviceType: "local",
    topologyType: "linear",
    directionConvention: {
      forwardLabel: "down",
      reverseLabel: "up",
      forwardDirection: "down",
      reverseDirection: "up",
    },
    edgeSequence: topology.edges.map((edge) => edge.id),
    traceSequence,
    pathSegments: topology.edges.map((edge, index) => ({
      orderIndex: index,
      edgeRef: edge.id,
      fromNodeRef: edge.fromNodeRef,
      toNodeRef: edge.toNodeRef,
      measureRange: { startMeasure: 0, endMeasure: 1 },
      distanceMeters: edge.lengthMeters,
      geometryRef: edge.geometryRef,
    })),
    displayName: `${line.company} ${line.lineName}`,
    displayColor: line.displayColor ?? "#2563eb",
  };
}

function buildStationDisplay(line: LegacyLine): Record<string, StationMeta> {
  return Object.fromEntries(line.stations.map((station) => [
    station.id,
    {
      stationRef: station.id as EntityRef,
      name: station.name,
      nameJa: station.name,
      coordinates: station.coordinates,
    },
  ]));
}

function nodeRef(index: number): EntityRef {
  return `railround:minimal:node:${index}` as EntityRef;
}

function edgeRef(index: number): EntityRef {
  return `railround:minimal:edge:${index}` as EntityRef;
}

function platformRef(index: number): EntityRef {
  return `railround:minimal:platform:${index}` as EntityRef;
}

function bindingRef(index: number): EntityRef {
  return `railround:minimal:binding:${index}` as EntityRef;
}

function stoppingPointRef(index: number): EntityRef {
  return `railround:minimal:stop:${index}` as EntityRef;
}

function stationEdgeRef(stationIndex: number, stationCount: number): EntityRef {
  if (stationCount < 2) throw new Error("stationCount must be >= 2.");
  return edgeRef(Math.max(0, Math.min(stationIndex - 1, stationCount - 2)));
}

function isPosition(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number";
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const radiusMeters = 6371000;
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return Math.max(1, Math.round(2 * radiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}
