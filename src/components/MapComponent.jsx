import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useGeo, useUserData } from '../globalContext';
import { PinEditor } from './PinEditor';
import { FabButton } from './FabButton';
import StationMenu from './StationMenu';
import { findNearestPointOnLine } from '../utils/routeFinder';

// Fix Leaflet icons (standard fix)
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl, iconUrl, shadowUrl
});

export default function MapComponent() {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const pinsLayer = useRef(null);
    const baseLinesLayer = useRef(null);
    const baseStationsLayer = useRef(null);
    const routeLayer = useRef(null);
    const railLayerRef = useRef(null);
    const isDraggingRef = useRef(false);

    const { geoData, railwayData, getAllGeometries, pinMode, setPinMode } = useGeo();
    const { trips, pins, setPins, saveData } = useUserData();

    const [mapZoom, setMapZoom] = useState(10);
    const [editingPin, setEditingPin] = useState(null);
    const [stationMenu, setStationMenu] = useState(null);

    // --- Map Initialization ---
    useEffect(() => {
        if (!mapRef.current || mapInstance.current) return;
        const map = L.map(mapRef.current, { zoomControl: true, preferCanvas: true }).setView([35.68, 139.76], 10);

        const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 20 });
        const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 20 });
        const rail = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { maxZoom: 20, opacity: 0, attribution: '© OpenRailwayMap' });
        railLayerRef.current = rail;

        dark.addTo(map); rail.addTo(map);
        L.control.layers({ "标准 (light)": light, "暗色 (Dark)": dark }, { "详细配线图 (OpenRailwayMap)": rail }, { position: 'topright' }).addTo(map);

        // Layers
        baseLinesLayer.current = L.layerGroup(); // Not added initially
        baseStationsLayer.current = L.layerGroup().addTo(map);
        routeLayer.current = L.layerGroup().addTo(map);
        pinsLayer.current = L.layerGroup().addTo(map);

        mapInstance.current = map;

        // Events
        const updateLayerVisibility = () => {
            const z = map.getZoom();
            if (railLayerRef.current) railLayerRef.current.setOpacity(z >= 15 ? 0.7 : (z>=12 ? 0.4 : 0));

            // Base Lines Logic
            const showBaseLines = z >= 10 && z < 12;
            if (baseLinesLayer.current) {
                if (showBaseLines) {
                     if (!map.hasLayer(baseLinesLayer.current)) {
                         map.addLayer(baseLinesLayer.current);
                         baseLinesLayer.current.invoke('bringToBack');
                     }
                } else {
                     if (map.hasLayer(baseLinesLayer.current)) map.removeLayer(baseLinesLayer.current);
                }
            }
            setMapZoom(z);
        };

        map.on('zoomend', updateLayerVisibility);
        updateLayerVisibility();

        map.on('click', (e) => {
            // Need to access current state in event listener?
            // Leaflet event listeners are closures.
            // But we use state setters so it's fine.
            // BUT checking `pinMode` here might be stale.
            // Using ref for mutable interaction state is safer or use functional update if logic allows.
            // Actually, we can just rely on `map.on('click')` triggering a state update.
            // But to read `pinMode`, we need it.
            // Let's use a ref for pinMode just in case, or re-bind.
            // React effect re-binding `map.on` on every render is bad for Leaflet.
            // Better to use a Ref for current interaction mode.
        });
    }, []);

    // Sync Ref for Event Handler
    const pinModeRef = useRef(pinMode);
    useEffect(() => { pinModeRef.current = pinMode; }, [pinMode]);
    const editingPinRef = useRef(editingPin);
    useEffect(() => { editingPinRef.current = editingPin; }, [editingPin]);

    useEffect(() => {
        if (!mapInstance.current) return;
        const map = mapInstance.current;

        // Remove old click to avoid duplicates if re-running (which we shouldn't if dep array is empty, but we need to update closure)
        map.off('click');
        map.on('click', (e) => {
             const mode = pinModeRef.current;
             const editPin = editingPinRef.current;

             if (mode !== 'idle' && editPin) {
                let newPos = { lat: e.latlng.lat, lng: e.latlng.lng };
                if (mode === 'snap') {
                    // Need railwayData.
                    // Ref access to railwayData? Or just use closure?
                    // RailwayData changes rarely. We can re-bind.
                    // But `findNearestPointOnLine` is heavy? No, it's fast enough.
                    // Accessing `railwayData` from closure here might be stale if `railwayData` changes.
                    // But `useEffect` below re-renders.
                    // To avoid stale closure hell, use a ref for railwayData too.
                }
                setEditingPin(prev => ({ ...prev, ...newPos }));
                // Snap logic is handled in `editingPin` effect or here?
                // Original code did it here.
                // We'll rely on the `useEffect` [railwayData] updating the ref.
             } else {
                setStationMenu(null);
             }
        });
    }, []); // Empty dep, only setup once. But handler needs access to fresh data.

    // Solution: Use a mutable Ref to hold "current interaction context"
    const contextRef = useRef({ railwayData, pinMode, editingPin });
    useEffect(() => { contextRef.current = { railwayData, pinMode, editingPin }; }, [railwayData, pinMode, editingPin]);

    useEffect(() => {
        if (!mapInstance.current) return;
        const map = mapInstance.current;
        const handler = (e) => {
            const { railwayData, pinMode, editingPin } = contextRef.current;
            if (pinMode !== 'idle' && editingPin) {
                let newPos = { lat: e.latlng.lat, lng: e.latlng.lng };
                if (pinMode === 'snap') {
                     const snap = findNearestPointOnLine(railwayData, newPos.lat, newPos.lng);
                     if (snap) newPos = { lat: snap.lat, lng: snap.lng, lineKey: snap.lineKey, percentage: snap.percentage };
                }
                setEditingPin(prev => ({ ...prev, ...newPos }));
            } else {
                setStationMenu(null);
            }
        };
        map.off('click');
        map.on('click', handler);
    }, []); // Only bind once? No, if we use contextRef, we can bind once.


    // --- Render Base Map ---
    useEffect(() => {
        if (!mapInstance.current || !geoData || !baseLinesLayer.current) return;
        const lines = baseLinesLayer.current;
        const stations = baseStationsLayer.current;
        lines.clearLayers();
        stations.clearLayers();

        L.geoJSON(geoData, {
            filter: (f) => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString',
            style: { color: '#475569', weight: 1, opacity: 0.3 },
            onEachFeature: (f, l) => f.properties.name && l.bindTooltip(f.properties.name)
        }).addTo(lines);

        L.geoJSON(geoData, {
            filter: (f) => f.properties.type === 'station',
            pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 4, color: 'transparent', fillColor: '#64748b', fillOpacity: 0.5, weight: 0, className: 'station-dot' }),
            onEachFeature: (f, l) => {
                if (f.properties.name) l.bindTooltip(f.properties.name);
                l.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    const { originalEvent } = e;
                    const x = originalEvent.clientX || (originalEvent.touches ? originalEvent.touches[0].clientX : 0);
                    const y = originalEvent.clientY || (originalEvent.touches ? originalEvent.touches[0].clientY : 0);
                    setStationMenu({ x, y, stationData: { name_ja: f.properties.name, id: f.properties.id, line: f.properties.line } });
                });
            }
        }).addTo(stations);

        // Refresh zoom visibility logic
        mapInstance.current.fire('zoomend');
    }, [geoData]);

    // --- Render Trip Routes (Async) ---
    useEffect(() => {
        if (!mapInstance.current || !trips || !routeLayer.current) return;

        // Call Worker
        let active = true;
        getAllGeometries(trips).then(geoms => {
            if (!active) return;
            const layer = routeLayer.current;
            layer.clearLayers();

            const zoomWeight = mapZoom < 8 ? 2 : mapZoom < 12 ? 4 : mapZoom < 15 ? 6 : 9;

            geoms.forEach(g => {
                const options = {
                    color: g.color || '#38bdf8',
                    weight: zoomWeight,
                    opacity: 0.9,
                    lineCap: 'round',
                    smoothFactor: 0.2
                };
                if (g.isMulti) {
                    g.coords.forEach(part => L.polyline(part, options).bindPopup(g.popup).addTo(layer));
                } else {
                    L.polyline(g.coords, options).bindPopup(g.popup).addTo(layer);
                }
            });
        });
        return () => { active = false; };
    }, [trips, mapZoom, getAllGeometries]);

    // --- Render Pins ---
    useEffect(() => {
        if (!mapInstance.current || !pinsLayer.current) return;
        const layer = pinsLayer.current;
        layer.clearLayers();
        const list = editingPin ? [...pins.filter(p => p.id !== editingPin.id), editingPin] : pins;

        list.forEach(pin => {
             const isEditing = editingPin?.id === pin.id;
             const html = `<div class="pin-content ${isEditing ? 'dragging' : ''}" style="background:${pin.color}; border-color:${isEditing?'#ffff00':'white'}; transform:${isEditing?'scale(1.2) rotate(45deg)':''}"> ${pin.type==='photo'?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>':'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'} </div>`;
             const icon = L.divIcon({ className: 'pin-marker-icon', html, iconSize: [32, 32], iconAnchor: [16, 32] });
             const marker = L.marker([pin.lat, pin.lng], { icon, draggable: true, zIndexOffset: isEditing ? 1000 : 0 });

             marker.on('dragstart', () => {
                 isDraggingRef.current = true;
                 setEditingPin({ ...pin });
                 if (pinMode === 'idle') setPinMode('free');
             });
             marker.on('dragend', (e) => {
                  isDraggingRef.current = false;
                  const { lat, lng } = e.target.getLatLng();
                  let newPos = { lat, lng };
                  const currentContext = contextRef.current; // access fresh context via ref
                  if (currentContext.pinMode === 'snap') {
                       const snap = findNearestPointOnLine(currentContext.railwayData, lat, lng);
                       if (snap) newPos = { lat: snap.lat, lng: snap.lng, lineKey: snap.lineKey, percentage: snap.percentage };
                       e.target.setLatLng(newPos);
                  }
                  setEditingPin(prev => prev && prev.id === pin.id ? { ...prev, ...newPos } : { ...pin, ...newPos });
                  if (currentContext.pinMode === 'idle') setPinMode('free');
             });
             marker.on('click', () => {
                 setEditingPin(pin);
                 if (pinMode === 'idle') setPinMode('free');
             });
             marker.addTo(layer);
        });

    }, [pins, editingPin, pinMode]); // We need pinMode here for re-rendering if it affects styles, but pin render depends on editingPin state mainly.


    // --- Actions ---
    const togglePinMode = () => {
        if (pinMode === 'idle') { setPinMode('free'); createTempPin(); }
        else if (pinMode === 'free') { setPinMode('snap'); if(editingPin) { const snap = findNearestPointOnLine(railwayData, editingPin.lat, editingPin.lng); setEditingPin({...editingPin, ...snap}); } }
        else { setPinMode('idle'); setEditingPin(null); }
    };

    const createTempPin = () => {
        if (!mapInstance.current) return;
        const c = mapInstance.current.getCenter();
        setEditingPin({ id: 'temp', lat: c.lat, lng: c.lng, type: 'photo', color: COLOR_PALETTE[0], isTemp: true });
        mapInstance.current.panBy([0, 150]);
    };

    const savePin = () => {
        if (!editingPin) return;
        const newPin = { ...editingPin, id: editingPin.isTemp ? Date.now() : editingPin.id };
        delete newPin.isTemp;
        const newPins = editingPin.isTemp ? [...pins, newPin] : pins.map(p => p.id === newPin.id ? newPin : p);
        saveData(null, newPins, null, null);
        setEditingPin(null);
        setPinMode('idle');
    };

    const deletePin = (id) => {
        if(confirm('删除?')) {
            const newPins = pins.filter(p => p.id !== id);
            saveData(null, newPins, null, null);
            if (editingPin?.id === id) setEditingPin(null);
        }
    };

    return (
        <div className="w-full h-full">
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

            <FabButton pinMode={pinMode} togglePinMode={togglePinMode} />

            <PinEditor
                editingPin={editingPin}
                setEditingPin={setEditingPin}
                pinMode={pinMode}
                setPinMode={setPinMode}
                deletePin={deletePin}
                savePin={savePin}
            />

            {stationMenu && (
                <StationMenu
                    position={stationMenu}
                    stationData={stationMenu.stationData}
                    railwayData={railwayData}
                    onClose={() => setStationMenu(null)}
                />
            )}
        </div>
    );
}
