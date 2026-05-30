// ============================================================
// Rail Graph v1 - SystemContext / RailGraph builder
// ============================================================

import type {
  BaseTopologyLayer,
  PlatformTrackBinding,
  SpecialSection,
  StoppingPoint,
  TopologyEdge,
  TopologyNode,
} from "./base-topology.types";
import type { Diagnostic, ProvenanceRecord } from "./diagnostic-types";
import type { EventAnchor, EventPolicy } from "./event.types";
import type { GeoJSONLineString, GeoJSONPoint, GeoJSONPolygon } from "./geojson";
import type {
  PatternDisplayMeta,
  RailGraph,
  RailGraphFingerprints,
  RailGraphIndexes,
  SystemContext,
} from "./graph.types";
import type { UserEventV2 } from "./mileage-event.types";
import type { EntityRef, ISODateTime } from "./primitives";
import type { ServicePattern, ServiceTraceEntry } from "./service-template.types";
import type { StationMeta } from "./user-facing.types";
import { buildAdjacency } from "./topology";
import { fingerprint } from "./fingerprint";

export interface BuildSystemContextArgs {
  baseTopology: BaseTopologyLayer;
  servicePatterns: ServicePattern[];
  geometryStore?: Partial<RailGraph["geometryStore"]>;
  displayStore?: Partial<RailGraph["displayStore"]>;
  eventLayer?: Partial<RailGraph["eventLayer"]>;
  provenance?: ProvenanceRecord[];
  diagnostics?: Diagnostic[];
  createdAt?: ISODateTime;
  sourceMode?: "compiled-topology" | "no-direction-graph";
  allowNoDirection?: boolean;
  noDirectionReason?: "verify";
}

export function buildSystemContext(args: BuildSystemContextArgs): SystemContext {
  assertProductTopologyMode(args);
  const graph = buildRailGraph(args);
  const fingerprints = buildRailGraphFingerprints(graph);
  return {
    graphId: fingerprints.topoHash,
    graph,
    fingerprints,
    diagnostics: graph.diagnostics,
    createdAt: args.createdAt ?? new Date().toISOString(),
  };
}

export function buildRailGraph(args: BuildSystemContextArgs): RailGraph {
  assertProductTopologyMode(args);
  const base = normalizeBaseTopology(args.baseTopology);
  const servicePatterns = [...args.servicePatterns];
  const geometryStore = buildGeometryStore(base, args.geometryStore);
  const displayStore = buildDisplayStore(base, servicePatterns, args.displayStore);
  const eventLayer = {
    anchors: [...(args.eventLayer?.anchors ?? [])],
    policies: [...(args.eventLayer?.policies ?? [])],
    mileageUserEvents: args.eventLayer?.mileageUserEvents
      ? [...args.eventLayer.mileageUserEvents]
      : undefined,
  };

  const graph: RailGraph = {
    schemaVersion: "rail-graph-v1",
    topo: {
      base,
      serviceTemplates: {
        servicePatterns,
      },
    },
    geometryStore,
    displayStore,
    eventLayer,
    indexes: buildRailGraphIndexes(base, servicePatterns),
    provenance: [...(args.provenance ?? [])],
    diagnostics: [
      ...(args.diagnostics ?? []),
      ...topologyModeDiagnostics(args),
    ],
  };
  return graph;
}

export function buildRailGraphIndexes(
  base: BaseTopologyLayer,
  servicePatterns: ServicePattern[],
): RailGraphIndexes {
  const indexes: RailGraphIndexes = {
    nodeById: Object.fromEntries(base.nodes.map((node) => [node.id, node])),
    edgeById: Object.fromEntries(base.edges.map((edge) => [edge.id, edge])),
    stationById: Object.fromEntries(base.stations.map((station) => [station.id, station])),
    platformById: Object.fromEntries(base.platforms.map((platform) => [platform.id, platform])),
    stoppingPointById: Object.fromEntries(base.stoppingPoints.map((point) => [point.id, point])),
    sectionById: Object.fromEntries(base.specialSections.map((section) => [section.id, section])),
    patternById: Object.fromEntries(servicePatterns.map((pattern) => [pattern.patternId, pattern])),
    bindingsByEdge: {},
    stoppingPointsByEdge: {},
    stoppingPointsByPlatform: {},
    doubleTrackPairsByEdge: {},
    patternsByEdge: {},
    patternsByStation: {},
    edgesBySection: {},
  };

  for (const binding of base.platformTrackBindings) {
    pushUnique(indexes.bindingsByEdge, binding.edgeRef, binding.id);
  }
  for (const point of base.stoppingPoints) {
    pushUnique(indexes.stoppingPointsByEdge, point.edgeRef, point.id);
    pushUnique(indexes.stoppingPointsByPlatform, point.platformRef, point.id);
  }
  for (const pair of base.doubleTrackPairs) {
    for (const edgeRef of [
      ...pair.upEdgeRefs,
      ...pair.downEdgeRefs,
      ...(pair.sharedGeometryEdgeRefs ?? []),
    ]) {
      pushUnique(indexes.doubleTrackPairsByEdge, edgeRef, pair.id);
    }
  }
  for (const section of base.specialSections) {
    for (const edgeRef of section.edgeRefs) {
      pushUnique(indexes.edgesBySection, section.id, edgeRef);
    }
  }
  for (const pattern of servicePatterns) {
    for (const edgeRef of collectPatternEdgeRefs(pattern)) {
      pushUnique(indexes.patternsByEdge, edgeRef, pattern.patternId);
    }
    for (const stationRef of collectPatternStationRefs(pattern)) {
      pushUnique(indexes.patternsByStation, stationRef, pattern.patternId);
    }
  }

  return indexes;
}

export function buildRailGraphFingerprints(graph: RailGraph): RailGraphFingerprints {
  return {
    topoHash: fingerprint(toGraphIdInput(graph)),
    geometryHash: fingerprint(graph.geometryStore),
    displayHash: fingerprint(graph.displayStore),
    eventHash: fingerprint(graph.eventLayer),
    provenanceHash: fingerprint({
      provenance: graph.provenance,
      diagnostics: graph.diagnostics,
    }),
  };
}

export function toGraphIdInput(graph: RailGraph): unknown {
  return {
    schemaVersion: graph.schemaVersion,
    base: toHotBaseTopology(graph.topo.base),
    servicePatterns: graph.topo.serviceTemplates.servicePatterns.map(toHotServicePattern),
  };
}

function normalizeBaseTopology(base: BaseTopologyLayer): BaseTopologyLayer {
  return {
    ...base,
    adjacency: base.adjacency?.outEdges && base.adjacency?.inEdges
      ? base.adjacency
      : buildAdjacency(base.edges),
  };
}

function buildGeometryStore(
  base: BaseTopologyLayer,
  input?: Partial<RailGraph["geometryStore"]>,
): RailGraph["geometryStore"] {
  const edgeGeometries: Record<string, GeoJSONLineString> = {};
  const nodePositions: Record<string, GeoJSONPoint["coordinates"]> = {};
  const platformGeometries: Record<string, GeoJSONPolygon> = {};
  const sectionGeometries: Record<string, GeoJSONLineString | GeoJSONPolygon> = {};

  for (const edge of base.edges) {
    if (edge.coordinates && edge.coordinates.length >= 2) {
      edgeGeometries[edge.geometryRef ?? edge.id] = {
        type: "LineString",
        coordinates: edge.coordinates,
      };
    }
  }
  for (const node of base.nodes) {
    if (node.coordinates) nodePositions[node.geometryRef ?? node.id] = node.coordinates;
  }

  return {
    edgeGeometries: {
      ...edgeGeometries,
      ...(input?.edgeGeometries ?? {}),
    },
    nodePositions: {
      ...nodePositions,
      ...(input?.nodePositions ?? {}),
    },
    platformGeometries: {
      ...platformGeometries,
      ...(input?.platformGeometries ?? {}),
    },
    sectionGeometries: {
      ...sectionGeometries,
      ...(input?.sectionGeometries ?? {}),
    },
  };
}

function buildDisplayStore(
  base: BaseTopologyLayer,
  servicePatterns: ServicePattern[],
  input?: Partial<RailGraph["displayStore"]>,
): RailGraph["displayStore"] {
  const patternDisplay: Record<string, PatternDisplayMeta> = {};
  for (const pattern of servicePatterns) {
    patternDisplay[pattern.patternId] = {
      displayName: pattern.displayName,
      displayColor: pattern.displayColor,
    };
  }

  const stationDisplay: Record<string, StationMeta> = {};
  for (const station of base.stations) {
    stationDisplay[station.id] = {
      stationRef: station.id,
      name: station.name,
      nameJa: station.nameJa,
      coordinates: [0, 0],
    };
  }

  return {
    patternDisplay: {
      ...patternDisplay,
      ...(input?.patternDisplay ?? {}),
    },
    stationDisplay: {
      ...stationDisplay,
      ...(input?.stationDisplay ?? {}),
    },
  };
}

function toHotBaseTopology(base: BaseTopologyLayer): unknown {
  return {
    nodes: base.nodes.map(toHotNode),
    edges: base.edges.map(toHotEdge),
    adjacency: base.adjacency,
    stations: base.stations.map((station) => ({
      id: station.id,
      platformRefs: station.platformRefs,
      stationAreaRef: station.stationAreaRef,
      positionRef: station.positionRef,
    })),
    platforms: base.platforms.map((platform) => ({
      id: platform.id,
      stationRef: platform.stationRef,
      type: platform.type,
      number: platform.number,
      areaRef: platform.areaRef,
    })),
    platformTrackBindings: base.platformTrackBindings.map(toHotBinding),
    stoppingPoints: base.stoppingPoints.map(toHotStoppingPoint),
    signals: base.signals.map((signal) => ({
      id: signal.id,
      edgeRef: signal.edgeRef,
      measure: signal.measure,
      facing: signal.facing,
    })),
    specialSections: base.specialSections.map(toHotSection),
    doubleTrackPairs: base.doubleTrackPairs,
    relations: base.relations,
    hardConstraints: base.hardConstraints,
  };
}

function toHotNode(node: TopologyNode): unknown {
  return {
    id: node.id,
    kind: node.kind,
    properties: node.properties,
  };
}

function toHotEdge(edge: TopologyEdge): unknown {
  return {
    id: edge.id,
    fromNodeRef: edge.fromNodeRef,
    toNodeRef: edge.toNodeRef,
    traversal: edge.traversal,
    role: edge.role,
    trackCode: edge.trackCode,
    lengthMeters: edge.lengthMeters,
    physicalKind: edge.physicalKind,
    functionalUse: edge.functionalUse,
    directionRole: edge.directionRole,
    properties: edge.properties,
  };
}

function toHotBinding(binding: PlatformTrackBinding): unknown {
  return {
    id: binding.id,
    stationRef: binding.stationRef,
    platformRef: binding.platformRef,
    edgeRef: binding.edgeRef,
    side: binding.side,
    servingDirection: binding.servingDirection,
  };
}

function toHotStoppingPoint(point: StoppingPoint): unknown {
  return {
    id: point.id,
    stationRef: point.stationRef,
    platformRef: point.platformRef,
    edgeRef: point.edgeRef,
    direction: point.direction,
    measure: point.measure,
    confirmation: point.confirmation,
  };
}

function toHotSection(section: SpecialSection): unknown {
  return {
    id: section.id,
    category: section.category,
    directionSeparation: section.directionSeparation,
    edgeRefs: section.edgeRefs,
  };
}

function toHotServicePattern(pattern: ServicePattern): unknown {
  return {
    patternId: pattern.patternId,
    lineRef: pattern.lineRef,
    systemRef: pattern.systemRef,
    companyRef: pattern.companyRef,
    serviceType: pattern.serviceType,
    topologyType: pattern.topologyType,
    directionConvention: pattern.directionConvention,
    edgeSequence: pattern.edgeSequence,
    traceSequence: pattern.traceSequence.map(toHotTraceEntry),
    pathSegments: pattern.pathSegments.map((segment) => ({
      orderIndex: segment.orderIndex,
      edgeRef: segment.edgeRef,
      fromNodeRef: segment.fromNodeRef,
      toNodeRef: segment.toNodeRef,
      measureRange: segment.measureRange,
      distanceMeters: segment.distanceMeters,
      specialSectionRefs: segment.specialSectionRefs,
    })),
    cycleCheck: pattern.cycleCheck,
  };
}

function toHotTraceEntry(entry: ServiceTraceEntry): unknown {
  if (entry.passageType === "stop") {
    return {
      orderIndex: entry.orderIndex,
      passageType: entry.passageType,
      stopType: entry.stopType,
      stationRef: entry.stationRef,
      platformRef: entry.platformRef,
      edgeRef: entry.edgeRef,
      stoppingPointRef: entry.stoppingPointRef,
      measure: entry.measure,
      platformNumber: entry.platformNumber,
      operationType: entry.operationType,
    };
  }
  return {
    orderIndex: entry.orderIndex,
    passageType: entry.passageType,
    stopType: entry.stopType,
    stationRef: entry.stationRef,
    edgeRef: entry.edgeRef,
    platformRef: entry.platformRef,
    measureRange: entry.measureRange,
  };
}

function collectPatternEdgeRefs(pattern: ServicePattern): EntityRef[] {
  return [
    ...pattern.edgeSequence,
    ...pattern.pathSegments.map((segment) => segment.edgeRef),
    ...pattern.traceSequence.map((trace) => trace.edgeRef),
  ];
}

function collectPatternStationRefs(pattern: ServicePattern): EntityRef[] {
  return pattern.traceSequence.map((trace) => trace.stationRef);
}

function pushUnique(
  index: Record<string, string[]>,
  key: string,
  value: string,
): void {
  const list = index[key] ?? [];
  if (!list.includes(value)) list.push(value);
  index[key] = list;
}

function assertProductTopologyMode(args: BuildSystemContextArgs): void {
  if (args.sourceMode === "no-direction-graph" && !args.allowNoDirection) {
    throw new Error(
      "Cannot build a product SystemContext from no-direction aggregate data. " +
      "Pass allowNoDirection only from verification code.",
    );
  }
}

function topologyModeDiagnostics(args: BuildSystemContextArgs): Diagnostic[] {
  if (args.sourceMode !== "no-direction-graph") return [];
  return [{
    level: "warn",
    code: "RAIL_GRAPH_NO_DIRECTION_VERIFY_CONTEXT",
    stage: "graph-builder",
    message: "SystemContext was built from no-direction aggregate data for verification only.",
    context: { reason: args.noDirectionReason ?? "verify" },
  }];
}

export type GraphBuilderEventLayerInput = {
  anchors?: EventAnchor[];
  policies?: EventPolicy[];
  mileageUserEvents?: UserEventV2[];
};
