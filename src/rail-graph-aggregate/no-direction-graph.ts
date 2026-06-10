import type {
  BaseTopologyLayer,
  TopologyEdge,
  TopologyNode,
} from "../rail-graph-v1/base-topology.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import type {
  GeoJSONFeature,
  GeoJSONFeatureCollection,
  GeoJSONGeometry,
  GeoJSONLineString,
  GeoJSONMultiLineString,
  GeoJSONPosition,
} from "../rail-graph-v1/geojson";
import type { EntityRef } from "../rail-graph-v1/primitives";
import { buildAdjacency } from "../rail-graph-v1/topology";

export type AggregateFeature = GeoJSONFeature<GeoJSONGeometry, Record<string, unknown>>;
export type AggregateFeatureCollection = GeoJSONFeatureCollection<GeoJSONGeometry, Record<string, unknown>>;

export interface FixtureSource {
  workspaceKey: string;
  label: string;
  nodePath: string;
  browserPath: string;
}

export interface NoDirectionBuildInput {
  aggregateKey: string;
  sources: Array<{
    workspaceKey: string;
    featureCollection: AggregateFeatureCollection;
  }>;
}

export interface NoDirectionBuildResult {
  featureCollection: AggregateFeatureCollection;
  topo: BaseTopologyLayer;
  diagnostics: Diagnostic[];
  perWorkspaceEdgeCount: Record<string, number>;
  mergedFeatureCount: number;
  dedupedFeatureCount: number;
}

export interface NoDirectionPath {
  edgeSequence: EntityRef[];
  nodeSequence: EntityRef[];
  totalDistanceMeters: number;
}

export const DEFAULT_FIXTURE_SOURCES: FixtureSource[] = [
  {
    workspaceKey: "senseki",
    label: "仙石線",
    nodePath: "src/rail-graph-v1-mvp/fixtures/aggregate-senseki.cleaned.geojson",
    browserPath: "/src/rail-graph-v1-mvp/fixtures/aggregate-senseki.cleaned.geojson",
  },
  {
    workspaceKey: "tohoku-main",
    label: "東北本線_v2",
    nodePath: "src/rail-graph-v1-mvp/fixtures/aggregate-東北本線_v2.cleaned.geojson",
    browserPath: "/src/rail-graph-v1-mvp/fixtures/aggregate-%E6%9D%B1%E5%8C%97%E6%9C%AC%E7%B7%9A_v2.cleaned.geojson",
  },
];

const EMPTY_TOPO: BaseTopologyLayer = {
  nodes: [],
  edges: [],
  adjacency: { outEdges: {}, inEdges: {} },
  stations: [],
  platforms: [],
  platformTrackBindings: [],
  stoppingPoints: [],
  signals: [],
  specialSections: [],
  doubleTrackPairs: [],
  relations: [],
  hardConstraints: [],
};

export function buildNoDirectionAggregate(input: NoDirectionBuildInput): NoDirectionBuildResult {
  const diagnostics: Diagnostic[] = [];
  const perWorkspaceEdgeCount: Record<string, number> = {};
  const seen = new Set<string>();
  const merged: AggregateFeature[] = [];
  let dedupedFeatureCount = 0;

  for (const source of input.sources) {
    let railCount = 0;
    for (const feature of source.featureCollection.features) {
      if (isRailLineFeature(feature)) railCount += lineStringsFromGeometry(feature.geometry).length;
      const key = coreId(feature);
      if (!key || seen.has(key)) {
        dedupedFeatureCount += 1;
        continue;
      }
      seen.add(key);
      merged.push(cloneFeature(feature));
    }
    perWorkspaceEdgeCount[source.workspaceKey] = railCount;
  }

  const topo = cloneTopo(EMPTY_TOPO);
  const nodeById = new Map<EntityRef, TopologyNode>();

  for (const feature of merged) {
    if (!isRailLineFeature(feature)) continue;
    const lines = lineStringsFromGeometry(feature.geometry);
    const sourceRef = coreId(feature);
    for (const [lineIndex, coords] of lines.entries()) {
      if (coords.length < 2) continue;
      const fromNodeRef = nodeIdForCoordinate(coords[0]);
      const toNodeRef = nodeIdForCoordinate(coords[coords.length - 1]);
      ensureNode(topo, nodeById, fromNodeRef, coords[0]);
      ensureNode(topo, nodeById, toNodeRef, coords[coords.length - 1]);
      const edgeId = edgeIdForFeature(feature, lineIndex);
      topo.edges.push({
        id: edgeId,
        fromNodeRef,
        toNodeRef,
        traversal: "both",
        role: roleFromFeature(feature),
        name: stringProp(feature, "name") || stringProp(feature, "name:ja") || sourceRef,
        trackCode: stringProp(feature, "railway:track_ref") || undefined,
        geometryRef: `aggregate:geometry:${edgeId}` as EntityRef,
        lengthMeters: polylineLengthMeters(coords),
        coordinates: coords,
        sourceSlice: {
          sourceFeatureRef: sourceRef,
          multiLineIndex: feature.geometry.type === "MultiLineString" ? lineIndex : undefined,
          startMeasure: 0,
          endMeasure: 1,
        },
        physicalKind: stringProp(feature, "service") === "siding" ? "siding" : "main",
        functionalUse: ["through"],
        directionRole: "bidirectional",
        sourceTags: extractSourceTags(feature.properties),
      });
    }
  }

  topo.adjacency = buildAdjacency(topo.edges);
  topo.stations = topo.nodes.map((node) => ({
    id: node.id,
    name: node.name ?? node.id,
    platformRefs: [],
    positionRef: node.id,
  }));

  if (topo.edges.length === 0) {
    diagnostics.push({
      level: "error",
      code: "AGG_NO_DIRECTION_NO_RAIL_EDGES",
      stage: "aggregate",
      message: "No rail LineString features were available for no-direction graph build.",
    });
  }

  return {
    featureCollection: { type: "FeatureCollection", features: merged },
    topo,
    diagnostics,
    perWorkspaceEdgeCount,
    mergedFeatureCount: merged.length,
    dedupedFeatureCount,
  };
}

export function resolveNoDirectionChainPath(args: {
  topo: BaseTopologyLayer;
  originNodeRef: EntityRef;
  terminusNodeRef: EntityRef;
  viaEdgeRefs?: EntityRef[];
}): NoDirectionPath {
  let current = args.originNodeRef;
  const edgeSequence: EntityRef[] = [];
  const nodeSequence: EntityRef[] = [current];
  let totalDistanceMeters = 0;

  for (const viaEdgeRef of args.viaEdgeRefs ?? []) {
    const via = edgeById(args.topo, viaEdgeRef);
    if (!via) throw new Error(`Unknown via edge: ${viaEdgeRef}`);
    const optionA = shortestNodePath(args.topo, current, via.fromNodeRef);
    const optionB = shortestNodePath(args.topo, current, via.toNodeRef);
    const chosen = chooseShorter(optionA, optionB);
    if (!chosen) throw new Error(`No path from ${current} to via edge ${viaEdgeRef}`);
    appendPath(edgeSequence, nodeSequence, chosen);
    appendEdge(edgeSequence, nodeSequence, via, nodeSequence[nodeSequence.length - 1]);
    totalDistanceMeters += chosen.totalDistanceMeters + via.lengthMeters;
    current = nodeSequence[nodeSequence.length - 1];
  }

  const tail = shortestNodePath(args.topo, current, args.terminusNodeRef);
  if (!tail) throw new Error(`No path from ${current} to ${args.terminusNodeRef}`);
  appendPath(edgeSequence, nodeSequence, tail);
  totalDistanceMeters += tail.totalDistanceMeters;

  return { edgeSequence, nodeSequence, totalDistanceMeters };
}

export function resolveNoDirectionChainCandidates(args: {
  topo: BaseTopologyLayer;
  originNodeRef: EntityRef;
  terminusNodeRef: EntityRef;
  viaEdgeRefs?: EntityRef[];
  maxCandidates?: number;
}): NoDirectionPath[] {
  const primary = resolveNoDirectionChainPath(args);
  const candidates: NoDirectionPath[] = [primary];
  const seen = new Set([primary.edgeSequence.join("|")]);
  const max = Math.max(1, args.maxCandidates ?? 5);
  const bannedPool = primary.edgeSequence.slice(1, -1);

  for (const bannedEdgeRef of bannedPool) {
    if (candidates.length >= max) break;
    const topo = removeEdge(args.topo, bannedEdgeRef);
    try {
      const next = resolveNoDirectionChainPath({
        topo,
        originNodeRef: args.originNodeRef,
        terminusNodeRef: args.terminusNodeRef,
        viaEdgeRefs: args.viaEdgeRefs?.filter((edgeRef) => edgeRef !== bannedEdgeRef),
      });
      const sig = next.edgeSequence.join("|");
      if (sig && !seen.has(sig)) {
        seen.add(sig);
        candidates.push(next);
      }
    } catch {
      // Some removals disconnect the staged route; keep looking for useful alternatives.
    }
  }

  return candidates.sort((a, b) => a.totalDistanceMeters - b.totalDistanceMeters);
}

export function shortestNodePath(
  topo: BaseTopologyLayer,
  fromNodeRef: EntityRef,
  toNodeRef: EntityRef,
): NoDirectionPath | null {
  if (fromNodeRef === toNodeRef) {
    return { edgeSequence: [], nodeSequence: [fromNodeRef], totalDistanceMeters: 0 };
  }

  const edgeMap = new Map(topo.edges.map((edge) => [edge.id, edge] as const));
  const dist = new Map<EntityRef, number>();
  const prev = new Map<EntityRef, { nodeRef: EntityRef; edgeRef: EntityRef }>();
  const queue = new Set<EntityRef>();

  for (const node of topo.nodes) {
    dist.set(node.id, Number.POSITIVE_INFINITY);
    queue.add(node.id);
  }
  dist.set(fromNodeRef, 0);

  while (queue.size > 0) {
    let current: EntityRef | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const nodeRef of queue) {
      const d = dist.get(nodeRef) ?? Number.POSITIVE_INFINITY;
      if (d < best) {
        best = d;
        current = nodeRef;
      }
    }
    if (!current || best === Number.POSITIVE_INFINITY) break;
    queue.delete(current);
    if (current === toNodeRef) break;

    const outgoing = topo.adjacency.outEdges[current] ?? [];
    for (const edgeRef of outgoing) {
      const edge = edgeMap.get(edgeRef);
      if (!edge) continue;
      const next = edge.fromNodeRef === current ? edge.toNodeRef : edge.fromNodeRef;
      if (!queue.has(next)) continue;
      const candidate = best + edge.lengthMeters;
      if (candidate < (dist.get(next) ?? Number.POSITIVE_INFINITY)) {
        dist.set(next, candidate);
        prev.set(next, { nodeRef: current, edgeRef });
      }
    }
  }

  if (!prev.has(toNodeRef)) return null;

  const nodes: EntityRef[] = [toNodeRef];
  const edges: EntityRef[] = [];
  let cursor = toNodeRef;
  while (cursor !== fromNodeRef) {
    const step = prev.get(cursor);
    if (!step) return null;
    edges.unshift(step.edgeRef);
    nodes.unshift(step.nodeRef);
    cursor = step.nodeRef;
  }
  return {
    edgeSequence: edges,
    nodeSequence: nodes,
    totalDistanceMeters: dist.get(toNodeRef) ?? 0,
  };
}

export function findEdgeByOsmId(topo: BaseTopologyLayer, osmId: string): TopologyEdge | undefined {
  return topo.edges.find((edge) => edge.sourceSlice?.sourceFeatureRef.split(":")[1] === osmId);
}

export function nodeCoordinate(topo: BaseTopologyLayer, nodeRef: EntityRef): [number, number] | null {
  for (const edge of topo.edges) {
    if (!edge.coordinates || edge.coordinates.length === 0) continue;
    if (edge.fromNodeRef === nodeRef) return edge.coordinates[0];
    if (edge.toNodeRef === nodeRef) return edge.coordinates[edge.coordinates.length - 1];
  }
  return null;
}

export function coreId(feature: AggregateFeature): string {
  const p = feature.properties || {};
  return `${stringValue(p.osm_type)}:${stringValue(p.osm_id)}:${stringValue(p.class_main)}`;
}

export function fidOf(feature: AggregateFeature): string {
  const p = feature.properties || {};
  if (typeof p._fid === "string" && p._fid.length > 0) return p._fid;
  return `${stringValue(p.osm_type)}:${stringValue(p.osm_id)}:${stringValue(p.class_main)}:${stringValue(p.source_line_name)}`;
}

export function edgeIdForFeature(feature: AggregateFeature, lineIndex = 0): EntityRef {
  const base = coreId(feature) || fidOf(feature);
  return `${base}${lineIndex > 0 ? `:${lineIndex}` : ""}` as EntityRef;
}

export function polylineLengthMeters(coordinates: GeoJSONPosition[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += distanceMeters(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

function appendPath(edgeSequence: EntityRef[], nodeSequence: EntityRef[], path: NoDirectionPath): void {
  for (const edgeRef of path.edgeSequence) {
    if (edgeSequence[edgeSequence.length - 1] !== edgeRef) edgeSequence.push(edgeRef);
  }
  for (let i = 1; i < path.nodeSequence.length; i += 1) {
    const nodeRef = path.nodeSequence[i];
    if (nodeSequence[nodeSequence.length - 1] !== nodeRef) nodeSequence.push(nodeRef);
  }
}

function appendEdge(
  edgeSequence: EntityRef[],
  nodeSequence: EntityRef[],
  edge: TopologyEdge,
  currentNodeRef: EntityRef,
): void {
  if (edgeSequence[edgeSequence.length - 1] !== edge.id) edgeSequence.push(edge.id);
  const next = edge.fromNodeRef === currentNodeRef ? edge.toNodeRef : edge.fromNodeRef;
  if (nodeSequence[nodeSequence.length - 1] !== next) nodeSequence.push(next);
}

function chooseShorter(a: NoDirectionPath | null, b: NoDirectionPath | null): NoDirectionPath | null {
  if (a && b) return a.totalDistanceMeters <= b.totalDistanceMeters ? a : b;
  return a ?? b;
}

function edgeById(topo: BaseTopologyLayer, edgeRef: EntityRef): TopologyEdge | undefined {
  return topo.edges.find((edge) => edge.id === edgeRef);
}

function removeEdge(topo: BaseTopologyLayer, edgeRef: EntityRef): BaseTopologyLayer {
  const next = cloneTopo(topo);
  next.edges = next.edges.filter((edge) => edge.id !== edgeRef);
  next.adjacency = buildAdjacency(next.edges);
  return next;
}

function ensureNode(
  topo: BaseTopologyLayer,
  nodeById: Map<EntityRef, TopologyNode>,
  id: EntityRef,
  coordinate: GeoJSONPosition,
): void {
  if (nodeById.has(id)) return;
  const node: TopologyNode = {
    id,
    kind: "line_endpoint",
    name: `Node ${coordinate[0].toFixed(6)},${coordinate[1].toFixed(6)}`,
  };
  topo.nodes.push(node);
  nodeById.set(id, node);
}

function isRailLineFeature(feature: AggregateFeature): feature is GeoJSONFeature<GeoJSONLineString | GeoJSONMultiLineString, Record<string, unknown>> {
  return stringProp(feature, "class_main") === "rail"
    && (feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString");
}

function lineStringsFromGeometry(geometry: GeoJSONGeometry): GeoJSONPosition[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function roleFromFeature(feature: AggregateFeature): TopologyEdge["role"] {
  const service = stringProp(feature, "service");
  if (service === "siding") return "passing";
  if (stringProp(feature, "usage") === "branch") return "connector";
  return "main";
}

function nodeIdForCoordinate(coordinate: GeoJSONPosition): EntityRef {
  return `manual:node:${coordinate[0].toFixed(6)},${coordinate[1].toFixed(6)}` as EntityRef;
}

function extractSourceTags(properties: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "railGraph" || value === undefined || value === null || value === "") continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cloneFeature(feature: AggregateFeature): AggregateFeature {
  return JSON.parse(JSON.stringify(feature)) as AggregateFeature;
}

function cloneTopo(topo: BaseTopologyLayer): BaseTopologyLayer {
  return JSON.parse(JSON.stringify(topo)) as BaseTopologyLayer;
}

function stringProp(feature: AggregateFeature, key: string): string {
  return stringValue(feature.properties?.[key]);
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function distanceMeters(left: GeoJSONPosition, right: GeoJSONPosition): number {
  const earthRadiusMeters = 6371000;
  const leftLat = toRadians(left[1]);
  const rightLat = toRadians(right[1]);
  const deltaLat = toRadians(right[1] - left[1]);
  const deltaLng = toRadians(right[0] - left[0]);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}
