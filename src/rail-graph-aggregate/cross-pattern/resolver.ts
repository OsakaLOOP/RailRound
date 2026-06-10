import type { EntityRef } from "../../rail-graph-v1/primitives";
import type { StoredServicePattern } from "../service-pattern/store";
import { buildTransferGraph } from "./transfer-graph";
import type { CrossPatternPath, PatternHop, TransferGraph } from "./types";

export type { CrossPatternPath, PatternHop } from "./types";

export const TRANSFER_COST_METERS = 300;

export interface ResolveCrossPatternArgs {
  patterns: StoredServicePattern[];
  transferGraph?: TransferGraph;
  from: EntityRef | string;
  to: EntityRef | string;
}

export function resolveCrossPattern(args: ResolveCrossPatternArgs): CrossPatternPath | null {
  const from = args.from as EntityRef;
  const to = args.to as EntityRef;
  const transferGraph = args.transferGraph ?? buildTransferGraph(args.patterns);
  const queryPatterns = preferIndependentPatterns(args.patterns, from, to);
  const allowedPatternIds = new Set(queryPatterns.map((pattern) => pattern.patternId));
  const patternsById = new Map(queryPatterns.map((pattern) => [pattern.patternId, pattern] as const));
  const startPatterns = queryPatterns.filter((pattern) => stationsOf(pattern).includes(from));
  const targetPatterns = queryPatterns.filter((pattern) => stationsOf(pattern).includes(to));
  if (startPatterns.length === 0 || targetPatterns.length === 0) return null;

  interface SearchState {
    patternId: EntityRef;
    currentStation: EntityRef;
    hops: PatternHop[];
    transferStations: EntityRef[];
    visitedPatternIds: EntityRef[];
    cost: number;
  }

  const queue: SearchState[] = startPatterns.map((pattern) => ({
    patternId: pattern.patternId,
    currentStation: from,
    hops: [],
    transferStations: [],
    visitedPatternIds: [pattern.patternId],
    cost: 0,
  }));
  const best = new Map<string, number>();
  let bestPath: CrossPatternPath | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (current.cost >= bestCost) continue;

    const currentKey = `${current.patternId}::${current.currentStation}`;
    const prevBest = best.get(currentKey);
    if (prevBest !== undefined && prevBest <= current.cost) continue;
    best.set(currentKey, current.cost);

    const currentPattern = patternsById.get(current.patternId);
    if (!currentPattern) continue;

    if (stationsOf(currentPattern).includes(to)) {
      const finalHop = slicePatternHop(currentPattern, current.currentStation, to);
      const finalCost = current.cost + hopCost(finalHop);
      if (finalCost < bestCost) {
        bestCost = finalCost;
        bestPath = {
          hops: [...current.hops, finalHop],
          transferStations: current.transferStations,
          totalTransferCostMeters: current.transferStations.length * TRANSFER_COST_METERS,
        };
      }
    }

    for (const relation of transferGraph.byPatternId.get(current.patternId) ?? []) {
      const nextPattern = relation.patternA === current.patternId ? relation.patternB : relation.patternA;
      if (!allowedPatternIds.has(nextPattern)) continue;
      if (current.visitedPatternIds.includes(nextPattern)) continue;
      for (const transferStation of relation.sharedStations) {
        if (!stationsOf(currentPattern).includes(transferStation)) continue;
        const currentHop = slicePatternHop(currentPattern, current.currentStation, transferStation);
        const nextCost = current.cost + hopCost(currentHop) + TRANSFER_COST_METERS;
        if (nextCost >= bestCost) continue;
        queue.push({
          patternId: nextPattern,
          currentStation: transferStation,
          hops: [...current.hops, currentHop],
          transferStations: [...current.transferStations, transferStation],
          visitedPatternIds: [...current.visitedPatternIds, nextPattern],
          cost: nextCost,
        });
      }
    }
  }

  return bestPath;
}

function preferIndependentPatterns(
  patterns: StoredServicePattern[],
  from: EntityRef,
  to: EntityRef,
): StoredServicePattern[] {
  const independent = patterns.filter((pattern) => !isThroughPattern(pattern));
  const hasIndependentStart = independent.some((pattern) => stationsOf(pattern).includes(from));
  const hasIndependentTarget = independent.some((pattern) => stationsOf(pattern).includes(to));
  return hasIndependentStart && hasIndependentTarget ? independent : patterns;
}

function isThroughPattern(pattern: StoredServicePattern): boolean {
  const text = `${pattern.patternId} ${pattern.displayName ?? ""} ${pattern.lineRef}`.toLowerCase();
  return text.includes("through") || text.includes("直通") || text.includes("senseki-tohoku");
}

function slicePatternHop(pattern: StoredServicePattern, fromStation: EntityRef, toStation: EntityRef): PatternHop {
  const stationSequence = stationsOf(pattern);
  const fromIdx = stationSequence.indexOf(fromStation);
  const toIdx = stationSequence.indexOf(toStation);
  if (fromIdx < 0 || toIdx < 0) {
    throw new Error(`Pattern ${pattern.patternId} does not contain requested station slice.`);
  }

  if (fromIdx <= toIdx) {
    return {
      patternRef: pattern.patternId,
      fromStation,
      toStation,
      edgeSequence: pattern.edgeSequence.slice(fromIdx, Math.max(fromIdx, toIdx)),
      stationSequence: stationSequence.slice(fromIdx, toIdx + 1),
      direction: "forward",
    };
  }

  return {
    patternRef: pattern.patternId,
    fromStation,
    toStation,
    edgeSequence: pattern.edgeSequence.slice(toIdx, Math.max(toIdx, fromIdx)).reverse(),
    stationSequence: stationSequence.slice(toIdx, fromIdx + 1).reverse(),
    direction: "reverse",
  };
}

function stationsOf(pattern: StoredServicePattern): EntityRef[] {
  return pattern.traceSequence.map((trace) => trace.stationRef);
}

function hopCost(hop: PatternHop): number {
  return hop.edgeSequence.length;
}
