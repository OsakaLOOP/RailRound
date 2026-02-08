import * as turf from '@turf/turf';

// Store data in worker scope
let railwayData = null;
let geoData = null;
let segmentGeometries = new Map(); // Cache geometries: key -> { coords, color, isMulti, fallback }

// --- Helper Functions (Copied/Adapted from src/utils/stats.js) ---

const calcDist = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // Earth Radius km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const stitchRoutes = (multiCoords, startPt) => {
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

const sliceGeoJsonPath = (feature, startLat, startLng, endLat, endLng) => {
    if (!feature || !feature.geometry) return null;

    try {
      let line = feature;
      const startPt = turf.point([startLng, startLat]);
      const endPt = turf.point([endLng, endLat]);

      if (feature.geometry.type === 'MultiLineString') {
         const multiCoords = feature.geometry.coordinates;
         const stitchedCoords = stitchRoutes(multiCoords, startPt);
         if (stitchedCoords && stitchedCoords.length > 0) {
           line = turf.lineString(stitchedCoords);
         } else {
           const flatCoords = feature.geometry.coordinates.flat();
           line = turf.lineString(flatCoords);
         }
      }

      const snappedStart = turf.nearestPointOnLine(line, startPt);
      const snappedEnd = turf.nearestPointOnLine(line, endPt);

        // Loop detection
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
        // console.warn("Worker: Turf slice failed:", e);
        return null;
    }
};

const getGeometry = (seg) => {
    const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
    let geom = segmentGeometries.get(key);

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

                let coords = null;
                let isMulti = false;
                let color = feature ? (feature.properties.stroke || '#38bdf8') : '#38bdf8';

                if (feature) {
                    const sliced = sliceGeoJsonPath(feature, s1.lat, s1.lng, s2.lat, s2.lng);
                    if (sliced) {
                        coords = sliced;
                        isMulti = Array.isArray(sliced[0]) && Array.isArray(sliced[0][0]);
                    }
                }

                // Fallback
                if (!coords) {
                     const routeCoords = [];
                     const startIdx = line.stations.findIndex(st => st.id === seg.fromId);
                     const endIdx = line.stations.findIndex(st => st.id === seg.toId);
                     if (startIdx !== -1 && endIdx !== -1) {
                         const step = startIdx <= endIdx ? 1 : -1;
                         for (let i = startIdx; i !== endIdx + step; i += step) {
                            if (i >= 0 && i < line.stations.length) routeCoords.push([line.stations[i].lat, line.stations[i].lng]);
                         }
                         if (routeCoords.length > 1) { coords = routeCoords; }
                     }
                }
                if (!coords) { coords = [[s1.lat, s1.lng], [s2.lat, s2.lng]]; }

                geom = { coords, isMulti, color };
                segmentGeometries.set(key, geom); // Cache in worker
            }
        }
    }
    return geom;
};

const getRouteVisualData = (segments) => {
    let totalDist = 0;
    const allCoords = [];

    segments.forEach(seg => {
        const geom = getGeometry(seg);
        if (geom && geom.coords) {
            if (geom.isMulti) {
                geom.coords.forEach(c => {
                    allCoords.push({ coords: c, color: geom.color || '#94a3b8' });
                    totalDist += turf.length(turf.lineString(c.map(p => [p[1], p[0]])));
                });
            } else {
                allCoords.push({ coords: geom.coords, color: geom.color || '#94a3b8' });
                totalDist += turf.length(turf.lineString(geom.coords.map(p => [p[1], p[0]])));
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

    // PCA & Projection Logic (Same as original)
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

    const rotate = (lat, lng) => {
        const x = lng - cenLng;
        const y = lat - cenLat;
        const rx = x * cosT - y * sinT;
        const ry = x * sinT + y * cosT;
        return { rx, ry };
    };

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

    const visualPaths = allCoords.map(item => {
        const pointsStr = item.coords.map(pt => {
            const { rx, ry } = rotate(pt[0], pt[1]);
            const px = ((rx - vMinX) / vW) * 100;
            const py = 50 - ((ry - vMinY) / vH) * 50;
            return `${px.toFixed(1)},${py.toFixed(1)}`;
        }).join(' ');

        return {
            path: `M ${pointsStr.replace(/ /g, ' L ')}`,
            polyline: pointsStr,
            color: item.color
        };
    });

    return { totalDist, visualPaths, widthPx, heightPx };
};

const calculateLatestStats = (trips) => {
    const totalTrips = trips.length;
    const allSegments = trips.flatMap(t => t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }]);
    const uniqueLines = new Set(allSegments.map(s => s.lineKey)).size;

    // Calc total distance
    const { totalDist: grandTotalDist } = getRouteVisualData(allSegments);

    // Latest 5
    const latest = trips.slice(0, 5).map(t => {
        const segs = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
        const lineNames = segs.map(s => s.lineKey.split(':').pop()).join(' → ');

        const { totalDist, visualPaths } = getRouteVisualData(segs);
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

// --- Message Handler ---

self.onmessage = (e) => {
    const { type, payload, id } = e.data;

    try {
        let result = null;

        switch (type) {
            case 'INIT_DATA':
                railwayData = payload.railwayData;
                geoData = payload.geoData;
                // Clear cache if data changes significantly? For now keep simple.
                segmentGeometries.clear();
                result = { success: true };
                break;

            case 'CALC_STATS':
                // payload.trips
                result = calculateLatestStats(payload.trips);
                break;

            case 'GET_GEOMETRY':
                // payload.segment
                result = getGeometry(payload.segment);
                break;

            case 'GET_ROUTE_VISUAL':
                // payload.segments
                result = getRouteVisualData(payload.segments);
                break;

            case 'GET_ALL_GEOMETRIES':
                // payload.trips
                {
                    const allGeoms = [];
                    payload.trips.forEach(t => {
                        const segs = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
                        segs.forEach(seg => {
                            const g = getGeometry(seg);
                            if (g && g.coords) {
                                allGeoms.push({
                                    id: seg.id || `${seg.lineKey}_${seg.fromId}_${seg.toId}`,
                                    coords: g.coords,
                                    color: g.color,
                                    isMulti: g.isMulti,
                                    popup: `${seg.lineKey}` // Simplified popup
                                });
                            }
                        });
                    });
                    result = allGeoms;
                }
                break;

            case 'GENERATE_KML_DATA':
                // payload.trips
                {
                    const allPaths = [];
                    payload.trips.forEach(t => {
                        const tripName = `${t.date} - Trip ${t.id}`;
                        const segs = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
                        segs.forEach((seg, segIndex) => {
                             const g = getGeometry(seg);
                             if (g && g.coords) {
                                 let kmlCoords = "";
                                 if (g.isMulti) {
                                     // Flatten multi-coords for KML (or handle as MultiGeometry? simple KML usually one string per Placemark)
                                     // We will create separate paths for multi-segments or join them with a jump?
                                     // KML LineString must be continuous.
                                     // For simplicity, we create one path entry per continuous segment.
                                     g.coords.forEach((part, partIdx) => {
                                         const str = part.map(p => `${p[1]},${p[0]},0`).join(' ');
                                         allPaths.push({
                                             name: `${tripName} Segment ${segIndex + 1}.${partIdx + 1}`,
                                             coordinates: str,
                                             lineKey: seg.lineKey
                                         });
                                     });
                                 } else {
                                     const str = g.coords.map(p => `${p[1]},${p[0]},0`).join(' ');
                                     allPaths.push({
                                         name: `${tripName} Segment ${segIndex + 1}`,
                                         coordinates: str,
                                         lineKey: seg.lineKey
                                     });
                                 }
                             }
                        });
                    });
                    result = allPaths;
                }
                break;

            default:
                throw new Error(`Unknown message type: ${type}`);
        }

        self.postMessage({ type, id, result, success: true });

    } catch (err) {
        self.postMessage({ type, id, error: err.message, success: false });
    }
};
