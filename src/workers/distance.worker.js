// 站距计算后台 Web Worker
// 使用 Haversine 公式估算两点距离 (单位: km)
const calcDist = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  self.addEventListener('message', (e) => {
      const { type, payload } = e.data;
      if (type === 'CALC_DISTANCES') {
          const { railwayData } = payload;
          const entries = Object.entries(railwayData);
          const total = entries.length;
          let processed = 0;
          let lastReportedProgress = -1;

          const updatedData = {};

          for (const [lineKey, line] of entries) {
              const stations = [...line.stations];
              let needsUpdate = false;

              for (let i = 0; i < stations.length - 1; i++) {
                  if (stations[i].distToNext === undefined) {
                      needsUpdate = true;
                      const s1 = stations[i];
                      const s2 = stations[i+1];
                      stations[i] = { ...s1, distToNext: calcDist(s1.lat, s1.lng, s2.lat, s2.lng) };
                  }
              }

              if (needsUpdate) {
                 updatedData[lineKey] = { ...line, stations };
              } else {
                 updatedData[lineKey] = line;
              }

              processed++;

              // Report progress every 5%
              const currentProgress = Math.floor((processed / total) * 100);
              if (currentProgress >= lastReportedProgress + 5) {
                  self.postMessage({ type: 'PROGRESS', payload: { progress: currentProgress } });
                  lastReportedProgress = currentProgress;
              }
          }

          self.postMessage({ type: 'COMPLETE', payload: { updatedRailwayData: updatedData } });
      }
  });
