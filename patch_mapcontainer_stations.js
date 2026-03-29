const fs = require('fs');
const filepath = 'src/components/map/MapContainer.tsx';
let source = fs.readFileSync(filepath, 'utf8');

// 1. We need to grab visitedStations from useStore
source = source.replace(
    /setEditingPin, setPinMode\n    \} = useStore\(useShallow\(state => \(\{/g,
    `setEditingPin, setPinMode, visitedStations\n    } = useStore(useShallow(state => ({`
);

source = source.replace(
    /setEditingPin: state\.setEditingPin,\n        setPinMode: state\.setPinMode/g,
    `setEditingPin: state.setEditingPin,\n        setPinMode: state.setPinMode,\n        visitedStations: state.visitedStations`
);

// We need to re-render stations whenever visitedStations changes.
// But renderStations reads it directly from state? No, renderStations is a closure.
// Wait, map event listeners like moveend capture closures.
// So we should put visitedStations into a ref, just like geoDataRef.
source = source.replace(
    /const geoDataRef = useRef<CustomFeatureCollection \| null>\(null\);/g,
    `const geoDataRef = useRef<CustomFeatureCollection | null>(null);\n    const visitedStationsRef = useRef<Set<string>>(new Set());`
);

source = source.replace(
    /useEffect\(\(\) => \{\n        geoDataRef\.current = geoData;\n        if \(isMapInitialized && leafletReady && geoData\) \{\n            renderBaseMap\(geoData\);\n            renderStations\(\);\n        \}\n    \}, \[geoData, leafletReady, isMapInitialized\]\);/g,
    `useEffect(() => {
        geoDataRef.current = geoData;
        visitedStationsRef.current = visitedStations;
        if (isMapInitialized && leafletReady && geoData) {
            renderBaseMap(geoData);
            renderStations();
        }
    }, [geoData, leafletReady, isMapInitialized, visitedStations]);`
);


// 2. Modify renderStations to color visited stations
// Inside the `createLayer` and `updateLayer` callbacks of syncLeafletLayerGroup
source = source.replace(
    /const layer = L\.circleMarker\(latlng, \{ radius: 4, color: 'transparent', fillColor: '#64748b', fillOpacity: 0.5, weight: 0, className: 'station-dot' \}\);/g,
    `const isVisited = visitedStationsRef.current.has(f.properties.id || '');
                const lineColor = f.properties.stroke || '#64748b'; // Fallback if no stroke defined
                const layer = L.circleMarker(latlng, {
                    radius: isVisited ? 5 : 4,
                    color: isVisited ? '#ffffff' : 'transparent',
                    fillColor: isVisited ? lineColor : '#64748b',
                    fillOpacity: isVisited ? 1.0 : 0.5,
                    weight: isVisited ? 2 : 0,
                    className: 'station-dot'
                });
                // @ts-ignore
                layer._cachedIsVisited = isVisited;`
);

// updateLayer signature
source = source.replace(
    /const marker = layer as any;/g,
    `const marker = layer as any;
                const isVisited = visitedStationsRef.current.has(f.properties.id || '');
                const lineColor = f.properties.stroke || '#64748b';`
);

// inside updateLayer comparison
source = source.replace(
    /\/\/ Do nothing else if not changed to optimize DOM updates/g,
    `if (marker._cachedIsVisited !== isVisited) {
                    marker.setStyle({
                        radius: isVisited ? 5 : 4,
                        color: isVisited ? '#ffffff' : 'transparent',
                        fillColor: isVisited ? lineColor : '#64748b',
                        fillOpacity: isVisited ? 1.0 : 0.5,
                        weight: isVisited ? 2 : 0
                    });
                    marker._cachedIsVisited = isVisited;
                    changed = true;
                }

                // Do nothing else if not changed to optimize DOM updates`
);

fs.writeFileSync(filepath, source, 'utf8');
console.log("Patched renderStations to style visited stations!");
