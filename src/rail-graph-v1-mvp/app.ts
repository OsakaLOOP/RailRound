import type {
  AnnotatedFeature,
  AnnotatedFeatureCollection,
  RailGraphAnnotation,
  RailGraphFeatureKind,
} from "../rail-graph-v1/annotation.types";
import type {
  BaseTopologyLayer,
  PlatformTrackBinding,
  StoppingPoint,
  TopologyEdge,
  TopologyNode,
} from "../rail-graph-v1/base-topology.types";
import type { Diagnostic, DiagnosticLevel } from "../rail-graph-v1/diagnostic-types";
import type {
  PlatformTrackBindingInput,
  StoppingPointInput,
} from "../rail-graph-v1/editing.types";
import type {
  GeoJSONGeometry,
  GeoJSONPosition,
} from "../rail-graph-v1/geojson";
import type { EntityRef } from "../rail-graph-v1/primitives";
import {
  aggregateDoubleTrackPairs,
  buildAdjacency,
  buildTopologyLookup,
  type TopologyLookup,
} from "../rail-graph-v1/topology";
import {
  projectPointToPolyline,
  haversineDistance,
  calculateTurnAngle,
} from "../rail-graph-v1/geometry-math";
import { buildLiangMianSiXianGeoJson, BINDING_PLAN, STOP_PLAN } from "./poc-liangmiansixian";
import {
  buildTwoStationGeoJson,
  BINDING_PLAN as TWO_STATION_BINDING_PLAN,
  STOP_PLAN as TWO_STATION_STOP_PLAN,
} from "./poc-twostation";
import { runScenarios, summarizeScenarios } from "./poc-pathfinding";
import type { ScenarioResult } from "./poc-pathfinding";
import { SENSEKI_RAIL, SENSEKI_STATIONS } from "./senseki-data";
import {
  SENSEKI_PF_OVERRIDES,
  exportSensekiPathResults,
  runSensekiScenarios,
  summarizeSensekiResults,
  type SensekiPathExportScenario,
  type SensekiScenarioResult,
} from "./poc-senseki-pathfinding";
import { createMapView, type MapView } from "./map-view";
import { createListView, type ListView, type TabKey } from "./list-view";
import { dispatchRule, registerRuleHandler, type PipelineReport, type RuleReport } from "./rule-handlers";
import {
  PROJECT_PRESETS,
  WORKFLOW_STEPS,
  cancelPipelineTask,
  createLineWorkspace,
  fetchLineArtifacts,
  getActiveWorkspace,
  getPipelineTask,
  listPipelineArtifacts,
  projectFromPreset,
  readPipelineArtifact,
  loadWorkspaceState,
  saveWorkspaceState,
  startPipelineTask,
  workspaceKey,
  loadGlobalSettings,
  saveGlobalSettings,
  scanPaths,
  fetchCompaniesAndLines,
  createProjectForWorkspace,
  readOverrides,
  saveOverrides,
  type LineArtifacts,
  type LineWorkspaceState,
  type MvpWorkspaceState,
  type MvpProjectState,
  type PipelineArtifact,
  type PipelineStage,
  type PipelineTaskState,
  type StepProgressStatus,
  type WorkflowAction,
  type WorkflowStep,
  type MvpGlobalSettings,
  type PathScanResult,
  type CompanyMetadata,
  type MvpOverrideState,
} from "./pipeline";

let cleanOverrides: MvpOverrideState | null = null;
const cleanLevels: Record<string, boolean> = { high: true, medium: true, low: true };
const cleanFilters: Record<string, boolean> = {};
let cleanSearchQuery = "";
let cleanSelectMode = false;
let cleanSelectedCandidateFid: string | null = null;
let filterRules: any[] = [];

const allCleanDecisions = new Map<string, "keep" | "remove">();

// 单次 pipeline 共享 cache: refreshViews / compileCleanDecisions 命中 sig 即复用.
// 触发失效的位置: source 重载, rule/filter/level/search/overrides 变更.
let lastPipelineRun: { passFids: Set<string>; report: PipelineReport; sig: string } | null = null;

function currentPipelineSig(): string {
  return [
    state.source ? state.source.features.length : 0,                  // source identity proxy (length 变化即换;_fid 不变 length 不变)
    JSON.stringify(cleanFilters),
    JSON.stringify(cleanLevels),
    cleanSearchQuery,
    cleanOverrides?.keep?.length ?? 0,
    cleanOverrides?.remove?.length ?? 0,
    (filterRules || []).length,
  ].join("|");
}

function getOrRunPipeline(): { passFids: Set<string>; report: PipelineReport } {
  if (!state.source) {
    return { passFids: new Set(), report: { totalIn: 0, totalOut: 0, totalMs: 0, phaseReports: [] } };
  }
  const sig = currentPipelineSig();
  if (lastPipelineRun && lastPipelineRun.sig === sig) return lastPipelineRun;
  const result = runFilterPipeline(state.source.features, filterRules || [], cleanFilters, cleanLevels, cleanSearchQuery);
  lastPipelineRun = { passFids: result.passFids, report: result.report, sig };
  console.log("[clean] PipelineReport", result.report);
  return lastPipelineRun;
}

function invalidatePipelineCache(): void {
  lastPipelineRun = null;
}

type RailGraphKind = RailGraphFeatureKind;
type GeoJsonGeometry = GeoJSONGeometry;
type GeoJsonFeature = AnnotatedFeature;
type GeoJsonFeatureCollection = AnnotatedFeatureCollection;

interface RailGraphMvpState {
  source: GeoJsonFeatureCollection | null;
  bindings: PlatformTrackBindingInput[];
  stoppingPoints: StoppingPointInput[];
  topo: BaseTopologyLayer | null;
  diagnostics: Diagnostic[];
}

const ENDPOINT_PRECISION = 6;
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

export const state: RailGraphMvpState = {
  source: null,
  bindings: [],
  stoppingPoints: [],
  topo: null,
  diagnostics: [],
};

let mapView: MapView | null = null;
let listView: ListView | null = null;
let lastCurrentStep: string | null = null;
let lastPathfindingResults: ScenarioResult[] | SensekiScenarioResult[] | undefined;
let workspaceState: MvpWorkspaceState = loadWorkspaceState();
let activePipelineTask: PipelineTaskState | null = null;
let pipelineArtifacts: PipelineArtifact[] = [];
let pipelinePollTimer: number | null = null;

// 多 stage 流水线的可视化状态: 跨 stage 累积 log + 当前阶段索引 + 起始时间.
// 让 UI 显示 "Stage 2/4: extract · 312 lines · 18.3s · last: [phase3] emitted=..."
// 这样用户在跑长 ingest 时不会以为卡住了, 也能看到上一个 stage 已经吐了什么.
//
// startIndex < currentIndex 之间的 stage = 用户手动跳过的 (复用磁盘上的 prior outputs),
// progress UI 把它们画成灰 "skipped".
interface PipelineRunState {
  stages: PipelineStage[];
  startIndex: number;
  currentIndex: number;
  startedAt: number;
  stageStartedAt: number;
  priorStagesLog: string[];
}
let pipelineRun: PipelineRunState | null = null;

const ALL_PIPELINE_STAGES: PipelineStage[] = ["extract", "postFix", "match", "manifest"];
let globalSettings: MvpGlobalSettings = loadGlobalSettings();
let scanResult: PathScanResult | null = null;
let isAutoRunning = false;
let showSettings = false;
let showNewWorkspace = false;

async function loadAllCleanDecisions(): Promise<void> {
  const project = activeProject();
  
  // 1. Load overrides from disk
  try {
    const ov = await readOverrides(project.overridePath);
    cleanOverrides = ov;
  } catch (err) {
    console.warn("[clean] Override file not found or failed to load. Initializing empty override state.", err);
    cleanOverrides = {
      k: `${project.companyName}__${project.lineName}`,
      keep: [],
      remove: [],
      meta: {}
    };
  }

  // 2. Load filter rules from scripts directory
  try {
    const rulesPath = `${project.scriptsRoot}\\filter_rules.json`;
    filterRules = await readPipelineArtifact(rulesPath) as any[];
    // Populate default checkbox status if not set
    for (const rule of filterRules) {
      if (cleanFilters[rule.id] === undefined) {
        cleanFilters[rule.id] = !!rule.default;
      }
    }
  } catch (err) {
    console.error("[clean] Failed to load filter rules:", err);
  }

  // 3. Compile rules & overrides into in-memory map
  invalidatePipelineCache();  // overrides 和 rules 可能都变了, 强制下次跑
  compileCleanDecisions();
}

function compileCleanDecisions(passFidsHint?: Set<string>): void {
  allCleanDecisions.clear();

  if (!state.source) return;

  const keepSet = new Set(cleanOverrides?.keep || []);
  const removeSet = new Set(cleanOverrides?.remove || []);
  const passFids = passFidsHint ?? getOrRunPipeline().passFids;

  for (const f of state.source.features) {
    const fid = fidOf(f);

    if (keepSet.has(fid)) {
      allCleanDecisions.set(fid, "keep");
      continue;
    }
    if (removeSet.has(fid)) {
      allCleanDecisions.set(fid, "remove");
      continue;
    }
    allCleanDecisions.set(fid, passFids.has(fid) ? "keep" : "remove");
  }
}

/** fidOf: 优先返回 feature.properties._fid 缓存; 没有就现算并写回。
 *  整个 source 生命周期内 string concat 只发生一次, refreshViews / mapview / listview 多处复用免开销。 */
export function fidOf(f: GeoJsonFeature): string {
  const props = (f.properties || {}) as any;
  if (typeof props._fid === "string" && props._fid.length > 0) return props._fid;
  const fid = `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
  props._fid = fid;
  return fid;
}

function fidOfFeature(f: GeoJsonFeature): string { return fidOf(f); }

// rule 可编程的两阶段执行引擎:
//   - 每条 rule 可声明 rule.phase (默认 1) 决定执行顺序; 同 phase 内 sequential 剔除 (按 rule.order / JSON 顺序)
//   - 每条 rule 可声明 rule.input.{source, geometry_types} 决定它的「参考集」
//       source = "all" (默认)         → 整个 features 池
//       source = "passed_lower_phase" → 之前所有 phase 都通过的 features 池
//       geometry_types 进一步过滤参考集 (例如 orphan_railway_node 只关心 LineString/MultiLineString)
//   - 每条 rule 派发给 rule-handlers 的 dispatchRule (新 rule.handler.type / 旧 exclude_if|dynamic|post_filter 都支持)
//   - 同 phase 内 refPool same-source/geometry_types 只算一次 (cache by signature)
//   - 返回 { passFids, report }; report 含 per-rule eliminated/refSize/ms 供 console + UI 展示
export interface PipelineResult {
  passFids: Set<string>;
  report: PipelineReport;
}

export function runFilterPipeline(
  features: GeoJsonFeature[],
  rules: any[],
  activeFilters: Record<string, boolean>,
  activeLevels: Record<string, boolean>,
  searchQuery: string,
): PipelineResult {
  const t0 = performance.now();

  // phase 0 (内置): level + search 过滤 — 廉价、O(N), 必在最前。
  let passed: GeoJsonFeature[] = features.filter((f) => {
    const props = (f.properties || {}) as any;
    const lv = props.match_level || "low";
    if (activeLevels && activeLevels[lv] === false) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = String(props.name || "").toLowerCase().includes(q)
        || String(props.nearest_station || "").toLowerCase().includes(q)
        || String(props.osm_id || "").includes(q);
      if (!matchName) return false;
    }
    return true;
  });

  const totalIn = features.length;
  const phaseReports: PipelineReport["phaseReports"] = [];

  // 按 phase 升序分组; 同 phase 内按 rule.order (默认按 rules 数组中顺序) 排序
  const phaseMap = new Map<number, any[]>();
  for (const rule of rules) {
    if (!activeFilters[rule.id]) continue;
    const p = typeof rule.phase === "number" ? rule.phase : 1;
    if (!phaseMap.has(p)) phaseMap.set(p, []);
    phaseMap.get(p)!.push(rule);
  }
  for (const list of phaseMap.values()) {
    list.sort((a, b) => (typeof a.order === "number" ? a.order : 0) - (typeof b.order === "number" ? b.order : 0));
  }
  const sortedPhases = [...phaseMap.keys()].sort((a, b) => a - b);

  for (const phase of sortedPhases) {
    const phaseRules = phaseMap.get(phase)!;
    const phaseInSize = passed.length;

    // refPool cache: 同 phase 内 source/geometry_types 一样的多条 rule 共用同一份 refPool, 不重复计算。
    const refCache = new Map<string, GeoJsonFeature[]>();
    const ruleReports: RuleReport[] = [];

    for (const rule of phaseRules) {
      const refPool = resolveRuleInputCached(rule, features, passed, refCache);
      const inSize = passed.length;
      const tRule = performance.now();
      passed = passed.filter((f) => dispatchRule(rule, f, refPool));
      const ms = performance.now() - tRule;
      ruleReports.push({
        ruleId: rule.id ?? "?",
        ruleLabel: rule.label,
        phase,
        inSize,
        outSize: passed.length,
        eliminated: inSize - passed.length,
        refSize: refPool.length,
        ms,
      });
    }

    phaseReports.push({ phase, inSize: phaseInSize, outSize: passed.length, rules: ruleReports });
  }

  const totalMs = performance.now() - t0;
  const report: PipelineReport = {
    totalIn,
    totalOut: passed.length,
    totalMs,
    phaseReports,
  };

  return { passFids: new Set(passed.map(fidOf)), report };
}

function resolveRuleInputCached(
  rule: any,
  allFeatures: GeoJsonFeature[],
  passedSoFar: GeoJsonFeature[],
  cache: Map<string, GeoJsonFeature[]>,
): GeoJsonFeature[] {
  const src = rule.input?.source ?? "all";
  const types: string[] = rule.input?.geometry_types ?? [];
  const key = `${src}|${types.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let pool = src === "passed_lower_phase" ? passedSoFar : allFeatures;
  if (types.length > 0) {
    pool = pool.filter((f) => types.includes((f.geometry as any)?.type || ""));
  }
  cache.set(key, pool);
  return pool;
}

function resolveRuleInput(rule: any, allFeatures: GeoJsonFeature[], passedSoFar: GeoJsonFeature[]): GeoJsonFeature[] {
  return resolveRuleInputCached(rule, allFeatures, passedSoFar, new Map());
}

export function loadGeoJson(raw: string | GeoJsonFeatureCollection): RailGraphMvpState {
  state.source = null;
  state.bindings = [];
  state.stoppingPoints = [];
  state.topo = null;
  state.diagnostics = [];
  return importGeoJson(raw);
}

export function importGeoJson(raw: string | GeoJsonFeatureCollection): RailGraphMvpState {
  const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (!isFeatureCollection(parsed)) {
    throw new Error("Input must be a GeoJSON FeatureCollection.");
  }

  const existing = state.source?.features ?? [];
  const incoming = parsed.features.map((feature, index) => ({
    ...feature,
    properties: {
      ...feature.properties,
      railGraph: normalizeAnnotation(feature, index),
    },
  }));

  const deduped = dedupeFeatures([...existing, ...incoming]);
  // 一次性预算 fid 到 properties._fid, 整个 source 生命周期内 fidOf 直接返回缓存。
  for (const f of deduped.features) {
    fidOf(f);
  }
  state.source = {
    type: "FeatureCollection",
    features: deduped.features,
  };
  state.topo = null;
  lastPipelineRun = null;  // source 换了, pipeline cache 失效
  state.diagnostics = deduped.skipped > 0
    ? [diagnostic("info", "MVP_IMPORT_DEDUPED", "import", "Duplicate features were skipped.", { skipped: deduped.skipped })]
    : [];
  return state;
}

export function createFeature(input: {
  geometryType: "Point" | "LineString" | "Polygon";
  coordinates: GeoJSONPosition | GeoJSONPosition[] | GeoJSONPosition[][];
  kind?: RailGraphKind;
  name?: string;
}): RailGraphMvpState {
  const feature: GeoJsonFeature = {
    type: "Feature",
    geometry: createGeometry(input.geometryType, input.coordinates),
    properties: {
      name: input.name,
    },
  };
  const annotation = normalizeAnnotation(feature, state.source?.features.length ?? 0);
  annotation.kind = input.kind ?? "unknown";
  feature.properties.railGraph = annotation;
  return importGeoJson({ type: "FeatureCollection", features: [feature] });
}

export function annotateFeature(
  featureIndex: number,
  annotation: Partial<RailGraphAnnotation> & { kind: RailGraphKind },
): RailGraphMvpState {
  const feature = getFeature(featureIndex);
  const existing = feature.properties.railGraph ?? normalizeAnnotation(feature, featureIndex);
  feature.properties.railGraph = {
    ...existing,
    ...annotation,
    schemaVersion: "rail-graph-v1",
    id: annotation.id ?? existing.id,
    source: annotation.source ?? existing.source,
  };
  state.topo = null;
  return state;
}

export function addPlatformTrackBinding(input: PlatformTrackBindingInput): RailGraphMvpState {
  state.bindings.push(input);
  state.topo = null;
  return state;
}

export function confirmStoppingPoint(input: StoppingPointInput): RailGraphMvpState {
  state.stoppingPoints.push({
    ...input,
    measure: clampMeasure(input.measure),
  });
  state.topo = null;
  return state;
}

export function compileTopology(): BaseTopologyLayer {
  if (!state.source) {
    state.diagnostics = [diagnostic("fatal", "MVP_NO_SOURCE", "compile", "No GeoJSON source loaded.")];
    state.topo = cloneTopo(EMPTY_TOPO);
    return state.topo;
  }

  const diagnostics: Diagnostic[] = [];
  const topo = cloneTopo(EMPTY_TOPO);
  const geometryRefs = new Set<string>();

  const annotatedFeatures = state.source.features
    .filter((feature) => {
      const p = feature.properties || {};
      const fid = `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}:${p.source_line_name || ""}`;
      return allCleanDecisions.get(fid) !== "remove";
    })
    .map((feature, index) => ({
      feature,
      index,
      annotation: feature.properties.railGraph,
    }));

  // Phase 1.3b: 分类无标注 feature.
  //   - 完全无 annotation / kind=unknown 且无 source 标记 → 每条发 MVP_UNKNOWN_FEATURE warn (真噪音)
  //   - kind=unknown 且 source=osm-deferred-* → MVP 已知 OSM 真实存在但 MVP 暂不消费的类别
  //     (level_crossing / subway_entrance / railway_landuse 等), 聚合发一条 info
  //     MVP_OSM_KIND_NOT_CONSUMED, 不逐条 warn.
  const osmKindNotConsumedTotals: Record<string, number> = {};
  for (const { annotation, index } of annotatedFeatures) {
    if (!annotation) {
      diagnostics.push(diagnostic("warn", "MVP_UNKNOWN_FEATURE", "compile", "Feature is not annotated.", { index }));
      continue;
    }
    if (annotation.kind !== "unknown") continue;
    const src = annotation.source ?? "";
    if (src.startsWith("osm-deferred-")) {
      const classMain = src.slice("osm-deferred-".length);
      osmKindNotConsumedTotals[classMain] = (osmKindNotConsumedTotals[classMain] ?? 0) + 1;
    } else {
      diagnostics.push(diagnostic("warn", "MVP_UNKNOWN_FEATURE", "compile", "Feature is not annotated.", { index }));
    }
  }
  const osmKindNotConsumedTotal = Object.values(osmKindNotConsumedTotals).reduce((s, n) => s + n, 0);
  if (osmKindNotConsumedTotal > 0) {
    diagnostics.push(diagnostic(
      "info",
      "MVP_OSM_KIND_NOT_CONSUMED",
      "compile",
      `${osmKindNotConsumedTotal} OSM features fall in classes MVP does not consume (deferred).`,
      { totalsByClass: osmKindNotConsumedTotals },
    ));
  }

  for (const { feature, annotation, index } of annotatedFeatures) {
    if (annotation?.kind === "station_point") {
      addStationFeature(topo, diagnostics, feature, annotation, index);
    }
  }

  for (const { feature, annotation, index } of annotatedFeatures) {
    if (annotation?.kind === "platform_area") {
      addPlatformFeature(topo, diagnostics, feature, annotation, index);
    }
  }

  for (const { feature, annotation, index } of annotatedFeatures) {
    if (
      !annotation
      || annotation.kind === "unknown"
      || annotation.kind === "station_point"
      || annotation.kind === "platform_area"
      || annotation.kind === "signal_point"
    ) {
      continue;
    }

    if (annotation.kind === "track_geometry") {
      addTrackFeature(topo, diagnostics, feature, annotation, index, geometryRefs);
      continue;
    }

    diagnostics.push(diagnostic("info", "MVP_KIND_DEFERRED", "compile", "Kind is annotated but not compiled in MVP.", {
      index,
      kind: annotation.kind,
    }));
  }

  // signal_point 编译: 直接从 annotation 拷 (不做空间投影)
  for (const { annotation } of annotatedFeatures) {
    if (annotation?.kind === "signal_point") {
      addSignalFeature(topo, annotation);
    }
  }

  // directionRole 自动 fallback: traversal=both 但无 directionRole → 自动填 bidirectional
  for (const edge of topo.edges) {
    if (edge.traversal === "both" && !edge.directionRole) {
      edge.directionRole = "bidirectional";
      diagnostics.push(diagnostic(
        "info",
        "MVP_TRACK_DIRECTION_ROLE_INFERRED_BIDIRECTIONAL",
        "compile",
        "Edge has traversal=both but no directionRole; auto-assigned 'bidirectional'.",
        { edgeId: edge.id },
      ));
    }
  }

  applyCrossoverSnapping(topo, diagnostics);

  topo.adjacency = buildAdjacency(topo.edges);
  addBindings(topo, diagnostics);
  addStoppingPoints(topo, diagnostics);
  topo.doubleTrackPairs = aggregateDoubleTrackPairs(
    topo.edges,
    stableId("manual", "doubleTrackPair", "auto"),
  );

  if (topo.edges.length === 0) {
    diagnostics.push(diagnostic("error", "MVP_NO_TRACKS", "compile", "No track_geometry features were compiled."));
  }

  state.diagnostics = diagnostics;
  state.topo = topo;
  return topo;
}

export function exportAnnotatedGeoJson(): GeoJsonFeatureCollection {
  if (!state.source) {
    throw new Error("No GeoJSON source loaded.");
  }
  // 深拷贝后剥掉 _fid 这种 runtime cache 字段, 导出文件干净
  const cloned = JSON.parse(JSON.stringify(state.source)) as GeoJsonFeatureCollection;
  for (const f of cloned.features) {
    const p = f.properties as any;
    if (p && "_fid" in p) delete p._fid;
  }
  return cloned;
}

export function exportTopology(): BaseTopologyLayer {
  return state.topo ?? compileTopology();
}

export function exportDiagnostics(): Diagnostic[] {
  if (!state.topo) {
    compileTopology();
  }
  return state.diagnostics;
}

// ── Demo state snapshot (Phase 0) ─────────────────────────────
// 完整序列化当前仙石线 demo 状态 (annotation overrides + bindings + source GeoJSON
// + 诊断 snapshot), 供用户在 ingest 重跑 / schema 升级 / 误操作前先 Export 一份
// 作为回滚依据.

export interface SensekiDemoSnapshot {
  schemaVersion: "senseki-demo-v1" | "senseki-demo-v2";
  exportedAt: string;
  app: {
    gitCommit?: string;
    sensekiDataHash?: string;
  };
  source: GeoJsonFeatureCollection;
  overrides: Record<string, RailGraphAnnotation>;
  bindings: PlatformTrackBindingInput[];
  stoppingPoints: StoppingPointInput[];
  diagnostics: Diagnostic[];
  topologySummary: {
    counts: { stations: number; platforms: number; edges: number; signals: number; bindings: number };
    diagnosticCounts: Record<DiagnosticLevel, number>;
    diagnosticCountsByCode: Record<string, number>;
  };
  /** v2+ 寻路结果 (含 geo 增强): 仅 senseki-pf 跑过后才有 */
  pathfindingResults?: SensekiPathExportScenario[];
}

export function exportSensekiSnapshot(): SensekiDemoSnapshot {
  if (!state.source) {
    throw new Error("No GeoJSON source loaded.");
  }
  if (!state.topo) {
    compileTopology();
  }
  const topo = state.topo!;
  const overrides = loadAnnotationOverrides();

  const diagnosticCounts: Record<DiagnosticLevel, number> = { fatal: 0, error: 0, warn: 0, info: 0 };
  const diagnosticCountsByCode: Record<string, number> = {};
  for (const d of state.diagnostics) {
    diagnosticCounts[d.level] = (diagnosticCounts[d.level] ?? 0) + 1;
    diagnosticCountsByCode[d.code] = (diagnosticCountsByCode[d.code] ?? 0) + 1;
  }

  return {
    schemaVersion: "senseki-demo-v2",
    exportedAt: new Date().toISOString(),
    app: {
      sensekiDataHash: hashSensekiData(),
    },
    source: JSON.parse(JSON.stringify(state.source)) as GeoJsonFeatureCollection,
    overrides,
    bindings: state.bindings.map((b) => ({ ...b })),
    stoppingPoints: state.stoppingPoints.map((s) => ({ ...s })),
    diagnostics: state.diagnostics.map((d) => ({ ...d })),
    topologySummary: {
      counts: {
        stations: topo.stations.length,
        platforms: topo.platforms.length,
        edges: topo.edges.length,
        signals: topo.signals.length,
        bindings: topo.platformTrackBindings.length,
      },
      diagnosticCounts,
      diagnosticCountsByCode,
    },
    pathfindingResults: lastPathfindingResults && isSensekiResults(lastPathfindingResults)
      ? exportSensekiPathResults(lastPathfindingResults, topo)
      : undefined,
  };
}

function isSensekiResults(
  results: ScenarioResult[] | SensekiScenarioResult[],
): results is SensekiScenarioResult[] {
  // SensekiScenario 缺少 startSeed.intentionChain 字段, 而 ScenarioResult.scenario 含 expectedPhaseKinds.
  // 用 expectedPhaseKinds 缺失作为判定: senseki scenario 不带这个字段.
  if (results.length === 0) return false;
  const first = results[0] as { scenario?: { expectedPhaseKinds?: unknown } };
  return first.scenario?.expectedPhaseKinds === undefined;
}

export interface ImportSnapshotResult {
  overridesApplied: number;
  overridesTotal: number;
  bindingsRestored: number;
  stoppingPointsRestored: number;
  hashMatch: boolean;
  exportedAt: string;
  exportedHash?: string;
  currentHash: string;
}

export function importSensekiSnapshot(snapshot: SensekiDemoSnapshot): ImportSnapshotResult {
  if (snapshot.schemaVersion !== "senseki-demo-v1" && snapshot.schemaVersion !== "senseki-demo-v2") {
    throw new Error(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  if (!snapshot.source || !Array.isArray(snapshot.source.features)) {
    throw new Error("Snapshot missing source FeatureCollection.");
  }

  // 1. 写 overrides 到 localStorage (即使 source 已含合并后 annotation,
  //    overrides 仍是权威备份, 供下次刷新或重新 Import 仙石線 时复用).
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(ANNOTATION_OVERRIDES_KEY, JSON.stringify(snapshot.overrides ?? {}));
    } catch {
      // quota / privacy mode — silent, source 已含 annotation 仍可用
    }
  }

  // 2. 加载 source — loadGeoJson 会重置 bindings/stoppingPoints/topo/diagnostics
  loadGeoJson(snapshot.source);

  // 3. 重放 overrides (idempotent — snapshot.source 应已合并, 但这一步确保
  //    任何 ID 漂移情况下 overrides 仍尽力打回去).
  const { applied, total } = applyAnnotationOverrides();

  // 4. 还原 bindings / stoppingPoints (loadGeoJson 已重置, 直接覆盖)
  state.bindings = (snapshot.bindings ?? []).map((b) => ({ ...b }));
  state.stoppingPoints = (snapshot.stoppingPoints ?? []).map((s) => ({ ...s }));
  state.topo = null;

  // 5. 重编 + 刷新视图
  compileTopology();
  lastPathfindingResults = undefined;
  refreshViews();

  const currentHash = hashSensekiData();
  const exportedHash = snapshot.app?.sensekiDataHash;
  return {
    overridesApplied: applied,
    overridesTotal: total,
    bindingsRestored: state.bindings.length,
    stoppingPointsRestored: state.stoppingPoints.length,
    hashMatch: !exportedHash || exportedHash === currentHash,
    exportedAt: snapshot.exportedAt,
    exportedHash,
    currentHash,
  };
}

// 轻量 hash: 不必密码学级别, 只要能检测 senseki-data.ts 重跑后的 ID 漂移.
// 采样 features 数量 + 首/中/尾 annotation.id 拼接成稳定字符串 → djb2.
function hashSensekiData(): string {
  const features = SENSEKI_RAIL.features;
  const n = features.length;
  if (n === 0) return "00000000";
  const idAt = (idx: number): string =>
    features[idx]?.properties?.railGraph?.id ?? "";
  const sample = [
    `n=${n}`,
    `first=${idAt(0)}`,
    `mid=${idAt(Math.floor(n / 2))}`,
    `last=${idAt(n - 1)}`,
  ].join("|");
  let h = 5381;
  for (let i = 0; i < sample.length; i++) {
    h = ((h * 33) ^ sample.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

function normalizeAnnotation(feature: GeoJsonFeature, index: number): RailGraphAnnotation {
  const existing = feature.properties?.railGraph;
  if (existing?.kind) {
    const rawId = existing.id !== undefined && existing.id !== null ? String(existing.id) : "";
    return {
      schemaVersion: "rail-graph-v1",
      source: "manual",
      ...existing,
      id: rawId || stableId("manual", "feature", String(index)),
    };
  }

  return {
    kind: "unknown",
    schemaVersion: "rail-graph-v1",
    id: stableId("manual", "feature", `${index}:${feature.geometry?.type || "unknown"}`),
    source: "manual",
  };
}

function addTrackFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: GeoJsonFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
  geometryRefs: Set<string>,
): void {
  const lines = lineStringsFromGeometry(feature.geometry);
  if (lines.length === 0) {
    diagnostics.push(diagnostic("error", "MVP_INVALID_TRACK_GEOMETRY", "compile", "track_geometry requires LineString or MultiLineString.", {
      featureIndex,
      geometryType: feature.geometry.type,
    }));
    return;
  }

  for (const [lineIndex, coordinates] of lines.entries()) {
    if (coordinates.length < 2) {
      diagnostics.push(diagnostic("error", "MVP_SHORT_TRACK_GEOMETRY", "compile", "Track geometry needs at least two coordinates.", {
        featureIndex,
        lineIndex,
      }));
      continue;
    }

    if (!annotation.track?.functionalUse || annotation.track.functionalUse.length === 0) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_TRACK_FUNCTIONAL_USE_UNDECLARED",
        "compile",
        "Track has no explicit functionalUse. Do not infer from binding state or position.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }
    if (!annotation.track?.physicalKind) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_TRACK_PHYSICAL_KIND_UNDECLARED",
        "compile",
        "Track has no explicit physicalKind (main/siding/yard/lead/safety).",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }
    if (!annotation.track?.directionRole) {
      diagnostics.push(diagnostic(
        "info",
        "MVP_TRACK_DIRECTION_ROLE_UNDECLARED",
        "compile",
        "Track has no directionRole; it will not be aggregated into DoubleTrackPair.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }

    const edgeId = stableId("manual", "edge", `${annotation.id}:${lineIndex}`);
    const fromNodeRef = nodeIdForCoordinate(coordinates[0]);
    const toNodeRef = nodeIdForCoordinate(coordinates[coordinates.length - 1]);
    ensureNode(topo, fromNodeRef, "line_endpoint", coordinates[0]);
    ensureNode(topo, toNodeRef, "line_endpoint", coordinates[coordinates.length - 1]);

    // turnback 一致性校验: functionalUse 含 turnback 但 directionRole !== reversible
    if (
      Array.isArray(annotation.track?.functionalUse)
      && annotation.track!.functionalUse!.includes("turnback")
      && annotation.track?.directionRole !== "reversible"
    ) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_REVERSIBLE_WITHOUT_TURNBACK_ROLE",
        "compile",
        "Track has functionalUse=turnback but directionRole is not 'reversible'. turnback requires reversible direction role.",
        { featureIndex, lineIndex, trackCode: annotation.track?.trackCode },
      ));
    }

    const geometryRef = stableId("manual", "geometry", `${annotation.id}:${lineIndex}`);
    geometryRefs.add(geometryRef);
    topo.edges.push({
      id: edgeId,
      fromNodeRef,
      toNodeRef,
      traversal: annotation.track?.traversal ?? "both",
      role: annotation.track?.role ?? "main",
      name: annotation.track?.name || feature.properties.name as string | undefined,
      trackCode: annotation.track?.trackCode,
      geometryRef,
      lengthMeters: calculateLengthMeters(coordinates),
      coordinates,
      physicalKind: annotation.track?.physicalKind,
      functionalUse: annotation.track?.functionalUse,
      directionRole: annotation.track?.directionRole,
      sourceSlice: {
        sourceFeatureRef: annotation.id,
        multiLineIndex: feature.geometry.type === "MultiLineString" ? lineIndex : undefined,
        startMeasure: 0,
        endMeasure: 1,
      },
      sourceTags: extractSourceTags(feature.properties),
    });
  }
}

function addStationFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: GeoJsonFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
): void {
  if (feature.geometry.type !== "Point") {
    diagnostics.push(diagnostic("error", "MVP_INVALID_STATION_GEOMETRY", "compile", "station_point requires Point geometry.", {
      featureIndex,
      geometryType: feature.geometry.type,
    }));
    return;
  }

  const id = annotation.id as EntityRef;
  topo.stations.push({
    id,
    name: annotation.station?.name || feature.properties.name as string || `Station ${featureIndex + 1}`,
    platformRefs: [],
    positionRef: stableId("manual", "position", annotation.id),
  });
}

function addPlatformFeature(
  topo: BaseTopologyLayer,
  diagnostics: Diagnostic[],
  feature: GeoJsonFeature,
  annotation: RailGraphAnnotation,
  featureIndex: number,
): void {
  // Phase 1.1: 接受 LineString / MultiLineString —
  // OpenRailwayMap 中 platform=LineString (站台边缘线) 是常见模式, MVP 不再当作非法.
  const geomType = feature.geometry.type;
  const isAcceptedGeom =
    geomType === "Polygon"
    || geomType === "MultiPolygon"
    || geomType === "Point"
    || geomType === "LineString"
    || geomType === "MultiLineString";
  if (!isAcceptedGeom) {
    diagnostics.push(diagnostic("error", "MVP_INVALID_PLATFORM_GEOMETRY", "compile", "platform_area requires Polygon/MultiPolygon/LineString/MultiLineString/Point in MVP.", {
      featureIndex,
      geometryType: geomType,
    }));
    return;
  }

  const id = annotation.id as EntityRef;

  // Phase 1.2 + CC-3: stationRef 解析链 —
  //   explicit annotation.platform.stationRef
  //   → OSM nearest_station tag 反查 LOD station 名字
  //   → firstStationRef fallback (兜底, 但来源不再受 array 顺序漂移)
  //   命中任何 fallback 时只发 info, 仅在完全无 station 时维持 warn.
  let stationRef: EntityRef | undefined = annotation.platform?.stationRef as EntityRef | undefined;
  let stationRefSource: "explicit" | "nearest-station-tag" | "first-fallback" | undefined;
  if (stationRef) {
    stationRefSource = "explicit";
  } else {
    const sourceTags = feature.properties?.sourceTags as { nearest_station?: string } | undefined;
    const nearestName = String(sourceTags?.nearest_station ?? "").trim();
    if (nearestName) {
      const found = topo.stations.find((s) => s.name === nearestName);
      if (found) {
        stationRef = found.id;
        stationRefSource = "nearest-station-tag";
      }
    }
    if (!stationRef) {
      const first = firstStationRef(topo);
      if (first) {
        stationRef = first as EntityRef;
        stationRefSource = "first-fallback";
      }
    }
  }

  if (!stationRef) {
    diagnostics.push(diagnostic("warn", "MVP_PLATFORM_WITHOUT_STATION", "compile", "Platform has no stationRef and no station fallback available.", { featureIndex }));
  } else if (stationRefSource && stationRefSource !== "explicit") {
    diagnostics.push(diagnostic(
      "info",
      "MVP_PLATFORM_STATION_FALLBACK",
      "compile",
      `Platform stationRef resolved via fallback: ${stationRefSource}.`,
      { featureIndex, source: stationRefSource, stationRef },
    ));
  }
  if (!annotation.platform?.type) {
    diagnostics.push(diagnostic(
      "warn",
      "MVP_PLATFORM_TYPE_UNDECLARED",
      "compile",
      "Platform has no explicit type (side/island/bay). Falling back to 'unknown'.",
      { featureIndex, platformName: annotation.platform?.name },
    ));
  }

  topo.platforms.push({
    id,
    stationRef: (stationRef ?? stableId("manual", "station", "missing")) as EntityRef,
    type: annotation.platform?.type ?? "unknown",
    name: annotation.platform?.name || feature.properties.name as string | undefined,
    number: annotation.platform?.number,
    areaRef: stableId("manual", "area", annotation.id),
  });

  const station = topo.stations.find((item) => item.id === stationRef);
  if (station && !station.platformRefs.includes(id)) {
    station.platformRefs.push(id);
  }
}

function resolveAllSplitEdges(topo: BaseTopologyLayer, originalEdgeId: string): string[] {
  const candidates = topo.edges.filter((e) => e.id === originalEdgeId || e.id.startsWith(originalEdgeId + ":"));
  return candidates.map((e) => e.id);
}

function resolveEdgeAndMeasure(
  topo: BaseTopologyLayer,
  originalEdgeId: string,
  originalMeasure: number,
): { edgeId: string; measure: number } | null {
  const candidates = topo.edges.filter((e) => e.id === originalEdgeId || e.id.startsWith(originalEdgeId + ":"));
  if (candidates.length === 0) return null;

  for (const edge of candidates) {
    const sSlice = edge.sourceSlice;
    if (!sSlice) continue;
    const start = sSlice.startMeasure ?? 0;
    const end = sSlice.endMeasure ?? 1;
    if (originalMeasure >= start && originalMeasure <= end) {
      const denom = end - start;
      const localMeasure = denom > 0 ? (originalMeasure - start) / denom : 0;
      return { edgeId: edge.id, measure: Math.max(0, Math.min(1, localMeasure)) };
    }
  }

  return { edgeId: candidates[0].id, measure: originalMeasure };
}

function applyCrossoverSnapping(topo: BaseTopologyLayer, diagnostics: Diagnostic[]): void {
  const SNAP_TOLERANCE = 0.5; // 0.5m
  let snappedAny = true;
  let iterations = 0;
  const maxIterations = 100;

  while (snappedAny && iterations < maxIterations) {
    snappedAny = false;
    iterations++;

    const nodeDegrees: Record<string, number> = {};
    for (const edge of topo.edges) {
      nodeDegrees[edge.fromNodeRef] = (nodeDegrees[edge.fromNodeRef] ?? 0) + 1;
      nodeDegrees[edge.toNodeRef] = (nodeDegrees[edge.toNodeRef] ?? 0) + 1;
    }

    for (const node of topo.nodes) {
      if (nodeDegrees[node.id] !== 1) continue;

      const edge = topo.edges.find((e) => e.fromNodeRef === node.id || e.toNodeRef === node.id);
      if (!edge || !edge.coordinates) continue;

      const isStart = edge.fromNodeRef === node.id;
      const nodeCoord = isStart ? edge.coordinates[0] : edge.coordinates[edge.coordinates.length - 1];

      for (const targetEdge of topo.edges) {
        if (targetEdge.id === edge.id) continue;
        if (!targetEdge.coordinates) continue;

        const proj = projectPointToPolyline(nodeCoord, targetEdge.coordinates);
        if (proj.distance < SNAP_TOLERANCE) {
          const distToStart = haversineDistance(proj.snapped, targetEdge.coordinates[0]);
          const distToEnd = haversineDistance(proj.snapped, targetEdge.coordinates[targetEdge.coordinates.length - 1]);

          if (distToStart < 0.1) {
            mergeNodes(topo, node.id, targetEdge.fromNodeRef, proj.snapped);
            diagnostics.push(diagnostic(
              "info",
              "MVP_CROSSOVER_MERGE_NODE",
              "compile",
              `Crossover node '${node.id}' merged into target node '${targetEdge.fromNodeRef}' by snapping.`,
              { crossoverNode: node.id, targetNode: targetEdge.fromNodeRef, distance: proj.distance },
            ));
            snappedAny = true;
            break;
          } else if (distToEnd < 0.1) {
            mergeNodes(topo, node.id, targetEdge.toNodeRef, proj.snapped);
            diagnostics.push(diagnostic(
              "info",
              "MVP_CROSSOVER_MERGE_NODE",
              "compile",
              `Crossover node '${node.id}' merged into target node '${targetEdge.toNodeRef}' by snapping.`,
              { crossoverNode: node.id, targetNode: targetEdge.toNodeRef, distance: proj.distance },
            ));
            snappedAny = true;
            break;
          } else {
            splitEdgeAtPoint(topo, targetEdge, proj.measure, proj.snapped, node.id);
            diagnostics.push(diagnostic(
              "info",
              "MVP_CROSSOVER_SPLIT_EDGE",
              "compile",
              `Edge '${targetEdge.id}' split by crossover node '${node.id}' at measure ${proj.measure.toFixed(4)}.`,
              { splitEdge: targetEdge.id, crossoverNode: node.id, measure: proj.measure, distance: proj.distance },
            ));
            snappedAny = true;
            break;
          }
        }
      }

      if (snappedAny) break;
    }
  }
}

function mergeNodes(
  topo: BaseTopologyLayer,
  oldNodeId: EntityRef,
  newNodeId: EntityRef,
  snappedCoord: [number, number],
): void {
  for (const edge of topo.edges) {
    if (edge.fromNodeRef === oldNodeId) {
      edge.fromNodeRef = newNodeId;
      if (edge.coordinates) edge.coordinates[0] = snappedCoord;
    }
    if (edge.toNodeRef === oldNodeId) {
      edge.toNodeRef = newNodeId;
      if (edge.coordinates) edge.coordinates[edge.coordinates.length - 1] = snappedCoord;
    }
  }
  topo.nodes = topo.nodes.filter((n) => n.id !== oldNodeId);
}

function splitEdgeAtPoint(
  topo: BaseTopologyLayer,
  targetEdge: TopologyEdge,
  measure: number,
  snappedCoord: [number, number],
  crossoverNodeId: string,
): void {
  const coords = targetEdge.coordinates!;
  const proj = projectPointToPolyline(snappedCoord, coords);
  const segIdx = proj.segmentIndex;

  const coordsA: [number, number][] = [];
  for (let i = 0; i <= segIdx; i++) {
    coordsA.push(coords[i]);
  }
  coordsA.push(snappedCoord);

  const coordsB: [number, number][] = [snappedCoord];
  for (let i = segIdx + 1; i < coords.length; i++) {
    coordsB.push(coords[i]);
  }

  const crossoverNode = topo.nodes.find((n) => n.id === crossoverNodeId);
  if (crossoverNode) {
    crossoverNode.kind = "junction";
  }

  const edgeAId = `${targetEdge.id}:part_A`;
  const edgeBId = `${targetEdge.id}:part_B`;

  const sSlice = targetEdge.sourceSlice!;
  const originalStart = sSlice.startMeasure ?? 0;
  const originalEnd = sSlice.endMeasure ?? 1;
  const splitMeasure = originalStart + measure * (originalEnd - originalStart);

  const edgeA: TopologyEdge = {
    ...targetEdge,
    id: edgeAId as EntityRef,
    toNodeRef: crossoverNodeId as EntityRef,
    coordinates: coordsA,
    lengthMeters: calculateLengthMeters(coordsA),
    sourceSlice: {
      ...sSlice,
      startMeasure: originalStart,
      endMeasure: splitMeasure,
    },
  };

  const edgeB: TopologyEdge = {
    ...targetEdge,
    id: edgeBId as EntityRef,
    fromNodeRef: crossoverNodeId as EntityRef,
    coordinates: coordsB,
    lengthMeters: calculateLengthMeters(coordsB),
    sourceSlice: {
      ...sSlice,
      startMeasure: splitMeasure,
      endMeasure: originalEnd,
    },
  };

  topo.edges = topo.edges.filter((e) => e.id !== targetEdge.id);
  topo.edges.push(edgeA, edgeB);

  for (const edge of topo.edges) {
    if (edge.fromNodeRef === crossoverNodeId && edge.coordinates) {
      edge.coordinates[0] = snappedCoord;
    }
    if (edge.toNodeRef === crossoverNodeId && edge.coordinates) {
      edge.coordinates[edge.coordinates.length - 1] = snappedCoord;
    }
  }
}

function addSignalFeature(
  topo: BaseTopologyLayer,
  annotation: RailGraphAnnotation,
): void {
  if (!annotation.signal) {
    return;
  }
  const id = annotation.id as EntityRef;
  const originalEdge = annotation.signal.edgeRef;
  const originalMeasure = clampMeasure(annotation.signal.measure);

  const resolved = resolveEdgeAndMeasure(topo, originalEdge, originalMeasure);
  if (!resolved) return;

  topo.signals.push({
    id,
    edgeRef: resolved.edgeId as EntityRef,
    measure: resolved.measure,
    facing: annotation.signal.facing,
    name: annotation.signal.name,
  });
}

function addBindings(topo: BaseTopologyLayer, diagnostics: Diagnostic[]): void {
  for (const [index, input] of state.bindings.entries()) {
    if (!topo.stations.some((station) => station.id === input.stationRef)) {
      diagnostics.push(diagnostic("error", "MVP_BINDING_MISSING_STATION", "compile", "Binding references a missing station.", { index, stationRef: input.stationRef }));
      continue;
    }
    if (!topo.platforms.some((platform) => platform.id === input.platformRef)) {
      diagnostics.push(diagnostic("error", "MVP_BINDING_MISSING_PLATFORM", "compile", "Binding references a missing platform.", { index, platformRef: input.platformRef }));
      continue;
    }

    const activeEdges = resolveAllSplitEdges(topo, input.edgeRef);
    if (activeEdges.length === 0) {
      diagnostics.push(diagnostic("error", "MVP_BINDING_MISSING_EDGE", "compile", "Binding references a missing edge.", { index, edgeRef: input.edgeRef }));
      continue;
    }

    for (const edgeId of activeEdges) {
      const id = stableId("manual", "binding", `${input.stationRef}:${input.platformRef}:${edgeId}:${index}`);
      topo.platformTrackBindings.push({
        id,
        stationRef: input.stationRef as EntityRef,
        platformRef: input.platformRef as EntityRef,
        edgeRef: edgeId as EntityRef,
        side: input.side,
        servingDirection: input.servingDirection,
      });
      topo.relations.push({
        id: stableId("manual", "relation", id),
        kind: "platform_serves_track",
        fromRef: input.platformRef as EntityRef,
        toRef: edgeId as EntityRef,
        payload: { stationRef: input.stationRef, side: input.side },
      });
    }
  }
}

function addStoppingPoints(topo: BaseTopologyLayer, diagnostics: Diagnostic[]): void {
  for (const [index, input] of state.stoppingPoints.entries()) {
    if (!topo.stations.some((station) => station.id === input.stationRef)) {
      diagnostics.push(diagnostic("error", "MVP_STOP_MISSING_STATION", "compile", "Stopping point references a missing station.", { index, stationRef: input.stationRef }));
      continue;
    }
    if (!topo.platforms.some((platform) => platform.id === input.platformRef)) {
      diagnostics.push(diagnostic("error", "MVP_STOP_MISSING_PLATFORM", "compile", "Stopping point references a missing platform.", { index, platformRef: input.platformRef }));
      continue;
    }

    const resolved = resolveEdgeAndMeasure(topo, input.edgeRef, input.measure);
    if (!resolved) {
      diagnostics.push(diagnostic("error", "MVP_STOP_MISSING_EDGE", "compile", "Stopping point references a missing edge.", { index, edgeRef: input.edgeRef }));
      continue;
    }

    const { edgeId, measure } = resolved;

    const matchingBinding = topo.platformTrackBindings.find((binding) => {
      if (binding.platformRef !== input.platformRef) return false;
      if (binding.edgeRef !== edgeId) return false;
      if (input.direction === "both") return true;
      if (!binding.servingDirection) return true;
      return binding.servingDirection === input.direction;
    });
    if (!matchingBinding) {
      diagnostics.push(diagnostic(
        "warn",
        "MVP_STOP_NO_MATCHING_BINDING",
        "compile",
        "Stopping point has no matching PlatformTrackBinding for (platform, edge, direction).",
        {
          index,
          platformRef: input.platformRef,
          edgeRef: edgeId,
          direction: input.direction,
        },
      ));
    }

    topo.stoppingPoints.push({
      id: stableId("manual", "stoppingPoint", `${input.stationRef}:${input.platformRef}:${edgeId}:${input.direction}:${measure}`),
      stationRef: input.stationRef as EntityRef,
      platformRef: input.platformRef as EntityRef,
      edgeRef: edgeId as EntityRef,
      direction: input.direction,
      measure: clampMeasure(measure),
      confirmation: "confirmed",
    });
  }
}

function getFeature(featureIndex: number): GeoJsonFeature {
  if (!state.source) {
    throw new Error("No GeoJSON source loaded.");
  }
  const feature = state.source.features[featureIndex];
  if (!feature) {
    throw new Error(`Feature index ${featureIndex} does not exist.`);
  }
  return feature;
}

function ensureNode(
  topo: BaseTopologyLayer,
  nodeRef: EntityRef,
  kind: TopologyNode["kind"],
  coordinate: GeoJSONPosition,
): void {
  if (topo.nodes.some((node) => node.id === nodeRef)) {
    return;
  }
  topo.nodes.push({
    id: nodeRef,
    kind,
    geometryRef: stableId("manual", "position", coordinateKey(coordinate)),
  });
}

function firstStationRef(topo: BaseTopologyLayer): EntityRef | undefined {
  return topo.stations[0]?.id;
}

function lineStringsFromGeometry(geometry: GeoJsonGeometry): GeoJSONPosition[][] {
  if (geometry.type === "LineString") {
    return [geometry.coordinates];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates;
  }
  return [];
}

function isFeatureCollection(value: unknown): value is GeoJsonFeatureCollection {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as Partial<GeoJsonFeatureCollection>;
  return maybe.type === "FeatureCollection" && Array.isArray(maybe.features);
}

function dedupeFeatures(features: GeoJsonFeature[]): { features: GeoJsonFeature[]; skipped: number } {
  const seen = new Set<string>();
  const out: GeoJsonFeature[] = [];
  let skipped = 0;

  for (const feature of features) {
    const key = featureFingerprint(feature);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    out.push(feature);
  }

  return { features: out, skipped };
}

function featureFingerprint(feature: GeoJsonFeature): string {
  return `${feature.geometry.type}:${JSON.stringify(feature.geometry.coordinates)}:${String(feature.properties.name ?? "")}`;
}

function createGeometry(
  geometryType: "Point" | "LineString" | "Polygon",
  coordinates: GeoJSONPosition | GeoJSONPosition[] | GeoJSONPosition[][],
): GeoJsonGeometry {
  if (geometryType === "Point") {
    if (!isPosition(coordinates)) {
      throw new Error("Point coordinates must be [lng, lat].");
    }
    return { type: "Point", coordinates };
  }

  if (geometryType === "LineString") {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(isPosition)) {
      throw new Error("LineString coordinates must be [[lng, lat], ...] with at least two points.");
    }
    return { type: "LineString", coordinates };
  }

  if (!Array.isArray(coordinates) || coordinates.length < 1 || !Array.isArray(coordinates[0])) {
    throw new Error("Polygon coordinates must be [[[lng, lat], ...]].");
  }

  const ring = coordinates[0] as GeoJSONPosition[];
  if (ring.length < 4 || !ring.every(isPosition)) {
    throw new Error("Polygon outer ring needs at least four [lng, lat] points.");
  }
  return { type: "Polygon", coordinates: coordinates as GeoJSONPosition[][] };
}

function isPosition(value: unknown): value is GeoJSONPosition {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number";
}

function cloneTopo(topo: BaseTopologyLayer): BaseTopologyLayer {
  return JSON.parse(JSON.stringify(topo)) as BaseTopologyLayer;
}

function diagnostic(
  level: Diagnostic["level"],
  code: string,
  stage: string,
  message: string,
  context?: Record<string, unknown>,
): Diagnostic {
  return { level, code, stage, message, context };
}

function stableId(source: string, entityType: string, value: string): EntityRef {
  return `${source}:${entityType}:${slug(String(value))}` as EntityRef;
}

function nodeIdForCoordinate(coordinate: GeoJSONPosition): EntityRef {
  return stableId("manual", "node", coordinateKey(coordinate));
}

function extractSourceTags(properties: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const sourceTags = properties.sourceTags;
  if (sourceTags && typeof sourceTags === "object") {
    for (const [k, v] of Object.entries(sourceTags as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  for (const [k, v] of Object.entries(properties)) {
    if (k === "railGraph" || k === "sourceTags") continue;
    if (v === undefined || v === null || v === "") continue;
    if (out[k] !== undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function coordinateKey(coordinate: GeoJSONPosition): string {
  return `${coordinate[0].toFixed(ENDPOINT_PRECISION)},${coordinate[1].toFixed(ENDPOINT_PRECISION)}`;
}

function slug(value: string): string {
  const strVal = String(value ?? "");
  let hash = 0;
  for (let index = 0; index < strVal.length; index += 1) {
    hash = (hash * 31 + strVal.charCodeAt(index)) >>> 0;
  }
  return `${strVal.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "id"}-${hash.toString(16)}`;
}

function clampMeasure(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function calculateLengthMeters(coordinates: GeoJSONPosition[]): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceMeters(coordinates[index - 1], coordinates[index]);
  }
  return total;
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

function setupShellGutters(root: HTMLElement): void {
  const shell = root.querySelector<HTMLElement>(".shell");
  if (!shell) return;
  const gutters = shell.querySelectorAll<HTMLElement>(".panel-gutter");
  gutters.forEach((gutter) => {
    const which = gutter.dataset.gutter;
    const isRight = which !== "left";
    const varName = isRight ? "--shell-right" : "--shell-left";
    setupResizableGutter(gutter, {
      direction: "horizontal",
      container: shell,
      varName,
      minSize: 200,
      defaultSize: isRight ? 380 : 320,
      anchorFromEnd: isRight,
    });
  });
}

function setupResizableGutter(
  gutter: HTMLElement,
  opts: {
    direction: "horizontal" | "vertical";
    container: HTMLElement;
    varName: string;
    minSize: number;
    defaultSize: number;
    anchorFromEnd?: boolean;
  },
): void {
  let dragging = false;
  gutter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    gutter.classList.add("dragging");
    document.body.style.cursor = opts.direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = opts.container.getBoundingClientRect();
    // 右/底锚定 panel 的宽度 = 容器右(底)边距 - 鼠标位置; 否则 = 鼠标 - 左(顶)边距
    const size = opts.direction === "horizontal"
      ? (opts.anchorFromEnd ? rect.right - e.clientX : e.clientX - rect.left)
      : (opts.anchorFromEnd ? rect.bottom - e.clientY : e.clientY - rect.top);
    // 计算可用空间 — 加上 minSize*2 是左右/上下最少各自一个 panel 的空间
    const maxSingle = opts.direction === "horizontal"
      ? rect.width - opts.minSize * 2 - 8  // 8 = 2 gutters
      : rect.height - opts.minSize * 2 - 8;
    const clamped = Math.max(opts.minSize, Math.min(maxSingle, Math.round(size)));
    opts.container.style.setProperty(opts.varName, `${clamped}px`);
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    gutter.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // 保存到本地存储
    const val = opts.container.style.getPropertyValue(opts.varName);
    if (val) {
      try { localStorage.setItem(`mvp-gutter-${opts.varName}`, val); } catch { /* ignore */ }
    }
  });
  // 恢复保存值
  try {
    const saved = localStorage.getItem(`mvp-gutter-${opts.varName}`);
    if (saved) opts.container.style.setProperty(opts.varName, saved);
  } catch { /* ignore */ }
}

function render(): void {
  const root = document.getElementById("rail-graph-mvp");
  if (!root) {
    return;
  }

  // 仅在首次渲染时建结构; 后续调用走 refreshViews() / renderWorkflowChrome()
  if (root.dataset.mounted === "true") {
    refreshViews();
    renderWorkflowChrome();
    return;
  }

  root.innerHTML = `
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f1f5f9; color: #0f172a; }
      .shell { display: grid; grid-template-columns: var(--shell-left, 380px) 4px 1fr 4px var(--shell-right, 430px); gap: 0; height: 100vh; padding: 10px; box-sizing: border-box; background: #f1f5f9; }
      .panel-gutter { cursor: col-resize; background: transparent; transition: background 120ms; user-select: none; border-radius: 2px; }
      .panel-gutter:hover, .panel-gutter.dragging { background: #0d9488; }
      .panel { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
      .panel h1, .panel h2 { margin: 0; padding: 12px; border-bottom: 1px solid #cbd5e1; font-size: 14px; background: #f8fafc; color: #0f172a; font-weight: 700; }
      .workspace-bar { padding: 8px 12px; border-bottom: 1px solid #cbd5e1; display: flex; gap: 8px; align-items: center; background: #f8fafc; }
      .workspace-actions { display: flex; gap: 4px; }
      .body { padding: 10px; overflow-y: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
      textarea { width: 100%; min-height: 60px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; background: #ffffff; color: #0f172a; }
      button, select, input { font: inherit; }
      button { border: 1px solid #cbd5e1; background: #ffffff; color: #334155; border-radius: 6px; padding: 5px 8px; cursor: pointer; font-size: 11.5px; transition: all 150ms; font-weight: 500; }
      button:hover { background: #f1f5f9; border-color: #cbd5e1; }
      button.primary { background: #155e75; color: #fff; border-color: #155e75; }
      button.primary:hover { background: #164e63; }
      button.strong { background: #0284c7; color: #ffffff; border-color: #0284c7; font-weight: 600; }
      button.strong:hover { background: #0369a1; }
      button.danger { color: #ffffff; border-color: #dc2626; background: #dc2626; }
      button.danger:hover { background: #b91c1c; }
      button:disabled { opacity: .4; cursor: not-allowed; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 4px 0; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .field { display: grid; gap: 3px; font-size: 11px; color: #475569; }
      .field input, .field select { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px; min-width: 0; font-size: 11.5px; background: #ffffff; color: #0f172a; }
      .field.full { grid-column: 1 / -1; }
      .work-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #ffffff; display: flex; flex-direction: column; }
      .work-card h3 { margin: 0 0 8px; font-size: 12.5px; color: #0f172a; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 700; }
      .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 6px; }
      .metric { border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px; background: #f8fafc; text-align: center; }
      .metric b { display: block; font-size: 13px; color: #0284c7; }
      .metric span { display: block; font-size: 9.5px; color: #64748b; }
      .status-line { font-size: 11px; color: #475569; line-height: 1.4; }
      .workspace-title { display: grid; gap: 2px; }
      .workspace-title strong { font-size: 12.5px; color: #0f172a; }
      .workspace-title span { font-size: 10.5px; color: #64748b; }
      .artifact-select { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px; font-size: 11.5px; background: #ffffff; color: #0f172a; }
      .log-box { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 8px; font: 10.5px ui-monospace, SFMono-Regular, Consolas, monospace; max-height: 150px; overflow-y: auto; white-space: pre-wrap; color: #0f766e; }
      .artifact-list { display: grid; gap: 4px; max-height: 140px; overflow-y: auto; }
      .artifact { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; font-size: 11px; background: #f8fafc; transition: all 120ms; cursor: pointer; }
      .artifact:hover { border-color: #0284c7; background: #f1f5f9; }
      .artifact code { color: #0f172a; font-size: 9.5px; word-break: break-all; }
      .pill { display: inline-flex; align-items: center; border-radius: 999px; border: 1px solid #cbd5e1; padding: 1px 6px; font-size: 9.5px; color: #475569; background: #f1f5f9; }
      .pill.done { color: #065f46; border-color: #a7f3d0; background: #d1fae5; }
      .pill.running { color: #0369a1; border-color: #bae6fd; background: #e0f2fe; }
      .pill.error { color: #991b1b; border-color: #fca5a5; background: #fee2e2; }
      .pill.blocked { color: #475569; border-color: #cbd5e1; background: #f1f5f9; }
      .pill.ready { color: #78350f; border-color: #fde68a; background: #fef3c7; }
      .pill.stale { color: #7c2d12; border-color: #fed7aa; background: #ffedd5; }
      .map-panel { padding: 0; }
      #mvp-map { flex: 1; min-height: 0; height: 100%; }
      .map-toolbar { padding: 8px 12px; border-bottom: 1px solid #cbd5e1; display: flex; gap: 8px; align-items: center; font-size: 12px; flex-shrink: 0; background: #f8fafc; color: #0f172a; }
      .list-panel-body { padding: 0; background: #ffffff; border-left: 1px solid #cbd5e1; }

      /* Stepper styles */
      .stepper-container { display: flex; flex-direction: column; gap: 6px; }
      .step-card { border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #ffffff; transition: all 180ms ease; }
      .step-card.active { border-color: #0d9488; }
      .step-card.active.running { animation: pulse-teal 1.5s infinite ease-in-out; }
      .step-card.recommended { border-color: #f59e0b; }
      .step-header { padding: 10px 12px; background: #ffffff; cursor: pointer; display: flex; align-items: center; gap: 8px; user-select: none; font-weight: 700; font-size: 12px; color: #334155; }
      .step-header:hover { background: #f1f5f9; }
      .step-card.active .step-header { background: #155e75; color: #ffffff; }
      .step-body { padding: 10px 12px; display: none; background: #f8fafc; border-top: 1px solid #e2e8f0; }
      .step-card.active .step-body { display: block; }
      .step-circle { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: #cbd5e1; color: #475569; font-size: 10px; font-weight: 700; flex-shrink: 0; }
      .step-card.active .step-circle { background: #38bdf8; color: #0f172a; }
      .step-card.done .step-circle { background: #34d399; color: #0f172a; }
      .step-card.stale .step-circle { background: #fb923c; color: #0f172a; }
      .step-card.error .step-circle { background: #ef4444; color: #ffffff; }

      /* Settings and New Workspace panel form styles */
      .settings-panel, .new-workspace-panel { padding: 12px; background: #f8fafc; border-bottom: 1px solid #cbd5e1; display: none; }
      .settings-panel.open, .new-workspace-panel.open { display: block; }
      .icon-btn { border: 1px solid #cbd5e1; background: #ffffff; color: #334155; border-radius: 4px; padding: 4px 8px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 120ms; font-size: 11px; }
      .icon-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
      .icon-btn.active { background: #155e75; color: #ffffff; border-color: #155e75; }

      @keyframes pulse-teal {
        0%, 100% { box-shadow: 0 0 0 1px #0d9488; }
        50% { box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.6); }
      }
    </style>
    <main class="shell">
      <section class="panel">
        <h1>Rail Graph MVP</h1>
        <div class="workspace-bar">
          <label class="field" style="flex:1;">
            <select id="mvp-workspace-select" style="width:100%;"></select>
          </label>
          <div class="workspace-actions">
            <button id="mvp-toggle-settings" class="icon-btn" title="Global Settings">⚙️ Settings</button>
            <button id="mvp-toggle-new-workspace" class="icon-btn" title="New Workspace">＋ New</button>
          </div>
        </div>

        <div id="settings-panel-form" class="settings-panel">
          <div style="font-weight:600; font-size:12px; margin-bottom:8px; color:#0f172a;">Global Path Configurations</div>
          <div class="grid">
            <div class="field">
              <label>Scripts Directory</label>
              <input type="text" id="settings-scripts-root" value="" />
              <span id="settings-scripts-root-badge" style="font-size:10px;"></span>
            </div>
            <div class="field">
              <label>OSM PBF File Path</label>
              <input type="text" id="settings-pbf-path" value="" />
              <span id="settings-pbf-path-badge" style="font-size:10px;"></span>
            </div>
            <div class="field">
              <label>Cache Database Path</label>
              <input type="text" id="settings-cache-db-path" value="" />
              <span id="settings-cache-db-path-badge" style="font-size:10px;"></span>
            </div>
            <div class="field">
              <label>OSM Output Dir</label>
              <input type="text" id="settings-osm-output" value="" />
              <span id="settings-osm-output-badge" style="font-size:10px;"></span>
            </div>
            <div class="field">
              <label>Matched Output Dir</label>
              <input type="text" id="settings-matched-output" value="" />
              <span id="settings-matched-output-badge" style="font-size:10px;"></span>
            </div>
            <div class="field">
              <label>Company GeoJSON Dir</label>
              <input type="text" id="settings-geojson-source" value="" />
              <span id="settings-geojson-source-badge" style="font-size:10px;"></span>
            </div>
          </div>
          <div class="row" style="margin-top: 8px; justify-content: flex-end;">
            <button id="mvp-scan-settings" class="primary strong">Scan & Save</button>
          </div>
        </div>

        <div id="new-workspace-panel-form" class="new-workspace-panel">
          <div style="font-weight:600; font-size:12px; margin-bottom:8px; color:#0f172a;">Create New Workspace</div>
          <div class="field full" style="margin-bottom: 6px;">
            <label>Workspace Name</label>
            <input type="text" id="new-workspace-name" placeholder="E.g. Yamanote Line Workspace" style="width:100%;" />
          </div>
          <div class="grid">
            <div class="field">
              <label>Company</label>
              <select id="new-workspace-company"></select>
            </div>
            <div class="field">
              <label>Line</label>
              <select id="new-workspace-line"></select>
            </div>
          </div>
          <div id="new-workspace-file-status" style="font-size: 11px; margin-top: 8px; padding: 6px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; color: #334155; display: none;"></div>
          <div class="row" style="margin-top: 10px; justify-content: flex-end;">
            <button id="mvp-create-workspace-btn" class="primary strong" disabled>Create Workspace</button>
          </div>
        </div>

        <div class="body">
          <div class="work-card">
            <h3>Active Workspace <span class="pill" id="mvp-workspace-status">ready</span></h3>
            <div class="workspace-title" id="mvp-workspace-summary"></div>
          </div>

          <div class="work-card" style="display: flex; flex-direction: column;">
            <h3 style="display:flex; justify-content:space-between; align-items:center;">
              Workflow Accordion
              <button id="mvp-run-auto" class="primary strong" style="font-size: 10.5px; padding: 3px 8px;">Auto-Run Pipeline</button>
            </h3>
            <div class="stepper-container" id="mvp-workflow-steps"></div>
          </div>

          <div class="work-card" style="display: flex; flex-direction: column; min-height: 0; max-height: 200px;">
            <h3 style="cursor:pointer; margin:0 0 6px; display:flex; justify-content:space-between; align-items:center; user-select:none;" id="log-card-header">
              Console Log Console
              <span style="display:flex; align-items:center; gap:6px;">
                <span class="pill" id="mvp-task-status" style="font-size: 9px; padding: 0px 4px;">idle</span>
                <span id="log-toggle-icon">▼</span>
              </span>
            </h3>
            <div id="mvp-pipeline-progress" style="display:none; padding: 6px 4px; border-bottom: 1px solid #e2e8f0; margin-bottom: 4px;"></div>
            <div id="log-card-body" style="display: flex; flex-direction: column; gap: 6px; min-height: 0; flex:1;">
              <div class="log-box" id="mvp-task-log" style="flex:1;">No local task has run yet.</div>
              <div class="row" style="justify-content: flex-end; margin: 0;">
                <button id="mvp-cancel-stage" class="danger" style="padding: 2px 6px; font-size: 10px;" disabled>Cancel Task</button>
              </div>
            </div>
          </div>

          <div class="work-card" style="max-height: 120px;">
            <h3 style="margin-bottom:4px;">Artifacts</h3>
            <div class="artifact-list" id="mvp-artifacts"></div>
          </div>

          <div class="work-card" style="max-height: 100px;">
            <h3 style="margin-bottom:4px;">Workspace State</h3>
            <div class="metric-grid" id="mvp-summary-metrics"></div>
            <textarea id="mvp-input" placeholder="Exports and debug JSON appear here" style="margin-top:2px; min-height:36px; height: 36px;"></textarea>
          </div>

          <div id="mvp-features" style="display:none"></div>
        </div>
      </section>
      <div class="panel-gutter" data-gutter="left"></div>
      <section class="panel map-panel" style="position:relative;">
        <div class="map-toolbar">
          <strong>Map</strong>
          <span style="flex:1"></span>
          <label class="field" style="display:flex;flex-direction:row;align-items:center;gap:4px;font-size:11px">
            Base
            <select id="mvp-base-layer" style="font-size:11px">
              <option value="positron">Positron (lite)</option>
              <option value="plain">Plain</option>
            </select>
          </label>
          <button id="mvp-fit-data" style="font-size:11px">Fit</button>
        </div>
        <div id="mvp-map"></div>
        <div id="mvp-box-select-bar" style="position:absolute; bottom:16px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:1px solid #cbd5e1; border-radius:8px; padding:8px 12px; display:none; gap:8px; align-items:center; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); z-index:1000;">
          <span style="font-size:12px; font-weight:600; color:#1e293b;">Selected <span id="mvp-box-select-count">0</span> items:</span>
          <button id="mvp-box-select-keep" style="font-size:11px; padding:3px 8px; background:#16a34a; border-color:#16a34a; color:#fff; font-weight:600;">Keep</button>
          <button id="mvp-box-select-remove" class="danger" style="font-size:11px; padding:3px 8px; font-weight:600;">Remove</button>
          <button id="mvp-box-select-cancel" style="font-size:11px; padding:3px 8px;">Cancel</button>
        </div>
      </section>
      <div class="panel-gutter" data-gutter="right"></div>
      <section class="panel list-panel-body">
        <div id="mvp-list" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
      </section>
    </main>
  `;
  root.dataset.mounted = "true";

  setupShellGutters(root);

  initViews();
  renderWorkflowChrome();
  bindUi();
  bindPipelineUi();
  void loadAllCleanDecisions().then(() => {
    refreshViews();
    mapView?.fitToData();
  });
}

// 将 candidateId 映射到拓扑层 ID 列表 / Map candidate ID to topology layer IDs
function findTopologyIdsForCandidate(candidateId: string): string[] {
  if (!state.topo || !state.source) return [];
  const ids: string[] = [];
  
  const getFid = (feature: any) => {
    if (!feature) return null;
    const p = feature.properties || {};
    return `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}:${p.source_line_name || ""}`;
  };

  // Check edges
  for (const edge of state.topo.edges) {
    const sourceRef = edge.sourceSlice?.sourceFeatureRef;
    if (sourceRef) {
      const feature = state.source.features.find((f) => f.properties.railGraph?.id === sourceRef);
      if (getFid(feature) === candidateId) {
        ids.push(edge.id);
      }
    }
  }

  // Check platforms
  for (const platform of state.topo.platforms) {
    const feature = state.source.features.find((f) => f.properties.railGraph?.id === platform.id);
    if (getFid(feature) === candidateId) {
      ids.push(platform.id);
    }
  }
  
  return ids;
}

function initViews(): void {
  const mapContainer = document.getElementById("mvp-map");
  const listContainer = document.getElementById("mvp-list");
  if (!mapContainer || !listContainer) return;

  mapView = createMapView(mapContainer);
  listView = createListView(listContainer);

  // 联动: map ↔ list
  // hover entity (map): 高亮 entity + related, 但 sticky 保留已选 path
  mapView.onHover((ref) => {
    if (!listView) return;
    listView.highlightEntity(ref);
    if (ref) {
      const related = computeRelatedRefs(ref);
      mapView?.highlightEntities([ref], related);
    } else {
      mapView?.clearEntityHighlight();
    }
  });
  mapView.onClick(async (ref) => {
    listView?.highlightEntity(ref);
    listView?.selectFeatureByRef(ref);
    
    let fid: string | null = null;
    if (state.source) {
      const feature = state.source.features.find((f) => f.properties.railGraph?.id === ref);
      if (feature) {
        const p = feature.properties || {};
        fid = `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}:${p.source_line_name || ""}`;
      }
    }
    if (!fid && state.topo) {
      const edge = state.topo.edges.find((e) => e.id === ref);
      if (edge) {
        const sourceRef = edge.sourceSlice?.sourceFeatureRef;
        if (sourceRef && state.source) {
          const feature = state.source.features.find((f) => f.properties.railGraph?.id === sourceRef);
          if (feature) {
            const p = feature.properties || {};
            fid = `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}:${p.source_line_name || ""}`;
          }
        }
      } else {
        const platform = state.topo.platforms.find((p) => p.id === ref);
        if (platform && state.source) {
          const feature = state.source.features.find((f) => f.properties.railGraph?.id === platform.id);
          if (feature) {
            const p = feature.properties || {};
            fid = `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}:${p.source_line_name || ""}`;
          }
        } else {
          const station = state.topo.stations.find((s) => s.id === ref);
          if (station && state.source) {
            const feature = state.source.features.find((f) => f.properties.railGraph?.id === station.id);
            if (feature) {
              const p = feature.properties || {};
              fid = `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}:${p.source_line_name || ""}`;
            }
          }
        }
      }
    }

    if (fid) {
      if (cleanSelectMode) {
        const removeSet = new Set(cleanOverrides?.remove || []);
        const keepSet = new Set(cleanOverrides?.keep || []);
        
        if (removeSet.has(fid)) {
          removeSet.delete(fid);
        } else {
          removeSet.add(fid);
          keepSet.delete(fid);
        }

        await updateCleanOverrides(Array.from(keepSet), Array.from(removeSet), cleanOverrides?.meta || {});
      } else {
        cleanSelectedCandidateFid = fid;
        refreshViews();
      }
    }
  });

  // hover entity (list): 同 map.onHover, 不动 path
  listView.onEntityHover((ref) => {
    if (ref) {
      const refStr = ref as unknown as string;
      if (refStr.startsWith("way:") || refStr.startsWith("node:")) {
        const topoIds = findTopologyIdsForCandidate(refStr);
        if (topoIds.length > 0) {
          mapView?.highlightEntities(topoIds as unknown as EntityRef[]);
        }
      } else {
        const related = computeRelatedRefs(ref);
        mapView?.highlightEntities([ref], related);
      }
    } else {
      mapView?.clearEntityHighlight();
    }
  });
  listView.onEntityClick((ref) => {
    if (ref) {
      const refStr = ref as unknown as string;
      if (refStr.startsWith("way:") || refStr.startsWith("node:")) {
        const topoIds = findTopologyIdsForCandidate(refStr);
        if (topoIds.length > 0) {
          mapView?.fitToEntities(topoIds);
        }
      } else {
        mapView?.fitToEntities([refStr]);
      }
    }
  });

  // hover/click path candidate: 高亮 path, 不动 entity
  listView.onPathHover((path) => {
    if (path) {
      mapView?.highlightPath(path.edgeSequence, path.turnbackEdgeIndices, path.resolvedChain);
    } else {
      mapView?.clearPathHighlight();
    }
  });
  listView.onPathClick((path) => {
    mapView?.highlightPath(path.edgeSequence, path.turnbackEdgeIndices, path.resolvedChain);
  });

  // Annotate tab: 写回 Feature.properties.railGraph + 持久化到 localStorage + 触发 compile/map 重渲
  listView.onAnnotationChange(({ featureIdx, annotation }) => {
    if (!state.source) return;
    const features = state.source.features;
    if (featureIdx < 0 || featureIdx >= features.length) return;
    const target = features[featureIdx];
    features[featureIdx] = {
      ...target,
      properties: {
        ...target.properties,
        railGraph: annotation,
      },
    };
    if (annotation.id) saveAnnotationOverride(annotation.id, annotation);
    try { compileTopology(); } catch (error) { handleError(error); }
    setStepProgress("annotate", {
      status: "done",
      summary: "Annotations changed. Compile, validation, and exports are now stale.",
      completedActions: dedupe([...(activeWorkspace().progress.annotate.completedActions ?? []), "loadWorkspaceSource"]),
      diagnostics: diagnosticSummaries(),
    });
    invalidateDownstream("annotate", "Annotations changed after this step. Re-run from compile.");
    refreshViews();
  });

  // Annotate tab: 批量 annotation 变更 — 写回全部 + 编译一次
  listView.onAnnotationBatch((payloads) => {
    if (!state.source) return;
    const features = state.source.features;
    for (const { featureIdx, annotation } of payloads) {
      if (featureIdx < 0 || featureIdx >= features.length) continue;
      features[featureIdx] = {
        ...features[featureIdx],
        properties: {
          ...features[featureIdx].properties,
          railGraph: annotation,
        },
      };
      if (annotation.id) saveAnnotationOverride(annotation.id, annotation);
    }
    console.log(`[annotate] batch applied ${payloads.length} changes`);
    try { compileTopology(); } catch (error) { handleError(error); }
    setStepProgress("annotate", {
      status: "done",
      summary: `Batch annotation applied ${payloads.length} change(s). Compile, validation, and exports are now stale.`,
      completedActions: dedupe([...(activeWorkspace().progress.annotate.completedActions ?? []), "loadWorkspaceSource"]),
      diagnostics: diagnosticSummaries(),
    });
    invalidateDownstream("annotate", "Annotations changed after this step. Re-run from compile.");
    refreshViews();
  });

  // New clean overrides callbacks
  listView.onCleanOverrideChange(async (fid, action, reason) => {
    const keepSet = new Set(cleanOverrides?.keep || []);
    const removeSet = new Set(cleanOverrides?.remove || []);
    const meta = { ...(cleanOverrides?.meta || {}) };

    if (action === "keep") {
      keepSet.add(fid);
      removeSet.delete(fid);
      meta[fid] = { ...(meta[fid] || {}), reason };
    } else if (action === "remove") {
      removeSet.add(fid);
      keepSet.delete(fid);
      meta[fid] = { ...(meta[fid] || {}), reason };
    } else if (action === "reset") {
      keepSet.delete(fid);
      removeSet.delete(fid);
      delete meta[fid];
    }

    await updateCleanOverrides(Array.from(keepSet), Array.from(removeSet), meta);
  });

  listView.onCleanFilterToggle((ruleId, checked) => {
    cleanFilters[ruleId] = checked;
    compileCleanDecisions();
    try {
      compileTopology();
    } catch (err) {
      handleError(err);
    }
    refreshViews();
  });

  listView.onCleanLevelToggle((level, checked) => {
    cleanLevels[level] = checked;
    refreshViews();
  });

  listView.onCleanSearch((query) => {
    cleanSearchQuery = query;
    refreshViews();
  });

  listView.onCleanSelectModeToggle((active) => {
    cleanSelectMode = active;
    refreshViews();
  });

  listView.onCleanCandidateSelect((fid) => {
    cleanSelectedCandidateFid = fid;
    if (fid) {
      let ref: EntityRef | null = null;
      if (state.source) {
        const feature = state.source.features.find((f) => {
          const props = (f.properties || {}) as any;
          const f_id = `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
          return f_id === fid;
        });
        if (feature?.properties?.railGraph?.id) {
          ref = feature.properties.railGraph.id as EntityRef;
        }
      }
      if (ref) {
        mapView?.fitToEntities([ref]);
        mapView?.highlightEntities([ref]);
      } else if (state.topo) {
        const topoIds = findTopologyIdsForCandidate(fid);
        if (topoIds.length > 0) {
          mapView?.fitToEntities(topoIds);
          mapView?.highlightEntities(topoIds as unknown as EntityRef[]);
        }
      }
    }
    refreshViews();
  });

  // Map box selection callback
  mapView.onBoxSelect((fids) => {
    if (!fids || fids.length === 0) return;
    
    mapView?.highlightBoxSelect(fids);

    const bar = document.getElementById("mvp-box-select-bar");
    const countEl = document.getElementById("mvp-box-select-count");
    if (bar && countEl) {
      countEl.textContent = String(fids.length);
      bar.style.display = "flex";
    }

    const keepBtn = document.getElementById("mvp-box-select-keep");
    const removeBtn = document.getElementById("mvp-box-select-remove");
    const cancelBtn = document.getElementById("mvp-box-select-cancel");

    const clearBar = () => {
      bar!.style.display = "none";
      mapView?.clearBoxSelectHighlight();
      
      keepBtn?.replaceWith(keepBtn.cloneNode(true));
      removeBtn?.replaceWith(removeBtn.cloneNode(true));
      cancelBtn?.replaceWith(cancelBtn.cloneNode(true));
    };

    const newKeepBtn = document.getElementById("mvp-box-select-keep")!;
    const newRemoveBtn = document.getElementById("mvp-box-select-remove")!;
    const newCancelBtn = document.getElementById("mvp-box-select-cancel")!;

    newCancelBtn.addEventListener("click", () => {
      clearBar();
    });

    newKeepBtn.addEventListener("click", async () => {
      const keepSet = new Set(cleanOverrides?.keep || []);
      const removeSet = new Set(cleanOverrides?.remove || []);
      const meta = { ...(cleanOverrides?.meta || {}) };

      for (const fid of fids) {
        keepSet.add(fid);
        removeSet.delete(fid);
        meta[fid] = { ...(meta[fid] || {}), reason: "Bulk overrides: Keep" };
      }

      await updateCleanOverrides(Array.from(keepSet), Array.from(removeSet), meta);
      clearBar();
    });

    newRemoveBtn.addEventListener("click", async () => {
      const keepSet = new Set(cleanOverrides?.keep || []);
      const removeSet = new Set(cleanOverrides?.remove || []);
      const meta = { ...(cleanOverrides?.meta || {}) };

      for (const fid of fids) {
        removeSet.add(fid);
        keepSet.delete(fid);
        meta[fid] = { ...(meta[fid] || {}), reason: "Bulk overrides: Remove" };
      }

      await updateCleanOverrides(Array.from(keepSet), Array.from(removeSet), meta);
      clearBar();
    });
  });
}

async function updateCleanOverrides(keep: string[], remove: string[], meta: Record<string, any>): Promise<void> {
  const project = activeProject();
  const nextOverride: MvpOverrideState = {
    k: `${project.companyName}__${project.lineName}`,
    keep,
    remove,
    meta
  };
  cleanOverrides = nextOverride;
  invalidatePipelineCache();  // keep/remove 改了, override 决策会变 → 重跑 pipeline

  try {
    await saveOverrides(project.overridePath, nextOverride);
    compileCleanDecisions();
    try {
      compileTopology();
    } catch (err) {
      handleError(err);
    }
    refreshViews();
  } catch (err) {
    handleError(err);
  }
}

// ── localStorage 持久化: annotation overrides ────────────────

const ANNOTATION_OVERRIDES_KEY = "railround:senseki:annotation-overrides:v1";

function loadAnnotationOverrides(): Record<string, RailGraphAnnotation> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(ANNOTATION_OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, RailGraphAnnotation>;
  } catch {
    return {};
  }
}

function saveAnnotationOverride(id: string, annotation: RailGraphAnnotation): void {
  if (typeof localStorage === "undefined") return;
  try {
    const overrides = loadAnnotationOverrides();
    overrides[id] = annotation;
    localStorage.setItem(ANNOTATION_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // quota / privacy mode — silent
  }
}

function applyAnnotationOverrides(): { applied: number; total: number } {
  if (!state.source) return { applied: 0, total: 0 };
  const overrides = loadAnnotationOverrides();
  const total = Object.keys(overrides).length;
  if (total === 0) return { applied: 0, total: 0 };
  let applied = 0;
  state.source = {
    ...state.source,
    features: state.source.features.map((f) => {
      const id = f.properties.railGraph?.id;
      if (id && overrides[id]) {
        applied += 1;
        const targetReversed = !!overrides[id].track?.geometryReversed;
        const currentReversed = !!(f as any)._coordsReversed;
        let nextCoords = f.geometry.coordinates;
        let nextCoordsReversed = currentReversed;
        if (targetReversed !== currentReversed && f.geometry.type === "LineString") {
          nextCoords = [...f.geometry.coordinates].reverse();
          nextCoordsReversed = targetReversed;
        }

        const nextFeature = {
          ...f,
          geometry: {
            ...f.geometry,
            coordinates: nextCoords,
          },
          properties: {
            ...f.properties,
            railGraph: overrides[id],
          },
        };
        (nextFeature as any)._coordsReversed = nextCoordsReversed;
        return nextFeature;
      }
      return f;
    }) as any,
  };
  return { applied, total };
}

function clearAnnotationOverrides(): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(ANNOTATION_OVERRIDES_KEY); } catch { }
}

function computeRelatedRefs(ref: EntityRef): EntityRef[] {
  if (!state.topo) return [];
  const lookup: TopologyLookup = buildTopologyLookup(state.topo);
  const related: EntityRef[] = [];

  // Station ref?
  const station = lookup.stationsById[ref];
  if (station) {
    related.push(...station.platformRefs);
    for (const pid of station.platformRefs) {
      const bindings = lookup.bindingsByPlatform[pid] ?? [];
      for (const b of bindings) related.push(b.edgeRef);
    }
    return dedupe(related);
  }
  // Platform ref?
  const platform = lookup.platformsById[ref];
  if (platform) {
    related.push(platform.stationRef);
    const bindings = lookup.bindingsByPlatform[ref] ?? [];
    for (const b of bindings) related.push(b.edgeRef);
    return dedupe(related);
  }
  // Edge ref?
  const edge = lookup.edgesById[ref];
  if (edge) {
    const bindings = lookup.bindingsByEdge[ref] ?? [];
    for (const b of bindings) {
      related.push(b.platformRef);
      related.push(b.stationRef);
    }
    return dedupe(related);
  }
  return [];
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function refreshViews(): void {
  if (!mapView || !listView) return;

  const currentStep = activeWorkspace().currentStep;
  let activeTab: TabKey | undefined;
  if (currentStep !== lastCurrentStep) {
    if (currentStep === "clean") activeTab = "clean";
    else if (currentStep === "annotate") activeTab = "annotate";
    else if (currentStep === "validate") activeTab = "pathfinding";
    lastCurrentStep = currentStep;
  }

  if (state.source) {
    // 单次共享: getOrRunPipeline 命中 sig 即复用, 不会重复跑.
    const { passFids, report } = getOrRunPipeline();
    const filteredFeatures = state.source.features.filter((f) => passFids.has(fidOf(f)));
    const filteredSource = {
      type: "FeatureCollection" as const,
      features: filteredFeatures,
    };
    mapView.update(state.topo || EMPTY_TOPO, filteredSource, allCleanDecisions);
    listView.update({
      topo: state.topo,
      diagnostics: state.diagnostics,
      pathfindingResults: lastPathfindingResults,
      source: state.source,
      cleanBatch: null,
      cleanOverrides,
      filterRules,
      activeFilters: cleanFilters,
      activeLevels: cleanLevels,
      searchQuery: cleanSearchQuery,
      selectMode: cleanSelectMode,
      selectedCandidateFid: cleanSelectedCandidateFid,
      activeTab,
      cleanPassFids: passFids,
      cleanPipelineReport: report,
    });
  } else {
    listView.update({
      topo: state.topo,
      diagnostics: state.diagnostics,
      pathfindingResults: lastPathfindingResults,
      source: state.source,
      cleanBatch: null,
      cleanOverrides,
      filterRules,
      activeFilters: cleanFilters,
      activeLevels: cleanLevels,
      searchQuery: cleanSearchQuery,
      selectMode: cleanSelectMode,
      selectedCandidateFid: cleanSelectedCandidateFid,
      activeTab,
    });
  }
  renderWorkflowChrome();
}

let showLogs = true;

function renderWorkflowChrome(): void {
  renderWorkspaceSelector();
  renderWorkflowSteps();
  renderTaskState();
  renderPipelineProgress();
  renderSummaryMetrics();
  renderArtifacts();

  // 刷新全局配置显示与扫描状态 / Update settings visual form
  const settingsRootInput = document.getElementById("settings-scripts-root") as HTMLInputElement | null;
  const pbfInput = document.getElementById("settings-pbf-path") as HTMLInputElement | null;
  const cacheInput = document.getElementById("settings-cache-db-path") as HTMLInputElement | null;
  const osmOutputInput = document.getElementById("settings-osm-output") as HTMLInputElement | null;
  const matchedOutputInput = document.getElementById("settings-matched-output") as HTMLInputElement | null;
  const geojsonSourceInput = document.getElementById("settings-geojson-source") as HTMLInputElement | null;

  if (settingsRootInput) settingsRootInput.value = globalSettings.scriptsRoot;
  if (pbfInput) pbfInput.value = globalSettings.pbfPath;
  if (cacheInput) cacheInput.value = globalSettings.cacheDbPath;
  if (osmOutputInput) osmOutputInput.value = globalSettings.osmOutputDir;
  if (matchedOutputInput) matchedOutputInput.value = globalSettings.matchedOutputRoot;
  if (geojsonSourceInput) geojsonSourceInput.value = globalSettings.geojsonSourceDir;

  updateScanResultBadges();

  // 展开或隐藏配置面板 / Expand settings panel
  const settingsPanel = document.getElementById("settings-panel-form");
  if (settingsPanel) {
    if (showSettings) settingsPanel.classList.add("open");
    else settingsPanel.classList.remove("open");
  }

  const toggleSettingsBtn = document.getElementById("mvp-toggle-settings");
  if (toggleSettingsBtn) {
    if (showSettings) toggleSettingsBtn.classList.add("active");
    else toggleSettingsBtn.classList.remove("active");
  }

  // 展开或隐藏新建工作区面板 / Expand new workspace panel
  const newWorkspacePanel = document.getElementById("new-workspace-panel-form");
  if (newWorkspacePanel) {
    if (showNewWorkspace) {
      newWorkspacePanel.classList.add("open");
      populateNewWorkspaceDropdowns();
    } else {
      newWorkspacePanel.classList.remove("open");
    }
  }

  const toggleNewBtn = document.getElementById("mvp-toggle-new-workspace");
  if (toggleNewBtn) {
    if (showNewWorkspace) toggleNewBtn.classList.add("active");
    else toggleNewBtn.classList.remove("active");
  }

  // 控制底栏日志显示 / Toggle bottom console logs panel
  const logCardBody = document.getElementById("log-card-body");
  if (logCardBody) {
    logCardBody.style.display = showLogs ? "flex" : "none";
  }
  const logToggleIcon = document.getElementById("log-toggle-icon");
  if (logToggleIcon) {
    logToggleIcon.textContent = showLogs ? "▼" : "▲";
  }

  // 联动更新 Auto-run 按钮文本 / Auto-run button text
  const runAutoBtn = document.getElementById("mvp-run-auto") as HTMLButtonElement | null;
  if (runAutoBtn) {
    runAutoBtn.textContent = isAutoRunning ? "Auto-Running..." : "Auto-Run Pipeline";
    if (isAutoRunning) runAutoBtn.classList.add("pulse-running");
    else runAutoBtn.classList.remove("pulse-running");
    runAutoBtn.disabled = isAutoRunning;
  }
}

function updateScanResultBadges(): void {
  const scriptsBadge = document.getElementById("settings-scripts-root-badge");
  const pbfBadge = document.getElementById("settings-pbf-path-badge");
  const cacheBadge = document.getElementById("settings-cache-db-path-badge");
  const osmOutputBadge = document.getElementById("settings-osm-output-badge");
  const matchedOutputBadge = document.getElementById("settings-matched-output-badge");
  const geojsonSourceBadge = document.getElementById("settings-geojson-source-badge");

  if (!scanResult) return;

  if (scriptsBadge) {
    scriptsBadge.innerHTML = scanResult.scriptsRoot.ok 
      ? '<span style="color:#34d399;">✅ Scripts directory valid (8/8 found)</span>'
      : `<span style="color:#f87171;">❌ Missing scripts in directory</span>`;
  }
  if (pbfBadge) {
    pbfBadge.innerHTML = scanResult.pbf.exists
      ? `<span style="color:#34d399;">✅ OSM PBF found (${formatBytes(scanResult.pbf.size)})</span>`
      : '<span style="color:#f87171;">❌ OSM PBF file not found</span>';
  }
  if (cacheBadge) {
    cacheBadge.innerHTML = scanResult.cacheDb.exists
      ? `<span style="color:#34d399;">✅ Cache database found (${formatBytes(scanResult.cacheDb.size)})</span>`
      : '<span style="color:#f87171;">❌ Cache database not found</span>';
  }
  if (osmOutputBadge) {
    osmOutputBadge.innerHTML = scanResult.osmOutputDir.exists
      ? '<span style="color:#34d399;">✅ Output directory exists</span>'
      : '<span style="color:#f87171;">❌ Output directory not found</span>';
  }
  if (matchedOutputBadge) {
    matchedOutputBadge.innerHTML = scanResult.matchedOutputRoot.exists
      ? `<span style="color:#34d399;">✅ Matched directory valid (${scanResult.matchedOutputRoot.companies.length} companies found)</span>`
      : '<span style="color:#f87171;">❌ Matched output directory not found</span>';
  }
  if (geojsonSourceBadge) {
    geojsonSourceBadge.innerHTML = scanResult.geojsonSourceDir.exists
      ? `<span style="color:#34d399;">✅ Company GeoJSON source directory valid (${scanResult.geojsonSourceDir.files.length} sources found)</span>`
      : '<span style="color:#f87171;">❌ Company source directory not found</span>';
  }
}

async function runSettingsScan(): Promise<void> {
  const btn = document.getElementById("mvp-scan-settings") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    scanResult = await scanPaths(globalSettings);
    renderWorkflowChrome();
  } catch (error) {
    handleError(error);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function populateNewWorkspaceDropdowns(): void {
  const compSelect = document.getElementById("new-workspace-company") as HTMLSelectElement | null;
  const lineSelect = document.getElementById("new-workspace-line") as HTMLSelectElement | null;
  if (!compSelect || !lineSelect) return;

  const companies = scanResult?.matchedOutputRoot.companies || [];
  if (companies.length === 0) {
    compSelect.innerHTML = `<option value="">No companies found (Scan first)</option>`;
    lineSelect.innerHTML = `<option value="">No lines found</option>`;
    return;
  }

  // Preserve selections if possible
  const prevComp = compSelect.value;
  compSelect.innerHTML = companies.map((c) => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  if (prevComp && companies.some(c => c.name === prevComp)) {
    compSelect.value = prevComp;
  }

  const updateLines = () => {
    const selectedComp = compSelect.value;
    const company = companies.find((c) => c.name === selectedComp);
    const lines = company?.lines || [];
    if (lines.length === 0) {
      lineSelect.innerHTML = `<option value="">No lines matched</option>`;
    } else {
      lineSelect.innerHTML = lines.map((l) => `<option value="${escapeAttr(l.name)}">${escapeHtml(l.name)}</option>`).join("");
    }
    updateLineFileStatus();
  };

  compSelect.onchange = updateLines;
  lineSelect.onchange = updateLineFileStatus;
  
  updateLines();
}

function updateLineFileStatus(): void {
  const compSelect = document.getElementById("new-workspace-company") as HTMLSelectElement | null;
  const lineSelect = document.getElementById("new-workspace-line") as HTMLSelectElement | null;
  const statusDiv = document.getElementById("new-workspace-file-status");
  const createBtn = document.getElementById("mvp-create-workspace-btn") as HTMLButtonElement | null;
  
  if (!compSelect || !lineSelect || !statusDiv) return;
  
  const compVal = compSelect.value;
  const lineVal = lineSelect.value;
  
  if (!compVal || !lineVal || lineVal === "No lines matched" || lineVal === "") {
    statusDiv.style.display = "none";
    if (createBtn) createBtn.disabled = true;
    return;
  }
  
  const company = scanResult?.matchedOutputRoot.companies.find((c) => c.name === compVal);
  const line = company?.lines.find((l) => l.name === lineVal);
  
  if (!line) {
    statusDiv.style.display = "none";
    if (createBtn) createBtn.disabled = true;
    return;
  }
  
  const { artifacts, matchedAssetsSize, matchedHighSize } = line;
  const assetsText = artifacts.matchedAssets 
    ? `✅ matched_assets: Found (${formatBytes(matchedAssetsSize)})`
    : `❌ matched_assets: Missing`;
  const highText = artifacts.matchedHigh
    ? `✅ matched_high: Found (${formatBytes(matchedHighSize)})`
    : `❌ matched_high: Missing`;
  const reportText = artifacts.matchReport
    ? `✅ match_report: Found`
    : `❌ match_report: Missing`;

  statusDiv.innerHTML = `
    <div style="font-weight:600; margin-bottom: 4px; color:#f1f5f9;">Scanned Line File status:</div>
    <div style="display:grid; gap:2px; font-size:10px; color:#94a3b8;">
      <div>${escapeHtml(assetsText)}</div>
      <div>${escapeHtml(highText)}</div>
      <div>${escapeHtml(reportText)}</div>
    </div>
  `;
  statusDiv.style.display = "block";
  if (createBtn) createBtn.disabled = false;
}

function activeWorkspace(): LineWorkspaceState {
  const workspace = getActiveWorkspace(workspaceState);
  if (!workspaceState.workspaces[workspace.key]) {
    workspaceState.workspaces[workspace.key] = workspace;
    workspaceState.activeKey = workspace.key;
    persistWorkspace();
  }
  return workspace;
}

function activeProject(): MvpProjectState {
  return activeWorkspace().project;
}

function persistWorkspace(): void {
  saveWorkspaceState(workspaceState);
}

function updateActiveWorkspace(mutator: (workspace: LineWorkspaceState) => void): LineWorkspaceState {
  const workspace = activeWorkspace();
  mutator(workspace);
  workspace.updatedAt = new Date().toISOString();
  workspace.recommendedStep = recommendNextStep(workspace);
  workspace.project.selectedStep = workspace.currentStep;
  workspaceState.workspaces[workspace.key] = workspace;
  workspaceState.activeKey = workspace.key;
  persistWorkspace();
  return workspace;
}

function setStepProgress(
  step: WorkflowStep,
  patch: Partial<LineWorkspaceState["progress"][WorkflowStep]>,
): void {
  updateActiveWorkspace((workspace) => {
    const current = workspace.progress[step];
    workspace.progress[step] = {
      ...current,
      ...patch,
      completedActions: patch.completedActions ?? current.completedActions ?? [],
      updatedAt: new Date().toISOString(),
    };
  });
}

function recommendNextStep(workspace: LineWorkspaceState): WorkflowStep {
  const progress = workspace.progress;
  const sourceReady = stepHasRequiredActions(workspace, "annotate") && progress.annotate.status === "done";
  const topologyReady = stepHasRequiredActions(workspace, "compile") && progress.compile.status === "done";
  const validationReady = stepHasRequiredActions(workspace, "validate") && progress.validate.status === "done";

  if (sourceReady && !topologyReady) return "compile";
  if (topologyReady && !validationReady) return "validate";
  if (validationReady && progress.export.status !== "done") return "export";
  if (!stepHasRequiredActions(workspace, "prepare") || progress.prepare.status !== "done") return "prepare";
  if (!stepHasRequiredActions(workspace, "clean") || progress.clean.status !== "done") return "clean";
  if (!sourceReady) return "annotate";
  return "export";
}

// 根据 backend 真实存在的 matched_* 文件同步 prepare/clean 状态。
// 与「点了 Run Ingest & Match」按钮的 completedActions 解耦 — 让数据真相驱动状态。
async function syncProgressFromLineArtifacts(): Promise<void> {
  let lineArtifacts: LineArtifacts;
  try {
    lineArtifacts = await fetchLineArtifacts(activeProject());
  } catch (err) {
    console.warn("[workspace] fetchLineArtifacts failed", err);
    return;
  }

  const hasMatchedSource = lineArtifacts.matchedAssets.exists || lineArtifacts.matchedHigh.exists;
  if (hasMatchedSource) {
    const prepare = activeWorkspace().progress.prepare;
    setStepProgress("prepare", {
      status: "done",
      summary: `Matched assets present under ${shortPath(lineArtifacts.lineDir)}.`,
      lastAction: prepare.lastAction ?? "extractAndMatch",
      completedActions: dedupe([...(prepare.completedActions ?? []), "extractAndMatch"]),
    });
    unlockStep("clean", "Matched assets are ready. Load candidates and review level/filter.");
  } else {
    setStepProgress("prepare", {
      status: "ready",
      summary: lineArtifacts.exists
        ? `Line directory exists at ${shortPath(lineArtifacts.lineDir)} but no matched_*.geojson found. Re-run Ingest & Match.`
        : `Line directory not yet present (${shortPath(lineArtifacts.lineDir)}). Run Ingest & Match to create it.`,
      completedActions: [],
    });
    // 没有产物就锁后续步骤
    invalidateDownstream("prepare", "Awaiting matched assets for this line.");
  }
}

const WORKFLOW_ORDER: WorkflowStep[] = ["prepare", "clean", "annotate", "compile", "validate", "export"];
const REQUIRED_ACTIONS: Record<WorkflowStep, WorkflowAction[]> = {
  prepare: ["extractAndMatch"],
  clean: ["loadWorkspaceSource"],
  annotate: ["loadWorkspaceSource"],
  compile: ["compileTopology"],
  validate: ["runSensekiValidation"],
  export: ["exportSnapshot"],
};

function stepHasRequiredActions(workspace: LineWorkspaceState, step: WorkflowStep): boolean {
  return missingRequiredActions(workspace, step).length === 0;
}

function missingRequiredActions(workspace: LineWorkspaceState, step: WorkflowStep): WorkflowAction[] {
  const completed = workspace.progress[step].completedActions ?? [];
  return REQUIRED_ACTIONS[step].filter((action) => !completed.includes(action));
}

function markStepActionDone(step: WorkflowStep, action: WorkflowAction): void {
  const progress = activeWorkspace().progress[step];
  setStepProgress(step, {
    lastAction: action,
    completedActions: dedupe([...(progress.completedActions ?? []), action]),
  });
}

function advanceToRecommendedStep(): void {
  updateActiveWorkspace((workspace) => {
    workspace.currentStep = workspace.recommendedStep;
  });
}

function invalidateDownstream(fromStep: WorkflowStep, reason: string): void {
  const fromIndex = WORKFLOW_ORDER.indexOf(fromStep);
  updateActiveWorkspace((workspace) => {
    for (const step of WORKFLOW_ORDER.slice(fromIndex + 1)) {
      const progress = workspace.progress[step];
      if (progress.status === "blocked" || progress.status === "notStarted") continue;
      progress.status = "stale";
      progress.summary = reason;
      progress.updatedAt = new Date().toISOString();
    }
  });
}

function renderWorkspaceSelector(): void {
  const workspace = activeWorkspace();
  const select = document.getElementById("mvp-workspace-select") as HTMLSelectElement | null;
  if (select) {
    const presetOptions = PROJECT_PRESETS.map((preset) => {
      const project = projectFromPreset(preset.id);
      const key = workspaceKey(project);
      return `<option value="${escapeAttr(key)}" ${key === workspaceState.activeKey ? "selected" : ""}>Preset: ${escapeHtml(preset.label)}</option>`;
    });
    const extraOptions = Object.values(workspaceState.workspaces)
      .filter((item) => !PROJECT_PRESETS.some((preset) => workspaceKey(projectFromPreset(preset.id)) === item.key))
      .map((item) => `<option value="${escapeAttr(item.key)}" ${item.key === workspaceState.activeKey ? "selected" : ""}>Custom: ${escapeHtml(item.project.name)}</option>`);
    select.innerHTML = [...presetOptions, ...extraOptions].join("");
  }
  const status = document.getElementById("mvp-workspace-status");
  if (status) {
    status.textContent = statusLabel(workspace.progress[workspace.recommendedStep]?.status ?? "ready");
    status.className = `pill ${workspace.progress[workspace.recommendedStep]?.status ?? "ready"}`;
  }
  const summary = document.getElementById("mvp-workspace-summary");
  if (summary) {
    summary.innerHTML = `
      <strong>${escapeHtml(workspace.project.companyName)} / ${escapeHtml(workspace.project.lineDisplayName || workspace.project.lineName)}</strong>
      <div style="font-size:10px; color:#94a3b8; margin-top:2px;">
        Line Src: ${escapeHtml(shortPath(workspace.project.sourceGeoJsonPath))}
      </div>
    `;
  }
}

function getStepBodyHtml(stepKey: WorkflowStep, progress: any, workspace: LineWorkspaceState): string {
  switch (stepKey) {
    case "prepare": {
      const pbfText = scanResult?.pbf.exists
        ? `✅ PBF: ${formatBytes(scanResult.pbf.size)} (${new Date(scanResult.pbf.modifiedAt).toLocaleDateString()})`
        : `❌ PBF not found at configured path`;
      const cacheText = scanResult?.cacheDb.exists
        ? `✅ Cache SQLite: ${formatBytes(scanResult.cacheDb.size)}`
        : `❌ Cache SQLite not found`;
      const scriptsText = scanResult?.scriptsRoot.ok
        ? `✅ Scripts: 8/8 present`
        : `❌ Scripts check failed (Check Settings)`;

      // 记住上次的选择 — PBF 几个月更新一次, 但 match 规则常调; 让用户自己挑起点 + 链式带下游.
      const lastStart = (localStorage.getItem("railround:mvp:start-from") || "extract") as PipelineStage;
      const isRunning = activePipelineTask?.status === "running";
      const opt = (value: PipelineStage, label: string) =>
        `<option value="${value}" ${value === lastStart ? "selected" : ""}>${escapeHtml(label)}</option>`;

      return `
        <div style="font-size: 11px; background: #f8fafc; border:1px solid #e2e8f0; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px; display: grid; gap: 4px; color:#475569;">
          <div>${escapeHtml(pbfText)}</div>
          <div>${escapeHtml(cacheText)}</div>
          <div>${escapeHtml(scriptsText)}</div>
        </div>
        <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap;">
          <label style="font-size:11px; color:#475569;">Start from:</label>
          <select id="mvp-pipeline-start-from" style="font-size:11px; padding:3px 4px; border:1px solid #cbd5e1; border-radius:4px; background:#fff; color:#0f172a;">
            ${opt("extract", "1. Extract (PBF → cache + geojson)")}
            ${opt("postFix", "2. PostFix (cleanup geojson)")}
            ${opt("match", "3. Match (rules → matched_*.geojson)")}
            ${opt("manifest", "4. Manifest (rebuild index)")}
          </select>
          <button id="mvp-run-ingest-match" class="primary strong" ${isRunning ? "disabled" : ""}>Run from selected</button>
          <button class="step-action-btn" data-action="refreshArtifacts">Refresh</button>
        </div>
        <div style="font-size:10px; color:#94a3b8; margin-top:4px;">
          Runs the selected stage and all downstream (chained dependency). Earlier stages are skipped — their on-disk outputs are reused.
        </div>
      `;
    }
    case "clean": {
      const company = workspace.project.companyName;
      const line = workspace.project.lineName;

      let countBlock = `<div><span style="color:#f59e0b;">Source not loaded yet</span></div>`;
      if (state.source) {
        const counts = { high: 0, medium: 0, low: 0, unknown: 0 };
        for (const f of state.source.features) {
          const lv = ((f.properties || {}) as any).match_level;
          if (lv === "high") counts.high += 1;
          else if (lv === "medium") counts.medium += 1;
          else if (lv === "low") counts.low += 1;
          else counts.unknown += 1;
        }
        const total = state.source.features.length;
        countBlock = `
          <div>Total candidates: <b>${total}</b></div>
          <div style="font-size:10.5px;">
            <span style="color:#0a6b2b;">High ${counts.high}</span> ·
            <span style="color:#946200;">Medium ${counts.medium}</span> ·
            <span style="color:#8a1212;">Low ${counts.low}</span>
            ${counts.unknown > 0 ? `· <span style="color:#94a3b8;">unset ${counts.unknown}</span>` : ""}
          </div>
        `;
      }

      let pipelineBlock = "";
      if (state.source && lastPipelineRun) {
        const r = lastPipelineRun.report;
        const ruleCount = r.phaseReports.reduce((s, p) => s + p.rules.length, 0);
        pipelineBlock = `<div style="font-size:10.5px; color:#475569;">Pipeline: <b>${r.totalIn}</b> → <b>${r.totalOut}</b> kept (${ruleCount} rule${ruleCount !== 1 ? "s" : ""}, ${r.totalMs.toFixed(1)}ms)</div>`;
      }

      return `
        <div style="font-size: 11px; background: #f8fafc; border:1px solid #cbd5e1; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px; display: grid; gap: 4px; color:#475569;">
          <div>Company: <b>${escapeHtml(company)}</b></div>
          <div>Line: <b>${escapeHtml(line)}</b></div>
          <div>Line dir: <code style="font-size:10px;">${escapeHtml(shortPath(workspace.project.lineDir))}</code></div>
          ${countBlock}
          ${pipelineBlock}
        </div>
        <div class="row">
          <button class="step-action-btn primary strong" id="mvp-load-clean-source" style="font-size:11px;">Load Candidate Source</button>
        </div>
      `;
    }
    case "annotate": {
      // Find geojson artifacts
      const geojsonArtifacts = pipelineArtifacts.filter((artifact) => artifact.kind === "geojson" || artifact.kind === "json");
      const options = geojsonArtifacts.map((art) => {
        const isSelected = art.path === workspace.project.selectedArtifactPath;
        return `<option value="${escapeAttr(art.path)}" ${isSelected ? "selected" : ""}>${escapeHtml(art.name)} (${formatBytes(art.size)})</option>`;
      }).join("");

      return `
        <div class="field full" style="margin-bottom: 8px;">
          <label style="font-weight: 500; font-size:11px;">Source GeoJSON File</label>
          <select id="mvp-artifact-select" class="artifact-select" style="margin-top: 4px; width:100%;">
            ${options || '<option value="">No artifacts found. Run Ingest/Match first.</option>'}
          </select>
        </div>
        <div class="row">
          <button id="mvp-load-artifact" class="primary strong" ${activePipelineTask?.status === "running" ? "disabled" : ""}>Load Selected Source</button>
          <button class="step-action-btn" data-action="refreshArtifacts">Refresh</button>
        </div>
      `;
    }
    case "compile":
      return `
        <div class="row">
          <button class="step-action-btn primary strong" data-action="compileTopology" ${activePipelineTask?.status === "running" ? "disabled" : ""}>Compile Topology</button>
        </div>
      `;
    case "validate":
      return `
        <div class="row">
          <button class="step-action-btn primary strong" data-action="runSensekiValidation" ${activePipelineTask?.status === "running" ? "disabled" : ""}>Run Pathfinding</button>
        </div>
      `;
    case "export":
      return `
        <div class="row" style="gap:4px;">
          <button class="step-action-btn primary strong" data-action="exportSnapshot" ${activePipelineTask?.status === "running" ? "disabled" : ""}>Export Snapshot</button>
          <button id="mvp-export-geojson" class="strong">GeoJSON</button>
          <button id="mvp-export-topo" class="strong">Topology</button>
        </div>
      `;
    default:
      return "";
  }
}

function renderWorkflowSteps(): void {
  const container = document.getElementById("mvp-workflow-steps");
  if (!container) return;
  const workspace = activeWorkspace();
  container.innerHTML = WORKFLOW_STEPS.map((step, index) => {
    const progress = workspace.progress[step.key];
    const isActive = step.key === workspace.currentStep;
    const isRecommended = step.key === workspace.recommendedStep;
    const statusClass = progress?.status ?? "blocked";
    
    let bodyHtml = "";
    if (isActive) {
      bodyHtml = getStepBodyHtml(step.key, progress, workspace);
    }

    return `
      <div class="step-card ${isActive ? "active" : ""} ${statusClass} ${isRecommended ? "recommended" : ""}" data-step="${step.key}">
        <div class="step-header">
          <span class="step-circle">${index + 1}</span>
          <span style="flex:1;">${escapeHtml(step.label)}</span>
          <span class="pill ${statusClass}">${escapeHtml(statusLabel(statusClass))}</span>
        </div>
        <div class="step-body">
          <div class="step-desc" style="margin-bottom: 6px; font-style: italic; color: #94a3b8; font-size:10.5px;">${escapeHtml(step.purpose)}</div>
          <div class="status-line" style="margin-bottom: 8px; color: #f1f5f9; font-weight: 500;">${escapeHtml(progress?.summary || "")}</div>
          ${bodyHtml}
        </div>
      </div>
    `;
  }).join("");
}

function renderTaskState(): void {
  const badge = document.getElementById("mvp-task-status");
  const log = document.getElementById("mvp-task-log");
  const cancel = document.getElementById("mvp-cancel-stage") as HTMLButtonElement | null;
  const status = activePipelineTask?.status ?? "idle";

  // status pill: 跑流水线时显示 "running 2/4 extract" 比单一 "running" 更直观
  if (badge) {
    if (pipelineRun && activePipelineTask?.status === "running") {
      const idx = pipelineRun.currentIndex + 1;
      const total = pipelineRun.stages.length;
      const stage = pipelineRun.stages[pipelineRun.currentIndex];
      badge.textContent = `running ${idx}/${total} ${stage}`;
    } else {
      badge.textContent = status;
    }
  }

  if (cancel) cancel.disabled = activePipelineTask?.status !== "running";

  if (log) {
    if (!activePipelineTask && !pipelineRun) {
      log.textContent = "No local task has run yet.";
    } else {
      // 串好 cumulative log: 之前 stage 的完整 log + headers + 当前 stage live tail
      const live = activePipelineTask?.log ?? [];
      const prior = pipelineRun?.priorStagesLog ?? [];
      const all = [...prior, ...live];
      const lines = all.length > 0 ? all : ["Task started; waiting for output..."];
      // 保留最后 400 行, 多 stage 时单 stage 也常有 100+ 行
      log.textContent = lines.slice(-400).join("\n");
      log.scrollTop = log.scrollHeight;
    }
  }
}

function renderPipelineProgress(): void {
  const container = document.getElementById("mvp-pipeline-progress");
  if (!container) return;

  if (!pipelineRun) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  const { stages, startIndex, currentIndex, startedAt, stageStartedAt } = pipelineRun;
  const total = stages.length;
  const idx = currentIndex + 1;
  const stageName = stages[currentIndex];
  const totalElapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const stageElapsedSec = ((Date.now() - stageStartedAt) / 1000).toFixed(1);
  const currentLog = activePipelineTask?.log ?? [];
  const lineCount = currentLog.length;
  const lastLine = lineCount > 0 ? currentLog[lineCount - 1] : "(no output yet)";

  const isRunning = activePipelineTask?.status === "running";
  const isDone = !isRunning && currentIndex >= total - 1
    && (activePipelineTask?.status === "succeeded" || !activePipelineTask);
  const isFailed = activePipelineTask?.status === "failed" || activePipelineTask?.status === "cancelled";

  // 进度条: skipped 阶段(用户手动跳过)灰底虚化, 已完成绿, 当前蓝/黄/红, 未开始灰
  const segments = stages.map((s, i) => {
    let bg = "#e2e8f0";
    let color = "#64748b";
    let label = escapeHtml(s);
    if (i < startIndex) {
      bg = "#f1f5f9";
      color = "#94a3b8";
      label = `${escapeHtml(s)} <span style="opacity:.7; font-weight:500;">· skipped</span>`;
    } else if (i < currentIndex || (isDone && i === currentIndex)) {
      bg = "#34d399"; color = "#064e3b";
    } else if (i === currentIndex) {
      if (isFailed) { bg = "#f87171"; color = "#7f1d1d"; }
      else if (isRunning) { bg = "#38bdf8"; color = "#0c4a6e"; }
      else { bg = "#fbbf24"; color = "#78350f"; }
    }
    return `<div style="flex:1; padding: 3px 4px; background:${bg}; color:${color}; font-size:9.5px; text-align:center; border-radius:3px; font-weight:600;">${label}</div>`;
  }).join("");

  // 截短 last line, 它有可能很长
  const lastLineTrunc = lastLine.length > 120 ? lastLine.slice(0, 117) + "..." : lastLine;

  container.style.display = "block";
  container.innerHTML = `
    <div style="display:flex; gap:3px; margin-bottom: 4px;">${segments}</div>
    <div style="display:flex; gap:8px; font-size:10px; color:#475569; flex-wrap:wrap;">
      <span><b>Stage ${idx}/${total}</b>: ${escapeHtml(stageName)}</span>
      <span>· lines <b>${lineCount}</b></span>
      <span>· stage <b>${stageElapsedSec}s</b></span>
      <span>· total <b>${totalElapsedSec}s</b></span>
    </div>
    <div style="font-size: 10px; color:#0f766e; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeAttr(lastLine)}">tail: ${escapeHtml(lastLineTrunc)}</div>
  `;
}

function renderSummaryMetrics(): void {
  const container = document.getElementById("mvp-summary-metrics");
  if (!container) return;
  const topo = state.topo;
  const fatalCount = state.diagnostics.filter((d) => d.level === "fatal").length;
  const errorCount = state.diagnostics.filter((d) => d.level === "error").length;
  container.innerHTML = [
    metric("Features", state.source?.features.length ?? 0),
    metric("Edges", topo?.edges.length ?? 0),
    metric("Stations", topo?.stations.length ?? 0),
    metric("Platforms", topo?.platforms.length ?? 0),
    metric("Stops", topo?.stoppingPoints.length ?? 0),
    metric("Errors", fatalCount + errorCount),
  ].join("");
}

function renderArtifacts(): void {
  const container = document.getElementById("mvp-artifacts");
  const select = document.getElementById("mvp-artifact-select") as HTMLSelectElement | null;
  if (select) {
    const geojsonArtifacts = pipelineArtifacts.filter((artifact) => artifact.kind === "geojson" || artifact.kind === "json");
    if (geojsonArtifacts.length === 0) {
      select.innerHTML = `<option value="">No JSON/GeoJSON artifacts loaded</option>`;
    } else {
      const selectedPath = activeProject().selectedArtifactPath;
      select.innerHTML = geojsonArtifacts.slice(0, 120).map((artifact) => `
        <option value="${escapeAttr(artifact.path)}" ${artifact.path === selectedPath ? "selected" : ""}>${escapeHtml(artifact.name)} · ${escapeHtml(shortPath(artifact.path))}</option>
      `).join("");
    }
  }
  if (!container) return;
  if (pipelineArtifacts.length === 0) {
    container.innerHTML = `<div class="status-line">No artifacts loaded. Use Refresh after running or preparing data.</div>`;
    return;
  }
  container.innerHTML = pipelineArtifacts.slice(0, 60).map((artifact) => `
    <div class="artifact">
      <strong>${escapeHtml(artifact.name)}</strong>
      <span class="pill">${escapeHtml(artifact.kind)}</span>
      <div><code>${escapeHtml(artifact.path)}</code></div>
      <div class="status-line">${formatBytes(artifact.size)} · ${escapeHtml(artifact.modifiedAt)}</div>
    </div>
  `).join("");
}

function metric(label: string, value: number): string {
  return `<div class="metric"><b>${value.toLocaleString()}</b><span>${escapeHtml(label)}</span></div>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function bindPipelineUi(): void {
  // workspace 切换或加载时:先按 lineDir 真相同步 prepare/clean status,然后(若 prepare 已 done)拉
  // source/overrides/rules 并 compile + render
  async function loadWorkspaceDataAndCompile(): Promise<void> {
    await syncProgressFromLineArtifacts();
    if (activeWorkspace().progress.prepare.status !== "done") {
      // 没有匹配产物,卡在 prepare;UI 让用户去跑 Ingest & Match
      refreshViews();
      return;
    }
    try {
      await loadWorkspaceSource();
    } catch (err) {
      console.error("Failed to load workspace source geojson:", err);
    }
    await loadAllCleanDecisions();
    try {
      compileTopology();
    } catch (err) {
      handleError(err);
    }
    refreshViews();
    mapView?.fitToData();
  }

  // Active Workspace change
  document.getElementById("mvp-workspace-select")?.addEventListener("change", (event) => {
    const key = (event.target as HTMLSelectElement).value;
    const preset = PROJECT_PRESETS.find((item) => workspaceKey(projectFromPreset(item.id)) === key);
    if (!workspaceState.workspaces[key] && preset) {
      const project = projectFromPreset(preset.id);
      workspaceState.workspaces[key] = createLineWorkspace(project);
    }
    if (workspaceState.workspaces[key]) {
      workspaceState.activeKey = key;
      pipelineArtifacts = [];
      activePipelineTask = null;
      state.source = null;
      state.bindings = [];
      state.stoppingPoints = [];
      state.topo = null;
      state.diagnostics = [];
      lastPathfindingResults = undefined;
      mapView?.update(cloneTopo(EMPTY_TOPO), { type: "FeatureCollection", features: [] });
      persistWorkspace();
      renderWorkflowChrome();
      
      void loadWorkspaceDataAndCompile();
    }
  });

  // Toggle Global Settings form
  document.getElementById("mvp-toggle-settings")?.addEventListener("click", () => {
    showSettings = !showSettings;
    showNewWorkspace = false;
    renderWorkflowChrome();
  });

  // Toggle New Workspace form
  document.getElementById("mvp-toggle-new-workspace")?.addEventListener("click", () => {
    showNewWorkspace = !showNewWorkspace;
    showSettings = false;
    renderWorkflowChrome();
  });

  // Global Settings save & scan
  document.getElementById("mvp-scan-settings")?.addEventListener("click", () => {
    const scriptsRootVal = (document.getElementById("settings-scripts-root") as HTMLInputElement)?.value || "";
    const pbfPathVal = (document.getElementById("settings-pbf-path") as HTMLInputElement)?.value || "";
    const cacheDbPathVal = (document.getElementById("settings-cache-db-path") as HTMLInputElement)?.value || "";
    const osmOutputDirVal = (document.getElementById("settings-osm-output") as HTMLInputElement)?.value || "";
    const matchedOutputRootVal = (document.getElementById("settings-matched-output") as HTMLInputElement)?.value || "";
    const geojsonSourceDirVal = (document.getElementById("settings-geojson-source") as HTMLInputElement)?.value || "";

    globalSettings = {
      scriptsRoot: scriptsRootVal,
      pbfPath: pbfPathVal,
      cacheDbPath: cacheDbPathVal,
      osmOutputDir: osmOutputDirVal,
      matchedOutputRoot: matchedOutputRootVal,
      geojsonSourceDir: geojsonSourceDirVal
    };

    saveGlobalSettings(globalSettings);
    void runSettingsScan();
  });

  // Workspace creation Form save
  document.getElementById("mvp-create-workspace-btn")?.addEventListener("click", () => {
    const nameVal = (document.getElementById("new-workspace-name") as HTMLInputElement)?.value.trim() || "";
    const compSelect = document.getElementById("new-workspace-company") as HTMLSelectElement | null;
    const lineSelect = document.getElementById("new-workspace-line") as HTMLSelectElement | null;

    if (!nameVal || !compSelect || !lineSelect) return;

    const companyVal = compSelect.value;
    const lineVal = lineSelect.value;

    if (!companyVal || !lineVal || lineVal === "No lines matched" || lineVal === "") return;

    const project = createProjectForWorkspace(nameVal, companyVal, lineVal, globalSettings);
    const workspace = createLineWorkspace(project);
    workspaceState.workspaces[workspace.key] = workspace;
    workspaceState.activeKey = workspace.key;
    
    // Clear forms and state
    showNewWorkspace = false;
    pipelineArtifacts = [];
    activePipelineTask = null;
    state.source = null;
    state.bindings = [];
    state.stoppingPoints = [];
    state.topo = null;
    state.diagnostics = [];
    lastPathfindingResults = undefined;

    mapView?.update(cloneTopo(EMPTY_TOPO), { type: "FeatureCollection", features: [] });
    persistWorkspace();
    renderWorkflowChrome();
    
    void loadWorkspaceDataAndCompile();
  });

  // Load clean source button click
  document.getElementById("mvp-workflow-steps")?.addEventListener("click", async (event) => {
    const btn = (event.target as HTMLElement).closest("#mvp-load-clean-source");
    if (!btn) return;
    try {
      await runWorkflowAction("loadWorkspaceSource");
    } catch (err) {
      handleError(err);
    }
  });

  // Accordion Step click selection
  document.getElementById("mvp-workflow-steps")?.addEventListener("click", (event) => {
    const header = (event.target as HTMLElement).closest<HTMLElement>(".step-header");
    if (!header) return;
    const card = header.closest<HTMLElement>(".step-card");
    if (!card) return;
    const step = card.dataset.step as WorkflowStep;
    if (step) {
      updateActiveWorkspace((workspace) => {
        workspace.currentStep = step;
      });
      renderWorkflowChrome();
    }
  });

  // Step Action Button click
  document.getElementById("mvp-workflow-steps")?.addEventListener("click", async (event) => {
    const btn = (event.target as HTMLButtonElement).closest<HTMLButtonElement>("button.step-action-btn");
    if (!btn) return;
    const action = btn.dataset.action as WorkflowAction | undefined;
    if (action) {
      try {
        await runWorkflowAction(action);
      } catch (error) {
        handleError(error);
      }
    }
  });

  // Load geojson source button click in Step 3
  document.getElementById("mvp-workflow-steps")?.addEventListener("click", async (event) => {
    const btn = (event.target as HTMLButtonElement).closest<HTMLButtonElement>("#mvp-load-artifact");
    if (!btn) return;
    try {
      await loadSelectedArtifact();
    } catch (error) {
      handleError(error);
    }
  });

  // Prepare step: Run from selected stage. 替代固定的 data-action="extractAndMatch", 让用户挑起点 + 链式跑下游.
  document.getElementById("mvp-workflow-steps")?.addEventListener("click", async (event) => {
    const btn = (event.target as HTMLElement).closest("#mvp-run-ingest-match");
    if (!btn) return;
    const sel = document.getElementById("mvp-pipeline-start-from") as HTMLSelectElement | null;
    const startStage = ((sel?.value as PipelineStage) || "extract");
    try {
      localStorage.setItem("railround:mvp:start-from", startStage);
      await runPipelineSequence(startStage, "prepare", "Matched rail assets are ready.");
      markStepActionDone("prepare", "extractAndMatch");
      await syncProgressFromLineArtifacts();
      unlockStep("clean", "Matched assets are ready. Load candidates and review.");
      advanceToRecommendedStep();
    } catch (error) {
      handleError(error);
    }
  });

  // Log Card panel toggle collapse
  document.getElementById("log-card-header")?.addEventListener("click", () => {
    showLogs = !showLogs;
    renderWorkflowChrome();
  });

  // Click running task Cancel button
  document.getElementById("mvp-cancel-stage")?.addEventListener("click", async () => {
    if (!activePipelineTask) return;
    try {
      activePipelineTask = await cancelPipelineTask(activePipelineTask.id);
      stopPipelinePolling();
      const step = activeWorkspace().currentStep;
      setStepProgress(step, {
        status: "stale",
        summary: "Task was cancelled. Re-run this step when ready.",
      });
      renderWorkflowChrome();
    } catch (error) {
      handleError(error);
    }
  });

  // Auto-Run Pipeline trigger
  document.getElementById("mvp-run-auto")?.addEventListener("click", async () => {
    void runPipelineAutoPilot();
  });

  // Log file viewer click
  document.getElementById("mvp-artifacts")?.addEventListener("click", async (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(".artifact");
    if (!card) return;
    const path = card.dataset.logPath;
    const kind = card.dataset.kind;
    if (path && kind === "log") {
      try {
        const text = await readPipelineArtifact(path);
        const logBox = document.getElementById("mvp-task-log");
        if (logBox) {
          logBox.textContent = `=== Content of Log File: ${path} ===\n\n` + (typeof text === "string" ? text : JSON.stringify(text, null, 2));
          logBox.scrollTop = logBox.scrollHeight;
        }
        showLogs = true;
        renderWorkflowChrome();
      } catch (error) {
        handleError(error);
      }
    }
  });
}

async function runWorkflowAction(action: WorkflowAction): Promise<void> {
  switch (action) {
    case "extractAndMatch":
      await runPipelineSequence("extract", "prepare", "Matched rail assets are ready.");
      markStepActionDone("prepare", action);
      await syncProgressFromLineArtifacts();
      unlockStep("clean", "Matched assets are ready. Load candidates and review.");
      advanceToRecommendedStep();
      break;
    case "refreshArtifacts":
      await refreshPipelineArtifacts();
      break;
    case "loadWorkspaceSource":
      await loadWorkspaceSource();
      // 读取磁盘上的 .override.json (keep/remove + filter rules), 让用户之前保存的清洗决策生效;
      // 然后再 compile 一次, 让 allCleanDecisions 真正过滤进 topology.
      await loadAllCleanDecisions();
      try {
        compileTopology();
      } catch (err) {
        handleError(err);
      }
      {
        const featureCount = state.source?.features.length ?? 0;
        const sourcePath = activeProject().selectedArtifactPath || "(unknown path)";
        const cleanCompleted = dedupe([
          ...(activeWorkspace().progress.clean.completedActions ?? []),
          action,
        ]);
        setStepProgress("clean", {
          status: "done",
          summary: `Loaded ${featureCount} candidates from ${shortPath(sourcePath)}. Toggle level/filter and review overrides on the right.`,
          lastAction: action,
          completedActions: cleanCompleted,
          diagnostics: diagnosticSummaries(),
        });
        const annotateCompleted = dedupe([
          ...(activeWorkspace().progress.annotate.completedActions ?? []),
          action,
        ]);
        setStepProgress("annotate", {
          status: "done",
          summary: `Loaded ${featureCount} features. Continue editing in the inspector on the right.`,
          lastAction: action,
          completedActions: annotateCompleted,
          diagnostics: diagnosticSummaries(),
        });
      }
      unlockStep("compile", "Annotated source is loaded. Compile topology next.");
      advanceToRecommendedStep();
      renderFeatures();
      refreshViews();
      mapView?.fitToData();
      break;
    case "compileTopology":
      compileTopology();
      if (diagnosticsHaveErrors()) {
        setStepProgress("compile", {
          status: "error",
          summary: topologySummaryText(),
          lastAction: action,
          diagnostics: diagnosticSummaries(),
        });
        renderFeatures();
        refreshViews();
        break;
      }
      setStepProgress("compile", {
        status: "done",
        summary: topologySummaryText(),
        lastAction: action,
        completedActions: dedupe([...(activeWorkspace().progress.compile.completedActions ?? []), action]),
        diagnostics: diagnosticSummaries(),
      });
      invalidateDownstream("compile", "Topology was rebuilt. Re-run validation and export.");
      unlockStep("validate", "Topology is compiled. Run validation/pathfinding next.");
      advanceToRecommendedStep();
      renderFeatures();
      refreshViews();
      break;
    case "runSensekiValidation":
      await runSensekiValidationAction();
      break;
    case "exportSnapshot":
      exportWorkflowSnapshot();
      setStepProgress("export", {
        status: "done",
        summary: "Snapshot export completed. GeoJSON, topology, and diagnostics exports remain available below.",
        lastAction: action,
        completedActions: dedupe([...(activeWorkspace().progress.export.completedActions ?? []), action]),
        diagnostics: diagnosticSummaries(),
      });
      renderWorkflowChrome();
      break;
  }
}

/* 仅对自动连续流水线执行逻辑添加简短中英注释 / Auto-run pipeline sequence sequentially */
async function runPipelineAutoPilot(): Promise<void> {
  if (isAutoRunning) return;
  isAutoRunning = true;
  showLogs = true;
  renderWorkflowChrome();
  try {
    const steps: WorkflowStep[] = ["prepare", "clean", "annotate", "compile", "validate", "export"];
    const startIdx = steps.indexOf(activeWorkspace().currentStep);
    
    for (let i = startIdx; i < steps.length; i++) {
      const step = steps[i];
      // Switch current step
      updateActiveWorkspace((workspace) => {
        workspace.currentStep = step;
      });
      renderWorkflowChrome();
      
      const progress = activeWorkspace().progress[step];
      const missing = missingRequiredActions(activeWorkspace(), step);
      if (missing.length > 0) {
        for (const action of missing) {
          setStepProgress(step, {
            status: "running",
            summary: `Auto-pilot: Running ${actionLabel(action)}...`,
          });
          renderWorkflowChrome();
          await runWorkflowAction(action);
        }
      } else {
        // If not completed, run primary action
        if (progress.status !== "done") {
          const stepInfo = WORKFLOW_STEPS.find(s => s.key === step);
          if (stepInfo) {
            await runWorkflowAction(stepInfo.primaryAction);
          }
        }
      }
      
      // Check result
      const updatedProgress = activeWorkspace().progress[step];
      if (updatedProgress.status === "error") {
        throw new Error(`Auto-pilot stopped at step ${workflowLabel(step)}: ${updatedProgress.summary}`);
      }
    }
    alert("Pipeline auto-run completed successfully.");
  } catch (error) {
    handleError(error);
  } finally {
    isAutoRunning = false;
    renderWorkflowChrome();
  }
}

async function runPipelineSequence(
  startStage: PipelineStage,
  step: WorkflowStep,
  successSummary: string,
): Promise<void> {
  const startIndex = ALL_PIPELINE_STAGES.indexOf(startStage);
  if (startIndex < 0) throw new Error(`Invalid start stage: ${startStage}`);
  const toRun = ALL_PIPELINE_STAGES.length - startIndex;
  const skippedNames = ALL_PIPELINE_STAGES.slice(0, startIndex).join(", ");

  setStepProgress(step, {
    status: "running",
    summary: startIndex === 0
      ? `Running ${toRun} local pipeline task(s)...`
      : `Running ${toRun} task(s) from ${startStage}; skipping ${skippedNames} (reusing prior outputs).`,
  });
  pipelineRun = {
    stages: [...ALL_PIPELINE_STAGES],
    startIndex,
    currentIndex: startIndex,
    startedAt: Date.now(),
    stageStartedAt: Date.now(),
    priorStagesLog: startIndex > 0
      ? [`(skipping ${skippedNames} — reusing prior outputs on disk)`]
      : [],
  };
  renderWorkflowChrome();
  const project = activeProject();
  const completedArtifacts: string[] = [];
  try {
    for (let absIdx = startIndex; absIdx < ALL_PIPELINE_STAGES.length; absIdx++) {
      const stage = ALL_PIPELINE_STAGES[absIdx];
      if (pipelineRun) {
        pipelineRun.currentIndex = absIdx;
        pipelineRun.stageStartedAt = Date.now();
        pipelineRun.priorStagesLog.push(`=== Stage ${absIdx + 1}/${ALL_PIPELINE_STAGES.length}: ${stage} ===`);
      }
      activePipelineTask = await startPipelineTask(stage, project);
      updateActiveWorkspace((workspace) => {
        workspace.lastTaskId = activePipelineTask?.id;
      });
      renderWorkflowChrome();
      const task = await waitForPipelineTask(activePipelineTask.id);
      activePipelineTask = task;
      // 把这个 stage 的完整 log 转入 priorStagesLog, 这样下个 stage 跑起来后不会冲掉.
      if (pipelineRun) {
        const elapsedSec = ((Date.now() - pipelineRun.stageStartedAt) / 1000).toFixed(1);
        pipelineRun.priorStagesLog.push(...task.log);
        pipelineRun.priorStagesLog.push(`--- Stage ${absIdx + 1}/${ALL_PIPELINE_STAGES.length} ${task.status} in ${elapsedSec}s ---`);
      }
      if (task.status !== "succeeded") {
        throw new Error(task.error || `${stage} failed with status ${task.status}`);
      }
      completedArtifacts.push(...task.artifacts);
    }
    await refreshPipelineArtifacts(false);
    setStepProgress(step, {
      status: "done",
      summary: successSummary,
      artifacts: dedupe([...activeWorkspace().progress[step].artifacts, ...completedArtifacts, ...pipelineArtifacts.slice(0, 10).map((item) => item.path)]),
      diagnostics: [],
    });
  } catch (error) {
    setStepProgress(step, {
      status: "error",
      summary: error instanceof Error ? error.message : String(error),
      diagnostics: activePipelineTask?.log.slice(-20) ?? [],
    });
    throw error;
  } finally {
    // 保留 pipelineRun 让用户看到失败/完成时的最后状态; 下一次 runPipelineSequence 会覆盖.
    renderWorkflowChrome();
  }
}

async function waitForPipelineTask(taskId: string): Promise<PipelineTaskState> {
  stopPipelinePolling();
  let task = await getPipelineTask(taskId);
  while (task.status === "running" || task.status === "queued") {
    // 500ms 节奏: 给用户 elapsed 计数器更"活"的感受 + Python 大块输出时也能更快显示新行
    await delay(500);
    task = await getPipelineTask(taskId);
    activePipelineTask = task;
    renderWorkflowChrome();
  }
  return task;
}

async function refreshPipelineArtifacts(updateStep = true): Promise<void> {
  pipelineArtifacts = await listPipelineArtifacts(activeProject());
  if (updateStep) {
    const step = activeWorkspace().currentStep;
    const currentStatus = activeWorkspace().progress[step].status;
    const currentSummary = activeWorkspace().progress[step].summary;
    setStepProgress(step, {
      status: pipelineArtifacts.length > 0 && (currentStatus === "blocked" || currentStatus === "notStarted")
        ? "ready"
        : currentStatus,
      summary: currentStatus === "done" || currentStatus === "stale"
        ? currentSummary
        : pipelineArtifacts.length > 0
        ? `Loaded ${pipelineArtifacts.length} local artifact(s).`
        : "No local artifacts were found for this workspace.",
      artifacts: pipelineArtifacts.slice(0, 20).map((item) => item.path),
    });
  }
  renderWorkflowChrome();
}

async function loadSelectedArtifact(): Promise<void> {
  const path = (document.getElementById("mvp-artifact-select") as HTMLSelectElement | null)?.value;
  if (!path) throw new Error("Select a JSON or GeoJSON artifact first.");
  await loadArtifactPath(path);
}

async function loadArtifactPath(path: string): Promise<void> {
  const artifact = pipelineArtifacts.find((item) => item.path === path);
  if (artifact && artifact.kind !== "geojson" && artifact.kind !== "json") {
    throw new Error("Selected artifact is not JSON/GeoJSON.");
  }
  const parsed = await readPipelineArtifact(path);
  loadGeoJson(parsed as GeoJsonFeatureCollection);
  lastPathfindingResults = undefined;
  compileTopology();
  updateActiveWorkspace((workspace) => {
    workspace.project.selectedArtifactPath = path;
    workspace.project.sourceGeoJsonPath = path;
  });
  setStepProgress("annotate", {
    status: "done",
    summary: `Loaded ${state.source?.features.length ?? 0} features from selected artifact.`,
    completedActions: dedupe([...(activeWorkspace().progress.annotate.completedActions ?? []), "loadWorkspaceSource"]),
    artifacts: dedupe([...activeWorkspace().progress.annotate.artifacts, path]),
    diagnostics: diagnosticSummaries(),
  });
  invalidateDownstream("annotate", "Source data changed after this step. Re-run from compile.");
  unlockStep("compile", "Source is loaded. Compile topology next.");
  renderFeatures();
  refreshViews();
  mapView?.fitToData();
}

async function loadWorkspaceSource(): Promise<void> {
  const project = activeProject();
  const lineArtifacts = await fetchLineArtifacts(project);

  if (!lineArtifacts.exists) {
    throw new Error(
      `Line directory not found: ${lineArtifacts.lineDir || project.lineDir}. ` +
      `Run 'Prepare Data' (Run Ingest & Match) first.`,
    );
  }

  const currentStep = activeWorkspace().currentStep;
  const previouslySelected = project.selectedArtifactPath;

  // clean 阶段必须看全部 level (high+medium+low),数据来自 matched_assets.geojson;
  // 其他阶段保留用户上次选定的产物,否则按 matched_assets → matched_high 回退。
  let chosenPath = "";
  if (currentStep === "clean") {
    if (lineArtifacts.matchedAssets.exists) {
      chosenPath = lineArtifacts.matchedAssets.path;
    } else if (lineArtifacts.matchedHigh.exists) {
      chosenPath = lineArtifacts.matchedHigh.path;
    }
  } else {
    const candidatePaths = [
      previouslySelected,
      lineArtifacts.matchedAssets.path,
      lineArtifacts.matchedHigh.path,
    ];
    for (const candidate of candidatePaths) {
      if (candidate && candidate.startsWith(lineArtifacts.lineDir)) {
        chosenPath = candidate;
        break;
      }
    }
    if (!chosenPath && lineArtifacts.matchedAssets.exists) {
      chosenPath = lineArtifacts.matchedAssets.path;
    } else if (!chosenPath && lineArtifacts.matchedHigh.exists) {
      chosenPath = lineArtifacts.matchedHigh.path;
    }
  }

  if (!chosenPath) {
    throw new Error(
      `No matched GeoJSON found under ${lineArtifacts.lineDir}. ` +
      `Expected matched_assets.geojson or matched_high.geojson. Re-run 'Run Ingest & Match'.`,
    );
  }

  await loadArtifactPath(chosenPath);
}

async function runSensekiValidationAction(): Promise<void> {
  // 所有 workspace 统一走通用连通性验证。senseki hardcode 寻路场景仅由底栏 #mvp-senseki-pf demo
  // 按钮触发,workspace pipeline 不再走 SENSEKI_RAIL/SENSEKI_PF_OVERRIDES 这条 hardcode 路径。
  if (!state.source || state.source.features.length === 0) {
    throw new Error("No source loaded. Load candidates from the Clean step first.");
  }
  const topo = state.topo || compileTopology();
  const start = performance.now();

  const statCount = topo.stations.length;
  const platCount = topo.platforms.length;
  const edgeCount = topo.edges.length;

  const elapsed = (performance.now() - start).toFixed(0);

  setStepProgress("validate", {
    status: "done",
    summary: `Validation: ${statCount} stations, ${platCount} platforms, ${edgeCount} edges in ${elapsed}ms.`,
    lastAction: "runSensekiValidation",
    completedActions: dedupe([...(activeWorkspace().progress.validate.completedActions ?? []), "runSensekiValidation"]),
    diagnostics: diagnosticSummaries(),
  });
  invalidateDownstream("validate", "Validation was re-run. Export a fresh snapshot.");
  unlockStep("export", "Validation completed. Export snapshots or inspect diagnostics.");
  renderFeatures();
  refreshViews();
  mapView?.fitToData();
}

function exportWorkflowSnapshot(): void {
  const snapshot = exportSensekiSnapshot();
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `senseki-demo-${ts}.railround.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function unlockStep(step: WorkflowStep, summaryText: string): void {
  const progress = activeWorkspace().progress[step];
  if (progress.status === "blocked" || progress.status === "notStarted") {
    setStepProgress(step, {
      status: "ready",
      summary: summaryText,
    });
  }
}

function workflowLabel(step: WorkflowStep): string {
  return WORKFLOW_STEPS.find((item) => item.key === step)?.label ?? step;
}

function actionLabel(action: WorkflowAction): string {
  switch (action) {
    case "extractAndMatch":
      return "Prepare Data";
    case "refreshArtifacts":
      return "Refresh";
    case "loadWorkspaceSource":
      return "Load Source";
    case "compileTopology":
      return "Compile";
    case "runSensekiValidation":
      return "Validate";
    case "exportSnapshot":
      return "Export Snapshot";
  }
}

function statusLabel(status: StepProgressStatus): string {
  switch (status) {
    case "notStarted":
      return "Not started";
    case "ready":
      return "Ready";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "blocked":
      return "Blocked";
    case "error":
      return "Error";
    case "stale":
      return "Stale";
  }
}

function shortPath(path: string): string {
  if (!path) return "not set";
  const parts = path.split(/[\\/]/);
  if (parts.length <= 3) return path;
  return `${parts[0]}\\...\\${parts.slice(-2).join("\\")}`;
}

function diagnosticsHaveErrors(): boolean {
  return state.diagnostics.some((item) => item.level === "fatal" || item.level === "error");
}

function diagnosticSummaries(): string[] {
  return state.diagnostics.slice(0, 30).map((item) => `${item.level}: ${item.code} - ${item.message}`);
}

function topologySummaryText(): string {
  const topo = state.topo;
  if (!topo) return "No topology was compiled.";
  const fatalCount = state.diagnostics.filter((item) => item.level === "fatal").length;
  const errorCount = state.diagnostics.filter((item) => item.level === "error").length;
  const warnCount = state.diagnostics.filter((item) => item.level === "warn").length;
  return [
    `Compiled ${topo.edges.length} edges, ${topo.stations.length} stations, ${topo.platforms.length} platforms.`,
    `${fatalCount + errorCount} error(s), ${warnCount} warning(s).`,
  ].join(" ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function startPipelinePolling(): void {
  stopPipelinePolling();
  if (!activePipelineTask) return;
  pipelinePollTimer = window.setInterval(async () => {
    if (!activePipelineTask) return;
    try {
      activePipelineTask = await getPipelineTask(activePipelineTask.id);
      renderWorkflowChrome();
      if (activePipelineTask.status !== "running") {
        stopPipelinePolling();
        try {
          pipelineArtifacts = await listPipelineArtifacts(activeProject());
          renderWorkflowChrome();
        } catch {
          // Artifact refresh is secondary to task completion.
        }
      }
    } catch (error) {
      stopPipelinePolling();
      handleError(error);
    }
  }, 1000);
}

function stopPipelinePolling(): void {
  if (pipelinePollTimer != null) {
    window.clearInterval(pipelinePollTimer);
    pipelinePollTimer = null;
  }
}

function bindUi(): void {
  document.getElementById("mvp-sample")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (input) {
      input.value = JSON.stringify(sampleGeoJson(), null, 2);
    }
  });

  document.getElementById("mvp-liangmiansixian")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (input) {
      input.value = JSON.stringify(buildLiangMianSiXianGeoJson(), null, 2);
    }
    const geoJson = buildLiangMianSiXianGeoJson();
    loadGeoJson(geoJson);
    compileTopology();
    for (const b of BINDING_PLAN) addPlatformTrackBinding(b);
    for (const s of STOP_PLAN) confirmStoppingPoint(s);
    compileTopology();
    lastPathfindingResults = undefined;
    renderFeatures();
    refreshViews();
    mapView?.fitToData();
  });

  document.getElementById("mvp-senseki")?.addEventListener("click", () => {
    try {
      loadGeoJson(SENSEKI_RAIL);
      importGeoJson(SENSEKI_STATIONS);
      const { applied, total } = applyAnnotationOverrides();
      compileTopology();
      if (total > 0) {
        console.log(`[senseki] applied ${applied}/${total} persisted annotation overrides`);
      }
      lastPathfindingResults = undefined;
      renderFeatures();
      refreshViews();
      mapView?.fitToData();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-clear-overrides")?.addEventListener("click", () => {
    clearAnnotationOverrides();
    console.log("[senseki] cleared all persisted annotation overrides");
  });

  document.getElementById("mvp-load")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (!input) return;
    try {
      loadGeoJson(input.value);
      lastPathfindingResults = undefined;
      compileTopology();
      renderFeatures();
      refreshViews();
      mapView?.fitToData();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-import")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    if (!input) return;
    try {
      importGeoJson(input.value);
      compileTopology();
      renderFeatures();
      refreshViews();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-create-object")?.addEventListener("click", () => {
    const geometryType = (selectedValue("mvp-create-geometry") || "Point") as "Point" | "LineString" | "Polygon";
    const kind = (selectedValue("mvp-create-kind") || "unknown") as RailGraphKind;
    const coordinatesText = (document.getElementById("mvp-create-coordinates") as HTMLTextAreaElement | null)?.value ?? "";
    const name = (document.getElementById("mvp-create-name") as HTMLInputElement | null)?.value ?? "";
    try {
      createFeature({
        geometryType,
        coordinates: JSON.parse(coordinatesText) as GeoJSONPosition | GeoJSONPosition[] | GeoJSONPosition[][],
        kind,
        name,
      });
      compileTopology();
      renderFeatures();
      refreshViews();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-compile")?.addEventListener("click", () => {
    compileTopology();
    renderFeatures();
    refreshViews();
  });

  document.getElementById("mvp-add-binding")?.addEventListener("click", () => {
    const topo = state.topo ?? compileTopology();
    const stationRef = selectedValue("mvp-station-ref") || topo.stations[0]?.id;
    const platformRef = selectedValue("mvp-platform-ref") || topo.platforms[0]?.id;
    const edgeRef = selectedValue("mvp-edge-ref") || topo.edges[0]?.id;
    const side = (selectedValue("mvp-binding-side") || "unknown") as PlatformTrackBinding["side"];
    if (stationRef && platformRef && edgeRef) {
      addPlatformTrackBinding({ stationRef, platformRef, edgeRef, side });
      compileTopology();
    }
    refreshViews();
  });

  document.getElementById("mvp-add-stop")?.addEventListener("click", () => {
    const topo = state.topo ?? compileTopology();
    const stationRef = selectedValue("mvp-station-ref") || topo.stations[0]?.id;
    const platformRef = selectedValue("mvp-platform-ref") || topo.platforms[0]?.id;
    const edgeRef = selectedValue("mvp-edge-ref") || topo.edges[0]?.id;
    const direction = (selectedValue("mvp-stop-direction") || "both") as StoppingPoint["direction"];
    const measure = Number((document.getElementById("mvp-stop-measure") as HTMLInputElement | null)?.value ?? "0.5");
    if (stationRef && platformRef && edgeRef) {
      confirmStoppingPoint({ stationRef, platformRef, edgeRef, direction, measure });
      compileTopology();
    }
    refreshViews();
  });

  document.getElementById("mvp-export-geojson")?.addEventListener("click", () => writeExportToInput(exportAnnotatedGeoJson()));
  document.getElementById("mvp-export-topo")?.addEventListener("click", () => writeExportToInput(exportTopology()));

  document.getElementById("mvp-export-snapshot")?.addEventListener("click", () => {
    try {
      const snapshot = exportSensekiSnapshot();
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `senseki-demo-${ts}.railround.json`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`[snapshot] exported ${filename}`, {
        counts: snapshot.topologySummary.counts,
        diagnostics: snapshot.topologySummary.diagnosticCounts,
        overrides: Object.keys(snapshot.overrides).length,
        bindings: snapshot.bindings.length,
        stoppingPoints: snapshot.stoppingPoints.length,
      });
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-import-snapshot")?.addEventListener("click", () => {
    const fileInput = document.getElementById("mvp-import-snapshot-file") as HTMLInputElement | null;
    if (!fileInput) return;
    fileInput.value = "";
    fileInput.click();
  });

  document.getElementById("mvp-import-snapshot-file")?.addEventListener("change", async (e) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Not a valid snapshot (not an object).");
      }
      const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
      if (schemaVersion !== "senseki-demo-v1" && schemaVersion !== "senseki-demo-v2") {
        throw new Error(`Not a valid senseki-demo snapshot. schemaVersion=${String(schemaVersion)}`);
      }
      const snapshot = parsed as SensekiDemoSnapshot;
      const confirmMessage = [
        `Import demo snapshot exported at ${snapshot.exportedAt}?`,
        `This will REPLACE current localStorage annotation overrides, in-memory bindings and stopping points.`,
        `Tip: Export current state first if you want to keep it.`,
      ].join("\n\n");
      if (!window.confirm(confirmMessage)) return;
      const result = importSensekiSnapshot(snapshot);
      console.log(`[snapshot] imported`, result);
      if (!result.hashMatch) {
        console.warn(
          `[snapshot] senseki-data.ts hash mismatch — exported ${result.exportedHash} vs current ${result.currentHash}. ` +
          `Annotation overrides may not fully bind; check Diagnostics tab.`,
        );
        window.alert(
          `Snapshot imported, but senseki-data.ts hash differs (exported: ${result.exportedHash}, current: ${result.currentHash}).\n` +
          `Restored ${result.bindingsRestored} bindings, ${result.stoppingPointsRestored} stopping points, ` +
          `${result.overridesApplied}/${result.overridesTotal} annotation overrides matched.\n` +
          `Check Diagnostics tab for missing-binding warnings.`,
        );
      } else {
        window.alert(
          `Snapshot imported.\n` +
          `Restored ${result.bindingsRestored} bindings, ${result.stoppingPointsRestored} stopping points, ` +
          `${result.overridesApplied}/${result.overridesTotal} annotation overrides matched.`,
        );
      }
      mapView?.fitToData();
    } catch (error) {
      handleError(error);
    }
  });

  document.getElementById("mvp-base-layer")?.addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    mapView?.setBaseLayer(select.value as "positron" | "plain");
  });
  document.getElementById("mvp-fit-data")?.addEventListener("click", () => {
    mapView?.fitToData();
  });

  document.getElementById("mvp-pathfinding")?.addEventListener("click", () => {
    const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
    const geoJson = buildTwoStationGeoJson();
    if (input) {
      input.value = JSON.stringify(geoJson, null, 2);
    }
    loadGeoJson(geoJson);
    compileTopology();
    for (const b of TWO_STATION_BINDING_PLAN) addPlatformTrackBinding(b);
    for (const s of TWO_STATION_STOP_PLAN) confirmStoppingPoint(s);
    compileTopology();

    const topo = state.topo!;
    lastPathfindingResults = runScenarios(topo);
    void summarizeScenarios;  // kept for window-side debugging
    renderFeatures();
    refreshViews();
    mapView?.fitToData();
  });

  document.getElementById("mvp-senseki-pf")?.addEventListener("click", () => {
    try {
      // 1. 确保仙石線数据已加载
      if (!state.source || state.source.features.length === 0) {
        loadGeoJson(SENSEKI_RAIL);
        importGeoJson(SENSEKI_STATIONS);
      }

      // 2. 将寻路所需的 annotation 写入 localStorage
      let saved = 0;
      for (const [id, annotation] of Object.entries(SENSEKI_PF_OVERRIDES)) {
        saveAnnotationOverride(id, annotation);
        saved += 1;
      }
      console.log(`[senseki-pf] saved ${saved} annotation overrides to localStorage`);

      // 3. 应用所有 overrides + 编译
      const { applied, total } = applyAnnotationOverrides();
      console.log(`[senseki-pf] applied ${applied}/${total} annotation overrides`);
      compileTopology();
      renderFeatures();
      refreshViews();

      // 4. 异步运行寻路 (setTimeout 让 UI 先渲染)
      const topo = state.topo!;
      console.log("[senseki-pf] 开始寻路 (异步)...");
      setTimeout(() => {
        try {
          const start = performance.now();
          lastPathfindingResults = runSensekiScenarios(topo);
          const elapsed = (performance.now() - start).toFixed(0);
          const summary = summarizeSensekiResults(lastPathfindingResults as SensekiScenarioResult[]);
          console.log(`[senseki-pf] 完成, 耗时 ${elapsed}ms, results:`, summary);
          refreshViews();
          mapView?.fitToData();
        } catch (error) {
          handleError(error);
        }
      }, 20);
    } catch (error) {
      handleError(error);
    }
  });
}

function renderFeatures(): void {
  const container = document.getElementById("mvp-features");
  if (!container) {
    return;
  }
  container.innerHTML = "";
}

function updateAnnotationFromElement(element: HTMLElement): void {
  const featureIndex = Number(element.dataset.featureIndex);
  const kind = (element.querySelector<HTMLSelectElement>('[data-field="kind"]')?.value ?? "unknown") as RailGraphKind;
  const name = element.querySelector<HTMLInputElement>('[data-field="name"]')?.value ?? "";
  const role = element.querySelector<HTMLSelectElement>('[data-field="role"]')?.value as TopologyEdge["role"] | undefined;
  const traversal = element.querySelector<HTMLSelectElement>('[data-field="traversal"]')?.value as TopologyEdge["traversal"] | undefined;
  const physicalKindRaw = element.querySelector<HTMLSelectElement>('[data-field="physicalKind"]')?.value ?? "";
  const directionRoleRaw = element.querySelector<HTMLSelectElement>('[data-field="directionRole"]')?.value ?? "";
  const functionalUseRaw = element.querySelector<HTMLInputElement>('[data-field="functionalUse"]')?.value ?? "";
  const platformTypeRaw = element.querySelector<HTMLSelectElement>('[data-field="platformType"]')?.value ?? "";

  const functionalUse = functionalUseRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ("through" | "stopping" | "passing" | "turnback" | "storage")[];

  annotateFeature(featureIndex, {
    kind,
    track: kind === "track_geometry" ? {
      role: role ?? "main",
      traversal: traversal ?? "both",
      name,
      physicalKind: physicalKindRaw ? (physicalKindRaw as "main" | "siding" | "yard" | "lead" | "safety") : undefined,
      directionRole: directionRoleRaw ? (directionRoleRaw as any) : undefined,
      functionalUse: functionalUse.length > 0 ? functionalUse : undefined,
    } : undefined,
    station: kind === "station_point" ? { name: name || `Station ${featureIndex + 1}` } : undefined,
    platform: kind === "platform_area" ? {
      name: name || `Platform ${featureIndex + 1}`,
      type: platformTypeRaw ? (platformTypeRaw as "side" | "island" | "bay" | "unknown") : undefined,
    } : undefined,
  });
  refreshViews();
}

function kindOption(kind: RailGraphKind, selected?: RailGraphKind): string {
  return `<option value="${kind}" ${kind === selected ? "selected" : ""}>${kind}</option>`;
}

function topoOptions(kind: "stations" | "platforms" | "edges"): string {
  const topo = state.topo;
  if (!topo) {
    return `<option value="">Compile first</option>`;
  }

  const items = kind === "stations"
    ? topo.stations.map((item) => ({ id: item.id, label: item.name }))
    : kind === "platforms"
      ? topo.platforms.map((item) => ({ id: item.id, label: item.name || item.id }))
      : topo.edges.map((item) => ({ id: item.id, label: item.name || item.trackCode || item.id }));

  if (items.length === 0) {
    return `<option value="">None</option>`;
  }
  return items.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.label)}</option>`).join("");
}

function selectedValue(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement | null)?.value ?? "";
}

function writeExportToInput(value: unknown): void {
  const input = document.getElementById("mvp-input") as HTMLTextAreaElement | null;
  if (input) {
    input.value = JSON.stringify(value, null, 2);
    input.scrollIntoView({ block: "nearest" });
  }
}

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[MVP]", error);
  // 软提示, 不打断
  alert(message);
}

function summary(): unknown {
  return {
    loadedFeatures: state.source?.features.length ?? 0,
    bindings: state.bindings.length,
    stoppingPoints: state.stoppingPoints.length,
    compiled: state.topo ? {
      nodes: state.topo.nodes.length,
      edges: state.topo.edges.length,
      stations: state.topo.stations.length,
      platforms: state.topo.platforms.length,
      platformTrackBindings: state.topo.platformTrackBindings.length,
      confirmedStoppingPoints: state.topo.stoppingPoints.length,
    } : null,
    diagnostics: state.diagnostics,
  };
}

void summary;  // 保留供 window-side debug 调用

function sampleGeoJson(): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [139.7000, 35.6900] },
        properties: { name: "Sample Station" },
      },
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[139.6998, 35.6899], [139.7002, 35.6899], [139.7002, 35.6901], [139.6998, 35.6901], [139.6998, 35.6899]]] },
        properties: { name: "Platform 1" },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[139.6990, 35.6900], [139.7000, 35.6900], [139.7010, 35.6900]] },
        properties: { name: "Track 1" },
      },
    ],
  };
}

function escapeHtml(value: string): string {
  const str = String(value ?? "");
  return str.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    railGraphMvp: {
      state,
      loadGeoJson,
      annotateFeature,
      addPlatformTrackBinding,
      confirmStoppingPoint,
      compileTopology,
      exportAnnotatedGeoJson,
      exportTopology,
      exportDiagnostics,
      runFilterPipeline,
      registerRuleHandler,
      fidOf,
      get lastPipelineRun() { return lastPipelineRun; },
    },
  });

  render();
  void runSettingsScan();
}
