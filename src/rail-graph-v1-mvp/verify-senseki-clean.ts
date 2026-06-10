import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { dispatchRule } from "./rule-handlers";
import { SENSEKI_RAIL, SENSEKI_STATIONS } from "./senseki-data";

type Feature = {
  type: "Feature";
  id?: string | number;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, any>;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

type Rule = {
  id?: string;
  label?: string;
  desc?: string;
  default?: boolean;
  phase?: number;
  order?: number;
  input?: {
    source?: "all" | "passed_lower_phase";
    geometry_types?: string[];
  };
  handler?: unknown;
  exclude_if?: unknown;
  dynamic?: unknown;
  post_filter?: unknown;
};

type DiffSide = "actual_extra" | "reference_missing";
type DiffClassification = "exception" | "manual_required" | "rule_gap" | "false_delete";

interface RuleHitRecord {
  id: string;
  ruleId: string;
  ruleLabel: string;
  phase: number;
  geometryType: string;
  kind: string;
  classMain: string;
  railway: string;
  name: string;
  nearestStation: string;
  evidence: Record<string, unknown>;
}

interface RuleRunReport {
  ruleId: string;
  ruleLabel: string;
  phase: number;
  inSize: number;
  outSize: number;
  eliminated: number;
  refSize: number;
  ms: number;
  independentEliminatedInPhase: number;
  hits: RuleHitRecord[];
}

interface VerifyOptions {
  referencePath: string;
  rulesPath: string;
  outDir: string;
  diffLimit: number;
}

const DEFAULT_REFERENCE_PATH = "D:\\Downloads\\senseki-demo-2026-05-20T00-15-43.railround.json";
const DEFAULT_RULES_PATH = "D:\\GIS\\scripts\\filter_rules.json";
const DEFAULT_OUT_DIR = path.resolve("src", "rail-graph-v1-mvp", ".verify");
const DEFAULT_DIFF_LIMIT = 5;

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outDir, { recursive: true });

  const inputFeatures = normalizeFeatures([
    ...SENSEKI_RAIL.features as Feature[],
    ...SENSEKI_STATIONS.features as Feature[],
  ]);
  const referenceSnapshot = readJson<Record<string, any>>(options.referencePath);
  const referenceFeatures = normalizeFeatures(readFixedReferenceFeatures(referenceSnapshot, options.referencePath));
  const rules = readJson<Rule[]>(options.rulesPath);

  if (!Array.isArray(rules)) {
    throw new Error(`Rules file must be a JSON array: ${options.rulesPath}`);
  }

  const inputSummary = summarizeFeatures(inputFeatures, {
    source: "SENSEKI_RAIL + SENSEKI_STATIONS",
    railFeatures: SENSEKI_RAIL.features.length,
    stationFeatures: SENSEKI_STATIONS.features.length,
  });
  writeReport(options, "senseki-00-input-summary.json", inputSummary);

  const referenceShape = {
    referenceKind: "fixed:snapshot.source.features",
    referencePath: options.referencePath,
    schemaVersion: referenceSnapshot.schemaVersion ?? null,
    exportedAt: referenceSnapshot.exportedAt ?? null,
    sourceFeatureCount: referenceFeatures.length,
    overridesCount: countObjectKeys(referenceSnapshot.overrides),
    topologySummary: referenceSnapshot.topologySummary?.counts ?? null,
    summary: summarizeFeatures(referenceFeatures),
  };
  writeReport(options, "senseki-01-reference-shape.json", referenceShape);

  const pipeline = runVerificationPipeline(inputFeatures, rules);
  writeReport(options, "senseki-02-rule-hits.json", {
    rulesPath: options.rulesPath,
    activeRuleCount: pipeline.ruleReports.length,
    totalIn: inputFeatures.length,
    totalOut: pipeline.finalFeatures.length,
    phaseReports: pipeline.phaseReports,
    ruleReports: pipeline.ruleReports,
  });

  const conflicts = findRuleConflicts(pipeline.conflictHits);
  writeReport(options, "senseki-03-rule-conflicts.json", {
    conflictCount: conflicts.length,
    conflicts,
  });

  const finalResidual = {
    count: pipeline.finalFeatures.length,
    summary: summarizeFeatures(pipeline.finalFeatures),
    ids: pipeline.finalFeatures.map(featureId).sort(),
    features: pipeline.finalFeatures.map(compactFeature),
  };
  writeReport(options, "senseki-04-final-residual.json", finalResidual);

  const referenceMatch = compareFeatureSets(pipeline.finalFeatures, referenceFeatures);
  writeReport(options, "senseki-05-reference-match.json", referenceMatch);

  const diffClassification = classifyDiffs(referenceMatch, pipeline.finalById, referenceFeatures);
  writeReport(options, "senseki-06-diff-classification.json", diffClassification);

  const pass = isPass({
    diffLimit: options.diffLimit,
    referenceMatch,
    diffClassification,
    conflictCount: conflicts.length,
  });

  const summary = {
    status: pass ? "PASS" : "FAIL",
    referenceKind: "fixed:snapshot.source.features",
    referencePath: options.referencePath,
    rulesPath: options.rulesPath,
    inputObjects: inputFeatures.length,
    referenceObjects: referenceFeatures.length,
    finalResidualObjects: pipeline.finalFeatures.length,
    diffTotal: referenceMatch.diffTotal,
    ignoredExceptions: diffClassification.counts.exception,
    diffAfterExceptions: diffClassification.diffAfterExceptions,
    manualRequired: diffClassification.counts.manual_required,
    falseDelete: diffClassification.counts.false_delete,
    ruleGap: diffClassification.counts.rule_gap,
    ruleConflicts: conflicts.length,
    reports: reportNames().map((name) => path.join(options.outDir, name)),
  };
  writeReport(options, "senseki-clean-diff.json", summary);
  writeReport(options, "senseki-clean-diff.md", renderMarkdown(summary, referenceShape, diffClassification));

  printSummary(summary);
  if (!pass) process.exitCode = 1;
}

function parseArgs(args: string[]): VerifyOptions {
  const options: VerifyOptions = {
    referencePath: DEFAULT_REFERENCE_PATH,
    rulesPath: DEFAULT_RULES_PATH,
    outDir: DEFAULT_OUT_DIR,
    diffLimit: DEFAULT_DIFF_LIMIT,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--reference" && next) {
      options.referencePath = next;
      i += 1;
    } else if (arg === "--rules" && next) {
      options.rulesPath = next;
      i += 1;
    } else if (arg === "--out" && next) {
      options.outDir = next;
      i += 1;
    } else if (arg === "--diff-limit" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --diff-limit: ${next}`);
      options.diffLimit = parsed;
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readFixedReferenceFeatures(snapshot: Record<string, any>, referencePath: string): Feature[] {
  const features = snapshot.source?.features;
  if (!Array.isArray(features)) {
    throw new Error(`Fixed reference ${referencePath} must contain source.features array.`);
  }
  return features as Feature[];
}

function normalizeFeatures(features: Feature[]): Feature[] {
  return features.map((feature, index) => {
    const sourceTags = feature.properties?.sourceTags && typeof feature.properties.sourceTags === "object"
      ? feature.properties.sourceTags
      : {};
    const properties = {
      ...sourceTags,
      ...(feature.properties ?? {}),
    };
    properties.sourceTags = sourceTags;
    const normalized: Feature = {
      ...feature,
      properties,
    };
    properties._verifyId = featureId(normalized, index);
    return normalized;
  });
}

function runVerificationPipeline(features: Feature[], rules: Rule[]) {
  const sortedRules = rules
    .map((rule, index) => ({
      rule,
      index,
      phase: typeof rule.phase === "number" ? rule.phase : 1,
      order: typeof rule.order === "number" ? rule.order : 0,
    }))
    .sort((a, b) => a.phase - b.phase || a.order - b.order || a.index - b.index);

  let passed = [...features];
  const ruleReports: RuleRunReport[] = [];
  const phaseReports: Array<{ phase: number; inSize: number; outSize: number; rules: string[] }> = [];
  const conflictHits: RuleHitRecord[] = [];

  for (const phase of [...new Set(sortedRules.map((entry) => entry.phase))]) {
    const phaseRules = sortedRules.filter((entry) => entry.phase === phase);
    const phaseInSize = passed.length;
    const phaseInput = [...passed];
    const refCache = new Map<string, Feature[]>();
    const ruleIds: string[] = [];

    for (const { rule } of phaseRules) {
      const ruleId = rule.id ?? "(missing-rule-id)";
      const refPool = resolveRuleInputCached(rule, features, passed, refCache);
      const independentHits = phaseInput
        .filter((feature) => !dispatchRule(rule, feature as any, refPool as any))
        .map((feature) => ruleHitRecord(feature, rule, phase));
      conflictHits.push(...independentHits);

      const inFeatures = passed;
      const t0 = performance.now();
      const hits: RuleHitRecord[] = [];
      const outFeatures: Feature[] = [];

      for (const feature of inFeatures) {
        const keep = dispatchRule(rule, feature as any, refPool as any);
        if (keep) outFeatures.push(feature);
        else hits.push(ruleHitRecord(feature, rule, phase));
      }

      const ms = performance.now() - t0;
      passed = outFeatures;
      ruleReports.push({
        ruleId,
        ruleLabel: rule.label ?? "",
        phase,
        inSize: inFeatures.length,
        outSize: outFeatures.length,
        eliminated: hits.length,
        refSize: refPool.length,
        ms,
        independentEliminatedInPhase: independentHits.length,
        hits,
      });
      ruleIds.push(ruleId);
    }

    phaseReports.push({ phase, inSize: phaseInSize, outSize: passed.length, rules: ruleIds });
  }

  return {
    finalFeatures: passed,
    finalById: new Map(passed.map((feature) => [featureId(feature), feature] as const)),
    ruleReports,
    phaseReports,
    conflictHits,
  };
}

function resolveRuleInputCached(
  rule: Rule,
  allFeatures: Feature[],
  passedSoFar: Feature[],
  cache: Map<string, Feature[]>,
): Feature[] {
  const source = rule.input?.source ?? "all";
  const geometryTypes = rule.input?.geometry_types ?? [];
  const key = `${source}|${geometryTypes.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let pool = source === "passed_lower_phase" ? passedSoFar : allFeatures;
  if (geometryTypes.length > 0) {
    pool = pool.filter((feature) => geometryTypes.includes(feature.geometry?.type ?? ""));
  }
  cache.set(key, pool);
  return pool;
}

function findRuleConflicts(ruleHits: RuleHitRecord[]) {
  const byFeature = new Map<string, RuleHitRecord[]>();
  for (const hit of ruleHits) {
    const list = byFeature.get(hit.id) ?? [];
    list.push(hit);
    byFeature.set(hit.id, list);
  }
  return [...byFeature.entries()]
    .filter(([, hits]) => hits.length > 1)
    .map(([id, hits]) => ({
      id,
      ruleIds: hits.map((hit) => hit.ruleId),
      hits,
    }));
}

function compareFeatureSets(actual: Feature[], reference: Feature[]) {
  const actualIds = new Set(actual.map(featureId));
  const referenceIds = new Set(reference.map(featureId));
  const common = [...actualIds].filter((id) => referenceIds.has(id)).sort();
  const actualOnly = [...actualIds].filter((id) => !referenceIds.has(id)).sort();
  const referenceOnly = [...referenceIds].filter((id) => !actualIds.has(id)).sort();
  return {
    actualCount: actualIds.size,
    referenceCount: referenceIds.size,
    commonCount: common.length,
    actualOnlyCount: actualOnly.length,
    referenceOnlyCount: referenceOnly.length,
    diffTotal: actualOnly.length + referenceOnly.length,
    common,
    actualOnly,
    referenceOnly,
  };
}

function classifyDiffs(
  referenceMatch: ReturnType<typeof compareFeatureSets>,
  actualById: Map<string, Feature>,
  referenceFeatures: Feature[],
) {
  const referenceById = new Map(referenceFeatures.map((feature) => [featureId(feature), feature] as const));
  const diffs = [
    ...referenceMatch.actualOnly.map((id) => classifyDiff(id, "actual_extra", actualById.get(id))),
    ...referenceMatch.referenceOnly.map((id) => classifyDiff(id, "reference_missing", referenceById.get(id))),
  ];
  const counts: Record<DiffClassification, number> = {
    exception: 0,
    manual_required: 0,
    rule_gap: 0,
    false_delete: 0,
  };
  for (const diff of diffs) counts[diff.classification] += 1;
  return {
    counts,
    diffAfterExceptions: diffs.filter((diff) => diff.classification !== "exception").length,
    diffs,
  };
}

function classifyDiff(id: string, side: DiffSide, feature?: Feature) {
  const summary = feature ? compactFeature(feature) : null;
  if (feature && isKnownException(feature)) {
    return {
      id,
      side,
      classification: "exception" as const,
      reason: "Known acceptance exception: Ishinomaki-area platforms or manually accepted hard-to-semanticize branch/siding objects.",
      feature: summary,
    };
  }

  if (side === "reference_missing") {
    return {
      id,
      side,
      classification: "false_delete" as const,
      reason: "Object exists in the fixed manual reference source.features but was removed by automatic clean rules.",
      feature: summary,
    };
  }

  if (feature && isManualRequiredCandidate(feature)) {
    return {
      id,
      side,
      classification: "manual_required" as const,
      reason: "Ambiguous residual object: available tags and geometry do not provide a high-confidence automatic removal reason.",
      feature: summary,
    };
  }

  return {
    id,
    side,
    classification: "rule_gap" as const,
    reason: "Automatic clean rules left an object that is absent from the fixed manual reference.",
    feature: summary,
  };
}

function isKnownException(feature: Feature): boolean {
  const text = [
    prop(feature, "name"),
    prop(feature, "name:ja"),
    prop(feature, "nearest_station"),
    prop(feature, "station"),
  ].join(" ");
  if (text.includes("石巻")) return true;

  const service = prop(feature, "service");
  const kind = kindOf(feature);
  const classMain = prop(feature, "class_main");
  return (kind === "track_geometry" || classMain === "rail")
    && ["spur", "siding", "yard"].includes(service)
    && Number(prop(feature, "match_score") || 0) > 0.5;
}

function isManualRequiredCandidate(feature: Feature): boolean {
  const classMain = prop(feature, "class_main");
  const railway = prop(feature, "railway");
  const kind = kindOf(feature);
  const hasLineName = !!(prop(feature, "name") || prop(feature, "name:ja") || prop(feature, "name:en") || prop(feature, "KSJ2:LIN"));
  const hasOperator = !!prop(feature, "operator");
  const isPoint = feature.geometry?.type === "Point";
  const pointKinds = new Set([
    "switch_point",
    "signal_point",
    "station_point",
    "station_entrance",
    "unknown",
  ]);
  const ambiguousRailway = new Set([
    "switch",
    "railway_crossing",
    "level_crossing",
    "crossing",
    "buffer_stop",
    "stop",
    "signal",
    "subway_entrance",
  ]);
  return isPoint
    && (pointKinds.has(kind) || ambiguousRailway.has(railway) || ambiguousRailway.has(classMain))
    && !hasLineName
    && !hasOperator;
}

function isPass(input: {
  diffLimit: number;
  referenceMatch: ReturnType<typeof compareFeatureSets>;
  diffClassification: ReturnType<typeof classifyDiffs>;
  conflictCount: number;
}): boolean {
  const counts = input.diffClassification.counts;
  return input.diffClassification.diffAfterExceptions < input.diffLimit
    && counts.false_delete === 0
    && counts.rule_gap === 0
    && input.conflictCount === 0;
}

function summarizeFeatures(features: Feature[], extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    count: features.length,
    geometryTypes: countBy(features, (feature) => feature.geometry?.type ?? "(missing)"),
    railGraphKinds: countBy(features, kindOf),
    classMain: countBy(features, (feature) => prop(feature, "class_main") || "(missing)"),
    railway: countBy(features, (feature) => prop(feature, "railway") || "(missing)"),
    matchLevel: countBy(features, (feature) => prop(feature, "match_level") || "(missing)"),
  };
}

function compactFeature(feature: Feature) {
  return {
    id: featureId(feature),
    geometryType: feature.geometry?.type ?? "(missing)",
    kind: kindOf(feature),
    classMain: prop(feature, "class_main"),
    railway: prop(feature, "railway"),
    publicTransport: prop(feature, "public_transport"),
    service: prop(feature, "service"),
    operator: prop(feature, "operator"),
    name: prop(feature, "name"),
    nearestStation: prop(feature, "nearest_station"),
    matchLevel: prop(feature, "match_level"),
    matchScore: prop(feature, "match_score"),
  };
}

function ruleHitRecord(feature: Feature, rule: Rule, phase: number): RuleHitRecord {
  return {
    id: featureId(feature),
    ruleId: rule.id ?? "(missing-rule-id)",
    ruleLabel: rule.label ?? "",
    phase,
    geometryType: feature.geometry?.type ?? "(missing)",
    kind: kindOf(feature),
    classMain: prop(feature, "class_main"),
    railway: prop(feature, "railway"),
    name: prop(feature, "name"),
    nearestStation: prop(feature, "nearest_station"),
    evidence: {
      service: prop(feature, "service"),
      operator: prop(feature, "operator"),
      gauge: prop(feature, "gauge"),
      highspeed: prop(feature, "highspeed"),
      matchLevel: prop(feature, "match_level"),
      matchScore: prop(feature, "match_score"),
      sourceLineName: prop(feature, "source_line_name"),
    },
  };
}

function featureId(feature: Feature, fallbackIndex?: number): string {
  const props = feature.properties ?? {};
  const railGraphId = props.railGraph?.id;
  if (railGraphId !== undefined && railGraphId !== null && String(railGraphId)) return String(railGraphId);
  if (props._verifyId && fallbackIndex === undefined) return String(props._verifyId);
  if (props._fid) return String(props._fid);
  const osmType = props.osm_type ?? props.sourceTags?.osm_type ?? "";
  const osmId = props.osm_id ?? props.sourceTags?.osm_id ?? "";
  const classMain = props.class_main ?? props.sourceTags?.class_main ?? "";
  const sourceLineName = props.source_line_name ?? props.sourceTags?.source_line_name ?? "";
  if (osmType || osmId) return `${osmType}:${osmId}:${classMain}:${sourceLineName}`;
  if (feature.id !== undefined && feature.id !== null) return String(feature.id);
  return `fallback:${fallbackIndex ?? "unknown"}`;
}

function kindOf(feature: Feature): string {
  return prop(feature, "railGraph.kind") || prop(feature, "kind") || "(missing)";
}

function prop(feature: Feature, key: string): string {
  const props = feature.properties ?? {};
  if (key.includes(".")) {
    const value = key.split(".").reduce<any>((acc, part) => acc?.[part], props);
    return value === undefined || value === null ? "" : String(value);
  }
  const value = props[key] ?? props.sourceTags?.[key];
  return value === undefined || value === null ? "" : String(value);
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function countObjectKeys(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function writeReport(options: VerifyOptions, name: string, data: unknown): void {
  const outPath = path.join(options.outDir, name);
  const text = typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(outPath, text, "utf8");
}

function reportNames(): string[] {
  return [
    "senseki-00-input-summary.json",
    "senseki-01-reference-shape.json",
    "senseki-02-rule-hits.json",
    "senseki-03-rule-conflicts.json",
    "senseki-04-final-residual.json",
    "senseki-05-reference-match.json",
    "senseki-06-diff-classification.json",
    "senseki-clean-diff.json",
    "senseki-clean-diff.md",
  ];
}

function renderMarkdown(
  summary: Record<string, any>,
  referenceShape: Record<string, any>,
  diffClassification: ReturnType<typeof classifyDiffs>,
): string {
  const topDiffs = diffClassification.diffs.slice(0, 30);
  return [
    `# Senseki Clean Verify: ${summary.status}`,
    "",
    `- reference: ${summary.referenceKind}`,
    `- reference path: ${summary.referencePath}`,
    `- exportedAt: ${referenceShape.exportedAt ?? "(missing)"}`,
    `- input objects: ${summary.inputObjects}`,
    `- reference objects: ${summary.referenceObjects}`,
    `- final residual objects: ${summary.finalResidualObjects}`,
    `- diff total: ${summary.diffTotal}`,
    `- ignored exceptions: ${summary.ignoredExceptions}`,
    `- diff after exceptions: ${summary.diffAfterExceptions}`,
    `- manual_required: ${summary.manualRequired}`,
    `- false_delete: ${summary.falseDelete}`,
    `- rule_gap: ${summary.ruleGap}`,
    `- rule_conflicts: ${summary.ruleConflicts}`,
    "",
    "## Reference Shape",
    "",
    "```json",
    JSON.stringify(referenceShape.summary, null, 2),
    "```",
    "",
    "## First Diffs",
    "",
    topDiffs.length === 0
      ? "No diffs."
      : topDiffs.map((diff) => `- ${diff.classification} ${diff.side} ${diff.id}: ${diff.reason}`).join("\n"),
    "",
  ].join("\n");
}

function printSummary(summary: Record<string, any>): void {
  console.log(`SENSEKI CLEAN VERIFY: ${summary.status}`);
  console.log("");
  console.log(`reference_kind: ${summary.referenceKind}`);
  console.log(`input_objects: ${summary.inputObjects}`);
  console.log(`reference_objects: ${summary.referenceObjects}`);
  console.log(`final_residual_objects: ${summary.finalResidualObjects}`);
  console.log(`diff_total: ${summary.diffTotal}`);
  console.log(`ignored_exceptions: ${summary.ignoredExceptions}`);
  console.log(`diff_after_exceptions: ${summary.diffAfterExceptions}`);
  console.log(`manual_required: ${summary.manualRequired}`);
  console.log(`false_delete: ${summary.falseDelete}`);
  console.log(`rule_gap: ${summary.ruleGap}`);
  console.log(`rule_conflicts: ${summary.ruleConflicts}`);
  console.log("");
  console.log("reports:");
  for (const report of summary.reports) console.log(report);
}

main();
