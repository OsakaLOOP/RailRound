import type { RailwayMap, CompanyMeta, Station, LineKey, StationId } from './types';
import { calcDist } from './tripCalculator'; 

// 预构建的换乘站索引缓存
let stationNameIndexCache: Map<string, {lineKey: string, stationIndex: number}[]> | null = null;
let lastRailwayDataRef: RailwayMap | null = null;

export const isCompanyCompatible = (meta1: CompanyMeta | undefined, meta2: CompanyMeta | undefined) => {
  if (!meta1 || !meta2) return false;
  if (meta1.company === meta2.company && meta1.company !== "上传数据" && meta1.company !== "未知") return true;
  if (meta1.type === 'JR' && meta2.type === 'JR') return true;
  return false;
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

export const getTransferableLines = (station: Station | undefined, currentLineKey: string, railwayData: RailwayMap) => {
    if (!station) return [];
    const currentMeta = railwayData[currentLineKey]?.meta;
    if (!currentMeta) return [];
    const validLines = new Set<string>();

    if (station.transfers && Array.isArray(station.transfers)) {
        station.transfers.forEach(lineKey => {
            if (railwayData[lineKey]) {
                validLines.add(lineKey);
            }
        });
    }

    for (const lineKey in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
        if (lineKey === currentLineKey) continue;
        if (validLines.has(lineKey)) continue;
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
    cost: number;        
    timeMins: number;    
    transfers: number;   
    stops: number;       
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

    const getSpeed = (lineKey: string) => {
        const line = railwayData[lineKey];
        if (!line) return 80;
        const lineName = lineKey.includes(':') ? lineKey.split(':').slice(1).join(':') : lineKey;
        if (lineName.includes('新幹線')) return 250;
        if (line.meta?.type === '地下铁') return 40;
        return 80; 
    };

    const stationIndexMap = buildStationIndex(railwayData);

    let openSet: RouteNode[] = [];
    const closedSet = new Set<string>();

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
        const current = openSet.shift()!;
        const currentId = `${current.lineKey}:${current.stationIndex}`;

        if (closedSet.has(currentId)) continue;
        closedSet.add(currentId);

        const currentLine = railwayData[current.lineKey];
        const currentStation = currentLine.stations[current.stationIndex];

        if (current.lineKey === endLineKey && current.stationIndex === endIdx) {
            bestEndNode = current;
            break;
        }
        if (currentStation.name_ja === targetStationName) {
            bestEndNode = current;
            break;
        }

        const speed = getSpeed(current.lineKey);

        if (current.stationIndex < currentLine.stations.length - 1) {
            const dist = currentStation.distToNext || calcDist(currentStation.lat, currentStation.lng, currentLine.stations[current.stationIndex+1].lat, currentLine.stations[current.stationIndex+1].lng);
            const timeCost = (dist / speed) * 60;
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

        if (MAX_TRANSFERS >= 0 && current.transfers >= MAX_TRANSFERS) continue;

        const validTransfers = new Map<string, RouteNode>();

        if (currentStation.transfers && Array.isArray(currentStation.transfers)) {
            for (const nextLineKey of currentStation.transfers) {
                if (nextLineKey === current.lineKey) continue;
                
                const nextLine = railwayData[nextLineKey];
                if (!nextLine) continue;

                const currentMeta = railwayData[current.lineKey]?.meta;
                const nextMeta = nextLine.meta;

                let bestIdx = -1;
                let minDist = Infinity;
                for (let i = 0; i < nextLine.stations.length; i++) {
                    const st = nextLine.stations[i];
                    const d = calcDist(currentStation.lat, currentStation.lng, st.lat, st.lng);
                    if (d < minDist) { minDist = d; bestIdx = i; }
                }

                if (bestIdx !== -1 && minDist <= 2.0) { 
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

        for (const node of validTransfers.values()) {
            pushNode(node);
        }
    }

    if (!bestEndNode) return { error: "未找到连通路径 (超出最大换乘次数或无解)。" };

    const path: RouteNode[] = [];
    let curr: RouteNode | null = bestEndNode;
    while (curr) {
        path.push(curr);
        curr = curr.parent;
    }
    path.reverse();

    const segments: any[] = [];
    if (path.length <= 1) return { segments };

    let currentSegmentLine = path[0].lineKey;
    let currentSegmentStartIdx = path[0].stationIndex;
    let lastIdx = path[0].stationIndex;

    const buildSeg = (lineKey: string, startIdx: number, endIdx: number) => {
        const lineObj = railwayData[lineKey];
        return {
            id: Date.now() + segments.length,
            lineKey,
            fromId: lineObj.stations[startIdx].id,
            toId:   lineObj.stations[endIdx].id,
            loopVia: lineObj.meta?.isLoop ? (startIdx <= endIdx ? 'up' : 'down') : undefined
        };
    };

    for (let i = 1; i < path.length; i++) {
        const node = path[i];
        if (node.lineKey !== currentSegmentLine) {
            if (currentSegmentStartIdx !== lastIdx) {
                segments.push(buildSeg(currentSegmentLine, currentSegmentStartIdx, lastIdx));
            }
            currentSegmentLine = node.lineKey;
            currentSegmentStartIdx = node.stationIndex;
            lastIdx = node.stationIndex;
        } else {
            lastIdx = node.stationIndex;
        }
    }

    if (currentSegmentStartIdx !== lastIdx) {
        segments.push(buildSeg(currentSegmentLine, currentSegmentStartIdx, lastIdx));
    }

    return {
        segments,
        estimatedTime: Math.round(bestEndNode.timeMins)
    };
};
