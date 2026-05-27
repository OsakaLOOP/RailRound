// ============================================================
// Goal 02 / PR 1 Verify · Aggregate + ServicePattern 编辑器全栈
//
// 用法:
//   npm run rail:aggregate:verify:patterns
//
// 设计 (TDD-style):
//   - import 期望的新模块; 模块未实现时 tsx 直接 "Cannot find module" 失败 — 这是 agent 的 TODO 信号
//   - 模块已实现但数据未备好时, 输出 "DATA NOT READY" 友好提示, exit 1
//   - 全部就绪时跑断言, 写报告到 src/rail-graph-aggregate/.verify/, 末尾打印 PASS/FAIL banner
//
// agent 必读: 失败时先读 .verify/patterns-summary.md, 再按需进 .verify/patterns-*.json
// ============================================================

import fs from "node:fs";
import path from "node:path";

// ── 期望的 agent 新模块 (PR1 必须创建) ─────────────────────────
// 模块路径错或未实现 → tsx 报 "Cannot find module" 即 agent 的下一步 TODO
import {
  loadAggregate,
  type AggregateState,
} from "../rail-graph-aggregate/aggregate-state";
import {
  loadServicePatterns,
  type StoredServicePattern,
} from "../rail-graph-aggregate/service-pattern/store";
import {
  buildPatternRenderPlan,
  type PatternRenderPlan,
} from "../rail-graph-aggregate/service-pattern/render-plan";
import { adaptChainToPattern } from "../rail-graph-aggregate/service-pattern/adapter";

// ── 复用资源 ───────────────────────────────────────────────────
import { findPathsV2 } from "../rail-graph-v1/pathfinding-v2";
import { buildTopologyLookup } from "../rail-graph-v1/topology";
import type { IntentionChain } from "../rail-graph-v1/chain.types";

// ── 常量 ───────────────────────────────────────────────────────
const OUT_DIR = path.resolve("src", "rail-graph-aggregate", ".verify");
const PHASE = "patterns";
const DEFAULT_AGGREGATE_KEY = process.env.AGGREGATE_KEY ?? "senseki-tohoku";
const DEFAULT_MEMBER_WORKSPACES = (process.env.MEMBER_WORKSPACES ?? "senseki,tohoku-main").split(",").map(s => s.trim()).filter(Boolean);
const PATTERNS_JSON_PATH = process.env.PATTERNS_JSON_PATH
  ?? path.resolve("aggregates", DEFAULT_AGGREGATE_KEY, "service-patterns.json");

// ── 报告 writer ────────────────────────────────────────────────
function writeReport(name: string, data: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, name);
  const text = typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(out, text, "utf8");
}

// ── 断言失败累积 ────────────────────────────────────────────────
interface Failure { check: string; detail: string; }
const failures: Failure[] = [];
const checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }> = [];

function assert(check: string, condition: boolean, detail: string): void {
  if (condition) {
    checks.push({ check, status: "PASS" });
  } else {
    checks.push({ check, status: "FAIL", detail });
    failures.push({ check, detail });
  }
}

// ── DATA NOT READY 提示 ────────────────────────────────────────
function dataNotReady(reason: string, hint: string): never {
  console.error("");
  console.error("====================================================");
  console.error("AGGREGATE VERIFY (PR1 · patterns): DATA NOT READY");
  console.error("====================================================");
  console.error(`Reason: ${reason}`);
  console.error(`Hint:   ${hint}`);
  console.error("");
  console.error("This is NOT a code bug — agent should pause and ask the user to prepare data.");
  console.error("Once data is in place, re-run: npm run rail:aggregate:verify:patterns");
  process.exit(1);
}

// ── 主流程 ─────────────────────────────────────────────────────
async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[verify-patterns] starting; aggregateKey=${DEFAULT_AGGREGATE_KEY}, members=[${DEFAULT_MEMBER_WORKSPACES.join(", ")}]`);

  // ── §1. Aggregate 加载 ─────────────────────────────────────
  let aggregate: AggregateState;
  try {
    aggregate = await loadAggregate({
      aggregateKey: DEFAULT_AGGREGATE_KEY,
      memberWorkspaceKeys: DEFAULT_MEMBER_WORKSPACES,
      allowNoDirection: true,
      noDirectionReason: "verify",
    });
  } catch (e) {
    dataNotReady(
      `loadAggregate threw: ${(e as Error).message}`,
      "Ensure each member workspace has source.features available (check pipeline.ts + senseki-data.ts).",
    );
  }

  const aggregateShape = {
    aggregateKey: aggregate.aggregateKey,
    memberWorkspaceKeys: aggregate.memberWorkspaceKeys,
    topoCounts: {
      nodes: aggregate.topo.nodes.length,
      edges: aggregate.topo.edges.length,
      stations: aggregate.topo.stations.length,
      platforms: aggregate.topo.platforms.length,
    },
    perWorkspaceEdgeCount: aggregate.perWorkspaceEdgeCount ?? null,
  };
  writeReport(`${PHASE}-01-aggregate-shape.json`, aggregateShape);

  assert(
    "aggregate.topo.edges 非空",
    aggregate.topo.edges.length > 0,
    `topo.edges = ${aggregate.topo.edges.length}`,
  );
  assert(
    "aggregate 至少跨 2 个 workspace",
    aggregate.memberWorkspaceKeys.length >= 2,
    `members count = ${aggregate.memberWorkspaceKeys.length}`,
  );

  if (aggregate.perWorkspaceEdgeCount) {
    const totalReported = Object.values(aggregate.perWorkspaceEdgeCount).reduce((a, b) => a + b, 0);
    assert(
      "merged edges ≥ 80% of sum (allow dedup)",
      aggregate.topo.edges.length >= Math.floor(totalReported * 0.8),
      `merged ${aggregate.topo.edges.length} vs sum ${totalReported}`,
    );
  }

  // ── §2. Patterns 加载 ──────────────────────────────────────
  let patterns: StoredServicePattern[];
  try {
    patterns = await loadServicePatterns({ aggregateKey: aggregate.aggregateKey, path: PATTERNS_JSON_PATH });
  } catch (e) {
    dataNotReady(
      `loadServicePatterns threw: ${(e as Error).message}`,
      `Expected JSON at ${PATTERNS_JSON_PATH}. Create at least 1 pattern via UI, or seed a fixture for verify.`,
    );
  }

  if (patterns.length === 0) {
    dataNotReady(
      "No patterns saved yet.",
      "Open rail-graph-aggregate.html, use Chain Editor to build ≥1 pattern, then Save. Or seed a fixture file.",
    );
  }

  writeReport(`${PHASE}-02-patterns-shape.json`, {
    count: patterns.length,
    summary: patterns.map(p => ({
      patternId: p.patternId,
      displayName: p.displayName,
      displayColor: p.displayColor,
      edgeCount: p.edgeSequence.length,
      stopCount: p.traceSequence.filter(t => t.passageType === "stop").length,
      passCount: p.traceSequence.filter(t => t.passageType === "pass").length,
      chainNodeCount: p.intentionChain?.nodes.length ?? 0,
    })),
  });

  assert("patterns 数量 ≥ 1", patterns.length >= 1, `count = ${patterns.length}`);

  // ── §3. Pattern.edgeSequence ⊂ aggregate.topo.edges ─────────
  const aggregateEdgeIds = new Set(aggregate.topo.edges.map(e => e.id));
  for (const p of patterns) {
    const missing = p.edgeSequence.filter(eid => !aggregateEdgeIds.has(eid));
    assert(
      `pattern[${p.patternId}].edgeSequence 全部在 aggregate.topo`,
      missing.length === 0,
      `missing ${missing.length} edges: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`,
    );
  }

  // ── §4. render-plan 纯函数输出 ─────────────────────────────
  let renderPlan: PatternRenderPlan[];
  try {
    renderPlan = buildPatternRenderPlan(aggregate, patterns);
  } catch (e) {
    failures.push({ check: "buildPatternRenderPlan 不抛异常", detail: (e as Error).message });
    renderPlan = [];
  }

  writeReport(`${PHASE}-03-render-plan.json`, {
    planCount: renderPlan.length,
    plans: renderPlan.map(p => ({
      patternId: p.patternId,
      displayColor: p.displayColor,
      polylineSegmentCount: p.polylineSegments?.length ?? 0,
      stationMarkerCount: p.stationMarkers?.length ?? 0,
      sampleSegment: p.polylineSegments?.[0]
        ? {
          edgeRef: p.polylineSegments[0].edgeRef,
          coordCount: p.polylineSegments[0].coords?.length ?? 0,
          strokeStyle: p.polylineSegments[0].strokeStyle,
        }
        : null,
    })),
  });

  assert(
    "render-plan: 每个 pattern 至少 1 个 polylineSegment",
    renderPlan.length === patterns.length && renderPlan.every(p => (p.polylineSegments?.length ?? 0) > 0),
    `plans=${renderPlan.length}, patterns=${patterns.length}; segs per plan = ${renderPlan.map(p => p.polylineSegments?.length ?? 0).join(",")}`,
  );

  assert(
    "render-plan: 每个 pattern 有非空 displayColor",
    renderPlan.every(p => typeof p.displayColor === "string" && p.displayColor.length > 0),
    `colors: ${renderPlan.map(p => p.displayColor).join(",")}`,
  );

  // ── §5. IntentionChain round-trip ─────────────────────────
  // 取至少 1 个 pattern, 用其保存的 chain + aggregate.topo 重跑 v2, edgeSequence 必须命中保存值
  const lookup = buildTopologyLookup(aggregate.topo);
  let roundTripChecked = 0;
  let roundTripPassed = 0;
  const roundTripDetail: Array<Record<string, unknown>> = [];

  for (const p of patterns) {
    if (!p.intentionChain) continue;
    roundTripChecked++;

    let recomputedEdgeSequence: string[] | null = null;
    let errorMessage: string | undefined;
    try {
      const replay = adaptChainToPattern({
        chain: p.intentionChain as IntentionChain,
        aggregate,
        lookup,
        findPaths: findPathsV2,
      });
      recomputedEdgeSequence = replay.edgeSequence;
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    const ok = !!recomputedEdgeSequence
      && recomputedEdgeSequence.length === p.edgeSequence.length
      && recomputedEdgeSequence.every((eid, i) => eid === p.edgeSequence[i]);
    if (ok) roundTripPassed++;
    roundTripDetail.push({
      patternId: p.patternId,
      storedEdgeCount: p.edgeSequence.length,
      recomputedEdgeCount: recomputedEdgeSequence?.length ?? 0,
      identical: ok,
      error: errorMessage,
    });
  }
  writeReport(`${PHASE}-04-chain-round-trip.json`, { checked: roundTripChecked, passed: roundTripPassed, detail: roundTripDetail });

  assert(
    "≥ 1 个 pattern 完成 chain round-trip",
    roundTripChecked >= 1 && roundTripPassed >= 1,
    `checked ${roundTripChecked}, passed ${roundTripPassed}`,
  );

  // ── §6. summary.md (人类可读) ──────────────────────────────
  const allPass = failures.length === 0;
  const md = renderSummaryMd({ aggregateShape, patterns: patterns.length, renderPlanCount: renderPlan.length, roundTripChecked, roundTripPassed, checks, failures });
  writeReport(`${PHASE}-summary.md`, md);

  // ── §7. banner ─────────────────────────────────────────────
  console.log("");
  console.log("====================================================");
  if (allPass) {
    console.log("AGGREGATE VERIFY (PR1 · patterns): PASS");
  } else {
    console.log("AGGREGATE VERIFY (PR1 · patterns): FAIL");
    console.log("");
    console.log(`${failures.length} check(s) failed:`);
    for (const f of failures) {
      console.log(`  ✗ ${f.check}`);
      console.log(`    ${f.detail}`);
    }
  }
  console.log("====================================================");
  console.log(`Report dir: ${OUT_DIR}`);
  console.log("");

  process.exit(allPass ? 0 : 1);
}

function renderSummaryMd(args: {
  aggregateShape: Record<string, unknown>;
  patterns: number;
  renderPlanCount: number;
  roundTripChecked: number;
  roundTripPassed: number;
  checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }>;
  failures: Failure[];
}): string {
  const lines: string[] = [];
  lines.push("# Goal02 PR1 · Aggregate Patterns Verify Summary");
  lines.push("");
  lines.push(`- aggregateKey: \`${(args.aggregateShape as any).aggregateKey}\``);
  lines.push(`- members: \`${JSON.stringify((args.aggregateShape as any).memberWorkspaceKeys)}\``);
  lines.push(`- topo: ${JSON.stringify((args.aggregateShape as any).topoCounts)}`);
  lines.push(`- patterns loaded: **${args.patterns}**`);
  lines.push(`- render plans built: **${args.renderPlanCount}**`);
  lines.push(`- chain round-trip: ${args.roundTripPassed}/${args.roundTripChecked}`);
  lines.push("");
  lines.push("## Checks");
  for (const c of args.checks) {
    lines.push(`- ${c.status === "PASS" ? "✅" : "❌"} ${c.check}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  if (args.failures.length > 0) {
    lines.push("");
    lines.push("## Failure detail");
    for (const f of args.failures) {
      lines.push(`### ✗ ${f.check}`);
      lines.push("");
      lines.push("```");
      lines.push(f.detail);
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

main().catch((e) => {
  console.error("verify-patterns crashed:", e);
  process.exit(1);
});
