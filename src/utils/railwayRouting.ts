import { RailwayMap, CompanyMeta, Station } from '../store';
import { calcDist } from './stats'; // Ensure calcDist is exported from here or a common math utility

// 预构建的换乘站索引缓存
let stationNameIndexCache: Map<string, {lineKey: string, stationIndex: number}[]> | null = null;
let lastRailwayDataRef: RailwayMap | null = null;

export const buildStationIndex = (railwayData: RailwayMap) => {
    if (stationNameIndexCache && lastRailwayDataRef === railwayData) {
        return stationNameIndexCache;
    }

    const index = new Map<string, {lineKey: string, stationIndex: number}[]>();
    for (const [lineKey, line] of Object.entries(railwayData)) {
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

export const isCompanyCompatible = (meta1: CompanyMeta | undefined, meta2: CompanyMeta | undefined) => {
  if (!meta1 || !meta2) return false;
  if (meta1.company === meta2.company && meta1.company !== "上传数据" && meta1.company !== "未知") return true;
  if (meta1.type === 'JR' && meta2.type === 'JR') return true;
  return false;
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
                if (!strictMode || isCompanyCompatible(currentMeta as CompanyMeta, nextMeta as CompanyMeta)) {
                    validLines.add(lineKey);
                }
            }
        });
    }

    Object.keys(railwayData).forEach(lineKey => {
        if (lineKey === currentLineKey) return;
        if (validLines.has(lineKey)) return;
        const nextMeta = railwayData[lineKey].meta;
        if (strictMode && !isCompanyCompatible(currentMeta as CompanyMeta, nextMeta as CompanyMeta)) return;
        const sameNameStation = railwayData[lineKey].stations.find(s => s.name_ja === station.name_ja);
        if (sameNameStation) {
            const dist = calcDist(station.lat, station.lng, sameNameStation.lat, sameNameStation.lng);
            if (dist < 2.0) validLines.add(lineKey);
        }
    });
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

export const findRoute = (startLineKey: string, startStId: string, endLineKey: string, endStId: string, railwayData: RailwayMap) => {
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

    const MAX_TRANSFERS = 6;
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

        if (current.transfers >= MAX_TRANSFERS) continue;

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
        // A transfer happens when changing lines at the same station (or nearby same-name stations),
        // OR when the data explicitly defines a transfer connection.
        // Time penalty: 5 mins physical time + 15 penalty points to strongly discourage unnecessary transfers

        const validTransfers = new Map<string, RouteNode>();

        // Type A: Explicit transfers defined in the data structure
        if (currentStation.transfers && Array.isArray(currentStation.transfers)) {
            for (const nextLineKey of currentStation.transfers) {
                if (nextLineKey === current.lineKey) continue;
                const nextLine = railwayData[nextLineKey];
                if (!nextLine) continue;

                // For explicit transfers, we trust the data completely.
                // We remove strict company compatibility checks to allow real-world transfers
                // (e.g., from JR to Subway) seamlessly.

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
                            cost: current.cost + 5 + 15,
                            timeMins: current.timeMins + 5,
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

            const nextLine = railwayData[tNode.lineKey];

            // We remove strict company compatibility checks here as well to allow seamless auto-routing
            // between different operators sharing the same station name/building.

            // Validate that the transfer station is actually nearby (<= 1.0 km)
            // to prevent incorrect transfers between identically named stations in completely different cities.
            const targetStation = nextLine.stations[tNode.stationIndex];
            const dist = calcDist(currentStation.lat, currentStation.lng, targetStation.lat, targetStation.lng);

            if (dist > 1.0) continue;

            const targetId = `${tNode.lineKey}:${tNode.stationIndex}`;
            if (!closedSet.has(targetId) && !validTransfers.has(targetId)) {
                validTransfers.set(targetId, {
                    lineKey: tNode.lineKey,
                    stationIndex: tNode.stationIndex,
                    cost: current.cost + 5 + 15,
                    timeMins: current.timeMins + 5,
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

    for (let i = 1; i < path.length; i++) {
        const node = path[i];
        if (node.lineKey !== currentSegmentLine) {
            // Line changed, flush previous segment if it moved
            if (currentSegmentStartIdx !== lastIdx) {
                const lineObj = railwayData[currentSegmentLine];
                segments.push({
                    id: Date.now() + segments.length,
                    lineKey: currentSegmentLine,
                    fromId: lineObj.stations[currentSegmentStartIdx].id,
                    toId: lineObj.stations[lastIdx].id
                });
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
        const lineObj = railwayData[currentSegmentLine];
        segments.push({
            id: Date.now() + segments.length,
            lineKey: currentSegmentLine,
            fromId: lineObj.stations[currentSegmentStartIdx].id,
            toId: lineObj.stations[lastIdx].id
        });
    }

    return {
        segments,
        estimatedTime: Math.round(bestEndNode.timeMins)
    };
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

    Object.entries(railwayData).forEach(([lineKey, line]) => {
      const stations = line.stations;
      if (!stations || stations.length < 2) return;

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
    });

    // 阈值检查 (约 10km)
    if (minDistSq > 0.01) {
        return { lat: targetLat, lng: targetLng, lineKey: '', percentage: 0 };
    }

    return bestPoint;
};
