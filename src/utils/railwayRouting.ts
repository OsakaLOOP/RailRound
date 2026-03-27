import { RailwayMap, CompanyMeta, Station } from '../store';
import { calcDist } from './stats'; // Ensure calcDist is exported from here or a common math utility

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

export const findRoute = (startLineKey: string, startStId: string, endLineKey: string, endStId: string, railwayData: RailwayMap) => {
    if (!startLineKey || !endLineKey) return { error: "无效的起点或终点" };
    const getStName = (line: string, id: string) => railwayData[line]?.stations.find(s => s.id === id)?.name_ja;
    const startName = getStName(startLineKey, startStId);
    const endName = getStName(endLineKey, endStId);
    if (!startName || !endName) return { error: "找不到车站信息" };

    const isShinkansen = (lineKey: string) => {
        const lineName = lineKey.includes(':') ? lineKey.split(':').slice(1).join(':') : lineKey;
        return lineName.includes('新幹線');
    };

    const getPriority = (path: string[], isEnd = false) => {
        let score = path.length;
        const shinkansenCount = path.filter(l => isShinkansen(l)).length;
        score -= shinkansenCount * 10;
        if (isEnd) score -= 100;
        return score;
    };

    const queue: { line: string; path: string[] }[] = [{ line: startLineKey, path: [startLineKey] }];
    const visitedLines = new Set([startLineKey]);
    let foundLinePath: string[] | null = null;
    const MAX_DEPTH = 15;

    while (queue.length > 0) {
        let minIdx = 0;
        for (let i = 1; i < queue.length; i++) {
            const currentPriority = getPriority(queue[i].path);
            const minPriority = getPriority(queue[minIdx].path);
            if (currentPriority < minPriority) minIdx = i;
        }
        const { line, path } = queue.splice(minIdx, 1)[0];

        if (path.length > MAX_DEPTH) continue;
        if (line === endLineKey) { foundLinePath = path; break; }

        const currentStations = railwayData[line].stations;
        const potentialNextLines = new Set<string>();
        currentStations.forEach(st => {
            const transferLines = getTransferableLines(st, line, railwayData, false);
            transferLines.forEach(l => potentialNextLines.add(l));
        });

        potentialNextLines.forEach(nextLine => {
            if (!visitedLines.has(nextLine)) {
                visitedLines.add(nextLine);
                queue.push({ line: nextLine, path: [...path, nextLine] });
            }
        });
    }

    if (!foundLinePath) return { error: "未找到连通路径。" };

    const segments: any[] = [];
    let currentStName = startName;
    for (let i = 0; i < foundLinePath.length; i++) {
        const currentLineKey = foundLinePath[i];
        const nextLineKey = foundLinePath[i+1];
        let nextStName = endName;
        if (nextLineKey) {
            const currSts = railwayData[currentLineKey].stations;
            const nextLineData = railwayData[nextLineKey];
            let transferSt = currSts.find(s => {
                if (s.transfers && s.transfers.includes(nextLineKey)) return true;
                const match = nextLineData.stations.find(ns => ns.name_ja === s.name_ja);
                if (match) return calcDist(s.lat, s.lng, match.lat, match.lng) < 2.0;
                return false;
            });
            if (!transferSt) return { error: "换乘站计算错误" };
            nextStName = transferSt.name_ja;
        }
        const lineObj = railwayData[currentLineKey];
        const fromSt = lineObj.stations.find(s => s.name_ja === currentStName);
        const toSt = lineObj.stations.find(s => s.name_ja === nextStName);
        if (fromSt && toSt && fromSt.id !== toSt.id) {
            segments.push({ id: Date.now() + i, lineKey: currentLineKey, fromId: fromSt.id, toId: toSt.id });
        }
        currentStName = nextStName;
    }
    return { segments };
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
