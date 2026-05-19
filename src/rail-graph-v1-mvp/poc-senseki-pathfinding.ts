// ============================================================
// PoC: 仙石線 Pathfinding — 基于真实 OSM 数据的复杂寻路场景
//
// 起点/终点: osm:way:351315047 (单线可逆, 石巻侧)
// 经停:      osm:way:1320551298 + osm:way:775723282
//            (青叶通地下站两条站台线, 可逆, 站前有交叉渡线连通)
//
// 路径: 石巻侧351315047 → [仙石線全线] → 青叶通1320551298
//       → [交叉渡线] → 青叶通775723282 → [折返] → 石巻侧351315047
//
// Annotation overrides 通过 app.ts 的 localStorage 机制持久化
// (与 Import 仙石線 OSM 按钮行为一致).
// ============================================================

import type { RailGraphAnnotation } from "../rail-graph-v1/annotation.types";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { PathGoal, PathSeed, PathfindingResult } from "../rail-graph-v1/pathfinding";
import { findPaths } from "../rail-graph-v1/pathfinding";
import {
  buildTopologyLookup,
  isDirectionRoleCompatible,
  isTurnbackAllowed,
  type TopologyLookup,
} from "../rail-graph-v1/topology";

// ---- OSM Way ID 常量 (feature.properties.railGraph.id) ----

export const OSM_WAY_351315047 = "osm:way:351315047"; // 单线可逆, 石巻侧
export const OSM_WAY_1320551298 = "osm:way:1320551298"; // 青叶通站台线 1, 可逆+隧道
export const OSM_WAY_775723282 = "osm:way:775723282";   // 青叶通站台线 2, 可逆+隧道
export const OSM_WAY_598378597 = "osm:way:598378597";   // 石巻侧 短折返用, 可逆

// ---- Annotation Overrides (完整 RailGraphAnnotation) ----
// 通过 app.ts saveAnnotationOverride → localStorage → applyAnnotationOverrides 生效.
// 补全 MVP 寻路所需的 directionRole / functionalUse / physicalKind 显式声明.

export const SENSEKI_PF_OVERRIDES: Record<string, RailGraphAnnotation> = {
  [OSM_WAY_351315047]: {
    kind: "track_geometry",
    schemaVersion: "rail-graph-v1",
    id: OSM_WAY_351315047,
    source: "osm",
    track: {
      role: "main",
      traversal: "both",
      physicalKind: "main",
      directionRole: "reversible",
      functionalUse: ["through", "stopping", "turnback"],
    },
  },
  [OSM_WAY_1320551298]: {
    kind: "track_geometry",
    schemaVersion: "rail-graph-v1",
    id: OSM_WAY_1320551298,
    source: "osm",
    track: {
      role: "platform",
      traversal: "both",
      physicalKind: "main",
      directionRole: "reversible",
      functionalUse: ["through", "stopping", "turnback"],
    },
  },
  [OSM_WAY_775723282]: {
    kind: "track_geometry",
    schemaVersion: "rail-graph-v1",
    id: OSM_WAY_775723282,
    source: "osm",
    track: {
      role: "platform",
      traversal: "both",
      physicalKind: "main",
      directionRole: "reversible",
      functionalUse: ["through", "stopping", "turnback"],
    },
  },
  [OSM_WAY_598378597]: {
    kind: "track_geometry",
    schemaVersion: "rail-graph-v1",
    id: OSM_WAY_598378597,
    source: "osm",
    track: {
      role: "main",
      traversal: "both",
      physicalKind: "main",
      directionRole: "reversible",
      functionalUse: ["through", "stopping", "turnback"],
    },
  },
};

// ---- Edge 查找 —— 从编译后的 topo 按 sourceFeatureRef 找 edge ----

function findEdgeBySourceRef(topo: BaseTopologyLayer, sourceFeatureRef: string): TopologyEdge | undefined {
  return topo.edges.find((e) => e.sourceSlice?.sourceFeatureRef === sourceFeatureRef);
}

// ---- 拓扑连通性诊断 (控制台输出) ----

function diagnoseConnectivity(topo: BaseTopologyLayer, lookup: TopologyLookup): void {
  const targetIds = [OSM_WAY_351315047, OSM_WAY_598378597, OSM_WAY_1320551298, OSM_WAY_775723282];
  const edges: Record<string, TopologyEdge | undefined> = {};
  for (const id of targetIds) {
    edges[id] = findEdgeBySourceRef(topo, id);
  }

  const adj = topo.adjacency; // outEdges / inEdges 在 topo.adjacency 上, 不在 lookup

  console.group("[senseki-pf] 拓扑连通性诊断");
  console.log("topo 总 edges:", topo.edges.length, "总 nodes:", topo.nodes.length);

  // 1. 目标 edge 信息
  console.group("1. 目标 OSM way → 编译后 edge");
  for (const id of targetIds) {
    const e = edges[id];
    if (!e) {
      console.warn(`  ${id}: NOT FOUND in topo.edges`);
      continue;
    }
    console.log(`  ${id}:`, {
      edgeId: e.id,
      fromNode: e.fromNodeRef,
      toNode: e.toNodeRef,
      traversal: e.traversal,
      directionRole: e.directionRole,
      functionalUse: e.functionalUse,
      physicalKind: e.physicalKind,
      role: e.role,
      turnbackAllowed: isTurnbackAllowed(e),
    });
  }
  console.groupEnd();

  // 2. 节点邻接信息
  const edge3513 = edges[OSM_WAY_351315047];
  const edge5983 = edges[OSM_WAY_598378597];
  if (edge3513 && edge5983) {
    console.group("2. 351315047 ↔ 598378597 节点邻接");
    for (const nodeId of [edge3513.fromNodeRef, edge3513.toNodeRef]) {
      const outEdgeList = adj.outEdges[nodeId] ?? [];
      const inEdgeList = adj.inEdges[nodeId] ?? [];
      console.log(`  节点 ${nodeId}:`, {
        outCount: outEdgeList.length,
        inCount: inEdgeList.length,
        outEdgeIds: outEdgeList.map((eid) => {
          const eobj = lookup.edgesById[eid];
          return eobj
            ? `${eid.slice(-16)} dir=${eobj.directionRole ?? "?"} trav=${eobj.traversal} func=${(eobj.functionalUse ?? []).join(",")}`
            : `${eid.slice(-16)} (missing!)`;
        }),
        inEdgeIds: inEdgeList.map((eid) => {
          const eobj = lookup.edgesById[eid];
          return eobj
            ? `${eid.slice(-16)} dir=${eobj.directionRole ?? "?"} trav=${eobj.traversal}`
            : `${eid.slice(-16)} (missing!)`;
        }),
      });
    }
    console.groupEnd();

    // 3. 方向兼容性检查: 从 startNode 出发, 有哪些 edge 兼容 "up" 方向
    console.group("3. 从 startNode (3513.toNodeRef) 出发的方向兼容性");
    const startNode = edge3513.toNodeRef;
    const outEdgeList = adj.outEdges[startNode] ?? [];
    for (const eid of outEdgeList) {
      const eobj = lookup.edgesById[eid];
      if (!eobj) continue;
      const compatUp = isDirectionRoleCompatible("up", eobj.directionRole);
      const compatDown = isDirectionRoleCompatible("down", eobj.directionRole);
      const isStartEdge = eobj.sourceSlice?.sourceFeatureRef === OSM_WAY_351315047;
      console.log(
        `    ${eid.slice(-20)} ${isStartEdge ? "(=3513自身)" : ""}`,
        `dir=${eobj.directionRole ?? "?"} compat:up=${compatUp} down=${compatDown}`,
      );
    }
    console.groupEnd();

    // 4. 两者是否共享节点 (直接相邻)
    console.group("4. 3513 与 5983 是否共享节点");
    const nodes3513 = new Set([edge3513.fromNodeRef, edge3513.toNodeRef]);
    const nodes5983 = new Set([edge5983.fromNodeRef, edge5983.toNodeRef]);
    const shared = [...nodes3513].filter((n) => nodes5983.has(n));
    console.log(`  共享节点: ${shared.length === 0 ? "无 (不直接相邻)" : shared.join(", ")}`);
    console.groupEnd();
  }

  // 5. 从 startNode 出发 BFS (有限深度) 看可达范围
  //    注意: outEdges[node] 中 edge 的 "另一端" 不一定是 toNodeRef;
  //    当 traversal=both 时 fromNode/toNode 都可能作为出发点.
  const startNode = edge3513?.toNodeRef;
  if (startNode) {
    console.group("5. BFS 有限可达 (深度 8, 上限 60 条)");
    const visited = new Set<EntityRef>();
    const queue: { node: EntityRef; depth: number }[] = [{ node: startNode, depth: 0 }];
    visited.add(startNode);
    let found5983 = false;
    let count = 0;
    while (queue.length > 0 && count < 60) {
      const cur = queue.shift()!;
      if (cur.depth >= 8) continue;
      const outE = adj.outEdges[cur.node] ?? [];
      for (const eid of outE) {
        const eobj = lookup.edgesById[eid];
        if (!eobj) continue;
        // 正确计算 "另一端": 从 cur.node 进入 edge, 离开到哪个 node
        const nextNode = eobj.fromNodeRef === cur.node ? eobj.toNodeRef : eobj.fromNodeRef;
        if (visited.has(nextNode)) continue;
        visited.add(nextNode);
        count++;
        const marker =
          eobj.sourceSlice?.sourceFeatureRef === OSM_WAY_598378597
            ? " ←★5983"
            : nextNode === edge5983?.fromNodeRef || nextNode === edge5983?.toNodeRef
              ? " ←?5983 node"
              : "";
        console.log(
          `    d=${cur.depth + 1} node=${nextNode.slice(-24)} edge=${eid.slice(-24)} dir=${eobj.directionRole ?? "?"}${marker}`,
        );
        if (eobj.sourceSlice?.sourceFeatureRef === OSM_WAY_598378597) {
          found5983 = true;
        }
        queue.push({ node: nextNode, depth: cur.depth + 1 });
      }
    }
    console.log(`  找到5983: ${found5983}, 已探索${count}个节点`);
    console.groupEnd();
  }

  console.groupEnd();
}

// ---- 场景定义 ----

export interface SensekiScenario {
  name: string;
  description: string;
  startSeed: PathSeed;
  endSeed: PathSeed;
  pathGoal?: PathGoal;
}

export interface SensekiScenarioResult {
  scenario: SensekiScenario;
  candidates: PathfindingResult[];
  best?: PathfindingResult;
  passed: boolean;
  reason?: string;
}
function buildScenarios(topo: BaseTopologyLayer, lookup: TopologyLookup): SensekiScenario[] {
  const edge3513 = findEdgeBySourceRef(topo, OSM_WAY_351315047);
  const edge5983 = findEdgeBySourceRef(topo, OSM_WAY_598378597);
  const edge1320 = findEdgeBySourceRef(topo, OSM_WAY_1320551298);
  const edge7757 = findEdgeBySourceRef(topo, OSM_WAY_775723282);

  if (!edge3513 || !edge5983) {
    console.warn("[senseki-pf] 目标 edge3513 或 edge5983 未在 topo 中找到");
    return [];
  }

  function findDeadEndNode(edge: TopologyEdge): EntityRef {
    const fromOut = topo.adjacency.outEdges[edge.fromNodeRef]?.length ?? 0;
    const fromIn = topo.adjacency.inEdges[edge.fromNodeRef]?.length ?? 0;
    const fromDegree = fromOut + fromIn;

    const toOut = topo.adjacency.outEdges[edge.toNodeRef]?.length ?? 0;
    const toIn = topo.adjacency.inEdges[edge.toNodeRef]?.length ?? 0;
    const toDegree = toOut + toIn;

    return fromDegree === 1 ? edge.fromNodeRef : edge.toNodeRef;
  }

  const startNode: EntityRef = edge3513.toNodeRef;

  const goalAt5983: PathGoal = {
    kind: "explicit",
    stops: [],
    turnback: { edgeRef: edge5983.id, count: 1, exact: true },
  };

  const scenarios: SensekiScenario[] = [
    // S0: 短折返 — 验证基本连通性
    {
      name: "S0 短折返: 3513西端→5983折返→回",
      description:
        "从351315047西端上り出发, goal强制在598378597折返, 返回同节点.",
      startSeed: { kind: "node", nodeRef: startNode, alongDirection: "up" },
      endSeed: { kind: "node", nodeRef: startNode },
      pathGoal: goalAt5983,
    },
    // S0b: 同上, 下り方向
    {
      name: "S0b 短折返: 3513西端→5983折返→回 (下り)",
      description: "同S0, 但以down方向出发.",
      startSeed: { kind: "node", nodeRef: startNode, alongDirection: "down" },
      endSeed: { kind: "node", nodeRef: startNode },
      pathGoal: goalAt5983,
    },
    // S0c: 从东端出发
    {
      name: "S0c 短折返: 3513东端→5983折返→回",
      description: "从351315047东端出发, goal强制在598378597折返.",
      startSeed: { kind: "node", nodeRef: edge3513.fromNodeRef, alongDirection: "up" },
      endSeed: { kind: "node", nodeRef: edge3513.fromNodeRef },
      pathGoal: goalAt5983,
    },
  ];

  if (edge1320 && edge7757) {
    const dead3513 = findDeadEndNode(edge3513);
    const dead1320 = findDeadEndNode(edge1320);
    const dead7757 = findDeadEndNode(edge7757);

    // S1: 完整单线双向跑 (石卷出发 -> 青叶通折返 -> 回石卷)
    scenarios.push({
      name: "S1 全程下行: 石卷出发→青叶通站台1折返→回到石卷",
      description: "从石卷351315047出发, 经过全线运行至青叶通站台1 (1320551298) 换向, 然后返回石卷.",
      startSeed: { kind: "node", nodeRef: dead3513, alongDirection: "up" },
      endSeed: { kind: "node", nodeRef: dead3513 },
      pathGoal: {
        kind: "explicit",
        stops: [],
        turnback: { edgeRef: edge1320.id, count: 1, exact: true }
      }
    });

    // S2: 完整单线双向跑 (青叶通出发 -> 石卷折返 -> 回青叶通)
    scenarios.push({
      name: "S2 全程上行: 青叶通站台2出发→石卷折返→回到青叶通站台1",
      description: "从青叶通站台2 (775723282) 发车, 经过全线运行至石卷 (351315047) 换向, 之后回到青叶通站台1 (1320551298).",
      startSeed: { kind: "node", nodeRef: dead7757, alongDirection: "down" },
      endSeed: { kind: "node", nodeRef: dead1320 },
      pathGoal: {
        kind: "explicit",
        stops: [],
        turnback: { edgeRef: edge3513.id, count: 1, exact: true }
      }
    });
  } else {
    console.warn("[senseki-pf] Aobadori edges (edge1320/edge7757) not found, skipping S1 and S2");
  }

  return scenarios;
}

// ---- 运行 ----

export function runSensekiScenarios(topo: BaseTopologyLayer): SensekiScenarioResult[] {
  const lookup = buildTopologyLookup(topo);

  // 先做连通性诊断 (控制台可看)
  diagnoseConnectivity(topo, lookup);

  const scenarios = buildScenarios(topo, lookup);

  if (scenarios.length === 0) {
    return [
      {
        scenario: {
          name: "SENSEKI_NO_EDGES",
          description: "Target edges not found in topology",
          startSeed: { kind: "node", nodeRef: "" as EntityRef },
          endSeed: { kind: "node", nodeRef: "" as EntityRef },
        },
        candidates: [],
        passed: false,
        reason: "One or more target OSM ways not found in compiled topology",
      },
    ];
  }

  const results: SensekiScenarioResult[] = [];

  for (const scenario of scenarios) {
    console.log(`[senseki-pf] 运行: ${scenario.name}`);
    const candidates = findPaths(topo, lookup, scenario.startSeed, scenario.endSeed, {
      maxCandidates: 4,
      maxDepth: 64,       // 短折返 ~16 edges 往返, 64 足够
      allowTurnback: true,
      pathGoal: scenario.pathGoal,
    });

    if (candidates.length === 0) {
      console.log(`[senseki-pf]   → 0 candidates`);
      results.push({
        scenario,
        candidates: [],
        passed: false,
        reason: "No candidates — 检查上方诊断输出",
      });
      continue;
    }

    const best = candidates[0];
    const hasTurnback = best.phases.some((p) => p.kind === "turnback");
    console.log(`[senseki-pf]   → ${candidates.length} candidates, best: ${Math.round(best.totalDistanceMeters)}m, turnback=${hasTurnback}`);
    results.push({
      scenario,
      candidates,
      best,
      passed: hasTurnback,
      reason: hasTurnback ? undefined : "no turnback phase detected",
    });
  }

  return results;
}

/** 把 senseki scenario results 压缩成可序列化 summary. */
export function summarizeSensekiResults(results: SensekiScenarioResult[]): unknown {
  return results.map((r) => ({
    name: r.scenario.name,
    description: r.scenario.description,
    passed: r.passed,
    reason: r.reason,
    candidatesCount: r.candidates.length,
    best: r.best
      ? {
          totalDistanceMeters: Math.round(r.best.totalDistanceMeters),
          startKind: r.best.startKind,
          edgeCount: r.best.edgeSequence.length,
          turnbackEdgeIndices: r.best.turnbackEdgeIndices,
          phases: r.best.phases.map((p) => ({
            phaseIndex: p.phaseIndex,
            kind: p.kind,
            directionRole: p.directionRole,
            edgeRange: p.edgeRange,
            distanceMeters: Math.round(p.distanceMeters),
          })),
          chainMode: r.best.resolvedChain?.mode,
          diagnostics: r.best.diagnostics,
        }
      : null,
  }));
}

// ============================================================
// Geo enrichment — 寻路结果导出 (含原始 edge 拼接 + 折返事件 + 方位角)
// ============================================================

/**
 * 从 node ID 中解码坐标. Node ID 格式:
 *   `manual:node:${slug(coordinateKey(coord))}`
 *   coordinateKey: `${lng.toFixed(6)},${lat.toFixed(6)}`
 *   slug: 把非 [a-zA-Z0-9_-] 字符 (含 `.` 和 `,`) 替换为 `-`, 末尾追加 -<hash16>
 *
 * 实际形态: `manual:node:141-301244-38-435411-c0558739`
 *   → lng_int=141, lng_frac=301244, lat_int=38, lat_frac=435411, hash=c0558739
 */
function decodeNodeCoordinate(nodeRef: EntityRef): [number, number] | null {
  const prefix = "manual:node:";
  if (!nodeRef.startsWith(prefix)) return null;
  const body = nodeRef.slice(prefix.length);
  const m = body.match(/^(\d+)-(\d+)-(\d+)-(\d+)-[0-9a-f]+$/);
  if (!m) return null;
  const lng = Number.parseFloat(`${m[1]}.${m[2]}`);
  const lat = Number.parseFloat(`${m[3]}.${m[4]}`);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/** 计算 [lng, lat] 两点间的方位角 (0–360°, 顺时针, 0=正北). */
function bearingDeg(from: [number, number], to: [number, number]): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const toDeg = (v: number) => (v * 180) / Math.PI;
  const dLng = toRad(to[0] - from[0]);
  const lat1 = toRad(from[1]);
  const lat2 = toRad(to[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface SensekiPathExportEdge {
  index: number;
  edgeId: EntityRef;
  /** OSM way id 或其他源 feature ref (来自 edge.sourceSlice.sourceFeatureRef) */
  sourceFeatureRef?: string;
  fromCoord: [number, number] | null;
  toCoord: [number, number] | null;
  lengthMeters: number;
  /** from→to 方位角 (按实际行进方向, 0–360°), 坐标解码失败时为 null */
  bearingDeg: number | null;
  directionRole?: string;
  isTurnbackEdge: boolean;
}

export interface SensekiPathExportCandidate {
  totalDistanceMeters: number;
  startKind: "main" | "siding";
  startCoord: [number, number] | null;
  endCoord: [number, number] | null;
  /** 第一条 edge 的 from→to 方位角 */
  initialBearingDeg: number | null;
  edges: SensekiPathExportEdge[];
  turnbackEvents: Array<{
    edgeIndex: number;
    edgeId: EntityRef;
    /** 折返发生位置 = 进入 turnback edge 时的入口端点 */
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

export interface SensekiPathExportScenario {
  name: string;
  description: string;
  passed: boolean;
  reason?: string;
  best?: SensekiPathExportCandidate;
  /** best + 其余候选 (顺序与 findPaths 排序一致, best 即 [0]) */
  candidates: SensekiPathExportCandidate[];
}

function buildExportCandidate(
  candidate: PathfindingResult,
  topo: BaseTopologyLayer,
): SensekiPathExportCandidate {
  const turnbackSet = new Set(candidate.turnbackEdgeIndices);
  const edgesById = new Map<EntityRef, TopologyEdge>();
  for (const e of topo.edges) edgesById.set(e.id, e);

  // pathSegments 与 edgeSequence 一一对齐 (orderIndex 升序), 提供实际行进方向的 from/to
  const segByIndex: Map<number, { fromNodeRef?: EntityRef; toNodeRef?: EntityRef }> = new Map();
  for (const seg of candidate.pathSegments) {
    segByIndex.set(seg.orderIndex, { fromNodeRef: seg.fromNodeRef, toNodeRef: seg.toNodeRef });
  }

  const edges: SensekiPathExportEdge[] = candidate.edgeSequence.map((edgeId, index) => {
    const edge = edgesById.get(edgeId);
    const seg = segByIndex.get(index);
    // 优先用 pathSegment 的方向语义; fallback 到 edge 几何
    const fromNode = seg?.fromNodeRef ?? edge?.fromNodeRef;
    const toNode = seg?.toNodeRef
      ?? (edge && fromNode
        ? edge.fromNodeRef === fromNode
          ? edge.toNodeRef
          : edge.fromNodeRef
        : undefined);
    const fromCoord = fromNode ? decodeNodeCoordinate(fromNode) : null;
    const toCoord = toNode ? decodeNodeCoordinate(toNode) : null;
    return {
      index,
      edgeId,
      sourceFeatureRef: edge?.sourceSlice?.sourceFeatureRef,
      fromCoord,
      toCoord,
      lengthMeters: edge?.lengthMeters ?? 0,
      bearingDeg: fromCoord && toCoord ? bearingDeg(fromCoord, toCoord) : null,
      directionRole: edge?.directionRole,
      isTurnbackEdge: turnbackSet.has(index),
    };
  });

  const turnbackEvents = candidate.turnbackEdgeIndices.map((edgeIndex) => {
    const entry = edges[edgeIndex];
    return {
      edgeIndex,
      edgeId: entry?.edgeId ?? ("" as EntityRef),
      atCoord: entry?.fromCoord ?? null,
    };
  });

  const startCoord = edges[0]?.fromCoord ?? null;
  const endCoord = edges[edges.length - 1]?.toCoord ?? null;
  const initialBearingDeg = edges[0]?.bearingDeg ?? null;

  return {
    totalDistanceMeters: Math.round(candidate.totalDistanceMeters),
    startKind: candidate.startKind,
    startCoord,
    endCoord,
    initialBearingDeg,
    edges,
    turnbackEvents,
    phases: candidate.phases.map((p) => ({
      phaseIndex: p.phaseIndex,
      kind: p.kind,
      directionRole: p.directionRole,
      edgeRange: p.edgeRange,
      distanceMeters: Math.round(p.distanceMeters),
    })),
  };
}

/** 把 senseki 寻路结果序列化为带地理信息的可导出结构. */
export function exportSensekiPathResults(
  results: SensekiScenarioResult[],
  topo: BaseTopologyLayer,
): SensekiPathExportScenario[] {
  return results.map((r) => {
    const candidates = r.candidates.map((c) => buildExportCandidate(c, topo));
    const best = r.best ? candidates[0] : undefined;
    return {
      name: r.scenario.name,
      description: r.scenario.description,
      passed: r.passed,
      reason: r.reason,
      best,
      candidates,
    };
  });
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    pocSensekiPathfinding: {
      OSM_WAY_351315047,
      OSM_WAY_1320551298,
      OSM_WAY_775723282,
      OSM_WAY_598378597,
      SENSEKI_PF_OVERRIDES,
      runSensekiScenarios,
      summarizeSensekiResults,
      exportSensekiPathResults,
    },
  });
}
