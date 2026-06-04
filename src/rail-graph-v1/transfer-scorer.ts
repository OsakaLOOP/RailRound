import type { BaseTopologyRelation } from "./base-topology.types";
import type { EntityRef } from "./primitives";

export const DEFAULT_TRANSFER_COST_METERS = 300;
export const DEFAULT_TRANSFER_MINUTE_COST_METERS = 80;

export interface TransferScoringRelation {
  id?: string;
  fromPatternRef?: EntityRef;
  toPatternRef?: EntityRef;
  stationRef?: EntityRef;
  bidirectional?: boolean;
  forbidden?: boolean;
  samePlatform?: boolean;
  walkMinutes?: number;
  waitMinutes?: number;
  penaltyMeters?: number;
  transferMode?: "alight" | "through";
  reason?: string;
}

export interface TransferScoringPolicy {
  defaultCostMeters?: number;
  minuteCostMeters?: number;
  relations?: TransferScoringRelation[];
}

export interface TransferScore {
  allowed: boolean;
  stationRef: EntityRef;
  fromPatternRef: EntityRef;
  toPatternRef: EntityRef;
  costMeters: number;
  walkMinutes: number;
  waitMinutes: number;
  transferMode: "alight" | "through";
  reason?: string;
  relationId?: string;
}

export function scoreTransfer(args: {
  policy?: TransferScoringPolicy;
  fromPatternRef: EntityRef;
  toPatternRef: EntityRef;
  stationRef: EntityRef;
}): TransferScore {
  const policy = args.policy ?? {};
  const relation = bestRelation(policy.relations ?? [], args);
  const baseCost = relation?.samePlatform
    ? 0
    : finiteOrDefault(policy.defaultCostMeters, DEFAULT_TRANSFER_COST_METERS);
  const minuteCost = finiteOrDefault(policy.minuteCostMeters, DEFAULT_TRANSFER_MINUTE_COST_METERS);
  const walkMinutes = finiteOrDefault(relation?.walkMinutes, 0);
  const waitMinutes = finiteOrDefault(relation?.waitMinutes, 0);
  const penaltyMeters = finiteOrDefault(relation?.penaltyMeters, 0);

  return {
    allowed: relation?.forbidden !== true,
    stationRef: args.stationRef,
    fromPatternRef: args.fromPatternRef,
    toPatternRef: args.toPatternRef,
    costMeters: Math.max(0, Math.round(baseCost + (walkMinutes + waitMinutes) * minuteCost + penaltyMeters)),
    walkMinutes,
    waitMinutes,
    transferMode: relation?.transferMode ?? "alight",
    reason: relation?.reason,
    relationId: relation?.id,
  };
}

export function mergeTransferScoringPolicies(
  ...policies: Array<TransferScoringPolicy | null | undefined>
): TransferScoringPolicy | undefined {
  const present = policies.filter((policy): policy is TransferScoringPolicy => !!policy);
  if (present.length === 0) return undefined;
  const merged: TransferScoringPolicy = {};
  for (const policy of present) {
    if (policy.defaultCostMeters !== undefined) merged.defaultCostMeters = policy.defaultCostMeters;
    if (policy.minuteCostMeters !== undefined) merged.minuteCostMeters = policy.minuteCostMeters;
  }
  merged.relations = present.flatMap((policy) => policy.relations ?? []);
  return merged;
}

export function transferPolicyFromTopologyRelations(
  relations: readonly BaseTopologyRelation[],
): TransferScoringPolicy | undefined {
  const transferRelations = relations
    .filter((relation) => relation.kind === "transfer")
    .map(transferRelationFromTopologyRelation)
    .filter((relation): relation is TransferScoringRelation => relation !== null);
  return transferRelations.length > 0 ? { relations: transferRelations } : undefined;
}

function transferRelationFromTopologyRelation(relation: BaseTopologyRelation): TransferScoringRelation | null {
  const payload = relation.payload ?? {};
  const stationRef = entityRef(payload.stationRef);
  return {
    id: relation.id,
    fromPatternRef: entityRef(payload.fromPatternRef) ?? relation.fromRef,
    toPatternRef: entityRef(payload.toPatternRef) ?? relation.toRef,
    stationRef,
    bidirectional: typeof payload.bidirectional === "boolean" ? payload.bidirectional : undefined,
    forbidden: typeof payload.forbidden === "boolean" ? payload.forbidden : undefined,
    samePlatform: typeof payload.samePlatform === "boolean" ? payload.samePlatform : undefined,
    walkMinutes: numberValue(payload.walkMinutes),
    waitMinutes: numberValue(payload.waitMinutes),
    penaltyMeters: numberValue(payload.penaltyMeters),
    transferMode: payload.transferMode === "through" ? "through" : payload.transferMode === "alight" ? "alight" : undefined,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
  };
}

function bestRelation(
  relations: readonly TransferScoringRelation[],
  args: { fromPatternRef: EntityRef; toPatternRef: EntityRef; stationRef: EntityRef },
): TransferScoringRelation | undefined {
  return relations
    .map((relation, index) => ({ relation, index, specificity: relationSpecificity(relation, args) }))
    .filter((entry) => entry.specificity >= 0)
    .sort((left, right) => right.specificity - left.specificity || right.index - left.index)[0]?.relation;
}

function relationSpecificity(
  relation: TransferScoringRelation,
  args: { fromPatternRef: EntityRef; toPatternRef: EntityRef; stationRef: EntityRef },
): number {
  let score = 0;
  if (relation.stationRef) {
    if (relation.stationRef !== args.stationRef) return -1;
    score += 2;
  }
  const hasPatternScope = !!relation.fromPatternRef || !!relation.toPatternRef;
  if (!hasPatternScope) return score;
  const bidirectional = relation.bidirectional !== false;
  const ordered = relation.fromPatternRef === args.fromPatternRef && relation.toPatternRef === args.toPatternRef;
  const reversed = bidirectional && relation.fromPatternRef === args.toPatternRef && relation.toPatternRef === args.fromPatternRef;
  if (!ordered && !reversed) return -1;
  return score + 4;
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function entityRef(value: unknown): EntityRef | undefined {
  return typeof value === "string" && value ? value as EntityRef : undefined;
}
