import type {
  AnnotatedFeature,
  AnnotatedFeatureCollection,
  RailGraphAnnotation,
  RailGraphFeatureKind,
} from "../rail-graph-v1/annotation.types";
import type { GeoJSONGeometry, GeoJSONPosition } from "../rail-graph-v1/geojson";
import { dispatchRule, type PipelineReport, type RuleReport } from "../rail-graph-v1-mvp/rule-handlers";
import {
  loadWorkspaceState,
  readOverrides,
  readPipelineArtifact,
  type LineWorkspaceState,
  type MvpOverrideState,
  type MvpWorkspaceState,
} from "../rail-graph-v1-mvp/pipeline";
import { compileAggregateTopology } from "./topology-compiler";
import { coreId, fidOf, type AggregateFeatureCollection } from "./no-direction-graph";
import type { BaseTopologyLayer } from "../rail-graph-v1/base-topology.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";

export interface MvpImportWorkspaceSummary {
  key: string;
  companyName: string;
  lineName: string;
  lineDir: string;
  annotateStatus: string;
  compileStatus: string;
  hasSourcePath: boolean;
}

export interface CompiledWorkspaceImportResult {
  featureCollection: AggregateFeatureCollection;
  topo: BaseTopologyLayer;
  diagnostics: Diagnostic[];
  memberWorkspaceKeys: string[];
  perWorkspaceEdgeCount: Record<string, number>;
  importedFeatureCount: number;
  dedupedFeatureCount: number;
}

interface PipelineResult {
  passFids: Set<string>;
  passFeatures: AnnotatedFeature[];
  report: PipelineReport;
}

const ANNOTATION_OVERRIDES_KEY = "railround:senseki:annotation-overrides:v1";
const ANNOTATION_OVERRIDES_WORKSPACE_PREFIX = "railround:mvp:annotation-overrides:v1:";

export function listMvpImportWorkspaces(workspaceState = loadWorkspaceState()): MvpImportWorkspaceSummary[] {
  return Object.values(workspaceState.workspaces).map((workspace) => ({
    key: workspace.key,
    companyName: workspace.project.companyName,
    lineName: workspace.project.lineName,
    lineDir: workspace.project.lineDir,
    annotateStatus: workspace.progress.annotate?.status ?? "notStarted",
    compileStatus: workspace.progress.compile?.status ?? "notStarted",
    hasSourcePath: !!workspace.project.lineDir,
  }));
}

export async function importCompiledAggregateFromMvpWorkspaces(args: {
  memberWorkspaceKeys?: string[];
  workspaceState?: MvpWorkspaceState;
}): Promise<CompiledWorkspaceImportResult> {
  const workspaceState = args.workspaceState ?? loadWorkspaceState();
  const selectedKeys = args.memberWorkspaceKeys?.length
    ? args.memberWorkspaceKeys
    : Object.keys(workspaceState.workspaces);
  const workspaces = selectedKeys
    .map((key) => workspaceState.workspaces[key])
    .filter((workspace): workspace is LineWorkspaceState => !!workspace);

  if (workspaces.length === 0) {
    throw new Error("DATA NOT READY: no MVP member workspace is selected for aggregate import.");
  }

  const sources: Array<{ workspaceKey: string; features: AnnotatedFeature[]; report: PipelineReport }> = [];
  const diagnostics: Diagnostic[] = [];
  const perWorkspaceEdgeCount: Record<string, number> = {};

  for (const workspace of workspaces) {
    if (workspace.progress.annotate?.status !== "done") {
      diagnostics.push({
        level: "warn",
        code: "AGG_IMPORT_WORKSPACE_ANNOTATE_NOT_DONE",
        stage: "import",
        message: "Member workspace annotate step is not marked done.",
        context: {
          workspaceKey: workspace.key,
          annotateStatus: workspace.progress.annotate?.status ?? "notStarted",
        },
      });
    }

    const raw = await readPipelineArtifact(`${workspace.project.lineDir}\\matched_assets.geojson`);
    const source = normalizeFeatureCollection(raw);
    const rules = await readFilterRules(workspace);
    const overrides = await readCleanOverrides(workspace);
    const activeFilters = activeFiltersFor(workspace, rules);
    const activeLevels = {
      high: true,
      medium: true,
      low: true,
      ...(workspace.ui?.cleanLevels ?? {}),
    };
    const pipeline = runFilterPipeline(
      source.features,
      rules,
      activeFilters,
      activeLevels,
      workspace.ui?.cleanSearchQuery ?? "",
    );
    const keepSet = new Set(overrides.keep ?? []);
    const removeSet = new Set(overrides.remove ?? []);
    const cleaned = source.features.filter((feature) => {
      const fid = fidOfFeature(feature);
      if (keepSet.has(fid)) return true;
      if (removeSet.has(fid)) return false;
      return pipeline.passFids.has(fid);
    });
    const annotated = applyAnnotationOverrides(workspace, cleaned);
    const kindCounts = countRailGraphKinds(annotated);
    perWorkspaceEdgeCount[workspace.key] = countRailLineStrings(annotated);
    if ((kindCounts.track_geometry ?? 0) === 0) {
      throw new Error(
        `DATA NOT READY: workspace '${workspace.key}' has no track_geometry annotations after clean import. ` +
        "Open the MVP app, finish Annotate for this workspace, then retry aggregate import.",
      );
    }

    diagnostics.push({
      level: "info",
      code: "AGG_IMPORT_WORKSPACE_CLEANED",
      stage: "import",
      message: "Member workspace imported and cleaned.",
      context: {
        workspaceKey: workspace.key,
        sourceFeatures: source.features.length,
        cleanFeatures: annotated.length,
        railGraphKinds: kindCounts,
        pipelineOut: pipeline.passFeatures.length,
      },
    });
    sources.push({ workspaceKey: workspace.key, features: annotated, report: pipeline.report });
  }

  const merged = mergeFeatures(sources);
  const compiled = compileAggregateTopology({
    source: {
      type: "FeatureCollection",
      features: merged.features,
    },
  });
  diagnostics.push(...compiled.diagnostics);

  if (compiled.topo.edges.length === 0) {
    throw new Error("DATA NOT READY: aggregate compiled topology has no edges after member import.");
  }

  return {
    featureCollection: {
      type: "FeatureCollection",
      features: merged.features as AggregateFeatureCollection["features"],
    },
    topo: compiled.topo,
    diagnostics,
    memberWorkspaceKeys: sources.map((source) => source.workspaceKey),
    perWorkspaceEdgeCount,
    importedFeatureCount: sources.reduce((sum, source) => sum + source.features.length, 0),
    dedupedFeatureCount: merged.deduped,
  };
}

function runFilterPipeline(
  features: AnnotatedFeature[],
  rules: unknown[],
  activeFilters: Record<string, boolean>,
  activeLevels: Record<string, boolean>,
  searchQuery: string,
): PipelineResult {
  const startedAt = performanceNow();
  let passed = features.filter((feature) => {
    const props = feature.properties || {};
    const level = stringValue(props.match_level) || "low";
    if (activeLevels[level] === false) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matches = stringValue(props.name).toLowerCase().includes(query)
        || stringValue(props.nearest_station).toLowerCase().includes(query)
        || stringValue(props.osm_id).includes(query);
      if (!matches) return false;
    }
    return true;
  });

  const phaseReports: PipelineReport["phaseReports"] = [];
  const phaseMap = new Map<number, any[]>();
  for (const rule of rules as any[]) {
    if (!rule?.id || !activeFilters[rule.id]) continue;
    const phase = typeof rule.phase === "number" ? rule.phase : 1;
    if (!phaseMap.has(phase)) phaseMap.set(phase, []);
    phaseMap.get(phase)!.push(rule);
  }
  for (const list of phaseMap.values()) {
    list.sort((left, right) =>
      (typeof left.order === "number" ? left.order : 0)
      - (typeof right.order === "number" ? right.order : 0)
    );
  }

  for (const phase of [...phaseMap.keys()].sort((a, b) => a - b)) {
    const phaseRules = phaseMap.get(phase)!;
    const inSize = passed.length;
    const refCache = new Map<string, AnnotatedFeature[]>();
    const ruleReports: RuleReport[] = [];
    for (const rule of phaseRules) {
      const refPool = resolveRuleInputCached(rule, features, passed, refCache);
      const ruleInSize = passed.length;
      const ruleStartedAt = performanceNow();
      passed = passed.filter((feature) => dispatchRule(rule, feature, refPool));
      const elapsed = performanceNow() - ruleStartedAt;
      ruleReports.push({
        ruleId: rule.id ?? "?",
        ruleLabel: rule.label,
        phase,
        inSize: ruleInSize,
        outSize: passed.length,
        eliminated: ruleInSize - passed.length,
        refSize: refPool.length,
        ms: elapsed,
      });
    }
    phaseReports.push({ phase, inSize, outSize: passed.length, rules: ruleReports });
  }

  return {
    passFids: new Set(passed.map(fidOfFeature)),
    passFeatures: passed,
    report: {
      totalIn: features.length,
      totalOut: passed.length,
      totalMs: performanceNow() - startedAt,
      phaseReports,
    },
  };
}

function resolveRuleInputCached(
  rule: any,
  allFeatures: AnnotatedFeature[],
  passedSoFar: AnnotatedFeature[],
  cache: Map<string, AnnotatedFeature[]>,
): AnnotatedFeature[] {
  const source = rule.input?.source ?? "all";
  const types: string[] = rule.input?.geometry_types ?? [];
  const key = `${source}|${types.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let pool = source === "passed_lower_phase" ? passedSoFar : allFeatures;
  if (types.length > 0) {
    pool = pool.filter((feature) => types.includes(feature.geometry?.type ?? ""));
  }
  cache.set(key, pool);
  return pool;
}

async function readFilterRules(workspace: LineWorkspaceState): Promise<unknown[]> {
  try {
    const raw = await readPipelineArtifact(`${workspace.project.scriptsRoot}\\filter_rules.json`);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function readCleanOverrides(workspace: LineWorkspaceState): Promise<MvpOverrideState> {
  try {
    return await readOverrides(workspace.project.overridePath);
  } catch {
    return {
      k: `${workspace.project.companyName}__${workspace.project.lineName}`,
      keep: [],
      remove: [],
      meta: {},
    };
  }
}

function activeFiltersFor(workspace: LineWorkspaceState, rules: unknown[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const rule of rules as any[]) {
    if (rule?.id) out[rule.id] = !!rule.default;
  }
  return {
    ...out,
    ...(workspace.ui?.cleanFilters ?? {}),
  };
}

function applyAnnotationOverrides(workspace: LineWorkspaceState, features: AnnotatedFeature[]): AnnotatedFeature[] {
  const overrides = loadAnnotationOverrides(workspace);
  if (Object.keys(overrides).length === 0) return features;
  return features.map((feature) => {
    const id = feature.properties.railGraph?.id;
    const override = id ? overrides[id] : undefined;
    if (!override) return feature;
    return applyAnnotationOverride(feature, override);
  });
}

function loadAnnotationOverrides(workspace: LineWorkspaceState): Record<string, RailGraphAnnotation> {
  if (typeof localStorage === "undefined") return {};
  try {
    const workspaceRaw = localStorage.getItem(`${ANNOTATION_OVERRIDES_WORKSPACE_PREFIX}${workspace.key}`);
    const workspaceOverrides = workspaceRaw ? JSON.parse(workspaceRaw) as Record<string, RailGraphAnnotation> : {};
    if (!shouldIncludeLegacyAnnotationOverrides(workspace)) return workspaceOverrides;
    const legacyRaw = localStorage.getItem(ANNOTATION_OVERRIDES_KEY);
    const legacyOverrides = legacyRaw ? JSON.parse(legacyRaw) as Record<string, RailGraphAnnotation> : {};
    return {
      ...legacyOverrides,
      ...workspaceOverrides,
    };
  } catch {
    return {};
  }
}

function shouldIncludeLegacyAnnotationOverrides(workspace: LineWorkspaceState): boolean {
  return workspace.project.selectedPresetId === "senseki" || workspace.project.lineName.includes("仙石線");
}

function applyAnnotationOverride(feature: AnnotatedFeature, annotation: RailGraphAnnotation): AnnotatedFeature {
  const targetReversed = !!annotation.track?.geometryReversed;
  const currentReversed = !!(feature as unknown as { _coordsReversed?: boolean })._coordsReversed;
  const shouldReverse = targetReversed !== currentReversed;
  const geometry = shouldReverse ? reverseGeometry(feature.geometry) : feature.geometry;
  const nextFeature: AnnotatedFeature = {
    ...feature,
    geometry,
    properties: {
      ...feature.properties,
      railGraph: annotation,
    },
  };
  (nextFeature as unknown as { _coordsReversed?: boolean })._coordsReversed = shouldReverse ? targetReversed : currentReversed;
  return nextFeature;
}

function reverseGeometry(geometry: GeoJSONGeometry): GeoJSONGeometry {
  if (geometry.type === "LineString") {
    return { ...geometry, coordinates: [...geometry.coordinates].reverse() };
  }
  if (geometry.type === "MultiLineString") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line) => [...line].reverse()),
    };
  }
  return geometry;
}

function mergeFeatures(
  sources: Array<{ workspaceKey: string; features: AnnotatedFeature[] }>,
): { features: AnnotatedFeature[]; deduped: number } {
  const seen = new Set<string>();
  const features: AnnotatedFeature[] = [];
  let deduped = 0;
  for (const source of sources) {
    for (const feature of source.features) {
      const key = coreDedupeKey(feature, source.workspaceKey);
      if (seen.has(key)) {
        deduped += 1;
        continue;
      }
      seen.add(key);
      features.push(cloneFeature(feature));
    }
  }
  return { features, deduped };
}

function normalizeFeatureCollection(raw: unknown): AnnotatedFeatureCollection {
  if (!raw || typeof raw !== "object") {
    throw new Error("Expected FeatureCollection object.");
  }
  const maybe = raw as Partial<AnnotatedFeatureCollection>;
  if (maybe.type !== "FeatureCollection" || !Array.isArray(maybe.features)) {
    throw new Error("Expected FeatureCollection with features array.");
  }
  return {
    type: "FeatureCollection",
    features: maybe.features.map((feature, index) => normalizeFeature(feature as AnnotatedFeature, index)),
  };
}

function normalizeFeature(feature: AnnotatedFeature, index: number): AnnotatedFeature {
  return {
    ...feature,
    properties: {
      ...feature.properties,
      railGraph: normalizeAnnotation(feature, index),
    },
  };
}

function normalizeAnnotation(feature: AnnotatedFeature, index: number): RailGraphAnnotation {
  const existing = feature.properties?.railGraph;
  if (existing?.kind) {
    const id = existing.id !== undefined && existing.id !== null ? String(existing.id) : "";
    return {
      ...existing,
      schemaVersion: "rail-graph-v1",
      source: existing.source ?? "manual",
      id: id || stableFeatureId(feature, index),
    };
  }
  return {
    kind: "unknown",
    schemaVersion: "rail-graph-v1",
    id: stableFeatureId(feature, index),
    source: "manual",
  };
}

function stableFeatureId(feature: AnnotatedFeature, index: number): string {
  return stableId("manual", "feature", `${index}:${feature.geometry?.type || "unknown"}`);
}

function countRailGraphKinds(features: AnnotatedFeature[]): Partial<Record<RailGraphFeatureKind, number>> {
  const out: Partial<Record<RailGraphFeatureKind, number>> = {};
  for (const feature of features) {
    const kind = feature.properties.railGraph?.kind;
    if (kind) out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}

function countRailLineStrings(features: AnnotatedFeature[]): number {
  let count = 0;
  for (const feature of features) {
    const props = feature.properties || {};
    if (stringValue(props.class_main) !== "rail") continue;
    if (feature.geometry.type === "LineString") count += 1;
    if (feature.geometry.type === "MultiLineString") count += feature.geometry.coordinates.length;
  }
  return count;
}

function coreDedupeKey(feature: AnnotatedFeature, workspaceKey: string): string {
  const key = coreId(feature as AggregateFeatureCollection["features"][number]);
  if (key && key !== "::") return key;
  return `fallback:${workspaceKey}:${fidOfFeature(feature)}`;
}

function fidOfFeature(feature: AnnotatedFeature): string {
  const props = feature.properties || {};
  if (typeof props._fid === "string" && props._fid.length > 0) return props._fid;
  const fid = fidOf(feature as AggregateFeatureCollection["features"][number]);
  props._fid = fid;
  return fid;
}

function cloneFeature(feature: AnnotatedFeature): AnnotatedFeature {
  return JSON.parse(JSON.stringify(feature)) as AnnotatedFeature;
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function stableId(source: string, entityType: string, value: string): string {
  return `${source}:${entityType}:${slug(String(value))}`;
}

function slug(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "id"}-${hash.toString(16)}`;
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}
