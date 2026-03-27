const fs = require('fs');

const filepath = 'src/components/map/MapContainer.tsx';
let source = fs.readFileSync(filepath, 'utf8');

// 1. Add geoDataRef to MapContainer component
source = source.replace(
    /const baseStationsLayer = useRef<L\.LayerGroup \| null>\(null\);/g,
    `const baseStationsLayer = useRef<L.LayerGroup | null>(null);\n    const geoDataRef = useRef<CustomFeatureCollection | null>(null);`
);

// 2. Update geoDataRef whenever geoData changes
source = source.replace(
    /useEffect\(\(\) => \{\n        if \(isMapInitialized && leafletReady && geoData\) renderBaseMap\(geoData\);\n    \}, \[geoData, leafletReady, isMapInitialized\]\);/g,
    `useEffect(() => {
        geoDataRef.current = geoData;
        if (isMapInitialized && leafletReady && geoData) {
            renderBaseMap(geoData);
            renderStations();
        }
    }, [geoData, leafletReady, isMapInitialized]);`
);

// 3. Add map event listener for moveend (dragend & zoomend combined)
source = source.replace(
    /map\.on\('zoomend', updateLayerVisibility\);\n        updateLayerVisibility\(\);/g,
    `map.on('zoomend', updateLayerVisibility);
        updateLayerVisibility();

        // Listen to moveend to update stations with new bounds
        map.on('moveend', () => {
            renderStations();
        });`
);

// 4. Create the renderStations method and modify renderBaseMap
// Extract the baseStationsLayer part from renderBaseMap
const stationsLogic = `
        // Base Stations
        const stationFeatures = data.features.filter((f: CustomGeoJSONFeature) => f.properties.type === 'station');
        syncLeafletLayerGroup<CustomGeoJSONFeature>(
            baseStationsLayer.current,
            stationFeatures,
            (f) => f.properties.id || \`\${f.properties.company}:\${f.properties.line}:\${f.properties.name}\`,
            (f) => {
                const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number];
                const layer = L.circleMarker(latlng, { radius: 4, color: 'transparent', fillColor: '#64748b', fillOpacity: 0.5, weight: 0, className: 'station-dot' });
                if (f.properties.name) layer.bindTooltip(f.properties.name);
                layer.on('click', (e: L.LeafletMouseEvent) => {
                    L.DomEvent.stopPropagation(e);
                    const originalEvent = e.originalEvent as MouseEvent | TouchEvent;
                    const x = 'clientX' in originalEvent ? originalEvent.clientX : (originalEvent as TouchEvent).touches[0].clientX;
                    const y = 'clientY' in originalEvent ? originalEvent.clientY : (originalEvent as TouchEvent).touches[0].clientY;
                    setStationMenu({ x, y, stationData: { name_ja: f.properties.name || '' } });
                });
                return layer;
            },
            (layer, f) => {
                // Stations static
            }
        );`;

source = source.replace(stationsLogic, "");

const renderStationsMethod = `
    const renderStations = () => {
        if (!baseStationsLayer.current || !mapInstance.current || !geoDataRef.current) return;

        const map = mapInstance.current;
        const currentZoom = map.getZoom();

        // At zoom < 5, strictly provide empty array to clear/hide stations
        if (currentZoom < 5) {
            syncLeafletLayerGroup<CustomGeoJSONFeature>(
                baseStationsLayer.current,
                [],
                (f) => f.properties.id || \`\${f.properties.company}:\${f.properties.line}:\${f.properties.name}\`,
                (f) => L.circleMarker([0, 0]),
                () => {}
            );
            return;
        }

        // Calculate 3x3 viewport bounds
        const bounds = map.getBounds();
        const latDiff = bounds.getNorth() - bounds.getSouth();
        const lngDiff = bounds.getEast() - bounds.getWest();

        const expandedBounds = L.latLngBounds(
            L.latLng(bounds.getSouth() - latDiff, bounds.getWest() - lngDiff),
            L.latLng(bounds.getNorth() + latDiff, bounds.getEast() + lngDiff)
        );

        // Filter stations within the expanded bounds
        const stationFeatures = geoDataRef.current.features.filter((f: CustomGeoJSONFeature) => {
            if (f.properties.type !== 'station') return false;
            const lng = f.geometry.coordinates[0];
            const lat = f.geometry.coordinates[1];
            // Since it's point data, check if it's within the expanded bounds
            return expandedBounds.contains([lat, lng]);
        });

        syncLeafletLayerGroup<CustomGeoJSONFeature>(
            baseStationsLayer.current,
            stationFeatures,
            (f) => f.properties.id || \`\${f.properties.company}:\${f.properties.line}:\${f.properties.name}\`,
            (f) => {
                const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number];
                const layer = L.circleMarker(latlng, { radius: 4, color: 'transparent', fillColor: '#64748b', fillOpacity: 0.5, weight: 0, className: 'station-dot' });
                if (f.properties.name) layer.bindTooltip(f.properties.name);

                (layer as any)._cachedLat = latlng[0];
                (layer as any)._cachedLng = latlng[1];
                (layer as any)._cachedName = f.properties.name;

                layer.on('click', (e: L.LeafletMouseEvent) => {
                    L.DomEvent.stopPropagation(e);
                    const originalEvent = e.originalEvent as MouseEvent | TouchEvent;
                    const x = 'clientX' in originalEvent ? originalEvent.clientX : (originalEvent as TouchEvent).touches[0].clientX;
                    const y = 'clientY' in originalEvent ? originalEvent.clientY : (originalEvent as TouchEvent).touches[0].clientY;
                    setStationMenu({ x, y, stationData: { name_ja: f.properties.name || '' } });
                });
                return layer;
            },
            (layer, f) => {
                const marker = layer as L.CircleMarker & { _cachedLat?: number, _cachedLng?: number, _cachedName?: string };
                const newLat = f.geometry.coordinates[1];
                const newLng = f.geometry.coordinates[0];
                const newName = f.properties.name;

                let changed = false;
                if (marker._cachedLat !== newLat || marker._cachedLng !== newLng) {
                    marker.setLatLng([newLat, newLng]);
                    marker._cachedLat = newLat;
                    marker._cachedLng = newLng;
                    changed = true;
                }

                if (marker._cachedName !== newName) {
                    marker.unbindTooltip();
                    if (newName) marker.bindTooltip(newName);
                    marker._cachedName = newName;
                    changed = true;
                }

                // Do nothing else if not changed to optimize DOM updates
            }
        );
    };
`;

source = source.replace(/const renderBaseMap = \(data: CustomFeatureCollection\) => \{/, renderStationsMethod + '\n    const renderBaseMap = (data: CustomFeatureCollection) => {');

// We also need to remove the requirement for baseStationsLayer in renderBaseMap since we removed the logic
source = source.replace(
    /if \(!baseLinesLayer\.current \|\| !baseStationsLayer\.current\) return;/g,
    `if (!baseLinesLayer.current) return;`
);

fs.writeFileSync(filepath, source, 'utf8');
console.log("Patched successfully!");
