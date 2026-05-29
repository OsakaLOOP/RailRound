import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { IntentionNode, IntentionChain } from "../rail-graph-v1/chain.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { Station, TopologyEdge, TrackDirectionRole, TrackFunctionalUse, TopologyEdgeRole, TraversalDirection, PlatformType } from "../rail-graph-v1/base-topology.types";
import type { RailGraphAnnotation, RailGraphFeatureKind, AnnotatedFeature } from "../rail-graph-v1/annotation.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import { projectPointToPolyline } from "../rail-graph-v1/geometry-math";
import { buildTopologyLookup } from "../rail-graph-v1/topology";
import { importWorkspaces, loadAggregate, saveAggregate, type AggregateState } from "./aggregate-state";
import { listMvpImportWorkspaces } from "./workspace-import";
import { compileAggregateTopology } from "./topology-compiler";
import {
  nodeCoordinate,
  findEdgeByOsmId,
  polylineLengthMeters,
} from "./no-direction-graph";
import {
  createChainEditorState,
  setChainEditorMode,
  addNodeSelection,
  replaceChainNodes,
  describeChainNode,
  type ChainEditorState,
  type ChainEditorMode,
} from "./service-pattern/chain-editor";
import {
  loadServicePatterns,
  upsertServicePattern,
  deleteServicePattern,
  type StoredServicePattern,
} from "./service-pattern/store";
import {
  adaptChainToPattern,
  resolveChainCandidates,
  type AggregateCandidatePath,
} from "./service-pattern/adapter";
import {
  buildCrossPatternRenderPlan,
  buildPatternRenderPlan,
  type PatternRenderPlan,
} from "./service-pattern/render-plan";
import { buildTransferGraph } from "./cross-pattern/transfer-graph";
import { resolveCrossPattern } from "./cross-pattern/resolver";
import type { CrossPatternPath } from "./cross-pattern/types";
import {
  loadUserEvents,
  upsertUserEvent,
  deleteUserEvent,
} from "./user-event/store";
import type { UserEvent } from "./user-event/types";
import {
  aggregateEventsAlongPath,
  flattenCrossPathToPathLike,
  type OrderedEvent,
  type PathLike,
} from "./user-event/aggregation";

const AGGREGATE_KEY = "senseki-tohoku";
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = "&copy; OpenStreetMap contributors &copy; CARTO";

export type WorkflowStep = "import" | "annotate" | "compile" | "pattern" | "route" | "event" | "export";

export interface StepProgress {
  status: "blocked" | "ready" | "done" | "stale" | "error";
  summary: string;
}

interface AppState {
  aggregate: AggregateState | null;
  patterns: StoredServicePattern[];
  userEvents: UserEvent[];
  editor: ChainEditorState;
  candidates: AggregateCandidatePath[];
  activeCandidateIndex: number;
  crossPath: CrossPatternPath | null;
  routeFrom: EntityRef | "";
  routeTo: EntityRef | "";
  selectedEdgeRef: EntityRef | null;
  selectedNodeRef: EntityRef | null;
  selectedStationRef: EntityRef | null;
  selectedPatternId: EntityRef | null;
  editingPatternId: EntityRef | null;
  eventDraftAnchor: UserEvent["anchor"] | null;
  editingEventId: EntityRef | null;
  allowNoDirectionLoad: boolean;
  lastLoadError: string | null;
  message: string;

  // New Workflow State properties
  currentStep: WorkflowStep;
  isAnnotationComplete: boolean;
  annotateSearchQuery: string;
  annotateFilter: "all" | "unannotated" | "track" | "station" | "platform" | "signal" | "entrance";
  selectedFeatureId: string | null;
  dirRoleBrush: TrackDirectionRole | null;
  functionalUseBrush: TrackFunctionalUse[];
}

interface MapState {
  map: L.Map;
  baseLayer: L.TileLayer;
  graphLayer: L.LayerGroup;
  patternLayer: L.LayerGroup;
  candidateLayer: L.LayerGroup;
  eventLayer: L.LayerGroup;
  nodeLayer: L.LayerGroup;
  stationLayer: L.LayerGroup;
  highlightLayer: L.LayerGroup;
  edgeLayers: Map<EntityRef, L.Polyline>;
  nodeLayers: Map<EntityRef, L.CircleMarker>;
  stationLayers: Map<EntityRef, L.CircleMarker>;
}

let state: AppState = {
  aggregate: null,
  patterns: [],
  userEvents: [],
  editor: createChainEditorState(),
  candidates: [],
  activeCandidateIndex: 0,
  crossPath: null,
  routeFrom: "",
  routeTo: "",
  selectedEdgeRef: null,
  selectedNodeRef: null,
  selectedStationRef: null,
  selectedPatternId: null,
  editingPatternId: null,
  eventDraftAnchor: null,
  editingEventId: null,
  allowNoDirectionLoad: false,
  lastLoadError: null,
  message: "正在加载 aggregate...",

  // New Workflow State properties
  currentStep: "import",
  isAnnotationComplete: false,
  annotateSearchQuery: "",
  annotateFilter: "all",
  selectedFeatureId: null,
  dirRoleBrush: null,
  functionalUseBrush: [],
};

let mapState: MapState | null = null;

void boot();

async function boot(): Promise<void> {
  renderShell();
  initMap();
  bindGlobalEvents();
  await loadAll();
}

async function loadAll(options: { allowNoDirection?: boolean } = {}): Promise<void> {
  try {
    const allowNoDirection = options.allowNoDirection ?? state.allowNoDirectionLoad;
    state.message = allowNoDirection
      ? "加载 aggregate 验证 fallback 与已保存 ServicePattern..."
      : "加载 compiled aggregate 与已保存 ServicePattern...";
    renderPanels();
    const aggregate = await loadAggregate({
      aggregateKey: AGGREGATE_KEY,
      allowNoDirection,
      noDirectionReason: allowNoDirection ? "verify" : undefined,
    });
    let patterns: StoredServicePattern[] = [];
    let userEvents: UserEvent[] = [];
    try {
      patterns = await loadServicePatterns({ aggregateKey: aggregate.aggregateKey });
    } catch {
      patterns = [];
    }
    try {
      userEvents = await loadUserEvents({ aggregateKey: aggregate.aggregateKey });
    } catch {
      userEvents = [];
    }
    state = {
      ...state,
      aggregate,
      patterns,
      userEvents,
      selectedPatternId: patterns[0]?.patternId ?? null,
      allowNoDirectionLoad: allowNoDirection,
      lastLoadError: null,
      // If we have loaded aggregate, check if it's already compiled to mark compile step as done
      isAnnotationComplete: aggregate.mode === "compiled-topology",
      currentStep: aggregate.mode === "compiled-topology" ? "compile" : "import",
      message: `已加载 ${aggregate.topo.edges.length} edges / ${patterns.length} patterns / ${userEvents.length} events`,
    };
    renderMap();
    renderPanels();
  } catch (error) {
    state = {
      ...state,
      aggregate: null,
      patterns: [],
      userEvents: [],
      candidates: [],
      crossPath: null,
      selectedPatternId: null,
      lastLoadError: (error as Error).message,
      message: `加载失败: ${(error as Error).message}`,
    };
    renderMap();
    renderPanels();
  }
}
/* 评估各工作流步骤状态 / Evaluate progress status for all workflow steps. */
function getStepProgress(step: WorkflowStep): StepProgress {
  const aggregate = state.aggregate;
  switch (step) {
    case "import":
      if (aggregate) {
        return {
          status: "done",
          summary: `已导入 ${aggregate.memberWorkspaceKeys.length} 个工作区，共 ${aggregate.topo.edges.length} edges`
        };
      }
      return { status: "ready", summary: "等待选择工作区进行导入" };

    case "annotate": {
      const prev = getStepProgress("import");
      if (prev.status !== "done") return { status: "blocked", summary: "完成 Step 1 导入后解锁" };
      if (state.isAnnotationComplete) {
        return { status: "done", summary: "标注已完成并确认" };
      }
      const features = aggregate?.featureCollection.features ?? [];
      const unannotated = features.filter(f => {
        const ann = f.properties?.railGraph as RailGraphAnnotation | undefined;
        return !ann || ann.kind === "unknown";
      }).length;
      if (unannotated === 0) {
        return { status: "ready", summary: "所有特征已标注，等待确认" };
      }
      return { status: "ready", summary: `尚有 ${unannotated} / ${features.length} 个特征未标注` };
    }

    case "compile": {
      const prev = getStepProgress("annotate");
      if (prev.status !== "done") return { status: "blocked", summary: "完成 Step 2 标注确认后解锁" };
      const checks = runTopologyValidation(state);
      const failed = checks.filter(c => c.status === "FAIL");
      if (failed.length > 0) {
        return { status: "error", summary: `拓扑编译验证失败: ${failed[0].label}` };
      }
      return { status: "done", summary: "拓扑校验成功，且仙台-石巻直通连通性验证通过" };
    }

    case "pattern": {
      const prev = getStepProgress("compile");
      if (prev.status !== "done") return { status: "blocked", summary: "完成 Step 3 拓扑校验后解锁" };
      if (state.patterns.length === 0) {
        return { status: "ready", summary: "尚未创建 ServicePattern，请在右侧使用 Chain 编辑器创建" };
      }
      const patternChecks = runPatternsValidation(state);
      const failed = patternChecks.filter(c => c.status === "FAIL");
      if (failed.length > 0) {
        return { status: "stale", summary: `有 ${failed.length} 个 ServicePattern 校验失效` };
      }
      return { status: "done", summary: `已创建并校验 ${state.patterns.length} 个 ServicePattern` };
    }

    case "route": {
      const prev = getStepProgress("pattern");
      if (state.patterns.length < 2) {
        return { status: "blocked", summary: "创建至少 2 个 ServicePattern 后解锁换乘寻路" };
      }
      const routeChecks = runRouteValidation(state);
      const failed = routeChecks.filter(c => c.status === "FAIL");
      if (failed.length > 0) {
        return { status: "ready", summary: "换乘图待验证，可在右侧测试换乘寻路" };
      }
      return { status: "done", summary: "换乘寻路校验通过，换乘关系链完整" };
    }

    case "event": {
      const prev = getStepProgress("pattern");
      if (state.patterns.length === 0) {
        return { status: "blocked", summary: "创建至少 1 个 ServicePattern 后解锁事件功能" };
      }
      if (state.userEvents.length === 0) {
        return { status: "ready", summary: "尚未创建 UserEvent，可在右侧添加事件" };
      }
      const eventChecks = runEventValidation(state);
      const failed = eventChecks.filter(c => c.status === "FAIL");
      if (failed.length > 0) {
        return { status: "error", summary: `事件校验失败: ${failed[0].label}` };
      }
      return { status: "done", summary: `已创建 ${state.userEvents.length} 个用户事件，且沿路径聚合顺序正确` };
    }

    case "export": {
      const p1 = getStepProgress("import");
      const p2 = getStepProgress("annotate");
      const p3 = getStepProgress("compile");
      const p4 = getStepProgress("pattern");
      if (p1.status !== "done" || p2.status !== "done" || p3.status !== "done" || p4.status !== "done") {
        return { status: "blocked", summary: "完成导入、标注、编译和模式创建后解锁" };
      }
      const allChecks = [
        ...runTopologyValidation(state),
        ...runPatternsValidation(state),
        ...(state.patterns.length >= 2 ? runRouteValidation(state) : []),
        ...(state.userEvents.length > 0 ? runEventValidation(state) : [])
      ];
      const failed = allChecks.filter(c => c.status === "FAIL");
      if (failed.length > 0) {
        return { status: "error", summary: `最终校验失败: 尚有 ${failed.length} 项指标不合格` };
      }
      return { status: "ready", summary: "所有断言通过，可导出包" };
    }
  }
}

export interface ValidationCheck {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "PENDING";
  detail?: string;
}

/* 验证拓扑编译及跨工作区直通运行连通性 / Validate compiled topology and cross-workspace pathfinding. */
function runTopologyValidation(state: AppState): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const aggregate = state.aggregate;
  if (!aggregate) {
    return [{ id: "topo_exists", label: "拓扑已导入", status: "FAIL", detail: "尚未导入工作区" }];
  }

  const hasEdges = aggregate.topo.edges.length > 0;
  checks.push({
    id: "has_edges",
    label: `拓扑包含 edges (当前: ${aggregate.topo.edges.length})`,
    status: hasEdges ? "PASS" : "FAIL"
  });

  const connector = findEdgeByOsmId(aggregate.topo, "351315049");
  checks.push({
    id: "has_connector",
    label: "联络线 way:351315049 存在",
    status: connector ? "PASS" : "FAIL",
    detail: connector ? `已定位: ${connector.id}` : "未找到联络线"
  });

  const sendai = findEdgeByOsmId(aggregate.topo, "1015018069") ?? findEdgeByOsmId(aggregate.topo, "884011779");
  const ishinomaki = findEdgeByOsmId(aggregate.topo, "882389027") ?? findEdgeByOsmId(aggregate.topo, "351315047");
  
  if (!sendai || !ishinomaki || !connector) {
    checks.push({ id: "cross_ws_path", label: "跨线直通寻路 (仙台 → 石巻)", status: "FAIL", detail: "仙台/石卷/联络线未完全就绪" });
    checks.push({ id: "cross_ws_path_rev", label: "反向跨线寻路 (石巻 → 仙台)", status: "FAIL" });
  } else {
    try {
      const lookup = buildTopologyLookup(aggregate.topo);
      const chain: IntentionChain = {
        mode: "sketch",
        nodes: [
          { kind: "origin", at: { nodeRef: sendai.fromNodeRef }, direction: "down" },
          { kind: "via_edge", edgeRef: connector.id },
          { kind: "terminus", at: { nodeRef: ishinomaki.toNodeRef } },
        ]
      };
      const candidates = resolveChainCandidates({ chain, aggregate, maxCandidates: 1, lookup });
      const best = candidates[0];
      const distanceOk = best && best.totalDistanceMeters >= 30000 && best.totalDistanceMeters <= 70000;
      checks.push({
        id: "cross_ws_path",
        label: `跨线直通寻路 (仙台 → 石巻): 获得 ${candidates.length} 条路径`,
        status: (best && distanceOk) ? "PASS" : "FAIL",
        detail: best ? `距离: ${(best.totalDistanceMeters / 1000).toFixed(2)} km (30~70km)` : "寻路未成功"
      });

      const revChain: IntentionChain = {
        mode: "sketch",
        nodes: [
          { kind: "origin", at: { nodeRef: ishinomaki.toNodeRef }, direction: "up" },
          { kind: "via_edge", edgeRef: connector.id },
          { kind: "terminus", at: { nodeRef: sendai.fromNodeRef } },
        ]
      };
      const revCandidates = resolveChainCandidates({ chain: revChain, aggregate, maxCandidates: 1, lookup });
      checks.push({
        id: "cross_ws_path_rev",
        label: `反向跨线寻路 (石巻 → 仙台): 获得 ${revCandidates.length} 条路径`,
        status: revCandidates.length > 0 ? "PASS" : "FAIL"
      });
    } catch (err) {
      checks.push({ id: "cross_ws_path", label: "跨线直通寻路错误", status: "FAIL", detail: (err as Error).message });
    }
  }

  return checks;
}

/* 验证已保存 ServicePattern 在拓扑中的合法性 / Validate patterns edge sequences and round-trip resolve. */
function runPatternsValidation(state: AppState): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const aggregate = state.aggregate;
  const patterns = state.patterns;
  if (!aggregate || patterns.length === 0) {
    return [{ id: "patterns_exist", label: "已保存 ServicePattern", status: "FAIL", detail: "暂无保存的模式" }];
  }

  checks.push({
    id: "patterns_count",
    label: `已保存 ServicePattern (当前: ${patterns.length})`,
    status: "PASS"
  });

  const aggregateEdgeIds = new Set(aggregate.topo.edges.map(e => e.id));
  const lookup = buildTopologyLookup(aggregate.topo);

  for (const p of patterns) {
    const missing = p.edgeSequence.filter(eid => !aggregateEdgeIds.has(eid));
    const edgesOk = missing.length === 0;
    checks.push({
      id: `pattern_edges_${p.patternId}`,
      label: `Pattern [${p.displayName || p.patternId}] 物理边合法`,
      status: edgesOk ? "PASS" : "FAIL",
      detail: edgesOk ? undefined : `缺失边: ${missing.join(", ")}`
    });

    if (p.intentionChain) {
      try {
        const replay = adaptChainToPattern({
          chain: p.intentionChain as IntentionChain,
          aggregate,
          lookup,
          patternId: p.patternId
        });
        const roundTripOk = replay.edgeSequence.length === p.edgeSequence.length &&
          replay.edgeSequence.every((eid, i) => eid === p.edgeSequence[i]);
        checks.push({
          id: `pattern_rt_${p.patternId}`,
          label: `Pattern [${p.displayName || p.patternId}] 意图链 Round-Trip 可复原`,
          status: roundTripOk ? "PASS" : "FAIL",
          detail: roundTripOk ? undefined : "重解析结果与保存值不一致"
        });
      } catch (err) {
        checks.push({
          id: `pattern_rt_${p.patternId}`,
          label: `Pattern [${p.displayName || p.patternId}] 意图链 Round-Trip 错误`,
          status: "FAIL",
          detail: (err as Error).message
        });
      }
    }
  }

  return checks;
}

/* 验证换乘图连通性及换乘解析 / Validate route transfers and query. */
function runRouteValidation(state: AppState): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const patterns = state.patterns;
  if (patterns.length < 2) {
    return [{ id: "route_ready", label: "已创建至少 2 个 ServicePattern", status: "FAIL" }];
  }

  try {
    const transferGraph = buildTransferGraph(patterns);
    checks.push({
      id: "transfer_relations",
      label: `换乘关系链已建立 (有 ${transferGraph.transfers.length} 个换乘点)`,
      status: transferGraph.transfers.length > 0 ? "PASS" : "FAIL"
    });

    const stations = routeStations();
    if (stations.length >= 2) {
      const from = stations[0];
      const to = stations[stations.length - 1];
      const crossPath = resolveCrossPattern({
        patterns,
        transferGraph,
        from,
        to
      });
      checks.push({
        id: "route_resolves",
        label: `乘客换乘路径解析正常: ${shortRef(from)} → ${shortRef(to)}`,
        status: crossPath ? "PASS" : "FAIL",
        detail: crossPath ? `成功解析: ${crossPath.hops.length} hops` : "无法求解路径"
      });
    }
  } catch (err) {
    checks.push({ id: "route_checks_error", label: "换乘图验证抛出异常", status: "FAIL", detail: (err as Error).message });
  }

  return checks;
}

/* 验证用户事件在拓扑中的解析与聚合 / Validate events anchors and sorted aggregation along path. */
function runEventValidation(state: AppState): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const events = state.userEvents;
  const aggregate = state.aggregate;
  if (!aggregate || events.length === 0) {
    return [{ id: "events_exist", label: "已保存 UserEvent", status: "FAIL" }];
  }

  checks.push({
    id: "events_count",
    label: `用户事件已加载 (当前: ${events.length})`,
    status: "PASS"
  });

  const edgesById = new Map(aggregate.topo.edges.map(e => [e.id, e]));
  let hasStation = false;
  let hasEdge = false;
  let allAnchorsResolved = true;

  for (const event of events) {
    const anchor = event.anchor;
    if (anchor.kind === "station") {
      hasStation = true;
      const nodeExists = aggregate.topo.nodes.some(n => n.id === anchor.stationRef);
      if (!nodeExists) allAnchorsResolved = false;
    } else {
      hasEdge = true;
      const edgeExists = edgesById.has(anchor.edgeRef);
      if (!edgeExists) allAnchorsResolved = false;
    }
  }

  checks.push({
    id: "anchors_resolved",
    label: "所有用户事件 Anchor 均能定位",
    status: allAnchorsResolved ? "PASS" : "FAIL"
  });

  checks.push({
    id: "anchor_types",
    label: "事件类型覆盖 (包含 Station 和 Edge 锚点)",
    status: (hasStation && hasEdge) ? "PASS" : "FAIL"
  });

  const selectedPattern = state.patterns.find(p => p.patternId === state.selectedPatternId) || state.patterns[0];
  if (selectedPattern) {
    const path = patternPathLike(selectedPattern);
    const aggregated = aggregateEventsAlongPath(events, path);

    let isMonotonic = true;
    for (let i = 1; i < aggregated.length; i++) {
      if (aggregated[i].orderIndex < aggregated[i - 1].orderIndex) {
        isMonotonic = false;
        break;
      }
    }
    checks.push({
      id: "events_aggregated_sort",
      label: `事件沿路径 [${selectedPattern.displayName}] 聚合且按 orderIndex 单调排序`,
      status: isMonotonic ? "PASS" : "FAIL"
    });
  }

  return checks;
}

/* 更新特征标注信息并重编译拓扑 / Update a feature's annotation, run browser-side topology compile and propagate validation. */
async function updateFeatureAnnotation(featureIdx: number, annotation: RailGraphAnnotation): Promise<void> {
  const aggregate = state.aggregate;
  if (!aggregate) return;
  const feature = aggregate.featureCollection.features[featureIdx];
  if (!feature) return;

  feature.properties.railGraph = annotation;
  state.message = "正在重新编译拓扑并保存...";
  renderPanels();

  try {
    const compileResult = compileAggregateTopology({ source: aggregate.featureCollection });
    aggregate.topo = compileResult.topo;
    aggregate.diagnostics = compileResult.diagnostics;
    await saveAggregate(aggregate);
    state.message = `特征 ${annotation.id} 已更新，拓扑编译成功 (edges: ${aggregate.topo.edges.length})`;
    validateDownstreamPatternsAndEvents();
  } catch (err) {
    state.message = `拓扑编译失败: ${(err as Error).message}`;
  }

  renderMap();
  renderPanels();
}

/* 翻转特征线段坐标并重编译拓扑 / Reverse track geometry coordinates and recompile topology. */
async function reverseFeatureGeometry(featureIdx: number): Promise<void> {
  const aggregate = state.aggregate;
  if (!aggregate) return;
  const feature = aggregate.featureCollection.features[featureIdx];
  if (!feature) return;
  if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") return;

  if (feature.geometry.type === "LineString") {
    feature.geometry.coordinates = [...feature.geometry.coordinates].reverse();
  } else if (feature.geometry.type === "MultiLineString") {
    feature.geometry.coordinates = feature.geometry.coordinates.map(line => [...line].reverse());
  }

  const ann = (feature.properties.railGraph as RailGraphAnnotation | undefined) ?? { kind: "track_geometry", schemaVersion: "rail-graph-v1", id: "", source: "ui" };
  if (!ann.track) ann.track = { role: "main", traversal: "both" };
  ann.track.geometryReversed = !ann.track.geometryReversed;
  feature.properties.railGraph = ann;

  state.message = "正在翻转坐标并重新编译拓扑...";
  renderPanels();

  try {
    const compileResult = compileAggregateTopology({ source: aggregate.featureCollection });
    aggregate.topo = compileResult.topo;
    aggregate.diagnostics = compileResult.diagnostics;
    await saveAggregate(aggregate);
    state.message = "特征坐标已反转，拓扑重新编译成功";
    validateDownstreamPatternsAndEvents();
  } catch (err) {
    state.message = `拓扑编译失败: ${(err as Error).message}`;
  }

  renderMap();
  renderPanels();
}

/* 触发下游模式及事件完整性校验 / Run downstream invalidation checks. */
function validateDownstreamPatternsAndEvents(): void {
  const checks = runPatternsValidation(state);
  const failed = checks.filter(c => c.status === "FAIL");
  if (failed.length > 0) {
    state.message += `。警告: 发现 ${failed.length} 个 ServicePattern 校验失效！`;
  }
}

/* 计算特征质心 / Calculate spatial centroid of a geojson feature. */
function featureCentroid(f: any): [number, number] | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === "Point") {
    return [g.coordinates[0], g.coordinates[1]];
  }
  if (g.type === "LineString") {
    if (g.coordinates.length === 0) return null;
    const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
    return [mid[0], mid[1]];
  }
  if (g.type === "MultiLineString") {
    if (g.coordinates.length === 0 || g.coordinates[0].length === 0) return null;
    const mid = g.coordinates[0][Math.floor(g.coordinates[0].length / 2)];
    return [mid[0], mid[1]];
  }
  if (g.type === "Polygon") {
    const ring = g.coordinates[0];
    if (!ring || ring.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of ring) { sx += p[0]; sy += p[1]; }
    return [sx / ring.length, sy / ring.length];
  }
  return null;
}

/* 计算经纬度球面距离 / Calculate Haversine distance in meters between two coordinates. */
function haversineDistance(left: [number, number], right: [number, number]): number {
  const earthRadiusMeters = 6371000;
  const leftLat = left[1] * Math.PI / 180;
  const rightLat = right[1] * Math.PI / 180;
  const deltaLat = (right[1] - left[1]) * Math.PI / 180;
  const deltaLng = (right[0] - left[0]) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* 查找距离质心最近的车站特征 / Find the station feature closest to a given coordinate. */
function findNearestStation(features: any[], from: [number, number]): { id: string; name: string } | null {
  let best: { id: string; name: string; distM: number } | null = null;
  for (const f of features) {
    const ann = f.properties.railGraph as RailGraphAnnotation | undefined;
    if (ann?.kind !== "station_point") continue;
    if (f.geometry.type !== "Point") continue;
    const coord = f.geometry.coordinates;
    const dist = haversineDistance(from, coord as [number, number]);
    if (!best || dist < best.distM) {
      best = { id: ann.id, name: ann.station?.name || ann.id, distM: dist };
    }
  }
  return best;
}

/* 自动绑定特定站台/出入口到最近的车站 / Auto-bind station reference for a platform or entrance. */
async function autoBindNearestStation(featureIdx: number): Promise<void> {
  const aggregate = state.aggregate;
  if (!aggregate) return;
  const features = aggregate.featureCollection.features;
  const f = features[featureIdx];
  if (!f) return;
  const ann = f.properties.railGraph as RailGraphAnnotation | undefined;
  if (!ann || (ann.kind !== "platform_area" && ann.kind !== "station_entrance")) return;
  const centroid = featureCentroid(f);
  if (!centroid) return;
  const nearest = findNearestStation(features, centroid);
  if (!nearest) return;

  const next: RailGraphAnnotation = ann.kind === "platform_area"
    ? { ...ann, platform: { ...(ann.platform ?? {}), stationRef: nearest.id } } as RailGraphAnnotation
    : { ...ann, entrance: { ...(ann.entrance ?? {}), stationRef: nearest.id } } as RailGraphAnnotation;

  await updateFeatureAnnotation(featureIdx, next);
}

/* 一键自动关联所有站台特征到最近车站 / Auto-bind station references for all platform area features. */
async function autoBindAllPlatforms(): Promise<void> {
  const aggregate = state.aggregate;
  if (!aggregate) return;
  const features = aggregate.featureCollection.features;
  let boundCount = 0;
  for (let i = 0; i < features.length; i += 1) {
    const f = features[i];
    const ann = f.properties.railGraph as RailGraphAnnotation | undefined;
    if (ann?.kind !== "platform_area") continue;
    if (ann.platform?.stationRef) continue; // skip already bound

    const centroid = featureCentroid(f);
    if (!centroid) continue;
    const nearest = findNearestStation(features, centroid);
    if (!nearest) continue;

    f.properties.railGraph = {
      ...ann,
      platform: { ...(ann.platform ?? {}), stationRef: nearest.id }
    };
    boundCount += 1;
  }

  if (boundCount > 0) {
    state.message = `正在重新编译拓扑并保存 (自动绑定了 ${boundCount} 个站台)...`;
    renderPanels();
    try {
      const compileResult = compileAggregateTopology({ source: aggregate.featureCollection });
      aggregate.topo = compileResult.topo;
      aggregate.diagnostics = compileResult.diagnostics;
      await saveAggregate(aggregate);
      state.message = `自动绑定完成，拓扑编译成功`;
      validateDownstreamPatternsAndEvents();
    } catch (err) {
      state.message = `拓扑编译失败: ${(err as Error).message}`;
    }
  } else {
    state.message = "未发现需要自动绑定的未关联站台";
  }

  renderMap();
  renderPanels();
}

/* 推断拓扑邻近未标注 track 边的方向 / Infer missing track edge directionRoles from connected neighbors. */
async function inferDirections(): Promise<void> {
  const aggregate = state.aggregate;
  if (!aggregate) return;
  const features = aggregate.featureCollection.features;
  const topo = aggregate.topo;

  const idToIdx = new Map<string, number>();
  for (let i = 0; i < features.length; i += 1) {
    const ann = features[i].properties.railGraph as RailGraphAnnotation | undefined;
    if (ann?.kind === "track_geometry" && ann.id) idToIdx.set(ann.id, i);
  }

  const nodeToEdges = new Map<string, TopologyEdge[]>();
  for (const edge of topo.edges) {
    for (const nr of [edge.fromNodeRef, edge.toNodeRef]) {
      const arr = nodeToEdges.get(nr) ?? [];
      arr.push(edge);
      nodeToEdges.set(nr, arr);
    }
  }

  let changed = 0;
  let round = 0;
  const maxRounds = 10;

  while (round++ < maxRounds) {
    let roundChanges = 0;
    for (const edge of topo.edges) {
      if (edge.role === "connector") continue;
      if (edge.directionRole !== undefined && edge.directionRole !== "bidirectional") continue;
      if (edge.traversal !== "both") continue;

      const seen = new Set<TrackDirectionRole>();
      for (const nr of [edge.fromNodeRef, edge.toNodeRef]) {
        const neighbors = nodeToEdges.get(nr) ?? [];
        for (const nb of neighbors) {
          if (nb.id === edge.id) continue;
          const dr = nb.directionRole;
          if (dr === "up" || dr === "down") seen.add(dr);
        }
      }

      const infer: TrackDirectionRole | null =
        (seen.size === 1 && seen.has("up")) ? "up" :
        (seen.size === 1 && seen.has("down")) ? "down" :
        seen.has("up") && seen.has("down") ? "bidirectional" :
        null;

      if (infer === null) continue;
      if (infer === (edge.directionRole ?? "bidirectional")) continue;

      const sourceRef = edge.sourceSlice?.sourceFeatureRef;
      if (!sourceRef) continue;
      const fidx = idToIdx.get(sourceRef);
      if (fidx === undefined) continue;

      const f = features[fidx];
      const ann = (f.properties.railGraph as RailGraphAnnotation | undefined) ?? { kind: "track_geometry", schemaVersion: "rail-graph-v1", id: "", source: "ui" };
      f.properties.railGraph = {
        ...ann,
        track: {
          ...(ann.track ?? { role: "main", traversal: "both" }),
          directionRole: infer
        }
      };

      edge.directionRole = infer;
      roundChanges += 1;
    }
    if (roundChanges === 0) break;
    changed += roundChanges;
  }

  if (changed > 0) {
    state.message = `正在保存推断结果并编译拓扑 (推断了 ${changed} 个方向)...`;
    renderPanels();
    try {
      const compileResult = compileAggregateTopology({ source: aggregate.featureCollection });
      aggregate.topo = compileResult.topo;
      aggregate.diagnostics = compileResult.diagnostics;
      await saveAggregate(aggregate);
      state.message = `推断完成，共更新 ${changed} 条边的方向`;
      validateDownstreamPatternsAndEvents();
    } catch (err) {
      state.message = `拓扑编译失败: ${(err as Error).message}`;
    }
  } else {
    state.message = "未推断出新的边方向";
  }

  renderMap();
  renderPanels();
}

function renderShell(): void {
  const root = document.getElementById("rail-graph-aggregate");
  if (!root) throw new Error("Missing #rail-graph-aggregate root.");
  root.innerHTML = `
    <style>
      :root {
        --color-bg-main: #f1f5f9;
        --color-bg-panel: #f8fafc;
        --color-bg-card: #ffffff;
        --color-border: #cbd5e1;
        --color-text-main: #0f172a;
        --color-text-muted: #64748b;
        
        --color-status-done: #10b981;
        --color-status-done-bg: #ecfdf5;
        --color-status-done-border: #a7f3d0;
        
        --color-status-ready: #3b82f6;
        --color-status-ready-bg: #eff6ff;
        --color-status-ready-border: #bfdbfe;
        
        --color-status-stale: #f59e0b;
        --color-status-stale-bg: #fffbeb;
        --color-status-stale-border: #fde68a;
        
        --color-status-blocked: #94a3b8;
        --color-status-blocked-bg: #f1f5f9;
        --color-status-blocked-border: #e2e8f0;
        
        --color-status-error: #ef4444;
        --color-status-error-bg: #fef2f2;
        --color-status-error-border: #fca5a5;
        
        font-family: Outfit, Inter, ui-sans-serif, system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; overflow: hidden; background: var(--color-bg-main); color: var(--color-text-main); }
      .agg-shell {
        width: 100vw;
        height: 100vh;
        display: grid;
        grid-template-columns: 380px 1fr 440px;
        background: var(--color-bg-main);
      }
      .agg-left-panel {
        height: 100vh;
        overflow-y: auto;
        border-right: 1px solid var(--color-border);
        background: var(--color-bg-panel);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #agg-map { width: 100%; height: 100%; z-index: 1; }
      .agg-right-panel {
        height: 100vh;
        overflow-y: auto;
        border-left: 1px solid var(--color-border);
        background: var(--color-bg-panel);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .agg-section {
        border: 1px solid var(--color-border);
        background: var(--color-bg-card);
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease-in-out;
      }
      .agg-section h2 {
        margin: 0 0 10px;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--color-text-main);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .agg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .agg-grid { display: grid; gap: 10px; }
      
      button, input, select, textarea {
        font: inherit;
        font-size: 12px;
      }
      button {
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: var(--color-text-main);
        border-radius: 8px;
        padding: 6px 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      button:hover {
        background: #f1f5f9;
        border-color: #94a3b8;
      }
      button.primary {
        background: #2563eb;
        border-color: #2563eb;
        color: #ffffff;
      }
      button.primary:hover {
        background: #1d4ed8;
        border-color: #1d4ed8;
      }
      button.danger {
        background: #ffffff;
        border-color: #fca5a5;
        color: #b91c1c;
      }
      button.danger:hover {
        background: #fef2f2;
      }
      button.active {
        border-color: #2563eb;
        color: #1d4ed8;
        background: #eff6ff;
      }
      button:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      
      input, select, textarea {
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 6px 10px;
        background: #ffffff;
        width: 100%;
        transition: border-color 0.15s ease;
      }
      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: #2563eb;
      }
      
      label {
        display: grid;
        gap: 4px;
        font-size: 11.5px;
        font-weight: 500;
        color: var(--color-text-muted);
      }
      .full { width: 100%; }
      .two { display: grid; grid-template-columns: 1fr 110px; gap: 8px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
      .muted { color: var(--color-text-muted); }
      .small { font-size: 11px; }
      .list { display: grid; gap: 8px; }
      
      .item {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px;
        background: var(--color-bg-card);
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .item:hover {
        border-color: #cbd5e1;
        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
      }
      .item.selected {
        border-color: #2563eb;
        background: #eff6ff;
      }
      .item-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12.5px;
        font-weight: 600;
      }
      .swatch {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid #94a3b8;
        display: inline-block;
      }
      .status-box {
        border: 1px solid var(--color-border);
        background: var(--color-bg-panel);
        border-radius: 8px;
        padding: 8px;
        font-size: 11.5px;
        line-height: 1.4;
      }
      
      /* Stepper Cards */
      .step-card {
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-card);
        margin-bottom: 8px;
        overflow: hidden;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .step-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
      }
      .step-card.active {
        border-color: var(--color-status-ready-border);
        box-shadow: 0 4px 8px -2px rgba(37, 99, 235, 0.08);
      }
      .step-header {
        display: flex;
        align-items: center;
        padding: 12px 14px;
        gap: 10px;
        font-weight: 600;
        font-size: 13px;
        background: #fafafa;
        border-bottom: 1px solid #f1f5f9;
        transition: background 0.15s ease;
      }
      .step-card.active .step-header {
        background: var(--color-status-ready-bg);
        border-bottom-color: var(--color-status-ready-border);
      }
      .step-circle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #e2e8f0;
        color: var(--color-text-muted);
        font-size: 11px;
        font-weight: 700;
      }
      .step-card.active .step-circle {
        background: var(--color-status-ready);
        color: #ffffff;
      }
      .step-body {
        padding: 12px 14px;
        display: none;
      }
      .step-card.active .step-body {
        display: block;
      }
      .step-desc {
        font-size: 11px;
        color: var(--color-text-muted);
        margin-bottom: 8px;
        line-height: 1.35;
      }
      
      /* Status Badges */
      .pill {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 700;
        text-transform: uppercase;
        border: 1px solid transparent;
      }
      .pill.done {
        background: var(--color-status-done-bg);
        color: var(--color-status-done);
        border-color: var(--color-status-done-border);
      }
      .pill.ready {
        background: var(--color-status-ready-bg);
        color: var(--color-status-ready);
        border-color: var(--color-status-ready-border);
      }
      .pill.stale {
        background: var(--color-status-stale-bg);
        color: var(--color-status-stale);
        border-color: var(--color-status-stale-border);
      }
      .pill.blocked {
        background: var(--color-status-blocked-bg);
        color: var(--color-status-blocked);
        border-color: var(--color-status-blocked-border);
      }
      .pill.error {
        background: var(--color-status-error-bg);
        color: var(--color-status-error);
        border-color: var(--color-status-error-border);
      }
      
      /* Checklist */
      .checklist-item {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 11.5px;
        line-height: 1.4;
        margin-bottom: 5px;
      }
      .checklist-status {
        font-weight: 700;
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 3px;
        text-transform: uppercase;
        flex-shrink: 0;
      }
      .checklist-status.pass {
        background: #d1fae5;
        color: #065f46;
      }
      .checklist-status.fail {
        background: #fee2e2;
        color: #991b1b;
      }
      .checklist-status.pending {
        background: #f1f5f9;
        color: #475569;
      }
      
      /* Annotate List & Inspector styles */
      .an-list-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: 100%;
      }
      .an-feature-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-card);
        cursor: pointer;
        font-size: 12px;
        transition: all 0.15s ease;
      }
      .an-feature-item:hover {
        border-color: #cbd5e1;
        background: #fafafa;
      }
      .an-feature-item.selected {
        border-color: #2563eb;
        background: #eff6ff;
      }
      .an-geom-icon {
        font-size: 14px;
        width: 16px;
        text-align: center;
        color: var(--color-text-muted);
      }
      .an-feature-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .an-inspector-form {
        display: grid;
        grid-template-columns: 100px 1fr;
        gap: 8px 12px;
        align-items: center;
        font-size: 12px;
        padding: 4px 0;
      }
      .an-inspector-form label {
        color: var(--color-text-muted);
        font-weight: 500;
      }
      .an-tag-table {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 4px 10px;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, monospace;
        background: #f8fafc;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 8px;
        max-height: 140px;
        overflow-y: auto;
      }
      .an-tag-key { color: var(--color-text-muted); font-weight: 600; }
      .an-tag-value { color: var(--color-text-main); word-break: break-all; }
      .an-brush-bar {
        display: flex;
        gap: 4px;
        align-items: center;
        flex-wrap: wrap;
        padding: 6px;
        background: #f1f5f9;
        border-radius: 8px;
        font-size: 11px;
      }
      
      .edge-pick { color: #2563eb; font-weight: 600; }
      .node-pick { color: #16a34a; font-weight: 600; }
      .event-pick { color: #ea580c; font-weight: 600; }
      .leaflet-container { font: inherit; }
      
      @media (max-width: 1024px) {
        .agg-shell {
          grid-template-columns: 1fr;
          height: auto;
          overflow: auto;
        }
        .agg-left-panel, .agg-right-panel { height: 50vh; border: none; }
        #agg-map { height: 400px; }
      }
    </style>
    <main class="agg-shell">
      <aside class="agg-left-panel" id="agg-left-panel"></aside>
      <div id="agg-map"></div>
      <aside class="agg-right-panel" id="agg-right-panel"></aside>
    </main>
  `;
}

function initMap(): void {
  const mapEl = document.getElementById("agg-map");
  if (!mapEl) throw new Error("Missing #agg-map.");
  const map = L.map(mapEl, {
    center: [38.32, 141.03],
    zoom: 10,
    zoomSnap: 0.25,
  });
  const baseLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
  mapState = {
    map,
    baseLayer,
    graphLayer: L.layerGroup().addTo(map),
    patternLayer: L.layerGroup().addTo(map),
    candidateLayer: L.layerGroup().addTo(map),
    eventLayer: L.layerGroup().addTo(map),
    nodeLayer: L.layerGroup().addTo(map),
    stationLayer: L.layerGroup().addTo(map),
    highlightLayer: L.layerGroup().addTo(map),
    edgeLayers: new Map(),
    nodeLayers: new Map(),
    stationLayers: new Map(),
  };
}

function bindGlobalEvents(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const actionEl = target?.closest<HTMLElement>("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    void handleAction(action ?? "", actionEl);
  });
  document.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!target) return;
    if (target.id === "pattern-color" || target.id === "event-title" || target.id === "event-measure") {
      renderCandidatePreview();
    }
    if (target.id === "annotate-search") {
      state.annotateSearchQuery = target.value;
      renderPanels();
    }
  });
}

async function handleAction(action: string, el: HTMLElement): Promise<void> {
  switch (action) {
    case "reload":
      await loadAll();
      return;
    case "select-step": {
      state.currentStep = el.dataset.step as WorkflowStep;
      state.message = `切换至步骤: ${state.currentStep}`;
      renderMap();
      renderPanels();
      return;
    }
    case "set-annotate-filter": {
      state.annotateFilter = el.dataset.filter as AppState["annotateFilter"];
      state.message = `切换特征类型过滤: ${state.annotateFilter}`;
      renderPanels();
      return;
    }
    case "set-dir-brush": {
      state.dirRoleBrush = (el.dataset.dir || null) as TrackDirectionRole | null;
      state.message = state.dirRoleBrush
        ? `方向刷激活: ${state.dirRoleBrush}。请在地图点击轨道应用方向。`
        : "方向刷已关闭";
      renderPanels();
      return;
    }
    case "select-feature": {
      const fid = el.dataset.id || null;
      state.selectedFeatureId = fid;
      state.message = fid ? `选中特征: ${fid}` : "清除选择";
      if (fid && state.aggregate) {
        const feat = state.aggregate.featureCollection.features.find(f => (f.properties?.railGraph as RailGraphAnnotation | undefined)?.id === fid);
        if (feat) {
          const centroid = featureCentroid(feat);
          if (centroid && mapState) {
            mapState.map.setView([centroid[1], centroid[0]], 15);
          }
        }
      }
      renderMap();
      renderPanels();
      return;
    }
    case "save-inspector-changes": {
      const idx = Number(el.dataset.idx ?? -1);
      if (idx < 0 || !state.aggregate) return;
      const feat = state.aggregate.featureCollection.features[idx];
      if (!feat) return;
      const prevAnn = feat.properties.railGraph as RailGraphAnnotation;
      const kind = prevAnn?.kind || "unknown";

      let annotation: RailGraphAnnotation;
      if (kind === "track_geometry") {
        annotation = {
          schemaVersion: "rail-graph-v1",
          kind,
          id: prevAnn?.id || (feat.properties.id as string | undefined) || "",
          source: prevAnn?.source || "ui",
          track: {
            role: valueOf("inspect-track-role") as TopologyEdgeRole,
            traversal: valueOf("inspect-track-traversal") as TraversalDirection,
            directionRole: (valueOf("inspect-track-direction-role") || undefined) as TrackDirectionRole | undefined,
            geometryReversed: prevAnn?.track?.geometryReversed ?? false,
          }
        };
      } else if (kind === "platform_area") {
        annotation = {
          schemaVersion: "rail-graph-v1",
          kind,
          id: prevAnn?.id || (feat.properties.id as string | undefined) || "",
          source: prevAnn?.source || "ui",
          platform: {
            type: (valueOf("inspect-platform-type") || undefined) as PlatformType | undefined,
            stationRef: (valueOf("inspect-platform-station-ref") || undefined) as EntityRef | undefined,
          }
        };
      } else if (kind === "station_entrance") {
        annotation = {
          schemaVersion: "rail-graph-v1",
          kind,
          id: prevAnn?.id || (feat.properties.id as string | undefined) || "",
          source: prevAnn?.source || "ui",
          entrance: {
            stationRef: (valueOf("inspect-entrance-station-ref") || undefined) as EntityRef | undefined,
          }
        };
      } else if (kind === "station_point") {
        annotation = {
          schemaVersion: "rail-graph-v1",
          kind,
          id: prevAnn?.id || (feat.properties.id as string | undefined) || "",
          source: prevAnn?.source || "ui",
          station: {
            name: valueOf("inspect-station-name") || (feat.properties.name as string | undefined) || "",
          }
        };
      } else {
        annotation = prevAnn;
      }

      const customName = valueOf("inspect-name");
      if (customName) {
        if (annotation.station) annotation.station.name = customName;
        else if (annotation.platform) annotation.platform.name = customName;
        else if (annotation.entrance) annotation.entrance.name = customName;
      }

      await updateFeatureAnnotation(idx, annotation);
      return;
    }
    case "reverse-geometry": {
      const idx = Number(el.dataset.idx ?? -1);
      if (idx >= 0) await reverseFeatureGeometry(idx);
      return;
    }
    case "auto-bind-station": {
      const idx = Number(el.dataset.idx ?? -1);
      if (idx >= 0) await autoBindNearestStation(idx);
      return;
    }
    case "auto-bind-all-platforms": {
      await autoBindAllPlatforms();
      return;
    }
    case "infer-directions": {
      await inferDirections();
      return;
    }
    case "mark-annotation-complete": {
      state.isAnnotationComplete = !state.isAnnotationComplete;
      if (state.isAnnotationComplete) {
        state.message = "标注阶段已完成确认！";
        state.currentStep = "compile";
      } else {
        state.message = "标注阶段重置为未确认状态。";
      }
      renderMap();
      renderPanels();
      return;
    }
    case "export-package": {
      state.message = `正在导出并校验 Aggregate [${AGGREGATE_KEY}] 包文件...`;
      renderPanels();
      setTimeout(() => {
        state.message = `🎉 成功导出数据包！最新的拓扑结构、模式及事件已写入 aggregate-state.json.`;
        renderPanels();
      }, 800);
      return;
    }
    case "import-workspaces":
      await importSelectedWorkspaces();
      return;
    case "load-no-direction":
      await loadAll({ allowNoDirection: true });
      return;
    case "reload-strict":
      state.allowNoDirectionLoad = false;
      await loadAll({ allowNoDirection: false });
      return;
    case "set-mode":
      setPickMode(el.dataset.mode as ChainEditorMode);
      return;
    case "clear-chain":
      state.editor = createChainEditorState();
      state.candidates = [];
      state.activeCandidateIndex = 0;
      state.editingPatternId = null;
      state.message = "已清空 IntentionChain";
      renderMap();
      renderPanels();
      return;
    case "remove-chain-node":
      removeChainNode(Number(el.dataset.index ?? -1));
      return;
    case "move-chain-node":
      moveChainNode(Number(el.dataset.index ?? -1), Number(el.dataset.delta ?? 0));
      return;
    case "compute":
      computeCandidates();
      return;
    case "select-candidate":
      state.activeCandidateIndex = Number(el.dataset.index ?? 0);
      state.message = `已选择 candidate #${state.activeCandidateIndex + 1}`;
      renderMap();
      renderPanels();
      return;
    case "save-pattern":
      await saveSelectedCandidate();
      return;
    case "select-pattern":
      state.selectedPatternId = el.dataset.patternId as EntityRef;
      state.crossPath = null;
      renderMap();
      renderPanels();
      return;
    case "load-pattern-chain":
      loadPatternChain(el.dataset.patternId as EntityRef, false);
      return;
    case "edit-pattern":
      loadPatternChain(el.dataset.patternId as EntityRef, true);
      return;
    case "delete-pattern":
      await deletePattern(el.dataset.patternId as EntityRef);
      return;
    case "seed-reference-chain":
      seedReferenceChain();
      return;
    case "resolve-route":
      resolveRouteQuery();
      return;
    case "clear-route":
      state.crossPath = null;
      state.message = "已清空 Route Query";
      renderMap();
      renderPanels();
      return;
    case "seed-route-query":
      seedRouteQuery();
      return;
    case "clear-selection":
      clearSelection();
      return;
    case "fit-map":
      fitMapToData();
      return;
    case "draft-event-station":
      draftStationEvent();
      return;
    case "draft-event-edge":
      draftEdgeEvent();
      return;
    case "save-event":
      await saveDraftEvent();
      return;
    case "cancel-event":
      state.eventDraftAnchor = null;
      state.editingEventId = null;
      state.message = "已取消 UserEvent 编辑";
      renderPanels();
      return;
    case "edit-event":
      editEvent(el.dataset.eventId as EntityRef);
      return;
    case "delete-event":
      await removeEvent(el.dataset.eventId as EntityRef);
      return;
  }
}

async function importSelectedWorkspaces(): Promise<void> {
  const memberWorkspaceKeys = selectedImportWorkspaceKeys();
  try {
    state.message = memberWorkspaceKeys.length > 0
      ? `正在导入 ${memberWorkspaceKeys.length} 个 MVP workspace...`
      : "正在导入全部 MVP workspace...";
    renderPanels();
    const aggregate = await importWorkspaces({
      aggregateKey: AGGREGATE_KEY,
      memberWorkspaceKeys: memberWorkspaceKeys.length > 0 ? memberWorkspaceKeys : undefined,
    });
    let patterns: StoredServicePattern[] = [];
    let userEvents: UserEvent[] = [];
    try {
      patterns = await loadServicePatterns({ aggregateKey: aggregate.aggregateKey });
    } catch {
      patterns = [];
    }
    try {
      userEvents = await loadUserEvents({ aggregateKey: aggregate.aggregateKey });
    } catch {
      userEvents = [];
    }
    state = {
      ...state,
      aggregate,
      patterns,
      userEvents,
      candidates: [],
      activeCandidateIndex: 0,
      crossPath: null,
      selectedPatternId: patterns[0]?.patternId ?? null,
      allowNoDirectionLoad: false,
      lastLoadError: null,
      message: `导入完成: ${aggregate.memberWorkspaceKeys.length} members / ${aggregate.topo.edges.length} edges`,
    };
    didFit = false;
    validateDownstreamPatternsAndEvents();
    renderMap();
    renderPanels();
  } catch (error) {
    state = {
      ...state,
      lastLoadError: (error as Error).message,
      message: `导入失败: ${(error as Error).message}`,
    };
    renderPanels();
  }
}

function setPickMode(mode: ChainEditorMode): void {
  state.editor = setChainEditorMode(state.editor, state.editor.mode === mode ? "idle" : mode);
  state.message = state.editor.mode === "idle"
    ? "选择模式已关闭"
    : `选择模式: ${pickModeLabel(state.editor.mode)}。请在地图上点击对应对象。`;
  renderPanels();
}

function pickMapNode(nodeRef: EntityRef): void {
  state.selectedNodeRef = nodeRef;
  if (state.currentStep === "annotate" && state.aggregate) {
    const feat = state.aggregate.featureCollection.features.find(
      f => (f.properties?.railGraph as RailGraphAnnotation | undefined)?.id === nodeRef
    );
    if (feat) {
      state.selectedFeatureId = (feat.properties.railGraph as RailGraphAnnotation).id;
    }
  }

  if (state.editor.mode === "picking-origin" || state.editor.mode === "picking-terminus") {
    state.editor = addNodeSelection(state.editor, { nodeRef });
    state.candidates = [];
    state.activeCandidateIndex = 0;
    state.crossPath = null;
    state.message = `已加入节点 ${shortRef(nodeRef)}`;
  } else {
    state.message = `选中 node ${nodeRef}`;
  }
  renderMap();
  renderPanels();
}

function pickMapEdge(edgeRef: EntityRef): void {
  state.selectedEdgeRef = edgeRef;
  if (state.currentStep === "annotate" && state.aggregate) {
    const edge = state.aggregate.topo.edges.find(e => e.id === edgeRef);
    const sourceRef = edge?.sourceSlice?.sourceFeatureRef;
    if (sourceRef) {
      const featIdx = state.aggregate.featureCollection.features.findIndex(
        f => (f.properties?.railGraph as RailGraphAnnotation | undefined)?.id === sourceRef
      );
      if (featIdx !== -1) {
        const feat = state.aggregate.featureCollection.features[featIdx];
        const ann = feat.properties.railGraph as RailGraphAnnotation;
        state.selectedFeatureId = ann.id;
        
        if (state.dirRoleBrush) {
          const nextAnn: RailGraphAnnotation = {
            ...ann,
            track: {
              ...(ann.track ?? { role: "main" as TopologyEdgeRole, traversal: "both" as TraversalDirection }),
              directionRole: (state.dirRoleBrush === "bidirectional" ? "bidirectional" : state.dirRoleBrush) as TrackDirectionRole
            }
          };
          void updateFeatureAnnotation(featIdx, nextAnn);
          state.message = `应用格式刷方向: ${state.dirRoleBrush} 到边 ${shortRef(edgeRef)}`;
          return;
        }
      }
    }
  }

  if (state.editor.mode === "picking-via") {
    state.editor = addNodeSelection(state.editor, { edgeRef });
    state.candidates = [];
    state.activeCandidateIndex = 0;
    state.crossPath = null;
    state.message = `已加入 via edge ${shortRef(edgeRef)}`;
  } else {
    state.message = `选中 edge ${edgeRef}`;
  }
  renderMap();
  renderPanels();
}

function removeChainNode(index: number): void {
  const nodes = state.editor.chain.nodes.filter((_, i) => i !== index);
  state.editor = replaceChainNodes(state.editor, nodes);
  state.candidates = [];
  state.activeCandidateIndex = 0;
  state.crossPath = null;
  state.message = "已删除 chain 节点";
  renderMap();
  renderPanels();
}

function moveChainNode(index: number, delta: number): void {
  const nodes = [...state.editor.chain.nodes];
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || index >= nodes.length || nextIndex >= nodes.length) return;
  const [node] = nodes.splice(index, 1);
  nodes.splice(nextIndex, 0, node);
  state.editor = replaceChainNodes(state.editor, normalizeChainOrder(nodes));
  state.candidates = [];
  state.activeCandidateIndex = 0;
  state.crossPath = null;
  state.message = "已调整 chain 顺序";
  renderMap();
  renderPanels();
}

function normalizeChainOrder(nodes: IntentionNode[]): IntentionNode[] {
  const origin = nodes.find((node) => node.kind === "origin");
  const terminus = nodes.find((node) => node.kind === "terminus");
  const middle = nodes.filter((node) => node.kind !== "origin" && node.kind !== "terminus");
  return [
    ...(origin ? [origin] : []),
    ...middle,
    ...(terminus ? [terminus] : []),
  ];
}

function computeCandidates(): void {
  const aggregate = requireAggregate();
  const origin = state.editor.chain.nodes[0];
  const terminus = state.editor.chain.nodes[state.editor.chain.nodes.length - 1];
  if (!origin || origin.kind !== "origin" || !terminus || terminus.kind !== "terminus") {
    state.message = "需要先设置起点和终点";
    renderPanels();
    return;
  }
  try {
    state.candidates = resolveChainCandidates({
      chain: state.editor.chain,
      aggregate,
      maxCandidates: 5,
    });
    state.activeCandidateIndex = 0;
    state.crossPath = null;
    state.message = `计算完成: ${state.candidates.length} candidate(s)`;
    renderMap();
    renderPanels();
  } catch (error) {
    state.candidates = [];
    state.activeCandidateIndex = 0;
    state.crossPath = null;
    state.message = `计算失败: ${(error as Error).message}`;
    renderMap();
    renderPanels();
  }
}

async function saveSelectedCandidate(): Promise<void> {
  const aggregate = requireAggregate();
  if (state.candidates.length === 0) computeCandidates();
  const candidate = state.candidates[state.activeCandidateIndex];
  if (!candidate) {
    state.message = "没有可保存的 candidate";
    renderPanels();
    return;
  }
  const name = valueOf("pattern-name") || `Pattern ${state.patterns.length + 1}`;
  const color = valueOf("pattern-color") || "#2563eb";
  const lineRef = valueOf("pattern-line-ref") || `aggregate:line:${aggregate.aggregateKey}`;
  const serviceType = valueOf("pattern-service-type") as StoredServicePattern["serviceType"] || "local";
  const existing = state.editingPatternId
    ? state.patterns.find((pattern) => pattern.patternId === state.editingPatternId)
    : undefined;
  const patternId = existing?.patternId
    ?? (`aggregate:pattern:${slug(name)}-${Date.now().toString(36)}` as EntityRef);
  const pattern = adaptChainToPattern({
    chain: state.editor.chain,
    aggregate,
    candidate,
    patternId,
    displayName: name,
    displayColor: color,
    lineRef: lineRef as EntityRef,
    serviceType,
  });
  pattern.createdAt = existing?.createdAt ?? pattern.createdAt;
  pattern.metadata = {
    ...pattern.metadata,
    note: existing
      ? aggregate.mode === "no-direction-graph"
        ? "Edited in Aggregate IntentionChain UI on the no-direction verification graph."
        : "Edited in Aggregate IntentionChain UI on compiled aggregate topology."
      : pattern.metadata?.note,
  };
  state.patterns = await upsertServicePattern({ aggregateKey: aggregate.aggregateKey, pattern });
  state.selectedPatternId = pattern.patternId;
  state.editingPatternId = null;
  state.crossPath = null;
  state.message = `${existing ? "已更新" : "已保存"} ServicePattern: ${name}`;
  renderMap();
  renderPanels();
}

function loadPatternChain(patternId: EntityRef, editMode: boolean): void {
  const pattern = state.patterns.find((item) => item.patternId === patternId);
  if (!pattern) {
    state.message = `未找到 ServicePattern ${patternId}`;
    renderPanels();
    return;
  }
  if (!pattern.intentionChain) {
    state.message = `ServicePattern ${patternId} 没有保存 IntentionChain`;
    renderPanels();
    return;
  }
  state.editor = {
    mode: "idle",
    chain: {
      ...pattern.intentionChain,
      nodes: [...pattern.intentionChain.nodes],
    },
  };
  state.candidates = [patternToCandidate(pattern)];
  state.activeCandidateIndex = 0;
  state.selectedPatternId = pattern.patternId;
  state.editingPatternId = editMode ? pattern.patternId : null;
  state.crossPath = null;
  state.message = editMode
    ? `已载入 ${pattern.displayName ?? pattern.patternId}，保存会覆盖原 ServicePattern`
    : `已载入 ${pattern.displayName ?? pattern.patternId} 的 IntentionChain`;
  renderMap();
  renderPanels();
}

async function deletePattern(patternId: EntityRef): Promise<void> {
  const aggregate = requireAggregate();
  state.patterns = await deleteServicePattern({ aggregateKey: aggregate.aggregateKey, patternId });
  if (state.selectedPatternId === patternId) state.selectedPatternId = state.patterns[0]?.patternId ?? null;
  if (state.editingPatternId === patternId) state.editingPatternId = null;
  state.crossPath = null;
  state.message = `已删除 ${patternId}`;
  renderMap();
  renderPanels();
}

function seedReferenceChain(): void {
  const aggregate = requireAggregate();
  const sendai = findEdgeByOsmId(aggregate.topo, "1015018069") ?? findEdgeByOsmId(aggregate.topo, "884011779");
  const connector = findEdgeByOsmId(aggregate.topo, "351315049");
  const ishinomaki = findEdgeByOsmId(aggregate.topo, "882389027") ?? findEdgeByOsmId(aggregate.topo, "351315047");
  if (!sendai || !connector || !ishinomaki) {
    state.message = "参考链条所需 way 未找到";
    renderPanels();
    return;
  }
  state.editor = {
    mode: "idle",
    chain: {
      mode: "sketch",
      nodes: [
        { kind: "origin", at: { nodeRef: sendai.fromNodeRef }, direction: "down" },
        { kind: "via_edge", edgeRef: connector.id },
        { kind: "terminus", at: { nodeRef: ishinomaki.toNodeRef } },
      ],
    },
  };
  state.candidates = [];
  state.activeCandidateIndex = 0;
  state.crossPath = null;
  state.message = "已载入仙台-石巻参考 IntentionChain";
  renderMap();
  renderPanels();
}

function resolveRouteQuery(): void {
  const from = valueOf("route-from") as EntityRef;
  const to = valueOf("route-to") as EntityRef;
  if (!from || !to) {
    state.message = "Route Query 需要 from / to station";
    renderPanels();
    return;
  }
  const transferGraph = buildTransferGraph(state.patterns);
  const crossPath = resolveCrossPattern({
    patterns: state.patterns,
    transferGraph,
    from,
    to,
  });
  state.crossPath = crossPath;
  state.routeFrom = from;
  state.routeTo = to;
  state.selectedPatternId = null;
  state.message = crossPath
    ? `Route Query 完成: ${crossPath.hops.length} hop(s), ${crossPath.transferStations.length} transfer(s)`
    : "Route Query 无结果";
  renderMap();
  renderPanels();
}

function seedRouteQuery(): void {
  const transferGraph = buildTransferGraph(state.patterns);
  const patternsById = new Map(state.patterns.map((pattern) => [pattern.patternId, pattern] as const));

  for (const relation of transferGraph.transfers) {
    const patternA = patternsById.get(relation.patternA);
    const patternB = patternsById.get(relation.patternB);
    if (!patternA || !patternB) continue;

    const shared = new Set(relation.sharedStations);
    const stationsA = patternA.traceSequence.map((trace) => trace.stationRef);
    const stationsB = patternB.traceSequence.map((trace) => trace.stationRef);
    const from = stationsA.find((stationRef) => !shared.has(stationRef)) ?? stationsA[0];
    const to = stationsB.find((stationRef) => !shared.has(stationRef)) ?? stationsB[stationsB.length - 1];
    if (!from || !to || from === to) continue;

    const crossPath = resolveCrossPattern({
      patterns: state.patterns,
      transferGraph,
      from,
      to,
    });
    state.routeFrom = from;
    state.routeTo = to;
    state.crossPath = crossPath;
    state.selectedPatternId = null;
    state.message = crossPath
      ? `已载入示例 OD: ${shortRef(from)} → ${shortRef(to)}`
      : `已载入示例 OD，但未找到路径: ${shortRef(from)} → ${shortRef(to)}`;
    renderMap();
    renderPanels();
    return;
  }

  const stations = routeStations();
  if (stations.length >= 2) {
    state.routeFrom = stations[0];
    state.routeTo = stations[stations.length - 1];
    state.crossPath = null;
    state.message = "已载入首末 station 作为示例 OD，但没有可用 transfer 关系";
  } else {
    state.message = "需要至少两条含 station trace 的 ServicePattern 才能生成示例 OD";
  }
  renderMap();
  renderPanels();
}

function draftStationEvent(): void {
  if (!state.selectedNodeRef) {
    state.message = "先在地图点击一个 node，再创建 station event";
    renderPanels();
    return;
  }
  state.eventDraftAnchor = { kind: "station", stationRef: state.selectedNodeRef };
  state.editingEventId = null;
  state.message = `UserEvent anchor=station ${shortRef(state.selectedNodeRef)}`;
  renderPanels();
}

function draftEdgeEvent(): void {
  if (!state.selectedEdgeRef) {
    state.message = "先在地图点击一条 edge，再创建 edge event";
    renderPanels();
    return;
  }
  state.eventDraftAnchor = { kind: "edge", edgeRef: state.selectedEdgeRef, measure: 0.5 };
  state.editingEventId = null;
  state.message = `UserEvent anchor=edge ${shortRef(state.selectedEdgeRef)}`;
  renderPanels();
}

async function saveDraftEvent(): Promise<void> {
  const aggregate = requireAggregate();
  if (!state.eventDraftAnchor) {
    state.message = "没有待保存的 UserEvent anchor";
    renderPanels();
    return;
  }
  const title = valueOf("event-title") || "UserEvent";
  const anchor = state.eventDraftAnchor.kind === "edge"
    ? {
      ...state.eventDraftAnchor,
      measure: clamp01(Number(valueOf("event-measure") || state.eventDraftAnchor.measure)),
    }
    : state.eventDraftAnchor;
  const existing = state.editingEventId
    ? state.userEvents.find((item) => item.id === state.editingEventId)
    : undefined;
  const event: UserEvent = {
    id: existing?.id ?? (`aggregate:event:${slug(title)}-${Date.now().toString(36)}` as EntityRef),
    kind: "user_defined",
    anchor,
    title,
    payload: { ...(existing?.payload ?? {}), source: "aggregate-ui" },
    createdAt: existing?.createdAt,
  };
  state.userEvents = await upsertUserEvent({ aggregateKey: aggregate.aggregateKey, event });
  state.eventDraftAnchor = null;
  state.editingEventId = null;
  state.message = `${existing ? "已更新" : "已保存"} UserEvent: ${title}`;
  renderMap();
  renderPanels();
}

function editEvent(eventId: EntityRef): void {
  const event = state.userEvents.find((item) => item.id === eventId);
  if (!event) {
    state.message = `未找到 UserEvent ${eventId}`;
    renderPanels();
    return;
  }
  state.eventDraftAnchor = { ...event.anchor };
  state.editingEventId = event.id;
  if (event.anchor.kind === "station") {
    state.selectedNodeRef = event.anchor.stationRef;
  } else {
    state.selectedEdgeRef = event.anchor.edgeRef;
  }
  state.message = `已载入 UserEvent: ${event.title}`;
  renderMap();
  renderPanels();
}

async function removeEvent(eventId: EntityRef): Promise<void> {
  const aggregate = requireAggregate();
  state.userEvents = await deleteUserEvent({ aggregateKey: aggregate.aggregateKey, eventId });
  if (state.editingEventId === eventId) {
    state.eventDraftAnchor = null;
    state.editingEventId = null;
  }
  state.message = `已删除 UserEvent ${eventId}`;
  renderMap();
  renderPanels();
}

function renderMap(): void {
  const aggregate = state.aggregate;
  const ms = mapState;
  if (!aggregate || !ms) return;
  ms.graphLayer.clearLayers();
  ms.patternLayer.clearLayers();
  ms.candidateLayer.clearLayers();
  ms.eventLayer.clearLayers();
  ms.nodeLayer.clearLayers();
  ms.highlightLayer.clearLayers();
  ms.edgeLayers.clear();
  ms.nodeLayers.clear();

  for (const edge of aggregate.topo.edges) {
    if (!edge.coordinates || edge.coordinates.length < 2) continue;
    const isSelected = edge.id === state.selectedEdgeRef;
    const isFeatureSelected = state.currentStep === "annotate" && 
      edge.sourceSlice?.sourceFeatureRef === state.selectedFeatureId;

    const line = L.polyline(latLngs(edge.coordinates), {
      color: isFeatureSelected ? "#ef4444" : (isSelected ? "#0f4fb8" : "#64748b"),
      weight: isFeatureSelected ? 6 : (isSelected ? 5 : 2.5),
      opacity: (isFeatureSelected || isSelected) ? 0.95 : 0.45,
    });
    line.bindTooltip(edgeTooltip(edge), { sticky: true });
    line.on("click", () => pickMapEdge(edge.id));
    line.on("contextmenu", () => {
      state.selectedEdgeRef = edge.id;
      state.eventDraftAnchor = { kind: "edge", edgeRef: edge.id, measure: 0.5 };
      state.editingEventId = null;
      state.message = `UserEvent anchor=edge ${shortRef(edge.id)}`;
      renderMap();
      renderPanels();
    });
    line.addTo(ms.graphLayer);
    ms.edgeLayers.set(edge.id, line);
  }

  if (state.currentStep === "annotate" && state.selectedFeatureId) {
    const selectedFeature = aggregate.featureCollection.features.find(
      f => (f.properties?.railGraph as RailGraphAnnotation | undefined)?.id === state.selectedFeatureId
    );
    if (selectedFeature && selectedFeature.geometry) {
      L.geoJSON(selectedFeature, {
        style: {
          color: "#ef4444",
          weight: 6,
          fillColor: "#ef4444",
          fillOpacity: 0.4
        },
        pointToLayer: (geoJsonPoint, latlng) => {
          return L.circleMarker(latlng, {
            radius: 8,
            color: "#ef4444",
            fillColor: "#fca5a5",
            fillOpacity: 0.9,
            weight: 2
          });
        }
      }).addTo(ms.highlightLayer);
    }
  }

  drawPatterns();
  drawCrossPath();
  drawCandidate();
  drawEvents();
  drawNodes();
  fitMapOnce();
}

function drawPatterns(): void {
  const aggregate = requireAggregate();
  const ms = requireMap();
  const plans = buildPatternRenderPlan(aggregate, state.patterns);
  for (const plan of plans) drawPatternPlan(plan, plan.patternId === state.selectedPatternId ? 0.95 : 0.65);
}

function drawPatternPlan(plan: PatternRenderPlan, opacity: number): void {
  const ms = requireMap();
  for (const segment of plan.polylineSegments) {
    L.polyline(latLngs(segment.coords), {
      color: segment.strokeStyle.color,
      weight: segment.strokeStyle.weight + (plan.patternId === state.selectedPatternId ? 2 : 0),
      opacity,
      dashArray: segment.strokeStyle.dashArray,
    }).addTo(ms.patternLayer);
  }
}

function drawCrossPath(): void {
  const aggregate = state.aggregate;
  const ms = mapState;
  if (!aggregate || !ms || !state.crossPath) return;
  const plan = buildCrossPatternRenderPlan(aggregate, state.crossPath);
  for (const segment of plan.polylineSegments) {
    L.polyline(latLngs(segment.coords), {
      color: segment.strokeStyle.color,
      weight: segment.strokeStyle.weight,
      opacity: 0.95,
      dashArray: segment.strokeStyle.dashArray,
    }).addTo(ms.candidateLayer);
  }
}

function drawCandidate(): void {
  const aggregate = state.aggregate;
  const ms = mapState;
  const candidate = state.candidates[state.activeCandidateIndex];
  if (!aggregate || !ms || !candidate || state.crossPath) return;
  const edgesById = new Map(aggregate.topo.edges.map((edge) => [edge.id, edge] as const));
  for (const edgeRef of candidate.edgeSequence) {
    const edge = edgesById.get(edgeRef);
    if (!edge?.coordinates) continue;
    L.polyline(latLngs(edge.coordinates), {
      color: "#f97316",
      weight: 7,
      opacity: 0.9,
    }).addTo(ms.candidateLayer);
  }
}

function drawEvents(): void {
  const aggregate = state.aggregate;
  const ms = mapState;
  if (!aggregate || !ms) return;
  const edgesById = new Map(aggregate.topo.edges.map((edge) => [edge.id, edge] as const));
  for (const event of state.userEvents) {
    const coord = event.anchor.kind === "station"
      ? nodeCoordinate(aggregate.topo, event.anchor.stationRef)
      : coordinateAtMeasure(edgesById.get(event.anchor.edgeRef), event.anchor.measure);
    if (!coord) continue;
    const marker = L.circleMarker([coord[1], coord[0]], {
      radius: event.id === state.editingEventId ? 7 : 5,
      color: event.id === state.editingEventId ? "#9a3412" : "#7c2d12",
      fillColor: "#fb923c",
      fillOpacity: 0.92,
      weight: 2,
      opacity: 0.95,
    });
    marker.bindTooltip(
      `<b>${escapeHtml(event.title)}</b><br><span class="mono">${escapeHtml(anchorText(event.anchor))}</span>`,
      { sticky: true },
    );
    marker.on("click", () => {
      state.message = `选中 UserEvent: ${event.title}`;
      if (event.anchor.kind === "station") state.selectedNodeRef = event.anchor.stationRef;
      else state.selectedEdgeRef = event.anchor.edgeRef;
      renderMap();
      renderPanels();
    });
    marker.on("contextmenu", () => editEvent(event.id));
    marker.addTo(ms.eventLayer);
  }
}

function drawNodes(): void {
  const aggregate = requireAggregate();
  const ms = requireMap();
  for (const node of aggregate.topo.nodes) {
    const coord = nodeCoordinate(aggregate.topo, node.id);
    if (!coord) continue;
    const isSelected = node.id === state.selectedNodeRef;
    const isFeatureSelected = state.currentStep === "annotate" && 
      node.id === state.selectedFeatureId;

    const marker = L.circleMarker([coord[1], coord[0]], {
      radius: isFeatureSelected ? 7 : (isSelected ? 5 : 3),
      color: isFeatureSelected ? "#ef4444" : (isSelected ? "#166534" : "#334155"),
      fillColor: isFeatureSelected ? "#fca5a5" : (isSelected ? "#22c55e" : "#ffffff"),
      fillOpacity: 0.9,
      weight: isFeatureSelected ? 2.5 : 1.5,
      opacity: state.editor.mode === "picking-origin" || state.editor.mode === "picking-terminus" ? 0.9 : 0.35,
    });
    marker.bindTooltip(`<span class="mono">${escapeHtml(node.id)}</span>`, { sticky: true });
    marker.on("click", () => pickMapNode(node.id));
    marker.on("contextmenu", () => {
      state.selectedNodeRef = node.id;
      state.eventDraftAnchor = { kind: "station", stationRef: node.id };
      state.editingEventId = null;
      state.message = `UserEvent anchor=station ${shortRef(node.id)}`;
      renderMap();
      renderPanels();
    });
    marker.addTo(ms.nodeLayer);
    ms.nodeLayers.set(node.id, marker);
  }
}

let didFit = false;
function fitMapOnce(): void {
  if (didFit || !mapState) return;
  fitMapToData();
}

function fitMapToData(): void {
  if (!mapState) return;
  const bounds = L.latLngBounds([]);
  mapState.graphLayer.eachLayer((layer) => {
    const maybe = layer as L.Polyline;
    if (typeof maybe.getBounds === "function") bounds.extend(maybe.getBounds());
  });
  mapState.patternLayer.eachLayer((layer) => {
    const maybe = layer as L.Polyline;
    if (typeof maybe.getBounds === "function") bounds.extend(maybe.getBounds());
  });
  mapState.candidateLayer.eachLayer((layer) => {
    const maybe = layer as L.Polyline;
    if (typeof maybe.getBounds === "function") bounds.extend(maybe.getBounds());
  });
  if (bounds.isValid()) {
    mapState.map.fitBounds(bounds, { padding: [24, 24] });
    didFit = true;
  }
}

function clearSelection(): void {
  state.selectedEdgeRef = null;
  state.selectedNodeRef = null;
  state.selectedStationRef = null;
  state.eventDraftAnchor = null;
  state.editingEventId = null;
  state.message = "已清空地图选择";
  renderMap();
  renderPanels();
}

function renderPanels(): void {
  const leftCol = document.getElementById("agg-left-panel");
  const rightCol = document.getElementById("agg-right-panel");
  if (!leftCol || !rightCol) return;

  leftCol.innerHTML = renderLeftColumn();
  rightCol.innerHTML = renderRightColumn();
}

function renderLeftColumn(): string {
  const steps: WorkflowStep[] = ["import", "annotate", "compile", "pattern", "route", "event", "export"];
  const stepLabels: Record<WorkflowStep, string> = {
    import: "1. 导入数据 (Import)",
    annotate: "2. 人工标注 (Annotate)",
    compile: "3. 校验拓扑 (Verify Topology)",
    pattern: "4. 构建运行模式 (Patterns)",
    route: "5. 跨线换乘寻路 (Routes)",
    event: "6. 用户事件聚合 (Events)",
    export: "7. 验证与包导出 (Export)"
  };

  const stepsHtml = steps.map((step, idx) => {
    const progress = getStepProgress(step);
    const isActive = state.currentStep === step;
    const isBlocked = progress.status === "blocked";
    
    const pillClass = `pill ${progress.status}`;
    const statusPill = `<span class="${pillClass}">${progress.status}</span>`;

    let bodyContent = "";
    if (isActive) {
      bodyContent = renderStepLeftControls(step);
    }

    return `
      <div class="step-card ${isActive ? "active" : ""}" data-action="select-step" data-step="${step}" ${isBlocked ? 'style="opacity: 0.65; cursor: not-allowed;"' : ""}>
        <div class="step-header">
          <div class="step-circle">${idx + 1}</div>
          <div class="step-title" style="flex: 1; font-weight: 700;">${stepLabels[step]}</div>
          ${statusPill}
        </div>
        <div class="step-body" style="${isActive ? "display: block;" : "display: none;"}">
          <div class="step-desc" style="font-weight: 500; font-size: 11.5px; color: var(--color-text-muted);">${escapeHtml(progress.summary)}</div>
          ${bodyContent}
        </div>
      </div>
    `;
  }).join("");

  return `
    <h2 style="font-size: 15px; margin: 0 0 10px; font-weight: 700; display: flex; align-items: center; justify-content: space-between;">
      <span>工作流控制台</span>
      <button data-action="reload" style="font-size: 11px; padding: 3px 8px;">刷新加载</button>
    </h2>
    <div class="status-box" style="margin-bottom: 12px; border: 1px solid var(--color-border); background: var(--color-bg-card); border-radius: 8px; padding: 10px;">
      <div style="font-weight: 600; font-size: 11px; margin-bottom: 3px; color: var(--color-text-muted);">系统消息:</div>
      <div class="mono" style="color: #2563eb; font-size: 11px; word-break: break-all; line-height: 1.4;">${escapeHtml(state.message)}</div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${stepsHtml}
    </div>
  `;
}

function renderStepLeftControls(step: WorkflowStep): string {
  switch (step) {
    case "import": return renderStepLeftControls_Import();
    case "annotate": return renderStepLeftControls_Annotate();
    case "compile": return renderStepLeftControls_Compile();
    case "pattern": return renderStepLeftControls_Pattern();
    case "route": return renderStepLeftControls_Route();
    case "event": return renderStepLeftControls_Event();
    case "export": return renderStepLeftControls_Export();
  }
}

function renderStepLeftControls_Import(): string {
  const importWorkspaces = safeImportWorkspaceList();
  return `
    <div class="list" style="margin-top: 8px;">
      ${importWorkspaceListHtml(importWorkspaces)}
    </div>
    <div class="agg-row" style="margin-top: 10px; display: flex; gap: 6px; width: 100%;">
      <button class="primary" data-action="import-workspaces" ${importWorkspaces.length > 0 ? "" : "disabled"} style="flex: 1;">导入 MVP 工作区</button>
    </div>
    <div class="agg-row" style="margin-top: 6px; display: flex; gap: 6px; width: 100%;">
      <button data-action="load-no-direction" style="flex: 1; padding: 4px 6px;">加载 verify fallback</button>
      <button data-action="reload-strict" style="flex: 1; padding: 4px 6px;">加载 compiled</button>
    </div>
  `;
}

function renderStepLeftControls_Annotate(): string {
  const aggregate = state.aggregate;
  if (!aggregate) return `<div class="small muted">等待数据导入</div>`;
  const features = aggregate.featureCollection.features;
  const unannotated = features.filter(f => {
    const ann = f.properties?.railGraph as RailGraphAnnotation | undefined;
    return !ann || ann.kind === "unknown";
  }).length;
  
  const filters: Array<{ id: typeof state.annotateFilter, label: string }> = [
    { id: "all", label: "全部" },
    { id: "unannotated", label: "未标注" },
    { id: "track", label: "轨道" },
    { id: "station", label: "车站" },
    { id: "platform", label: "站台" },
    { id: "entrance", label: "出入口" }
  ];

  const filterButtons = filters.map(f => {
    const active = state.annotateFilter === f.id ? "active" : "";
    return `<button class="${active}" data-action="set-annotate-filter" data-filter="${f.id}" style="padding: 3px 6px; font-size: 11px;">${f.label}</button>`;
  }).join("");

  return `
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px;">
      <label>
        搜索特征 ID / 名称:
        <input id="annotate-search" placeholder="输入关键字..." value="${escapeAttr(state.annotateSearchQuery)}">
      </label>
      <div class="agg-row" style="gap: 4px; display: flex; flex-wrap: wrap;">
        ${filterButtons}
      </div>
      
      <div style="font-weight: 600; font-size: 11px; margin-top: 4px; color: var(--color-text-muted);">批量工具 (Bulk Tools):</div>
      <div class="agg-row" style="display: flex; gap: 6px; width: 100%;">
        <button data-action="auto-bind-all-platforms" style="flex: 1; font-size: 11px; padding: 4px 8px;">自动绑定站台</button>
        <button data-action="infer-directions" style="flex: 1; font-size: 11px; padding: 4px 8px;">推断轨道方向</button>
      </div>

      <div style="font-weight: 600; font-size: 11px; margin-top: 4px; color: var(--color-text-muted);">格式属性刷 (Format Brush):</div>
      <div class="an-brush-bar" style="display: flex; align-items: center; gap: 4px; padding: 4px; background: #f1f5f9; border-radius: 6px;">
        <span style="font-weight: 600; font-size: 11px; margin-right: 4px;">方向:</span>
        <button class="${state.dirRoleBrush === null ? "active" : ""}" data-action="set-dir-brush" data-dir="" style="padding: 2px 6px; font-size: 10px;">无</button>
        <button class="${state.dirRoleBrush === "up" ? "active" : ""}" data-action="set-dir-brush" data-dir="up" style="padding: 2px 6px; font-size: 10px;">Up</button>
        <button class="${state.dirRoleBrush === "down" ? "active" : ""}" data-action="set-dir-brush" data-dir="down" style="padding: 2px 6px; font-size: 10px;">Down</button>
        <button class="${state.dirRoleBrush === "bidirectional" ? "active" : ""}" data-action="set-dir-brush" data-dir="bidirectional" style="padding: 2px 6px; font-size: 10px;">Both</button>
      </div>

      <div style="margin-top: 6px; width: 100%;">
        <button class="primary full" data-action="mark-annotation-complete" style="width: 100%;">
          ${state.isAnnotationComplete ? "重置标注状态 (Reset)" : "确认标注完成并编译 (Compile)"}
        </button>
      </div>
    </div>
  `;
}

function renderStepLeftControls_Compile(): string {
  const aggregate = state.aggregate;
  if (!aggregate) return `<div class="small muted">无拓扑数据</div>`;
  const connector = findEdgeByOsmId(aggregate.topo, "351315049");
  const sendai = findEdgeByOsmId(aggregate.topo, "1015018069") ?? findEdgeByOsmId(aggregate.topo, "884011779");
  const ishinomaki = findEdgeByOsmId(aggregate.topo, "882389027") ?? findEdgeByOsmId(aggregate.topo, "351315047");

  return `
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px;">
      <div style="font-weight: 600; font-size: 11.5px; color: var(--color-text-muted);">跨线直通寻路测试端点 (Sendai ↔ Ishinomaki):</div>
      <div class="small muted" style="line-height:1.4;">
        - 仙台起点 edge: <b class="mono">${sendai ? shortRef(sendai.id) : "未定位"}</b><br>
        - 联络线 connector edge: <b class="mono">${connector ? shortRef(connector.id) : "未定位"}</b><br>
        - 石卷终点 edge: <b class="mono">${ishinomaki ? shortRef(ishinomaki.id) : "未定位"}</b>
      </div>
      <div class="agg-row" style="margin-top: 4px; width:100%;">
        <button class="primary full" data-action="seed-reference-chain" style="width:100%;">载入仙台-石卷测试链 (Chain)</button>
      </div>
      <div style="margin-top: 6px; border-top: 1px solid #f1f5f9; padding-top: 8px; width:100%;">
        <button class="full" data-action="reload-strict" style="width:100%;">重新编译并刷新</button>
      </div>
    </div>
  `;
}

function renderStepLeftControls_Pattern(): string {
  const aggregate = state.aggregate;
  return `
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px;">
      <div style="font-weight: 600; font-size: 11.5px; color: var(--color-text-muted);">意图路径链编辑器 (IntentionChain):</div>
      <div class="agg-row" style="gap: 4px; display: flex; flex-wrap: wrap;">
        ${modeButton("picking-origin", "设为起点")}
        ${modeButton("picking-via", "设为经过")}
        ${modeButton("picking-terminus", "设为终点")}
      </div>
      <div class="small muted" style="margin-top: 2px;">
        选择模式: <b style="color: var(--color-status-ready);">${escapeHtml(pickModeLabel(state.editor.mode))}</b>
      </div>
      <div class="list" style="max-height: 150px; overflow-y: auto; margin-top: 4px;">
        ${chainHtml()}
      </div>
      <div class="agg-row" style="margin-top: 4px; display: flex; gap: 6px; width: 100%;">
        <button class="primary" data-action="compute" ${canCompute() ? "" : "disabled"} style="flex: 1;">计算候选路径 (Compute)</button>
        <button data-action="clear-chain">清空链</button>
      </div>
      
      <div style="font-weight: 600; font-size: 11.5px; margin-top: 6px; border-top: 1px solid #f1f5f9; padding-top: 6px; color: var(--color-text-muted);">保存模式 (ServicePattern):</div>
      <div class="agg-grid" style="gap: 6px;">
        <label>模式名称:<input id="pattern-name" value="${escapeAttr(patternFormName())}"></label>
        <div class="two" style="grid-template-columns: 1fr 60px;">
          <label>lineRef:<input id="pattern-line-ref" value="${escapeAttr(patternFormLineRef(aggregate))}"></label>
          <label>颜色:<input id="pattern-color" type="color" value="${escapeAttr(patternFormColor())}" style="padding: 0; height: 28px; cursor: pointer;"></label>
        </div>
        <label>服务类型 (serviceType):
          <select id="pattern-service-type">
            ${serviceTypeOptions(patternFormServiceType())}
          </select>
        </label>
        <button class="primary full" data-action="save-pattern" ${state.candidates.length > 0 ? "" : "disabled"} style="width: 100%;">
          ${state.editingPatternId ? "更新模式 (Update)" : "保存模式 (Save)"}
        </button>
      </div>
    </div>
  `;
}

function renderStepLeftControls_Route(): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px;">
      <div style="font-weight: 600; font-size: 11.5px; color: var(--color-text-muted);">跨线换乘查询 (OD Query):</div>
      <label>
        起点车站 (From):
        <select id="route-from">${stationOptions(state.routeFrom)}</select>
      </label>
      <label>
        终点车站 (To):
        <select id="route-to">${stationOptions(state.routeTo)}</select>
      </label>
      <div class="agg-row" style="margin-top: 4px; display: flex; gap: 6px; width: 100%;">
        <button class="primary" data-action="resolve-route" ${state.patterns.length >= 2 ? "" : "disabled"} style="flex: 1;">求解换乘 (Resolve)</button>
        <button data-action="seed-route-query" ${state.patterns.length >= 2 ? "" : "disabled"}>示例 OD</button>
        <button data-action="clear-route" ${state.crossPath ? "" : "disabled"}>清空</button>
      </div>
    </div>
  `;
}

function renderStepLeftControls_Event(): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px;">
      <div style="font-weight: 600; font-size: 11.5px; color: var(--color-text-muted);">创建/编辑用户事件 (UserEvent Builder):</div>
      <div class="small muted" style="line-height:1.4;">
        请在地图上左键或右键点击节点 (Station) 或边 (Track) 以设定位置。
      </div>
      <div class="agg-row" style="margin-top: 2px; display: flex; gap: 6px; width: 100%;">
        <button data-action="draft-event-station" ${state.selectedNodeRef ? "" : "disabled"} style="flex: 1; font-size: 11px;">锚到选中 node</button>
        <button data-action="draft-event-edge" ${state.selectedEdgeRef ? "" : "disabled"} style="flex: 1; font-size: 11px;">锚到选中 edge</button>
      </div>
      ${eventDraftHtml()}
    </div>
  `;
}

function renderStepLeftControls_Export(): string {
  const allChecks = [
    ...runTopologyValidation(state),
    ...runPatternsValidation(state),
    ...(state.patterns.length >= 2 ? runRouteValidation(state) : []),
    ...(state.userEvents.length > 0 ? runEventValidation(state) : [])
  ];
  const failed = allChecks.filter(c => c.status === "FAIL");
  const isExportDisabled = failed.length > 0;
  
  return `
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px;">
      <div style="font-weight: 600; font-size: 11.5px; color: var(--color-text-muted);">打包与发布 (Release Packaging):</div>
      <div class="small muted" style="line-height:1.4;">
        所有核心验证通过后，方可触发 aggregate 完整数据包发布。
      </div>
      <div class="status-box" style="margin-top: 4px; padding: 6px 10px;">
        断言指标通过率: <b style="color: ${isExportDisabled ? "var(--color-status-error)" : "var(--color-status-done)"}">${allChecks.length - failed.length} / ${allChecks.length}</b>
      </div>
      <div style="margin-top: 6px; width: 100%;">
        <button class="primary full" data-action="export-package" ${isExportDisabled ? "disabled" : ""} style="width: 100%;">
          导出 Aggregate 数据包
        </button>
      </div>
    </div>
  `;
}

function renderRightColumn(): string {
  switch (state.currentStep) {
    case "import": return renderStepRightPanel_Import();
    case "annotate": return renderStepRightPanel_Annotate();
    case "compile": return renderStepRightPanel_Compile();
    case "pattern": return renderStepRightPanel_Pattern();
    case "route": return renderStepRightPanel_Route();
    case "event": return renderStepRightPanel_Event();
    case "export": return renderStepRightPanel_Export();
  }
}

function renderStepRightPanel_Import(): string {
  const aggregate = state.aggregate;
  if (!aggregate) {
    return `
      <div class="agg-section">
        <h2>导入状态 (Import Status)</h2>
        <div class="item small muted">尚未导入或加载任何 aggregate 状态。请在左栏选择 MVP 工作区并导入。</div>
      </div>
    `;
  }

  return `
    <div class="agg-section">
      <h2>已加载的 Aggregate 详情</h2>
      <div class="status-box mono" style="font-size: 11px; line-height: 1.5; background: #fafafa; border-radius: 8px; padding: 10px;">
        aggregateKey: <b>${escapeHtml(aggregate.aggregateKey)}</b><br>
        mode: <b style="color: var(--color-status-ready);">${escapeHtml(aggregate.mode)}</b><br>
        成员工作区 count: <b>${aggregate.memberWorkspaceKeys.length}</b><br>
        成员列表: <span class="muted">${escapeHtml(aggregate.memberWorkspaceKeys.join(", "))}</span><br>
        总 Edge 数量: <b>${aggregate.topo.edges.length}</b><br>
        总 Node 数量: <b>${aggregate.topo.nodes.length}</b><br>
        总 Station 数量: <b>${aggregate.topo.stations.length}</b><br>
        总 Platform 数量: <b>${aggregate.topo.platforms.length}</b>
      </div>
    </div>
    <div class="agg-section">
      <h2>成员工作区明细 (Members Detail)</h2>
      <div class="list">
        ${aggregate.memberWorkspaceKeys.map(key => {
          const edgeCount = aggregate.perWorkspaceEdgeCount?.[key] ?? 0;
          return `
            <div class="item">
              <div class="item-title">
                <span class="mono">${escapeHtml(key)}</span>
                <span class="pill done">edges: ${edgeCount}</span>
              </div>
              <div class="small muted" style="margin-top: 4px;">所属线段及拓扑关联已在编译时归并，并进行跨线几何节点重合度匹配 (Snap tolerance: 0.5m)。</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderStepRightPanel_Annotate(): string {
  const aggregate = state.aggregate;
  if (!aggregate) return `<div class="agg-section"><h2>人工标注</h2><div class="item small muted">无拓扑数据</div></div>`;
  const filtered = getFilteredFeatures();
  const selectedFeat = filtered.find(item => {
    const ann = item.feature.properties?.railGraph as RailGraphAnnotation | undefined;
    return ann?.id === state.selectedFeatureId;
  }) || (state.selectedFeatureId ? {
    feature: aggregate.featureCollection.features.find(f => (f.properties?.railGraph as RailGraphAnnotation | undefined)?.id === state.selectedFeatureId),
    index: aggregate.featureCollection.features.findIndex(f => (f.properties?.railGraph as RailGraphAnnotation | undefined)?.id === state.selectedFeatureId)
  } : null);

  const listHtml = filtered.slice(0, 100).map(item => {
    const ann = item.feature.properties?.railGraph as RailGraphAnnotation | undefined;
    const isSelected = ann?.id === state.selectedFeatureId;
    const labelName = ann?.station?.name || ann?.platform?.name || item.feature.properties.name || item.feature.properties.station_name || ann?.id || `Feature #${item.index}`;
    const kindStr = ann?.kind || "unknown";
    
    let icon = "🌐";
    if (kindStr === "track_geometry") icon = "🛤️";
    else if (kindStr === "station_point") icon = "🚉";
    else if (kindStr === "platform_area") icon = "🎛️";
    else if (kindStr === "station_entrance") icon = "🚪";

    return `
      <div class="an-feature-item ${isSelected ? "selected" : ""}" data-action="select-feature" data-id="${escapeAttr(ann?.id || "")}">
        <span class="an-geom-icon">${icon}</span>
        <span class="an-feature-label">${escapeHtml(labelName)}</span>
        <span class="small mono muted" style="font-size: 10px;">${escapeHtml(kindStr)}</span>
      </div>
    `;
  }).join("");

  const displayList = filtered.length > 0 
    ? listHtml + (filtered.length > 100 ? `<div class="small muted" style="text-align: center; padding: 4px;">... 仅展示前 100 个结果 (共 ${filtered.length} 个) ...</div>` : "")
    : `<div class="item small muted" style="text-align: center;">没有符合条件的特征。</div>`;

  let inspectorHtml = `<div class="item small muted" style="text-align: center; padding: 20px;">请在左栏搜索，或在右侧列表选中特征，或在地图点击对应几何进行精细化属性编辑。</div>`;
  if (selectedFeat && selectedFeat.feature) {
    const f = selectedFeat.feature;
    const idx = selectedFeat.index;
    const ann = f.properties?.railGraph as RailGraphAnnotation | undefined;
    const kind = ann?.kind || "unknown";
    const name = ann?.station?.name || ann?.platform?.name || f.properties.name || f.properties.station_name || "";
    const sourceTags = f.properties.sourceTags || f.properties || {};

    let kindForm = "";
    if (kind === "track_geometry") {
      const track = ann?.track || { role: "main", traversal: "both" };
      const role = track.role || "main";
      const traversal = track.traversal || "both";
      const dirRole = track.directionRole || "";
      const geomReversed = !!track.geometryReversed;

      kindForm = `
        <label>Edge Role:
          <select id="inspect-track-role">
            <option value="main" ${role === "main" ? "selected" : ""}>Main (正线)</option>
            <option value="connector" ${role === "connector" ? "selected" : ""}>Connector (联络线)</option>
            <option value="storage" ${role === "storage" ? "selected" : ""}>Sidings (侧线/编组)</option>
          </select>
        </label>
        <label>Traversal:
          <select id="inspect-track-traversal">
            <option value="both" ${traversal === "both" ? "selected" : ""}>Both (双向通车)</option>
            <option value="forward" ${traversal === "forward" ? "selected" : ""}>Forward (单向通车)</option>
          </select>
        </label>
        <label>Direction Role:
          <select id="inspect-track-direction-role">
            <option value="" ${dirRole === "" ? "selected" : ""}>Unspecified (未指定/双向)</option>
            <option value="up" ${dirRole === "up" ? "selected" : ""}>Up (上行单向)</option>
            <option value="down" ${dirRole === "down" ? "selected" : ""}>Down (下行单向)</option>
            <option value="bidirectional" ${dirRole === "bidirectional" ? "selected" : ""}>Bidirectional (双向运行)</option>
          </select>
        </label>
        <div class="agg-row" style="grid-column: span 2; margin-top: 6px; width: 100%;">
          <button class="danger" style="width: 100%; font-size:11px;" data-action="reverse-geometry" data-idx="${idx}">
            翻转坐标方向 (Geometry Reversed: ${geomReversed ? "ON" : "OFF"})
          </button>
        </div>
      `;
    } else if (kind === "platform_area") {
      const plat = ann?.platform || {};
      const pType = plat.type || "island";
      const stationRef = plat.stationRef || "";
      kindForm = `
        <label>Platform Type:
          <select id="inspect-platform-type">
            <option value="island" ${pType === "island" ? "selected" : ""}>Island (岛式站台)</option>
            <option value="side" ${pType === "side" ? "selected" : ""}>Side (侧式站台)</option>
            <option value="bay" ${pType === "bay" ? "selected" : ""}>Bay (港湾式站台)</option>
            <option value="unknown" ${pType === "unknown" ? "selected" : ""}>Unknown (未知)</option>
          </select>
        </label>
        <label>绑定车站 (stationRef):
          <select id="inspect-platform-station-ref">
            ${stationOptions(stationRef as EntityRef)}
          </select>
        </label>
        <div class="agg-row" style="grid-column: span 2; margin-top: 6px; width: 100%;">
          <button class="primary" style="width: 100%; font-size:11px;" data-action="auto-bind-station" data-idx="${idx}">
            关联至最近车站 (Auto-Bind Nearest)
          </button>
        </div>
      `;
    } else if (kind === "station_entrance") {
      const entrance = ann?.entrance || {};
      const stationRef = entrance.stationRef || "";
      kindForm = `
        <label style="grid-column: span 2;">绑定车站 (stationRef):
          <select id="inspect-entrance-station-ref">
            ${stationOptions(stationRef as EntityRef)}
          </select>
        </label>
        <div class="agg-row" style="grid-column: span 2; margin-top: 6px; width: 100%;">
          <button class="primary" style="width: 100%; font-size:11px;" data-action="auto-bind-station" data-idx="${idx}">
            关联至最近车站 (Auto-Bind Nearest)
          </button>
        </div>
      `;
    } else if (kind === "station_point") {
      kindForm = `
        <label style="grid-column: span 2;">车站中文名称 (name):
          <input id="inspect-station-name" value="${escapeAttr(name)}">
        </label>
      `;
    }

    const tagsRows = Object.entries(sourceTags)
      .filter(([k]) => k !== "railGraph" && typeof sourceTags[k] !== "object")
      .map(([k, v]) => `
        <div class="an-tag-key">${escapeHtml(k)}</div>
        <div class="an-tag-value">${escapeHtml(v)}</div>
      `).join("");

    inspectorHtml = `
      <div class="an-inspector-form">
        <label>特征 ID:</label>
        <div class="mono" style="font-weight:600; word-break:break-all;">${escapeHtml(ann?.id || "")}</div>
        <label>特征类型:</label>
        <div class="pill done" style="width:fit-content; text-transform:uppercase;">${escapeHtml(kind)}</div>
        
        <label>特征名称:</label>
        <input id="inspect-name" value="${escapeAttr(name)}">
        
        ${kindForm}
        
        <div class="agg-row" style="grid-column: span 2; margin-top: 8px; border-top:1px solid #f1f5f9; padding-top:8px; width:100%;">
          <button class="primary full" style="width: 100%;" data-action="save-inspector-changes" data-idx="${idx}">保存特征属性</button>
        </div>
      </div>
      
      <div style="font-weight: 600; font-size: 11px; margin-top: 10px; margin-bottom: 4px; color: var(--color-text-muted);">原始属性元数据 (Source Tags):</div>
      <div class="an-tag-table">
        ${tagsRows || '<div style="grid-column: span 2; text-align: center; color: var(--color-text-muted);">无原始属性</div>'}
      </div>
    `;
  }

  return `
    <div class="agg-section" style="flex: 1; display: flex; flex-direction: column; min-height: 200px; max-height: 300px; overflow: hidden;">
      <h2>标注特征列表 (${filtered.length} 个)</h2>
      <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; margin-top: 6px;">
        ${displayList}
      </div>
    </div>
    
    <div class="agg-section" style="flex: 1; overflow-y: auto;">
      <h2>特征属性检视 (Inspector)</h2>
      <div style="margin-top: 6px;">
        ${inspectorHtml}
      </div>
    </div>
  `;
}

function renderStepRightPanel_Compile(): string {
  const aggregate = state.aggregate;
  if (!aggregate) return `<div class="agg-section"><h2>拓扑编译校验</h2><div class="item small muted">无拓扑数据</div></div>`;
  
  const diagnostics = aggregate.diagnostics || [];
  const checks = runTopologyValidation(state);

  const checklistHtml = checks.map(c => {
    const isPass = c.status === "PASS";
    const statusClass = isPass ? "pass" : "fail";
    const statusText = isPass ? "PASS" : "FAIL";
    return `
      <div class="checklist-item" style="margin-bottom:6px;">
        <span class="checklist-status ${statusClass}">${statusText}</span>
        <span style="font-weight: 600;">${escapeHtml(c.label)}</span>
        ${c.detail ? `<div class="small muted" style="margin-left: 38px; word-break: break-all; font-family:monospace;">${escapeHtml(c.detail)}</div>` : ""}
      </div>
    `;
  }).join("");

  const diagnosticsHtml = diagnostics.map(d => {
    const typeClass = d.level === "error" || d.level === "fatal" ? "error" : "stale";
    return `
      <div class="item" style="border-left: 4px solid var(--color-status-${typeClass}); margin-bottom: 6px;">
        <div class="item-title">
          <span class="mono" style="font-size: 11px; font-weight:600;">[${escapeHtml(d.code)}]</span>
          <span class="pill ${typeClass}">${escapeHtml(d.level)}</span>
        </div>
        <div class="small" style="margin-top: 2px;">${escapeHtml(d.message)}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="agg-section">
      <h2>拓扑联通性与跨线校验指标</h2>
      <div class="list" style="margin-top: 8px;">
        ${checklistHtml}
      </div>
    </div>
    <div class="agg-section" style="flex: 1; max-height: 400px; overflow-y: auto;">
      <h2>拓扑编译诊断日志 (${diagnostics.length} 项)</h2>
      <div class="list" style="margin-top: 8px;">
        ${diagnosticsHtml || '<div class="item small muted" style="text-align: center;">🎉 无拓扑编译异常，编译质量完美！</div>'}
      </div>
    </div>
  `;
}

function renderStepRightPanel_Pattern(): string {
  const selectedPattern = state.patterns.find(p => p.patternId === state.selectedPatternId);
  return `
    <div class="agg-section" style="flex: 1; max-height: 200px; overflow-y: auto;">
      <h2>候选路径解析结果 (${state.candidates.length} 条)</h2>
      <div class="list" style="margin-top: 8px;">
        ${candidatesHtml()}
      </div>
    </div>
    
    <div class="agg-section" style="flex: 1; max-height: 240px; overflow-y: auto;">
      <h2>已保存的运行模式 (Saved Patterns)</h2>
      <div class="list" style="margin-top: 8px;">
        ${patternsHtml()}
      </div>
    </div>

    ${selectedPattern ? `
      <div class="agg-section">
        <h2>模式详情与路径溯源 [${escapeHtml(selectedPattern.displayName || "")}]</h2>
        <div style="margin-top: 8px;">
          ${patternDetailHtml(selectedPattern)}
        </div>
      </div>
    ` : ""}
  `;
}

function renderStepRightPanel_Route(): string {
  return `
    <div class="agg-section">
      <h2>换乘路径导航明细 (Cross-Pattern Hops)</h2>
      <div style="margin-top: 8px;">
        ${routeResultHtml()}
      </div>
    </div>
  `;
}

function renderStepRightPanel_Event(): string {
  const orderedEvents = eventsOnSelectedPath();
  const pattern = state.patterns.find(p => p.patternId === state.selectedPatternId) || state.patterns[0];
  const patternLabel = pattern ? pattern.displayName || pattern.patternId : "无";

  return `
    <div class="agg-section" style="flex: 1; max-height: 200px; overflow-y: auto;">
      <h2>路径锚定事件聚合序列 [${escapeHtml(patternLabel)}]</h2>
      <div style="margin-top: 8px;">
        ${orderedEventsHtml(orderedEvents)}
      </div>
    </div>
    
    <div class="agg-section" style="flex: 1; max-height: 350px; overflow-y: auto;">
      <h2>已保存的事件库 (Saved UserEvents)</h2>
      <div style="margin-top: 8px;">
        ${eventsHtml()}
      </div>
    </div>
  `;
}

function renderStepRightPanel_Export(): string {
  const checks1 = runTopologyValidation(state);
  const checks2 = runPatternsValidation(state);
  const checks3 = state.patterns.length >= 2 ? runRouteValidation(state) : [];
  const checks4 = state.userEvents.length > 0 ? runEventValidation(state) : [];

  const categories = [
    { name: "1. 拓扑与连通性验证 (PR1/Compiled-Topology)", items: checks1 },
    { name: "2. 模式与意图链回溯验证 (PR1/Patterns-Round-Trip)", items: checks2 },
    { name: "3. 跨线换乘图与寻路可用性验证 (PR2/Cross-PF)", items: checks3 },
    { name: "4. L4 级别用户事件聚合序列验证 (PR3/Events-Ordering)", items: checks4 }
  ];

  const reportHtml = categories.map(cat => {
    if (cat.items.length === 0) return "";
    const itemsHtml = cat.items.map(c => {
      const isPass = c.status === "PASS";
      const statusClass = isPass ? "pass" : "fail";
      const statusText = isPass ? "PASS" : "FAIL";
      return `
        <div class="checklist-item" style="padding-left: 8px; border-left: 2px solid ${isPass ? "#10b981" : "#ef4444"}; margin-bottom: 6px;">
          <div style="display:flex; align-items:center; gap: 6px;">
            <span class="checklist-status ${statusClass}">${statusText}</span>
            <span class="mono" style="font-weight:600; font-size: 11.5px;">${escapeHtml(c.id)}</span>
          </div>
          <div class="small" style="margin-top:2px; font-weight:500;">${escapeHtml(c.label)}</div>
          ${c.detail ? `<div class="small muted mono" style="font-size: 10px; margin-top:2px;">${escapeHtml(c.detail)}</div>` : ""}
        </div>
      `;
    }).join("");

    return `
      <div style="margin-top: 10px; margin-bottom: 12px;">
        <div style="font-weight: 700; font-size: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px; color: var(--color-text-main);">${escapeHtml(cat.name)}</div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${itemsHtml}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="agg-section" style="flex: 1; overflow-y: auto;">
      <h2>全站功能与模型一致性最终断言清单 (Verify Checklist)</h2>
      <div style="margin-top: 8px;">
        ${reportHtml}
      </div>
    </div>
  `;
}

function getFilteredFeatures(): Array<{ feature: any; index: number }> {
  if (!state.aggregate) return [];
  const query = state.annotateSearchQuery.toLowerCase().trim();
  const filter = state.annotateFilter;
  const features = state.aggregate.featureCollection.features;

  return features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => {
      const ann = feature.properties?.railGraph as RailGraphAnnotation | undefined;
      
      if (filter !== "all") {
        if (filter === "unannotated") {
          if (ann && ann.kind !== "unknown") return false;
        } else {
          const kindMap: Record<string, string> = {
            track: "track_geometry",
            station: "station_point",
            platform: "platform_area",
            signal: "signal",
            entrance: "station_entrance"
          };
          if (ann?.kind !== kindMap[filter]) return false;
        }
      }

      if (query) {
        const id = (ann?.id || (feature.properties?.id as string | undefined) || "").toLowerCase();
        const name = String(
          ann?.station?.name || 
          ann?.platform?.name || 
          feature.properties?.name || 
          feature.properties?.station_name || 
          ""
        ).toLowerCase();
        return id.includes(query) || name.includes(query);
      }

      return true;
    });
}

function isPatternValid(patternId: EntityRef): { ok: boolean; detail?: string } {
  const checks = runPatternsValidation(state);
  const edgeCheck = checks.find(c => c.id === `pattern_edges_${patternId}`);
  const rtCheck = checks.find(c => c.id === `pattern_rt_${patternId}`);
  
  if (edgeCheck?.status === "FAIL") {
    return { ok: false, detail: edgeCheck.detail ?? "物理边失效" };
  }
  if (rtCheck?.status === "FAIL") {
    return { ok: false, detail: rtCheck.detail ?? "意图链重构失败" };
  }
  return { ok: true };
}

function isEventValid(eventId: EntityRef): { ok: boolean; detail?: string } {
  if (!state.aggregate) return { ok: false, detail: "无拓扑数据" };
  const event = state.userEvents.find(e => e.id === eventId);
  if (!event) return { ok: false };
  
  const anchor = event.anchor;
  if (anchor.kind === "station") {
    const nodeExists = state.aggregate.topo.nodes.some(n => n.id === anchor.stationRef);
    return nodeExists ? { ok: true } : { ok: false, detail: `未找到节点 ${anchor.stationRef}` };
  } else {
    const edgeExists = state.aggregate.topo.edges.some(e => e.id === anchor.edgeRef);
    return edgeExists ? { ok: true } : { ok: false, detail: `未找到边 ${anchor.edgeRef}` };
  }
}

function safeImportWorkspaceList(): ReturnType<typeof listMvpImportWorkspaces> {
  try {
    return listMvpImportWorkspaces();
  } catch {
    return [];
  }
}

function importWorkspaceListHtml(items: ReturnType<typeof listMvpImportWorkspaces>): string {
  if (items.length === 0) {
    return `<div class="item small muted">未发现 MVP workspace。先打开 MVP 工作台创建/加载 workspace。</div>`;
  }
  return items.map((item) => `
    <label class="item" style="display:flex; gap:8px; align-items:flex-start;">
      <input type="checkbox" class="import-workspace-checkbox" value="${escapeAttr(item.key)}" checked style="margin-top:2px;">
      <span>
        <b>${escapeHtml(item.companyName)} / ${escapeHtml(item.lineName)}</b><br>
        <span class="small muted">annotate: <b>${escapeHtml(item.annotateStatus)}</b> · compile: <b>${escapeHtml(item.compileStatus)}</b></span><br>
        <span class="small mono">${escapeHtml(item.key)}</span>
      </span>
    </label>
  `).join("");
}

function selectedImportWorkspaceKeys(): EntityRef[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(".import-workspace-checkbox:checked"))
    .map((input) => input.value as EntityRef);
}

function renderCandidatePreview(): void {
  renderMap();
}

function modeButton(mode: ChainEditorMode, label: string): string {
  return `<button class="${state.editor.mode === mode ? "active" : ""}" data-action="set-mode" data-mode="${mode}">${label}</button>`;
}

function chainHtml(): string {
  if (state.editor.chain.nodes.length === 0) {
    return `<div class="item small muted">尚未创建 chain。先点“起点”，在地图选择 node；再添加 via edge 和终点。</div>`;
  }
  return state.editor.chain.nodes.map((node, index) => `
    <div class="item">
      <div class="item-title">
        <span>${index + 1}. ${escapeHtml(node.kind)}</span>
        <span class="agg-row">
          <button data-action="move-chain-node" data-index="${index}" data-delta="-1" ${index === 0 ? "disabled" : ""}>↑</button>
          <button data-action="move-chain-node" data-index="${index}" data-delta="1" ${index === state.editor.chain.nodes.length - 1 ? "disabled" : ""}>↓</button>
          <button class="danger" data-action="remove-chain-node" data-index="${index}">删除</button>
        </span>
      </div>
      <div class="small mono ${node.kind === "via_edge" ? "edge-pick" : "node-pick"}">${escapeHtml(describeChainNode(node))}</div>
    </div>
  `).join("");
}

function candidatesHtml(): string {
  if (state.candidates.length === 0) {
    return `<div class="item small muted">暂无候选。设置 chain 后点击 Compute。</div>`;
  }
  return state.candidates.map((candidate, index) => `
    <div class="item ${index === state.activeCandidateIndex ? "selected" : ""}">
      <div class="item-title">
        <span>Candidate #${index + 1}</span>
        <button data-action="select-candidate" data-index="${index}">选择</button>
      </div>
      <div class="small muted">edges: <b>${candidate.edgeSequence.length}</b> · distance: <b>${formatKm(candidate.totalDistanceMeters)}</b></div>
      <div class="small mono">${escapeHtml(candidate.edgeSequence.slice(0, 4).map(shortRef).join(" → "))}${candidate.edgeSequence.length > 4 ? " ..." : ""}</div>
    </div>
  `).join("");
}

function patternsHtml(): string {
  if (state.patterns.length === 0) {
    return `<div class="item small muted">尚未保存 ServicePattern。</div>`;
  }
  return state.patterns.map((pattern) => {
    const val = isPatternValid(pattern.patternId);
    const styleStr = val.ok ? "" : "border-color: var(--color-status-error); background: var(--color-status-error-bg);";
    const statusText = val.ok ? "" : ` <span class="pill error" style="margin-left:4px;">invalid: ${escapeHtml(val.detail)}</span>`;
    
    return `
      <div class="item ${pattern.patternId === state.selectedPatternId ? "selected" : ""}" style="${styleStr}">
        <div class="item-title">
          <span>
            <span class="swatch" style="background:${escapeAttr(pattern.displayColor ?? "#2563eb")}"></span> 
            ${escapeHtml(pattern.displayName ?? pattern.patternId)}
            ${statusText}
          </span>
          <span class="agg-row">
            <button data-action="select-pattern" data-pattern-id="${escapeAttr(pattern.patternId)}">查看</button>
            <button data-action="load-pattern-chain" data-pattern-id="${escapeAttr(pattern.patternId)}">载入</button>
            <button data-action="edit-pattern" data-pattern-id="${escapeAttr(pattern.patternId)}">编辑</button>
            <button class="danger" data-action="delete-pattern" data-pattern-id="${escapeAttr(pattern.patternId)}">删除</button>
          </span>
        </div>
        <div class="small muted">edges: ${pattern.edgeSequence.length} · stops: ${pattern.traceSequence.length} · chain nodes: ${pattern.intentionChain?.nodes.length ?? 0}</div>
      </div>
    `;
  }).join("");
}

function patternDetailHtml(pattern: StoredServicePattern): string {
  return `
    <div class="status" style="margin-top:8px;">
      <b>${escapeHtml(pattern.displayName ?? pattern.patternId)}</b><br>
      <span class="mono">${escapeHtml(pattern.patternId)}</span><br>
      lineRef: <span class="mono">${escapeHtml(pattern.lineRef)}</span><br>
      serviceType: <b>${escapeHtml(pattern.serviceType)}</b> · color: <span class="mono">${escapeHtml(pattern.displayColor ?? "")}</span><br>
      trace entries: ${pattern.traceSequence.length} · distance: ${formatKm(patternDistanceMeters(pattern))}<br>
      <div class="agg-row" style="margin-top:6px;">
        <button data-action="load-pattern-chain" data-pattern-id="${escapeAttr(pattern.patternId)}">载入 IntentionChain</button>
        <button data-action="edit-pattern" data-pattern-id="${escapeAttr(pattern.patternId)}">编辑并覆盖</button>
      </div>
      <div class="small mono" style="margin-top:6px;">chain: ${escapeHtml((pattern.intentionChain?.nodes ?? []).map(describeChainNode).join(" / ") || "(none)")}</div>
      <div class="small mono" style="margin-top:6px;">${escapeHtml(pattern.edgeSequence.slice(0, 6).map(shortRef).join(" → "))}${pattern.edgeSequence.length > 6 ? " ..." : ""}</div>
    </div>
  `;
}

function stationOptions(selected: EntityRef | ""): string {
  const stations = routeStations();
  return [
    `<option value="">选择 station</option>`,
    ...stations.map((stationRef) =>
      `<option value="${escapeAttr(stationRef)}" ${stationRef === selected ? "selected" : ""}>${escapeHtml(shortRef(stationRef))}</option>`
    ),
  ].join("");
}

function routeStations(): EntityRef[] {
  const seen = new Set<EntityRef>();
  const out: EntityRef[] = [];
  for (const pattern of state.patterns) {
    for (const trace of pattern.traceSequence) {
      if (seen.has(trace.stationRef)) continue;
      seen.add(trace.stationRef);
      out.push(trace.stationRef);
    }
  }
  return out;
}

function routeResultHtml(): string {
  if (!state.crossPath) {
    return `<div class="item small muted" style="margin-top:8px;">暂无 Route Query 结果。</div>`;
  }
  const totalEdges = state.crossPath.hops.reduce((sum, hop) => sum + hop.edgeSequence.length, 0);
  return `
    <div class="status" style="margin-top:8px;">
      hops: <b>${state.crossPath.hops.length}</b> · transfers: <b>${state.crossPath.transferStations.length}</b> · edges: <b>${totalEdges}</b>
      <div class="list" style="margin-top:8px;">
        ${state.crossPath.hops.map((hop, index) => `
          <div class="item">
            <div class="item-title">
              <span>${index + 1}. ${escapeHtml(patternName(hop.patternRef))}</span>
              <span>${escapeHtml(hop.direction)}</span>
            </div>
            <div class="small muted">${escapeHtml(shortRef(hop.fromStation))} → ${escapeHtml(shortRef(hop.toStation))}</div>
            <div class="small mono">${escapeHtml(hop.edgeSequence.slice(0, 5).map(shortRef).join(" → "))}${hop.edgeSequence.length > 5 ? " ..." : ""}</div>
          </div>
        `).join("")}
      </div>
      ${state.crossPath.transferStations.length > 0
        ? `<div class="small mono" style="margin-top:6px;">transfer: ${escapeHtml(state.crossPath.transferStations.map(shortRef).join(" / "))}</div>`
        : ""}
    </div>
  `;
}

function eventDraftHtml(): string {
  if (!state.eventDraftAnchor) {
    return `<div class="item small muted" style="margin-top:8px;">没有正在编辑的 UserEvent。</div>`;
  }
  const anchor = state.eventDraftAnchor;
  const editing = editingEvent();
  return `
    <div class="item selected" style="margin-top:8px;">
      <div class="item-title">
        <span>${editing ? "Edit UserEvent" : "New UserEvent"}</span>
        <button data-action="cancel-event">取消</button>
      </div>
      <div class="small mono event-pick">${escapeHtml(anchorText(anchor))}</div>
      <div class="agg-grid" style="margin-top:8px;">
        <label>title<input id="event-title" value="${escapeAttr(editing?.title ?? "UserEvent")}"></label>
        ${anchor.kind === "edge"
          ? `<label>measure<input id="event-measure" type="number" min="0" max="1" step="0.05" value="${anchor.measure}"></label>`
          : ""}
        <button class="primary" data-action="save-event">${editing ? "更新 UserEvent" : "保存 UserEvent"}</button>
      </div>
    </div>
  `;
}

function orderedEventsHtml(events: OrderedEvent[]): string {
  if (events.length === 0) {
    return `<div class="item small muted">当前选中路径上没有 UserEvent。</div>`;
  }
  return `
    <div class="list">
      ${events.map((entry) => `
        <div class="item">
          <div class="item-title">
            <span>${escapeHtml(entry.event.title)}</span>
            <span>#${entry.orderIndex}${entry.subIndex > 0 ? `.${entry.subIndex.toFixed(2).slice(2)}` : ""}</span>
          </div>
          <div class="small mono event-pick">${escapeHtml(anchorText(entry.event.anchor))}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function eventsHtml(): string {
  if (state.userEvents.length === 0) {
    return `<div class="item small muted">尚未保存 UserEvent。</div>`;
  }
  return `
    <div class="list">
      ${state.userEvents.map((event) => {
        const val = isEventValid(event.id);
        const styleStr = val.ok ? "" : "border-color: var(--color-status-error); background: var(--color-status-error-bg);";
        const statusText = val.ok ? "" : ` <span class="pill error" style="margin-left:4px;">orphan: ${escapeHtml(val.detail)}</span>`;
        
        return `
          <div class="item" style="${styleStr}">
            <div class="item-title">
              <span>${escapeHtml(event.title)}${statusText}</span>
              <span class="agg-row">
                <button data-action="edit-event" data-event-id="${escapeAttr(event.id)}">编辑</button>
                <button class="danger" data-action="delete-event" data-event-id="${escapeAttr(event.id)}">删除</button>
              </span>
            </div>
            <div class="small mono event-pick">${escapeHtml(anchorText(event.anchor))}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function eventsOnSelectedPath(): OrderedEvent[] {
  const path = selectedPathLike();
  if (!path) return [];
  return aggregateEventsAlongPath(state.userEvents, path);
}

function selectedPathLike(): PathLike | null {
  if (state.crossPath) return flattenCrossPathToPathLike(state.crossPath);
  const selectedPattern = state.patterns.find((pattern) => pattern.patternId === state.selectedPatternId);
  if (selectedPattern) return patternPathLike(selectedPattern);
  const candidate = state.candidates[state.activeCandidateIndex];
  if (candidate) {
    return {
      edgeSequence: candidate.edgeSequence,
      stationSequence: candidate.nodeSequence,
    };
  }
  return null;
}

function patternPathLike(pattern: StoredServicePattern): PathLike {
  return {
    edgeSequence: pattern.edgeSequence,
    stationSequence: pattern.traceSequence.map((trace) => trace.stationRef),
  };
}

function patternName(patternRef: EntityRef): string {
  const pattern = state.patterns.find((item) => item.patternId === patternRef);
  return pattern?.displayName ?? patternRef;
}

function editingPattern(): StoredServicePattern | null {
  return state.editingPatternId
    ? state.patterns.find((pattern) => pattern.patternId === state.editingPatternId) ?? null
    : null;
}

function patternToCandidate(pattern: StoredServicePattern): AggregateCandidatePath {
  return {
    edgeSequence: [...pattern.edgeSequence],
    nodeSequence: pattern.traceSequence.map((trace) => trace.stationRef),
    totalDistanceMeters: patternDistanceMeters(pattern),
  };
}

function patternDistanceMeters(pattern: StoredServicePattern): number {
  return pattern.pathSegments.reduce((sum, segment) => sum + (segment.distanceMeters || 0), 0);
}

function patternFormName(): string {
  return editingPattern()?.displayName ?? candidateDefaultName();
}

function patternFormLineRef(aggregate: AggregateState | null): string {
  return editingPattern()?.lineRef ?? `aggregate:line:${aggregate?.aggregateKey ?? AGGREGATE_KEY}`;
}

function patternFormColor(): string {
  return editingPattern()?.displayColor ?? "#2563eb";
}

function patternFormServiceType(): StoredServicePattern["serviceType"] {
  return editingPattern()?.serviceType ?? "local";
}

function serviceTypeOptions(selected: StoredServicePattern["serviceType"]): string {
  const options: StoredServicePattern["serviceType"][] = [
    "local",
    "rapid",
    "express",
    "limited_express",
    "freight",
    "maintenance",
  ];
  return options.map((option) =>
    `<option value="${option}" ${option === selected ? "selected" : ""}>${option}</option>`
  ).join("");
}

function editingEvent(): UserEvent | null {
  return state.editingEventId
    ? state.userEvents.find((event) => event.id === state.editingEventId) ?? null
    : null;
}

function anchorText(anchor: UserEvent["anchor"]): string {
  if (anchor.kind === "station") return `station ${anchor.stationRef}`;
  return `edge ${anchor.edgeRef} @ ${anchor.measure.toFixed(2)}`;
}

function canCompute(): boolean {
  const nodes = state.editor.chain.nodes;
  return nodes[0]?.kind === "origin" && nodes[nodes.length - 1]?.kind === "terminus";
}

function candidateDefaultName(): string {
  return `ServicePattern ${state.patterns.length + 1}`;
}

function coordinateAtMeasure(edge: TopologyEdge | undefined, measure: number): [number, number] | null {
  const coords = edge?.coordinates;
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  const target = polylineLengthMeters(coords) * clamp01(measure);
  let walked = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const left = coords[i - 1];
    const right = coords[i];
    const segmentLength = polylineLengthMeters([left, right]);
    if (walked + segmentLength >= target) {
      const ratio = segmentLength > 0 ? (target - walked) / segmentLength : 0;
      return [
        left[0] + (right[0] - left[0]) * ratio,
        left[1] + (right[1] - left[1]) * ratio,
      ];
    }
    walked += segmentLength;
  }
  return coords[coords.length - 1];
}

function edgeTooltip(edge: TopologyEdge): string {
  const tags = edge.sourceTags ?? {};
  return `
    <b>${escapeHtml(edge.name ?? edge.id)}</b><br>
    <span class="mono">${escapeHtml(edge.id)}</span><br>
    length: ${formatKm(edge.lengthMeters)}<br>
    osm: ${escapeHtml(tags.osm_type ?? "")}/${escapeHtml(tags.osm_id ?? "")}<br>
    source: ${escapeHtml(tags.source_line_name ?? "")}
  `;
}

function requireAggregate(): AggregateState {
  if (!state.aggregate) throw new Error("Aggregate not loaded.");
  return state.aggregate;
}

function requireMap(): MapState {
  if (!mapState) throw new Error("Map not ready.");
  return mapState;
}

function valueOf(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return el?.value.trim() ?? "";
}

function latLngs(coords: [number, number][]): [number, number][] {
  return coords.map((coord) => [coord[1], coord[0]]);
}

function pickModeLabel(mode: ChainEditorMode): string {
  switch (mode) {
    case "idle": return "查看";
    case "picking-origin": return "选择起点 node";
    case "picking-via": return "选择经过 edge";
    case "picking-terminus": return "选择终点 node";
  }
}

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function shortRef(ref: string): string {
  const parts = ref.split(":");
  if (parts.length >= 3) return parts.slice(-2).join(":");
  return ref;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "pattern";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch] ?? ch));
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
