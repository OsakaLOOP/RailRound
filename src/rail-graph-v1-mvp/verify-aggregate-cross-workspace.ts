// ============================================================
// Aggregate Cross-Workspace Pathfinding Verify
//
// Layer 1: way-graph 连通性 (findPaths)
// Layer 2: TODO — compiled topology + IntentionChain (findPathsV2)
//
// 用法:
//   npx tsx src/rail-graph-v1-mvp/verify-aggregate-cross-workspace.ts
//
// 数据来源 (项目内 fixture, 由 MVP app 的 "Export Aggregate Fixture" 写入):
//   src/rail-graph-v1-mvp/fixtures/aggregate-{workspaceKey}.cleaned.geojson
//
// 每个工作区的 fixture = 该 workspace 在 app 中跑完 rule + override 后的 clean 结果。
// 缺失 fixture → "DATA NOT READY" 提示, agent 应让用户在 app 中点 export 按钮。
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { findPaths } from "./way-graph-pathfinder";

const FIXTURE_DIR = path.resolve("src", "rail-graph-v1-mvp", "fixtures");
const SENSEKI_FIXTURE = path.join(FIXTURE_DIR, "aggregate-senseki.cleaned.geojson");
const TOHOKU_FIXTURE = path.join(FIXTURE_DIR, "aggregate-東北本線_v2.cleaned.geojson");
const OUT_DIR = path.resolve("src", "rail-graph-aggregate", ".verify");

const REF_WAYS = {
  sendaiUp:        { osmId: "1015018069", desc: "仙台上行起始" },
  sendaiDown:      { osmId: "884011779",  desc: "仙台下行终到" },
  connector:       { osmId: "351315049",  desc: "联络线 (単線)" },
  ishinomakiUp:    { osmId: "882389027",  desc: "石巻上行终到" },
  ishinomakiDown:  { osmId: "351315047",  desc: "石巻下行始発" },
};

function fidOf(f: any): string {
  const p = f.properties || {};
  if (typeof p._fid === "string" && p._fid.length > 0) return p._fid;
  return `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}:${p.source_line_name || ""}`;
}

function coreId(f: any): string {
  const p = f.properties || {};
  return `${p.osm_type || ""}:${p.osm_id || ""}:${p.class_main || ""}`;
}

function findByOsmId(features: any[], osmId: string): any | undefined {
  return features.find((f) => String(f.properties?.osm_id) === osmId);
}

interface Failure { check: string; detail: string; }
const failures: Failure[] = [];
const checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }> = [];

function assert(check: string, condition: boolean, detail: string): void {
  if (condition) checks.push({ check, status: "PASS" });
  else { checks.push({ check, status: "FAIL", detail }); failures.push({ check, detail }); }
}

function writeReport(name: string, data: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const text = typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(path.join(OUT_DIR, name), text, "utf8");
}

function dataNotReady(reason: string, hint: string): never {
  console.error("");
  console.error("====================================================");
  console.error("AGGREGATE VERIFY (cross-ws): DATA NOT READY");
  console.error("====================================================");
  console.error(`Reason: ${reason}`);
  console.error(`Hint:   ${hint}`);
  console.error("");
  process.exit(1);
}

function loadFixture(p: string, label: string): any[] {
  if (!fs.existsSync(p)) {
    dataNotReady(
      `Missing fixture: ${p}`,
      `Open the MVP app, switch to ${label} workspace, click "Export Aggregate Fixture" in the Export step.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const features = raw.features || [];
  console.log(`  ${label}: ${features.length} features (${p})`);
  return features;
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("[verify-cross-ws] === Layer 1: Way-Graph 连通性 ===\n");

  console.log("[1] Loading clean fixtures...");
  const sensekiFeatures = loadFixture(SENSEKI_FIXTURE, "senseki");
  const tohokuFeatures = loadFixture(TOHOKU_FIXTURE, "tohoku-v2");

  assert("仙石線 fixture 非空", sensekiFeatures.length > 0, `count=${sensekiFeatures.length}`);
  assert("東北本線_v2 fixture 非空", tohokuFeatures.length > 0, `count=${tohokuFeatures.length}`);

  console.log("\n[2] Merging features (dedup by coreId)...");
  const seen = new Set<string>();
  const merged: any[] = [];
  let dupCount = 0;

  for (const f of [...sensekiFeatures, ...tohokuFeatures]) {
    const core = coreId(f);
    if (!seen.has(core)) { seen.add(core); merged.push(f); }
    else dupCount++;
  }

  const totalRaw = sensekiFeatures.length + tohokuFeatures.length;
  console.log(`  senseki=${sensekiFeatures.length} + tohoku=${tohokuFeatures.length} = ${totalRaw} raw, merged=${merged.length}, deduped=${dupCount}`);

  assert(
    "合并后 features ≥ 各工作区之和的 80%",
    merged.length >= Math.floor(totalRaw * 0.8),
    `merged=${merged.length}, sum=${totalRaw}`,
  );

  const railFeatures = merged.filter((f) => {
    const cls = f.properties?.class_main;
    const t = f.geometry?.type;
    return cls === "rail" && (t === "LineString" || t === "MultiLineString");
  });
  const passFids = new Set(railFeatures.map(fidOf));
  console.log(`  rail ways for pathfinding: ${passFids.size}`);

  console.log("\n[3] Locating reference ways...");
  const refFids: Record<string, string | null> = {};
  for (const [key, { osmId, desc }] of Object.entries(REF_WAYS)) {
    const f = findByOsmId(merged, osmId);
    refFids[key] = f ? fidOf(f) : null;
    console.log(`  ${key} (${desc}): ${f ? "✓ " + fidOf(f) : "✗ NOT FOUND"}`);
  }
  assert(
    "5 个参考 way 全部可定位",
    Object.values(refFids).every((v) => v !== null),
    `missing: ${Object.entries(refFids).filter(([, v]) => !v).map(([k]) => k).join(", ")}`,
  );

  const connectorDups = merged.filter((f) => String(f.properties?.osm_id) === REF_WAYS.connector.osmId);
  assert("联络线去重后仅 1 份", connectorDups.length === 1, `found ${connectorDups.length} copies`);

  console.log("\n[4] Running findPaths (仙台 → 石巻 via connector)...");
  const originFid = refFids.sendaiUp || refFids.sendaiDown;
  const terminusFid = refFids.ishinomakiUp || refFids.ishinomakiDown;
  const connectorFid = refFids.connector;

  if (!originFid || !terminusFid || !connectorFid) {
    failures.push({ check: "pathfinding 可执行", detail: "reference ways missing" });
  } else {
    const { candidates, error } = findPaths(merged, passFids, originFid, [connectorFid], terminusFid, 5);
    if (error) console.log(`  pathfinding error: ${error}`);
    console.log(`  candidates: ${candidates.length}`);

    assert("findPaths 返回 ≥1 candidate", candidates.length >= 1, `count=${candidates.length}, error=${error || "none"}`);

    if (candidates.length > 0) {
      const best = candidates[0];
      assert("candidate 包含联络线 FID", best.includes(connectorFid), `connector not in path of ${best.length} edges`);
      assert("candidate edgeCount 合理 (10~500)", best.length >= 10 && best.length <= 500, `edgeCount=${best.length}`);
      const totalKm = estimatePathLength(best, merged) / 1000;
      console.log(`  best: ${best.length} edges, ~${totalKm.toFixed(1)}km`);
      assert("路径长度 30~70km (参考 48.5km)", totalKm >= 30 && totalKm <= 70, `length=${totalKm.toFixed(1)}km`);
    }

    console.log("\n[5] Reverse: 石巻 → 仙台...");
    const rev = findPaths(merged, passFids, terminusFid, [connectorFid], originFid, 5);
    console.log(`  reverse candidates: ${rev.candidates.length}`);
    assert("反向路径 ≥1 candidate", rev.candidates.length >= 1, `count=${rev.candidates.length}, error=${rev.error || "none"}`);
  }

  writeReport("cross-ws-merge-stats.json", {
    sensekiClean: sensekiFeatures.length,
    tohokuClean: tohokuFeatures.length,
    merged: merged.length,
    deduped: dupCount,
    railWays: passFids.size,
    refWays: refFids,
  });
  writeReport("cross-ws-pathfinding.json", { origin: originFid, terminus: terminusFid, connector: connectorFid, checks });

  const allPass = failures.length === 0;
  console.log("\n====================================================");
  console.log(`AGGREGATE VERIFY (cross-ws · Layer 1): ${allPass ? "PASS" : "FAIL"}`);
  if (!allPass) {
    console.log(`\n${failures.length} check(s) failed:`);
    for (const f of failures) {
      console.log(`  ✗ ${f.check}`);
      console.log(`    ${f.detail}`);
    }
  }
  console.log("====================================================");
  console.log(`Report dir: ${OUT_DIR}\n`);
  process.exit(allPass ? 0 : 1);
}

function estimatePathLength(edgeFids: string[], features: any[]): number {
  const fidMap = new Map<string, any>();
  for (const f of features) fidMap.set(fidOf(f), f);
  let total = 0;
  for (const fid of edgeFids) {
    const f = fidMap.get(fid);
    if (!f?.geometry?.coordinates) continue;
    const coords = f.geometry.type === "MultiLineString"
      ? f.geometry.coordinates.flat()
      : f.geometry.coordinates;
    total += polylineLength(coords);
  }
  return total;
}

function polylineLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += haversineM(coords[i - 1], coords[i]);
  return len;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

main();
