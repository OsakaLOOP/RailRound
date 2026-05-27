import type { IntentionChain, ChainEndpointAnchor } from "../../rail-graph-v1/chain.types";
import type { EntityRef } from "../../rail-graph-v1/primitives";
import type {
  ServicePathSegment,
  ServicePassEntry,
} from "../../rail-graph-v1/service-template.types";
import { buildTopologyLookup, type TopologyLookup, traverseTo } from "../../rail-graph-v1/topology";
import { findPathsV2, type FindPathsV2Args, type FindPathsV2Result } from "../../rail-graph-v1/pathfinding-v2";
import type { AggregateState } from "../aggregate-state";
import {
  resolveNoDirectionChainCandidates,
} from "../no-direction-graph";
import type { StoredServicePattern } from "./store";

export interface AggregateCandidatePath {
  edgeSequence: EntityRef[];
  nodeSequence: EntityRef[];
  totalDistanceMeters: number;
}

export interface AdaptChainToPatternArgs {
  chain: IntentionChain;
  aggregate: AggregateState;
  lookup?: TopologyLookup;
  findPaths?: (args: FindPathsV2Args) => FindPathsV2Result;
  candidate?: AggregateCandidatePath;
  patternId?: EntityRef;
  displayName?: string;
  displayColor?: string;
  lineRef?: EntityRef;
  serviceType?: StoredServicePattern["serviceType"];
}

export function adaptChainToPattern(args: AdaptChainToPatternArgs): StoredServicePattern {
  const path = args.candidate ?? resolveChainPath({
    chain: args.chain,
    aggregate: args.aggregate,
    lookup: args.lookup,
    findPaths: args.findPaths,
  });
  const now = new Date().toISOString();
  const patternId = args.patternId ?? (`aggregate:pattern:${hashText(path.edgeSequence.join("|"))}` as EntityRef);
  return {
    patternId,
    lineRef: args.lineRef ?? (`aggregate:line:${args.aggregate.aggregateKey}` as EntityRef),
    systemRef: `aggregate:system:${args.aggregate.aggregateKey}` as EntityRef,
    serviceType: args.serviceType ?? "local",
    topologyType: "branching",
    directionConvention: {
      forwardLabel: "下り",
      reverseLabel: "上り",
      forwardDirection: "down",
      reverseDirection: "up",
    },
    edgeSequence: path.edgeSequence,
    traceSequence: buildTraceSequence(path),
    pathSegments: buildPathSegments(args.aggregate, path),
    displayName: args.displayName ?? String(patternId),
    displayColor: args.displayColor ?? "#2563eb",
    intentionChain: args.chain,
    createdAt: now,
    updatedAt: now,
    metadata: {
      graphMode: args.aggregate.mode,
      note: args.aggregate.mode === "no-direction-graph"
        ? "Built on the no-direction aggregate graph substitute for verification."
        : "Built on compiled aggregate topology.",
    },
  };
}

export function resolveChainPath(args: {
  chain: IntentionChain;
  aggregate: AggregateState;
  lookup?: TopologyLookup;
  findPaths?: (args: FindPathsV2Args) => FindPathsV2Result;
}): AggregateCandidatePath {
  const candidates = resolveChainCandidates({ ...args, maxCandidates: 1 });
  const first = candidates[0];
  if (!first) throw new Error("No aggregate path candidate was found.");
  return first;
}

export function resolveChainCandidates(args: {
  chain: IntentionChain;
  aggregate: AggregateState;
  lookup?: TopologyLookup;
  findPaths?: (args: FindPathsV2Args) => FindPathsV2Result;
  maxCandidates?: number;
}): AggregateCandidatePath[] {
  if (args.aggregate.mode === "compiled-topology") {
    return resolveCompiledTopologyChainCandidates(args);
  }
  return resolveNoDirectionChainCandidates({
    topo: args.aggregate.topo,
    ...chainToNoDirectionEndpoints(args.chain, args.aggregate),
    maxCandidates: args.maxCandidates,
  });
}

function resolveCompiledTopologyChainCandidates(args: {
  chain: IntentionChain;
  aggregate: AggregateState;
  lookup?: TopologyLookup;
  findPaths?: (args: FindPathsV2Args) => FindPathsV2Result;
  maxCandidates?: number;
}): AggregateCandidatePath[] {
  const origin = args.chain.nodes[0];
  const terminus = args.chain.nodes[args.chain.nodes.length - 1];
  if (!origin || origin.kind !== "origin") throw new Error("Chain must start with origin.");
  if (!terminus || terminus.kind !== "terminus") throw new Error("Chain must end with terminus.");

  const lookup = args.lookup ?? buildTopologyLookup(args.aggregate.topo);
  const findPaths = args.findPaths ?? findPathsV2;
  const start = endpointAnchorToPathSeed(origin.at, args.aggregate);
  const end = endpointAnchorToPathSeed(terminus.at, args.aggregate);
  const result = findPaths({
    topo: args.aggregate.topo,
    lookup,
    chain: args.chain,
    startEntryPoints: [start],
    endEntryPoints: [end],
    maxCandidates: args.maxCandidates ?? 5,
  });

  return result.candidates.map((candidate) => ({
    edgeSequence: candidate.edgeSequence,
    nodeSequence: nodeSequenceFromCandidate(candidate.edgeSequence, candidate.edgeEntryNodes, lookup),
    totalDistanceMeters: candidate.totalDistanceMeters,
  }));
}

function chainToNoDirectionEndpoints(chain: IntentionChain, aggregate: AggregateState): {
  originNodeRef: EntityRef;
  terminusNodeRef: EntityRef;
  viaEdgeRefs: EntityRef[];
} {
  const origin = chain.nodes[0];
  const terminus = chain.nodes[chain.nodes.length - 1];
  if (!origin || origin.kind !== "origin") throw new Error("Chain must start with origin.");
  if (!terminus || terminus.kind !== "terminus") throw new Error("Chain must end with terminus.");
  const viaEdgeRefs = chain.nodes
    .filter((node): node is Extract<typeof node, { kind: "via_edge" }> => node.kind === "via_edge")
    .map((node) => node.edgeRef);
  return {
    originNodeRef: anchorToNodeRef(origin.at, aggregate),
    terminusNodeRef: anchorToNodeRef(terminus.at, aggregate),
    viaEdgeRefs,
  };
}

function endpointAnchorToPathSeed(anchor: ChainEndpointAnchor, aggregate: AggregateState): {
  startNodeRef: EntityRef;
  firstEdge?: EntityRef;
} {
  if ("nodeRef" in anchor) return { startNodeRef: anchor.nodeRef };
  const edge = aggregate.topo.edges.find((item) => item.id === anchor.edgeRef);
  if (!edge) throw new Error(`Unknown anchor edge: ${anchor.edgeRef}`);
  return {
    startNodeRef: anchor.measure <= 0.5 ? edge.fromNodeRef : edge.toNodeRef,
    firstEdge: anchor.edgeRef,
  };
}

function nodeSequenceFromCandidate(
  edgeSequence: EntityRef[],
  edgeEntryNodes: EntityRef[],
  lookup: TopologyLookup,
): EntityRef[] {
  const out: EntityRef[] = [];
  for (let index = 0; index < edgeSequence.length; index += 1) {
    const edgeRef = edgeSequence[index];
    const edge = lookup.edgesById[edgeRef];
    if (!edge) continue;
    const entryNode = edgeEntryNodes[index] ?? edge.fromNodeRef;
    if (out.length === 0) out.push(entryNode);
    const exitNode = traverseTo(edge, entryNode);
    if (out[out.length - 1] !== exitNode) out.push(exitNode);
  }
  return out;
}

function anchorToNodeRef(anchor: ChainEndpointAnchor, aggregate: AggregateState): EntityRef {
  if ("nodeRef" in anchor) return anchor.nodeRef;
  const edge = aggregate.topo.edges.find((item) => item.id === anchor.edgeRef);
  if (!edge) throw new Error(`Unknown anchor edge: ${anchor.edgeRef}`);
  return anchor.measure <= 0.5 ? edge.fromNodeRef : edge.toNodeRef;
}

function buildTraceSequence(path: AggregateCandidatePath): ServicePassEntry[] {
  return path.nodeSequence.map((nodeRef, index) => ({
    orderIndex: index,
    passageType: "pass",
    stopType: "pass_through",
    stationRef: nodeRef,
    edgeRef: path.edgeSequence[Math.min(index, Math.max(0, path.edgeSequence.length - 1))] ?? ("" as EntityRef),
  }));
}

function buildPathSegments(aggregate: AggregateState, path: AggregateCandidatePath): ServicePathSegment[] {
  const edgesById = new Map(aggregate.topo.edges.map((edge) => [edge.id, edge] as const));
  return path.edgeSequence.map((edgeRef, orderIndex) => {
    const edge = edgesById.get(edgeRef);
    return {
      orderIndex,
      edgeRef,
      fromNodeRef: edge?.fromNodeRef,
      toNodeRef: edge?.toNodeRef,
      measureRange: { startMeasure: 0, endMeasure: 1 },
      distanceMeters: edge?.lengthMeters ?? 0,
      geometryRef: edge?.geometryRef,
    };
  });
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
