// ============================================================
// Goal 02 / PR 3 Verify · UserEvent + L4 联动
//
// 用法:
//   npm run rail:aggregate:verify:events
//
// 前置: PR1 + PR2 已完成 (aggregate + patterns + crossPath 可加载)
//
// 设计同前: 静态 import 期望模块, 缺则 tsx 报错; 数据不足 DATA NOT READY; 全就绪跑断言。
//
// L4 联动定义 (本期):
//   给定 PathLike { edgeSequence, stationSequence }, 沿 stationSequence 收集 anchor=station 的 events,
//   沿 edgeSequence 收集 anchor=edge 的 events; 输出按 orderIndex 升序的 OrderedEvent[].
//   多 event 锚到同一 station/edge 时 orderIndex 相同, tiebreak 按 event.id 字典序.
// ============================================================

import fs from "node:fs";
import path from "node:path";

// ── PR1 模块 ───────────────────────────────────────────────────
import { loadAggregate, type AggregateState } from "../rail-graph-aggregate/aggregate-state";
import { loadServicePatterns, type StoredServicePattern } from "../rail-graph-aggregate/service-pattern/store";

// ── PR2 模块 ───────────────────────────────────────────────────
import { buildTransferGraph } from "../rail-graph-aggregate/cross-pattern/transfer-graph";
import { resolveCrossPattern, type CrossPatternPath } from "../rail-graph-aggregate/cross-pattern/resolver";

// ── PR3 新模块 (本期必须创建) ─────────────────────────────────
import {
  loadUserEvents,
  type UserEvent,
} from "../rail-graph-aggregate/user-event/store";
import {
  aggregateEventsAlongPath,
  flattenCrossPathToPathLike,
  type OrderedEvent,
  type PathLike,
} from "../rail-graph-aggregate/user-event/aggregation";

// ── 常量 ──────────────────────────────────────────────────────
const OUT_DIR = path.resolve("src", "rail-graph-aggregate", ".verify");
const PHASE = "events";
const AGGREGATE_KEY = process.env.AGGREGATE_KEY ?? "senseki-tohoku";
const MEMBER_WORKSPACES = (process.env.MEMBER_WORKSPACES ?? "senseki,tohoku-main").split(",").map(s => s.trim()).filter(Boolean);
const PATTERNS_JSON_PATH = process.env.PATTERNS_JSON_PATH
  ?? path.resolve("aggregates", AGGREGATE_KEY, "service-patterns.json");
const EVENTS_JSON_PATH = process.env.EVENTS_JSON_PATH
  ?? path.resolve("aggregates", AGGREGATE_KEY, "user-events.json");

interface Failure { check: string; detail: string; }
const failures: Failure[] = [];
const checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }> = [];

function assert(check: string, condition: boolean, detail: string): void {
  if (condition) checks.push({ check, status: "PASS" });
  else { checks.push({ check, status: "FAIL", detail }); failures.push({ check, detail }); }
}

function writeReport(name: string, data: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function dataNotReady(reason: string, hint: string): never {
  console.error("");
  console.error("====================================================");
  console.error("AGGREGATE VERIFY (PR3 · events): DATA NOT READY");
  console.error("====================================================");
  console.error(`Reason: ${reason}`);
  console.error(`Hint:   ${hint}`);
  process.exit(1);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[verify-events] starting; aggregateKey=${AGGREGATE_KEY}`);

  // ── §1. 资源加载 ──────────────────────────────────────────
  let aggregate: AggregateState;
  let patterns: StoredServicePattern[];
  let events: UserEvent[];
  try {
    aggregate = await loadAggregate({ aggregateKey: AGGREGATE_KEY, memberWorkspaceKeys: MEMBER_WORKSPACES });
    patterns = await loadServicePatterns({ aggregateKey: AGGREGATE_KEY, path: PATTERNS_JSON_PATH });
    events = await loadUserEvents({ aggregateKey: AGGREGATE_KEY, path: EVENTS_JSON_PATH });
  } catch (e) {
    dataNotReady(`资源加载失败: ${(e as Error).message}`, "确认 PR1+PR2 PASS, 且至少 1 个 user-events.json fixture/UI 录入");
  }

  writeReport(`${PHASE}-01-counts.json`, {
    patternCount: patterns.length,
    eventCount: events.length,
    eventsByAnchorKind: events.reduce((acc, e) => {
      const k = e.anchor.kind;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  });

  // ── §2. 数据先验 ──────────────────────────────────────────
  if (events.length < 3) {
    dataNotReady(
      `events.length = ${events.length}, 需要 ≥ 3`,
      "在 UI 中右键 station / edge 创建至少 3 个 UserEvent (含 anchor=station 和 anchor=edge), 或种 fixture",
    );
  }
  const stationAnchored = events.filter(e => e.anchor.kind === "station");
  const edgeAnchored = events.filter(e => e.anchor.kind === "edge");
  assert(
    "至少 1 个 event anchor=station",
    stationAnchored.length >= 1,
    `station-anchored=${stationAnchored.length}`,
  );
  assert(
    "至少 1 个 event anchor=edge",
    edgeAnchored.length >= 1,
    `edge-anchored=${edgeAnchored.length}`,
  );

  // ── §3. 在单 ServicePattern 上聚合 ──────────────────────
  const firstPattern = patterns[0];
  const singlePath: PathLike = {
    edgeSequence: firstPattern.edgeSequence,
    stationSequence: firstPattern.traceSequence.map(t => t.stationRef),
  };

  let singleOrdered: OrderedEvent[];
  let singleErr: string | undefined;
  try {
    singleOrdered = aggregateEventsAlongPath(events, singlePath);
  } catch (e) {
    singleErr = (e as Error).message;
    singleOrdered = [];
  }
  writeReport(`${PHASE}-02-single-pattern-aggregation.json`, {
    pattern: firstPattern.patternId,
    pathEdges: singlePath.edgeSequence.length,
    pathStations: singlePath.stationSequence.length,
    error: singleErr ?? null,
    aggregatedCount: singleOrdered.length,
    aggregated: singleOrdered.map(o => ({
      eventId: o.event.id,
      orderIndex: o.orderIndex,
      anchorKind: o.event.anchor.kind,
      title: o.event.title,
    })),
  });

  assert("aggregateEventsAlongPath 不抛 (single)", singleErr === undefined, singleErr ?? "");

  // orderIndex 单调非降
  let monotonic = true;
  for (let i = 1; i < singleOrdered.length; i++) {
    if (singleOrdered[i].orderIndex < singleOrdered[i - 1].orderIndex) {
      monotonic = false;
      break;
    }
  }
  assert(
    "single pattern: orderIndex 单调非降",
    monotonic,
    `sequence: ${singleOrdered.map(o => o.orderIndex).join(",")}`,
  );

  // 无幽灵 event: aggregated 里的 anchor 都能在 path 上找到
  let ghosts = 0;
  for (const o of singleOrdered) {
    const a = o.event.anchor;
    if (a.kind === "station" && !singlePath.stationSequence.includes(a.stationRef)) ghosts++;
    if (a.kind === "edge" && !singlePath.edgeSequence.includes(a.edgeRef)) ghosts++;
  }
  assert(
    "single pattern: 无幽灵 event (anchor 全部命中)",
    ghosts === 0,
    `ghosts=${ghosts}`,
  );

  // ── §4. 在跨 pattern path 上聚合 ────────────────────────
  let crossPath: CrossPatternPath | null = null;
  try {
    const tg = buildTransferGraph(patterns);
    const pickedOd = pickCrossPatternOd(patterns, tg);
    if (pickedOd) {
      crossPath = resolveCrossPattern({ patterns, transferGraph: tg, from: pickedOd.from, to: pickedOd.to });
    }
  } catch (e) {
    failures.push({ check: "跨 pattern resolve 不抛", detail: (e as Error).message });
  }

  let crossOrdered: OrderedEvent[] = [];
  let crossPathLike: PathLike | null = null;
  if (crossPath) {
    crossPathLike = flattenCrossPathToPathLike(crossPath);
    try {
      crossOrdered = aggregateEventsAlongPath(events, crossPathLike);
    } catch (e) {
      failures.push({ check: "aggregateEventsAlongPath 不抛 (cross)", detail: (e as Error).message });
    }
  }

  writeReport(`${PHASE}-03-cross-pattern-aggregation.json`, {
    crossPath: crossPath
      ? {
        hops: crossPath.hops.length,
        edgeTotal: crossPath.hops.reduce((a, h) => a + h.edgeSequence.length, 0),
        stationTotal: crossPath.hops.reduce((a, h) => a + h.stationSequence.length, 0),
      }
      : null,
    flatPath: crossPathLike
      ? { edges: crossPathLike.edgeSequence.length, stations: crossPathLike.stationSequence.length }
      : null,
    aggregatedCount: crossOrdered.length,
    aggregated: crossOrdered.map(o => ({
      eventId: o.event.id,
      orderIndex: o.orderIndex,
      anchorKind: o.event.anchor.kind,
      title: o.event.title,
    })),
  });

  if (crossPath && crossPathLike) {
    let crossMonotonic = true;
    for (let i = 1; i < crossOrdered.length; i++) {
      if (crossOrdered[i].orderIndex < crossOrdered[i - 1].orderIndex) { crossMonotonic = false; break; }
    }
    assert("cross path: orderIndex 单调非降", crossMonotonic, `sequence: ${crossOrdered.map(o => o.orderIndex).join(",")}`);

    let crossGhosts = 0;
    for (const o of crossOrdered) {
      const a = o.event.anchor;
      if (a.kind === "station" && !crossPathLike.stationSequence.includes(a.stationRef)) crossGhosts++;
      if (a.kind === "edge" && !crossPathLike.edgeSequence.includes(a.edgeRef)) crossGhosts++;
    }
    assert("cross path: 无幽灵 event", crossGhosts === 0, `ghosts=${crossGhosts}`);

    // 至少 1 个 event 同时出现在 ≥ 2 个 hop 中 (跨 pattern event)
    const hopsContainingEvent = (eventId: string): number => {
      let count = 0;
      for (const hop of crossPath.hops) {
        const inHop = events
          .filter(e => e.id === eventId)
          .some(e => {
            const a = e.anchor;
            if (a.kind === "station") return hop.stationSequence.includes(a.stationRef);
            if (a.kind === "edge") return hop.edgeSequence.includes(a.edgeRef);
            return false;
          });
        if (inHop) count++;
      }
      return count;
    };
    const sharedEventIds = events.filter(e => hopsContainingEvent(e.id) >= 2).map(e => e.id);
    writeReport(`${PHASE}-04-shared-event-ids.json`, { sharedEventIds });
    // 这条断言比较 strict — agent 测试时可能需要在 fixture 里放一个共线区间 anchor 的 event
    assert(
      "至少 1 个 event 横跨 ≥ 2 个 hop",
      sharedEventIds.length >= 1,
      `若 fixture 没有跨线 event, 请在 user-events.json 加 1 个锚到 transfer station 的 event`,
    );
  } else {
    failures.push({ check: "跨 pattern path 可解", detail: "crossPath = null; 见 §3.cross-pf verify" });
  }

  // ── §5. 回归 PR1 + PR2 核心断言 ─────────────────────────
  const aggregateEdgeIds = new Set(aggregate.topo.edges.map(e => e.id));
  for (const p of patterns) {
    const missing = p.edgeSequence.filter(eid => !aggregateEdgeIds.has(eid));
    assert(
      `[REGRESS PR1] pattern[${p.patternId}].edgeSequence ⊂ aggregate`,
      missing.length === 0,
      `missing ${missing.length}`,
    );
  }
  assert(
    "[REGRESS PR2] crossPath 非空",
    crossPath !== null,
    "cross-pf 失败 — events L4 联动无法验证 cross 场景",
  );

  // ── §6. summary + banner ────────────────────────────────
  const allPass = failures.length === 0;
  const md = renderSummaryMd({ events: events.length, singleAggregated: singleOrdered.length, crossAggregated: crossOrdered.length, checks, failures });
  writeReport(`${PHASE}-summary.md`, md);

  console.log("");
  console.log("====================================================");
  if (allPass) {
    console.log("AGGREGATE VERIFY (PR3 · events): PASS");
  } else {
    console.log("AGGREGATE VERIFY (PR3 · events): FAIL");
    for (const f of failures) {
      console.log(`  ✗ ${f.check}`);
      console.log(`    ${f.detail}`);
    }
  }
  console.log("====================================================");
  console.log(`Report dir: ${OUT_DIR}`);

  process.exit(allPass ? 0 : 1);
}

// ── 工具 ──────────────────────────────────────────────────────
function pickCrossPatternOd(patterns: StoredServicePattern[], tg: ReturnType<typeof buildTransferGraph>): { from: string; to: string } | null {
  const byId = new Map(patterns.map(p => [p.patternId, p] as const));
  for (const t of tg.transfers) {
    const a = byId.get(t.patternA);
    const b = byId.get(t.patternB);
    if (!a || !b) continue;
    const aStations = a.traceSequence.map(s => s.stationRef);
    const bStations = b.traceSequence.map(s => s.stationRef);
    const aOnly = aStations.filter(s => !bStations.includes(s));
    const bOnly = bStations.filter(s => !aStations.includes(s));
    if (aOnly.length > 0 && bOnly.length > 0) return { from: aOnly[0], to: bOnly[0] };
  }
  return null;
}

function renderSummaryMd(args: {
  events: number;
  singleAggregated: number;
  crossAggregated: number;
  checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }>;
  failures: Failure[];
}): string {
  const L: string[] = [];
  L.push("# Goal02 PR3 · UserEvent L4 Aggregation Verify Summary");
  L.push("");
  L.push(`- Total user events loaded: **${args.events}**`);
  L.push(`- Events aggregated on first pattern: **${args.singleAggregated}**`);
  L.push(`- Events aggregated on cross-pattern path: **${args.crossAggregated}**`);
  L.push("");
  L.push("## Checks");
  for (const c of args.checks) L.push(`- ${c.status === "PASS" ? "✅" : "❌"} ${c.check}${c.detail ? ` — ${c.detail}` : ""}`);
  if (args.failures.length > 0) {
    L.push("");
    L.push("## Failure detail");
    for (const f of args.failures) {
      L.push(`### ✗ ${f.check}`);
      L.push("```");
      L.push(f.detail);
      L.push("```");
    }
  }
  return L.join("\n");
}

main().catch((e) => {
  console.error("verify-events crashed:", e);
  process.exit(1);
});
