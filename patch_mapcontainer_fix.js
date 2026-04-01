const fs = require('fs');
const filepath = 'src/components/map/MapContainer.tsx';
let source = fs.readFileSync(filepath, 'utf8');

// 1. Add Custom Panes in Initialization
source = source.replace(
    /mapInstance\.current = map;/g,
    `mapInstance.current = map;

        map.createPane('routesPane');
        map.getPane('routesPane').style.zIndex = '400';
        map.createPane('stationsPane');
        map.getPane('stationsPane').style.zIndex = '410';`
);

// 2. Fix the `isVisited` condition and add `pane` to `L.circleMarker`
source = source.replace(
    /const isVisited = visitedStationsRef\.current\.has\(f\.properties\.id \|\| ''\);/g,
    `const stationId = f.properties.id || \`\${f.properties.company}:\${f.properties.line}:\${f.properties.name}\`;
                const isVisited = visitedStationsRef.current.has(stationId);`
);

source = source.replace(
    /const layer = L\.circleMarker\(latlng, \{/g,
    `const layer = L.circleMarker(latlng, {
                    pane: 'stationsPane',`
);

// 3. Ensure polyline also uses a custom pane in `renderTripRoutes`
source = source.replace(
    /const options = \{ color: item\.color, weight: zoomWeight, opacity: 0\.9, lineCap: 'round', smoothFactor: 0\.2, dashArray: item\.fallback \? '5, 10' : undefined \};/g,
    `const options = { color: item.color, weight: zoomWeight, opacity: 0.9, lineCap: 'round', smoothFactor: 0.2, dashArray: item.fallback ? '5, 10' : undefined, pane: 'routesPane' };`
);

// We need to also fix the isVisited variable in `updateLayer` function
source = source.replace(
    /const isVisited = visitedStationsRef\.current\.has\(f\.properties\.id \|\| ''\);/g, // We replaced ALL occurrences previously, so we don't need a separate one, wait, we used /g above.
    `// handled by /g`
);

fs.writeFileSync(filepath, source, 'utf8');
console.log("Patched successfully!");
