import * as turf from '@turf/turf';
import { calcPolylineDistTurfFormat } from '../core/tripCalculator';

// 内存数据副本
let railwayData = {};
let geoData = { type: 'FeatureCollection', features: [] };

// 辅助：计算两点间直线距离 (Haversine Formula)
export const calcDist = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// 路径缝合算法 (旧格式 fallback): 将乱序的 MultiLineString 缝合成连续 LineString
export const stitchRoutes = (turf, multiCoords, startPt) => {
  let pool = multiCoords.map((coords, i) => {
    if (!coords || coords.length < 2) return null;
    return {
      id: i,
      coords: coords,
      head: turf.point(coords[0]),
      tail: turf.point(coords[coords.length - 1])
    };
  }).filter(Boolean);

  if (pool.length === 0) return [];
  if (pool.length === 1) return pool[0].coords;

  let seedIdx = -1;
  let minSeedDist = Infinity;

  pool.forEach((seg, i) => {
    const line = turf.lineString(seg.coords);
    const dist = turf.pointToLineDistance(startPt, line);
    if (dist < minSeedDist) { minSeedDist = dist; seedIdx = i; }
  });

  if (seedIdx === -1) seedIdx = 0;

  let pathSegments = [pool[seedIdx]];
  pool.splice(seedIdx, 1);

  while (pool.length > 0) {
    const currentHeadCoords = pathSegments[0].coords;
    const currentTailCoords = pathSegments[pathSegments.length - 1].coords;

    const pathHeadPt = turf.point(currentHeadCoords[0]);
    const pathTailPt = turf.point(currentTailCoords[currentTailCoords.length - 1]);

    let bestMatchIdx = -1;
    let minDist = Infinity;
    let matchType = '';

    for (let i = 0; i < pool.length; i++) {
      const seg = pool[i];
      const d_Tail_Start = turf.distance(pathTailPt, seg.head);
      const d_Tail_End   = turf.distance(pathTailPt, seg.tail);
      const d_Head_End   = turf.distance(pathHeadPt, seg.tail);
      const d_Head_Start = turf.distance(pathHeadPt, seg.head);

      if (d_Tail_Start < minDist) { minDist = d_Tail_Start; bestMatchIdx = i; matchType = 'tail-start'; }
      if (d_Tail_End < minDist)   { minDist = d_Tail_End;   bestMatchIdx = i; matchType = 'tail-end'; }
      if (d_Head_End < minDist)   { minDist = d_Head_End;   bestMatchIdx = i; matchType = 'head-end'; }
      if (d_Head_Start < minDist) { minDist = d_Head_Start; bestMatchIdx = i; matchType = 'head-start'; }
    }

    if (bestMatchIdx !== -1 && minDist < 1.0) {
      const seg = pool[bestMatchIdx];
      if (matchType === 'tail-start') {
        pathSegments.push(seg);
      } else if (matchType === 'tail-end') {
        seg.coords.reverse();
        const temp = seg.head; seg.head = seg.tail; seg.tail = temp;
        pathSegments.push(seg);
      } else if (matchType === 'head-end') {
        pathSegments.unshift(seg);
      } else if (matchType === 'head-start') {
        seg.coords.reverse();
        const temp = seg.head; seg.head = seg.tail; seg.tail = temp;
        pathSegments.unshift(seg);
      }
      pool.splice(bestMatchIdx, 1);
    } else {
      break;
    }
  }

  let flatCoords = [];
  pathSegments.forEach(seg => {
    flatCoords.push(...seg.coords);
  });
  return flatCoords;
};

// [旧格式] 轨迹切分算法 (兼容旧 MultiLineString, stitch + 环线长度比较)
export const sliceGeoJsonPath = (feature, startLat, startLng, endLat, endLng) => {
    if (!turf || !feature || !feature.geometry) return null;

    try {
      let line = feature;
      let startPt = turf.point([startLng, startLat]);
      let endPt = turf.point([endLng, endLat]);

      if (feature.geometry.type === 'MultiLineString') {
          const safeSnap = (pt) => {
              let minDist = Infinity;
              let bestPt = pt;
              feature.geometry.coordinates.forEach(coords => {
                  try {
                      const tempLine = turf.lineString(coords);
                      const snapped = turf.nearestPointOnLine(tempLine, pt);
                      const d = turf.distance(pt, snapped);
                      if (d < minDist) { minDist = d; bestPt = snapped; }
                  } catch(e) {}
              });
              return bestPt;
          };
          startPt = safeSnap(startPt);
          endPt = safeSnap(endPt);
      }

      if (feature.geometry.type === 'MultiLineString') {
         const multiCoords = feature.geometry.coordinates;
         const stitchedCoords = stitchRoutes(turf, multiCoords, startPt);
         if (stitchedCoords && stitchedCoords.length > 0) {
           line = turf.lineString(stitchedCoords);
         } else {
           const flatCoords = feature.geometry.coordinates.flat();
           line = turf.lineString(flatCoords);
         }
      }

      const snappedStart = turf.nearestPointOnLine(line, startPt);
      const snappedEnd = turf.nearestPointOnLine(line, endPt);

        const coords = line.geometry.coordinates;
        const firstPt = coords[0];
        const lastPt = coords[coords.length - 1];
        const isLoop = turf.distance(turf.point(firstPt), turf.point(lastPt)) < 0.5;

        let resultCoords = [];

        if (!isLoop) {
            const sliced = turf.lineSlice(snappedStart, snappedEnd, line);
            resultCoords = sliced.geometry.coordinates;
        } else {
            const sliceDirect = turf.lineSlice(snappedStart, snappedEnd, line);
            const lenDirect = calcPolylineDistTurfFormat(sliceDirect.geometry.coordinates);

            const sliceToTailCoords = safeSliceToTail(line, snappedStart);
            const sliceFromHeadCoords = safeSliceFromHead(line, snappedEnd);
            const lenWrap = calcPolylineDistTurfFormat(sliceToTailCoords) + calcPolylineDistTurfFormat(sliceFromHeadCoords);

            if (lenDirect <= lenWrap) {
                resultCoords = sliceDirect.geometry.coordinates;
            } else {
                const c1 = sliceToTailCoords.map(p => [p[1], p[0]]);
                const c2 = sliceFromHeadCoords.map(p => [p[1], p[0]]);
                return [c1, c2]; // MultiPolyline
            }
        }
        return resultCoords.map(p => [p[1], p[0]]);
    } catch (e) {
        console.warn("Turf slice failed:", e);
        return null;
    }
};

const safeSliceToTail = (lineString, snappedPt) => {
    const coords = lineString.geometry.coordinates;
    const idx = snappedPt.properties.index;
    const result = [snappedPt.geometry.coordinates];
    for (let i = idx + 1; i < coords.length; i++) {
        result.push(coords[i]);
    }
    return result;
};

const safeSliceFromHead = (lineString, snappedPt) => {
    const coords = lineString.geometry.coordinates;
    const idx = snappedPt.properties.index;
    const result = [];
    for (let i = 0; i <= idx; i++) {
        result.push(coords[i]);
    }
    const ptCoords = snappedPt.geometry.coordinates;
    const lastPushed = result[result.length - 1];
    if (Math.abs(lastPushed[0] - ptCoords[0]) > 1e-6 || Math.abs(lastPushed[1] - ptCoords[1]) > 1e-6) {
        result.push(ptCoords);
    }
    return result;
};

// [新格式] 直接按顺序拼接方向化 feature 的 MultiLineString coords (无需 stitch)
const flatConcatCoords = (multiLineStringCoords) => {
    const result = [];
    for (const lineCoords of multiLineStringCoords) {
        result.push(...lineCoords);
    }
    return result;
};

// [新格式] 强制定向切分路径（环线：按站序逐对切割拼合；非环线：直接 lineSlice）
// toId: 终点站 ID（环线必传，用于枚举站序)
const sliceDirectionalPath = (feature, startLat, startLng, endLat, endLng, isLoop, direction, lineObj, fromId, toId) => {
    if (!turf || !feature || !feature.geometry) return null;
    try {
        let coords;
        if (feature.geometry.type === 'MultiLineString') {
            coords = flatConcatCoords(feature.geometry.coordinates);
        } else {
            coords = feature.geometry.coordinates;
        }
        if (!coords || coords.length < 2) return null;

        const lineString = turf.lineString(coords);
        const startPt = turf.point([startLng, startLat]);
        const endPt   = turf.point([endLng, endLat]);

        const snappedStart = turf.nearestPointOnLine(lineString, startPt);
        const snappedEnd   = turf.nearestPointOnLine(lineString, endPt);

        if (!isLoop) {
            // 非环线：turf.lineSlice 按 GeoJSON 方向切，必要时反转
            const locStart = snappedStart.properties.location;
            const locEnd   = snappedEnd.properties.location;
            const sliced = turf.lineSlice(snappedStart, snappedEnd, lineString);
            let slicedCoords = sliced.geometry.coordinates;
            if (locStart > locEnd) slicedCoords.reverse();
            return slicedCoords.map(p => [p[1], p[0]]);
        }

        // --- 环线：按 railwayData.stations[] 站序逐对切割拼合 ---
        const stations = lineObj.stations;
        const n = stations.length;
        const fromIdx = stations.findIndex(s => s.id === fromId);
        const toIdx   = stations.findIndex(s => s.id === toId);
        if (fromIdx === -1 || toIdx === -1) return null;

        // 1. 按方向枚举有序站点索引（含起点、终点）
        const orderedIndices = [fromIdx];
        let cur = fromIdx;
        const step = direction === 'up' ? 1 : -1;
        for (let safety = 0; safety < n; safety++) {
            cur = (cur + step + n) % n;
            orderedIndices.push(cur);
            if (cur === toIdx) break;
        }

        // 2. 逐对站切割，拼合坐标（[lng, lat] GeoJSON 坐标系）
        let resultCoords = [];
        for (let i = 0; i < orderedIndices.length - 1; i++) {
            const stA = stations[orderedIndices[i]];
            const stB = stations[orderedIndices[i + 1]];

            const ptA = turf.point([stA.lng, stA.lat]);
            const ptB = turf.point([stB.lng, stB.lat]);
            const snA = turf.nearestPointOnLine(lineString, ptA);
            const snB = turf.nearestPointOnLine(lineString, ptB);
            const locA = snA.properties.location;
            const locB = snB.properties.location;

            let segCoords;
            if (locA <= locB) {
                // 同向：直接 lineSlice
                const sliced = turf.lineSlice(snA, snB, lineString);
                segCoords = sliced.geometry.coordinates;
            } else {
                // 跨 GeoJSON 缝：safeSliceToTail(A) + safeSliceFromHead(B)
                const part1 = safeSliceToTail(lineString, snA);
                const part2 = safeSliceFromHead(lineString, snB);
                // 去重首尾重叠点
                if (part1.length > 0 && part2.length > 0) {
                    const p1T = part1[part1.length - 1];
                    const p2H = part2[0];
                    if (Math.abs(p1T[0] - p2H[0]) < 1e-6 && Math.abs(p1T[1] - p2H[1]) < 1e-6) part2.shift();
                }
                segCoords = [...part1, ...part2];
            }

            // 拼合时去掉与上一段末点重叠的首点
            if (resultCoords.length > 0 && segCoords.length > 0) {
                const prev = resultCoords[resultCoords.length - 1];
                const next = segCoords[0];
                if (Math.abs(prev[0] - next[0]) < 1e-6 && Math.abs(prev[1] - next[1]) < 1e-6) {
                    segCoords = segCoords.slice(1);
                }
            }
            resultCoords.push(...segCoords);
        }

        return resultCoords.map(p => [p[1], p[0]]);
    } catch (e) {
        console.warn("Directional slice failed:", e);
        return null;
    }
};

// 根据 fromId/toId 站点索引确定行进方向 (完全剥夺工人规划权，必须遵从主裁决)
const getDirectionForSegment = (line, fromId, toId, loopVia) => {
    if (line.meta?.isLoop) {
        // 对于环形，主线程必须已经传递确定的 up 或 down (auto应在存库时决断)
        // 如果漏传，作为兜底硬算，但最好不要发生
        if (loopVia === 'up' || loopVia === 'down') return loopVia;
        const stations = line.stations;
        const n = stations.length;
        const fromIdx = stations.findIndex(s => s.id === fromId);
        const toIdx   = stations.findIndex(s => s.id === toId);
        if (fromIdx === -1 || toIdx === -1) return 'up';
        const distUp = (toIdx - fromIdx + n) % n;
        const distDown = (fromIdx - toIdx + n) % n;
        return distUp <= distDown ? 'up' : 'down';
    }
    // 对于非环线
    if (loopVia === 'up' || loopVia === 'down') return loopVia;
    const fromIdx = line.stations.findIndex(s => s.id === fromId);
    const toIdx   = line.stations.findIndex(s => s.id === toId);
    if (fromIdx === -1 || toIdx === -1) return 'up';
    return fromIdx <= toIdx ? 'up' : 'down';
};

// 查找方向化 feature (有 direction 属性)；或者查找无方向的旧 feature
const findFeature = (lineName, company, direction) => {
    if (direction) {
        // 优先精确匹配 direction
        const f = geoData.features.find(f =>
            f.properties.type === 'line' &&
            f.properties.name === lineName &&
            f.properties.company === company &&
            f.properties.direction === direction
        );
        if (f) return { feature: f, directionalized: true };
    }
    // fallback: 无 direction 的旧 feature
    const f = geoData.features.find(f =>
        f.properties.type === 'line' &&
        f.properties.name === lineName &&
        f.properties.company === company &&
        !f.properties.direction
    );
    return f ? { feature: f, directionalized: false } : null;
};

// 计算当前站出发按方向的前三个 landmark 站（模拟“XX方面”导向）
const getLandmarkVia = (line, fromId, toId, direction) => {
    const stations = line.stations;
    const n = stations.length;
    const fromIdx = stations.findIndex(s => s.id === fromId);
    const toIdx = stations.findIndex(s => s.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return [];

    const isLoop = !!(line.meta && line.meta.isLoop);
    const results = [];
    
    // 搜索计数器，防止死循环
    let checkedCount = 0;
    let currIdx = fromIdx;

    while (checkedCount < n && results.length < 2) {
        // 按方向移动索引
        if (direction === 'up') {
            currIdx = (currIdx + 1) % n;
        } else {
            currIdx = (currIdx - 1 + n) % n;
        }

        // 仅当非环线到达终点时才断开，环线为了收集 2 个 landmark 可以继续往后找
        if (!isLoop && currIdx === toIdx) break;

        // 如果绕回起点
        if (currIdx === fromIdx) break;

        if (stations[currIdx].landmark) {
            if (!results.includes(stations[currIdx].name_ja)) {
                results.push(stations[currIdx].name_ja);
            }
        }

        checkedCount++;

        // 非环线越界停止
        if (!isLoop) {
            if (currIdx === 0 || currIdx === n - 1) break;
        }
    }

    return results;
};

// 监听主线程消息
self.addEventListener('message', async (e) => {
    const { id, type, payload } = e.data;

    try {
        switch (type) {
            case 'SYNC_DATA':
                if (payload.railwayData) railwayData = payload.railwayData;
                if (payload.geoData) geoData = payload.geoData;
                self.postMessage({ id, type: 'SYNC_DATA_SUCCESS' });
                break;

            case 'GET_ALL_GEOMETRIES': {
                const neededSegments = payload.segments || [];
                const results = [];

                for (const seg of neededSegments) {
                    const isLoopSeg = seg.loopVia !== undefined;
                    const key = isLoopSeg
                        ? `${seg.lineKey}_${seg.fromId}_${seg.toId}_${seg.loopVia}`
                        : `${seg.lineKey}_${seg.fromId}_${seg.toId}`;

                    const line = railwayData[seg.lineKey];
                    if (!line) { results.push({ key, data: null }); continue; }

                    const s1 = line.stations.find(s => s.id === seg.fromId);
                    const s2 = line.stations.find(s => s.id === seg.toId);
                    if (!s1 || !s2) { results.push({ key, data: null }); continue; }

                    const parts = seg.lineKey.split(':');
                    const company = parts[0];
                    const lineName = parts.slice(1).join(':');

                    // 确定方向
                    const isLoop = !!(line.meta && line.meta.isLoop);
                    const direction = (isLoop || seg.loopVia)
                        ? getDirectionForSegment(line, seg.fromId, seg.toId, seg.loopVia)
                        : getDirectionForSegment(line, seg.fromId, seg.toId, undefined);

                    // 查找 feature
                    const found = findFeature(lineName, company, direction);

                    let coords = null;
                    let color = '#38bdf8';
                    let isMulti = false;
                    let fallback = false;
                    let landmarks = [];

                    if (found) {
                        color = found.feature.properties.stroke || '#38bdf8';

                        if (found.directionalized) {
                            // 新格式：按站序逐对切割拼合
                            coords = sliceDirectionalPath(found.feature, s1.lat, s1.lng, s2.lat, s2.lng, isLoop, direction, line, seg.fromId, seg.toId);
                        } else {
                            // 旧格式：stitch + 切分
                            coords = sliceGeoJsonPath(found.feature, s1.lat, s1.lng, s2.lat, s2.lng);
                        }

                        if (coords) {
                            isMulti = Array.isArray(coords[0]) && Array.isArray(coords[0][0]);
                            // 计算 landmark 经由站
                            landmarks = getLandmarkVia(line, seg.fromId, seg.toId, direction);
                        }
                    }

                    // Fallback: 按站点坐标直连
                    if (!coords) {
                        fallback = true;
                        const routeCoords = [];
                        const startIdx = line.stations.findIndex(st => st.id === seg.fromId);
                        const endIdx   = line.stations.findIndex(st => st.id === seg.toId);
                        if (startIdx !== -1 && endIdx !== -1) {
                            const step = startIdx <= endIdx ? 1 : -1;
                            for (let i = startIdx; i !== endIdx + step; i += step) {
                                if (i >= 0 && i < line.stations.length)
                                    routeCoords.push([line.stations[i].lat, line.stations[i].lng]);
                            }
                            if (routeCoords.length > 1) { coords = routeCoords; fallback = false; }
                        }
                    }

                    if (!coords) {
                        coords = [[s1.lat, s1.lng], [s2.lat, s2.lng]];
                        fallback = true;
                    }

                    results.push({
                        key,
                        data: { coords, color, isMulti, fallback, landmarks }
                    });
                }

                self.postMessage({ id, type: 'GET_ALL_GEOMETRIES_SUCCESS', payload: results });
                break;
            }

            default:
                self.postMessage({ id, type: 'ERROR', payload: 'Unknown message type' });
        }
    } catch (err) {
        self.postMessage({ id, type: 'ERROR', payload: err.message });
    }
});
