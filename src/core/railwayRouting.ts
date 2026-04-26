import type { RailwayMap, CompanyMeta, Station, LineKey, StationId } from '../store';
import { calcDist } from '../core/tripCalculator'; // Ensure calcDist is exported from here or a common math utility

// 预构建的换乘站索引缓存
let stationNameIndexCache: Map<string, {lineKey: string, stationIndex: number}[]> | null = null;
let lastRailwayDataRef: RailwayMap | null = null;

export const isCompanyCompatible = (meta1: CompanyMeta | undefined, meta2: CompanyMeta | undefined) => {
  if (!meta1 || !meta2) return false;
  if (meta1.company === meta2.company && meta1.company !== "上传数据" && meta1.company !== "未知") return true;
  if (meta1.type === 'JR' && meta2.type === 'JR') return true;
  return false;
};


// 预构建的站点ID索引缓存
let stationIdIndexCache: Map<string, {lineKey: string, stationIndex: number}> | null = null;
let lastRailwayDataRefForId: RailwayMap | null = null;

export const buildStationIdIndex = (railwayData: RailwayMap) => {
    if (stationIdIndexCache && lastRailwayDataRefForId === railwayData) {
        return stationIdIndexCache;
    }

    const index = new Map<string, {lineKey: string, stationIndex: number}>();
    for (const lineKey in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
        const line = railwayData[lineKey];
        if (!line.stations) continue;
        for (let i = 0; i < line.stations.length; i++) {
            index.set(line.stations[i].id, { lineKey, stationIndex: i });
        }
    }

    stationIdIndexCache = index;
    lastRailwayDataRefForId = railwayData;
    return index;
};

export const getStationById = (railwayData: RailwayMap, stationId: string): Station | undefined => {
    if (!stationId) return undefined;
    const index = buildStationIdIndex(railwayData);
    const entry = index.get(stationId);
    if (!entry) return undefined;
    return railwayData[entry.lineKey].stations[entry.stationIndex];
};

export const buildStationIndex = (railwayData: RailwayMap) => {
    if (stationNameIndexCache && lastRailwayDataRef === railwayData) {
        return stationNameIndexCache;
    }

    const index = new Map<string, {lineKey: string, stationIndex: number}[]>();
    for (const lineKey in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
        const line = railwayData[lineKey];
        line.stations.forEach((st, idx) => {
            if (!index.has(st.name_ja)) {
                index.set(st.name_ja, []);
            }
            index.get(st.name_ja)!.push({ lineKey, stationIndex: idx });
        });
    }

    stationNameIndexCache = index;
    lastRailwayDataRef = railwayData;
    return index;
};

export const getTransferableLines = (station: Station | undefined, currentLineKey: string, railwayData: RailwayMap, strictMode = true) => {
    if (!station) return [];
    const currentMeta = railwayData[currentLineKey]?.meta;
    if (!currentMeta) return [];
    const validLines = new Set<string>();

    if (station.transfers && Array.isArray(station.transfers)) {
        station.transfers.forEach(lineKey => {
            if (railwayData[lineKey]) {
                const nextMeta = railwayData[lineKey].meta;
                validLines.add(lineKey);
                
            }
        });
    }

    for (const lineKey in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
        if (lineKey === currentLineKey) continue;
        if (validLines.has(lineKey)) continue;
        const nextMeta = railwayData[lineKey].meta;
        const sameNameStation = railwayData[lineKey].stations.find(s => s.name_ja === station.name_ja);
        if (sameNameStation) {
            const dist = calcDist(station.lat, station.lng, sameNameStation.lat, sameNameStation.lng);
            if (dist < 0.5) validLines.add(lineKey);
        }
    }
    return Array.from(validLines);
};

// --- Types for Advanced Routing ---
interface RouteNode {
    lineKey: string;
    stationIndex: number;
    cost: number;        // Estimated time (minutes) + penalties
    timeMins: number;    // Pure estimated time without penalties
    transfers: number;   // Number of line transfers
    stops: number;       // Number of stations passed
    parent: RouteNode | null;
}

export const findRoute = (startLineKey: string, startStId: string, endLineKey: string, endStId: string, railwayData: RailwayMap, maxTransfersOverride?: number) => {
    if (!startLineKey || !endLineKey) return { error: "无效的起点或终点" };

    const startLine = railwayData[startLineKey];
    const endLine = railwayData[endLineKey];
    if (!startLine || !endLine) return { error: "找不到线路数据" };

    const startIdx = startLine.stations.findIndex(s => s.id === startStId);
    const endIdx = endLine.stations.findIndex(s => s.id === endStId);
    if (startIdx === -1 || endIdx === -1) return { error: "找不到车站信息" };

    const targetStationName = endLine.stations[endIdx].name_ja;

    // Helper: Determine travel speed (km/h) based on line type
    const getSpeed = (lineKey: string) => {
        const line = railwayData[lineKey];
        if (!line) return 80;
        const lineName = lineKey.includes(':') ? lineKey.split(':').slice(1).join(':') : lineKey;
        if (lineName.includes('新幹線')) return 250;
        if (line.meta?.type === '地下鉄') return 40;
        return 80; // Default regular train
    };

    const stationIndexMap = buildStationIndex(railwayData);

    // Use a simple Min-Heap/Priority Queue array structure for Dijkstra / A*
    let openSet: RouteNode[] = [];
    const closedSet = new Set<string>(); // Set of "lineKey:stationIndex"

    const startNode: RouteNode = {
        lineKey: startLineKey,
        stationIndex: startIdx,
        cost: 0,
        timeMins: 0,
        transfers: 0,
        stops: 0,
        parent: null
    };

    openSet.push(startNode);

    const MAX_TRANSFERS = maxTransfersOverride !== undefined ? maxTransfersOverride : 6;
    let bestEndNode: RouteNode | null = null;

    // Helper: Push and sort (simulated priority queue)
    const pushNode = (node: RouteNode) => {
        let l = 0, r = openSet.length;
        while (l < r) {
            const m = (l + r) >> 1;
            if (openSet[m].cost > node.cost) r = m;
            else l = m + 1;
        }
        openSet.splice(l, 0, node);
    };

    while (openSet.length > 0) {
        // Pop the lowest cost node
        const current = openSet.shift()!;
        const currentId = `${current.lineKey}:${current.stationIndex}`;

        if (closedSet.has(currentId)) continue;
        closedSet.add(currentId);

        const currentLine = railwayData[current.lineKey];
        const currentStation = currentLine.stations[current.stationIndex];

        // 终点检查: If we reached the target station name (even on a different line, consider it success if distance < 2km)
        // Strictly speaking, if it's the exact end station:
        if (current.lineKey === endLineKey && current.stationIndex === endIdx) {
            bestEndNode = current;
            break;
        }
        // Loose check: reached a station with the same name as the target station
        if (currentStation.name_ja === targetStationName) {
            bestEndNode = current;
            break;
        }

        if (MAX_TRANSFERS >= 0 && current.transfers >= MAX_TRANSFERS) continue;

        // 1. Move Forward / Backward on the CURRENT line
        const speed = getSpeed(current.lineKey);

        // Next Station
        if (current.stationIndex < currentLine.stations.length - 1) {
            const dist = currentStation.distToNext || calcDist(currentStation.lat, currentStation.lng, currentLine.stations[current.stationIndex+1].lat, currentLine.stations[current.stationIndex+1].lng);
            const timeCost = (dist / speed) * 60; // minutes
            // Penalty: 1 point per station passed to discourage extremely long local routes if faster ones exist
            const node: RouteNode = {
                lineKey: current.lineKey,
                stationIndex: current.stationIndex + 1,
                cost: current.cost + timeCost + 1,
                timeMins: current.timeMins + timeCost,
                transfers: current.transfers,
                stops: current.stops + 1,
                parent: current
            };
            if (!closedSet.has(`${node.lineKey}:${node.stationIndex}`)) pushNode(node);
        }

        // Previous Station
        if (current.stationIndex > 0) {
            const prevStation = currentLine.stations[current.stationIndex - 1];
            const dist = prevStation.distToNext || calcDist(prevStation.lat, prevStation.lng, currentStation.lat, currentStation.lng);
            const timeCost = (dist / speed) * 60;
            const node: RouteNode = {
                lineKey: current.lineKey,
                stationIndex: current.stationIndex - 1,
                cost: current.cost + timeCost + 1,
                timeMins: current.timeMins + timeCost,
                transfers: current.transfers,
                stops: current.stops + 1,
                parent: current
            };
            if (!closedSet.has(`${node.lineKey}:${node.stationIndex}`)) pushNode(node);
        }

        // 2. Transfers
        const validTransfers = new Map<string, RouteNode>();

        // Type A: Explicit transfers defined in the data structure
        if (currentStation.transfers && Array.isArray(currentStation.transfers)) {
            for (const nextLineKey of currentStation.transfers) {
                if (nextLineKey === current.lineKey) continue;
                
                const nextLine = railwayData[nextLineKey];
                if (!nextLine) continue;

                const currentMeta = railwayData[current.lineKey]?.meta;
                const nextMeta = nextLine.meta;

                // Find the physically closest station on the target line to act as the transfer point
                let bestIdx = -1;
                let minDist = Infinity;
                for (let i = 0; i < nextLine.stations.length; i++) {
                    const st = nextLine.stations[i];
                    const d = calcDist(currentStation.lat, currentStation.lng, st.lat, st.lng);
                    if (d < minDist) { minDist = d; bestIdx = i; }
                }

                if (bestIdx !== -1 && minDist <= 2.0) { // Allow up to 2km for explicit mega-station transfers
                    const targetId = `${nextLineKey}:${bestIdx}`;
                    if (!closedSet.has(targetId) && !validTransfers.has(targetId)) {
                        validTransfers.set(targetId, {
                            lineKey: nextLineKey,
                            stationIndex: bestIdx,
                            cost: current.cost + (currentMeta.company===nextMeta.company?3:8),
                            timeMins: current.timeMins + (nextMeta.company===currentMeta.company?3:8),
                            transfers: current.transfers + 1,
                            stops: current.stops,
                            parent: current
                        });
                    }
                }
            }
        }

        // Type B: Same-name stations acting as implicit physical transfers
        const sameNameNodes = stationIndexMap.get(currentStation.name_ja) || [];
        for (const tNode of sameNameNodes) {
            if (tNode.lineKey === current.lineKey) continue;

            const currentMeta = railwayData[current.lineKey]?.meta;
            const nextLine = railwayData[tNode.lineKey];
            const nextMeta = nextLine.meta;

            const targetStation = nextLine.stations[tNode.stationIndex];
            const dist = calcDist(currentStation.lat, currentStation.lng, targetStation.lat, targetStation.lng);

            if (dist > 0.5) continue;

            const targetId = `${tNode.lineKey}:${tNode.stationIndex}`;
            if (!closedSet.has(targetId) && !validTransfers.has(targetId)) {
                validTransfers.set(targetId, {
                    lineKey: tNode.lineKey,
                    stationIndex: tNode.stationIndex,
                    cost: current.cost + (nextMeta.company===currentMeta.company?3:8),
                    timeMins: current.timeMins + (nextMeta.company===currentMeta.company?3:8),
                    transfers: current.transfers + 1,
                    stops: current.stops,
                    parent: current
                });
            }
        }

        // Push all valid transfers found into the queue
        for (const node of validTransfers.values()) {
            pushNode(node);
        }
    }

    if (!bestEndNode) return { error: "未找到连通路径 (超出最大换乘次数或无解)。" };

    // Backtrack to build the path
    const path: RouteNode[] = [];
    let curr: RouteNode | null = bestEndNode;
    while (curr) {
        path.push(curr);
        curr = curr.parent;
    }
    path.reverse();

    // Convert continuous path nodes into 'Segments'
    const segments: any[] = [];
    if (path.length <= 1) return { segments };

    let currentSegmentLine = path[0].lineKey;
    let currentSegmentStartIdx = path[0].stationIndex;
    let lastIdx = path[0].stationIndex;

    const buildSeg = (lineKey: string, startIdx: number, endIdx: number) => {
        const lineObj = railwayData[lineKey];
        const seg: any = {
            id: Date.now() + segments.length,
            lineKey,
            fromId: lineObj.stations[startIdx].id,
            toId:   lineObj.stations[endIdx].id
        };
        // 环线：嵌入方向
        if (lineObj.meta?.isLoop) {
            seg.loopVia = startIdx <= endIdx ? 'up' : 'down';
        }
        return seg;
    };

    for (let i = 1; i < path.length; i++) {
        const node = path[i];
        if (node.lineKey !== currentSegmentLine) {
            // Line changed, flush previous segment if it moved
            if (currentSegmentStartIdx !== lastIdx) {
                segments.push(buildSeg(currentSegmentLine, currentSegmentStartIdx, lastIdx));
            }
            // Start new segment
            currentSegmentLine = node.lineKey;
            currentSegmentStartIdx = node.stationIndex;
            lastIdx = node.stationIndex;
        } else {
            lastIdx = node.stationIndex;
        }
    }

    // Flush the last segment
    if (currentSegmentStartIdx !== lastIdx) {
        segments.push(buildSeg(currentSegmentLine, currentSegmentStartIdx, lastIdx));
    }

    return {
        segments,
        estimatedTime: Math.round(bestEndNode.timeMins)
    };
};

export const computeLoopVia = (railwayData: RailwayMap, lineKey: LineKey, fromId: StationId, toId: StationId): 'up' | 'down' => {
    const line = railwayData[lineKey];
    const stations = line?.stations || [];
    const fi = stations.findIndex(s => s.id === fromId);
    const ti = stations.findIndex(s => s.id === toId);
    if (fi === -1 || ti === -1) return 'up';

    if (line?.meta?.isLoop) {
        const len = stations.length;
        const distUp = (ti - fi + len) % len;
        const distDown = (fi - ti + len) % len;
        return distUp <= distDown ? 'up' : 'down';
    }
    return fi <= ti ? 'up' : 'down';
};

/**
 * 获取起终点之间的地标站 (最多3个)
 * @param line 线路对象
 * @param fromId 起点站ID
 * @param toId 终点站ID
 * @param loopVia 方向 ('up' | 'down' | 'auto')
 */
export const getLandmarks = (line: any, fromId: string, toId: string, loopVia?: 'up' | 'down' | 'auto') => {
    if (!line) return [];
    const stations = line.stations;
    const n = stations.length;
    const fi = stations.findIndex((s: any) => s.id === fromId);
    const ti = stations.findIndex((s: any) => s.id === toId);

    if (fi === -1 || ti === -1 || fi === ti) return [];

    let direction: 'up' | 'down' = 'up';
    if (line.meta?.isLoop) {
        if (loopVia === 'up' || loopVia === 'down') direction = loopVia;
        else {
            const distUp = (ti - fi + n) % n;
            const distDown = (fi - ti + n) % n;
            direction = distUp <= distDown ? 'up' : 'down';
        }
    } else {
        direction = fi <= ti ? 'up' : 'down';
    }

    const results = [];
    let checkedCount = 0;
    let currIdx = fi;

    while (checkedCount < n && results.length < 2) {
        if (direction === 'up') {
            currIdx = (currIdx + 1) % n;
        } else {
            currIdx = (currIdx - 1 + n) % n;
        }

        // 仅当非环线到达终点时才断开，环线为了收集 2 个 landmark 可以继续往后找
        if (!line.meta?.isLoop && currIdx === ti) break;

        // 如果绕回起点（不应该发生，但作为安全兜底），结束
        if (currIdx === fi) break;

        if (stations[currIdx].landmark) {
            if (!results.includes(stations[currIdx].name_ja)) {
                results.push(stations[currIdx].name_ja);
            }
        }

        checkedCount++;
        
        // 非环线如果越界则停止
        if (!line.meta?.isLoop) {
            if (currIdx === 0 || currIdx === n - 1) break;
        }
    }

    return results;
};

// --- Geo Math for Snapping ---
const getProjectedPointOnSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) return { x: ax, y: ay, t: 0 };

    // 投影系数 t
    let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    // 限制在线段两端 [0, 1]
    t = Math.max(0, Math.min(1, t));

    return {
      x: ax + t * dx, // lng
      y: ay + t * dy, // lat
      t: t
    };
};

export const findNearestPointOnLine = (railwayData: RailwayMap, targetLat: number, targetLng: number) => {
    let minDistSq = Infinity;
    let bestPoint = { lat: targetLat, lng: targetLng, lineKey: '', percentage: 0 };

    for (const lineKey in railwayData) {
      if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
      const line = railwayData[lineKey];
      const stations = line.stations;
      if (!stations || stations.length < 2) continue;

      for (let i = 0; i < stations.length - 1; i++) {
        const A = stations[i];
        const B = stations[i+1];

        const proj = getProjectedPointOnSegment(targetLng, targetLat, A.lng, A.lat, B.lng, B.lat);
        const dSq = (targetLat - proj.y) ** 2 + (targetLng - proj.x) ** 2;

        if (dSq < minDistSq) {
          minDistSq = dSq;
          bestPoint = {
              lat: proj.y,
              lng: proj.x,
              lineKey: lineKey,
              percentage: Math.round((i / stations.length) * 100)
          };
        }
      }
    }

    // 阈值检查 (约 10km)
    if (minDistSq > 0.01) {
        return { lat: targetLat, lng: targetLng, lineKey: '', percentage: 0 };
    }

    return bestPoint;
};

export const findNearbyStations = (railwayData: RailwayMap, targetLat: number, targetLng: number, limit = 5) => {
    const topK: { lineKey: string, station: any, distSq: number }[] = [];

    for (const lineKey in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
        const line = railwayData[lineKey];
        if (!line.stations) continue;

        // Optimization: Avoid allocating a massive array and sorting it entirely.
        // Instead, maintain a sorted array of size `limit` while iterating over stations.
        for (let i = 0; i < line.stations.length; i++) {
            const station = line.stations[i];
            const dSq = (targetLat - station.lat) ** 2 + (targetLng - station.lng) ** 2;

            if (topK.length < limit) {
                topK.push({ lineKey, station, distSq: dSq });
                if (topK.length === limit) {
                    topK.sort((a, b) => a.distSq - b.distSq);
                }
            } else if (dSq < topK[limit - 1].distSq) {
                // Insert into sorted array of size limit
                let j = limit - 2;
                while (j >= 0 && topK[j].distSq > dSq) {
                    topK[j + 1] = topK[j];
                    j--;
                }
                topK[j + 1] = { lineKey, station, distSq: dSq };
            }
        }
    }

    // If we found fewer than `limit` stations, they might not be sorted yet
    if (topK.length < limit) {
        topK.sort((a, b) => a.distSq - b.distSq);
    }

    // Extract up to `limit` unique stations by ID/Name, or just the top 5
    return topK;
};
