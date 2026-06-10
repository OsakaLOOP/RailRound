import type { EntityRef } from "../../rail-graph-v1/primitives";

export interface TransferRelation {
  patternA: EntityRef;
  patternB: EntityRef;
  sharedStations: EntityRef[];
}

export interface TransferGraph {
  transfers: TransferRelation[];
  byPatternId: Map<EntityRef, TransferRelation[]>;
}

export interface PatternHop {
  patternRef: EntityRef;
  fromStation: EntityRef;
  toStation: EntityRef;
  edgeSequence: EntityRef[];
  stationSequence: EntityRef[];
  direction: "forward" | "reverse";
}

export interface CrossPatternPath {
  hops: PatternHop[];
  transferStations: EntityRef[];
  totalTransferCostMeters: number;
}
