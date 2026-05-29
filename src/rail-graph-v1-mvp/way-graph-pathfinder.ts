import { polylineLengthMeters } from "./spatial-helpers";

type NodeKey = string;
type WayFid = string;

const PRECISION_M_DEFAULT = 0.0000001;
const PRECISION_M_FALLBACK = 0.0000045; // ~0.5m in degrees / 约0.5米(度)
const ANGLE_THRESHOLD_DEG = 90;

interface WayEdge {
  aKey: NodeKey;
  bKey: NodeKey;
  lengthM: number;
  coords: [number, number][];
}

interface WayGraph {
  edges: Map<WayFid, WayEdge>;
  adj: Map<NodeKey, Array<{ wayFid: string; otherKey: NodeKey }>>;
  nodeCoords: Map<NodeKey, [number, number]>;
}

function roundToPrecision(num: number, precision: number): number {
  const factor = Math.round(1 / precision);
  return Math.round(num * factor) / factor;
}

function nodeKey(coord: [number, number], precision: number): NodeKey {
  return `${roundToPrecision(coord[0], precision)},${roundToPrecision(coord[1], precision)}`;
}

function turnAngleDeg(
  inCoords: [number, number][],
  outCoords: [number, number][],
  sharedNode: [number, number],
): number {
  if (inCoords.length < 2 || outCoords.length < 2) return 180;

  const refLat = sharedNode[1] * Math.PI / 180;
  const kx = 111320 * Math.cos(refLat);
  const ky = 111320;

  const inEnd = sharedNode;
  let inStart = inCoords[0];
  const inStartDist = Math.abs(inCoords[0][0] - sharedNode[0]) + Math.abs(inCoords[0][1] - sharedNode[1]);
  const inEndDist = Math.abs(inCoords[inCoords.length - 1][0] - sharedNode[0]) + Math.abs(inCoords[inCoords.length - 1][1] - sharedNode[1]);
  if (inStartDist < inEndDist) {
    // shared is at start of inCoords, so approach direction is from end
    for (let i = inCoords.length - 1; i >= 0; i--) {
      if (Math.abs(inCoords[i][0] - sharedNode[0]) > 1e-7 || Math.abs(inCoords[i][1] - sharedNode[1]) > 1e-7) {
        inStart = inCoords[i]; break;
      }
    }
  } else {
    for (let i = 0; i < inCoords.length; i++) {
      if (Math.abs(inCoords[i][0] - sharedNode[0]) > 1e-7 || Math.abs(inCoords[i][1] - sharedNode[1]) > 1e-7) {
        inStart = inCoords[i]; break;
      }
    }
  }

  const outStart = sharedNode;
  let outEnd = outCoords[outCoords.length - 1];
  const outStartDist = Math.abs(outCoords[0][0] - sharedNode[0]) + Math.abs(outCoords[0][1] - sharedNode[1]);
  if (outStartDist < 1e-7) {
    for (let i = 1; i < outCoords.length; i++) {
      if (Math.abs(outCoords[i][0] - sharedNode[0]) > 1e-7 || Math.abs(outCoords[i][1] - sharedNode[1]) > 1e-7) {
        outEnd = outCoords[i]; break;
      }
    }
  } else {
    for (let i = outCoords.length - 2; i >= 0; i--) {
      if (Math.abs(outCoords[i][0] - sharedNode[0]) > 1e-7 || Math.abs(outCoords[i][1] - sharedNode[1]) > 1e-7) {
        outEnd = outCoords[i]; break;
      }
    }
  }

  const dxA = (inEnd[0] - inStart[0]) * kx;
  const dyA = (inEnd[1] - inStart[1]) * ky;
  const dxB = (outEnd[0] - outStart[0]) * kx;
  const dyB = (outEnd[1] - outStart[1]) * ky;

  const lenA = Math.sqrt(dxA * dxA + dyA * dyA);
  const lenB = Math.sqrt(dxB * dxB + dyB * dyB);
  if (lenA === 0 || lenB === 0) return 180;

  const dot = dxA * dxB + dyA * dyB;
  const cosTheta = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
  return Math.acos(cosTheta) * 180 / Math.PI;
}

function buildWayGraph(features: any[], passFids: Set<string>, precision: number): WayGraph {
  const edges = new Map<string, WayEdge>();
  const adj = new Map<string, Array<{ wayFid: string; otherKey: string }>>();
  const nodeCoords = new Map<string, [number, number]>();

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

      edges.set(fid, { aKey, bKey, lengthM, coords });
      nodeCoords.set(aKey, first);
      nodeCoords.set(bKey, last);

      if (!adj.has(aKey)) adj.set(aKey, []);
      adj.get(aKey)!.push({ wayFid: fid, otherKey: bKey });

      if (!adj.has(bKey)) adj.set(bKey, []);
      adj.get(bKey)!.push({ wayFid: fid, otherKey: aKey });
    }
  }

  return { edges, adj, nodeCoords };
}

function findShortestPath(g: WayGraph, startFid: string, endFid: string, excludedWayFids: Set<string>): string[] | null {
  if (startFid === endFid) {
    return excludedWayFids.has(startFid) ? null : [startFid];
  }

  const startEdge = g.edges.get(startFid);
  const endEdge = g.edges.get(endFid);
  if (!startEdge || !endEdge) return null;

  const targets = new Set([endEdge.aKey, endEdge.bKey]);
  const queue: Array<{ nodeKey: string; path: string[]; prevWayFid: string }> = [];
  const visited = new Map<string, Set<string>>();

  for (const nk of [startEdge.aKey, startEdge.bKey]) {
    queue.push({ nodeKey: nk, path: [startFid], prevWayFid: startFid });
    if (!visited.has(nk)) visited.set(nk, new Set());
    visited.get(nk)!.add(startFid);
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;

    if (targets.has(curr.nodeKey) && curr.path.length > 1) {
      return [...curr.path, endFid];
    }

    const sharedCoord = g.nodeCoords.get(curr.nodeKey);
    const prevEdge = g.edges.get(curr.prevWayFid);

    const neighbors = g.adj.get(curr.nodeKey) || [];
    for (const n of neighbors) {
      if (excludedWayFids.has(n.wayFid)) continue;
      if (curr.path.includes(n.wayFid)) continue;

      if (prevEdge && sharedCoord) {
        const nextEdge = g.edges.get(n.wayFid);
        if (nextEdge) {
          const angle = turnAngleDeg(prevEdge.coords, nextEdge.coords, sharedCoord);
          if (angle >= ANGLE_THRESHOLD_DEG) continue;
        }
      }

      const visitedAtNode = visited.get(n.otherKey);
      if (visitedAtNode && visitedAtNode.has(n.wayFid)) continue;
      if (!visited.has(n.otherKey)) visited.set(n.otherKey, new Set());
      visited.get(n.otherKey)!.add(n.wayFid);

      queue.push({
        nodeKey: n.otherKey,
        path: [...curr.path, n.wayFid],
        prevWayFid: n.wayFid,
      });
    }
  }

  return null;
}

function bfsKShortest(g: WayGraph, startFid: string, endFid: string, k: number): string[][] {
  const paths: string[][] = [];
  const pathSet = new Set<string>();

  const p0 = findShortestPath(g, startFid, endFid, new Set());
  if (!p0) return [];

  paths.push(p0);
  pathSet.add(p0.join("|"));

  for (let i = 1; i < p0.length - 1; i++) {
    if (paths.length >= k) break;
    const pAlt = findShortestPath(g, startFid, endFid, new Set([p0[i]]));
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

