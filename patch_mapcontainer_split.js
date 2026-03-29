const fs = require('fs');

const filepath = 'src/components/map/MapContainer.tsx';
let source = fs.readFileSync(filepath, 'utf8');

// Replace the single useEffect with two independent ones
source = source.replace(
    /useEffect\(\(\) => \{\n        geoDataRef\.current = geoData;\n        visitedStationsRef\.current = visitedStations;\n        if \(isMapInitialized && leafletReady && geoData\) \{\n            renderBaseMap\(geoData\);\n            renderStations\(\);\n        \}\n    \}, \[geoData, leafletReady, isMapInitialized, visitedStations\]\);/g,
    `useEffect(() => {
        geoDataRef.current = geoData;
        if (isMapInitialized && leafletReady && geoData) {
            renderBaseMap(geoData);
        }
    }, [geoData, leafletReady, isMapInitialized, railwayData]);

    useEffect(() => {
        visitedStationsRef.current = visitedStations;
        if (isMapInitialized && leafletReady && geoData) {
            renderStations();
        }
    }, [geoData, leafletReady, isMapInitialized, visitedStations]);`
);

fs.writeFileSync(filepath, source, 'utf8');
console.log("Patched MapContainer.tsx split useEffects!");
