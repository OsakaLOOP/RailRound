// ============================================================
// Goal 02 / PR 2 Verify · 跨 ServicePattern 换乘寻路
//
// 用法:
//   npm run rail:aggregate:verify:cross-pf
//
// 前置: PR1 已完成 (loadAggregate + loadServicePatterns 可用), 且至少 2 个 ServicePattern
//       通过 ≥ 1 个 station 联通 (典型: 仙石线 ↔ 东北本线 通过共享站)
//
// 设计: 与 verify-aggregate-patterns 同模式 — 静态 import 期望模块, 模块缺则 tsx 报错;
//       数据不足则 "DATA NOT READY"; 全就绪则跑断言, 写报告, banner。
//
// agent 还需要先确认 PR1 verify 仍 PASS (本脚本会回归触发 PR1 verify 的核心断言子集)
// ============================================================

import fs from "node:fs";
import path from "node:path";

// ── PR1 模块 (已实现) ──────────────────────────────────────────
import { loadAggregate, type AggregateState } from "../rail-graph-aggregate/aggregate-state";
import { loadServicePatterns, type StoredServicePattern } from "../rail-graph-aggregate/service-pattern/store";

// ── PR2 新模块 (本期必须创建) ─────────────────────────────────
import {
  buildTransferGraph,
  type TransferGraph,
} from "../rail-graph-aggregate/cross-pattern/transfer-graph";
import {
  resolveCrossPattern,
  type CrossPatternPath,
} from "../rail-graph-aggregate/cross-pattern/resolver";

// ── 常量 ───────────────────────────────────────────────────────
const OUT_DIR = path.resolve("src", "rail-graph-aggregate", ".verify");
const PHASE = "cross-pf";
const AGGREGATE_KEY = process.env.AGGREGATE_KEY ?? "senseki-tohoku";
const MEMBER_WORKSPACES = (process.env.MEMBER_WORKSPACES ?? "senseki,tohoku-main").split(",").map(s => s.trim()).filter(Boolean);
const PATTERNS_JSON_PATH = process.env.PATTERNS_JSON_PATH
  ?? path.resolve("aggregates", AGGREGATE_KEY, "service-patterns.json");

// 固定测试 station 对 (本期硬编码; 后续可改为 env): from=senseki 某站, to=tohoku 某站
const TEST_FROM_STATION = process.env.CROSS_PF_FROM ?? ""; // 留空 → 自动选第一对跨 pattern 共有过的 station 对
const TEST_TO_STATION = process.env.CROSS_PF_TO ?? "";

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
  console.error("AGGREGATE VERIFY (PR2 · cross-pf): DATA NOT READY");
  console.error("====================================================");
  console.error(`Reason: ${reason}`);
  console.error(`Hint:   ${hint}`);
  console.error("");
  console.error("Pause agent, fix the data, then re-run: npm run rail:aggregate:verify:cross-pf");
  process.exit(1);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[verify-cross-pf] starting; aggregateKey=${AGGREGATE_KEY}`);

  // ── §1. 复用 PR1 资源 ─────────────────────────────────────
  let aggregate: AggregateState;
  let patterns: StoredServicePattern[];
  try {
    aggregate = await loadAggregate({ aggregateKey: AGGREGATE_KEY, memberWorkspaceKeys: MEMBER_WORKSPACES });
    patterns = await loadServicePatterns({ aggregateKey: AGGREGATE_KEY, path: PATTERNS_JSON_PATH });
  } catch (e) {
    dataNotReady(`PR1 资源加载失败: ${(e as Error).message}`, "先确认 PR1 verify PASS, 再跑 PR2 verify");
  }

  if (patterns.length < 2) {
    dataNotReady(
      `patterns.length = ${patterns.length}, 跨线寻路至少需要 2 个 pattern`,
      "在 UI 中再保存一个 ServicePattern (例如东北本线), 或在 fixture 中补",
    );
  }

  // ── §2. Transfer graph ───────────────────────────────────
  let transferGraph: TransferGraph;
  try {
    transferGraph = buildTransferGraph(patterns);
  } catch (e) {
    failures.push({ check: "buildTransferGraph 不抛", detail: (e as Error).message });
    transferGraph = { transfers: [], byPatternId: new Map() } as unknown as TransferGraph;
  }
  writeReport(`${PHASE}-01-transfer-graph.json`, {
    transferCount: transferGraph.transfers.length,
    transfers: transferGraph.transfers.map(t => ({
      patternA: t.patternA,
      patternB: t.patternB,
      sharedStationCount: t.sharedStations.length,
      sampleShared: t.sharedStations.slice(0, 5),
    })),
  });

  assert(
    "transfer graph: 至少 1 条 transfer relation",
    transferGraph.transfers.length >= 1,
    `transfers=${transferGraph.transfers.length}; 检查是否所有 patterns 完全孤立 (无共同 station)`,
  );

  // ── §3. 自动挑选测试 from/to (若用户未设环境变量) ─────────
  let fromStation = TEST_FROM_STATION;
  let toStation = TEST_TO_STATION;
  if (!fromStation || !toStation) {
    const picked = pickStationsAcrossPatterns(patterns, transferGraph);
    if (!picked) {
      dataNotReady(
        "无法自动挑选跨 pattern 的 (from,to)",
        "确认 patterns 至少含 2 条线, 且各线 stationSequence 互相独有的 station ≥ 1",
      );
    }
    fromStation = picked.from;
    toStation = picked.to;
  }
  writeReport(`${PHASE}-02-test-od.json`, { from: fromStation, to: toStation });

  // ── §4. resolveCrossPattern ──────────────────────────────
  let crossPath: CrossPatternPath | null = null;
  let resolveError: string | undefined;
  try {
    crossPath = resolveCrossPattern({
      patterns,
      transferGraph,
      from: fromStation,
      to: toStation,
    });
  } catch (e) {
    resolveError = (e as Error).message;
  }

  writeReport(`${PHASE}-03-cross-path.json`, {
    error: resolveError ?? null,
    crossPath: crossPath
      ? {
        hopCount: crossPath.hops.length,
        hops: crossPath.hops.map(h => ({
          patternRef: h.patternRef,
          fromStation: h.fromStation,
          toStation: h.toStation,
          edgeCount: h.edgeSequence.length,
          stationCount: h.stationSequence.length,
        })),
        transferStations: crossPath.transferStations,
        totalEdgeCount: crossPath.hops.reduce((a, h) => a + h.edgeSequence.length, 0),
      }
      : null,
  });

  assert("resolveCrossPattern 不抛", resolveError === undefined, resolveError ?? "");
  assert("crossPath 非 null", crossPath !== null, "resolveCrossPattern 返回 null");

  if (crossPath) {
    assert(
      "crossPath.hops 至少 2 个 (确实换乘)",
      crossPath.hops.length >= 2,
      `hops=${crossPath.hops.length}; 单 pattern 命中说明 from/to 没有跨 pattern`,
    );

    // transfer station 必须在两个相邻 hop 的 stationSequence 里
    for (let i = 0; i + 1 < crossPath.hops.length; i++) {
      const a = crossPath.hops[i];
      const b = crossPath.hops[i + 1];
      const ts = crossPath.transferStations?.[i];
      const inA = ts ? a.stationSequence.includes(ts) : false;
      const inB = ts ? b.stationSequence.includes(ts) : false;
      assert(
        `transferStations[${i}] '${ts}' 在 hops[${i}] 和 hops[${i + 1}] 内`,
        inA && inB,
        `inA=${inA}, inB=${inB}, ts=${ts}`,
      );
    }

    // sanity: 总 edgeCount ≤ aggregate.edges (跨线路径不应超过整图)
    assert(
      "totalEdgeCount ≤ aggregate.topo.edges.length",
      crossPath.hops.reduce((a, h) => a + h.edgeSequence.length, 0) <= aggregate.topo.edges.length,
      "edgeCount 异常 — 可能 dijkstra 走了重复边",
    );
  }

  // ── §5. 反向场景对称性 ──────────────────────────────────
  let reverseCrossPath: CrossPatternPath | null = null;
  try {
    reverseCrossPath = resolveCrossPattern({
      patterns,
      transferGraph,
      from: toStation,
      to: fromStation,
    });
  } catch (e) {
    failures.push({ check: "反向 resolveCrossPattern 不抛", detail: (e as Error).message });
  }
  writeReport(`${PHASE}-04-reverse-cross-path.json`, {
    hops: reverseCrossPath?.hops.map(h => ({ patternRef: h.patternRef, edgeCount: h.edgeSequence.length, stationCount: h.stationSequence.length })) ?? null,
  });

  if (crossPath && reverseCrossPath) {
    const forwardEdgeCount = crossPath.hops.reduce((a, h) => a + h.edgeSequence.length, 0);
    const reverseEdgeCount = reverseCrossPath.hops.reduce((a, h) => a + h.edgeSequence.length, 0);
    assert(
      "正反向 edgeCount 一致 (允许 ±10% 浮动)",
      Math.abs(forwardEdgeCount - reverseEdgeCount) <= Math.ceil(forwardEdgeCount * 0.1),
      `forward=${forwardEdgeCount}, reverse=${reverseEdgeCount}`,
    );
    assert(
      "正反向 hop 数一致",
      crossPath.hops.length === reverseCrossPath.hops.length,
      `forward=${crossPath.hops.length}, reverse=${reverseCrossPath.hops.length}`,
    );
  }

  // ── §6. 回归 PR1 核心断言 ────────────────────────────────
  const aggregateEdgeIds = new Set(aggregate.topo.edges.map(e => e.id));
  for (const p of patterns) {
    const missing = p.edgeSequence.filter(eid => !aggregateEdgeIds.has(eid));
    assert(
      `[REGRESS] pattern[${p.patternId}].edgeSequence ⊂ aggregate.topo`,
      missing.length === 0,
      `missing ${missing.length}: ${missing.slice(0, 3).join(", ")}`,
    );
  }

  // ── §7. summary + banner ────────────────────────────────
  const allPass = failures.length === 0;
  const md = renderSummaryMd({ from: fromStation, to: toStation, transferCount: transferGraph.transfers.length, crossPath, reverseCrossPath, checks, failures });
  writeReport(`${PHASE}-summary.md`, md);

  console.log("");
  console.log("====================================================");
  if (allPass) {
    console.log("AGGREGATE VERIFY (PR2 · cross-pf): PASS");
  } else {
    console.log("AGGREGATE VERIFY (PR2 · cross-pf): FAIL");
    for (const f of failures) {
      console.log(`  ✗ ${f.check}`);
      console.log(`    ${f.detail}`);
    }
  }
  console.log("====================================================");
  console.log(`Report dir: ${OUT_DIR}`);

  process.exit(allPass ? 0 : 1);
}

// ── 工具: 自动从 patterns 挑选跨 pattern 的 (from,to) ──────────
function pickStationsAcrossPatterns(patterns: StoredServicePattern[], tg: TransferGraph): { from: string; to: string } | null {
  if (patterns.length < 2 || tg.transfers.length === 0) return null;
  const [pA, pB] = pickTwoConnectedPatterns(patterns, tg);
  if (!pA || !pB) return null;

  const aStations = stationsOf(pA);
  const bStations = stationsOf(pB);
  const shared = aStations.filter(s => bStations.includes(s));
  const aOnly = aStations.filter(s => !bStations.includes(s));
  const bOnly = bStations.filter(s => !aStations.includes(s));
  if (aOnly.length === 0 || bOnly.length === 0 || shared.length === 0) return null;
  return { from: aOnly[0], to: bOnly[0] };
}

function pickTwoConnectedPatterns(patterns: StoredServicePattern[], tg: TransferGraph): [StoredServicePattern | undefined, StoredServicePattern | undefined] {
  const byId = new Map(patterns.map(p => [p.patternId, p] as const));
  for (const t of tg.transfers) {
    const a = byId.get(t.patternA);
    const b = byId.get(t.patternB);
    if (a && b) return [a, b];
  }
  return [undefined, undefined];
}

function stationsOf(p: StoredServicePattern): string[] {
  return p.traceSequence.map(t => t.stationRef);
}

function renderSummaryMd(args: {
  from: string;
  to: string;
  transferCount: number;
  crossPath: CrossPatternPath | null;
  reverseCrossPath: CrossPatternPath | null;
  checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }>;
  failures: Failure[];
}): string {
  const L: string[] = [];
  L.push("# Goal02 PR2 · Cross-Pattern Pathfinding Verify Summary");
  L.push("");
  L.push(`- Test OD: \`${args.from}\` → \`${args.to}\``);
  L.push(`- Transfer relations in graph: **${args.transferCount}**`);
  L.push(`- Forward hops: **${args.crossPath?.hops.length ?? 0}** (transferStations: ${JSON.stringify(args.crossPath?.transferStations ?? [])})`);
  L.push(`- Reverse hops: **${args.reverseCrossPath?.hops.length ?? 0}**`);
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
  console.error("verify-cross-pf crashed:", e);
  process.exit(1);
});
