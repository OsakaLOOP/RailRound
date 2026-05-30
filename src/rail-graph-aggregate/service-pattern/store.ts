import type { IntentionChain } from "../../rail-graph-v1/chain.types";
import type { EntityRef } from "../../rail-graph-v1/primitives";
import type { ServicePattern } from "../../rail-graph-v1/service-template.types";
import { validateServicePatternShape } from "../../rail-graph-v1/service-template-validation";
import { readAggregateJson, writeAggregateJson } from "../storage";

export interface StoredServicePattern extends ServicePattern {
  intentionChain?: IntentionChain;
  createdAt?: string;
  updatedAt?: string;
  metadata?: {
    graphMode?: "no-direction-graph" | "compiled-topology";
    note?: string;
  };
}

export interface LoadServicePatternsArgs {
  aggregateKey: string;
  path?: string;
}

export async function loadServicePatterns(args: LoadServicePatternsArgs): Promise<StoredServicePattern[]> {
  const raw = await readAggregateJson<unknown>({
    aggregateKey: args.aggregateKey,
    file: "service-patterns.json",
    path: args.path,
  });
  const patterns = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { servicePatterns?: unknown[] }).servicePatterns)
      ? (raw as { servicePatterns: unknown[] }).servicePatterns
      : [];
  return patterns.map(validateStoredServicePattern);
}

export async function saveServicePatterns(args: {
  aggregateKey: string;
  patterns: StoredServicePattern[];
  path?: string;
}): Promise<void> {
  await writeAggregateJson({
    aggregateKey: args.aggregateKey,
    file: "service-patterns.json",
    path: args.path,
  }, args.patterns.map(validateStoredServicePattern));
}

export async function upsertServicePattern(args: {
  aggregateKey: string;
  pattern: StoredServicePattern;
}): Promise<StoredServicePattern[]> {
  let existing: StoredServicePattern[] = [];
  try {
    existing = await loadServicePatterns({ aggregateKey: args.aggregateKey });
  } catch {
    existing = [];
  }
  const now = new Date().toISOString();
  const nextPattern = validateStoredServicePattern({
    ...args.pattern,
    updatedAt: now,
    createdAt: args.pattern.createdAt ?? now,
  });
  const idx = existing.findIndex((pattern) => pattern.patternId === nextPattern.patternId);
  const next = idx >= 0
    ? existing.map((pattern, index) => index === idx ? nextPattern : pattern)
    : [...existing, nextPattern];
  await saveServicePatterns({ aggregateKey: args.aggregateKey, patterns: next });
  return next;
}

export async function deleteServicePattern(args: {
  aggregateKey: string;
  patternId: EntityRef;
}): Promise<StoredServicePattern[]> {
  const existing = await loadServicePatterns({ aggregateKey: args.aggregateKey });
  const next = existing.filter((pattern) => pattern.patternId !== args.patternId);
  await saveServicePatterns({ aggregateKey: args.aggregateKey, patterns: next });
  return next;
}

export function validateStoredServicePattern(value: unknown): StoredServicePattern {
  return validateServicePatternShape(value) as StoredServicePattern;
}
