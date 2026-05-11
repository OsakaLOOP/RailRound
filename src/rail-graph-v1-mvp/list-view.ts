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
  Station,
  StoppingPoint,
  TopologyEdge,
} from "../rail-graph-v1/base-topology.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type {
  ServicePassEntry,
  ServiceStopEntry,
  ServiceTraceEntry,
} from "../rail-graph-v1/service-template.types";
import type { ScenarioResult } from "./poc-pathfinding";

// ── Public API ──────────────────────────────────────────────

export interface ListViewInput {
  topo: BaseTopologyLayer | null;
  diagnostics: Diagnostic[];
  pathfindingResults?: ScenarioResult[];
}

export interface ListView {
  update(input: ListViewInput): void;
  highlightEntity(ref: EntityRef | null): void;
  onEntityHover(handler: (ref: EntityRef | null) => void): void;
  onEntityClick(handler: (ref: EntityRef) => void): void;
  onPathHover(handler: (edgeSequence: EntityRef[] | null) => void): void;
  onPathClick(handler: (edgeSequence: EntityRef[]) => void): void;
}

type TabKey = "topology" | "pathfinding" | "diagnostics" | "raw";

interface InternalState {
  container: HTMLElement;
  activeTab: TabKey;
  input: ListViewInput;
  hoverHandlers: Array<(ref: EntityRef | null) => void>;
  clickHandlers: Array<(ref: EntityRef) => void>;
  pathHoverHandlers: Array<(edgeSequence: EntityRef[] | null) => void>;
  pathClickHandlers: Array<(edgeSequence: EntityRef[]) => void>;
  selectedEntity: EntityRef | null;
  selectedScenarioIdx: number | null;
  selectedCandidateIdx: number | null;
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
      <button class="lv-tab active" data-tab="topology">Topology</button>
      <button class="lv-tab" data-tab="pathfinding">Pathfinding</button>
      <button class="lv-tab" data-tab="diagnostics">Diagnostics</button>
      <button class="lv-tab" data-tab="raw">Raw JSON</button>
    </div>
    <div class="lv-body" data-body="topology"></div>
    <div class="lv-body" data-body="pathfinding" hidden></div>
    <div class="lv-body" data-body="diagnostics" hidden></div>
    <div class="lv-body" data-body="raw" hidden></div>
  `;

  const state: InternalState = {
    container,
    activeTab: "topology",
    input: { topo: null, diagnostics: [] },
    hoverHandlers: [],
    clickHandlers: [],
    pathHoverHandlers: [],
    pathClickHandlers: [],
    selectedEntity: null,
    selectedScenarioIdx: null,
    selectedCandidateIdx: null,
  };

  bindTabClicks(state);

  return {
    update(input) {
      state.input = input;
      renderActiveTab(state);
    },
    highlightEntity(ref) {
      applyEntityHover(state, ref);
    },
    onEntityHover(h) { state.hoverHandlers.push(h); },
    onEntityClick(h) { state.clickHandlers.push(h); },
    onPathHover(h) { state.pathHoverHandlers.push(h); },
    onPathClick(h) { state.pathClickHandlers.push(h); },
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
    case "topology": renderTopologyTab(state); break;
    case "pathfinding": renderPathfindingTab(state); break;
    case "diagnostics": renderDiagnosticsTab(state); break;
    case "raw": renderRawTab(state); break;
  }
}

// ── Topology tab ────────────────────────────────────────────

function renderTopologyTab(state: InternalState): void {
  const body = bodyEl(state, "topology");
  const { topo } = state.input;
  if (!topo) {
    body.innerHTML = `<div class="lv-empty">No topology yet. Load demo or compile first.</div>`;
    return;
  }
  body.innerHTML = `
    ${section("Stations", topo.stations, (s) => stationItem(s))}
    ${section("Platforms", topo.platforms, (p) => platformItem(p))}
    ${section("Edges", topo.edges, (e) => edgeItem(e))}
    ${section("Bindings", topo.platformTrackBindings, (b) => bindingItem(b))}
    ${section("Stopping Points", topo.stoppingPoints, (sp) => stoppingPointItem(sp))}
    ${section("Double-track Pairs", topo.doubleTrackPairs, (pair) => doubleTrackItem(pair))}
  `;
  bindItemEvents(state);
}

function section<T>(title: string, items: T[], render: (item: T) => string): string {
  return `<section class="lv-section">
    <h4>${escapeHtml(title)} (${items.length})</h4>
    ${items.length === 0 ? `<div class="lv-empty">empty</div>` : items.map(render).join("")}
  </section>`;
}

function stationItem(s: Station): string {
  return `<div class="lv-item" data-ref="${escapeAttr(s.id)}">
    <strong>${escapeHtml(s.name)}</strong>
    <div class="meta">${s.platformRefs.length} platforms · <code>${escapeHtml(s.id)}</code></div>
  </div>`;
}

function platformItem(p: Platform): string {
  return `<div class="lv-item" data-ref="${escapeAttr(p.id)}">
    <strong>${escapeHtml(p.name ?? p.id)}</strong>
    <div class="meta">type: ${p.type} · station: <code>${escapeHtml(p.stationRef)}</code></div>
  </div>`;
}

function edgeItem(e: TopologyEdge): string {
  return `<div class="lv-item" data-ref="${escapeAttr(e.id)}">
    <strong>${escapeHtml(e.name ?? e.trackCode ?? e.id)}</strong>
    <div class="meta">role: ${e.role} · dir: ${e.directionRole ?? "—"} · trav: ${e.traversal} · ${Math.round(e.lengthMeters)}m</div>
  </div>`;
}

function bindingItem(b: PlatformTrackBinding): string {
  return `<div class="lv-item" data-ref="${escapeAttr(b.platformRef)}" data-also-ref="${escapeAttr(b.edgeRef)}">
    <strong>${shortId(b.platformRef)} → ${shortId(b.edgeRef)}</strong>
    <div class="meta">side: ${b.side} · serving: ${b.servingDirection ?? "—"}</div>
  </div>`;
}

function stoppingPointItem(sp: StoppingPoint): string {
  return `<div class="lv-item" data-ref="${escapeAttr(sp.edgeRef)}" data-also-ref="${escapeAttr(sp.platformRef)}">
    <strong>${shortId(sp.platformRef)} @ ${shortId(sp.edgeRef)}</strong>
    <div class="meta">dir: ${sp.direction} · measure: ${sp.measure} · ${sp.confirmation}</div>
  </div>`;
}

function doubleTrackItem(pair: { id: EntityRef; upEdgeRefs: EntityRef[]; downEdgeRefs: EntityRef[] }): string {
  return `<div class="lv-item" data-ref="${escapeAttr(pair.id)}">
    <strong>Pair</strong>
    <div class="meta">up: ${pair.upEdgeRefs.length} · down: ${pair.downEdgeRefs.length}</div>
  </div>`;
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

function scenarioCard(r: ScenarioResult, idx: number, state: InternalState): string {
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

function candidateItem(c: import("../rail-graph-v1/pathfinding").PathfindingResult, scenarioIdx: number, candidateIdx: number, state: InternalState): string {
  const isSelected = state.selectedScenarioIdx === scenarioIdx && state.selectedCandidateIdx === candidateIdx;
  const phaseSummary = c.phases.map((p) => `<span class="lv-phase-chip ${p.kind}">${p.kind}</span>`).join("");
  return `<div class="lv-candidate ${isSelected ? "selected" : ""}" data-scenario-idx="${scenarioIdx}" data-candidate-idx="${candidateIdx}">
    <div>[${candidateIdx}] ${Math.round(c.totalDistanceMeters)}m · ${c.edgeSequence.length} edges</div>
    <div style="margin-top:3px">${phaseSummary}</div>
    ${isSelected ? renderTraceList(c.traceSequence) : ""}
  </div>`;
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
      candidatesCount: r.candidates.length,
      best: r.best ? {
        totalDistanceMeters: r.best.totalDistanceMeters,
        edgeSequence: r.best.edgeSequence,
        phases: r.best.phases,
      } : null,
    })),
  };
  body.innerHTML = `<pre class="lv-raw">${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>`;
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
    cand.addEventListener("mouseenter", () => {
      state.pathHoverHandlers.forEach((h) => h(candidate.edgeSequence));
    });
    cand.addEventListener("mouseleave", () => {
      state.pathHoverHandlers.forEach((h) => h(null));
    });
    cand.addEventListener("click", (e) => {
      e.stopPropagation();
      state.selectedScenarioIdx = sIdx;
      state.selectedCandidateIdx = cIdx;
      state.pathClickHandlers.forEach((h) => h(candidate.edgeSequence));
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
}

function updateItemSelected(state: InternalState): void {
  state.container.querySelectorAll<HTMLElement>(".lv-item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.ref === state.selectedEntity);
  });
}

function applyEntityHover(state: InternalState, ref: EntityRef | null): void {
  state.container.querySelectorAll<HTMLElement>(".lv-item.hovered, .lv-trace-entry.hovered")
    .forEach((el) => el.classList.remove("hovered"));
  if (!ref) return;
  const items = state.container.querySelectorAll<HTMLElement>(`.lv-item[data-ref="${cssEscape(ref)}"], .lv-trace-entry[data-ref="${cssEscape(ref)}"]`);
  items.forEach((el) => {
    el.classList.add("hovered");
  });
  // 滚动到第一个匹配项
  if (items.length > 0 && state.activeTab === "topology") {
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
  return value.replace(/[&<>"']/g, (ch) => ({
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
