const fs = require('fs');
const filepath = 'src/components/map/MapContainer.tsx';
let source = fs.readFileSync(filepath, 'utf8');

// The original renderBaseMap uses syncLeafletLayerGroup for baseLinesLayer.
// We want to replace it with a one-time rendering (or simple clear/add) with interactive: false
// We will simply clear and re-add a GeoJSON layer to baseLinesLayer instead of using syncLeafletLayerGroup
// Since it's no longer interactive, we don't need syncLeafletLayerGroup for it.

const newRenderBaseMap = `
    const renderBaseMap = (data: CustomFeatureCollection) => {
        if (!baseLinesLayer.current) return;
        baseLinesLayer.current.clearLayers();

        // Base Lines
        const lineFeatures = data.features.filter((f: CustomGeoJSONFeature) => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
        L.geoJSON(lineFeatures as any, {
            style: { color: '#475569', weight: 1, opacity: 0.3 },
            interactive: false
        }).addTo(baseLinesLayer.current);
    };
`;

// Find the existing renderBaseMap block and replace it.
// To do this reliably, we can search for the start and end.
const oldStart = source.indexOf('    const renderBaseMap = (data: CustomFeatureCollection) => {');
const oldEnd = source.indexOf('    const renderTripRoutes = () => {');

if (oldStart !== -1 && oldEnd !== -1) {
    source = source.substring(0, oldStart) + newRenderBaseMap + '\n' + source.substring(oldEnd);
    fs.writeFileSync(filepath, source, 'utf8');
    console.log("Patched renderBaseMap to be static and non-interactive!");
} else {
    console.error("Could not find renderBaseMap block boundaries");
}
