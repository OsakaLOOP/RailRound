import * as turf from '@turf/turf';

// 内存数据副本
let railwayData = {};
let geoData = { type: 'FeatureCollection', features: [] };

// 辅助：计算两点间直线距离 (Haversine Formula)
export const calcDist = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // 地球半径 km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// 路径缝合算法: 将乱序的 MultiLineString 缝合成连续的 LineString
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

// [Turf.js] 轨迹切分算法
export const sliceGeoJsonPath = (feature, startLat, startLng, endLat, endLng) => {
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

            case 'GET_ALL_GEOMETRIES':
                // 按需计算所需的 segments
                const neededSegments = payload.segments || [];
                const results = [];

                for (const seg of neededSegments) {
                    const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                    const line = railwayData[seg.lineKey];
                    if (!line) {
                        // 找不到路线数据，返回一个表示跳过的结果
                        results.push({ key, data: null });
                        continue;
                    }

                    const s1 = line.stations.find(s => s.id === seg.fromId);
                    const s2 = line.stations.find(s => s.id === seg.toId);
                    if (!s1 || !s2) {
                        results.push({ key, data: null });
                        continue;
                    }

                    const parts = seg.lineKey.split(':');
                    const company = parts[0];
                    const lineName = parts.slice(1).join(':');

                    const feature = geoData.features.find((f) =>
                        f.properties.type === 'line' &&
                        f.properties.name === lineName &&
                        f.properties.company === company
                    );

                    let coords = null;
                    let color = '#38bdf8';
                    let isMulti = false;
                    let fallback = false;

                    if (feature) {
                        color = feature.properties.stroke || '#38bdf8';
                        const latLngs = sliceGeoJsonPath(feature, s1.lat, s1.lng, s2.lat, s2.lng);
                        if (latLngs) {
                            coords = latLngs;
                            if (Array.isArray(latLngs[0]) && Array.isArray(latLngs[0][0])) isMulti = true;
                        }
                    }

                    // Fallback 逻辑：当没匹配到 GeoJSON，生成直线或各站直连
                    if (!coords) {
                        fallback = true;
                        const routeCoords = [];
                        const startIdx = line.stations.findIndex(st => st.id === seg.fromId);
                        const endIdx = line.stations.findIndex(st => st.id === seg.toId);
                        if (startIdx !== -1 && endIdx !== -1) {
                            const step = startIdx <= endIdx ? 1 : -1;
                            for (let i = startIdx; i !== endIdx + step; i += step) {
                                if (i >= 0 && i < line.stations.length) routeCoords.push([line.stations[i].lat, line.stations[i].lng]);
                            }
                            if (routeCoords.length > 1) { coords = routeCoords; fallback = false; }
                        }
                    }

                    if (!coords) {
                        // 最差的情况，连接首尾两点
                        coords = [[s1.lat, s1.lng], [s2.lat, s2.lng]];
                        fallback = true;
                    }

                    results.push({
                        key,
                        data: { coords, color, isMulti, fallback }
                    });
                }

                self.postMessage({ id, type: 'GET_ALL_GEOMETRIES_SUCCESS', payload: results });
                break;

            default:
                self.postMessage({ id, type: 'ERROR', payload: 'Unknown message type' });
        }
    } catch (err) {
        self.postMessage({ id, type: 'ERROR', payload: err.message });
    }
});
