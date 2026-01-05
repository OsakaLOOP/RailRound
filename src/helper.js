export const calcDist = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const isCompanyCompatible = (meta1, meta2) => {
  if (!meta1 || !meta2) return false;
  if (meta1.company === meta2.company && meta1.company !== "上传数据" && meta1.company !== "未知") return true;
  if (meta1.type === 'JR' && meta2.type === 'JR') return true;
  return false;
};

export const projectedPoint = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax; const dy = by - ay;
  if (dx === 0 && dy === 0) return { x: ax, y: ay, t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, y: ay + t * dy, t: t };
};

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

    if (bestMatchIdx !== -1) {
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

export const sliceGeoJsonPath = (feature, startLat, startLng, endLat, endLng, turf) => {
    if (!turf || !feature || !feature.geometry) return null;

    try {
      let line = feature;
      const startPt = turf.point([startLng, startLat]);
      const endPt = turf.point([endLng, endLat]);

      // If MultiLineString, attempt to stitch segments into a sensible continuous path
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

      // 1. 吸附 (Snap)
      const snappedStart = turf.nearestPointOnLine(line, startPt);
      const snappedEnd = turf.nearestPointOnLine(line, endPt);

        const startIdx = snappedStart.properties.index;
        const endIdx = snappedEnd.properties.index;
        
        // 2. 环线检测
        const coords = line.geometry.coordinates;
        const firstPt = coords[0];
        const lastPt = coords[coords.length - 1];
        const isLoop = turf.distance(turf.point(firstPt), turf.point(lastPt)) < 0.5;

        // 3. 切分
        let resultCoords = [];

        if (!isLoop) {
            const sliced = turf.lineSlice(snappedStart, snappedEnd, line);
            resultCoords = sliced.geometry.coordinates;
        } else {
            const sliceDirect = turf.lineSlice(snappedStart, snappedEnd, line);
            const lenDirect = turf.length(sliceDirect);
            
            const sliceToTail = turf.lineSlice(snappedStart, turf.point(lastPt), line);
            const sliceFromHead = turf.lineSlice(turf.point(firstPt), snappedEnd, line);
            const lenWrap = turf.length(sliceToTail) + turf.length(sliceFromHead);

            if (lenDirect <= lenWrap) {
                resultCoords = sliceDirect.geometry.coordinates;
            } else {
                const c1 = sliceToTail.geometry.coordinates.map(p => [p[1], p[0]]);
                const c2 = sliceFromHead.geometry.coordinates.map(p => [p[1], p[0]]);
                return [c1, c2]; // MultiPolyline
            }
        }
        return resultCoords.map(p => [p[1], p[0]]); // Leaflet [lat, lng]
    } catch (e) {
        console.warn("Turf slice failed:", e);
        return null;
    }
};

export const NearestPoint = (railwayData, targetLat, targetLng) => {
  let minDistSq = Infinity;
  let bestPoint = { lat: targetLat, lng: targetLng, lineKey: '', percentage: 0 };
  Object.entries(railwayData).forEach(([lineKey, line]) => {
    for (let i = 0; i < line.stations.length - 1; i++) {
      const A = line.stations[i]; const B = line.stations[i+1];
      const proj = getProjectedPointOnSegment(targetLng, targetLat, A.lng, A.lat, B.lng, B.lat);
      const dSq = (targetLat - proj.y) ** 2 + (targetLng - proj.x) ** 2;
      if (dSq < minDistSq) {
        minDistSq = dSq;
        bestPoint = { lat: proj.y, lng: proj.x, lineKey, percentage: 0 };
      }
    }
  });
  return minDistSq > 0.01 ? { lat: targetLat, lng: targetLng, lineKey: '' } : bestPoint;
};

export class MinHeap {
    constructor() { this.heap = []; }
    push(node) {
        this.heap.push(node);
        this.bubbleUp(this.heap.length - 1);
    }
    pop() {
        if (this.heap.length === 0) return null;
        const top = this.heap[0];
        const bottom = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this.sinkDown(0);
        }
        return top;
    }
    size() { return this.heap.length; }
    
    bubbleUp(idx) {
        while (idx > 0) {
            const parentIdx = Math.floor((idx - 1) / 2);
            if (this.heap[parentIdx].f <= this.heap[idx].f) break;
            [this.heap[parentIdx], this.heap[idx]] = [this.heap[idx], this.heap[parentIdx]];
            idx = parentIdx;
        }
    }
    sinkDown(idx) {
        const length = this.heap.length;
        while (true) {
            let leftIdx = 2 * idx + 1;
            let rightIdx = 2 * idx + 2;
            let swap = null;
            if (leftIdx < length && this.heap[leftIdx].f < this.heap[idx].f) swap = leftIdx;
            if (rightIdx < length && this.heap[rightIdx].f < (swap === null ? this.heap[idx].f : this.heap[leftIdx].f)) swap = rightIdx;
            if (swap === null) break;
            [this.heap[idx], this.heap[swap]] = [this.heap[swap], this.heap[idx]];
            idx = swap;
        }
    }
}


export const findRoute = (startLineKey, startStId, endLineKey, endStId, railwayData, stationNameIndex) => {

    if (!startLineKey || !endLineKey || !railwayData) return { error: "数据未就绪或参数错误" };
    if (!stationNameIndex) return { error: "站点索引未构建" };

    const getSt = (l, id) => railwayData[l]?.stations.find(s => s.id === id);
    const startNode = getSt(startLineKey, startStId);
    const endNode = getSt(endLineKey, endStId);

    if (!startNode || !endNode) return { error: "找不到起终点车站信息" };

    // 2. 参数配置
    const TRANSFER_PENALTY = 5.0; // 换乘惩罚
    const HEURISTIC_WEIGHT = 1.1; // 启发式权重

    const genKey = (l, s) => `${l}::${s}`;
    const targetKey = genKey(endLineKey, endStId);

    const openSet = new MinHeap();
    const gScore = new Map(); // 记录从起点到当前点的实际代价
    const cameFrom = new Map(); // 记录路径回溯

    // 初始节点
    const startH = calcDist(startNode.lat, startNode.lng, endNode.lat, endNode.lng);
    const startKey = genKey(startLineKey, startStId);
    
    gScore.set(startKey, 0);
    openSet.push({ 
        key: startKey, 
        lineKey: startLineKey, 
        stId: startStId, 
        g: 0, 
        f: startH * HEURISTIC_WEIGHT // f = g + h
    });

    const visited = new Set();

    while (openSet.size() > 0) {
        // --- 取出 f 值最小的节点 ---
        const current = openSet.pop();
        
        // 剪枝：如果已经处理过更优的路径，跳过
        if (visited.has(current.key)) continue;
        visited.add(current.key);

        // --- 判断是否到达终点 ---
        // 逻辑：到达目标线路的目标站，或者到达了目标站的换乘站（物理位置极近且同名）
        const currentStObj = getSt(current.lineKey, current.stId);
        
        // 距离检查 (处理同名站换乘情况)
        const distToEnd = calcDist(currentStObj.lat, currentStObj.lng, endNode.lat, endNode.lng);
        const isTargetStation = current.stId === endStId || (distToEnd < 0.2 && currentStObj.name_ja === endNode.name_ja);

        if (isTargetStation) {
            // 如果已经在目标线路上，直接结束
            if (current.lineKey === endLineKey) {
                return reconstructPath(cameFrom, current.key, railwayData);
            } 
            // 如果在目标站但不在目标线路上（比如到达了终点站的 JR 站台，但目标是该站的地铁站台）
            // 我们手动添加最后一跳“换乘”，然后结束
            else {
                const finalKey = genKey(endLineKey, endStId);
                cameFrom.set(finalKey, current.key);
                return reconstructPath(cameFrom, finalKey, railwayData);
            }
        }

        // --- 扩展邻居 ---
        const neighbors = [];
        const lineData = railwayData[current.lineKey];
        const stIdx = lineData.stations.findIndex(s => s.id === current.stId);

 
        if (stIdx > 0) neighbors.push({ ...lineData.stations[stIdx - 1], type: 'move' });
        if (stIdx < lineData.stations.length - 1) neighbors.push({ ...lineData.stations[stIdx + 1], type: 'move' });

        const transferOptions = stationNameIndex[currentStObj.name_ja] || [];
        for (const t of transferOptions) {
            if (t.lineKey === current.lineKey) continue; // 跳过自己
            // 公司兼容性检查
            const currMeta = lineData.meta;
            const nextMeta = railwayData[t.lineKey].meta;
            if (isCompanyCompatible(currMeta, nextMeta)) {
                neighbors.push({ ...t, type: 'transfer', id: t.id });
            }
        }

        // --- 处理邻居 ---
        for (const neighbor of neighbors) {
            const neighborKey = genKey(neighbor.lineKey || current.lineKey, neighbor.id);
            if (visited.has(neighborKey)) continue;

            // 计算代价
            let stepCost = 0;
            if (neighbor.type === 'move') {
                stepCost = calcDist(currentStObj.lat, currentStObj.lng, neighbor.lat, neighbor.lng);
            } else {
                stepCost = TRANSFER_PENALTY;
            }

            const tentativeG = current.g + stepCost;
            
            if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
                // 发现更优路径
                cameFrom.set(neighborKey, current.key);
                gScore.set(neighborKey, tentativeG);
                
                const h = calcDist(neighbor.lat, neighbor.lng, endNode.lat, endNode.lng);
                
                openSet.push({
                    key: neighborKey,
                    lineKey: neighbor.lineKey || current.lineKey, // move 时保持当前 lineKey，transfer 时使用新 lineKey
                    stId: neighbor.id,
                    g: tentativeG,
                    f: tentativeG + (h * HEURISTIC_WEIGHT)
                });
            }
        }
    }

    return { error: "无法找到可行路径（可能是孤立线路或公司不兼容）" };
};

// 路径重构
export const reconstructPath = (cameFrom, currentKey, railwayData) => {
    const rawPath = [currentKey];
    while (cameFrom.has(currentKey)) {
        currentKey = cameFrom.get(currentKey);
        rawPath.push(currentKey);
    }
    rawPath.reverse();

    const segments = [];
    // 合并同线路的连续站点
    // rawPath 格式: "LineA::St1", "LineA::St2", "LineA::St3", "LineB::St3" (换乘)
    
    if (rawPath.length < 2) return { segments: [] };

    let segmentStart = rawPath[0];
    
    for (let i = 1; i < rawPath.length; i++) {
        const [currLine, currSt] = rawPath[i].split('::');
        const [prevLine, prevSt] = rawPath[i-1].split('::');

        if (currLine !== prevLine) {
            const [startLine, startSt] = segmentStart.split('::');
            if (startSt !== prevSt) { // 避免原地换乘
                segments.push({
                    id: Date.now() + i,
                    lineKey: startLine,
                    fromId: startSt,
                    toId: prevSt
                });
            }
            segmentStart = rawPath[i]; 
        }
    }

    // 结算最后一段
    const [lastLine, lastSt] = rawPath[rawPath.length - 1].split('::');
    const [segStartLine, segStartSt] = segmentStart.split('::');
    
    if (segStartSt !== lastSt) {
        segments.push({
            id: Date.now() + 9999,
            lineKey: segStartLine,
            fromId: segStartSt,
            toId: lastSt
        });
    }

    return { segments };
};