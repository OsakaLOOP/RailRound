import type { EntityRef } from "../../rail-graph-v1/primitives";
import type { StoredServicePattern } from "../service-pattern/store";
import type { TransferGraph, TransferRelation } from "./types";

export type { TransferGraph, TransferRelation } from "./types";

export function buildTransferGraph(patterns: StoredServicePattern[]): TransferGraph {
  const transfers: TransferRelation[] = [];
  const byPatternId = new Map<EntityRef, TransferRelation[]>();
  const stationSets = new Map<EntityRef, Set<EntityRef>>();

  for (const pattern of patterns) {
    stationSets.set(pattern.patternId, new Set(pattern.traceSequence.map((trace) => trace.stationRef)));
  }

  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      const a = patterns[i];
      const b = patterns[j];
      const aStations = stationSets.get(a.patternId) ?? new Set();
      const bStations = stationSets.get(b.patternId) ?? new Set();
      const sharedStations = [...aStations].filter((stationRef) => bStations.has(stationRef));
      if (sharedStations.length === 0) continue;
      const relation: TransferRelation = {
        patternA: a.patternId,
        patternB: b.patternId,
        sharedStations,
      };
      transfers.push(relation);
      push(byPatternId, a.patternId, relation);
      push(byPatternId, b.patternId, relation);
    }
  }

  return { transfers, byPatternId };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}
