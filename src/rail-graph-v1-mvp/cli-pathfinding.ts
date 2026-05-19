#!/usr/bin/env tsx
// ============================================================
// cli-pathfinding — 离线提取/浏览 .railround.json 中 pathfinding 结果
//
// 用法: npx tsx cli-pathfinding.ts <file> [options]
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

// ── 类型定义 (与 poc-senseki-pathfinding.ts 保持同步) ──────────

interface SensekiPathExportEdge {
  index: number;
  edgeId: string;
  sourceFeatureRef?: string;
  fromCoord: [number, number] | null;
  toCoord: [number, number] | null;
  lengthMeters: number;
  bearingDeg: number | null;
  directionRole?: string;
  isTurnbackEdge: boolean;
}

interface SensekiPathExportCandidate {
  totalDistanceMeters: number;
  startKind: "main" | "siding";
  startCoord: [number, number] | null;
  endCoord: [number, number] | null;
  initialBearingDeg: number | null;
  edges: SensekiPathExportEdge[];
  turnbackEvents: Array<{
    edgeIndex: number;
    edgeId: string;
    atCoord: [number, number] | null;
  }>;
  phases: Array<{
    phaseIndex: number;
    kind: "up_run" | "down_run" | "turnback";
    directionRole?: string;
    edgeRange: { startIndex: number; endIndex: number };
    distanceMeters: number;
  }>;
}

interface SensekiPathExportScenario {
  name: string;
  description: string;
  passed: boolean;
  reason?: string;
  best?: SensekiPathExportCandidate;
  candidates: SensekiPathExportCandidate[];
}

interface SensekiDemoSnapshot {
  schemaVersion: string;
  exportedAt: string;
  pathfindingResults?: SensekiPathExportScenario[];
}

// ── CLI 参数解析 ──────────────────────────────────────────────

interface CliOptions {
  file: string;
  nameFilter: string;
  level: "scenarios" | "candidates" | "phases" | "edges" | "detail";
  candidateIndex: number;
  json: boolean;
  geo: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    file: "",
    nameFilter: "",
    level: "scenarios",
    candidateIndex: 0,
    json: false,
    geo: false,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "-h" || a === "--help") {
      opts.help = true;
    } else if (a === "-n" || a === "--name") {
      opts.nameFilter = args[++i] ?? "";
    } else if (a === "-l" || a === "--level") {
      const v = args[++i] ?? "";
      if (["scenarios", "candidates", "phases", "edges", "detail"].includes(v)) {
        opts.level = v as CliOptions["level"];
      } else {
        die(`无效层级: "${v}". 可选: scenarios, candidates, phases, edges, detail`);
      }
    } else if (a === "-c" || a === "--candidate") {
      opts.candidateIndex = Number(args[++i]) || 0;
    } else if (a === "--json") {
      opts.json = true;
    } else if (a === "--geo") {
      opts.geo = true;
    } else if (a.startsWith("-")) {
      die(`未知参数: ${a}`);
    } else {
      opts.file = a;
    }
    i += 1;
  }

  return opts;
}

function showHelp(): void {
  console.log(`
cli-pathfinding — 从 .railround.json 导出中提取/浏览寻路结果

用法:
  npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts <file> [options]

参数:
  <file>                 .railround.json 文件路径 (必填)
  -n, --name <pattern>   按 scenario name 过滤 (子串匹配, 不区分大小写)
  -l, --level <level>    展示层级 (默认 scenarios)
                           scenarios  场景概览表
                           candidates 某场景的所有候选路径
                           phases     某候选的 phase 分解
                           edges      某候选的 edge 序列 (地理列表)
                           detail     完整细节 (phases + edges + 折返)
  -c, --candidate <n>    candidate 索引 0-based (默认 0), phases/edges/detail 层有效
  --geo                  在 edges 输出中包含经纬度坐标
  --json                 输出原始 JSON (忽略 level/format)
  -h, --help             显示此帮助

示例:
  # 列出所有场景
  npx tsx cli-pathfinding.ts senseki-demo.railround.json

  # 按 name 筛选场景
  npx tsx cli-pathfinding.ts demo.railround.json -n "S0"

  # 查看某场景的所有候选路径
  npx tsx cli-pathfinding.ts demo.railround.json -n "S0" -l candidates

  # 查看第 0 个候选的 edge 地理列表 (含坐标)
  npx tsx cli-pathfinding.ts demo.railround.json -n "S0" -l edges --geo

  # 输出原始 JSON
  npx tsx cli-pathfinding.ts demo.railround.json --json
`);
}

function die(msg: string): never {
  console.error(`[错误] ${msg}`);
  process.exit(1);
}

// ── 格式化工具 ────────────────────────────────────────────────

function padEnd(s: string, n: number): string {
  const len = [...s].length; // CJK 宽度粗略处理: 每个非 ASCII 字符计 2
  const ascii = s.replace(/[^\x00-\x7f]/g, "xx");
  const width = ascii.length;
  return s + " ".repeat(Math.max(0, n - width));
}

function distKm(m: number): string {
  return (m / 1000).toFixed(2) + " km";
}

function bearingStr(deg: number | null): string {
  if (deg == null) return "N/A";
  return deg.toFixed(0) + "°";
}

function coordStr(c: [number, number] | null): string {
  if (!c) return "N/A";
  return `(${c[0].toFixed(6)}, ${c[1].toFixed(6)})`;
}

function passFail(p: boolean): string {
  return p ? "✓ PASS" : "✗ FAIL";
}

function phaseKindLabel(k: string): string {
  switch (k) {
    case "up_run": return "上行";
    case "down_run": return "下行";
    case "turnback": return "折返";
    default: return k;
  }
}

function edgeRangeStr(r: { startIndex: number; endIndex: number }): string {
  return r.startIndex === r.endIndex ? String(r.startIndex) : `${r.startIndex}-${r.endIndex}`;
}

function shortRef(ref: string | undefined): string {
  if (!ref) return "-";
  // osm:way:351315047 → way:3513...
  const parts = ref.split(":");
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    return parts.slice(0, -1).join(":") + ":" + last.slice(0, 8);
  }
  return ref.length > 32 ? ref.slice(0, 29) + "..." : ref;
}

// ── 各层级渲染 ────────────────────────────────────────────────

function renderScenarios(scenarios: SensekiPathExportScenario[]): void {
  if (scenarios.length === 0) {
    console.log("(无匹配场景)");
    return;
  }

  console.log(`共 ${scenarios.length} 个场景:`);
  console.log("");

  // Header
  const cols = [36, 8, 9, 12, 0];
  const header =
    padEnd("name", cols[0]) + " │ " +
    padEnd("passed", cols[1]) + " │ " +
    padEnd("候选数", cols[2]) + " │ " +
    padEnd("最优距离", cols[3]) + " │ " +
    "说明";
  console.log(header);
  console.log("─".repeat(header.length + 4));

  for (const s of scenarios) {
    const bestDist = s.best ? distKm(s.best.totalDistanceMeters) : "-";
    const reason = s.reason ?? "-";
    console.log(
      padEnd(s.name, cols[0]) + " │ " +
      padEnd(passFail(s.passed), cols[1]) + " │ " +
      padEnd(String(s.candidates.length), cols[2]) + " │ " +
      padEnd(bestDist, cols[3]) + " │ " +
      reason,
    );
  }
}

function renderCandidates(scenario: SensekiPathExportScenario): void {
  console.log(`场景: ${scenario.name}`);
  console.log(`说明: ${scenario.description}`);
  console.log(`状态: ${passFail(scenario.passed)}${scenario.reason ? " (" + scenario.reason + ")" : ""}`);
  console.log(`候选数: ${scenario.candidates.length}`);
  console.log("");

  if (scenario.candidates.length === 0) {
    console.log("(无候选)");
    return;
  }

  for (let i = 0; i < scenario.candidates.length; i++) {
    const c = scenario.candidates[i];
    const marker = i === 0 ? " ★ best" : "";
    console.log(`── 候选 #${i}${marker}`);
    console.log(`  距离:     ${distKm(c.totalDistanceMeters)} (${c.totalDistanceMeters} m)`);
    console.log(`  起步:     ${c.startKind === "main" ? "主线" : "侧线"}`);
    console.log(`  edges:    ${c.edges.length} 条`);
    console.log(`  phases:   ${c.phases.map((p) => phaseKindLabel(p.kind) + " " + distKm(p.distanceMeters)).join(" → ")}`);
    if (c.edges.length > 0) {
      console.log(`  起点坐标: ${coordStr(c.startCoord)}`);
      console.log(`  终点坐标: ${coordStr(c.endCoord)}`);
      console.log(`  初始方位: ${bearingStr(c.initialBearingDeg)}`);
    }
    if (c.turnbackEvents.length > 0) {
      for (const tb of c.turnbackEvents) {
        console.log(`  折返 @ edge[${tb.edgeIndex}]: ${shortRef(tb.edgeId)} ${coordStr(tb.atCoord)}`);
      }
    }
    console.log("");
  }
}

function renderPhases(candidate: SensekiPathExportCandidate): void {
  console.log(`Phases (共 ${candidate.phases.length} 段, 总距离 ${distKm(candidate.totalDistanceMeters)})`);
  console.log("");

  const header =
    padEnd("phase", 6) + " │ " +
    padEnd("类型", 6) + " │ " +
    padEnd("方向", 8) + " │ " +
    padEnd("edge 范围", 10) + " │ " +
    "距离";
  console.log(header);
  console.log("─".repeat(header.length + 4));

  for (const p of candidate.phases) {
    console.log(
      padEnd(String(p.phaseIndex), 6) + " │ " +
      padEnd(phaseKindLabel(p.kind), 6) + " │ " +
      padEnd(p.directionRole ?? "-", 8) + " │ " +
      padEnd(edgeRangeStr(p.edgeRange), 10) + " │ " +
      distKm(p.distanceMeters),
    );
  }
}

function renderEdges(candidate: SensekiPathExportCandidate, showGeo: boolean): void {
  console.log(`Edges (共 ${candidate.edges.length} 条, 总距离 ${distKm(candidate.totalDistanceMeters)})`);
  console.log("");

  if (showGeo) {
    const header =
      padEnd("#", 4) + " │ " +
      padEnd("osm way", 20) + " │ " +
      padEnd("长度", 9) + " │ " +
      padEnd("方位", 6) + " │ " +
      padEnd("方向角色", 8) + " │ " +
      padEnd("折返", 4) + " │ " +
      "from → to";
    console.log(header);
    console.log("─".repeat(header.length + 4));

    for (const e of candidate.edges) {
      const from = e.fromCoord ? `${e.fromCoord[0].toFixed(5)},${e.fromCoord[1].toFixed(5)}` : "N/A";
      const to = e.toCoord ? `${e.toCoord[0].toFixed(5)},${e.toCoord[1].toFixed(5)}` : "N/A";
      console.log(
        padEnd(String(e.index), 4) + " │ " +
        padEnd(shortRef(e.sourceFeatureRef), 20) + " │ " +
        padEnd(distKm(e.lengthMeters), 9) + " │ " +
        padEnd(bearingStr(e.bearingDeg), 6) + " │ " +
        padEnd(e.directionRole ?? "-", 8) + " │ " +
        padEnd(e.isTurnbackEdge ? "⟲" : "", 4) + " │ " +
        `${from} → ${to}`,
      );
    }
  } else {
    const header =
      padEnd("#", 4) + " │ " +
      padEnd("osm way", 20) + " │ " +
      padEnd("长度", 9) + " │ " +
      padEnd("方位", 6) + " │ " +
      padEnd("方向角色", 8) + " │ " +
      "折返";
    console.log(header);
    console.log("─".repeat(header.length + 4));

    for (const e of candidate.edges) {
      console.log(
        padEnd(String(e.index), 4) + " │ " +
        padEnd(shortRef(e.sourceFeatureRef), 20) + " │ " +
        padEnd(distKm(e.lengthMeters), 9) + " │ " +
        padEnd(bearingStr(e.bearingDeg), 6) + " │ " +
        padEnd(e.directionRole ?? "-", 8) + " │ " +
        (e.isTurnbackEdge ? "⟲" : ""),
      );
    }
  }
}

function renderDetail(candidate: SensekiPathExportCandidate): void {
  console.log("═".repeat(60));
  console.log(`  总距离: ${distKm(candidate.totalDistanceMeters)} (${candidate.totalDistanceMeters} m)`);
  console.log(`  起步类型: ${candidate.startKind === "main" ? "主线 (main)" : "侧线 (siding)"}`);
  console.log(`  起点: ${coordStr(candidate.startCoord)}  初始方位: ${bearingStr(candidate.initialBearingDeg)}`);
  console.log(`  终点: ${coordStr(candidate.endCoord)}`);
  console.log("═".repeat(60));
  console.log("");

  // Phases
  renderPhases(candidate);
  console.log("");

  // Edges (with geo)
  renderEdges(candidate, true);
  console.log("");

  // Turnback events
  if (candidate.turnbackEvents.length > 0) {
    console.log(`折返事件 (${candidate.turnbackEvents.length}):`);
    for (const tb of candidate.turnbackEvents) {
      console.log(`  edge[${tb.edgeIndex}] ${shortRef(tb.edgeId)} @ ${coordStr(tb.atCoord)}`);
    }
    console.log("");
  }
}

// ── 主入口 ────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.file) {
    showHelp();
    process.exit(opts.help ? 0 : 1);
  }

  // 读取文件
  let raw: string;
  try {
    raw = fs.readFileSync(opts.file, "utf-8");
  } catch {
    die(`无法读取文件: ${opts.file}`);
  }

  let snapshot: SensekiDemoSnapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    die("JSON 解析失败, 请确认文件为有效的 .railround.json");
  }

  // 校验
  if (!snapshot.schemaVersion) {
    die("缺少 schemaVersion, 不是有效的 .railround.json");
  }
  if (snapshot.schemaVersion !== "senseki-demo-v2") {
    die(`schemaVersion=${snapshot.schemaVersion}, 需要 senseki-demo-v2 (含 pathfindingResults)`);
  }
  if (!snapshot.pathfindingResults || snapshot.pathfindingResults.length === 0) {
    die("文件中没有 pathfindingResults (导出时可能未运行寻路)");
  }

  const allScenarios = snapshot.pathfindingResults;
  const exportedAt = snapshot.exportedAt ?? "未知";

  // --json 模式
  if (opts.json) {
    // 若用户指定了 name 或 level 过滤, 则输出筛选后的 JSON
    let output: unknown = allScenarios;
    if (opts.nameFilter) {
      const lower = opts.nameFilter.toLowerCase();
      output = allScenarios.filter((s) => s.name.toLowerCase().includes(lower));
    }
    if (opts.level !== "scenarios" && opts.level !== void 0) {
      const scenarios = output as SensekiPathExportScenario[];
      if (scenarios.length === 0) {
        console.log("[]");
        return;
      }
      const s = scenarios[0];
      if (opts.level === "candidates") {
        output = s.candidates;
      } else {
        const c = s.candidates[opts.candidateIndex];
        if (!c) die(`candidate 索引 ${opts.candidateIndex} 越界 (共 ${s.candidates.length} 个候选)`);
        if (opts.level === "phases") output = c.phases;
        else if (opts.level === "edges") output = c.edges;
        else output = c;
      }
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // 文本模式
  console.log(`文件: ${path.basename(opts.file)}`);
  console.log(`导出时间: ${exportedAt}`);
  console.log(`场景总数: ${allScenarios.length}`);
  console.log("");

  // 按 name 过滤
  let scenarios = allScenarios;
  if (opts.nameFilter) {
    const lower = opts.nameFilter.toLowerCase();
    scenarios = allScenarios.filter((s) => s.name.toLowerCase().includes(lower));
    if (scenarios.length === 0) {
      die(`未找到匹配 "${opts.nameFilter}" 的场景`);
    }
    console.log(`过滤 "${opts.nameFilter}": ${scenarios.length} 个匹配`);
    console.log("");
  }

  switch (opts.level) {
    case "scenarios":
      renderScenarios(scenarios);
      break;
    case "candidates": {
      const s = scenarios[0];
      renderCandidates(s);
      break;
    }
    case "phases": {
      const s = scenarios[0];
      const c = s.candidates[opts.candidateIndex];
      if (!c) die(`candidate 索引 ${opts.candidateIndex} 越界 (共 ${s.candidates.length} 个候选)`);
      console.log(`场景: ${s.name}  /  候选 #${opts.candidateIndex}`);
      console.log("");
      renderPhases(c);
      break;
    }
    case "edges": {
      const s = scenarios[0];
      const c = s.candidates[opts.candidateIndex];
      if (!c) die(`candidate 索引 ${opts.candidateIndex} 越界 (共 ${s.candidates.length} 个候选)`);
      console.log(`场景: ${s.name}  /  候选 #${opts.candidateIndex}`);
      console.log("");
      renderEdges(c, opts.geo);
      break;
    }
    case "detail": {
      const s = scenarios[0];
      const c = s.candidates[opts.candidateIndex];
      if (!c) die(`candidate 索引 ${opts.candidateIndex} 越界 (共 ${s.candidates.length} 个候选)`);
      console.log(`场景: ${s.name}  /  候选 #${opts.candidateIndex}`);
      console.log("");
      renderDetail(c);
      break;
    }
  }
}

main();
