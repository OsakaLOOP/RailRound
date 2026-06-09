import * as turf from '@turf/turf';

const calcDist = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // 地球半径 km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const calcPolylineDist = (coords) => {
  let dist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    dist += calcDist(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
  }
  return dist;
};

const c = Array.from({length: 1000}, (_, i) => [35 + i * 0.001, 139 + i * 0.001]);

console.time('turf');
for(let i=0; i<100; i++) {
  turf.length(turf.lineString(c.map(p => [p[1], p[0]])));
}
console.timeEnd('turf');

console.time('calcPolylineDist');
for(let i=0; i<100; i++) {
  calcPolylineDist(c);
}
console.timeEnd('calcPolylineDist');
