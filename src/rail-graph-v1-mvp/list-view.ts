// ============================================================
// MVP 可视化 — 列表 / 详情视图
//
// 容器内部 tabs: Topology / Pathfinding / Diagnostics / Raw JSON
// 与 map-view 通过 EntityRef 联动: hover/click list item 触发外部 handler
// ============================================================

import type {
  BaseTopologyLayer,
  Platform,
  PlatformTrackBinding,
  PlatformType,
  Signal,
  Station,
  StoppingPoint,
  TopologyEdge,
  TopologyEdgeRole,
  TrackDirectionRole,
  TrackFunctionalUse,
  TrackPhysicalKind,
  TraversalDirection,
} from "../rail-graph-v1/base-topology.types";
import type {
  AnnotatedFeature,
  AnnotatedFeatureCollection,
  RailGraphAnnotation,
  RailGraphFeatureKind,
} from "../rail-graph-v1/annotation.types";
import type {
  ResolvedChain,
  ResolvedIntentionNode,
  RunningSegment,
} from "../rail-graph-v1/chain.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import type { PathfindingResult } from "../rail-graph-v1/pathfinding";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type {
  ServicePassEntry,
  ServiceStopEntry,
  ServiceTraceEntry,
} from "../rail-graph-v1/service-template.types";
import type { ScenarioResult } from "./poc-pathfinding";
import type { SensekiScenarioResult } from "./poc-senseki-pathfinding";
import type { MvpOverrideState } from "./pipeline";
import type { PipelineReport } from "./rule-handlers";
import { polylineLengthMeters } from "./spatial-helpers";

// ── Public API ──────────────────────────────────────────────

export interface ListViewInput {
  topo: BaseTopologyLayer | null;
  diagnostics: Diagnostic[];
  pathfindingResults?: ScenarioResult[] | SensekiScenarioResult[];
  source?: AnnotatedFeatureCollection | null;
  cleanBatch?: {
    batchName: string;
    batchPath: string;
    decisionPath: string;
    candidates: any[];
    decisions: any[];
    line_display_name?: string;
  } | null;
  cleanOverrides?: MvpOverrideState | null;
  filterRules?: any[] | null;
  activeFilters?: Record<string, boolean>;
  activeLevels?: Record<string, boolean>;
  searchQuery?: string;
  selectMode?: boolean;
  selectedCandidateFid?: string | null;
  activeTab?: TabKey;
  /** 由 app.ts 的 runFilterPipeline 算好的"经全部 active rules 后通过"的 fid 集合 — 优先用它过滤候选,
   *  避免 list-view 自己再跑一次 filter (尤其涉及跨阶段 rule 时 list-view 算不出正确结果). */
  cleanPassFids?: Set<string>;
  /** 同一份 runFilterPipeline 的 per-rule 报告 — 渲染「规则剔除详情」可展开区. */
  cleanPipelineReport?: PipelineReport;
}

/** 路径 hover/click 时传给外部的对象 — 同时携带 edgeSequence 与 turnbackEdgeIndices, 避免 app.ts 反向反查 */
export interface PathHandlerPayload {
  edgeSequence: EntityRef[];
  turnbackEdgeIndices: number[];
  resolvedChain?: ResolvedChain;
}

export interface AnnotationChangePayload {
  featureIdx: number;
  annotation: RailGraphAnnotation;
}

export interface ListView {
  update(input: ListViewInput): void;
  highlightEntity(ref: EntityRef | null): void;
  /** 通过 entity ref / annotation.id 反查 feature, 选中并切换到 Annotate tab. 若找不到则切 tab 但不选中. */
  selectFeatureByRef(ref: EntityRef): void;
  onEntityHover(handler: (ref: EntityRef | null) => void): void;
  onEntityClick(handler: (ref: EntityRef) => void): void;
  onPathHover(handler: (path: PathHandlerPayload | null) => void): void;
  onPathClick(handler: (path: PathHandlerPayload) => void): void;
  onAnnotationChange(handler: (payload: AnnotationChangePayload) => void): void;
  /** 一次性批量 annotation 变更 — inferDirections / autoBindAll 类操作触发, 避免触发多次 compile. */
  onAnnotationBatch(handler: (payloads: AnnotationChangePayload[]) => void): void;
  onCleanDecisionChange(handler: (candidateId: string, action: "keep" | "remove" | "undecided", reason: string) => void): void;
  onCleanAutoClean(handler: () => void): void;

  onCleanOverrideChange(handler: (fid: string, action: "keep" | "remove" | "reset", reason?: string) => void): void;
  onCleanFilterToggle(handler: (ruleId: string, checked: boolean) => void): void;
  onCleanLevelToggle(handler: (level: string, checked: boolean) => void): void;
  onCleanSearch(handler: (query: string) => void): void;
  onCleanSelectModeToggle(handler: (active: boolean) => void): void;
  onCleanCandidateSelect(handler: (fid: string | null) => void): void;
}

export type TabKey = "clean" | "pathfinding" | "annotate" | "diagnostics" | "raw";

interface InternalState {
  container: HTMLElement;
  activeTab: TabKey;
  input: ListViewInput;
  hoverHandlers: Array<(ref: EntityRef | null) => void>;
  clickHandlers: Array<(ref: EntityRef) => void>;
  pathHoverHandlers: Array<(path: PathHandlerPayload | null) => void>;
  pathClickHandlers: Array<(path: PathHandlerPayload) => void>;
  annotationChangeHandlers: Array<(payload: AnnotationChangePayload) => void>;
  annotationBatchHandlers: Array<(payloads: AnnotationChangePayload[]) => void>;
  cleanDecisionChangeHandlers: Array<(candidateId: string, action: "keep" | "remove" | "undecided", reason: string) => void>;
  cleanAutoCleanHandlers: Array<() => void>;
  cleanOverrideChangeHandlers: Array<(fid: string, action: "keep" | "remove" | "reset", reason?: string) => void>;
  cleanFilterToggleHandlers: Array<(ruleId: string, checked: boolean) => void>;
  cleanLevelToggleHandlers: Array<(level: string, checked: boolean) => void>;
  cleanSearchHandlers: Array<(query: string) => void>;
  cleanSelectModeToggleHandlers: Array<(active: boolean) => void>;
  cleanCandidateSelectHandlers: Array<(fid: string | null) => void>;
  selectedEntity: EntityRef | null;
  selectedScenarioIdx: number | null;
  selectedCandidateIdx: number | null;
  selectedFeatureIdx: number | null;
  annotateFilter: "all" | "unannotated" | "track" | "station" | "platform" | "signal" | "entrance";
  /** Annotate tab 方向格式刷: null = off, 其他 = 点击 track 时刷该方向 */
  dirRoleBrush: TrackDirectionRole | null;
  /** Annotate tab functionalUse 格式刷: 空数组 = off, 否则点击 track 时整体替换为该集合 */
  functionalUseBrush: TrackFunctionalUse[];
  cleanFilter: "all" | "undecided" | "keep" | "remove";
}

const STYLE_ID = "mvp-list-view-styles";

const STYLES = `
.lv-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.lv-tabs { display: flex; border-bottom: 1px solid #d7dce2; flex-shrink: 0; }
.lv-tab { padding: 8px 14px; border: none; background: transparent; cursor: pointer; font: inherit; color: #475569; border-bottom: 2px solid transparent; }
.lv-tab.active { color: #0f172a; border-bottom-color: #155e75; font-weight: 600; }
.lv-body { flex: 1; overflow: auto; padding: 10px 12px; }
.lv-section { margin-bottom: 14px; }
.lv-section > h4 { margin: 0 0 6px; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.lv-item { padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 5px; margin-bottom: 4px; cursor: pointer; transition: background 80ms; font-size: 12px; }
.lv-item:hover, .lv-item.hovered { background: #fef3c7; border-color: #f59e0b; }
.lv-item.selected { background: #dbeafe; border-color: #1d4ed8; }
.lv-item strong { display: block; font-size: 12.5px; color: #0f172a; }
.lv-item .meta { color: #64748b; margin-top: 2px; font-size: 11px; }
.lv-item code { font-family: ui-monospace, monospace; font-size: 10.5px; color: #475569; }
.lv-empty { color: #94a3b8; font-style: italic; padding: 8px; }
.lv-scenario { border: 1px solid #d7dce2; border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
.lv-scenario-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; background: #f1f5f9; }
.lv-scenario-header:hover { background: #e2e8f0; }
.lv-badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 600; letter-spacing: 0.04em; }
.lv-badge.pass { background: #16a34a; color: #fff; }
.lv-badge.fail { background: #b91c1c; color: #fff; }
.lv-scenario-title { font-weight: 600; font-size: 12.5px; flex: 1; }
.lv-scenario-body { padding: 8px 10px; display: none; }
.lv-scenario.expanded .lv-scenario-body { display: block; }
.lv-scenario-desc { font-size: 11px; color: #64748b; margin: 0 0 8px; }
.lv-candidate { padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11.5px; font-family: ui-monospace, monospace; }
.lv-candidate:hover, .lv-candidate.hovered { background: #dcfce7; border-color: #16a34a; }
.lv-candidate.selected { background: #bbf7d0; border-color: #15803d; }
.lv-phase-chip { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; margin-right: 3px; font-weight: 600; }
.lv-phase-chip.up_run { background: #dbeafe; color: #1d4ed8; }
.lv-phase-chip.down_run { background: #fee2e2; color: #b91c1c; }
.lv-phase-chip.turnback { background: #ede9fe; color: #7e22ce; }
.lv-trace-list { margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
.lv-trace-entry { padding: 4px 6px; border-left: 3px solid #cbd5e1; margin-bottom: 3px; font-size: 11px; cursor: pointer; }
.lv-trace-entry:hover, .lv-trace-entry.hovered { background: #fef3c7; border-left-color: #f59e0b; }
.lv-trace-entry.stop { border-left-color: #1d4ed8; }
.lv-trace-entry.turnback { border-left-color: #7e22ce; background: #faf5ff; }
.lv-trace-entry .ord { color: #94a3b8; font-family: ui-monospace, monospace; margin-right: 4px; }
.lv-diag { padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; font-size: 11.5px; }
.lv-diag.warn { background: #fef3c7; border: 1px solid #fbbf24; }
.lv-diag.error, .lv-diag.fatal { background: #fee2e2; border: 1px solid #f87171; }
.lv-diag.info { background: #dbeafe; border: 1px solid #93c5fd; }
.lv-diag-code { font-family: ui-monospace, monospace; font-size: 10px; color: #475569; }
.lv-raw { background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
.lv-chain-list { margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
.lv-chain-header { font-size: 11px; color: #64748b; margin-bottom: 4px; display: flex; align-items: center; gap: 4px; }
.lv-chain-mode-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; letter-spacing: 0.03em; }
.lv-chain-mode-badge.strict { background: #fef2f2; color: #991b1b; }
.lv-chain-mode-badge.sketch { background: #f0f9ff; color: #0369a1; }
.lv-chain-node { padding: 4px 8px; margin: 2px 0; border-radius: 4px; font-size: 11.5px; cursor: pointer; transition: background 80ms; border-left: 3px solid #cbd5e1; }
.lv-chain-node:hover, .lv-chain-node.hovered { background: #fef3c7; border-left-color: #f59e0b; }
.lv-chain-node.origin, .lv-chain-node.terminus { background: #ecfeff; border-left-color: #0891b2; color: #155e75; font-weight: 600; }
.lv-chain-node.service_stop { background: #dcfce7; border-left-color: #16a34a; }
.lv-chain-node.reversal { background: #fef3c7; border-left-color: #d97706; }
.lv-chain-node.passage { background: #f8fafc; border-left-color: #94a3b8; color: #475569; }
.lv-chain-node.technical_stop { background: #e0e7ff; border-left-color: #4338ca; }
.lv-chain-node.operation { background: #f3e8ff; border-left-color: #7e22ce; }
.lv-chain-node .icon { display: inline-block; width: 18px; text-align: center; }
.lv-chain-segment { padding: 2px 8px 2px 24px; font-size: 10.5px; color: #94a3b8; font-style: italic; }
.lv-an-root { display: flex; height: 100%; min-height: 0; gap: 8px; }
.lv-an-list { flex: 0 0 var(--an-list-w, 38%); min-width: 150px; max-width: calc(100% - 200px); display: flex; flex-direction: column; gap: 6px; padding-right: 4px; overflow: hidden; }
.lv-an-gutter { width: 5px; cursor: col-resize; background: transparent; flex-shrink: 0; transition: background 120ms; border-radius: 2px; }
.lv-an-gutter:hover, .lv-an-gutter.dragging { background: #93c5fd; }
.lv-an-inspector { flex: 1 1 auto; min-width: 180px; overflow: auto; padding-right: 4px; padding-left: 4px; }
.lv-an-toolbar { display: flex; gap: 6px; align-items: center; font-size: 11px; flex-shrink: 0; flex-wrap: wrap; }
.lv-an-toolbar select { font-size: 11px; padding: 2px 4px; }
.lv-an-toolbar .count { color: #64748b; }
.lv-an-feature-list { flex: 1; min-height: 0; overflow: auto; }
.lv-an-feature { padding: 5px 8px; border: 1px solid #e5e7eb; border-radius: 4px; margin-bottom: 3px; cursor: pointer; font-size: 11.5px; font-family: ui-monospace, monospace; display: flex; align-items: center; gap: 6px; }
.lv-an-feature:hover, .lv-an-feature.hovered { background: #fef3c7; border-color: #f59e0b; }
.lv-an-feature.selected { background: #dbeafe; border-color: #1d4ed8; }
.lv-an-feature .geom { font-size: 13px; width: 14px; text-align: center; flex-shrink: 0; }
.lv-an-feature .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lv-an-feature .status { font-size: 9px; padding: 1px 4px; border-radius: 2px; font-weight: 600; letter-spacing: 0.04em; flex-shrink: 0; }
.lv-an-feature .status.done { background: #16a34a; color: #fff; }
.lv-an-feature .status.partial { background: #f59e0b; color: #fff; }
.lv-an-feature .status.todo { background: #94a3b8; color: #fff; }
.lv-an-inspector-empty { color: #94a3b8; font-style: italic; padding: 12px; text-align: center; }
.lv-an-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; margin-bottom: 8px; }
.lv-an-section > h5 { margin: 0; padding: 6px 10px; font-size: 11px; color: #475569; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; }
.lv-an-section.collapsed > h5::after { content: "▶"; font-size: 9px; margin-left: auto; }
.lv-an-section:not(.collapsed) > h5::after { content: "▼"; font-size: 9px; margin-left: auto; }
.lv-an-section.collapsed > .lv-an-section-body { display: none; }
.lv-an-section-body { padding: 8px 10px; }
.lv-an-tag-table { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; font-size: 11px; font-family: ui-monospace, monospace; }
.lv-an-tag-key { color: #64748b; }
.lv-an-tag-val { color: #0f172a; word-break: break-all; }
.lv-an-form { display: grid; grid-template-columns: 130px 1fr; gap: 6px 8px; font-size: 11.5px; align-items: center; }
.lv-an-form label { color: #475569; }
.lv-an-form input, .lv-an-form select { font: inherit; padding: 3px 5px; border: 1px solid #cbd5e1; border-radius: 3px; min-width: 0; width: 100%; box-sizing: border-box; }
.lv-an-form .full { grid-column: 1 / -1; }
.lv-an-form .checklist { display: flex; gap: 8px; flex-wrap: wrap; font-size: 11px; }
.lv-an-form .checklist label { color: #0f172a; display: flex; align-items: center; gap: 3px; }
.lv-an-form-section { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1; }
.lv-an-form-section h6 { margin: 0 0 6px; font-size: 11px; color: #475569; }
.lv-an-action { font: inherit; font-size: 11px; padding: 3px 8px; border: 1px solid #1d4ed8; background: #eff6ff; color: #1d4ed8; border-radius: 3px; cursor: pointer; }
.lv-an-action:hover { background: #dbeafe; }
.lv-an-brush { font: inherit; font-size: 10.5px; padding: 2px 6px; border: 1px solid #cbd5e1; background: #fff; color: #475569; border-radius: 3px; cursor: pointer; }
.lv-an-brush:hover { border-color: #64748b; }
.lv-an-brush.active { border-color: #1d4ed8; background: #dbeafe; color: #1e3a8a; font-weight: 600; }
.lv-an-brush.brush-up.active { background: #dbeafe; border-color: #1d4ed8; }
.lv-an-brush.brush-down.active { background: #fee2e2; border-color: #b91c1c; color: #7f1d1d; }
.lv-an-brush.brush-bidirectional.active { background: #ede9fe; border-color: #7e22ce; color: #581c87; }
.lv-an-brush.brush-reversible.active { background: #fef3c7; border-color: #d97706; color: #78350f; }
.lv-an-brush.brush-off.active { background: #e2e8f0; border-color: #64748b; color: #334155; }
.lv-an-brush.fn-brush.active { background: #dcfce7; border-color: #15803d; color: #14532d; }

/* Clean tab styles */
.lv-clean-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; margin-bottom: 8px; }
.lv-clean-title { font-weight: 700; font-size: 13px; color: #0f172a; }
.lv-clean-stats { font-size: 10.5px; color: #64748b; }
.lv-clean-filters { display: flex; gap: 4px; margin-bottom: 8px; }
.lv-clean-filter-btn { font-size: 10px; padding: 2px 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; border-radius: 4px; }
.lv-clean-filter-btn.active { background: #0284c7; color: #fff; border-color: #0284c7; font-weight: 600; }
.lv-clean-item { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fff; transition: all 120ms; cursor: pointer; position: relative; }
.lv-clean-item:hover, .lv-clean-item.hovered { border-color: #0284c7; background: #f8fafc; }
.lv-clean-item.keep { border-left: 4px solid #16a34a; }
.lv-clean-item.remove { border-left: 4px solid #dc2626; }
.lv-clean-item.undecided { border-left: 4px solid #94a3b8; }
.lv-clean-name-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
.lv-clean-name { font-weight: 600; font-size: 12px; color: #0f172a; }
.lv-clean-level-badge { font-size: 9px; padding: 1px 4px; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
.lv-clean-level-badge.high { background: #d1fae5; color: #065f46; }
.lv-clean-level-badge.medium { background: #fef3c7; color: #78350f; }
.lv-clean-level-badge.low { background: #fee2e2; color: #991b1b; }
.lv-clean-level-badge.all { background: #f1f5f9; color: #475569; }
.lv-clean-meta-grid { display: grid; grid-template-columns: 1fr; gap: 2px; font-size: 10.5px; color: #64748b; margin-bottom: 6px; }
.lv-clean-meta-item span { color: #334155; }
.lv-clean-btn-group { display: flex; gap: 4px; margin-bottom: 6px; }
.lv-clean-decision-btn { font-size: 10px; padding: 3px 8px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; font-weight: 500; }
.lv-clean-decision-btn.keep.active { background: #16a34a; color: #fff; border-color: #16a34a; font-weight: 600; }
.lv-clean-decision-btn.remove.active { background: #dc2626; color: #fff; border-color: #dc2626; font-weight: 600; }
.lv-clean-reason-box { display: flex; gap: 4px; align-items: center; width: 100%; }
.lv-clean-reason-input { flex: 1; min-width: 0; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 6px; font-size: 11px; color: #0f172a; background: #fff; }

/* Custom clean override styles */
.lv-clean-act-btn { font-size: 10px; padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; background: #fff; color: #0f172a; font-weight: 500; transition: all 100ms; }
.lv-clean-act-btn:hover { background: #f1f5f9; }
.lv-clean-act-btn.keep.active { background: #16a34a !important; color: #fff !important; border-color: #16a34a !important; }
.lv-clean-act-btn.remove.active { background: #dc2626 !important; color: #fff !important; border-color: #dc2626 !important; }
.lv-clean-selmode-btn { transition: all 120ms; }
.lv-clean-selmode-btn.active { background: #2563eb !important; color: #fff !important; border-color: #2563eb !important; }
.lv-clean-item-card { transition: all 120ms; }
.lv-clean-item-card:hover { border-color: #2563eb !important; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
.lv-clean-inspector table td { font-size: 10px; border-bottom: 1px solid #f1f5f9; }
.lv-clean-inspector table tr:hover { background: #f8fafc; }

`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// ── Factory ─────────────────────────────────────────────────

export function createListView(container: HTMLElement): ListView {
  ensureStyles();
  container.classList.add("lv-root");
  container.innerHTML = `
    <div class="lv-tabs">
      <button class="lv-tab active" data-tab="annotate">Annotate</button>
      <button class="lv-tab" data-tab="clean" style="display:none;">Clean</button>
      <button class="lv-tab" data-tab="pathfinding">Pathfinding</button>
      <button class="lv-tab" data-tab="diagnostics">Diagnostics</button>
      <button class="lv-tab" data-tab="raw">Raw JSON</button>
    </div>
    <div class="lv-body" data-body="annotate"></div>
    <div class="lv-body" data-body="clean" hidden></div>
    <div class="lv-body" data-body="pathfinding" hidden></div>
    <div class="lv-body" data-body="diagnostics" hidden></div>
    <div class="lv-body" data-body="raw" hidden></div>
  `;

  const state: InternalState = {
    container,
    activeTab: "annotate",
    input: { topo: null, diagnostics: [] },
    hoverHandlers: [],
    clickHandlers: [],
    pathHoverHandlers: [],
    pathClickHandlers: [],
    annotationChangeHandlers: [],
    annotationBatchHandlers: [],
    cleanDecisionChangeHandlers: [],
    cleanAutoCleanHandlers: [],
    cleanOverrideChangeHandlers: [],
    cleanFilterToggleHandlers: [],
    cleanLevelToggleHandlers: [],
    cleanSearchHandlers: [],
    cleanSelectModeToggleHandlers: [],
    cleanCandidateSelectHandlers: [],
    selectedEntity: null,
    selectedScenarioIdx: null,
    selectedCandidateIdx: null,
    selectedFeatureIdx: null,
    annotateFilter: "all",
    dirRoleBrush: null,
    functionalUseBrush: [],
    cleanFilter: "all",
  };

  bindTabClicks(state);

  return {
    update(input) {
      if (input.activeTab && input.activeTab !== state.activeTab) {
        switchTab(state, input.activeTab);
      }
      state.input = input;
      // Show or hide Clean tab dynamically
      const cleanBtn = container.querySelector<HTMLButtonElement>('.lv-tab[data-tab="clean"]');
      if (cleanBtn) {
        cleanBtn.style.display = input.source ? "" : "none";
      }
      renderActiveTab(state);
    },
    highlightEntity(ref) {
      applyEntityHover(state, ref);
    },
    selectFeatureByRef(ref) {
      if (state.activeTab === "clean") {
        return;
      }
      const idx = findFeatureIdxByRef(state, ref);
      if (idx == null) return;
      // brush 激活 + track feature → 仅刷方向, 不切 tab/不改 selected
      if (applyDirRoleBrushIfActive(state, idx)) return;
      state.selectedFeatureIdx = idx;
      switchTab(state, "annotate");
    },
    onEntityHover(h) { state.hoverHandlers.push(h); },
    onEntityClick(h) { state.clickHandlers.push(h); },
    onPathHover(h) { state.pathHoverHandlers.push(h); },
    onPathClick(h) { state.pathClickHandlers.push(h); },
    onAnnotationChange(h) { state.annotationChangeHandlers.push(h); },
    onAnnotationBatch(h) { state.annotationBatchHandlers.push(h); },
    onCleanDecisionChange(h) { state.cleanDecisionChangeHandlers.push(h); },
    onCleanAutoClean(h) { state.cleanAutoCleanHandlers.push(h); },
    onCleanOverrideChange(h) { state.cleanOverrideChangeHandlers.push(h); },
    onCleanFilterToggle(h) { state.cleanFilterToggleHandlers.push(h); },
    onCleanLevelToggle(h) { state.cleanLevelToggleHandlers.push(h); },
    onCleanSearch(h) { state.cleanSearchHandlers.push(h); },
    onCleanSelectModeToggle(h) { state.cleanSelectModeToggleHandlers.push(h); },
    onCleanCandidateSelect(h) { state.cleanCandidateSelectHandlers.push(h); },
  };
}

// ── Tabs ────────────────────────────────────────────────────

function bindTabClicks(state: InternalState): void {
  state.container.querySelectorAll<HTMLButtonElement>(".lv-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as TabKey;
      switchTab(state, tab);
    });
  });
}

function switchTab(state: InternalState, tab: TabKey): void {
  state.activeTab = tab;
  state.container.querySelectorAll<HTMLButtonElement>(".lv-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  state.container.querySelectorAll<HTMLElement>(".lv-body").forEach((body) => {
    body.hidden = body.dataset.body !== tab;
  });
  renderActiveTab(state);
}

function renderActiveTab(state: InternalState): void {
  switch (state.activeTab) {
    case "clean": renderCleanTab(state); break;
    case "pathfinding": renderPathfindingTab(state); break;
    case "annotate": renderAnnotateTab(state); break;
    case "diagnostics": renderDiagnosticsTab(state); break;
    case "raw": renderRawTab(state); break;
  }
}

function renderCleanTab(state: InternalState): void {
  const body = bodyEl(state, "clean");
  const { source, cleanOverrides, filterRules, activeFilters, activeLevels, searchQuery, selectMode, selectedCandidateFid, cleanPassFids } = state.input;

  if (!source) {
    body.innerHTML = `<div class="lv-empty">No source candidates loaded. Select a Company and Line in Left panel "Prepare" or "Clean" step and load the workspace source.</div>`;
    return;
  }

  const allFeatures = source.features || [];
  const keepSet = new Set(cleanOverrides?.keep || []);
  const removeSet = new Set(cleanOverrides?.remove || []);
  const overrideMeta = cleanOverrides?.meta || {};

  // Count keeps / removes on this specific source line
  const localKeepCount = allFeatures.filter(f => {
    const props = f.properties || {};
    const fid = `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
    return keepSet.has(fid);
  }).length;

  const localRemoveCount = allFeatures.filter(f => {
    const props = f.properties || {};
    const fid = `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
    return removeSet.has(fid);
  }).length;

  const levels = activeLevels || { high: true, medium: true, low: true };
  const filters = activeFilters || {};
  const rules = filterRules || [];
  const query = searchQuery || "";
  const isSelectMode = !!selectMode;

  // 按 match_level 统计 4 档计数(供 head panel 显示)
  const levelCounts = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const f of allFeatures) {
    const lv = ((f.properties || {}) as any).match_level;
    if (lv === "high") levelCounts.high += 1;
    else if (lv === "medium") levelCounts.medium += 1;
    else if (lv === "low") levelCounts.low += 1;
    else levelCounts.unknown += 1;
  }

  // Contract: caller (app.ts refreshViews) 必传 cleanPassFids; 没传就显示提示而不是回退跑自己的 filter
  // (跨阶段 rule 在 list-view 内算不出正确结果, 故不再保留 fallback).
  const filteredCandidates = cleanPassFids
    ? allFeatures.filter(f => {
        const props = f.properties || {};
        const fid = (props as any)._fid
          || `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
        return cleanPassFids.has(fid);
      })
    : [];

  const selectedCandidate = selectedCandidateFid
    ? allFeatures.find(f => {
        const props = f.properties || {};
        const fid = `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
        return fid === selectedCandidateFid;
      })
    : null;

  const reportBlock = renderPipelineReportHtml(state.input.cleanPipelineReport);

  body.innerHTML = `
    <div class="lv-clean-container" style="display:flex; flex-direction:column; height:100%; min-height:0; gap:8px;">
      <!-- Head Panel -->
      <div class="lv-clean-head-panel" style="display:flex; flex-direction:column; gap:6px; border-bottom:1px solid #cbd5e1; padding-bottom:8px; flex-shrink:0;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; font-size:13px; color:#0f172a;">Manual Cleaning Override</span>
          <span class="lv-clean-stats" style="font-size:10.5px; color:#64748b; font-weight:600;">
            Keep: <span style="color:#16a34a;">${localKeepCount}</span> | Remove: <span style="color:#dc2626;">${localRemoveCount}</span> (Total: ${allFeatures.length})
          </span>
        </div>

        <!-- Confidence levels checkboxes -->
        <div style="display:flex; gap:10px; font-size:10.5px; align-items:center; flex-wrap:wrap;">
          <span style="color:#64748b; font-weight:600;">Confidence Levels:</span>
          <label style="display:flex; align-items:center; gap:2px; cursor:pointer;"><input type="checkbox" class="lv-clean-lvl-chk" data-level="high" ${levels.high ? "checked" : ""}/> High <span style="color:#0a6b2b;">(${levelCounts.high})</span></label>
          <label style="display:flex; align-items:center; gap:2px; cursor:pointer;"><input type="checkbox" class="lv-clean-lvl-chk" data-level="medium" ${levels.medium ? "checked" : ""}/> Med <span style="color:#946200;">(${levelCounts.medium})</span></label>
          <label style="display:flex; align-items:center; gap:2px; cursor:pointer;"><input type="checkbox" class="lv-clean-lvl-chk" data-level="low" ${levels.low ? "checked" : ""}/> Low <span style="color:#8a1212;">(${levelCounts.low})</span></label>
          ${levelCounts.unknown > 0 ? `<span style="color:#94a3b8;">unset: ${levelCounts.unknown}</span>` : ""}
        </div>

        ${reportBlock}

        <!-- Search box & Select mode -->
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="text" class="lv-clean-search" placeholder="Search by name, ID or station..." value="${escapeAttr(query)}" style="flex:1; font-size:11px; padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; height:24px;" />
          <button class="lv-clean-selmode-btn ${isSelectMode ? "active" : ""}" style="font-size:11px; padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; font-weight:600; display:flex; align-items:center; justify-content:center; height:24px; gap:2px;">
            ✏️ Select Mode
          </button>
        </div>
      </div>

      <!-- Filter rules panel -->
      <div class="lv-clean-rules-panel" style="display:flex; flex-direction:column; gap:4px; border-bottom:1px solid #cbd5e1; padding-bottom:8px; max-height:85px; overflow-y:auto; flex-shrink:0;">
        <div style="font-size:11px; font-weight:600; color:#64748b; margin-bottom:1px;">Dynamic Filter Rules:</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:10.5px;">
          ${rules.map(rule => `
            <label title="${escapeAttr(rule.desc || '')}" style="display:flex; align-items:center; gap:4px; cursor:pointer; min-width:0;">
              <input type="checkbox" class="lv-clean-rule-chk" data-rule-id="${escapeAttr(rule.id)}" ${filters[rule.id] ? "checked" : ""}/>
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(rule.label)}</span>
            </label>
          `).join("")}
        </div>
      </div>

      <!-- Candidates list (Scrollable) -->
      <div class="lv-clean-list-container" style="flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:2px;">
        ${filteredCandidates.length === 0 ? `
          <div class="lv-empty">No candidates match filters.</div>
        ` : filteredCandidates.map(c => {
            const props = (c.properties || {}) as any;
            const fid = `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
            const isRemove = removeSet.has(fid);
            const isKeep = keepSet.has(fid);
            const meta = (overrideMeta as Record<string, any>)[fid] || {};
            const reason = meta.reason || "";
            const isSelected = selectedCandidateFid === fid;

            let borderStyle = "border-left: 4px solid #cbd5e1;";
            let bgStyle = "background:#fff;";
            let textDecoration = "";
            if (isRemove) {
              borderStyle = "border-left: 4px solid #dc2626;";
              bgStyle = "background:#fef2f2; opacity:0.75;";
              textDecoration = "text-decoration: line-through; color:#94a3b8;";
            } else if (isKeep) {
              borderStyle = "border-left: 4px solid #16a34a;";
              bgStyle = "background:#f0fdf4;";
            }
            if (isSelected) {
              bgStyle = "background:#eff6ff; border-color:#3b82f6;";
            }

            return `
              <div class="lv-clean-item-card" data-fid="${escapeAttr(fid)}" style="border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; font-size:11px; transition:all 100ms; ${borderStyle} ${bgStyle}">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                  <span style="font-weight:600; ${textDecoration}">${escapeHtml(props.name || props.osm_id || "unnamed")}</span>
                  <span class="lv-clean-level-badge ${props.match_level || 'low'}">
                    ${props.match_level || 'low'} (${(props.match_score || 0).toFixed(2)})
                  </span>
                </div>
                <div style="font-size:10px; color:#64748b; margin-bottom:4px; display:grid; grid-template-columns:1fr; gap:1px;">
                  <div>Class: <b style="color:#475569;">${escapeHtml(props.class_main || "—")}</b> · Osm: <span>${escapeHtml(props.osm_type || "—")}/${escapeHtml(props.osm_id || "—")}</span></div>
                  <div>Station: <span>${escapeHtml(props.nearest_station || "—")}</span></div>
                </div>
                <!-- Action buttons -->
                <div style="display:flex; gap:4px; align-items:center; margin-top:4px;">
                  <button class="lv-clean-act-btn keep ${isKeep ? 'active' : ''}" data-fid="${escapeAttr(fid)}" data-action="keep">Keep</button>
                  <button class="lv-clean-act-btn remove ${isRemove ? 'active' : ''}" data-fid="${escapeAttr(fid)}" data-action="remove">Remove</button>
                  <button class="lv-clean-act-btn reset" data-fid="${escapeAttr(fid)}" data-action="reset">Reset</button>
                  <input type="text" class="lv-clean-reason-input" data-fid="${escapeAttr(fid)}" placeholder="Reason/Justification..." value="${escapeAttr(reason)}" style="flex:1; min-width:0; font-size:10px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; height:18px;" />
                </div>
              </div>
            `;
          }).join("")}
      </div>

      <!-- Properties Inspector Table -->
      <div class="lv-clean-inspector" style="border-top:1px solid #cbd5e1; padding-top:6px; display:flex; flex-direction:column; gap:4px; max-height:165px; overflow-y:auto; flex-shrink:0; font-size:10.5px;">
        <div style="font-weight:700; color:#334155;">Candidate Properties Inspector</div>
        ${selectedCandidate ? renderInspectorTable(selectedCandidate) : `<div class="lv-empty" style="padding:4px 0;">Select a candidate in list or map to view properties.</div>`}
      </div>
    </div>
  `;

  bindCleanTabEvents(state, body);

  if (selectedCandidateFid) {
    const card = body.querySelector<HTMLElement>(`.lv-clean-item-card[data-fid="${cssEscape(selectedCandidateFid)}"]`);
    if (card) {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
}

function bindCleanTabEvents(state: InternalState, body: HTMLElement): void {
  // Confidence level checkboxes
  body.querySelectorAll<HTMLInputElement>(".lv-clean-lvl-chk").forEach(chk => {
    chk.addEventListener("change", () => {
      const level = chk.dataset.level!;
      state.cleanLevelToggleHandlers.forEach(h => h(level, chk.checked));
    });
  });

  // Filter rule checkboxes
  body.querySelectorAll<HTMLInputElement>(".lv-clean-rule-chk").forEach(chk => {
    chk.addEventListener("change", () => {
      const rid = chk.dataset.ruleId!;
      state.cleanFilterToggleHandlers.forEach(h => h(rid, chk.checked));
    });
  });

  // Search input
  const searchBox = body.querySelector<HTMLInputElement>(".lv-clean-search");
  if (searchBox) {
    searchBox.addEventListener("input", () => {
      state.cleanSearchHandlers.forEach(h => h(searchBox.value));
    });
  }

  // Select Mode toggle
  const selmodeBtn = body.querySelector<HTMLButtonElement>(".lv-clean-selmode-btn");
  if (selmodeBtn) {
    selmodeBtn.addEventListener("click", () => {
      state.cleanSelectModeToggleHandlers.forEach(h => h(!state.input.selectMode));
    });
  }

  // Candidate items event triggers
  body.querySelectorAll<HTMLElement>(".lv-clean-item-card").forEach(card => {
    const fid = card.dataset.fid!;

    // mouse hover link to map view highlights
    card.addEventListener("mouseenter", () => {
      state.hoverHandlers.forEach(h => h(fid as EntityRef));
    });
    card.addEventListener("mouseleave", () => {
      state.hoverHandlers.forEach(h => h(null));
    });

    // select card triggers selection
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button, input")) return;
      state.cleanCandidateSelectHandlers.forEach(h => h(fid));
    });

    // Buttons Keep/Remove/Reset
    card.querySelectorAll<HTMLButtonElement>(".lv-clean-act-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = btn.dataset.action as "keep" | "remove" | "reset";
        const reasonInput = card.querySelector<HTMLInputElement>(".lv-clean-reason-input");
        const reason = reasonInput ? reasonInput.value : "";
        state.cleanOverrideChangeHandlers.forEach(h => h(fid, action, reason));
      });
    });

    // Reason input changes
    const reasonInput = card.querySelector<HTMLInputElement>(".lv-clean-reason-input");
    if (reasonInput) {
      reasonInput.addEventListener("change", () => {
        // auto fallback to keep/remove if entered reason
        const isRemove = card.querySelector(".lv-clean-act-btn.remove")?.classList.contains("active");
        const action = isRemove ? "remove" : "keep";
        state.cleanOverrideChangeHandlers.forEach(h => h(fid, action, reasonInput.value));
      });
    }
  });
}

// (featurePassesFilters / approxLength / pointToSegmentMeters / pointToPolylineMeters / isConnectedToAny
//  原在此处, 已删除 — app.ts 的 runFilterPipeline + rule-handlers + spatial-helpers 接管。)

function renderPipelineReportHtml(report: PipelineReport | undefined): string {
  if (!report || report.phaseReports.length === 0) return "";
  const ruleRows: string[] = [];
  for (const phase of report.phaseReports) {
    for (const r of phase.rules) {
      const label = r.ruleLabel ? `${r.ruleId} <span style="color:#94a3b8;">(${escapeHtml(r.ruleLabel)})</span>` : r.ruleId;
      const eliminated = r.eliminated;
      const color = eliminated > 0 ? "#dc2626" : "#16a34a";
      ruleRows.push(
        `<div style="display:flex; justify-content:space-between; gap:8px; padding:1px 0;">`
        + `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">P${phase.phase} · ${label}</span>`
        + `<span style="color:${color}; flex-shrink:0;">−${eliminated} <span style="color:#94a3b8;">(剩 ${r.outSize})</span> ref=${r.refSize} ${r.ms.toFixed(1)}ms</span>`
        + `</div>`,
      );
    }
  }
  const summary = `Pipeline: ${report.totalIn} → ${report.totalOut} (${report.totalMs.toFixed(1)}ms)`;
  return `
    <details style="font-size:10.5px;">
      <summary style="cursor:pointer; color:#475569; user-select:none;">▶ ${escapeHtml(summary)}</summary>
      <div style="margin-top:4px; padding:6px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; max-height:160px; overflow-y:auto;">
        ${ruleRows.join("") || '<div style="color:#94a3b8;">(no rules active)</div>'}
      </div>
    </details>
  `;
}

function renderInspectorTable(feature: any): string {
  const p = feature.properties || {};
  const geom = feature.geometry || {};
  
  const categories = [
    {
      name: "Basic",
      keys: ["osm_type", "osm_id", "class_main", "class_sub", "railway", "name", "name:ja", "name:en"]
    },
    {
      name: "Match",
      keys: ["match_score", "match_level", "reason_codes", "distance_to_ref", "nearest_station", "nearest_station_distance", "overlap_ratio", "in_bbox", "in_buffer"]
    },
    {
      name: "Infrastructure",
      keys: ["gauge", "usage", "tunnel", "bridge", "layer", "level", "tracks"]
    },
    {
      name: "Electrification",
      keys: ["electrified", "voltage", "frequency"]
    },
    {
      name: "Train Protection",
      keys: ["train_protection", "safety_system"]
    },
    {
      name: "Operator",
      keys: ["operator", "source_company", "owner"]
    },
    {
      name: "Platform",
      keys: ["length", "width", "platform_edge", "height"]
    },
    {
      name: "Signal",
      keys: ["signal:type", "signal:direction", "signal:position"]
    },
    {
      name: "References",
      keys: ["wikidata", "wikipedia", "KSJ2:LIN", "source_line_uri"]
    }
  ];

  let html = `<table style="width:100%; border-collapse:collapse; text-align:left; font-size:10px;">`;
  
  if (geom.coordinates) {
    let geomVal = "";
    if (geom.type === "Point") {
      geomVal = `Point (${geom.coordinates[0].toFixed(6)}, ${geom.coordinates[1].toFixed(6)})`;
    } else if (geom.type === "LineString") {
      const len = polylineLengthMeters(geom.coordinates);
      geomVal = `LineString (${geom.coordinates.length} pts, ~${len.toFixed(0)}m)`;
    } else {
      geomVal = `${geom.type}`;
    }
    html += `
      <tr style="background:#f1f5f9; font-weight:600;"><td colspan="2" style="padding:2px 4px; border-bottom:1px solid #e2e8f0; color:#475569;">Geometry</td></tr>
      <tr>
        <td style="padding:2px 4px; color:#64748b; width:40%;">type</td>
        <td style="padding:2px 4px; color:#0f172a; word-break:break-all;">${escapeHtml(geom.type)}</td>
      </tr>
      <tr>
        <td style="padding:2px 4px; color:#64748b; width:40%;">info</td>
        <td style="padding:2px 4px; color:#0f172a; word-break:break-all;">${escapeHtml(geomVal)}</td>
      </tr>
    `;
  }

  for (const cat of categories) {
    const presentKeys = cat.keys.filter(k => p[k] !== undefined && p[k] !== null && p[k] !== "");
    if (presentKeys.length === 0) continue;

    html += `<tr style="background:#f1f5f9; font-weight:600;"><td colspan="2" style="padding:2px 4px; border-bottom:1px solid #e2e8f0; color:#475569;">${cat.name}</td></tr>`;
    for (const k of presentKeys) {
      let val = p[k];
      if (typeof val === "number") {
        if (k.includes("score") || k.includes("ratio") || k.includes("distance")) {
          val = val.toFixed(4);
        }
      }
      html += `
        <tr>
          <td style="padding:2px 4px; color:#64748b; width:40%;">${escapeHtml(k)}</td>
          <td style="padding:2px 4px; color:#0f172a; word-break:break-all;">${escapeHtml(String(val))}</td>
        </tr>
      `;
    }
  }
  
  html += `</table>`;
  return html;
}



// ── Pathfinding tab ─────────────────────────────────────────

function renderPathfindingTab(state: InternalState): void {
  const body = bodyEl(state, "pathfinding");
  const results = state.input.pathfindingResults;
  if (!results || results.length === 0) {
    body.innerHTML = `<div class="lv-empty">No pathfinding scenarios run yet. Press "Pathfinding 4 场景" demo.</div>`;
    return;
  }
  body.innerHTML = results.map((r, idx) => scenarioCard(r, idx, state)).join("");
  bindScenarioEvents(state);
}

function scenarioCard(r: ScenarioResult | SensekiScenarioResult, idx: number, state: InternalState): string {
  const isExpanded = state.selectedScenarioIdx === idx;
  return `<div class="lv-scenario ${isExpanded ? "expanded" : ""}" data-scenario-idx="${idx}">
    <div class="lv-scenario-header">
      <span class="lv-badge ${r.passed ? "pass" : "fail"}">${r.passed ? "PASS" : "FAIL"}</span>
      <span class="lv-scenario-title">${escapeHtml(r.scenario.name)}</span>
      <span style="font-size:11px;color:#64748b">${r.candidates.length} candidates</span>
    </div>
    <div class="lv-scenario-body">
      <p class="lv-scenario-desc">${escapeHtml(r.scenario.description)}</p>
      ${r.reason ? `<div class="lv-diag warn" style="margin-bottom:8px">${escapeHtml(r.reason)}</div>` : ""}
      ${r.candidates.length === 0 ? `<div class="lv-empty">No candidates.</div>` : r.candidates.map((c, ci) => candidateItem(c, idx, ci, state)).join("")}
    </div>
  </div>`;
}

function candidateItem(c: PathfindingResult, scenarioIdx: number, candidateIdx: number, state: InternalState): string {
  const isSelected = state.selectedScenarioIdx === scenarioIdx && state.selectedCandidateIdx === candidateIdx;
  const phaseSummary = c.phases.map((p) => `<span class="lv-phase-chip ${p.kind}">${p.kind}</span>`).join("");
  const sidingBadge = c.startKind === "siding"
    ? `<span class="lv-phase-chip" style="background:#fff7ed;color:#c2410c">siding-start</span> ` : "";
  return `<div class="lv-candidate ${isSelected ? "selected" : ""}" data-scenario-idx="${scenarioIdx}" data-candidate-idx="${candidateIdx}">
    <div>[${candidateIdx}] ${sidingBadge}${Math.round(c.totalDistanceMeters)}m · ${c.edgeSequence.length} edges</div>
    <div style="margin-top:3px">${phaseSummary}</div>
    ${isSelected ? renderCandidateDetail(c) : ""}
  </div>`;
}

function renderCandidateDetail(c: PathfindingResult): string {
  if (c.resolvedChain) {
    return renderChainNodes(c.resolvedChain);
  }
  return renderTraceList(c.traceSequence);
}

function renderChainNodes(resolved: ResolvedChain): string {
  const modeBadge = `<span class="lv-chain-mode-badge ${resolved.mode}">${resolved.mode}</span>`;
  const parts: string[] = [];
  parts.push(`<div class="lv-chain-header">chain ${modeBadge}<span style="color:#94a3b8">· ${resolved.nodes.length} nodes · ${resolved.segments.length} segments</span></div>`);
  for (let i = 0; i < resolved.nodes.length; i += 1) {
    parts.push(chainNodeItem(resolved.nodes[i]));
    if (i < resolved.nodes.length - 1) {
      const seg = resolved.segments.find((s) => s.fromNodeIndex === i && s.toNodeIndex === i + 1);
      if (seg && seg.edges.length > 0) {
        parts.push(chainSegmentItem(seg));
      }
    }
  }
  return `<div class="lv-chain-list">${parts.join("")}</div>`;
}

function chainNodeItem(node: ResolvedIntentionNode): string {
  const icon = chainNodeIcon(node.kind);
  const label = chainNodeLabel(node);
  const ref = node.resolvedPlatformRef ?? node.resolvedEdgeRef ?? node.resolvedStationRef ?? "";
  const alsoRef = node.resolvedEdgeRef && node.resolvedEdgeRef !== ref ? node.resolvedEdgeRef : "";
  return `<div class="lv-chain-node ${node.kind}" data-ref="${escapeAttr(ref)}" data-also-ref="${escapeAttr(alsoRef)}">
    <span class="icon">${icon}</span>
    <strong>${node.kind}</strong>
    <span style="color:#64748b"> ${label}</span>
  </div>`;
}

function chainSegmentItem(seg: RunningSegment): string {
  const passageLabel = seg.passages.length > 0 ? ` · passes ${seg.passages.length}` : "";
  return `<div class="lv-chain-segment">↓ running ${seg.direction} · ${seg.edges.length} edges · ${Math.round(seg.distanceMeters)}m${passageLabel}</div>`;
}

function chainNodeIcon(kind: ResolvedIntentionNode["kind"]): string {
  switch (kind) {
    case "origin": return "🚉";
    case "terminus": return "🏁";
    case "service_stop": return "●";
    case "passage": return "→";
    case "reversal": return "↺";
    case "technical_stop": return "⏸";
    case "operation": return "🔧";
    default: return "";
  }
}

function chainNodeLabel(node: ResolvedIntentionNode): string {
  switch (node.kind) {
    case "origin":
      return chainEndpointLabel(node.at) + ` (dir=${node.direction})`;
    case "terminus":
      return chainEndpointLabel(node.at);
    case "service_stop":
      return `${shortId(node.at)} (${node.boarding})`;
    case "passage":
      return `${node.throughKind}=${shortId(node.through)}`;
    case "reversal":
      return node.at ? `at ${shortId(node.at)}` : "(any reversible edge)";
    case "technical_stop":
      return `${shortId(node.at)}@${node.measure}`;
    case "operation":
      return `${shortId(node.at)} · ${node.opKind}`;
    default:
      return "";
  }
}

function chainEndpointLabel(at: { nodeRef: EntityRef } | { edgeRef: EntityRef; measure: 0 | 1 }): string {
  if ("nodeRef" in at) return shortId(at.nodeRef);
  return `${shortId(at.edgeRef)}@${at.measure}`;
}

function renderTraceList(trace: ServiceTraceEntry[]): string {
  return `<div class="lv-trace-list">
    ${trace.map(traceEntryItem).join("")}
  </div>`;
}

function traceEntryItem(entry: ServiceTraceEntry): string {
  if (entry.passageType === "stop") {
    const stop = entry as ServiceStopEntry;
    const isTurnback = stop.operationType === "turnback";
    return `<div class="lv-trace-entry ${isTurnback ? "turnback" : "stop"}" data-ref="${escapeAttr(stop.edgeRef)}" data-also-ref="${escapeAttr(stop.platformRef)}">
      <span class="ord">#${stop.orderIndex}</span>
      <strong>${isTurnback ? "↺ turnback" : "● stop"}</strong>
      ${stop.platformName ? ` @ ${escapeHtml(stop.platformName)}` : ""}
      <span style="color:#64748b"> · ${shortId(stop.stationRef)} · ${shortId(stop.edgeRef)} · m=${stop.measure}</span>
    </div>`;
  }
  const pass = entry as ServicePassEntry;
  return `<div class="lv-trace-entry" data-ref="${escapeAttr(pass.edgeRef)}" data-also-ref="${escapeAttr(pass.platformRef ?? "")}">
    <span class="ord">#${pass.orderIndex}</span>
    <strong>→ pass</strong>
    <span style="color:#64748b"> · ${shortId(pass.stationRef)} · ${shortId(pass.edgeRef)}</span>
  </div>`;
}

// ── Diagnostics tab ─────────────────────────────────────────

function renderDiagnosticsTab(state: InternalState): void {
  const body = bodyEl(state, "diagnostics");
  const diags = state.input.diagnostics;
  if (diags.length === 0) {
    body.innerHTML = `<div class="lv-empty">No diagnostics.</div>`;
    return;
  }
  const grouped: Record<string, Diagnostic[]> = { fatal: [], error: [], warn: [], info: [] };
  for (const d of diags) grouped[d.level]?.push(d);
  body.innerHTML = (["fatal", "error", "warn", "info"] as const)
    .filter((lvl) => grouped[lvl].length > 0)
    .map((lvl) => `<section class="lv-section">
      <h4>${lvl} (${grouped[lvl].length})</h4>
      ${grouped[lvl].map((d) => `<div class="lv-diag ${d.level}">
        <div class="lv-diag-code">${escapeHtml(d.code)} · stage: ${escapeHtml(d.stage)}</div>
        <div>${escapeHtml(d.message)}</div>
        ${d.context ? `<div style="margin-top:2px;font-size:10.5px;color:#64748b">${escapeHtml(JSON.stringify(d.context))}</div>` : ""}
      </div>`).join("")}
    </section>`).join("");
}

// ── Raw JSON tab ────────────────────────────────────────────

function renderRawTab(state: InternalState): void {
  const body = bodyEl(state, "raw");
  const snapshot = {
    topo: state.input.topo,
    diagnostics: state.input.diagnostics,
    pathfindingResults: state.input.pathfindingResults?.map((r) => ({
      name: r.scenario.name,
      passed: r.passed,
      reason: r.reason,
      candidatesCount: r.candidates.length,
      best: r.best ? {
        totalDistanceMeters: r.best.totalDistanceMeters,
        startKind: r.best.startKind,
        edgeSequence: r.best.edgeSequence,
        turnbackEdgeIndices: r.best.turnbackEdgeIndices,
        phases: r.best.phases,
        traceSequence: r.best.traceSequence,
        resolvedChain: r.best.resolvedChain,
        phaseSequence: r.best.phaseSequence,
      } : null,
    })),
  };
  body.innerHTML = `<pre class="lv-raw">${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>`;
}

// ── Annotate tab ────────────────────────────────────────────

const FILTER_OPTIONS: ReadonlyArray<{ key: InternalState["annotateFilter"]; label: string }> = [
  { key: "all", label: "All" },
  { key: "unannotated", label: "Unannotated" },
  { key: "track", label: "Tracks" },
  { key: "station", label: "Stations" },
  { key: "platform", label: "Platforms" },
  { key: "signal", label: "Signals" },
  { key: "entrance", label: "Entrances" },
];

const KIND_OPTIONS: ReadonlyArray<RailGraphFeatureKind> = [
  "unknown", "track_geometry", "station_point", "platform_area", "signal_point", "station_entrance", "switch_point", "special_section",
];

const PHYSICAL_KIND_OPTIONS: ReadonlyArray<TrackPhysicalKind> = ["main", "siding", "yard", "lead", "safety"];
const DIRECTION_ROLE_OPTIONS: ReadonlyArray<TrackDirectionRole> = ["up", "down", "bidirectional", "reversible"];
const FUNCTIONAL_USE_OPTIONS: ReadonlyArray<TrackFunctionalUse> = ["through", "stopping", "passing", "turnback", "storage"];
const EDGE_ROLE_OPTIONS: ReadonlyArray<TopologyEdgeRole> = ["main", "platform", "passing", "connector", "storage", "yard"];
const TRAVERSAL_OPTIONS: ReadonlyArray<TraversalDirection> = ["both", "forward"];
const PLATFORM_TYPE_OPTIONS: ReadonlyArray<PlatformType> = ["island", "side", "bay", "unknown"];

function renderAnnotateTab(state: InternalState): void {
  const body = bodyEl(state, "annotate");
  const features = state.input.source?.features ?? [];
  if (features.length === 0) {
    body.innerHTML = `<div class="lv-empty">No features loaded. Use the "Import" or "Sample" buttons to load a GeoJSON source.</div>`;
    return;
  }

  const filtered = features
    .map((f, idx) => ({ f, idx }))
    .filter(({ f }) => featureMatchesFilter(f, state.annotateFilter));

  // 收集 station options (LOD 32 + 任何手动改成 station_point 的)
  const stationOptions: StationOption[] = features
    .map((f) => f.properties.railGraph)
    .filter((ann): ann is RailGraphAnnotation => !!ann && ann.kind === "station_point")
    .map((ann) => ({ id: ann.id, name: ann.station?.name ?? ann.id }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const filterOpts = FILTER_OPTIONS.map((o) => `<option value="${o.key}" ${o.key === state.annotateFilter ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
  const listHtml = filtered.length === 0
    ? `<div class="lv-empty" style="padding:8px">No features match this filter.</div>`
    : filtered.map(({ f, idx }) => annotateFeatureItem(f, idx, state.selectedFeatureIdx === idx, state.input.topo)).join("");

  const selectedFeature = state.selectedFeatureIdx != null ? features[state.selectedFeatureIdx] : null;
  const inspectorHtml = selectedFeature
    ? annotateInspectorHtml(selectedFeature, stationOptions)
    : `<div class="lv-an-inspector-empty">Select a feature on the left to inspect / annotate.</div>`;

  // directionRole 笔刷 (5 选 1)
  const brushBtns = DIRECTION_ROLE_OPTIONS.map((r) => {
    const active = state.dirRoleBrush === r ? "active" : "";
    return `<button class="lv-an-brush ${active} brush-${r}" data-brush="${r}" type="button" title="刷 directionRole=${r}">${r}</button>`;
  }).join("");
  const brushOffActive = state.dirRoleBrush === null ? "active" : "";
  const brushBtnsHtml = `${brushBtns}<button class="lv-an-brush ${brushOffActive} brush-off" data-brush="" type="button" title="关闭格式刷">off</button>`;

  // functionalUse 笔刷 (5 选多)
  const fnBrushBtns = FUNCTIONAL_USE_OPTIONS.map((u) => {
    const active = state.functionalUseBrush.includes(u) ? "active" : "";
    return `<button class="lv-an-brush fn-brush ${active}" data-fn-brush="${u}" type="button" title="切换 functionalUse: ${u}">${u}</button>`;
  }).join("");
  const fnBrushOffActive = state.functionalUseBrush.length === 0 ? "active" : "";
  const fnBrushBtnsHtml = `${fnBrushBtns}<button class="lv-an-brush ${fnBrushOffActive} brush-off" data-fn-brush-clear="1" type="button" title="清空 functionalUse 笔刷">off</button>`;

  body.innerHTML = `<div class="lv-an-root">
    <div class="lv-an-list">
      <div class="lv-an-toolbar">
        <select class="lv-an-filter">${filterOpts}</select>
        <span class="count">${filtered.length} / ${features.length}</span>
        <button class="lv-an-action" data-action="auto-bind-all" type="button" title="对所有 platform 一键绑定最近 station">⇶ Auto-bind all platforms</button>
        <button class="lv-an-action" data-action="infer-directions" type="button" title="推断未标记 track 的 directionRole (排除 connector)">↻ Infer directions</button>
      </div>
      <div class="lv-an-toolbar" style="background:#f8fafc;padding:4px 6px">
        <span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">dir brush:</span>
        ${brushBtnsHtml}
      </div>
      <div class="lv-an-toolbar" style="background:#f8fafc;padding:4px 6px">
        <span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">fn brush:</span>
        ${fnBrushBtnsHtml}
      </div>
      <div class="lv-an-feature-list">${listHtml}</div>
    </div>
    <div class="lv-an-gutter"></div>
    <div class="lv-an-inspector">${inspectorHtml}</div>
  </div>`;

  bindAnnotateEvents(state);
}

function featureMatchesFilter(f: AnnotatedFeature, filter: InternalState["annotateFilter"]): boolean {
  const ann = f.properties.railGraph;
  switch (filter) {
    case "all": return true;
    case "unannotated": return !ann || ann.kind === "unknown";
    case "track": return ann?.kind === "track_geometry";
    case "station": return ann?.kind === "station_point";
    case "platform": return ann?.kind === "platform_area";
    case "signal": return ann?.kind === "signal_point";
    case "entrance": return ann?.kind === "station_entrance";
  }
}

function annotateFeatureItem(f: AnnotatedFeature, idx: number, selected: boolean, topo: BaseTopologyLayer | null): string {
  const ann = f.properties.railGraph;
  const status = annotationCompleteness(f);
  const geomIcon = geometryIcon(f.geometry?.type);
  const label = featureDisplayLabel(f);
  const ref = ann?.id ?? "";
  const edgeRef = topo && ann?.kind === "track_geometry" && ann.id
    ? (topo.edges.find((e) => e.sourceSlice?.sourceFeatureRef === ann.id)?.id ?? "")
    : "";
  return `<div class="lv-an-feature ${selected ? "selected" : ""}" data-feature-idx="${idx}" data-ref="${escapeAttr(ref)}" data-edge-ref="${escapeAttr(edgeRef)}">
    <span class="geom">${geomIcon}</span>
    <span class="label" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
    <span class="status ${status.cls}" title="${escapeAttr(status.title)}">${escapeHtml(status.text)}</span>
  </div>`;
}

function geometryIcon(geomType: string | undefined): string {
  switch (geomType) {
    case "Point": return "●";
    case "LineString": return "━";
    case "MultiLineString": return "≡";
    case "Polygon": return "▢";
    default: return "?";
  }
}

function featureDisplayLabel(f: AnnotatedFeature): string {
  const props = f.properties as Record<string, unknown>;
  const ann = f.properties.railGraph;
  const name = (props.name as string | undefined) ?? (props["name:en"] as string | undefined);
  const osmId = props.osm_id as string | number | undefined;
  const station = props.nearest_station as string | undefined;
  const kindLabel = ann?.kind && ann.kind !== "unknown" ? `[${ann.kind.replace("_geometry", "").replace("_point", "").replace("_area", "")}]` : "";
  const parts: string[] = [];
  if (kindLabel) parts.push(kindLabel);
  if (name) parts.push(name);
  if (osmId !== undefined) parts.push(`osm:${osmId}`);
  if (station) parts.push(`@${station}`);
  return parts.length > 0 ? parts.join(" ") : (ann?.id ?? "(unnamed)");
}

function annotationCompleteness(f: AnnotatedFeature): { cls: "done" | "partial" | "todo"; text: string; title: string } {
  const ann = f.properties.railGraph;
  if (!ann || ann.kind === "unknown") return { cls: "todo", text: "TODO", title: "railGraph annotation not yet set" };
  switch (ann.kind) {
    case "track_geometry": {
      const t = ann.track;
      const has = !!t && !!t.directionRole && !!t.physicalKind;
      return has ? { cls: "done", text: "OK", title: "track has directionRole + physicalKind" } : { cls: "partial", text: "…", title: "track annotation missing directionRole / physicalKind" };
    }
    case "station_point": {
      const has = !!ann.station?.name;
      return has ? { cls: "done", text: "OK", title: "station has name" } : { cls: "partial", text: "…", title: "station name missing" };
    }
    case "platform_area": {
      const p = ann.platform;
      const has = !!p?.stationRef && !!p.type;
      return has ? { cls: "done", text: "OK", title: "platform has stationRef + type" } : { cls: "partial", text: "…", title: "platform missing stationRef / type" };
    }
    case "signal_point": {
      const s = ann.signal;
      const has = !!s?.edgeRef && s?.measure !== undefined;
      return has ? { cls: "done", text: "OK", title: "signal has edgeRef + measure" } : { cls: "partial", text: "…", title: "signal missing edgeRef / measure" };
    }
    case "station_entrance": {
      const has = !!ann.entrance?.stationRef;
      return has ? { cls: "done", text: "OK", title: "entrance has stationRef" } : { cls: "partial", text: "…", title: "entrance missing stationRef" };
    }
    default:
      return { cls: "partial", text: "…", title: "annotation kind set but no detail" };
  }
}

// ── Annotate Inspector ──────────────────────────────────────

interface StationOption {
  id: string;
  name: string;
}

function annotateInspectorHtml(f: AnnotatedFeature, stationOptions: StationOption[]): string {
  const props = f.properties as Record<string, unknown>;
  const ann = ensureAnnotation(f);
  const tagsHtml = renderSourceTagsSection(props);
  const formHtml = renderAnnotationFormSection(ann, stationOptions);
  return `${tagsHtml}${formHtml}`;
}

function ensureAnnotation(f: AnnotatedFeature): RailGraphAnnotation {
  return f.properties.railGraph ?? {
    kind: "unknown",
    schemaVersion: "rail-graph-v1",
    id: "",
    source: "ui",
  };
}

function renderSourceTagsSection(props: Record<string, unknown>): string {
  const entries = Object.entries(props)
    .filter(([k]) => k !== "railGraph")
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  const rows = entries.map(([k, v]) => `<div class="lv-an-tag-key">${escapeHtml(k)}</div><div class="lv-an-tag-val">${escapeHtml(formatTagValue(v))}</div>`).join("");
  const body = entries.length === 0 ? `<div class="lv-empty">(no source tags)</div>` : `<div class="lv-an-tag-table">${rows}</div>`;
  return `<section class="lv-an-section collapsed" data-section="tags">
    <h5>Source tags (${entries.length})</h5>
    <div class="lv-an-section-body">${body}</div>
  </section>`;
}

function formatTagValue(v: unknown): string {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function renderAnnotationFormSection(ann: RailGraphAnnotation, stationOptions: StationOption[]): string {
  const kindOpts = KIND_OPTIONS.map((k) => `<option value="${k}" ${k === ann.kind ? "selected" : ""}>${escapeHtml(k)}</option>`).join("");
  const subForm = renderAnnotationSubForm(ann, stationOptions);
  const idHtml = ann.id ? `<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;font-family:ui-monospace,monospace">id: ${escapeHtml(ann.id)}</div>` : "";
  return `<section class="lv-an-section" data-section="annotation">
    <h5>RailGraph annotation</h5>
    <div class="lv-an-section-body">
      ${idHtml}
      <div class="lv-an-form">
        <label>kind</label>
        <select data-field="kind">${kindOpts}</select>
        <label>source</label>
        <input data-field="source" value="${escapeAttr(ann.source ?? "ui")}" />
        <label>id</label>
        <input data-field="id" value="${escapeAttr(ann.id ?? "")}" placeholder="(auto-generated on compile)" />
      </div>
      ${subForm}
    </div>
  </section>`;
}

function renderAnnotationSubForm(ann: RailGraphAnnotation, stationOptions: StationOption[]): string {
  switch (ann.kind) {
    case "track_geometry": return renderTrackForm(ann);
    case "station_point": return renderStationForm(ann);
    case "platform_area": return renderPlatformForm(ann, stationOptions);
    case "signal_point": return renderSignalForm(ann);
    case "station_entrance": return renderEntranceForm(ann, stationOptions);
    default: return "";
  }
}

function renderTrackForm(ann: RailGraphAnnotation): string {
  const t = ann.track ?? { role: "main" as TopologyEdgeRole, traversal: "both" as TraversalDirection };
  const roleOpts = EDGE_ROLE_OPTIONS.map((o) => `<option value="${o}" ${o === t.role ? "selected" : ""}>${o}</option>`).join("");
  const traversalOpts = TRAVERSAL_OPTIONS.map((o) => `<option value="${o}" ${o === t.traversal ? "selected" : ""}>${o}</option>`).join("");
  const physOpts = `<option value="" ${!t.physicalKind ? "selected" : ""}>(unset)</option>` + PHYSICAL_KIND_OPTIONS.map((o) => `<option value="${o}" ${o === t.physicalKind ? "selected" : ""}>${o}</option>`).join("");
  const dirOpts = `<option value="" ${!t.directionRole ? "selected" : ""}>(unset)</option>` + DIRECTION_ROLE_OPTIONS.map((o) => `<option value="${o}" ${o === t.directionRole ? "selected" : ""}>${o}</option>`).join("");
  const useChecks = FUNCTIONAL_USE_OPTIONS.map((u) => `<label><input type="checkbox" data-field="track.functionalUse" value="${u}" ${(t.functionalUse ?? []).includes(u) ? "checked" : ""} />${u}</label>`).join("");
  return `<div class="lv-an-form-section">
    <h6>Track</h6>
    <div class="lv-an-form">
      <label>role (legacy)</label>
      <select data-field="track.role">${roleOpts}</select>
      <label>traversal</label>
      <select data-field="track.traversal">${traversalOpts}</select>
      <label>physicalKind</label>
      <select data-field="track.physicalKind">${physOpts}</select>
      <label>directionRole</label>
      <select data-field="track.directionRole">${dirOpts}</select>
      <label>name</label>
      <input data-field="track.name" value="${escapeAttr(t.name ?? "")}" />
      <label>trackCode</label>
      <input data-field="track.trackCode" value="${escapeAttr(t.trackCode ?? "")}" />
      <label>functionalUse</label>
      <div class="checklist">${useChecks}</div>
      <label class="full" style="grid-column:1/-1">
        <button class="lv-an-action" data-action="reverse-geometry" type="button" style="color:#b91c1c;border-color:#b91c1c;background:#fef2f2">↺ Reverse geometry</button>
        <span style="font-size:10px;color:#94a3b8;margin-left:4px">翻转坐标序列, 箭头方向随之改变</span>
      </label>
    </div>
  </div>`;
}

function renderStationForm(ann: RailGraphAnnotation): string {
  const s = ann.station ?? { name: "" };
  return `<div class="lv-an-form-section">
    <h6>Station</h6>
    <div class="lv-an-form">
      <label>name</label>
      <input data-field="station.name" value="${escapeAttr(s.name ?? "")}" />
    </div>
  </div>`;
}

function renderPlatformForm(ann: RailGraphAnnotation, stationOptions: StationOption[]): string {
  const p = ann.platform ?? {};
  const typeOpts = `<option value="" ${!p.type ? "selected" : ""}>(unset)</option>` + PLATFORM_TYPE_OPTIONS.map((o) => `<option value="${o}" ${o === p.type ? "selected" : ""}>${o}</option>`).join("");
  const stationRefOpts = `<option value="" ${!p.stationRef ? "selected" : ""}>(unset)</option>`
    + stationOptions.map((s) => `<option value="${escapeAttr(s.id)}" ${s.id === p.stationRef ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  return `<div class="lv-an-form-section">
    <h6>Platform</h6>
    <div class="lv-an-form">
      <label class="full" style="grid-column:1/-1">
        <button class="lv-an-action" data-action="auto-bind-station" type="button">↓ Auto-bind nearest station</button>
      </label>
      <label>stationRef</label>
      <select data-field="platform.stationRef">${stationRefOpts}</select>
      <label>name</label>
      <input data-field="platform.name" value="${escapeAttr(p.name ?? "")}" />
      <label>number</label>
      <input data-field="platform.number" type="number" value="${p.number ?? ""}" />
      <label>type</label>
      <select data-field="platform.type">${typeOpts}</select>
    </div>
  </div>`;
}

function renderSignalForm(ann: RailGraphAnnotation): string {
  const s = ann.signal ?? { edgeRef: "", measure: 0.5, facing: "forward" as const };
  return `<div class="lv-an-form-section">
    <h6>Signal</h6>
    <div class="lv-an-form">
      <label>edgeRef</label>
      <input data-field="signal.edgeRef" value="${escapeAttr(s.edgeRef ?? "")}" />
      <label>measure</label>
      <input data-field="signal.measure" type="number" min="0" max="1" step="0.01" value="${s.measure ?? 0.5}" />
      <label>facing</label>
      <select data-field="signal.facing">
        <option value="forward" ${s.facing === "forward" ? "selected" : ""}>forward</option>
        <option value="reverse" ${s.facing === "reverse" ? "selected" : ""}>reverse</option>
        <option value="both" ${s.facing === "both" ? "selected" : ""}>both</option>
      </select>
      <label>name</label>
      <input data-field="signal.name" value="${escapeAttr(s.name ?? "")}" />
    </div>
  </div>`;
}

function renderEntranceForm(ann: RailGraphAnnotation, stationOptions: StationOption[]): string {
  const e = ann.entrance ?? {};
  const stationRefOpts = `<option value="" ${!e.stationRef ? "selected" : ""}>(unset)</option>`
    + stationOptions.map((s) => `<option value="${escapeAttr(s.id)}" ${s.id === e.stationRef ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  return `<div class="lv-an-form-section">
    <h6>Station entrance</h6>
    <div class="lv-an-form">
      <label class="full" style="grid-column:1/-1">
        <button class="lv-an-action" data-action="auto-bind-entrance" type="button">↓ Auto-bind nearest station</button>
      </label>
      <label>stationRef</label>
      <select data-field="entrance.stationRef">${stationRefOpts}</select>
      <label>name</label>
      <input data-field="entrance.name" value="${escapeAttr(e.name ?? "")}" />
      <label>ref</label>
      <input data-field="entrance.ref" value="${escapeAttr(e.ref ?? "")}" placeholder="A1 / 南口 / etc" />
    </div>
  </div>`;
}

// ── Annotate event wiring ───────────────────────────────────

function bindAnnotateEvents(state: InternalState): void {
  // Annotate internal gutter (list ↔ inspector)
  const anGutter = state.container.querySelector<HTMLElement>(".lv-an-gutter");
  if (anGutter) {
    let dragging = false;
    anGutter.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      anGutter.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const root = state.container.querySelector<HTMLElement>(".lv-an-root");
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const pct = Math.round((px / rect.width) * 100);
      const clamped = Math.max(20, Math.min(80, pct));
      root.style.setProperty("--an-list-w", `${clamped}%`);
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      anGutter.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });
  }

  // Filter dropdown
  const filterEl = state.container.querySelector<HTMLSelectElement>(".lv-an-filter");
  filterEl?.addEventListener("change", () => {
    state.annotateFilter = filterEl.value as InternalState["annotateFilter"];
    renderActiveTab(state);
  });

  // Feature list rows — click to select, hover/click also broadcast as entity ref for map sync
  state.container.querySelectorAll<HTMLElement>(".lv-an-feature").forEach((row) => {
    const sourceRef = (row.dataset.ref ?? "") as EntityRef;
    const edgeRef = (row.dataset.edgeRef ?? "") as EntityRef;
    const broadcastRef: EntityRef | null = edgeRef ? edgeRef : (sourceRef || null);

    row.addEventListener("click", () => {
      const idx = Number(row.dataset.featureIdx);
      if (!Number.isFinite(idx)) return;
      // dirRole brush 激活时, 点击 track_geometry feature 直接刷方向
      if (applyDirRoleBrushIfActive(state, idx)) return;
      state.selectedFeatureIdx = idx;
      renderActiveTab(state);
      if (broadcastRef) state.clickHandlers.forEach((h) => h(broadcastRef));
    });
    row.addEventListener("mouseenter", () => {
      if (broadcastRef) state.hoverHandlers.forEach((h) => h(broadcastRef));
    });
    row.addEventListener("mouseleave", () => {
      state.hoverHandlers.forEach((h) => h(null));
    });
  });

  // Brush buttons (5 个 direction + off)
  state.container.querySelectorAll<HTMLElement>(".lv-an-brush[data-brush]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.brush ?? "";
      state.dirRoleBrush = val ? (val as TrackDirectionRole) : null;
      renderActiveTab(state);
    });
  });

  // functionalUse brush buttons (toggle 多选)
  state.container.querySelectorAll<HTMLElement>(".lv-an-brush[data-fn-brush]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.fnBrush as TrackFunctionalUse;
      const idx = state.functionalUseBrush.indexOf(val);
      if (idx >= 0) state.functionalUseBrush.splice(idx, 1);
      else state.functionalUseBrush.push(val);
      renderActiveTab(state);
    });
  });
  state.container.querySelector<HTMLElement>('.lv-an-brush[data-fn-brush-clear]')?.addEventListener("click", () => {
    state.functionalUseBrush = [];
    renderActiveTab(state);
  });

  // toolbar 全局动作: Auto-bind all platforms
  state.container.querySelector<HTMLElement>('[data-action="auto-bind-all"]')?.addEventListener("click", () => {
    autoBindAllPlatforms(state);
  });

  // toolbar 全局动作: Infer directions
  state.container.querySelector<HTMLElement>('[data-action="infer-directions"]')?.addEventListener("click", () => {
    inferDirections(state);
  });

  // inspector 内 Auto-bind nearest station (platform_area 或 station_entrance selected 时显示)
  state.container.querySelector<HTMLElement>('[data-action="auto-bind-station"]')?.addEventListener("click", () => {
    if (state.selectedFeatureIdx == null) return;
    autoBindNearestStation(state, state.selectedFeatureIdx);
  });
  state.container.querySelector<HTMLElement>('[data-action="auto-bind-entrance"]')?.addEventListener("click", () => {
    if (state.selectedFeatureIdx == null) return;
    autoBindNearestStation(state, state.selectedFeatureIdx);
  });

  // inspector: Reverse geometry (仅 track_geometry LineString)
  state.container.querySelector<HTMLElement>('[data-action="reverse-geometry"]')?.addEventListener("click", () => {
    if (state.selectedFeatureIdx == null) return;
    reverseFeatureGeometry(state, state.selectedFeatureIdx);
  });

  // Section collapse toggle
  state.container.querySelectorAll<HTMLElement>(".lv-an-section > h5").forEach((h) => {
    h.addEventListener("click", () => {
      h.parentElement?.classList.toggle("collapsed");
    });
  });

  // Form fields
  const features = state.input.source?.features ?? [];
  if (state.selectedFeatureIdx == null) return;
  const feature = features[state.selectedFeatureIdx];
  if (!feature) return;

  const handleAnnotationChange = (mutator: (ann: RailGraphAnnotation) => RailGraphAnnotation): void => {
    const current = ensureAnnotation(feature);
    const next = mutator({ ...current });
    state.annotationChangeHandlers.forEach((h) => h({ featureIdx: state.selectedFeatureIdx!, annotation: next }));
  };

  // kind
  state.container.querySelector<HTMLSelectElement>('[data-field="kind"]')?.addEventListener("change", (e) => {
    const next = (e.target as HTMLSelectElement).value as RailGraphFeatureKind;
    handleAnnotationChange((ann) => ({ ...ann, kind: next }));
  });
  // source / id
  ["source", "id"].forEach((field) => {
    state.container.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.addEventListener("change", (e) => {
      const next = (e.target as HTMLInputElement).value;
      handleAnnotationChange((ann) => ({ ...ann, [field]: next }));
    });
  });

  // track.* fields
  bindTrackField(state, "track.role", (ann, v) => mergeTrack(ann, { role: v as TopologyEdgeRole }));
  bindTrackField(state, "track.traversal", (ann, v) => mergeTrack(ann, { traversal: v as TraversalDirection }));
  bindTrackField(state, "track.physicalKind", (ann, v) => mergeTrack(ann, { physicalKind: v === "" ? undefined : (v as TrackPhysicalKind) }));
  bindTrackField(state, "track.directionRole", (ann, v) => mergeTrack(ann, { directionRole: v === "" ? undefined : (v as TrackDirectionRole) }));
  bindTrackField(state, "track.name", (ann, v) => mergeTrack(ann, { name: v || undefined }));
  bindTrackField(state, "track.trackCode", (ann, v) => mergeTrack(ann, { trackCode: v || undefined }));
  // track.functionalUse (multi-checkbox)
  state.container.querySelectorAll<HTMLInputElement>('[data-field="track.functionalUse"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const checks = state.container.querySelectorAll<HTMLInputElement>('[data-field="track.functionalUse"]');
      const values: TrackFunctionalUse[] = [];
      checks.forEach((c) => { if (c.checked) values.push(c.value as TrackFunctionalUse); });
      handleAnnotationChange((ann) => mergeTrack(ann, { functionalUse: values.length > 0 ? values : undefined }));
    });
  });

  // station.* fields
  bindFormField(state, "station.name", (ann, v) => ({ ...ann, station: { ...(ann.station ?? { name: "" }), name: v } }));

  // platform.* fields
  bindFormField(state, "platform.stationRef", (ann, v) => ({ ...ann, platform: { ...(ann.platform ?? {}), stationRef: v || undefined } }));
  bindFormField(state, "platform.name", (ann, v) => ({ ...ann, platform: { ...(ann.platform ?? {}), name: v || undefined } }));
  bindFormField(state, "platform.number", (ann, v) => ({ ...ann, platform: { ...(ann.platform ?? {}), number: v ? Number(v) : undefined } }));
  bindFormField(state, "platform.type", (ann, v) => ({ ...ann, platform: { ...(ann.platform ?? {}), type: v === "" ? undefined : (v as PlatformType) } }));

  // signal.* fields
  bindFormField(state, "signal.edgeRef", (ann, v) => ({ ...ann, signal: { ...(ann.signal ?? { edgeRef: "", measure: 0.5, facing: "forward" }), edgeRef: v } }));
  bindFormField(state, "signal.measure", (ann, v) => ({ ...ann, signal: { ...(ann.signal ?? { edgeRef: "", measure: 0.5, facing: "forward" }), measure: Number(v) } }));
  bindFormField(state, "signal.facing", (ann, v) => ({ ...ann, signal: { ...(ann.signal ?? { edgeRef: "", measure: 0.5, facing: "forward" }), facing: v as "forward" | "reverse" | "both" } }));
  bindFormField(state, "signal.name", (ann, v) => ({ ...ann, signal: { ...(ann.signal ?? { edgeRef: "", measure: 0.5, facing: "forward" }), name: v || undefined } }));

  // entrance.* fields
  bindFormField(state, "entrance.stationRef", (ann, v) => ({ ...ann, entrance: { ...(ann.entrance ?? {}), stationRef: v || undefined } }));
  bindFormField(state, "entrance.name", (ann, v) => ({ ...ann, entrance: { ...(ann.entrance ?? {}), name: v || undefined } }));
  bindFormField(state, "entrance.ref", (ann, v) => ({ ...ann, entrance: { ...(ann.entrance ?? {}), ref: v || undefined } }));

  function bindTrackField(s: InternalState, field: string, fn: (ann: RailGraphAnnotation, v: string) => RailGraphAnnotation): void {
    bindFormField(s, field, fn);
  }
  function bindFormField(s: InternalState, field: string, fn: (ann: RailGraphAnnotation, v: string) => RailGraphAnnotation): void {
    s.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`)?.addEventListener("change", (e) => {
      const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
      handleAnnotationChange((ann) => fn(ann, v));
    });
  }
}

function mergeTrack(ann: RailGraphAnnotation, patch: Partial<NonNullable<RailGraphAnnotation["track"]>>): RailGraphAnnotation {
  const base = ann.track ?? { role: "main" as TopologyEdgeRole, traversal: "both" as TraversalDirection };
  return { ...ann, track: { ...base, ...patch } };
}

// ── Annotate auto-actions: dirRole brush / auto-bind station ─

/** 若 dirRole/functionalUse brush 任一激活, 且 feature 是 track_geometry → 应用并阻断后续 click 行为. */
function applyDirRoleBrushIfActive(state: InternalState, featureIdx: number): boolean {
  const hasDir = state.dirRoleBrush != null;
  const hasFn = state.functionalUseBrush.length > 0;
  if (!hasDir && !hasFn) return false;
  const features = state.input.source?.features ?? [];
  const f = features[featureIdx];
  if (!f) return false;
  const ann = ensureAnnotation(f);
  if (ann.kind !== "track_geometry") return false;
  let next = ann;
  if (hasDir) next = mergeTrack(next, { directionRole: state.dirRoleBrush! });
  if (hasFn) next = mergeTrack(next, { functionalUse: [...state.functionalUseBrush] });
  emitAnnotationChange(state, featureIdx, next);
  return true;
}

function autoBindNearestStation(state: InternalState, featureIdx: number): void {
  const features = state.input.source?.features ?? [];
  const f = features[featureIdx];
  if (!f) return;
  const ann = ensureAnnotation(f);
  if (ann.kind !== "platform_area" && ann.kind !== "station_entrance") return;
  const centroid = featureCentroid(f);
  if (!centroid) return;
  const nearest = findNearestStation(features, centroid);
  if (!nearest) return;
  const next: RailGraphAnnotation = ann.kind === "platform_area"
    ? { ...ann, platform: { ...(ann.platform ?? {}), stationRef: nearest.id } }
    : { ...ann, entrance: { ...(ann.entrance ?? {}), stationRef: nearest.id } };
  emitAnnotationChange(state, featureIdx, next);
}

function autoBindAllPlatforms(state: InternalState): void {
  const features = state.input.source?.features ?? [];
  for (let i = 0; i < features.length; i += 1) {
    const ann = features[i].properties.railGraph;
    if (ann?.kind !== "platform_area") continue;
    autoBindNearestStation(state, i);
  }
}

function emitAnnotationChange(state: InternalState, featureIdx: number, annotation: RailGraphAnnotation): void {
  state.annotationChangeHandlers.forEach((h) => h({ featureIdx, annotation }));
}

function reverseFeatureGeometry(state: InternalState, featureIdx: number): void {
  const features = state.input.source?.features ?? [];
  const f = features[featureIdx];
  if (!f) return;
  if (f.geometry?.type !== "LineString") return;
  const coords = [...f.geometry.coordinates] as Array<[number, number]>;
  if (coords.length < 2) return;
  coords.reverse();
  features[featureIdx] = {
    ...f,
    geometry: { ...f.geometry, coordinates: coords },
  };
  (features[featureIdx] as any)._coordsReversed = !(f as any)._coordsReversed;
  
  // 触发 recompile 并保存
  const ann = ensureAnnotation(f);
  const track = ann.track ?? { role: "main", traversal: "both" };
  const next: RailGraphAnnotation = {
    ...ann,
    track: {
      ...track,
      geometryReversed: !track.geometryReversed,
    },
  };
  emitAnnotationChange(state, featureIdx, next);
}

function emitAnnotationBatch(state: InternalState, payloads: AnnotationChangePayload[]): void {
  if (payloads.length === 0) return;
  state.annotationBatchHandlers.forEach((h) => h(payloads));
}

function findNearestStation(features: AnnotatedFeature[], from: [number, number]): { id: string; distM: number } | null {
  let best: { id: string; distM: number } | null = null;
  for (const f of features) {
    const ann = f.properties.railGraph;
    if (ann?.kind !== "station_point") continue;
    const c = featureCentroid(f);
    if (!c) continue;
    const d = haversineMeters(from, c);
    if (best === null || d < best.distM) {
      best = { id: ann.id, distM: d };
    }
  }
  return best;
}

function featureCentroid(f: AnnotatedFeature): [number, number] | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === "Point") {
    const c = g.coordinates as [number, number];
    return [c[0], c[1]];
  }
  if (g.type === "LineString") {
    const coords = g.coordinates as Array<[number, number]>;
    if (coords.length === 0) return null;
    const mid = coords[Math.floor(coords.length / 2)];
    return [mid[0], mid[1]];
  }
  if (g.type === "MultiLineString") {
    const lines = g.coordinates as Array<Array<[number, number]>>;
    if (lines.length === 0 || lines[0].length === 0) return null;
    const mid = lines[0][Math.floor(lines[0].length / 2)];
    return [mid[0], mid[1]];
  }
  if (g.type === "Polygon") {
    const ring = (g.coordinates as Array<Array<[number, number]>>)[0];
    if (!ring || ring.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of ring) { sx += p[0]; sy += p[1]; }
    return [sx / ring.length, sy / ring.length];
  }
  return null;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6378137;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function inferDirections(state: InternalState): void {
  const topo = state.input.topo;
  const features = state.input.source?.features ?? [];
  if (!topo) return;

  // feature 索引: annotation.id → featureIdx (仅 track_geometry)
  const idToIdx = new Map<string, number>();
  for (let i = 0; i < features.length; i += 1) {
    const ann = features[i].properties.railGraph;
    if (ann?.kind !== "track_geometry") continue;
    if (ann.id) idToIdx.set(ann.id, i);
  }

  // topo.edges 索引: nodeRef → 在此节点的 edge ids
  const nodeToEdges = new Map<string, typeof topo.edges>();
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
  const results: AnnotationChangePayload[] = [];

  while (round++ < maxRounds) {
    let roundChanges = 0;
    for (const edge of topo.edges) {
      if (edge.role === "connector") continue;
      if (edge.directionRole !== undefined && edge.directionRole !== "bidirectional") continue;
      const curRole = edge.directionRole; // undefined or "bidirectional"
      // 仅推断 traversal=both 且未显式声明的边
      if (edge.traversal !== "both") continue;

      // 收集邻居方向
      const seen: Set<TrackDirectionRole> = new Set();
      for (const nr of [edge.fromNodeRef, edge.toNodeRef]) {
        const neighbors = nodeToEdges.get(nr) ?? [];
        for (const nb of neighbors) {
          if (nb.id === edge.id) continue;
          const dr = nb.directionRole;
          if (dr === "up" || dr === "down") seen.add(dr);
        }
      }

      // 共识判断
      const infer: TrackDirectionRole | null =
        (seen.size === 1 && seen.has("up")) ? "up" :
        (seen.size === 1 && seen.has("down")) ? "down" :
        seen.has("up") && seen.has("down") ? "bidirectional" :
        null;
      if (infer === null) continue;
      if (infer === (curRole ?? "bidirectional")) continue; // no change

      // 通过 sourceFeatureRef 反查 feature
      const sourceRef = edge.sourceSlice?.sourceFeatureRef;
      if (!sourceRef) continue;
      const fidx = idToIdx.get(sourceRef);
      if (fidx === undefined) continue;

      const ann = ensureAnnotation(features[fidx]);
      if (ann.kind !== "track_geometry") continue;
      const next = mergeTrack(ann, { directionRole: infer });

      // 直接改 in-memory (下一轮用到)
      features[fidx] = { ...features[fidx], properties: { ...features[fidx].properties, railGraph: next } };
      edge.directionRole = infer; // 更新 topo 内缓存
      idToIdx.set(next.id, fidx); // refresh

      results.push({ featureIdx: fidx, annotation: next });
      roundChanges += 1;
    }
    if (roundChanges === 0) break;
    changed += roundChanges;
  }

  if (changed > 0) {
    console.log(`[inferDirections] ${round - 1} rounds, ${changed} edges inferred`);
    emitAnnotationBatch(state, results);
  }
}

// ── Event wiring ────────────────────────────────────────────

function bindItemEvents(state: InternalState): void {
  state.container.querySelectorAll<HTMLElement>(".lv-item").forEach((el) => {
    const ref = el.dataset.ref as EntityRef | undefined;
    if (!ref) return;
    el.addEventListener("mouseenter", () => {
      state.hoverHandlers.forEach((h) => h(ref));
    });
    el.addEventListener("mouseleave", () => {
      state.hoverHandlers.forEach((h) => h(null));
    });
    el.addEventListener("click", () => {
      state.selectedEntity = ref;
      updateItemSelected(state);
      state.clickHandlers.forEach((h) => h(ref));
    });
  });
}

function bindScenarioEvents(state: InternalState): void {
  state.container.querySelectorAll<HTMLElement>(".lv-scenario-header").forEach((header) => {
    header.addEventListener("click", () => {
      const card = header.closest(".lv-scenario") as HTMLElement | null;
      if (!card) return;
      const idx = Number(card.dataset.scenarioIdx);
      state.selectedScenarioIdx = state.selectedScenarioIdx === idx ? null : idx;
      state.selectedCandidateIdx = null;
      renderActiveTab(state);
    });
  });
  state.container.querySelectorAll<HTMLElement>(".lv-candidate").forEach((cand) => {
    const sIdx = Number(cand.dataset.scenarioIdx);
    const cIdx = Number(cand.dataset.candidateIdx);
    const result = state.input.pathfindingResults?.[sIdx];
    const candidate = result?.candidates[cIdx];
    if (!candidate) return;
    const payload: PathHandlerPayload = {
      edgeSequence: candidate.edgeSequence,
      turnbackEdgeIndices: candidate.turnbackEdgeIndices,
      resolvedChain: candidate.resolvedChain,
    };
    cand.addEventListener("mouseenter", () => {
      state.pathHoverHandlers.forEach((h) => h(payload));
    });
    cand.addEventListener("mouseleave", () => {
      state.pathHoverHandlers.forEach((h) => h(null));
    });
    cand.addEventListener("click", (e) => {
      e.stopPropagation();
      state.selectedScenarioIdx = sIdx;
      state.selectedCandidateIdx = cIdx;
      state.pathClickHandlers.forEach((h) => h(payload));
      renderActiveTab(state);
    });
  });
  state.container.querySelectorAll<HTMLElement>(".lv-trace-entry").forEach((entry) => {
    const ref = entry.dataset.ref as EntityRef | undefined;
    const alsoRef = entry.dataset.alsoRef as EntityRef | undefined;
    if (!ref) return;
    entry.addEventListener("mouseenter", () => {
      state.hoverHandlers.forEach((h) => h(ref));
      if (alsoRef) state.hoverHandlers.forEach((h) => h(alsoRef));
    });
    entry.addEventListener("mouseleave", () => {
      state.hoverHandlers.forEach((h) => h(null));
    });
  });
  state.container.querySelectorAll<HTMLElement>(".lv-chain-node").forEach((node) => {
    const ref = node.dataset.ref as EntityRef | undefined;
    const alsoRef = node.dataset.alsoRef as EntityRef | undefined;
    if (!ref) return;
    node.addEventListener("mouseenter", (e) => {
      e.stopPropagation();
      state.hoverHandlers.forEach((h) => h(ref));
      if (alsoRef) state.hoverHandlers.forEach((h) => h(alsoRef));
    });
    node.addEventListener("mouseleave", () => {
      state.hoverHandlers.forEach((h) => h(null));
    });
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      state.clickHandlers.forEach((h) => h(ref));
    });
  });
}

function updateItemSelected(state: InternalState): void {
  state.container.querySelectorAll<HTMLElement>(".lv-item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.ref === state.selectedEntity);
  });
}

function findFeatureIdxByRef(state: InternalState, ref: EntityRef): number | null {
  const features = state.input.source?.features ?? [];
  // 1) 直接匹配 annotation.id
  for (let i = 0; i < features.length; i += 1) {
    if (features[i].properties.railGraph?.id === ref) return i;
  }
  // 2) 反查 topo.edges: edge.id === ref → sourceFeatureRef → annotation.id
  const edge = state.input.topo?.edges.find((e) => e.id === ref);
  const sourceRef = edge?.sourceSlice?.sourceFeatureRef;
  if (sourceRef) {
    for (let i = 0; i < features.length; i += 1) {
      if (features[i].properties.railGraph?.id === sourceRef) return i;
    }
  }
  return null;
}

function applyEntityHover(state: InternalState, ref: EntityRef | null): void {
  state.container.querySelectorAll<HTMLElement>(".lv-item.hovered, .lv-trace-entry.hovered, .lv-chain-node.hovered, .lv-an-feature.hovered")
    .forEach((el) => el.classList.remove("hovered"));
  if (!ref) return;
  const escRef = cssEscape(ref);
  const items = state.container.querySelectorAll<HTMLElement>(
    `.lv-item[data-ref="${escRef}"], .lv-trace-entry[data-ref="${escRef}"], .lv-chain-node[data-ref="${escRef}"], .lv-an-feature[data-ref="${escRef}"], .lv-an-feature[data-edge-ref="${escRef}"]`,
  );
  items.forEach((el) => {
    el.classList.add("hovered");
  });
  // 滚动到第一个匹配项 (annotate tab 启用)
  if (items.length > 0 && state.activeTab === "annotate") {
    items[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ── Utils ───────────────────────────────────────────────────

function bodyEl(state: InternalState, tab: TabKey): HTMLElement {
  return state.container.querySelector<HTMLElement>(`.lv-body[data-body="${tab}"]`)!;
}

function shortId(ref: string): string {
  // demo:platform:A → "platform:A"; manual:edge:abc-123 → "edge:abc"
  const parts = ref.split(":");
  if (parts.length >= 2) {
    const tail = parts.slice(1).join(":");
    return tail.length > 24 ? tail.slice(0, 24) + "…" : tail;
  }
  return ref.length > 24 ? ref.slice(0, 24) + "…" : ref;
}

function escapeHtml(value: string): string {
  const str = String(value ?? "");
  return str.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch] ?? ch));
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
