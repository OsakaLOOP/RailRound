const fs = require('fs');
const filepath = 'src/store/index.ts';
let source = fs.readFileSync(filepath, 'utf8');

// Add visitedStations to GlobalStore interface
source = source.replace(
    /tripSegmentsGeometry: any\[\];/g,
    `tripSegmentsGeometry: any[];\n  visitedStations: Set<string>;`
);

source = source.replace(
    /setTripSegmentsGeometry: \(data: any\[\]\) => void;/g,
    `setTripSegmentsGeometry: (data: any[]) => void;\n  setVisitedStations: (stations: Set<string>) => void;`
);

// Implement in store creation
source = source.replace(
    /tripSegmentsGeometry: \[\],/g,
    `tripSegmentsGeometry: [],\n      visitedStations: new Set<string>(),`
);

source = source.replace(
    /setTripSegmentsGeometry: \(data\) => set\(\{ tripSegmentsGeometry: data \}\),/g,
    `setTripSegmentsGeometry: (data) => set({ tripSegmentsGeometry: data }),\n      setVisitedStations: (stations) => set({ visitedStations: stations }),`
);

fs.writeFileSync(filepath, source, 'utf8');
console.log("Patched src/store/index.ts successfully!");
