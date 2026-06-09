import * as turf from '@turf/turf';

const calcDist = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
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
  if (!coords || coords.length < 2) return 0;
  for (let i = 0; i < coords.length - 1; i++) {
    dist += calcDist(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
  }
  return dist;
};

// Simulated route coordinates (Leaflet [lat, lng])
const c = Array.from({length: 1000}, (_, i) => [35 + i * 0.001, 139 + i * 0.001]);

let t1 = performance.now();
let d1 = 0;
for(let i=0; i<100; i++) {
  d1 += turf.length(turf.lineString(c.map(p => [p[1], p[0]])));
}
let t2 = performance.now();
console.log(`Turf.length: ${(t2-t1).toFixed(2)}ms (Result: ${d1})`);

t1 = performance.now();
let d2 = 0;
for(let i=0; i<100; i++) {
  d2 += calcPolylineDist(c);
}
t2 = performance.now();
console.log(`calcPolylineDist: ${(t2-t1).toFixed(2)}ms (Result: ${d2})`);
