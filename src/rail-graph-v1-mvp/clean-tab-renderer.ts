import type { InternalState } from "./list-view";
import { polylineLengthMeters } from "./spatial-helpers";

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Helper utility for escaping HTML characters to prevent XSS. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value: string): string {
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

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render the inspector table showing detailed feature properties. */
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

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render the upper head panel (confidence checkbox, reports, search, select-mode) of Clean tab. */
export function renderCleanHead(state: InternalState, headContainer: HTMLElement): void {
  const { source, cleanOverrides, activeLevels, searchQuery, selectMode, selectionQueueFids, cleanPipelineReport } = state.input;
  if (!source) return;

  const allFeatures = source.features || [];
  const keepSet = new Set(cleanOverrides?.keep || []);
  const removeSet = new Set(cleanOverrides?.remove || []);

  const localKeepCount = allFeatures.filter((f: any) => keepSet.has(fidOf(f))).length;
  const localRemoveCount = allFeatures.filter((f: any) => removeSet.has(fidOf(f))).length;

  const levels = activeLevels || { high: true, medium: true, low: true };
  const query = searchQuery || "";
  const isSelectMode = !!selectMode;

  const levelCounts = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const f of allFeatures) {
    const lv = ((f.properties || {}) as any).match_level;
    if (lv === "high") levelCounts.high += 1;
    else if (lv === "medium") levelCounts.medium += 1;
    else if (lv === "low") levelCounts.low += 1;
    else levelCounts.unknown += 1;
  }

  const reportBlock = renderPipelineReportHtml(cleanPipelineReport);

  // Preserve focus of search box
  const searchBox = headContainer.querySelector(".lv-clean-search") as HTMLInputElement | null;
  const isSearchFocused = searchBox && document.activeElement === searchBox;
  const selectionStart = isSearchFocused ? searchBox.selectionStart : null;
  const selectionEnd = isSearchFocused ? searchBox.selectionEnd : null;

  // Staging area HTML helper (to be implemented in PR-B)
  const stagingHtml = (state.input as any).renderStagingPanelHtml
    ? (state.input as any).renderStagingPanelHtml(state)
    : "";

  headContainer.innerHTML = `
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

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render the dynamic filter rules configuration checkboxes panel of Clean tab. */
export function renderCleanRules(state: InternalState, rulesContainer: HTMLElement): void {
  const { filterRules, activeFilters } = state.input;
  const rules = filterRules || [];
  const filters = activeFilters || {};

  rulesContainer.innerHTML = `
    <div style="font-size:11px; font-weight:600; color:#64748b; margin-bottom:1px;">Dynamic Filter Rules:</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:10.5px;">
      ${rules.map(rule => `
        <label title="${escapeAttr(rule.desc || '')}" style="display:flex; align-items:center; gap:4px; cursor:pointer; min-width:0;">
          <input type="checkbox" class="lv-clean-rule-chk" data-rule-id="${escapeAttr(rule.id)}" ${filters[rule.id] ? "checked" : ""}/>
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(rule.label)}</span>
        </label>
      `).join("")}
    </div>
  `;
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render and reconcile the scrollable candidates list using keyed DOM nodes. */
export function renderCleanCandidates(state: InternalState, candidates: any[], listContainer: HTMLElement): void {
  const { cleanOverrides, selectedCandidateFid, selectionQueueFids } = state.input;
  const keepSet = new Set(cleanOverrides?.keep || []);
  const removeSet = new Set(cleanOverrides?.remove || []);
  const overrideMeta = cleanOverrides?.meta || {};

  if (!state.cleanCardByFid) {
    state.cleanCardByFid = new Map();
  }

  // 1. Reconcile deleted nodes
  const currentFids = new Set(candidates.map(c => fidOf(c)));
  state.cleanCardByFid.forEach((card, fid) => {
    if (!currentFids.has(fid)) {
      card.remove();
      state.cleanCardByFid.delete(fid);
    }
  });

  if (candidates.length === 0) {
    listContainer.innerHTML = `<div class="lv-empty">No candidates match filters.</div>`;
    return;
  }

  // Remove empty placeholder div if it exists
  const emptyDiv = listContainer.querySelector(".lv-empty");
  if (emptyDiv) emptyDiv.remove();

  // 2. Add or update remaining nodes and position them in order
  candidates.forEach((c, index) => {
    const fid = fidOf(c);
    let card = state.cleanCardByFid.get(fid);
    if (!card) {
      card = document.createElement("div");
      card.className = "lv-clean-item-card";
      card.dataset.fid = fid;
      listContainer.appendChild(card);
      state.cleanCardByFid.set(fid, card);
    }

    const props = (c.properties || {}) as any;
    const isRemove = removeSet.has(fid);
    const isKeep = keepSet.has(fid);
    const meta = (overrideMeta as Record<string, any>)[fid] || {};
    const reason = meta.reason || "";
    const isSelected = selectedCandidateFid === fid;
    const isQueued = !!selectionQueueFids?.has(fid);

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
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Render properties detail of selected candidate. */
export function renderCleanDetail(state: InternalState, selectedCandidate: any, detailContainer: HTMLElement): void {
  detailContainer.innerHTML = `
    <div style="font-weight:700; color:#334155; margin-bottom:4px;">Candidate Properties Inspector</div>
    ${selectedCandidate ? renderInspectorTable(selectedCandidate) : `<div class="lv-empty" style="padding:4px 0;">Select a candidate in list or map to view properties.</div>`}
  `;
}
