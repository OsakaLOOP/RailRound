import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { IntentionNode } from "../rail-graph-v1/chain.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { Station, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import { projectPointToPolyline } from "../rail-graph-v1/geometry-math";
import { importWorkspaces, loadAggregate, type AggregateState } from "./aggregate-state";
import { listMvpImportWorkspaces } from "./workspace-import";
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

function renderShell(): void {
  const root = document.getElementById("rail-graph-aggregate");
  if (!root) throw new Error("Missing #rail-graph-aggregate root.");
  root.innerHTML = `
    <style>
      :root {
        color: #172033;
        background: #eef2f7;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; overflow: hidden; }
      .agg-shell {
        width: 100vw;
        height: 100vh;
        display: grid;
        grid-template-columns: minmax(520px, 1fr) 430px;
        background: #eef2f7;
      }
      #agg-map { width: 100%; height: 100%; }
      .agg-panel {
        height: 100vh;
        overflow: auto;
        border-left: 1px solid #cbd5e1;
        background: #f8fafc;
        padding: 12px;
      }
      .agg-section {
        border: 1px solid #d6dde8;
        background: #ffffff;
        border-radius: 8px;
        padding: 10px;
        margin-bottom: 10px;
      }
      .agg-section h2 {
        margin: 0 0 8px;
        font-size: 14px;
        line-height: 1.2;
      }
      .agg-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .agg-grid { display: grid; gap: 8px; }
      button, input, select {
        font: inherit;
        font-size: 12px;
      }
      button {
        border: 1px solid #b7c3d5;
        background: #ffffff;
        color: #172033;
        border-radius: 6px;
        padding: 6px 8px;
        cursor: pointer;
      }
      button.primary {
        background: #1f6feb;
        border-color: #1f6feb;
        color: #ffffff;
      }
      button.danger {
        background: #ffffff;
        border-color: #f0a7a7;
        color: #b42318;
      }
      button.active {
        border-color: #1f6feb;
        color: #0f4fb8;
        background: #eff6ff;
      }
      button:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      input, select {
        border: 1px solid #b7c3d5;
        border-radius: 6px;
        padding: 6px 8px;
        min-width: 0;
      }
      label {
        display: grid;
        gap: 4px;
        font-size: 11px;
        color: #526173;
      }
      .full { width: 100%; }
      .two { display: grid; grid-template-columns: 1fr 110px; gap: 6px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
      .muted { color: #64748b; }
      .small { font-size: 11px; }
      .list {
        display: grid;
        gap: 6px;
      }
      .item {
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        padding: 7px;
        background: #fbfdff;
      }
      .item.selected {
        border-color: #1f6feb;
        background: #eff6ff;
      }
      .item-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        font-weight: 650;
      }
      .swatch {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid #94a3b8;
        display: inline-block;
      }
      .status {
        border: 1px solid #d6dde8;
        background: #f1f5f9;
        border-radius: 7px;
        padding: 7px;
        font-size: 11px;
      }
      .edge-pick { color: #0369a1; }
      .node-pick { color: #166534; }
      .event-pick { color: #9a3412; }
      .leaflet-container { font: inherit; }
      @media (max-width: 900px) {
        body { overflow: auto; }
        .agg-shell { height: auto; min-height: 100vh; grid-template-columns: 1fr; }
        #agg-map { height: 58vh; min-height: 420px; }
        .agg-panel { height: auto; border-left: 0; border-top: 1px solid #cbd5e1; }
      }
    </style>
    <main class="agg-shell">
      <div id="agg-map"></div>
      <aside class="agg-panel">
        <div id="agg-panels"></div>
      </aside>
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
  });
}

async function handleAction(action: string, el: HTMLElement): Promise<void> {
  switch (action) {
    case "reload":
      await loadAll();
      return;
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
  ms.edgeLayers.clear();
  ms.nodeLayers.clear();

  for (const edge of aggregate.topo.edges) {
    if (!edge.coordinates || edge.coordinates.length < 2) continue;
    const line = L.polyline(latLngs(edge.coordinates), {
      color: edge.id === state.selectedEdgeRef ? "#0f4fb8" : "#64748b",
      weight: edge.id === state.selectedEdgeRef ? 5 : 2.5,
      opacity: edge.id === state.selectedEdgeRef ? 0.95 : 0.45,
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
    const marker = L.circleMarker([coord[1], coord[0]], {
      radius: node.id === state.selectedNodeRef ? 5 : 3,
      color: node.id === state.selectedNodeRef ? "#166534" : "#334155",
      fillColor: node.id === state.selectedNodeRef ? "#22c55e" : "#ffffff",
      fillOpacity: 0.9,
      weight: 1.5,
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
  const container = document.getElementById("agg-panels");
  if (!container) return;
  const aggregate = state.aggregate;
  const selectedPattern = state.patterns.find((pattern) => pattern.patternId === state.selectedPatternId);
  const orderedEvents = eventsOnSelectedPath();
  const importWorkspaces = safeImportWorkspaceList();
  container.innerHTML = `
    <section class="agg-section">
      <h2>Aggregate</h2>
      <div class="status">${escapeHtml(state.message)}</div>
      <div class="agg-row" style="margin-top:8px;">
        <button data-action="reload">重新加载</button>
        <button class="primary" data-action="import-workspaces" ${importWorkspaces.length > 0 ? "" : "disabled"}>导入 MVP 工作区</button>
        <button data-action="load-no-direction">加载 verify fallback</button>
        <button data-action="reload-strict">加载 compiled</button>
        <button data-action="fit-map" ${aggregate ? "" : "disabled"}>缩放到数据</button>
        <button data-action="clear-selection" ${state.selectedEdgeRef || state.selectedNodeRef || state.selectedStationRef ? "" : "disabled"}>清空选择</button>
      </div>
      ${state.lastLoadError ? `<div class="small muted" style="margin-top:6px;">last error: <span class="mono">${escapeHtml(state.lastLoadError)}</span></div>` : ""}
      <div class="small muted" style="margin-top:8px;">
        mode: <b>${escapeHtml(aggregate?.mode ?? "loading")}</b><br>
        edges: <b>${aggregate?.topo.edges.length ?? 0}</b> · nodes: <b>${aggregate?.topo.nodes.length ?? 0}</b><br>
        members: <span class="mono">${escapeHtml((aggregate?.memberWorkspaceKeys ?? []).join(", "))}</span>
        ${aggregate?.mode === "no-direction-graph"
          ? `<br><b>verify fallback</b>: no-direction 数据仅供验证，正式 UI 需等待人工标注后的 aggregate import。`
          : ""}
      </div>
      <div class="list" style="margin-top:8px;">
        ${importWorkspaceListHtml(importWorkspaces)}
      </div>
    </section>

    <section class="agg-section">
      <h2>IntentionChain</h2>
      <div class="agg-row">
        ${modeButton("picking-origin", "起点")}
        ${modeButton("picking-via", "经过边")}
        ${modeButton("picking-terminus", "终点")}
        <button data-action="seed-reference-chain">参考链条</button>
        <button data-action="clear-chain">清空</button>
      </div>
      <div class="small muted" style="margin-top:8px;">
        当前模式: <b>${escapeHtml(pickModeLabel(state.editor.mode))}</b>
      </div>
      <div class="list" style="margin-top:8px;">
        ${chainHtml()}
      </div>
      <div class="agg-row" style="margin-top:8px;">
        <button class="primary" data-action="compute" ${canCompute() ? "" : "disabled"}>Compute Candidates</button>
      </div>
    </section>

    <section class="agg-section">
      <h2>Candidates</h2>
      <div class="list">
        ${candidatesHtml()}
      </div>
      <div class="agg-grid" style="margin-top:8px;">
        <label>显示名称<input id="pattern-name" value="${escapeAttr(patternFormName())}"></label>
        <div class="two">
          <label>lineRef<input id="pattern-line-ref" value="${escapeAttr(patternFormLineRef(aggregate))}"></label>
          <label>颜色<input id="pattern-color" type="color" value="${escapeAttr(patternFormColor())}"></label>
        </div>
        <label>serviceType
          <select id="pattern-service-type">
            ${serviceTypeOptions(patternFormServiceType())}
          </select>
        </label>
        <button class="primary" data-action="save-pattern" ${state.candidates.length > 0 ? "" : "disabled"}>${state.editingPatternId ? "更新 ServicePattern" : "保存为 ServicePattern"}</button>
      </div>
    </section>

    <section class="agg-section">
      <h2>Saved Patterns</h2>
      <div class="list">
        ${patternsHtml()}
      </div>
      ${selectedPattern ? patternDetailHtml(selectedPattern) : ""}
    </section>

    <section class="agg-section">
      <h2>Route Query</h2>
      <div class="agg-grid">
        <label>from station
          <select id="route-from">${stationOptions(state.routeFrom)}</select>
        </label>
        <label>to station
          <select id="route-to">${stationOptions(state.routeTo)}</select>
        </label>
        <div class="agg-row">
          <button class="primary" data-action="resolve-route" ${state.patterns.length >= 2 ? "" : "disabled"}>查询换乘路径</button>
          <button data-action="seed-route-query" ${state.patterns.length >= 2 ? "" : "disabled"}>示例 OD</button>
          <button data-action="clear-route" ${state.crossPath ? "" : "disabled"}>清空</button>
        </div>
      </div>
      ${routeResultHtml()}
    </section>

    <section class="agg-section">
      <h2>UserEvent</h2>
      <div class="agg-row">
        <button data-action="draft-event-station" ${state.selectedNodeRef ? "" : "disabled"}>从选中 node 创建</button>
        <button data-action="draft-event-edge" ${state.selectedEdgeRef ? "" : "disabled"}>从选中 edge 创建</button>
      </div>
      <div class="small muted" style="margin-top:6px;">地图右键 node / edge 也会直接设为 UserEvent anchor。</div>
      ${eventDraftHtml()}
      <h2 style="margin-top:12px;">Events on selected path</h2>
      ${orderedEventsHtml(orderedEvents)}
      <h2 style="margin-top:12px;">Saved Events</h2>
      ${eventsHtml()}
    </section>
  `;
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
  return state.patterns.map((pattern) => `
    <div class="item ${pattern.patternId === state.selectedPatternId ? "selected" : ""}">
      <div class="item-title">
        <span><span class="swatch" style="background:${escapeAttr(pattern.displayColor ?? "#2563eb")}"></span> ${escapeHtml(pattern.displayName ?? pattern.patternId)}</span>
        <span class="agg-row">
          <button data-action="select-pattern" data-pattern-id="${escapeAttr(pattern.patternId)}">查看</button>
          <button data-action="load-pattern-chain" data-pattern-id="${escapeAttr(pattern.patternId)}">载入</button>
          <button data-action="edit-pattern" data-pattern-id="${escapeAttr(pattern.patternId)}">编辑</button>
          <button class="danger" data-action="delete-pattern" data-pattern-id="${escapeAttr(pattern.patternId)}">删除</button>
        </span>
      </div>
      <div class="small muted">edges: ${pattern.edgeSequence.length} · stops: ${pattern.traceSequence.length} · chain nodes: ${pattern.intentionChain?.nodes.length ?? 0}</div>
    </div>
  `).join("");
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
      ${state.userEvents.map((event) => `
        <div class="item">
          <div class="item-title">
            <span>${escapeHtml(event.title)}</span>
            <span class="agg-row">
              <button data-action="edit-event" data-event-id="${escapeAttr(event.id)}">编辑</button>
              <button class="danger" data-action="delete-event" data-event-id="${escapeAttr(event.id)}">删除</button>
            </span>
          </div>
          <div class="small mono event-pick">${escapeHtml(anchorText(event.anchor))}</div>
        </div>
      `).join("")}
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
