import { polylineLengthMeters } from "./spatial-helpers";

type NodeKey = string;
type WayFid = string;

const PRECISION_M_DEFAULT = 0.0000001;   // 7 decimal places ≈ 1cm
const PRECISION_M_FALLBACK = 0.0001;     // 4 decimal places ≈ 1m

interface WayGraph {
  edges: Map<WayFid, { aKey: NodeKey; bKey: NodeKey; lengthM: number }>;
  adj: Map<NodeKey, Array<{ wayFid: string; otherKey: NodeKey }>>;
}

function roundToPrecision(num: number, precision: number): number {
  const factor = Math.round(1 / precision);
  return Math.round(num * factor) / factor;
}

function nodeKey(coord: [number, number], precision: number): NodeKey {
  return `${roundToPrecision(coord[0], precision)},${roundToPrecision(coord[1], precision)}`;
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Build a topological way graph based on coordinates and precision settings. */
function buildWayGraph(features: any[], passFids: Set<string>, precision: number): WayGraph {
  const edges = new Map<string, { aKey: string; bKey: string; lengthM: number }>();
  const adj = new Map<string, Array<{ wayFid: string; otherKey: string }>>();

  for (const f of features) {
    const props = f.properties || {};
    const fid = props._fid || `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
    if (!passFids.has(fid)) continue;

    if (f.geometry.type !== "LineString" && f.geometry.type !== "MultiLineString") continue;

    const coordsList: [number, number][][] = f.geometry.type === "LineString"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;

    for (const coords of coordsList) {
      if (!coords || coords.length < 2) continue;
      const first = coords[0];
      const last = coords[coords.length - 1];

      const aKey = nodeKey(first, precision);
      const bKey = nodeKey(last, precision);
      const lengthM = polylineLengthMeters(coords);

      edges.set(fid, { aKey, bKey, lengthM });

      if (!adj.has(aKey)) adj.set(aKey, []);
      adj.get(aKey)!.push({ wayFid: fid, otherKey: bKey });

      if (!adj.has(bKey)) adj.set(bKey, []);
      adj.get(bKey)!.push({ wayFid: fid, otherKey: aKey });
    }
  }

  return { edges, adj };
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Breadth-first search to find the shortest path between start and end ways. */
function findShortestPath(g: WayGraph, startFid: string, endFid: string, excludedWayFids: Set<string>): string[] | null {
  if (startFid === endFid) {
    return excludedWayFids.has(startFid) ? null : [startFid];
  }

  const startEdge = g.edges.get(startFid);
  const endEdge = g.edges.get(endFid);
  if (!startEdge || !endEdge) return null;

  const targets = new Set([endEdge.aKey, endEdge.bKey]);
  const queue: Array<{ nodeKey: string; path: string[] }> = [];
  const visited = new Set<string>();

  queue.push({ nodeKey: startEdge.aKey, path: [startFid] });
  queue.push({ nodeKey: startEdge.bKey, path: [startFid] });
  visited.add(startEdge.aKey);
  visited.add(startEdge.bKey);

  while (queue.length > 0) {
    const curr = queue.shift()!;

    if (targets.has(curr.nodeKey)) {
      return [...curr.path, endFid];
    }

    const neighbors = g.adj.get(curr.nodeKey) || [];
    for (const n of neighbors) {
      if (excludedWayFids.has(n.wayFid)) continue;
      if (curr.path.includes(n.wayFid)) continue;

      if (!visited.has(n.otherKey)) {
        visited.add(n.otherKey);
        queue.push({
          nodeKey: n.otherKey,
          path: [...curr.path, n.wayFid]
        });
      }
    }
  }

  return null;
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Find K shortest alternative paths by deleting path segments one-by-one. */
function bfsKShortest(g: WayGraph, startFid: string, endFid: string, k: number): string[][] {
  const paths: string[][] = [];
  const pathSet = new Set<string>();

  const p0 = findShortestPath(g, startFid, endFid, new Set());
  if (!p0) return [];

  paths.push(p0);
  pathSet.add(p0.join("|"));

  for (let i = 1; i < p0.length - 1; i++) {
    if (paths.length >= k) break;
    const edgeToExclude = p0[i];
    const pAlt = findShortestPath(g, startFid, endFid, new Set([edgeToExclude]));
    if (pAlt) {
      const key = pAlt.join("|");
      if (!pathSet.has(key)) {
        paths.push(pAlt);
        pathSet.add(key);
      }
    }
  }

  return paths.sort((a, b) => a.length - b.length);
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Find combined routes passing through origin, via nodes, and terminus. */
function findStagedPaths(g: WayGraph, origin: string, via: string[], terminus: string, k: number): string[][] {
  const segments = [origin, ...via, terminus];
  const segmentPaths: string[][][] = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const pairPaths = bfsKShortest(g, segments[i], segments[i + 1], k);
    if (pairPaths.length === 0) return [];
    segmentPaths.push(pairPaths);
  }

  const paths: string[][] = [];
  const pathSet = new Set<string>();

  function concatPaths(parts: string[][]): string[] {
    const result: string[] = [];
    for (const part of parts) {
      for (const way of part) {
        if (result.length === 0 || result[result.length - 1] !== way) {
          result.push(way);
        }
      }
    }
    return result;
  }

  const bestParts = segmentPaths.map(p => p[0]);
  const bestPath = concatPaths(bestParts);
  paths.push(bestPath);
  pathSet.add(bestPath.join("|"));

  for (let sIdx = 0; sIdx < segmentPaths.length; sIdx++) {
    const pairPaths = segmentPaths[sIdx];
    for (let pIdx = 1; pIdx < pairPaths.length; pIdx++) {
      if (paths.length >= k) break;
      const currentParts = segmentPaths.map((p, idx) => idx === sIdx ? p[pIdx] : p[0]);
      const altPath = concatPaths(currentParts);
      const key = altPath.join("|");
      if (!pathSet.has(key)) {
        paths.push(altPath);
        pathSet.add(key);
      }
    }
  }

  return paths;
}

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Public entrypoint for path finding between staged nodes with geometric precision fallback. */
export function findPaths(
  features: any[],
  passFids: Set<string>,
  origin: string,
  via: string[],
  terminus: string,
  k: number = 5
): { candidates: string[][]; error?: string } {
  let g = buildWayGraph(features, passFids, PRECISION_M_DEFAULT);
  let candidates = findStagedPaths(g, origin, via, terminus, k);

  if (candidates.length > 0) {
    return { candidates };
  }

  g = buildWayGraph(features, passFids, PRECISION_M_FALLBACK);
  candidates = findStagedPaths(g, origin, via, terminus, k);

  if (candidates.length > 0) {
    return { candidates };
  }

  return {
    candidates: [],
    error: "no path, add a via"
  };
}
