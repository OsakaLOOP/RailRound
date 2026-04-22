const fs = require('fs');

let content = fs.readFileSync('src/components/blog/RouteSlicePreview.tsx', 'utf8');

// Fix the SSR issue
content = content.replace("import * as L from 'leaflet';", "");
content = content.replace("import 'leaflet/dist/leaflet.css';", "");
content = content.replace("const mapBounds = useRef<L.LatLngBounds | null>(null);", "const mapBounds = useRef<any>(null);");
content = content.replace("const mapInstance = useRef<L.Map | null>(null);", "const mapInstance = useRef<any>(null);");
content = content.replace("const routeLayer = useRef<L.LayerGroup | null>(null);", "const routeLayer = useRef<any>(null);");


let mapInitBlock = `
        // Init Map
        if (!mapInstance.current) {
            import('leaflet').then((L) => {
                import('leaflet/dist/leaflet.css');
                mapInstance.current = L.map(mapRef.current, {
                    zoomControl: false,
                    attributionControl: false,
                    scrollWheelZoom: false, // Better for embedded preview
                });

                cachedTileLayer(
                    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
                    {
                        subdomains: 'abcd',
                        maxZoom: 20
                    }
                ).addTo(mapInstance.current);

                routeLayer.current = L.layerGroup().addTo(mapInstance.current);

                if (routeLayer.current) {
                    routeLayer.current.clearLayers();

                    let bounds = L.latLngBounds([]);

                    const latLngs = data.stations.map((st: any) => [st.lat, st.lng] as [number, number]);
                    const polyline = L.polyline(latLngs, { color: '#39C5BB', weight: 4, opacity: 0.8 }).addTo(routeLayer.current);
                    bounds.extend(polyline.getBounds());

                    // Draw markers for stations
                    data.stations.forEach((st: any, idx: number) => {
                        const isStartEnd = idx === 0 || idx === data.stations.length - 1;
                        const marker = L.circleMarker([st.lat, st.lng], {
                            radius: isStartEnd ? 6 : 4,
                            fillColor: '#ffffff',
                            color: isStartEnd ? '#39C5BB' : '#94a3b8',
                            weight: 2,
                            fillOpacity: 1
                        });

                        marker.bindTooltip(st.name_ja, {
                            permanent: true,
                            direction: 'top',
                            offset: [0, -4],
                            className: 'text-[10px] font-bold bg-white/80 backdrop-blur border border-slate-200/50 text-slate-700 shadow-sm px-1.5 py-0.5 rounded-md',
                            opacity: 0.9
                        });

                        marker.addTo(routeLayer.current!);
                    });

                    if (mapInstance.current && bounds.isValid()) {
                        mapInstance.current.fitBounds(bounds, { padding: [30, 30] });
                        mapBounds.current = bounds;

                    }
                }
            });
        }
`;

content = content.replace(/\/\/ Init Map[\s\S]*?if \(mapInstance\.current && bounds\.isValid\(\)\) {[\s\S]*?mapInstance\.current\.fitBounds\(bounds, { padding: \[30, 30\] }\);[\s\S]*?mapBounds\.current = bounds;[\s\S]*?}[\s\S]*?}/, mapInitBlock);


fs.writeFileSync('src/components/blog/RouteSlicePreview.tsx', content);
