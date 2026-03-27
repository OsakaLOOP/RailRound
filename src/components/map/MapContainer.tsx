import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useStore, PinMode, StationMenuData, CustomFeatureCollection, CustomGeoJSONFeature } from '../../store';
import { findNearestPointOnLine } from '../../utils/railwayRouting';
import { syncLeafletLayerGroup } from '../../utils/leafletSync';
import { useShallow } from 'zustand/react/shallow';

interface Props {
    setStationMenu: (menu: StationMenuData | null) => void;
    isDraggingRef: React.MutableRefObject<boolean>;
}

export const MapContainer: React.FC<Props> = ({ setStationMenu, isDraggingRef }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<L.Map | null>(null);
    const pinsLayer = useRef<L.LayerGroup | null>(null);
    const baseLinesLayer = useRef<L.LayerGroup | null>(null);
    const baseStationsLayer = useRef<L.LayerGroup | null>(null);
    const routeLayer = useRef<L.LayerGroup | null>(null);
    const railLayerRef = useRef<L.TileLayer | null>(null);
    const [isMapInitialized, setIsMapInitialized] = React.useState(false);

    const {
        geoData, leafletReady, tripSegmentsGeometry, activeTab, mapZoom,
        setMapZoom, setLeafletReady, pins, editingPin, pinMode, railwayData,
        setEditingPin, setPinMode
    } = useStore(useShallow(state => ({
        geoData: state.geoData,
        leafletReady: state.leafletReady,
        tripSegmentsGeometry: state.tripSegmentsGeometry,
        activeTab: state.activeTab,
        mapZoom: state.mapZoom,
        setMapZoom: state.setMapZoom,
        setLeafletReady: state.setLeafletReady,
        pins: state.pins,
        editingPin: state.editingPin,
        pinMode: state.pinMode,
        railwayData: state.railwayData,
        setEditingPin: state.setEditingPin,
        setPinMode: state.setPinMode
    })));

    useEffect(() => {
        setLeafletReady(true);
    }, [setLeafletReady]);

    useEffect(() => {
        if (activeTab === 'map' && leafletReady) {
            setTimeout(initMap, 100);
            setTimeout(() => { mapInstance.current?.invalidateSize(); }, 200);
        }
    }, [activeTab, leafletReady]);

    useEffect(() => {
        if (isMapInitialized && leafletReady && geoData) renderBaseMap(geoData);
    }, [geoData, leafletReady, isMapInitialized]);

    useEffect(() => {
        if (isMapInitialized && leafletReady && tripSegmentsGeometry) {
            renderTripRoutes();
        }
    }, [tripSegmentsGeometry, leafletReady, mapZoom, isMapInitialized]);

    useEffect(() => {
        if (isMapInitialized && leafletReady && !isDraggingRef.current) renderPins();
    }, [pins, editingPin, pinMode, leafletReady, isMapInitialized]);

    const initMap = () => {
        if (!mapRef.current || mapInstance.current ) return;
        const map = L.map(mapRef.current, { zoomControl: true, preferCanvas: true }).setView([35.68, 139.76], 10);
        const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', { attribution: '© CARTO', subdomains: ['a','b','c','d'], maxZoom: 20 });
        const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: ['a','b','c','d'], maxZoom: 20 });
        const rail = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { maxZoom: 20, opacity: 0, attribution: '© OpenRailwayMap' });
        railLayerRef.current = rail;

        dark.addTo(map); rail.addTo(map);
        L.control.layers({ "标准 (light)": light, "暗色 (Dark)": dark }, { "详细配线图 (OpenRailwayMap)": rail }, { position: 'topright' }).addTo(map);
        mapInstance.current = map;

        baseLinesLayer.current = L.layerGroup();
        baseStationsLayer.current = L.layerGroup().addTo(map);
        routeLayer.current = L.layerGroup().addTo(map);
        pinsLayer.current = L.layerGroup().addTo(map);

        const updateLayerVisibility = () => {
            const z = map.getZoom();
            if (railLayerRef.current) railLayerRef.current.setOpacity(z >= 15 ? 0.7 : (z>=12 ? 0.4 : 0));
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

        map.on('click', (e: L.LeafletMouseEvent) => {
            const currentPinMode = useStore.getState().pinMode;
            const currentEditingPin = useStore.getState().editingPin;

            if (currentPinMode !== PinMode.Idle && currentEditingPin) {
                let newPos = { lat: e.latlng.lat, lng: e.latlng.lng, lineKey: currentEditingPin.lineKey, percentage: currentEditingPin.percentage };
                if (currentPinMode === PinMode.Snap) {
                    const snap = findNearestPointOnLine(useStore.getState().railwayData, newPos.lat, newPos.lng);
                    newPos = { ...newPos, ...snap };
                }
                setEditingPin({ ...currentEditingPin, ...newPos });
            } else {
                setStationMenu(null);
            }
        });

        setIsMapInitialized(true);
    };

    const renderedFeatureIds = useRef<Set<string>>(new Set());

    const renderBaseMap = (data: CustomFeatureCollection) => {
        if (!baseLinesLayer.current || !baseStationsLayer.current) return;

        // Base map features almost never get removed during a session, they only get appended.
        // To drastically reduce CPU traversal overhead when geoData updates, filter for new items first.
        const newFeatures = data.features.filter(f => {
            const id = f.properties.id || `${f.properties.company}:${f.properties.name || f.properties.line}`;
            if (renderedFeatureIds.current.has(id)) return false;
            renderedFeatureIds.current.add(id);
            return true;
        });

        if (newFeatures.length === 0) return; // Nothing new to render, bypass entirely

        // Base Lines (Only append new features)
        const lineFeatures = newFeatures.filter((f: CustomGeoJSONFeature) => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');

        lineFeatures.forEach(f => {
             const layer = L.geoJSON(f as any, {
                 style: { color: '#475569', weight: 1, opacity: 0.3 }
             });
             if (f.properties.name) layer.bindTooltip(f.properties.name);

             // Directly add instead of syncing, since we already filtered
             if (baseLinesLayer.current) baseLinesLayer.current.addLayer(layer);
        });

        // Base Stations (Only append new features)
        const stationFeatures = newFeatures.filter((f: CustomGeoJSONFeature) => f.properties.type === 'station');

        stationFeatures.forEach(f => {
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

            // Directly add instead of syncing
            if (baseStationsLayer.current) baseStationsLayer.current.addLayer(layer);
        });
    };

    const renderTripRoutes = () => {
        if (!routeLayer.current || !tripSegmentsGeometry) return;

        const currentZoom = useStore.getState().mapZoom;
        const zoomWeight = currentZoom < 8 ? 2 : currentZoom < 12 ? 4 : currentZoom < 15 ? 6 : 9;

        interface RouteItem { id: string, coords: any[], color: string, popup: string, fallback: boolean }
        const routeItems: RouteItem[] = [];

        tripSegmentsGeometry.forEach((seg: any) => {
            if (seg.isMulti) {
                seg.coords.forEach((part: any[], index: number) => {
                    routeItems.push({ id: `${seg.id}_part_${index}`, coords: part, color: seg.color, popup: seg.popup, fallback: seg.fallback });
                });
            } else {
                routeItems.push({ id: seg.id, coords: seg.coords, color: seg.color, popup: seg.popup, fallback: seg.fallback });
            }
        });

        syncLeafletLayerGroup<RouteItem>(
            routeLayer.current,
            routeItems,
            (item) => item.id,
            (item) => {
                const options = { color: item.color, weight: zoomWeight, opacity: 0.9, lineCap: 'round', smoothFactor: 0.2, dashArray: item.fallback ? '5, 10' : undefined };
                const pl = L.polyline(item.coords, options as L.PolylineOptions).bindPopup(item.popup);
                (pl as any)._cachedCoords = item.coords;
                return pl;
            },
            (layer, item) => {
                const pl = layer as L.Polyline & { _cachedCoords?: any[] };

                // setLatLngs is an extremely expensive operation in Leaflet.
                // Only call it if the coordinates actually changed (reference check).
                if (pl._cachedCoords !== item.coords) {
                    pl.setLatLngs(item.coords);
                    pl._cachedCoords = item.coords;
                }

                // setStyle triggers DOM updates. Check before applying.
                const currentWeight = (pl.options as L.PolylineOptions).weight;
                const currentColor = (pl.options as L.PolylineOptions).color;
                const currentDash = (pl.options as L.PolylineOptions).dashArray;
                const targetDash = item.fallback ? '5, 10' : undefined;

                if (currentWeight !== zoomWeight || currentColor !== item.color || currentDash !== targetDash) {
                    pl.setStyle({ color: item.color, weight: zoomWeight, dashArray: targetDash });
                }

                if(pl.getPopup()?.getContent() !== item.popup) {
                    pl.bindPopup(item.popup);
                }
            }
        );
    };

    const renderPins = () => {
        if (!pinsLayer.current) return;

        const list = editingPin ? [...pins.filter(p => p.id !== editingPin.id), editingPin] : pins;

        syncLeafletLayerGroup(
            pinsLayer.current,
            list,
            (pin) => pin.id,
            (pin) => {
                const isEditing = editingPin?.id === pin.id;
                const icon = L.divIcon({ className: 'pin-marker-icon', html: `<div class="pin-content ${isEditing ? 'dragging' : ''}" style="background:${pin.color}; border-color:${isEditing?'#ffff00':'white'}; transform:${isEditing?'scale(1.2) rotate(45deg)':''}"> ${pin.type==='photo'?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>':'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'} </div>`, iconSize: [32, 32], iconAnchor: [16, 32] });

                const marker = L.marker([pin.lat, pin.lng], { icon, draggable: true, zIndexOffset: isEditing ? 1000 : 0 });
                marker.on('dragstart', () => {
                    isDraggingRef.current = true;
                    setEditingPin({ ...pin });
                    if (pinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });
                marker.on('dragend', (e) => {
                    isDraggingRef.current = false;
                    const { lat, lng } = e.target.getLatLng();
                    let newPos = { lat, lng, lineKey: pin.lineKey, percentage: pin.percentage };
                    if (pinMode === PinMode.Snap) {
                        const snap = findNearestPointOnLine(useStore.getState().railwayData, lat, lng);
                        newPos = { ...newPos, ...snap };
                        e.target.setLatLng(newPos);
                    }
                    setEditingPin((prev) => prev && prev.id === pin.id ? { ...prev, ...newPos } : { ...pin, ...newPos });
                    if (pinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });
                marker.on('click', () => {
                    setEditingPin(pin);
                    if (pinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });
                return marker;
            },
            (layer, pin) => {
                const marker = layer as L.Marker & { _cachedLat?: number, _cachedLng?: number, _cachedIsEditing?: boolean, _cachedColor?: string };
                const isEditing = editingPin?.id === pin.id;

                if (marker._cachedLat !== pin.lat || marker._cachedLng !== pin.lng) {
                    marker.setLatLng([pin.lat, pin.lng]);
                    marker._cachedLat = pin.lat;
                    marker._cachedLng = pin.lng;
                }

                if (marker._cachedIsEditing !== isEditing || marker._cachedColor !== pin.color) {
                    const icon = L.divIcon({ className: 'pin-marker-icon', html: `<div class="pin-content ${isEditing ? 'dragging' : ''}" style="background:${pin.color}; border-color:${isEditing?'#ffff00':'white'}; transform:${isEditing?'scale(1.2) rotate(45deg)':''}"> ${pin.type==='photo'?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>':'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'} </div>`, iconSize: [32, 32], iconAnchor: [16, 32] });
                    marker.setIcon(icon);
                    marker.setZIndexOffset(isEditing ? 1000 : 0);

                    marker._cachedIsEditing = isEditing;
                    marker._cachedColor = pin.color;
                }
            }
        );
    };

    return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />;
};
