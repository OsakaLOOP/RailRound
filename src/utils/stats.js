import * as turf from '@turf/turf';

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

// [New] 路径缝合算法: 将乱序的 MultiLineString 缝合成连续的 LineString
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

// --- Shared Helper: Calculate Visualization Data ---
export const getRouteVisualData = (segments, segmentGeometries, railwayData, geoData) => {
    let totalDist = 0;
    const allCoords = [];

    // Helper to get or calc geometry on-the-fly
    const getGeometry = (seg) => {
        const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
        let geom = segmentGeometries ? segmentGeometries.get(key) : null;

        // Fallback: If not in cache but we have geoData, try to slice it now
        if ((!geom || !geom.coords) && geoData && railwayData) {
            const line = railwayData[seg.lineKey];
            if (line) {
                const s1 = line.stations.find(st => st.id === seg.fromId);
                const s2 = line.stations.find(st => st.id === seg.toId);
                if (s1 && s2) {
                    const parts = seg.lineKey.split(':');
                    const company = parts[0];
                    const lineName = parts.slice(1).join(':');
                    const feature = geoData.features.find(f =>
                        f.properties.type === 'line' &&
                        f.properties.name === lineName &&
                        f.properties.company === company
                    );
                    if (feature) {
                        const coords = sliceGeoJsonPath(feature, s1.lat, s1.lng, s2.lat, s2.lng);
                        if (coords) {
                            const isMulti = Array.isArray(coords[0]) && Array.isArray(coords[0][0]);
                            geom = { coords, isMulti };
                        }
                    }
                }
            }
        }
        return geom;
    };

    segments.forEach(seg => {
        const geom = getGeometry(seg);
        if (geom && geom.coords) {
            if (geom.isMulti) {
                geom.coords.forEach(c => {
                    allCoords.push({ coords: c, color: geom.color || '#94a3b8' });
                    if(turf) totalDist += turf.length(turf.lineString(c.map(p => [p[1], p[0]])));
                });
            } else {
                allCoords.push({ coords: geom.coords, color: geom.color || '#94a3b8' });
                if(turf) totalDist += turf.length(turf.lineString(geom.coords.map(p => [p[1], p[0]])));
            }
        } else {
             // Fallback Distance Approx
            const line = railwayData ? railwayData[seg.lineKey] : null;
            if (line) {
                const s1 = line.stations.find(st => st.id === seg.fromId);
                const s2 = line.stations.find(st => st.id === seg.toId);
                if (s1 && s2) totalDist += calcDist(s1.lat, s1.lng, s2.lat, s2.lng);
            }
        }
    });

    if (allCoords.length === 0) return { totalDist, visualPaths: [] };

    // PCA & Projection Logic
    let sumLat = 0, sumLng = 0, count = 0;
    allCoords.forEach(item => {
        item.coords.forEach(pt => {
            sumLat += pt[0];
            sumLng += pt[1];
            count++;
        });
    });

    if (count === 0) return { totalDist, visualPaths: [] };

    const cenLat = sumLat / count;
    const cenLng = sumLng / count;

    let u20 = 0, u02 = 0, u11 = 0;
    allCoords.forEach(item => {
        item.coords.forEach(pt => {
            const x = pt[1] - cenLng;
            const y = pt[0] - cenLat;
            u20 += x * x;
            u02 += y * y;
            u11 += x * y;
        });
    });

    const theta = 0.5 * Math.atan2(2 * u11, u20 - u02);
    const cosT = Math.cos(-theta);
    const sinT = Math.sin(-theta);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    // Helper to rotate a point
    const rotate = (lat, lng) => {
        const x = lng - cenLng;
        const y = lat - cenLat;
        const rx = x * cosT - y * sinT;
        const ry = x * sinT + y * cosT;
        return { rx, ry };
    };

    // 1. Calc BBox
    allCoords.forEach(item => {
        item.coords.forEach(pt => {
            const { rx, ry } = rotate(pt[0], pt[1]);
            if (rx < minX) minX = rx;
            if (rx > maxX) maxX = rx;
            if (ry < minY) minY = ry;
            if (ry > maxY) maxY = ry;
        });
    });

    const w = maxX - minX || 0.001;
    const h = maxY - minY || 0.001;
    const padX = w * 0.1;
    const padY = h * 0.1;
    const vMinX = minX - padX;
    const vMinY = minY - padY;
    const vW = w + padX * 2;
    const vH = h + padY * 2;

    const contentRatio = vW / vH;
    const visualRatio = Math.min(8, Math.max(2, contentRatio));
    const heightPx = 40;
    const widthPx = heightPx * visualRatio;

    // 2. Generate Paths
    const visualPaths = allCoords.map(item => {
        const pointsStr = item.coords.map(pt => {
            const { rx, ry } = rotate(pt[0], pt[1]);
            const px = ((rx - vMinX) / vW) * 100;
            const py = 50 - ((ry - vMinY) / vH) * 50;
            return `${px.toFixed(1)},${py.toFixed(1)}`;
        }).join(' ');

        return {
            path: `M ${pointsStr.replace(/ /g, ' L ')}`, // SVG Path Command
            polyline: pointsStr, // Legacy Polyline points
            color: item.color
        };
    });

    return { totalDist, visualPaths, widthPx, heightPx };
};

// --- Updated: Stats Calculation using Shared Helper ---
export const calculateLatestStats = (trips, segmentGeometries, railwayData, geoData) => {
    // 1. Basic Stats
    const totalTrips = trips.length;
    const allSegments = trips.flatMap(t => t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }]);
    const uniqueLines = new Set(allSegments.map(s => s.lineKey)).size;

    // Calc total distance using helper (aggregating cached or on-the-fly)
    const { totalDist: grandTotalDist } = getRouteVisualData(allSegments, segmentGeometries, railwayData, geoData);

    // 2. Latest 5
    const latest = trips.slice(0, 5).map(t => {
        const segs = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
        const lineNames = segs.map(s => s.lineKey.split(':').pop()).join(' → '); // Simplified Title

        const { totalDist, visualPaths } = getRouteVisualData(segs, segmentGeometries, railwayData, geoData);

        // Combine all paths into one 'd' string for the card
        const svgPoints = visualPaths.map(vp => vp.path).join(" ");

        return {
            id: t.id,
            date: t.date,
            title: lineNames,
            dist: totalDist,
            svg_points: svgPoints
        };
    });

    return {
        count: totalTrips,
        lines: uniqueLines,
        dist: grandTotalDist,
        latest: latest
    };
};
