import type { InternalState } from "./list-view";
import { polylineLengthMeters } from "./spatial-helpers";
import { RULE_PARAM_SCHEMAS } from "./rule-param-schema";

/* 仅对规则处理器类型获取函数添加简短中英注释 / Helper to determine rule handler type from rule object. */
export function getRuleHandlerType(rule: any): string | undefined {
  if (rule.handler && typeof rule.handler.type === "string") {
    return rule.handler.type;
  }
  if (rule.post_filter && typeof rule.post_filter.type === "string") {
    return rule.post_filter.type;
  }
  if (rule.dynamic) {
    return "dynamic_match";
  }
  if (Array.isArray(rule.exclude_if)) {
    return "exclude_if";
  }
  return undefined;
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Helper utility for escaping HTML characters to prevent XSS. */
function escapeHtml(value: any): string {
  const str = (value === undefined || value === null) ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value: any): string {
  return escapeHtml(value);
}

function cssEscape(val: string): string {
  if (typeof window !== "undefined" && window.CSS && window.CSS.escape) {
    return window.CSS.escape(val);
  }
  return val.replace(/(:|\.|\/)/g, "\\$1");
}

function fidOf(f: any): string {
  const props = f.properties || {};
  return props._fid || `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
}

const CLEAN_CANDIDATE_INITIAL_LIMIT = 180;
const CLEAN_CANDIDATE_LIMIT_STEP = 320;

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render pipeline filter rules execution report as expandable details panel. */
function renderPipelineReportHtml(report: any): string {
  if (!report || !report.phaseReports || report.phaseReports.length === 0) return "";
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

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render the properties inspector table. */
export function renderInspectorTable(feature: any): string {
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

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render the staging extraction panel with origin, terminus, via points, BFS candidates and export button. */
function renderStagingPanelHtml(state: InternalState): string {
  const staging = state.input.staging || { via: [], stagedWayFids: [] };
  const origin = staging.origin || "";
  const terminus = staging.terminus || "";
  const via = staging.via || [];
  const candidates = staging.candidates || [];
  const activeCandidateIndex = staging.activeCandidateIndex ?? 0;
  const isSelectMode = state.input.selectMode;
  
  const pickOriginActive = isSelectMode === "staging-origin";
  const pickTerminusActive = isSelectMode === "staging-terminus";
  const pickViaActive = isSelectMode === "staging-via";

  let viaListHtml = "";
  if (via.length > 0) {
    viaListHtml = `
      <div style="display:flex; flex-direction:column; gap:2px; margin-left:12px; margin-top:2px; margin-bottom:2px;">
        ${via.map((v: string, idx: number) => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; padding:2px 6px; border-radius:3px; font-size:10px;">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:85%;">Via ${idx + 1}: <b>${escapeHtml(v.split(":")[1] || v)}</b></span>
            <button class="lv-clean-staging-delete-via" data-index="${idx}" style="border:none; background:transparent; cursor:pointer; color:#dc2626; padding:0 2px; font-weight:700;">×</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  const queueFids = Array.from(state.input.selectionQueueFids || []);
  const stagedWayFids = staging.stagedWayFids || [];
  const unionFids = Array.from(new Set([...queueFids, ...stagedWayFids]));

  let candidatesHtml = "";
  if (candidates.length > 0 || unionFids.length > 0) {
    const candidateNav = candidates.length > 0 ? `
      <div style="display:flex; align-items:center; gap:6px; font-size:10.5px; margin-top:4px; padding:3px 6px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px;">
        <button class="lv-clean-staging-prev-candidate lv-clean-act-btn" style="padding:2px 4px; font-size:9.5px;" ${activeCandidateIndex <= 0 ? "disabled" : ""}>◀◀ Prev</button>
        <span style="flex:1; text-align:center; font-weight:600; color:#16a34a;">Candidate ${activeCandidateIndex + 1} / ${candidates.length}</span>
        <button class="lv-clean-staging-next-candidate lv-clean-act-btn" style="padding:2px 4px; font-size:9.5px;" ${activeCandidateIndex >= candidates.length - 1 ? "disabled" : ""}>Next ▶▶</button>
        <button class="lv-clean-staging-delete-candidate" style="padding:2px 6px; font-size:9.5px; border:1px solid #fca5a5; background:#fef2f2; color:#dc2626; border-radius:3px; cursor:pointer; font-weight:700;" title="Delete this candidate">🗑</button>
      </div>
      <div style="margin-top:4px; display:flex; gap:4px;">
        <button class="lv-clean-staging-commit-queue primary" style="flex:1; font-size:10px; padding:4px 6px; background:#4f46e5; border-color:#4f46e5; color:#fff; cursor:pointer; font-weight:700;">
          📥 Solidify Current → Queue
        </button>
        <button class="lv-clean-staging-merge-all-queue" style="flex:1; font-size:10px; padding:4px 6px; background:#7c3aed; border:1px solid #7c3aed; color:#fff; cursor:pointer; font-weight:700; border-radius:4px;">
          ⊕ Merge All → Queue
        </button>
      </div>
    ` : "";

    candidatesHtml = `
      ${candidateNav}
      <div style="font-size:10px; color:#64748b; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Queue (${unionFids.length}): <span style="font-family:ui-monospace,monospace; color:#334155;">${unionFids.map((f: string) => f.split(":")[1] || f).join(", ")}</span></div>
    `;
  }

  return `
    <details style="font-size:10.5px; border:1px solid #cbd5e1; border-radius:4px; padding:4px 6px; margin-top:2px;" open>
      <summary style="cursor:pointer; color:#334155; font-weight:700; user-select:none;">📍 Staging Line Extraction</summary>
      <div style="margin-top:4px; display:flex; flex-direction:column; gap:4px;">
        
        <!-- Origin slot -->
        <div style="display:flex; align-items:center; gap:4px;">
          <span style="width:50px; color:#64748b;">Origin:</span>
          <span style="flex:1; border:1px solid #e2e8f0; background:#f8fafc; padding:2px 4px; border-radius:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(origin)}">
            ${origin ? `<b>${escapeHtml(origin.split(":")[1] || origin)}</b>` : `<span style="color:#94a3b8;">Not selected</span>`}
          </span>
          <button class="lv-clean-staging-pick-origin lv-clean-act-btn ${pickOriginActive ? "active" : ""}" style="padding:2px 6px; ${pickOriginActive ? "background:#f59e0b; color:#fff;" : ""}">
            ${pickOriginActive ? "Click Map..." : "Pick"}
          </button>
        </div>

        <!-- Terminus slot -->
        <div style="display:flex; align-items:center; gap:4px;">
          <span style="width:50px; color:#64748b;">Terminus:</span>
          <span style="flex:1; border:1px solid #e2e8f0; background:#f8fafc; padding:2px 4px; border-radius:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(terminus)}">
            ${terminus ? `<b>${escapeHtml(terminus.split(":")[1] || terminus)}</b>` : `<span style="color:#94a3b8;">Not selected</span>`}
          </span>
          <button class="lv-clean-staging-pick-terminus lv-clean-act-btn ${pickTerminusActive ? "active" : ""}" style="padding:2px 6px; ${pickTerminusActive ? "background:#f59e0b; color:#fff;" : ""}">
            ${pickTerminusActive ? "Click Map..." : "Pick"}
          </button>
        </div>

        <!-- Via list -->
        <div style="display:flex; align-items:center; gap:4px;">
          <span style="width:50px; color:#64748b;">Via (${via.length}):</span>
          <span style="flex:1;"></span>
          <button class="lv-clean-staging-pick-add-via lv-clean-act-btn ${pickViaActive ? "active" : ""}" style="padding:2px 6px; ${pickViaActive ? "background:#f59e0b; color:#fff;" : ""}">
            ${pickViaActive ? "Click Map..." : "Pick Add"}
          </button>
        </div>
        ${viaListHtml}

        <!-- Actions -->
        <div style="display:flex; gap:4px; margin-top:4px;">
          <button class="lv-clean-staging-find-path primary strong" style="flex:1; font-size:10px; padding:3px 6px;" ${(!origin || !terminus) ? "disabled" : ""}>Find Path</button>
          <button class="lv-clean-staging-clear-all" style="font-size:10px; padding:3px 6px; border:1px solid #cbd5e1; background:#fff; border-radius:4px; cursor:pointer;">Clear All</button>
        </div>

        ${candidatesHtml}

        ${unionFids.length > 0 ? `
          <div style="margin-top:4px; border-top:1px dashed #e2e8f0; padding-top:4px; display:flex; gap:4px;">
            <button class="lv-clean-staging-export primary strong" style="flex:1; font-size:10.5px; padding:4px 8px; background:#16a34a; border-color:#16a34a; color:#fff; cursor:pointer;">
              Export Queue → New Workspace
            </button>
            <button class="lv-clean-staging-clear-queue" style="font-size:10.5px; padding:4px 8px; border:1px solid #fca5a5; background:#fef2f2; color:#dc2626; border-radius:4px; cursor:pointer; font-weight:700;" title="Clear queue">🗑</button>
          </div>
        ` : ""}
      </div>
    </details>
  `;;
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render the upper head panel of Clean tab. */
export function renderCleanHead(state: InternalState, headContainer: HTMLElement): void {
  const { source, cleanOverrides, activeLevels, searchQuery, selectMode, cleanPipelineReport } = state.input;
  if (!source) return;

  const featureByFid = state.cleanFeatureByFid;
  const keepFids = cleanOverrides?.keep || [];
  const removeFids = cleanOverrides?.remove || [];
  const localKeepCount = featureByFid
    ? keepFids.reduce((count: number, fid: string) => count + (featureByFid.has(fid) ? 1 : 0), 0)
    : keepFids.length;
  const localRemoveCount = featureByFid
    ? removeFids.reduce((count: number, fid: string) => count + (featureByFid.has(fid) ? 1 : 0), 0)
    : removeFids.length;

  const levels = activeLevels || { high: true, medium: true, low: true };
  const query = searchQuery || "";
  const isSelectMode = !!selectMode;
  const levelCounts = state.cleanLevelCounts || { high: 0, medium: 0, low: 0, unknown: 0 };
  const totalFeatures = state.cleanSourceTotal ?? source.features?.length ?? 0;

  const reportBlock = renderPipelineReportHtml(cleanPipelineReport);

  // Preserve focus of search box
  const searchBox = headContainer.querySelector(".lv-clean-search") as HTMLInputElement | null;
  const isSearchFocused = searchBox && document.activeElement === searchBox;
  const selectionStart = isSearchFocused ? searchBox.selectionStart : null;
  const selectionEnd = isSearchFocused ? searchBox.selectionEnd : null;

  const stagingHtml = renderStagingPanelHtml(state);

  headContainer.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <span style="font-weight:700; font-size:13px; color:#0f172a;">Manual Cleaning Override</span>
      <span class="lv-clean-stats" style="font-size:10.5px; color:#64748b; font-weight:600;">
        Keep: <span style="color:#16a34a;">${localKeepCount}</span> | Remove: <span style="color:#dc2626;">${localRemoveCount}</span> (Total: ${totalFeatures})
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

    ${stagingHtml}

    <!-- Search box & Select mode -->
    <div style="display:flex; gap:6px; align-items:center;">
      <input type="text" class="lv-clean-search" placeholder="Search by name, ID or station..." value="${escapeAttr(query)}" style="flex:1; font-size:11px; padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; height:24px;" />
      <button class="lv-clean-selmode-btn ${isSelectMode ? "active" : ""}" style="font-size:11px; padding:4px 8px; border:1px solid ${isSelectMode ? "#f59e0b" : "#cbd5e1"}; border-radius:4px; cursor:pointer; font-weight:700; display:flex; align-items:center; justify-content:center; height:24px; gap:2px; background:${isSelectMode ? "#fef3c7" : "#fff"}; color:${isSelectMode ? "#92400e" : "#334155"};">
        ✏️ ${isSelectMode ? "Exit Select" : "Select Mode"}
      </button>
    </div>
    ${isSelectMode ? `<div style="font-size:10.5px; color:#92400e; background:#fffbeb; border:1px dashed #f59e0b; border-radius:4px; padding:4px 6px;">Click candidates or <b>Shift+drag</b> on map to queue. Use the floating bar to Remove / Keep / Cancel.</div>` : ``}
  `;

  if (isSearchFocused) {
    const newSearchBox = headContainer.querySelector(".lv-clean-search") as HTMLInputElement | null;
    if (newSearchBox) {
      newSearchBox.focus();
      if (selectionStart !== null && selectionEnd !== null) {
        newSearchBox.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }
}

/* 仅对过滤规则面板渲染添加简短中英注释 / Render the dynamic filter rules checkboxes and inline setting panel. */
export function renderCleanRules(state: InternalState, rulesContainer: HTMLElement): void {
  const { filterRules, activeFilters, ruleParamOverrides } = state.input;
  const rules = filterRules || [];
  const filters = activeFilters || {};

  let html = `<div style="font-size:11px; font-weight:600; color:#64748b; margin-bottom:4px;">Dynamic Filter Rules:</div>`;
  html += `<div style="display:flex; flex-direction:column; gap:4px; font-size:10.5px;">`;

  for (const rule of rules) {
    const handlerType = getRuleHandlerType(rule);
    const schema = handlerType ? RULE_PARAM_SCHEMAS[handlerType] : undefined;
    const overrides = ruleParamOverrides?.[rule.id] || {};
    const hasOverrides = Object.keys(overrides).length > 0;
    const isExpanded = state.expandedRuleParams?.has(rule.id);

    html += `
      <div style="border:1px solid #e2e8f0; border-radius:4px; padding:4px 6px; background:${hasOverrides ? '#fffbeb' : '#fff'}; border-color:${hasOverrides ? '#fef08a' : '#e2e8f0'};">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:4px;">
          <label title="${escapeAttr(rule.desc || '')}" style="display:flex; align-items:center; gap:4px; cursor:pointer; min-width:0; flex:1;">
            <input type="checkbox" class="lv-clean-rule-chk" data-rule-id="${escapeAttr(rule.id)}" ${filters[rule.id] ? "checked" : ""}/>
            <span style="font-weight:600; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(rule.label)}</span>
            ${hasOverrides ? `<span style="font-size:9px; background:#fef08a; color:#854d0e; padding:1px 3px; border-radius:3px; font-weight:700; scale:0.9;">overridden</span>` : ''}
          </label>
          ${schema ? `
            <button class="lv-clean-rule-gear-btn" data-rule-id="${escapeAttr(rule.id)}" style="border:1px solid #cbd5e1; background:#fff; border-radius:3px; padding:1px 4px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:10px; color:#475569; ${isExpanded ? 'background:#f1f5f9;' : ''}" title="Configure Rule Parameters">
              ⚙️
            </button>
          ` : ''}
        </div>
    `;

    if (schema && isExpanded) {
      html += `
        <div style="margin-top:6px; border-top:1px dashed #cbd5e1; padding-top:6px; display:flex; flex-direction:column; gap:4px; background:#f8fafc; padding:6px; border-radius:4px;">
          <div style="font-weight:700; color:#475569; margin-bottom:2px; font-size:10px;">Rule Overrides (${escapeHtml(rule.id)}):</div>
      `;

      for (const field of schema.fields) {
        const currentVal = overrides[field.key] !== undefined
          ? overrides[field.key]
          : (rule.handler?.params?.[field.key] !== undefined
            ? rule.handler.params[field.key]
            : (rule.post_filter?.[field.key] !== undefined
              ? rule.post_filter[field.key]
              : (rule.dynamic?.[field.key] !== undefined
                ? rule.dynamic[field.key]
                : field.defaultValue)));

        let inputHtml = "";
        if (field.type === "boolean") {
          inputHtml = `<input type="checkbox" class="lv-rule-param-input" data-rule-id="${escapeAttr(rule.id)}" data-param-key="${escapeAttr(field.key)}" ${currentVal ? "checked" : ""} style="cursor:pointer;" />`;
        } else if (field.type === "number") {
          inputHtml = `<input type="number" class="lv-rule-param-input" data-rule-id="${escapeAttr(rule.id)}" data-param-key="${escapeAttr(field.key)}" value="${currentVal}" style="width: 60px; font-size:10px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:3px;" />`;
        } else if (field.type === "string[]") {
          const valStr = Array.isArray(currentVal) ? currentVal.join(", ") : String(currentVal || "");
          inputHtml = `<input type="text" class="lv-rule-param-input" data-rule-id="${escapeAttr(rule.id)}" data-param-key="${escapeAttr(field.key)}" value="${escapeAttr(valStr)}" style="flex:1; font-size:10px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:3px;" title="Comma separated list" />`;
        } else if (field.type === "string") {
          if (field.key === "target_line_field") {
            inputHtml = `
              <select class="lv-rule-param-input" data-rule-id="${escapeAttr(rule.id)}" data-param-key="${escapeAttr(field.key)}" style="font-size:10px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:3px;">
                <option value="source_line_name" ${currentVal === "source_line_name" ? "selected" : ""}>source_line_name</option>
                <option value="name" ${currentVal === "name" ? "selected" : ""}>name</option>
              </select>
            `;
          } else {
            inputHtml = `<input type="text" class="lv-rule-param-input" data-rule-id="${escapeAttr(rule.id)}" data-param-key="${escapeAttr(field.key)}" value="${escapeAttr(String(currentVal || ''))}" style="flex:1; font-size:10px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:3px;" />`;
          }
        }

        html += `
          <div style="display:flex; align-items:center; gap:6px; font-size:10px;">
            <span style="width:110px; color:#64748b; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${escapeAttr(field.description || '')}">${escapeHtml(field.label)}:</span>
            ${inputHtml}
          </div>
        `;
      }

      html += `
          <div style="display:flex; justify-content:flex-end; margin-top:2px;">
            <button class="lv-rule-param-reset" data-rule-id="${escapeAttr(rule.id)}" style="font-size:9.5px; padding:2px 6px; cursor:pointer; border:1px solid #cbd5e1; background:#fff; border-radius:3px; color:#ef4444; font-weight:700;">
              Reset to defaults
            </button>
          </div>
        </div>
      `;
    }

    html += `</div>`;
  }

  html += `</div>`;
  rulesContainer.innerHTML = html;
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render and reconcile the scrollable candidates list using keyed DOM nodes. */
export function renderCleanCandidates(state: InternalState, candidates: any[], listContainer: HTMLElement): void {
  const { cleanOverrides, selectedCandidateFid, selectionQueueFids, staging } = state.input;
  const keepSet = new Set(cleanOverrides?.keep || []);
  const removeSet = new Set(cleanOverrides?.remove || []);
  const overrideMeta = cleanOverrides?.meta || {};
  const stagedSet = new Set(staging?.stagedWayFids || []);

  if (!state.cleanCardByFid) {
    state.cleanCardByFid = new Map();
  }
  const cleanCardByFid = state.cleanCardByFid;

  const firstFid = candidates.length > 0 ? fidOf(candidates[0]) : "";
  const lastFid = candidates.length > 0 ? fidOf(candidates[candidates.length - 1]) : "";
  const levelsSig = Object.entries(state.input.activeLevels || {}).map(([k, v]) => `${k}:${v ? 1 : 0}`).join(",");
  const filtersSig = Object.entries(state.input.activeFilters || {}).map(([k, v]) => `${k}:${v ? 1 : 0}`).join(",");
  const candidateSig = `${candidates.length}|${firstFid}|${lastFid}|${state.input.searchQuery || ""}|${levelsSig}|${filtersSig}`;
  if (state.cleanLastCandidateSig !== candidateSig) {
    state.cleanLastCandidateSig = candidateSig;
    state.cleanRenderLimit = CLEAN_CANDIDATE_INITIAL_LIMIT;
    state.cleanCandidateIndexByFid = new Map();
    cleanCardByFid.clear();
    listContainer.replaceChildren();
    listContainer.scrollTop = 0;
  }

  listContainer.querySelector(".lv-empty")?.remove();
  listContainer.querySelector(".lv-clean-window-footer")?.remove();

  if (candidates.length === 0) {
    cleanCardByFid.clear();
    listContainer.innerHTML = `<div class="lv-empty">No candidates match filters.</div>`;
    return;
  }

  const currentLimit = Math.min(state.cleanRenderLimit ?? CLEAN_CANDIDATE_INITIAL_LIMIT, candidates.length);
  let selectedIndex = -1;
  if (selectedCandidateFid) {
    let candidateIndexByFid = state.cleanCandidateIndexByFid;
    if (!candidateIndexByFid || candidateIndexByFid.size === 0) {
      candidateIndexByFid = new Map();
      for (let i = 0; i < candidates.length; i += 1) {
        candidateIndexByFid.set(fidOf(candidates[i]), i);
      }
      state.cleanCandidateIndexByFid = candidateIndexByFid;
    }
    selectedIndex = candidateIndexByFid.get(selectedCandidateFid) ?? -1;
  }
  const visibleCandidates = candidates.slice(0, currentLimit);
  if (selectedIndex >= currentLimit) {
    visibleCandidates.push(candidates[selectedIndex]);
  }
  const currentFids = new Set(visibleCandidates.map((c) => fidOf(c)));
  cleanCardByFid.forEach((card, fid) => {
    if (!currentFids.has(fid)) {
      card.remove();
      cleanCardByFid.delete(fid);
    }
  });

  visibleCandidates.forEach((c, index) => {
    const fid = fidOf(c);
    let card = cleanCardByFid.get(fid);
    if (!card) {
      card = document.createElement("div");
      card.className = "lv-clean-item-card";
      card.dataset.fid = fid;
      listContainer.appendChild(card);
      cleanCardByFid.set(fid, card);
    }

    const props = (c.properties || {}) as any;
    const isRemove = removeSet.has(fid);
    const isKeep = keepSet.has(fid);
    const meta = (overrideMeta as Record<string, any>)[fid] || {};
    const reason = meta.reason || "";
    const isSelected = selectedCandidateFid === fid;
    const isQueued = !!selectionQueueFids?.has(fid) || stagedSet.has(fid);

    let borderStyle = "border-left: 4px solid #cbd5e1;";
    let bgStyle = "background:#fff;";
    let textDecoration = "";
    let outline = "";
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
    if (isQueued) {
      outline = "outline:2px dashed #f59e0b; outline-offset:-2px;";
      bgStyle = "background:#fffbeb;";
    }

    card.style.cssText = `border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; font-size:11px; transition:all 100ms; ${borderStyle} ${bgStyle} ${outline}`;
    card.className = `lv-clean-item-card${isQueued ? ' queued' : ''}`;

    const sig = `${isRemove ? 1 : 0}|${isKeep ? 1 : 0}|${isSelected ? 1 : 0}|${isQueued ? 1 : 0}|${reason}`;
    if (card.dataset.sig === sig) {
      if (listContainer.children[index] !== card) {
        listContainer.insertBefore(card, listContainer.children[index] || null);
      }
      return;
    }
    card.dataset.sig = sig;

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
        <span style="font-weight:600; ${textDecoration}">${isQueued ? '<span title="In select queue" style="color:#f59e0b; margin-right:3px;">●</span>' : ''}${escapeHtml(props.name || props.osm_id || "unnamed")}</span>
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
    `;

    const reasonInput = card.querySelector(".lv-clean-reason-input") as HTMLInputElement | null;
    const isInputFocused = reasonInput && document.activeElement === reasonInput;
    if (!isInputFocused) {
      card.innerHTML = html;
    } else {
      const keepBtn = card.querySelector(".lv-clean-act-btn.keep");
      if (keepBtn) keepBtn.classList.toggle("active", isKeep);
      const removeBtn = card.querySelector(".lv-clean-act-btn.remove");
      if (removeBtn) removeBtn.classList.toggle("active", isRemove);
      const textSpan = card.querySelector("span[style*='font-weight:600']");
      if (textSpan) {
        (textSpan as HTMLElement).style.cssText = `font-weight:600; ${textDecoration}`;
      }
    }

    if (listContainer.children[index] !== card) {
      listContainer.insertBefore(card, listContainer.children[index] || null);
    }
  });

  if (currentLimit < candidates.length) {
    const footer = document.createElement("div");
    footer.className = "lv-clean-window-footer";
    footer.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 2px 2px; font-size:10.5px; color:#64748b;";
    footer.innerHTML = `
      <span>Showing ${visibleCandidates.length} / ${candidates.length}</span>
      <button class="lv-clean-load-more" style="font-size:10.5px; padding:3px 8px; border:1px solid #cbd5e1; border-radius:4px; background:#fff; cursor:pointer;">Load more</button>
    `;
    listContainer.appendChild(footer);
  }
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Update only clean card selected state without rebuilding the list. */
export function updateCleanCandidateSelection(state: InternalState, previousFid: string | null, nextFid: string | null): void {
  const cleanOverrides = state.input.cleanOverrides;
  const selectionQueueFids = state.input.selectionQueueFids;
  const stagedSet = new Set(state.input.staging?.stagedWayFids || []);
  const keepSet = new Set(cleanOverrides?.keep || []);
  const removeSet = new Set(cleanOverrides?.remove || []);
  const overrideMeta = cleanOverrides?.meta || {};

  const updateCard = (fid: string | null) => {
    if (!fid) return;
    const card = state.cleanCardByFid?.get(fid);
    const feature = state.cleanFeatureByFid?.get(fid);
    if (!card || !feature) return;
    updateCleanCandidateCard(
      card,
      feature,
      fid,
      {
        isRemove: removeSet.has(fid),
        isKeep: keepSet.has(fid),
        isSelected: nextFid === fid,
        isQueued: !!selectionQueueFids?.has(fid) || stagedSet.has(fid),
        reason: ((overrideMeta as Record<string, any>)[fid] || {}).reason || "",
      },
    );
  };

  updateCard(previousFid);
  updateCard(nextFid);
}

function updateCleanCandidateCard(
  card: HTMLElement,
  c: any,
  fid: string,
  state: { isRemove: boolean; isKeep: boolean; isSelected: boolean; isQueued: boolean; reason: string },
): void {
  const props = (c.properties || {}) as any;
  const { isRemove, isKeep, isSelected, isQueued, reason } = state;

  let borderStyle = "border-left: 4px solid #cbd5e1;";
  let bgStyle = "background:#fff;";
  let textDecoration = "";
  let outline = "";
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
  if (isQueued) {
    outline = "outline:2px dashed #f59e0b; outline-offset:-2px;";
    bgStyle = "background:#fffbeb;";
  }

  card.style.cssText = `border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; cursor:pointer; font-size:11px; transition:all 100ms; ${borderStyle} ${bgStyle} ${outline}`;
  card.className = `lv-clean-item-card${isQueued ? ' queued' : ''}`;

  const sig = `${isRemove ? 1 : 0}|${isKeep ? 1 : 0}|${isSelected ? 1 : 0}|${isQueued ? 1 : 0}|${reason}`;
  if (card.dataset.sig === sig) return;
  card.dataset.sig = sig;

  const html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
      <span style="font-weight:600; ${textDecoration}">${isQueued ? '<span title="In select queue" style="color:#f59e0b; margin-right:3px;">●</span>' : ''}${escapeHtml(props.name || props.osm_id || "unnamed")}</span>
      <span class="lv-clean-level-badge ${props.match_level || 'low'}">
        ${props.match_level || 'low'} (${(props.match_score || 0).toFixed(2)})
      </span>
    </div>
    <div style="font-size:10px; color:#64748b; margin-bottom:4px; display:grid; grid-template-columns:1fr; gap:1px;">
      <div>Class: <b style="color:#475569;">${escapeHtml(props.class_main || "—")}</b> · Osm: <span>${escapeHtml(props.osm_type || "—")}/${escapeHtml(props.osm_id || "—")}</span></div>
      <div>Station: <span>${escapeHtml(props.nearest_station || "—")}</span></div>
    </div>
    <div style="display:flex; gap:4px; align-items:center; margin-top:4px;">
      <button class="lv-clean-act-btn keep ${isKeep ? 'active' : ''}" data-fid="${escapeAttr(fid)}" data-action="keep">Keep</button>
      <button class="lv-clean-act-btn remove ${isRemove ? 'active' : ''}" data-fid="${escapeAttr(fid)}" data-action="remove">Remove</button>
      <button class="lv-clean-act-btn reset" data-fid="${escapeAttr(fid)}" data-action="reset">Reset</button>
      <input type="text" class="lv-clean-reason-input" data-fid="${escapeAttr(fid)}" placeholder="Reason/Justification..." value="${escapeAttr(reason)}" style="flex:1; min-width:0; font-size:10px; padding:2px 4px; border:1px solid #cbd5e1; border-radius:4px; height:18px;" />
    </div>
  `;

  const reasonInput = card.querySelector(".lv-clean-reason-input") as HTMLInputElement | null;
  if (!reasonInput || document.activeElement !== reasonInput) {
    card.innerHTML = html;
  }
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render properties detail of selected candidate. */
export function renderCleanDetail(state: InternalState, selectedCandidate: any, detailContainer: HTMLElement): void {
  detailContainer.innerHTML = `
    <div style="font-weight:700; color:#334155; margin-bottom:4px;">Candidate Properties Inspector</div>
    ${selectedCandidate ? renderInspectorTable(selectedCandidate) : `<div class="lv-empty" style="padding:4px 0;">Select a candidate in list or map to view properties.</div>`}
  `;
}
