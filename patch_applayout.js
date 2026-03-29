const fs = require('fs');

const filepath = 'src/AppLayout.tsx';
let source = fs.readFileSync(filepath, 'utf8');

// 1. Destructure setVisitedStations from useStore
source = source.replace(
    /setSegmentGeometries, setTripSegmentsGeometry, segmentGeometries,/g,
    `setSegmentGeometries, setTripSegmentsGeometry, segmentGeometries, setVisitedStations,`
);

source = source.replace(
    /setTripSegmentsGeometry: state\.setTripSegmentsGeometry,/g,
    `setTripSegmentsGeometry: state.setTripSegmentsGeometry,\n        setVisitedStations: state.setVisitedStations,`
);

// 2. Add visitedStations calculation logic inside the effect that processes trips
const newLogic = `
            // Extract visited stations logic
            const visited = new Set<string>();
            allSegments.forEach(seg => {
                const line = railwayData[seg.lineKey];
                if (!line) return;

                const fromIdx = line.stations.findIndex(s => s.id === seg.fromId);
                const toIdx = line.stations.findIndex(s => s.id === seg.toId);

                if (fromIdx !== -1 && toIdx !== -1) {
                    const start = Math.min(fromIdx, toIdx);
                    const end = Math.max(fromIdx, toIdx);
                    for (let i = start; i <= end; i++) {
                        visited.add(line.stations[i].id);
                    }
                }
            });
            setVisitedStations(visited);

            // 1. 优先使用已有的缓存进行渲染，保证部分路线立即显示，防止整张地图因为几段缺失而瘫痪。
`;

source = source.replace(
    /\/\/ 1\. 优先使用已有的缓存进行渲染，保证部分路线立即显示，防止整张地图因为几段缺失而瘫痪。/g,
    newLogic
);

fs.writeFileSync(filepath, source, 'utf8');
console.log("Patched src/AppLayout.tsx successfully!");
