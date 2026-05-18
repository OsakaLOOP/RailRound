// ============================================================
// Senseki Line — ingest script v0 (statistics only)
//
// 读 d:/Downloads/仙石線_filtered.geojson, 输出综合概要:
//   - 属性分布 (class_main / usage / passenger_lines / service / oneway / ...)
//   - 几何长度直方图
//   - LineString 端点聚类 (用于预览站点 / 交叉点)
//   - 复线候选 (passenger_lines=2) 几何邻近预览
//
// 不输出 BaseTopologyLayer, 仅 console 报告 + 写 JSON summary。
//
// 运行: npx tsx scripts/ingest-senseki.ts
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Path constants ───────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const INPUT_PATH = join(REPO_ROOT, "scripts", "senseki-rail-osm.geojson");
const STATIONS_PATH = join(REPO_ROOT, "scripts", "senseki-stations.geojson");
const OUTPUT_PATH = join(REPO_ROOT, "scripts", "senseki-ingest-v0-summary.json");
const PAIRING_REPORT_PATH = join(REPO_ROOT, "scripts", "senseki-pairing-review.md");
const TS_MODULE_PATH = join(REPO_ROOT, "src", "rail-graph-v1-mvp", "senseki-data.ts");

// ── Pre-ingest geometry edits ───────────────────────────────
//
// 在 ingest pipeline 之前对 source 数据做一次性几何修正.
// 每条 SPLIT_OPERATION 把 wayToSplit 在 splitAtWay 任一端点最近的顶点切两半:
//   前段保留原 osm_id, 后段 osm_id = `${原}${suffix}` (默认 "(1)"), 属性全部复制.
// 用 5m 容差判定顶点共享.

interface SplitOperation {
  wayToSplit: string;
  splitAtWay: string;
  suffix?: string;
}

const SPLIT_OPERATIONS: SplitOperation[] = [
  { wayToSplit: "775723282", splitAtWay: "1320551300" },
];
const SPLIT_TOLERANCE_M = 5;

// 通过 extender 延长到 target 任一端点 (修复几何间隙).
// 算法: 找两条 way 的 4 个端点对 (a.start/end × b.start/end), 取距离最近一对, 把 target 该端点 coord 追加到 extender 对应端.
//   - 若 extender.start 最近 → prepend target 端点 coord
//   - 若 extender.end 最近 → append target 端点 coord
// 仅在 distance ≤ EXTEND_TOLERANCE_M 时执行, 避免误连远端.

interface ExtendOperation {
  extender: string;
  target: string;
  toleranceM?: number;
}

const EXTEND_OPERATIONS: ExtendOperation[] = [
  { extender: "810339113", target: "1267082102" },
  { extender: "810339113", target: "777952627" },
];
const EXTEND_TOLERANCE_M = 100;

// ── Types ────────────────────────────────────────────────────

type Position = [number, number] | [number, number, number];

type GeoJSONGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiLineString"; coordinates: Position[][] };

interface AnyFeature {
  type: "Feature";
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown>;
}

interface LineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Position[] };
  properties: Record<string, unknown>;
}

interface GeoJSONFC {
  type: "FeatureCollection";
  features: AnyFeature[];
}

interface Bucket {
  value: string;
  count: number;
}

// ── Distribution helpers ────────────────────────────────────

function isLineFeature(f: AnyFeature): f is LineFeature {
  return f.geometry?.type === "LineString";
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Bucket[] {
  const map = new Map<string, number>();
  for (const x of items) {
    const k = keyFn(x);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function distributionAny(features: AnyFeature[], key: string): Bucket[] {
  const map = new Map<string, number>();
  for (const f of features) {
    const v = f.properties[key];
    const k = v === undefined || v === null || v === "" ? "<empty>" : String(v);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function distribution(features: LineFeature[], key: string): Bucket[] {
  return distributionAny(features, key);
}

// ── Geometry helpers (great-circle distance, meters) ─────────

const R_EARTH = 6378137;
function haversineMeters(a: Position, b: Position): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

function lineStringLength(coords: Position[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}

function bearingDeg(a: Position, b: Position): number {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ── Length histogram ─────────────────────────────────────────

function lengthHistogram(features: LineFeature[]): Array<{ bin: string; count: number }> {
  const bins = [
    { label: "< 50m", lo: 0, hi: 50 },
    { label: "50-200m", lo: 50, hi: 200 },
    { label: "200-500m", lo: 200, hi: 500 },
    { label: "500m-1km", lo: 500, hi: 1000 },
    { label: "1-3km", lo: 1000, hi: 3000 },
    { label: "3-10km", lo: 3000, hi: 10000 },
    { label: ">10km", lo: 10000, hi: Infinity },
  ];
  const counts = new Array(bins.length).fill(0);
  for (const f of features) {
    const len = lineStringLength(f.geometry.coordinates);
    const i = bins.findIndex((b) => len >= b.lo && len < b.hi);
    if (i >= 0) counts[i] += 1;
  }
  return bins.map((b, i) => ({ bin: b.label, count: counts[i] }));
}

// ── Endpoint clustering ─────────────────────────────────────

interface Endpoint {
  featureIdx: number;
  end: "start" | "finish";
  pos: Position;
  nearestStation?: string;
}

interface Cluster {
  id: number;
  members: Endpoint[];
  centroid: Position;
  stationsObserved: string[];
}

function clusterEndpoints(features: LineFeature[], thresholdM: number): Cluster[] {
  const pts: Endpoint[] = [];
  for (let i = 0; i < features.length; i += 1) {
    const f = features[i];
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    const ns = (f.properties.nearest_station as string | undefined) ?? undefined;
    pts.push({ featureIdx: i, end: "start", pos: coords[0], nearestStation: ns });
    pts.push({ featureIdx: i, end: "finish", pos: coords[coords.length - 1], nearestStation: ns });
  }

  // O(N^2) clustering — N ~ 410, OK
  const clusterId: number[] = new Array(pts.length).fill(-1);
  let nextId = 0;
  for (let i = 0; i < pts.length; i += 1) {
    if (clusterId[i] !== -1) continue;
    const id = nextId++;
    clusterId[i] = id;
    const queue = [i];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (let j = 0; j < pts.length; j += 1) {
        if (clusterId[j] !== -1) continue;
        if (haversineMeters(pts[cur].pos, pts[j].pos) <= thresholdM) {
          clusterId[j] = id;
          queue.push(j);
        }
      }
    }
  }

  const groups = new Map<number, Endpoint[]>();
  for (let i = 0; i < pts.length; i += 1) {
    const arr = groups.get(clusterId[i]) ?? [];
    arr.push(pts[i]);
    groups.set(clusterId[i], arr);
  }

  const out: Cluster[] = [];
  for (const [id, members] of groups) {
    let sx = 0;
    let sy = 0;
    for (const m of members) {
      sx += m.pos[0];
      sy += m.pos[1];
    }
    const centroid: Position = [sx / members.length, sy / members.length];
    const stations = [...new Set(members.map((m) => m.nearestStation).filter((s): s is string => !!s))];
    out.push({ id, members, centroid, stationsObserved: stations });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

// ── Pair candidates (passenger_lines=2) ──────────────────────

interface PairCandidate {
  aIdx: number;
  bIdx: number;
  aOsmId: string;
  bOsmId: string;
  aStart: Position;
  aEnd: Position;
  bStart: Position;
  bEnd: Position;
  // 端点到对端最近端点的距离
  startToStartM: number;
  startToEndM: number;
  endToStartM: number;
  endToEndM: number;
  // 两 LineString 的整体长度
  aLengthM: number;
  bLengthM: number;
  // 起讫平均距离 (复线对的近似离心距)
  meanLateralM: number;
  // 头尾朝向 (deg) 的差异; 反向同质应 ≈ 180°
  bearingDiffDeg: number;
  aName?: string;
  bName?: string;
  aNearest?: string;
  bNearest?: string;
}

function findPairCandidates(features: LineFeature[]): PairCandidate[] {
  const dualFeatures: { idx: number; f: LineFeature; len: number }[] = [];
  for (let i = 0; i < features.length; i += 1) {
    if (String(features[i].properties.passenger_lines ?? "") === "2") {
      dualFeatures.push({ idx: i, f: features[i], len: lineStringLength(features[i].geometry.coordinates) });
    }
  }

  const candidates: PairCandidate[] = [];
  const matched = new Set<number>();

  // 贪心: 对每条 L_a, 找最近的 L_b (端点距离最小且未匹配过)
  for (const a of dualFeatures) {
    if (matched.has(a.idx)) continue;
    const aCoords = a.f.geometry.coordinates;
    const aStart = aCoords[0];
    const aEnd = aCoords[aCoords.length - 1];

    let bestScore = Infinity;
    let bestB: typeof a | null = null;

    for (const b of dualFeatures) {
      if (b.idx === a.idx || matched.has(b.idx)) continue;
      const bCoords = b.f.geometry.coordinates;
      const bStart = bCoords[0];
      const bEnd = bCoords[bCoords.length - 1];
      // 复线对的两条 line 走向通常相反, 故 best 配对方式: a.start ↔ b.end & a.end ↔ b.start
      const reverseScore = haversineMeters(aStart, bEnd) + haversineMeters(aEnd, bStart);
      // 也允许同向 (a.start↔b.start & a.end↔b.end) — 少见
      const forwardScore = haversineMeters(aStart, bStart) + haversineMeters(aEnd, bEnd);
      const score = Math.min(reverseScore, forwardScore);
      // 仅考虑长度相近 (差异 < 50%) 的配对
      if (a.len > 0 && Math.abs(a.len - b.len) / Math.max(a.len, b.len) > 0.5) continue;
      if (score < bestScore && score < 100) {
        bestScore = score;
        bestB = b;
      }
    }

    if (bestB) {
      matched.add(a.idx);
      matched.add(bestB.idx);
      const bCoords = bestB.f.geometry.coordinates;
      const bStart = bCoords[0];
      const bEnd = bCoords[bCoords.length - 1];
      const startToStartM = haversineMeters(aStart, bStart);
      const startToEndM = haversineMeters(aStart, bEnd);
      const endToStartM = haversineMeters(aEnd, bStart);
      const endToEndM = haversineMeters(aEnd, bEnd);
      // 横向离心 — 取首末两端到对端 LineString 的近似距离 (用中点)
      const aMid = aCoords[Math.floor(aCoords.length / 2)];
      const bMid = bCoords[Math.floor(bCoords.length / 2)];
      const meanLateralM = haversineMeters(aMid, bMid);
      const aBearing = bearingDeg(aStart, aEnd);
      const bBearing = bearingDeg(bStart, bEnd);
      const rawDiff = Math.abs(aBearing - bBearing);
      const bearingDiffDeg = Math.min(rawDiff, 360 - rawDiff);

      candidates.push({
        aIdx: a.idx,
        bIdx: bestB.idx,
        aOsmId: String(a.f.properties.osm_id ?? ""),
        bOsmId: String(bestB.f.properties.osm_id ?? ""),
        aStart, aEnd, bStart, bEnd,
        startToStartM, startToEndM, endToStartM, endToEndM,
        aLengthM: a.len,
        bLengthM: bestB.len,
        meanLateralM,
        bearingDiffDeg,
        aName: a.f.properties.name as string | undefined,
        bName: bestB.f.properties.name as string | undefined,
        aNearest: a.f.properties.nearest_station as string | undefined,
        bNearest: bestB.f.properties.nearest_station as string | undefined,
      });
    }
  }

  return candidates;
}

// ── Main ─────────────────────────────────────────────────────

function applySplitOperations(features: AnyFeature[]): AnyFeature[] {
  if (SPLIT_OPERATIONS.length === 0) return features;

  // 索引: osm_id → feature 索引 (仅 LineString)
  const idxByOsmId = new Map<string, number>();
  for (let i = 0; i < features.length; i += 1) {
    if (features[i].geometry?.type !== "LineString") continue;
    const osmId = String(features[i].properties.osm_id ?? "");
    if (osmId) idxByOsmId.set(osmId, i);
  }

  // 按倒序处理 (避免 splice 后 index 偏移); 用收集列表
  const ops: Array<{ aIdx: number; vertexIdx: number; suffix: string; op: SplitOperation }> = [];
  for (const op of SPLIT_OPERATIONS) {
    const aIdx = idxByOsmId.get(op.wayToSplit);
    const bIdx = idxByOsmId.get(op.splitAtWay);
    if (aIdx === undefined || bIdx === undefined) {
      console.warn(`[split] skipped: way ${op.wayToSplit} or ${op.splitAtWay} not found in LineString features`);
      continue;
    }
    const wayA = features[aIdx] as LineFeature;
    const wayB = features[bIdx] as LineFeature;
    const vertexIdx = findSplitVertex(wayA, wayB, SPLIT_TOLERANCE_M);
    if (vertexIdx < 0) {
      console.warn(`[split] skipped: no shared vertex within ${SPLIT_TOLERANCE_M}m between ${op.wayToSplit} and endpoints of ${op.splitAtWay}`);
      continue;
    }
    ops.push({ aIdx, vertexIdx, suffix: op.suffix ?? "(1)", op });
  }

  // 倒序 splice
  ops.sort((x, y) => y.aIdx - x.aIdx);
  for (const { aIdx, vertexIdx, suffix, op } of ops) {
    const [partA, partB] = splitFeatureAtVertex(features[aIdx] as LineFeature, vertexIdx, suffix);
    features.splice(aIdx, 1, partA, partB);
    console.log(`[split] way ${op.wayToSplit} split at vertex ${vertexIdx} (via ${op.splitAtWay}); partA=${partA.geometry.coordinates.length}pts, partB=${partB.geometry.coordinates.length}pts; new osm_id="${op.wayToSplit}${suffix}"`);
  }
  return features;
}

function findSplitVertex(wayA: LineFeature, wayB: LineFeature, toleranceM: number): number {
  const aCoords = wayA.geometry.coordinates;
  const bCoords = wayB.geometry.coordinates;
  if (bCoords.length < 2) return -1;
  const bStart = bCoords[0];
  const bEnd = bCoords[bCoords.length - 1];

  let best = { idx: -1, dist: Infinity };
  // 仅在 A 的内部顶点 (非首末) 上切; 首末切等于不切
  for (let i = 1; i < aCoords.length - 1; i += 1) {
    const d = Math.min(haversineMeters(aCoords[i], bStart), haversineMeters(aCoords[i], bEnd));
    if (d < best.dist) best = { idx: i, dist: d };
  }
  return best.dist <= toleranceM ? best.idx : -1;
}

function splitFeatureAtVertex(f: LineFeature, vertexIdx: number, suffix: string): [LineFeature, LineFeature] {
  const coords = f.geometry.coordinates;
  // 两段共享 vertexIdx 处的 coord (避免连通性断开)
  const partACoords: Position[] = coords.slice(0, vertexIdx + 1);
  const partBCoords: Position[] = coords.slice(vertexIdx);
  const originalOsmId = String(f.properties.osm_id ?? "");
  const newOsmId = `${originalOsmId}${suffix}`;
  const partA: LineFeature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: partACoords },
    properties: { ...f.properties },
  };
  const partB: LineFeature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: partBCoords },
    properties: { ...f.properties, osm_id: newOsmId },
  };
  return [partA, partB];
}

function applyExtendOperations(features: AnyFeature[]): AnyFeature[] {
  if (EXTEND_OPERATIONS.length === 0) return features;

  const idxByOsmId = new Map<string, number>();
  for (let i = 0; i < features.length; i += 1) {
    if (features[i].geometry?.type !== "LineString") continue;
    const osmId = String(features[i].properties.osm_id ?? "");
    if (osmId) idxByOsmId.set(osmId, i);
  }

  for (const op of EXTEND_OPERATIONS) {
    const aIdx = idxByOsmId.get(op.extender);
    const bIdx = idxByOsmId.get(op.target);
    if (aIdx === undefined || bIdx === undefined) {
      console.warn(`[extend] skipped: way ${op.extender} or ${op.target} not found in LineString features`);
      continue;
    }
    const wayA = features[aIdx] as LineFeature;
    const wayB = features[bIdx] as LineFeature;
    const tolerance = op.toleranceM ?? EXTEND_TOLERANCE_M;

    const aCoords = wayA.geometry.coordinates;
    const bCoords = wayB.geometry.coordinates;
    if (aCoords.length < 2 || bCoords.length < 2) continue;
    const aStart = aCoords[0];
    const aEnd = aCoords[aCoords.length - 1];
    const bStart = bCoords[0];
    const bEnd = bCoords[bCoords.length - 1];

    const pairs = [
      { aSide: "start" as const, bCoord: bStart, dist: haversineMeters(aStart, bStart) },
      { aSide: "start" as const, bCoord: bEnd, dist: haversineMeters(aStart, bEnd) },
      { aSide: "end" as const, bCoord: bStart, dist: haversineMeters(aEnd, bStart) },
      { aSide: "end" as const, bCoord: bEnd, dist: haversineMeters(aEnd, bEnd) },
    ].sort((x, y) => x.dist - y.dist);
    const best = pairs[0];
    if (best.dist > tolerance) {
      console.warn(`[extend] skipped: nearest endpoint distance ${best.dist.toFixed(1)}m > ${tolerance}m for ${op.extender} vs ${op.target}`);
      continue;
    }
    if (best.dist < 0.01) {
      console.log(`[extend] noop: ${op.extender} already touches ${op.target} (dist=${best.dist.toFixed(3)}m)`);
      continue;
    }

    const newACoords: Position[] = best.aSide === "start"
      ? [best.bCoord, ...aCoords]
      : [...aCoords, best.bCoord];
    features[aIdx] = {
      ...wayA,
      geometry: { type: "LineString", coordinates: newACoords },
    };
    console.log(`[extend] way ${op.extender} extended at ${best.aSide} → way ${op.target} (gap=${best.dist.toFixed(2)}m closed; ${aCoords.length}→${newACoords.length}pts)`);
  }
  return features;
}

function main(): void {
  console.log(`[ingest-senseki v0] reading: ${INPUT_PATH}`);
  const raw = readFileSync(INPUT_PATH, "utf-8");
  const fc = JSON.parse(raw) as GeoJSONFC;

  if (fc.type !== "FeatureCollection") {
    throw new Error(`Expected FeatureCollection, got ${fc.type}`);
  }

  const allFeatures = applyExtendOperations(applySplitOperations(fc.features));
  const lineFeatures = allFeatures.filter(isLineFeature);
  const railLineFeatures = lineFeatures.filter((f) => String(f.properties.class_main ?? "") === "rail");
  console.log(`  total features: ${allFeatures.length}`);
  console.log(`  LineString features: ${lineFeatures.length} (rail=${railLineFeatures.length})`);

  const summary = {
    inputPath: INPUT_PATH,
    totalFeatures: allFeatures.length,
    geometryTypeCounts: countBy(allFeatures, (f) => f.geometry?.type ?? "<missing>"),
    classMainByGeom: countBy(allFeatures, (f) => `${f.properties.class_main ?? "<empty>"} | ${f.geometry?.type ?? "<none>"}`),
    distributions: {
      class_main: distributionAny(allFeatures, "class_main"),
      class_sub: distributionAny(allFeatures, "class_sub"),
      "name:en": distributionAny(allFeatures, "name:en"),
      "name:ja": distributionAny(allFeatures, "name:ja"),
      railway: distributionAny(allFeatures, "railway"),
      match_level: distributionAny(allFeatures, "match_level"),
      source_line_name: distributionAny(allFeatures, "source_line_name"),
    },
    lengthHistogram: lengthHistogram(railLineFeatures),
    nearestStations: distributionAny(allFeatures, "nearest_station").slice(0, 50),
    endpointClusters: {
      threshold_30m: clusterEndpoints(railLineFeatures, 30).slice(0, 30).map((c) => ({
        id: c.id,
        memberCount: c.members.length,
        centroid: c.centroid,
        stations: c.stationsObserved,
        featureIndices: [...new Set(c.members.map((m) => m.featureIdx))].slice(0, 8),
      })),
    },
    pairCandidates_passenger_lines_2: findPairCandidates(railLineFeatures).map((p) => ({
      aIdx: p.aIdx, bIdx: p.bIdx,
      aLengthM: Math.round(p.aLengthM),
      bLengthM: Math.round(p.bLengthM),
      meanLateralM: Math.round(p.meanLateralM),
      bearingDiffDeg: Math.round(p.bearingDiffDeg),
      bestEndJoin: {
        startToStartM: Math.round(p.startToStartM),
        startToEndM: Math.round(p.startToEndM),
        endToStartM: Math.round(p.endToStartM),
        endToEndM: Math.round(p.endToEndM),
      },
      aName: p.aName,
      bName: p.bName,
      aNearest: p.aNearest,
      bNearest: p.bNearest,
    })),
    unpairedDualFeatures: (() => {
      const matched = new Set<number>();
      const pairs = findPairCandidates(railLineFeatures);
      for (const p of pairs) { matched.add(p.aIdx); matched.add(p.bIdx); }
      const out: Array<{ idx: number; lengthM: number; nearestStation?: string; name?: string }> = [];
      for (let i = 0; i < railLineFeatures.length; i += 1) {
        if (String(railLineFeatures[i].properties.passenger_lines ?? "") !== "2") continue;
        if (matched.has(i)) continue;
        out.push({
          idx: i,
          lengthM: Math.round(lineStringLength(railLineFeatures[i].geometry.coordinates)),
          nearestStation: railLineFeatures[i].properties.nearest_station as string | undefined,
          name: railLineFeatures[i].properties.name as string | undefined,
        });
      }
      return out;
    })(),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`  summary written: ${OUTPUT_PATH}`);

  // 控制台简报
  console.log("\n=== Distributions ===");
  for (const [key, dist] of Object.entries(summary.distributions)) {
    const top = dist.slice(0, 6).map((d) => `${d.count}×${d.value}`).join(", ");
    console.log(`  ${key.padEnd(20)} ${top}${dist.length > 6 ? ` (+${dist.length - 6} more)` : ""}`);
  }

  console.log("\n=== Length histogram ===");
  for (const h of summary.lengthHistogram) {
    console.log(`  ${h.bin.padEnd(12)} ${"█".repeat(h.count)}  ${h.count}`);
  }

  console.log(`\n=== Endpoint clusters (≤30m, top 12) ===`);
  for (const c of summary.endpointClusters.threshold_30m.slice(0, 12)) {
    const stations = c.stations.length > 0 ? ` [${c.stations.join(", ")}]` : "";
    console.log(`  #${c.id.toString().padStart(3)} ${c.memberCount}pt  (${c.centroid[0].toFixed(4)}, ${c.centroid[1].toFixed(4)})${stations}`);
  }

  console.log(`\n=== Pair candidates (passenger_lines=2) ===`);
  console.log(`  paired: ${summary.pairCandidates_passenger_lines_2.length} pairs (${summary.pairCandidates_passenger_lines_2.length * 2} features)`);
  console.log(`  unpaired: ${summary.unpairedDualFeatures.length}`);
  for (const p of summary.pairCandidates_passenger_lines_2.slice(0, 6)) {
    console.log(`  a=${p.aIdx} b=${p.bIdx}  lenA=${p.aLengthM}m lenB=${p.bLengthM}m  Δ=${p.meanLateralM}m bearΔ=${p.bearingDiffDeg}°  ${p.aNearest ?? "-"}`);
  }
  if (summary.unpairedDualFeatures.length > 0) {
    console.log("  --- unpaired dual features (first 8) ---");
    for (const u of summary.unpairedDualFeatures.slice(0, 8)) {
      console.log(`  idx=${u.idx} len=${u.lengthM}m  ${u.nearestStation ?? "-"}  ${u.name ?? "-"}`);
    }
  }

  // === Generate markdown review file ===
  writePairingReview(railLineFeatures);

  // === Generate TypeScript module (senseki-data.ts) ===
  writeTsModule(allFeatures);
}

function writeTsModule(features: AnyFeature[]): void {
  const stationsRaw = readFileSync(STATIONS_PATH, "utf-8");
  const stationsFc = JSON.parse(stationsRaw) as {
    type: "FeatureCollection";
    features: Array<{ type: "Feature"; geometry: { type: "Point"; coordinates: Position }; properties: Record<string, unknown> }>;
  };
  if (stationsFc.type !== "FeatureCollection") {
    throw new Error(`stations file is not a FeatureCollection`);
  }

  // LOD station 名字集合 — 用于去 OSM station 同名重复 (LOD 优先)
  const lodStationNames = new Set<string>();
  for (const f of stationsFc.features) {
    const name = String(f.properties.name ?? "").trim();
    if (name) lodStationNames.add(name);
  }

  // 按 class_main 分发, 同时按 RailGraphFeatureKind 分桶统计输出
  const annotated = features.map((f) => annotateFeatureByKind(f, lodStationNames)).filter((x): x is NonNullable<typeof x> => x !== null);
  const kindCounts = annotated.reduce<Record<string, number>>((acc, x) => {
    const k = (x as { properties: { railGraph: { kind: string } } }).properties.railGraph.kind;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const stationFeatures = stationsFc.features.map((f) => annotateStationFeature(f));

  const kindSummary = Object.entries(kindCounts).map(([k, v]) => `${k}=${v}`).join(", ");

  const head = `// ============================================================
// Auto-generated by scripts/ingest-senseki.ts. DO NOT EDIT.
//
// Senseki Line (JR仙石線) — preannotated GeoJSON FeatureCollections.
// SENSEKI_RAIL: ${annotated.length} features (${kindSummary})
// SENSEKI_STATIONS: ${stationFeatures.length} LOD station Point features
//
// 预填 railGraph annotation 规则 (by class_main):
//   class_main=rail (LineString) → kind=track_geometry, track.role (sub=crossover→connector, sub=siding→main siding 默认), traversal=both
//   class_main=platform (Polygon/LineString) → kind=platform_area
//   class_main=station/halt/tram_stop (Point) → kind=station_point
//   class_main=switch/railway_crossing (Point) → kind=switch_point
//   class_main=signal/buffer_stop/stop/derail (Point) → kind=signal_point
//   其他 → kind=unknown (level_crossing / crossing / subway_entrance / railway_landuse / ...)
//
// sourceTags 透传所有 OSM properties (含 audit doc §4 派生字段 + raw OSM tags).
// physicalKind / directionRole / functionalUse / platform.type / signal.measure 由用户在 Annotate tab 填入.
// ============================================================

import type { AnnotatedFeatureCollection } from "../rail-graph-v1/annotation.types";

export const SENSEKI_RAIL: AnnotatedFeatureCollection = ${JSON.stringify({ type: "FeatureCollection", features: annotated }, null, 2)};

export const SENSEKI_STATIONS: AnnotatedFeatureCollection = ${JSON.stringify({ type: "FeatureCollection", features: stationFeatures }, null, 2)};
`;

  writeFileSync(TS_MODULE_PATH, head, "utf-8");
  console.log(`  ts module written: ${TS_MODULE_PATH} (${annotated.length} features, ${kindSummary}; stations=${stationFeatures.length})`);
}

function annotateFeatureByKind(f: AnyFeature, lodStationNames: Set<string>): unknown | null {
  const classMain = String(f.properties.class_main ?? "");
  const classSub = String(f.properties.class_sub ?? "");
  const osmId = String(f.properties.osm_id ?? "");
  const sourceTags: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.properties)) {
    if (k === "railGraph") continue;
    if (v === undefined || v === null) continue;
    sourceTags[k] = typeof v === "string" ? v : JSON.stringify(v);
  }

  const baseId = osmId ? `osm:${f.properties.osm_type ?? "way"}:${osmId}` : `osm:unknown:${classMain}:${stableHash(f)}`;
  const name = (f.properties.name as string | undefined) ?? (f.properties["name:en"] as string | undefined);

  // 1. rail (LineString) → track_geometry
  if (classMain === "rail" && f.geometry.type === "LineString") {
    let role: string = "main";
    if (classSub === "crossover") role = "connector";
    else if (classSub === "siding" || classSub === "spur") role = "passing";
    return wrapFeature(f, {
      kind: "track_geometry",
      schemaVersion: "rail-graph-v1",
      id: baseId,
      source: "osm",
      track: {
        role,
        traversal: "both",
        name: name ?? undefined,
      },
    }, { name, osmId, sourceTags });
  }

  // 2. platform → platform_area
  if (classMain === "platform" || classMain === "platform_edge") {
    return wrapFeature(f, {
      kind: "platform_area",
      schemaVersion: "rail-graph-v1",
      id: baseId,
      source: "osm",
      platform: {
        name: name ?? undefined,
      },
    }, { name, osmId, sourceTags });
  }

  // 3. station / halt / tram_stop → station_point (跳过与 LOD 同名的, 标 unknown)
  if (classMain === "station" || classMain === "halt" || classMain === "tram_stop") {
    const trimmed = (name ?? "").trim();
    if (trimmed && lodStationNames.has(trimmed)) {
      // 同名重复 — LOD 已有, 降级为 unknown 避免双源
      return wrapFeature(f, {
        kind: "unknown",
        schemaVersion: "rail-graph-v1",
        id: baseId,
        source: "osm-duplicate-of-lod",
      }, { name, osmId, sourceTags });
    }
    return wrapFeature(f, {
      kind: "station_point",
      schemaVersion: "rail-graph-v1",
      id: baseId,
      source: "osm",
      station: {
        name: name ?? `(unnamed station ${osmId})`,
      },
    }, { name, osmId, sourceTags });
  }

  // 4. switch / railway_crossing → switch_point
  if (classMain === "switch" || classMain === "railway_crossing") {
    return wrapFeature(f, {
      kind: "switch_point",
      schemaVersion: "rail-graph-v1",
      id: baseId,
      source: "osm",
    }, { name, osmId, sourceTags });
  }

  // 5. signal / buffer_stop / stop / derail → signal_point (无 edgeRef, 留给用户)
  if (classMain === "signal" || classMain === "buffer_stop" || classMain === "stop" || classMain === "derail") {
    return wrapFeature(f, {
      kind: "signal_point",
      schemaVersion: "rail-graph-v1",
      id: baseId,
      source: "osm",
    }, { name, osmId, sourceTags });
  }

  // 6. subway_entrance / train_station_entrance / station_entrance → station_entrance
  //    stationRef 用 OSM 的 nearest_station 字段反查 LOD station id (若有).
  if (classMain === "subway_entrance" || classMain === "train_station_entrance" || classMain === "station_entrance") {
    const nearestStationName = String(f.properties.nearest_station ?? "").trim();
    const stationRef = nearestStationName && lodStationNames.has(nearestStationName)
      ? `lod:station:${lodStationSlug(nearestStationName)}`
      : undefined;
    return wrapFeature(f, {
      kind: "station_entrance",
      schemaVersion: "rail-graph-v1",
      id: baseId,
      source: "osm",
      entrance: {
        stationRef,
        name: name ?? undefined,
        ref: (f.properties.ref as string | undefined) ?? undefined,
      },
    }, { name, osmId, sourceTags });
  }

  // 其他: level_crossing / crossing / railway_landuse / catenary_* / etc → unknown
  return wrapFeature(f, {
    kind: "unknown",
    schemaVersion: "rail-graph-v1",
    id: baseId,
    source: "osm",
  }, { name, osmId, sourceTags });
}

/** LOD station slug 复现 — 与 annotateStationFeature 中一致, 保证 stationRef 能匹配. */
function lodStationSlug(name: string): string {
  return name ? Buffer.from(name).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) : "unnamed";
}

function wrapFeature(
  f: AnyFeature,
  annotation: Record<string, unknown>,
  meta: { name?: string; osmId: string; sourceTags: Record<string, string> },
): unknown {
  return {
    type: "Feature",
    geometry: f.geometry,
    properties: {
      name: meta.name,
      osm_id: meta.osmId,
      class_main: f.properties.class_main,
      class_sub: f.properties.class_sub,
      railGraph: annotation,
      sourceTags: meta.sourceTags,
    },
  };
}

function stableHash(f: AnyFeature): string {
  const s = JSON.stringify(f.geometry?.coordinates ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function annotateStationFeature(
  f: { type: "Feature"; geometry: { type: "Point"; coordinates: Position }; properties: Record<string, unknown> },
): unknown {
  const name = String(f.properties.name ?? "");
  const slug = lodStationSlug(name);
  return {
    type: "Feature",
    geometry: f.geometry,
    properties: {
      name,
      railGraph: {
        kind: "station_point",
        schemaVersion: "rail-graph-v1",
        id: `lod:station:${slug}`,
        source: "lod:senseki",
        station: {
          name,
        },
      },
      transfers: f.properties.transfers,
      uri: f.properties.uri,
    },
  };
}

function writePairingReview(features: LineFeature[]): void {
  const pairs = findPairCandidates(features);
  const matched = new Set<number>();
  for (const p of pairs) { matched.add(p.aIdx); matched.add(p.bIdx); }

  const unpaired: Array<{ idx: number; osmId: string; lengthM: number; name?: string; nearestStation?: string }> = [];
  for (let i = 0; i < features.length; i += 1) {
    if (String(features[i].properties.passenger_lines ?? "") !== "2") continue;
    if (matched.has(i)) continue;
    unpaired.push({
      idx: i,
      osmId: String(features[i].properties.osm_id ?? ""),
      lengthM: Math.round(lineStringLength(features[i].geometry.coordinates)),
      name: features[i].properties.name as string | undefined,
      nearestStation: features[i].properties.nearest_station as string | undefined,
    });
  }

  const single: Array<{ idx: number; osmId: string; lengthM: number; name?: string; service?: string; nearestStation?: string; passengerLines: string }> = [];
  for (let i = 0; i < features.length; i += 1) {
    const pl = String(features[i].properties.passenger_lines ?? "");
    if (pl === "2") continue;
    single.push({
      idx: i,
      osmId: String(features[i].properties.osm_id ?? ""),
      lengthM: Math.round(lineStringLength(features[i].geometry.coordinates)),
      name: features[i].properties.name as string | undefined,
      service: features[i].properties.service as string | undefined,
      nearestStation: features[i].properties.nearest_station as string | undefined,
      passengerLines: pl || "<empty>",
    });
  }

  // 按 nearest_station 沿线方向 (经度) 排序 paired
  const pairsSorted = [...pairs].sort((a, b) => {
    const ax = (a.aStart[0] + a.aEnd[0]) / 2;
    const bx = (b.aStart[0] + b.aEnd[0]) / 2;
    return ax - bx;
  });
  const unpairedSorted = [...unpaired].sort((a, b) => {
    const af = features[a.idx];
    const bf = features[b.idx];
    const acoords = af.geometry.coordinates;
    const bcoords = bf.geometry.coordinates;
    const ax = (acoords[0][0] + acoords[acoords.length - 1][0]) / 2;
    const bx = (bcoords[0][0] + bcoords[bcoords.length - 1][0]) / 2;
    return ax - bx;
  });
  const singleSorted = [...single].sort((a, b) => {
    const af = features[a.idx];
    const bf = features[b.idx];
    const acoords = af.geometry.coordinates;
    const bcoords = bf.geometry.coordinates;
    const ax = (acoords[0][0] + acoords[acoords.length - 1][0]) / 2;
    const bx = (bcoords[0][0] + bcoords[bcoords.length - 1][0]) / 2;
    return ax - bx;
  });

  const lines: string[] = [];
  lines.push("# 仙石線 OSM 配对核对表 (ingest v0)");
  lines.push("");
  lines.push("> 由 `scripts/ingest-senseki.ts` 自动生成. 请检查算法的判断是否正确.");
  lines.push(">");
  lines.push("> OSM way 链接格式: `https://www.openstreetmap.org/way/{osm_id}` (可点击在线核对几何).");
  lines.push("");

  // === Paired (passenger_lines=2) ===
  lines.push(`## A. \`passenger_lines=2\` 复线配对 — ${pairsSorted.length} 对 (${pairsSorted.length * 2} features)`);
  lines.push("");
  lines.push("贪心算法: 对每条 dual feature 找 (1) 端点距离最小 < 100m (2) 长度相近 ±50% 的对端. bearΔ ≈ 180° = 反向平行 (正常); Δ = 两条 LineString 中点距离 (≈ 复线离心距).");
  lines.push("");
  lines.push("| # | a osm_id | b osm_id | nearest_station | lenA / lenB (m) | Δ (m) | bearΔ (°) |");
  lines.push("|---|---|---|---|---|---|---|");
  pairsSorted.forEach((p, i) => {
    const station = p.aNearest ?? p.bNearest ?? "-";
    lines.push(`| ${i + 1} | [${p.aOsmId}](https://www.openstreetmap.org/way/${p.aOsmId}) | [${p.bOsmId}](https://www.openstreetmap.org/way/${p.bOsmId}) | ${station} | ${Math.round(p.aLengthM)} / ${Math.round(p.bLengthM)} | ${Math.round(p.meanLateralM)} | ${Math.round(p.bearingDiffDeg)} |`);
  });
  lines.push("");

  // === Unpaired (passenger_lines=2 没找到对端) ===
  lines.push(`## B. \`passenger_lines=2\` 未配对 — ${unpairedSorted.length} 个`);
  lines.push("");
  lines.push("以下 features 虽然标 passenger_lines=2 (复线段), 但算法未找到平行对端. 推测原因: OSM 上地下化区段以单 LineString 表达双线 (passenger_lines=2 标属性但不画两条几何). 请核对是否符合实际.");
  lines.push("");
  lines.push("| # | osm_id | nearest_station | length (m) | name |");
  lines.push("|---|---|---|---|---|");
  unpairedSorted.forEach((u, i) => {
    lines.push(`| ${i + 1} | [${u.osmId}](https://www.openstreetmap.org/way/${u.osmId}) | ${u.nearestStation ?? "-"} | ${u.lengthM} | ${u.name ?? "-"} |`);
  });
  lines.push("");

  // === Single (passenger_lines != 2) ===
  lines.push(`## C. \`passenger_lines\` ≠ 2 (单线 / 渡线 / 接续段) — ${singleSorted.length} 个`);
  lines.push("");
  lines.push("非复线段; 含 93 个 passenger_lines=1 + 15 个 empty. service=crossover 的是渡线; 名字含\"接続線\"的是接续 Tohoku 主线.");
  lines.push("");
  lines.push("| # | osm_id | nearest_station | length (m) | passenger_lines | service | name |");
  lines.push("|---|---|---|---|---|---|---|");
  singleSorted.forEach((s, i) => {
    lines.push(`| ${i + 1} | [${s.osmId}](https://www.openstreetmap.org/way/${s.osmId}) | ${s.nearestStation ?? "-"} | ${s.lengthM} | ${s.passengerLines} | ${s.service ?? "-"} | ${s.name ?? "-"} |`);
  });
  lines.push("");

  // === Sanity check rules ===
  lines.push("## 核对要点");
  lines.push("");
  lines.push("- **A 类 (paired)**: 同一行的两个 OSM way 在 OSM 网站上应当看上去是 \"同一区段的两条平行轨道\". bearΔ 偏离 180° (例如 < 170° 或 > 190°) 的可能是错对.");
  lines.push("- **B 类 (unpaired)**: 数据/算法盲区. 若你确认该 way 在 OSM 上是 \"单 LineString 表达双线 (隧道段常见)\", 我们后续按 `directionRole=bidirectional` 处理. 若该 way 实际是 \"复线段的一半但配对算法选错了对端\", 请指出应当配对到哪条.");
  lines.push("- **C 类**: 主要是单线段 + 3 条渡线 (service=crossover) + 1 条接续线 (name含\"接続線\"). 不需要配对.");

  writeFileSync(PAIRING_REPORT_PATH, lines.join("\n"), "utf-8");
  console.log(`\n  pairing review markdown written: ${PAIRING_REPORT_PATH}`);
}

main();
