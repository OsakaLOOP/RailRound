export type PipelineStage =
  | "diagnose"
  | "extract"
  | "emitFast"
  | "postFix"
  | "match"
  | "manifest";

export type PipelineTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type WorkflowStep = "prepare" | "clean" | "annotate" | "compile" | "validate" | "export";

export type WorkflowAction =
  | "extractAndMatch"
  | "refreshArtifacts"
  | "loadWorkspaceSource"
  | "compileTopology"
  | "runSensekiValidation"
  | "exportSnapshot";

export interface MvpProjectState {
  id: string;
  name: string;
  scriptsRoot: string;
  pbfPath: string;
  cacheDbPath: string;
  osmOutputDir: string;
  referenceGeoJsonPath: string;
  matchedOutputRoot: string;
  companyDir: string;
  companyName: string;
  lineName: string;
  lineDisplayName: string;
  lineDir: string;
  sourceGeoJsonPath: string;
  overridePath: string;
  selectedStage: PipelineStage;
  selectedStep: WorkflowStep;
  selectedPresetId: string;
  selectedArtifactPath: string;
}

export interface PipelineTaskState {
  id: string;
  stage: PipelineStage;
  status: PipelineTaskStatus;
  command: string[];
  cwd: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  log: string[];
  artifacts: string[];
  error?: string;
}

export interface PipelineArtifact {
  path: string;
  name: string;
  kind: "geojson" | "json" | "sqlite" | "log" | "other";
  size: number;
  modifiedAt: string;
}

export type StepProgressStatus = "notStarted" | "ready" | "running" | "done" | "blocked" | "error" | "stale";

export interface WorkflowStepProgress {
  status: StepProgressStatus;
  summary: string;
  updatedAt?: string;
  lastAction?: WorkflowAction;
  completedActions: WorkflowAction[];
  artifacts: string[];
  diagnostics: string[];
}

export interface LineWorkspaceState {
  key: string;
  project: MvpProjectState;
  currentStep: WorkflowStep;
  recommendedStep: WorkflowStep;
  progress: Record<WorkflowStep, WorkflowStepProgress>;
  ui?: {
    cleanFilters?: Record<string, boolean>;
    cleanLevels?: Record<string, boolean>;
    cleanSearchQuery?: string;
    cleanSelectMode?: false | "select-queue" | "staging-origin" | "staging-terminus" | "staging-via";
    cleanSelectedCandidateFid?: string | null;
    selectionQueue?: string[];
    ruleParamOverrides?: Record<string, Record<string, any>>;
  };
  lastTaskId?: string;
  staging?: {
    origin?: string;
    terminus?: string;
    via: string[];
    stagedWayFids: string[];
    candidates?: string[][];
    activeCandidateIndex?: number;
  };
  updatedAt: string;
}

export interface MvpWorkspaceState {
  activeKey: string;
  workspaces: Record<string, LineWorkspaceState>;
}

export interface ProjectPreset {
  id: string;
  label: string;
  description: string;
  project: Omit<MvpProjectState, "selectedStage" | "selectedStep" | "selectedPresetId" | "selectedArtifactPath">;
}

export const WORKFLOW_STEPS: ReadonlyArray<{
  key: WorkflowStep;
  label: string;
  purpose: string;
  primaryAction: WorkflowAction;
  secondaryActions: WorkflowAction[];
}> = [
  {
    key: "prepare",
    label: "Data",
    purpose: "Choose a dataset and prepare matched rail assets from PBF/cache.",
    primaryAction: "extractAndMatch",
    secondaryActions: ["refreshArtifacts"],
  },
  {
    key: "clean",
    label: "Clean",
    purpose: "Review matched objects, generate batches, and apply keep/remove decisions.",
    primaryAction: "loadWorkspaceSource",
    secondaryActions: ["refreshArtifacts"],
  },
  {
    key: "annotate",
    label: "Annotate",
    purpose: "Use the right inspector and map selection to label tracks, platforms, stations, signals, and directions.",
    primaryAction: "loadWorkspaceSource",
    secondaryActions: ["refreshArtifacts"],
  },
  {
    key: "compile",
    label: "Compile",
    purpose: "Build topology from the current annotated source and inspect diagnostics.",
    primaryAction: "compileTopology",
    secondaryActions: [],
  },
  {
    key: "validate",
    label: "Validate",
    purpose: "Run pathfinding scenarios and inspect candidates, traces, and map animation.",
    primaryAction: "runSensekiValidation",
    secondaryActions: [],
  },
  {
    key: "export",
    label: "Export",
    purpose: "Export annotated GeoJSON, topology, diagnostics, snapshots, and local pipeline artifacts.",
    primaryAction: "exportSnapshot",
    secondaryActions: ["refreshArtifacts"],
  },
];

export const PROJECT_PRESETS: ReadonlyArray<ProjectPreset> = [
  {
    id: "senseki",
    label: "仙石線 end-to-end",
    description: "Default validation dataset for the MVP workflow.",
    project: {
      id: "local",
      name: "仙石線 MVP Workspace",
      scriptsRoot: "D:\\GIS\\scripts",
      pbfPath: "D:\\GIS\\japan-260428.osm.pbf",
      cacheDbPath: "D:\\GIS\\out_japan_rail\\japan-260428.rail_cache.sqlite",
      osmOutputDir: "D:\\GIS\\out_japan_rail",
      referenceGeoJsonPath: "D:\\GIS\\geojson_source\\東日本旅客鉄道.geojson",
      matchedOutputRoot: "D:\\GIS\\matched_by_company",
      companyDir: "D:\\GIS\\matched_by_company\\東日本旅客鉄道",
      companyName: "東日本旅客鉄道",
      lineName: "仙石線",
      lineDisplayName: "仙石線",
      lineDir: "D:\\GIS\\matched_by_company\\東日本旅客鉄道\\仙石線",
      sourceGeoJsonPath: "D:\\GIS\\geojson_source\\東日本旅客鉄道.geojson",
      overridePath: "D:\\GIS\\scripts\\overrides\\東日本旅客鉄道__仙石線.override.json",
    },
  },
  {
    id: "tokaido-jre",
    label: "東海道線 (JR東日本) cleaning",
    description: "Existing batch/decision sample from D:\\GIS\\scripts.",
    project: {
      id: "local",
      name: "東海道線 Cleaning Workspace",
      scriptsRoot: "D:\\GIS\\scripts",
      pbfPath: "D:\\GIS\\japan-260428.osm.pbf",
      cacheDbPath: "D:\\GIS\\out_japan_rail\\japan-260428.rail_cache.sqlite",
      osmOutputDir: "D:\\GIS\\out_japan_rail",
      referenceGeoJsonPath: "D:\\GIS\\geojson_source\\東日本旅客鉄道.geojson",
      matchedOutputRoot: "D:\\GIS\\matched_by_company",
      companyDir: "D:\\GIS\\matched_by_company\\東日本旅客鉄道",
      companyName: "東日本旅客鉄道",
      lineName: "東海道線_(JR東日本)",
      lineDisplayName: "東海道線 (JR東日本)",
      lineDir: "D:\\GIS\\matched_by_company\\東日本旅客鉄道\\東海道線_(JR東日本)",
      sourceGeoJsonPath: "D:\\GIS\\geojson_source\\東日本旅客鉄道.geojson",
      overridePath: "D:\\GIS\\scripts\\overrides\\東日本旅客鉄道__東海道線_(JR東日本).override.json",
    },
  },
];

export const PIPELINE_STAGES: ReadonlyArray<{
  key: PipelineStage;
  label: string;
  description: string;
  outputHint: string;
}> = [
  {
    key: "diagnose",
    label: "1. Diagnose PBF",
    description: "Inspect railway tag coverage before extraction.",
    outputHint: "Console report only",
  },
  {
    key: "extract",
    label: "2. Extract OSM buckets",
    description: "Read .osm.pbf into SQLite cache and GeoJSON rail buckets.",
    outputHint: "rail_lines.geojson, station_points.geojson, cache sqlite",
  },
  {
    key: "emitFast",
    label: "3. Re-emit from cache",
    description: "Regenerate GeoJSON buckets from an existing SQLite cache.",
    outputHint: "*.geojson buckets",
  },
  {
    key: "postFix",
    label: "4. Post-fix GeoJSON",
    description: "Apply deterministic bucket cleanup after extraction.",
    outputHint: "Updated bucket GeoJSON files",
  },
  {
    key: "match",
    label: "5. Match company lines",
    description: "Match extracted OSM rail assets to reference company lines.",
    outputHint: "matched_assets/high/medium/low GeoJSON",
  },
  {
    key: "manifest",
    label: "6. Build manifest",
    description: "Refresh line/company artifact index for browsing.",
    outputHint: "match_manifest.json",
  },
];

const PROJECT_KEY = "railround:mvp:pipeline-project:v1";
const WORKSPACE_KEY = "railround:mvp:workspace-state:v1";

export function workspaceKey(project: Pick<MvpProjectState, "companyName" | "lineName">): string {
  return `${project.companyName}::${project.lineName}`;
}

function emptyProgress(): Record<WorkflowStep, WorkflowStepProgress> {
  return {
    prepare: {
      status: "ready",
      summary: "Dataset selected. Prepare matched assets from PBF/cache or load existing artifacts.",
      completedActions: [],
      artifacts: [],
      diagnostics: [],
    },
    clean: {
      status: "blocked",
      summary: "Waiting for matched assets.",
      completedActions: [],
      artifacts: [],
      diagnostics: [],
    },
    annotate: {
      status: "blocked",
      summary: "Waiting for cleaned or imported source.",
      completedActions: [],
      artifacts: [],
      diagnostics: [],
    },
    compile: {
      status: "blocked",
      summary: "Waiting for annotations.",
      completedActions: [],
      artifacts: [],
      diagnostics: [],
    },
    validate: {
      status: "blocked",
      summary: "Waiting for compiled topology.",
      completedActions: [],
      artifacts: [],
      diagnostics: [],
    },
    export: {
      status: "blocked",
      summary: "Waiting for validated or compiled results.",
      completedActions: [],
      artifacts: [],
      diagnostics: [],
    },
  };
}

export function createLineWorkspace(project: MvpProjectState): LineWorkspaceState {
  const key = workspaceKey(project);
  return {
    key,
    project: { ...project, selectedStep: project.selectedStep ?? "prepare" },
    currentStep: project.selectedStep ?? "prepare",
    recommendedStep: "prepare",
    progress: emptyProgress(),
    updatedAt: new Date().toISOString(),
  };
}

export function createDefaultWorkspaceState(): MvpWorkspaceState {
  const project = createDefaultProject();
  const workspace = createLineWorkspace(project);
  return {
    activeKey: workspace.key,
    workspaces: { [workspace.key]: workspace },
  };
}

export function createDefaultProject(): MvpProjectState {
  return projectFromPreset("senseki", {
    selectedStage: "extract",
    selectedStep: "prepare",
    selectedArtifactPath: "",
  });
}

export function projectFromPreset(
  presetId: string,
  state?: Partial<Pick<MvpProjectState, "selectedStage" | "selectedStep" | "selectedArtifactPath">>,
): MvpProjectState {
  const preset = PROJECT_PRESETS.find((item) => item.id === presetId) ?? PROJECT_PRESETS[0];
  return {
    ...preset.project,
    selectedStage: state?.selectedStage ?? "extract",
    selectedStep: state?.selectedStep ?? "prepare",
    selectedPresetId: preset.id,
    selectedArtifactPath: state?.selectedArtifactPath ?? "",
  };
}

export function loadProject(): MvpProjectState {
  if (typeof localStorage === "undefined") return createDefaultProject();
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return createDefaultProject();
    return { ...createDefaultProject(), ...JSON.parse(raw) as Partial<MvpProjectState> };
  } catch {
    return createDefaultProject();
  }
}

export function saveProject(project: MvpProjectState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

export function loadWorkspaceState(): MvpWorkspaceState {
  if (typeof localStorage === "undefined") return createDefaultWorkspaceState();
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return createDefaultWorkspaceState();
    const parsed = JSON.parse(raw) as MvpWorkspaceState;
    if (!parsed.activeKey || !parsed.workspaces) return createDefaultWorkspaceState();
    return parsed;
  } catch {
    return createDefaultWorkspaceState();
  }
}

export function saveWorkspaceState(workspace: MvpWorkspaceState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
}

export function getActiveWorkspace(workspace: MvpWorkspaceState): LineWorkspaceState {
  return workspace.workspaces[workspace.activeKey] ?? Object.values(workspace.workspaces)[0] ?? createLineWorkspace(createDefaultProject());
}

export function buildStageCommand(stage: PipelineStage, project: MvpProjectState): string[] {
  const script = (name: string): string => `${project.scriptsRoot}\\${name}`;
  switch (stage) {
    case "diagnose":
      return ["python", script("diagnose_osm_tags.py"), "--input", project.pbfPath];
    case "extract":
      return [
        "python", script("extract_rail_osm.py"),
        "--input", project.pbfPath,
        "--output-dir", project.osmOutputDir,
        "--cache-db", project.cacheDbPath,
      ];
    case "emitFast":
      return [
        "python", script("emit_geojson_fast.py"),
        "--cache-db", project.cacheDbPath,
        "--output-dir", project.osmOutputDir,
        "--pbf", project.pbfPath,
      ];
    case "postFix":
      return ["python", script("fix_geojson_post.py"), "--input-dir", project.osmOutputDir];
    case "match":
      return [
        "python", script("match_company_lines.py"),
        "--reference", project.referenceGeoJsonPath,
        "--osm-dir", project.osmOutputDir,
        "--output-root", project.matchedOutputRoot,
      ];
    case "manifest":
      return ["python", script("build_match_manifest.py")];
  }
}

export function commandPreview(command: string[]): string {
  return command.map((part) => /\s/.test(part) ? `"${part}"` : part).join(" ");
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : null;
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : response.statusText;
    throw new Error(message);
  }
  return data as T;
}

export async function startPipelineTask(
  stage: PipelineStage,
  project: MvpProjectState,
): Promise<PipelineTaskState> {
  return requestJson<PipelineTaskState>("/api/rail-graph-mvp/tasks", {
    method: "POST",
    body: JSON.stringify({ stage, project }),
  });
}

export async function getPipelineTask(taskId: string): Promise<PipelineTaskState> {
  return requestJson<PipelineTaskState>(`/api/rail-graph-mvp/tasks/${encodeURIComponent(taskId)}`);
}

export async function cancelPipelineTask(taskId: string): Promise<PipelineTaskState> {
  return requestJson<PipelineTaskState>(`/api/rail-graph-mvp/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    body: "{}",
  });
}

export async function listPipelineArtifacts(project: MvpProjectState): Promise<PipelineArtifact[]> {
  return requestJson<PipelineArtifact[]>("/api/rail-graph-mvp/artifacts", {
    method: "POST",
    body: JSON.stringify({ project }),
  });
}

export async function readPipelineArtifact(path: string): Promise<unknown> {
  return requestJson<unknown>("/api/rail-graph-mvp/artifact/read", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export interface MvpGlobalSettings {
  scriptsRoot: string;
  pbfPath: string;
  cacheDbPath: string;
  osmOutputDir: string;
  matchedOutputRoot: string;
  geojsonSourceDir: string;
}

export const DEFAULT_GLOBAL_SETTINGS: MvpGlobalSettings = {
  scriptsRoot: "D:\\GIS\\scripts",
  pbfPath: "D:\\GIS\\japan-260428.osm.pbf",
  cacheDbPath: "D:\\GIS\\out_japan_rail\\japan-260428.rail_cache.sqlite",
  osmOutputDir: "D:\\GIS\\out_japan_rail",
  matchedOutputRoot: "D:\\GIS\\matched_by_company",
  geojsonSourceDir: "D:\\GIS\\geojson_source",
};

const GLOBAL_SETTINGS_KEY = "railround:mvp:global-settings:v1";

/* 仅对全局配置加载功能添加简短中英注释 / Simple comments for global settings loading */
export function loadGlobalSettings(): MvpGlobalSettings {
  if (typeof localStorage === "undefined") return DEFAULT_GLOBAL_SETTINGS;
  try {
    const raw = localStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (!raw) return DEFAULT_GLOBAL_SETTINGS;
    return { ...DEFAULT_GLOBAL_SETTINGS, ...JSON.parse(raw) as Partial<MvpGlobalSettings> };
  } catch {
    return DEFAULT_GLOBAL_SETTINGS;
  }
}

/* 保存全局配置到本地 / Save global settings to localStorage */
export function saveGlobalSettings(settings: MvpGlobalSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
}

export interface CompanyLineMetadata {
  name: string;
  path: string;
  artifacts: {
    matchedAssets: boolean;
    matchedHigh: boolean;
    matchReport: boolean;
  };
  matchedAssetsSize: number;
  matchedHighSize: number;
}

export interface CompanyMetadata {
  name: string;
  path: string;
  lines: CompanyLineMetadata[];
}

export interface PathScanResult {
  scriptsRoot: {
    exists: boolean;
    ok: boolean;
    files: Record<string, boolean>;
  };
  pbf: {
    exists: boolean;
    size: number;
    modifiedAt: string;
  };
  cacheDb: {
    exists: boolean;
    size: number;
    modifiedAt: string;
  };
  geojsonSourceDir: {
    exists: boolean;
    files: {
      name: string;
      path: string;
      size: number;
      modifiedAt: string;
    }[];
  };
  osmOutputDir: {
    exists: boolean;
  };
  matchedOutputRoot: {
    exists: boolean;
    companies: CompanyMetadata[];
  };
}

/* 扫描全局路径和产物文件 / Scan paths and artifacts on the backend */
export async function scanPaths(settings: MvpGlobalSettings): Promise<PathScanResult> {
  return requestJson<PathScanResult>("/api/rail-graph-mvp/metadata/scan-paths", {
    method: "POST",
    body: JSON.stringify({ settings }),
  });
}

export interface CompaniesListResult {
  companies: {
    name: string;
    lines: string[];
  }[];
}

/* 动态获取公司-线路下拉列表 / Fetch company-line metadata */
export async function fetchCompaniesAndLines(matchedOutputRoot: string): Promise<CompaniesListResult["companies"]> {
  try {
    const data = await requestJson<CompaniesListResult>("/api/rail-graph-mvp/metadata/companies-and-lines", {
      method: "POST",
      body: JSON.stringify({ matchedOutputRoot }),
    });
    return data.companies;
  } catch (error) {
    console.error("Failed to fetch companies and lines", error);
    return [];
  }
}

/* 创建新工作区项目状态 / Create a new custom workspace project state */
export function createProjectForWorkspace(
  name: string,
  companyName: string,
  lineName: string,
  settings: MvpGlobalSettings
): MvpProjectState {
  const id = `custom-${Date.now().toString(36)}`;
  return {
    id,
    name,
    scriptsRoot: settings.scriptsRoot,
    pbfPath: settings.pbfPath,
    cacheDbPath: settings.cacheDbPath,
    osmOutputDir: settings.osmOutputDir,
    referenceGeoJsonPath: `${settings.geojsonSourceDir}\\${companyName}.geojson`,
    matchedOutputRoot: settings.matchedOutputRoot,
    companyDir: `${settings.matchedOutputRoot}\\${companyName}`,
    companyName,
    lineName,
    lineDisplayName: lineName,
    lineDir: `${settings.matchedOutputRoot}\\${companyName}\\${lineName}`,
    sourceGeoJsonPath: `${settings.geojsonSourceDir}\\${companyName}.geojson`,
    overridePath: `${settings.scriptsRoot}\\overrides\\${companyName}__${lineName}.override.json`,
    selectedStage: "extract",
    selectedStep: "prepare",
    selectedPresetId: "custom",
    selectedArtifactPath: "",
  };
}

export interface LineArtifactFile {
  exists: boolean;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface LineArtifacts {
  lineDir: string;
  exists: boolean;
  matchedAssets: LineArtifactFile;
  matchedHigh: LineArtifactFile;
  matchedMedium: LineArtifactFile;
  matchedLow: LineArtifactFile;
  matchReport: LineArtifactFile;
}

/* 获取一条 line 目录下 matched_* 与 match_report 的文件状态 / Inspect a single line's artifact directory */
export async function fetchLineArtifacts(project: MvpProjectState): Promise<LineArtifacts> {
  return requestJson<LineArtifacts>("/api/rail-graph-mvp/metadata/line-artifacts", {
    method: "POST",
    body: JSON.stringify({
      lineDir: project.lineDir,
      companyDir: project.companyDir,
      lineName: project.lineName,
    }),
  });
}

export interface MvpOverrideState {
  k: string; // company__line
  remove: string[];
  keep: string[];
  meta: Record<string, {
    reason: string;
    input_match_score?: number | null;
    input_match_level?: string;
    confidence_adjust?: string;
  }>;
}

export async function saveOverrides(path: string, override: MvpOverrideState): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/rail-graph-mvp/overrides/save", {
    method: "POST",
    body: JSON.stringify({ path, override }),
  });
}

export async function readOverrides(path: string): Promise<MvpOverrideState> {
  return requestJson<MvpOverrideState>("/api/rail-graph-mvp/overrides/read", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}
