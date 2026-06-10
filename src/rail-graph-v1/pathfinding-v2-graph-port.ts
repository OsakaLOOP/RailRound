// ============================================================
// Rail Graph v1 — Pathfinding v2: GraphPort 抽象层
//
// 算法层 (line-graph / search / chain) 与拓扑层之间唯一接口。
// 设计目的:
//   1. 算法层不直接 import topology.ts / geometry-math.ts / base-topology.types
//      只依赖 GraphPort interface, 便于 mock 测试和未来切换数据源
//   2. 内置缓存: calculateTurnAngleAt / edgeExitCoord 等高频调用结果缓存,
//      避免 K-shortest 反复算同一转角
//   3. 集中"语义判定": isFlexibleDirection / isTurnbackEdge / 站台反查 等,
//      便于算法层用统一谓词表达
// ============================================================

import type {
  BaseTopologyLayer,
  TopologyEdge,
  TopologyNode,
  TrackDirectionRole,
  TrackFunctionalUse,
} from "./base-topology.types";
import type { EntityRef } from "./primitives";
import type { TopologyLookup } from "./topology";
import { isDirectionRoleCompatible, isTurnbackAllowed, isTraversalForbidden } from "./topology";
import { calculateTurnAngle, haversineDistance, type Position } from "./geometry-math";

// ── 1. Direction Type alias ──────────────────────────────────

/** Line Graph 节点的方向标记: 沿 edge.fromNode→toNode 或反向 */
export type LGDir = "fromTo" | "toFrom";

// ── 2. GraphPort Interface ───────────────────────────────────

/**
 * 算法层访问拓扑的唯一接口。
 *
 * 所有几何 / 拓扑 / 语义查询都通过此接口, 不直接调用 topology.ts / geometry-math.ts。
 * 默认实现 createGraphPortFromTopology 委派给现有 module 并加缓存。
 */
export interface GraphPort {
  // ── 基础访问 ──
  getEdge(id: EntityRef): TopologyEdge | null;
  getNode(id: EntityRef): TopologyNode | null;
  getOutEdges(nodeRef: EntityRef): readonly EntityRef[];
  getInEdges(nodeRef: EntityRef): readonly EntityRef[];
  allEdges(): readonly TopologyEdge[];
  allNodes(): readonly TopologyNode[];

  // ── 几何 (内部带缓存) ──

  /**
   * 计算两条 edge 在共享节点处的转角 (0~180°)。结果缓存。
   * 缺少 coordinates 时返回 180 (视为不可通过的钝角)。
   */
  calculateTurnAngleAt(
    edgeInId: EntityRef,
    edgeOutId: EntityRef,
    sharedNodeRef: EntityRef,
  ): number;

  /** 两个 [lng, lat] 坐标的球面距离 (米) */
  haversineDistanceBetween(a: Position, b: Position): number;

  /**
   * Edge 沿指定方向遍历完毕时的"出口端"坐标。
   * dir="fromTo": 返回 toNode 端坐标
   * dir="toFrom": 返回 fromNode 端坐标
   * 缺少 coordinates 时回退到 node 的 geometryRef (若有);否则返回 null。
   */
  edgeExitCoord(edgeId: EntityRef, dir: LGDir): Position | null;

  /** Edge 沿指定方向遍历的"入口端"坐标 (与 exitCoord 对偶) */
  edgeEntryCoord(edgeId: EntityRef, dir: LGDir): Position | null;

  /** Node 的坐标 (若可推断) */
  nodeCoord(nodeRef: EntityRef): Position | null;

  // ── 语义判定 ──

  /** 两个 directionRole 是否兼容 (与 topology.ts:isDirectionRoleCompatible 一致) */
  isDirectionCompatible(
    a: TrackDirectionRole | undefined,
    b: TrackDirectionRole | undefined,
  ): boolean;

  /** edge 是否允许 turnback (reversible + functionalUse 含 turnback) */
  isTurnbackEdge(edgeId: EntityRef): boolean;

  /** role 是否"灵活" (undefined / bidirectional / reversible) — 允许过渡到任何方向 */
  isFlexibleDirection(role: TrackDirectionRole | undefined): boolean;

  /** edge 上是否有 stopping point */
  edgeHasStoppingPoint(edgeId: EntityRef): boolean;

  /** edge.functionalUse 是否包含某 use */
  edgeFunctionalUseIncludes(edgeId: EntityRef, use: TrackFunctionalUse): boolean;

  /** 该 edge / 节点对组合是否被硬约束禁止 (forbid_traversal / forbid_transition / closed_edge) */
  isTraversalForbidden(
    edgeId: EntityRef,
    fromNodeRef?: EntityRef,
    toNodeRef?: EntityRef,
  ): boolean;

  // ── 站台 / binding 反查 (chain 编译用) ──

  edgesForPlatform(platformRef: EntityRef): readonly EntityRef[];
  edgesForStation(stationRef: EntityRef): readonly EntityRef[];
  stoppingPointsOnEdge(edgeId: EntityRef): readonly EntityRef[];

  // ── 诊断 ──

  /** 取得本 port 的内部缓存命中统计, 调试用 */
  getCacheStats(): GraphPortCacheStats;
}

export interface GraphPortCacheStats {
  turnAngleHits: number;
  turnAngleMisses: number;
  exitCoordHits: number;
  exitCoordMisses: number;
}

// ── 3. Default Implementation ────────────────────────────────

/**
 * 默认 GraphPort 实现: 委派给 topology.ts / geometry-math.ts, 加内部缓存。
 *
 * 一次构造的 GraphPort 只对应一个 (topo, lookup) 快照, 不能跨 topo 复用。
 */
export function createGraphPortFromTopology(
  topo: BaseTopologyLayer,
  lookup: TopologyLookup,
): GraphPort {
  // ── 缓存表 ──
  const turnAngleCache = new Map<string, number>();
  const exitCoordCache = new Map<string, Position | null>();
  const stats: GraphPortCacheStats = {
    turnAngleHits: 0,
    turnAngleMisses: 0,
    exitCoordHits: 0,
    exitCoordMisses: 0,
  };

  // ── 站台 → edges 反查表 (一次构建) ──
  const platformToEdges = new Map<EntityRef, EntityRef[]>();
  for (const b of topo.platformTrackBindings) {
    const list = platformToEdges.get(b.platformRef) ?? [];
    list.push(b.edgeRef);
    platformToEdges.set(b.platformRef, list);
  }

  // ── 车站 → edges 反查表 (经 platform 间接) ──
  const stationToEdges = new Map<EntityRef, EntityRef[]>();
  for (const station of topo.stations) {
    const allEdges: EntityRef[] = [];
    for (const platformRef of station.platformRefs) {
      const eds = platformToEdges.get(platformRef) ?? [];
      allEdges.push(...eds);
    }
    stationToEdges.set(station.id, dedupArray(allEdges));
  }

  // ── 节点坐标推断: 优先 node.geometryRef → coordinates;否则从相邻 edge 端点猜 ──
  const nodeCoordCache = new Map<EntityRef, Position | null>();

  function nodeCoord(nodeRef: EntityRef): Position | null {
    const cached = nodeCoordCache.get(nodeRef);
    if (cached !== undefined) return cached;

    // node 自身坐标 (若有 geometryRef → 暂不支持; 用相邻 edge 端点)
    const outEds = lookup.edgesById ? Object.values(lookup.edgesById) : [];
    for (const edge of outEds) {
      if (!edge.coordinates || edge.coordinates.length === 0) continue;
      if (edge.fromNodeRef === nodeRef) {
        nodeCoordCache.set(nodeRef, edge.coordinates[0]);
        return edge.coordinates[0];
      }
      if (edge.toNodeRef === nodeRef) {
        nodeCoordCache.set(nodeRef, edge.coordinates[edge.coordinates.length - 1]);
        return edge.coordinates[edge.coordinates.length - 1];
      }
    }
    nodeCoordCache.set(nodeRef, null);
    return null;
  }

  // ── Port 实现 ──
  const port: GraphPort = {
    getEdge(id) {
      return lookup.edgesById[id] ?? null;
    },
    getNode(id) {
      return lookup.nodesById[id] ?? null;
    },
    getOutEdges(nodeRef) {
      return topo.adjacency.outEdges[nodeRef] ?? [];
    },
    getInEdges(nodeRef) {
      return topo.adjacency.inEdges[nodeRef] ?? [];
    },
    allEdges() {
      return topo.edges;
    },
    allNodes() {
      return topo.nodes;
    },

    calculateTurnAngleAt(edgeInId, edgeOutId, sharedNodeRef) {
      const key = `${edgeInId}|${edgeOutId}|${sharedNodeRef}`;
      const hit = turnAngleCache.get(key);
      if (hit !== undefined) {
        stats.turnAngleHits += 1;
        return hit;
      }
      stats.turnAngleMisses += 1;

      const edgeIn = lookup.edgesById[edgeInId];
      const edgeOut = lookup.edgesById[edgeOutId];
      if (!edgeIn?.coordinates || !edgeOut?.coordinates) {
        turnAngleCache.set(key, 180);
        return 180;
      }
      // 共享 node 的坐标:从 edgeIn 上推断 (它的某一端 == sharedNodeRef)
      let sharedCoord: Position | undefined;
      if (edgeIn.fromNodeRef === sharedNodeRef) {
        sharedCoord = edgeIn.coordinates[0];
      } else if (edgeIn.toNodeRef === sharedNodeRef) {
        sharedCoord = edgeIn.coordinates[edgeIn.coordinates.length - 1];
      }
      if (!sharedCoord) {
        turnAngleCache.set(key, 180);
        return 180;
      }
      const angle = calculateTurnAngle(edgeIn.coordinates, edgeOut.coordinates, sharedCoord);
      turnAngleCache.set(key, angle);
      return angle;
    },

    haversineDistanceBetween(a, b) {
      return haversineDistance(a, b);
    },

    edgeExitCoord(edgeId, dir) {
      const key = `${edgeId}|${dir}|exit`;
      const hit = exitCoordCache.get(key);
      if (hit !== undefined) {
        stats.exitCoordHits += 1;
        return hit;
      }
      stats.exitCoordMisses += 1;
      const edge = lookup.edgesById[edgeId];
      if (!edge?.coordinates || edge.coordinates.length === 0) {
        // 回退到 node 坐标
        const node = dir === "fromTo" ? edge?.toNodeRef : edge?.fromNodeRef;
        const fallback = node ? nodeCoord(node) : null;
        exitCoordCache.set(key, fallback);
        return fallback;
      }
      const coord = dir === "fromTo"
        ? edge.coordinates[edge.coordinates.length - 1]
        : edge.coordinates[0];
      exitCoordCache.set(key, coord);
      return coord;
    },

    edgeEntryCoord(edgeId, dir) {
      const key = `${edgeId}|${dir}|entry`;
      const hit = exitCoordCache.get(key);
      if (hit !== undefined) {
        stats.exitCoordHits += 1;
        return hit;
      }
      stats.exitCoordMisses += 1;
      const edge = lookup.edgesById[edgeId];
      if (!edge?.coordinates || edge.coordinates.length === 0) {
        const node = dir === "fromTo" ? edge?.fromNodeRef : edge?.toNodeRef;
        const fallback = node ? nodeCoord(node) : null;
        exitCoordCache.set(key, fallback);
        return fallback;
      }
      const coord = dir === "fromTo"
        ? edge.coordinates[0]
        : edge.coordinates[edge.coordinates.length - 1];
      exitCoordCache.set(key, coord);
      return coord;
    },

    nodeCoord,

    isDirectionCompatible(a, b) {
      return isDirectionRoleCompatible(a, b);
    },

    isTurnbackEdge(edgeId) {
      const edge = lookup.edgesById[edgeId];
      return edge ? isTurnbackAllowed(edge) : false;
    },

    isFlexibleDirection(role) {
      return role === undefined || role === "bidirectional" || role === "reversible";
    },

    edgeHasStoppingPoint(edgeId) {
      return (lookup.stoppingPointsByEdge[edgeId]?.length ?? 0) > 0;
    },

    edgeFunctionalUseIncludes(edgeId, use) {
      const edge = lookup.edgesById[edgeId];
      return Array.isArray(edge?.functionalUse) && edge.functionalUse.includes(use);
    },

    isTraversalForbidden(edgeId, fromNodeRef, toNodeRef) {
      return isTraversalForbidden(lookup, edgeId, fromNodeRef, toNodeRef);
    },

    edgesForPlatform(platformRef) {
      return platformToEdges.get(platformRef) ?? [];
    },

    edgesForStation(stationRef) {
      return stationToEdges.get(stationRef) ?? [];
    },

    stoppingPointsOnEdge(edgeId) {
      const list = lookup.stoppingPointsByEdge[edgeId] ?? [];
      return list.map((sp) => sp.id);
    },

    getCacheStats() {
      return { ...stats };
    },
  };

  return port;
}

// ── 4. Utility ───────────────────────────────────────────────

function dedupArray<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
