import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useStore, PinMode, StationMenuData, CustomFeatureCollection, CustomGeoJSONFeature } from '../../store';
import { findNearestPointOnLine } from '../../utils/railwayRouting';
import { syncLeafletLayerGroup } from '../../utils/leafletSync';

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

    const {
        geoData, leafletReady, tripSegmentsGeometry, activeTab, mapZoom,
        setMapZoom, setLeafletReady, pins, editingPin, pinMode, railwayData,
        setEditingPin, setPinMode
    } = useStore(state => ({
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
    }));

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
        if (mapInstance.current && leafletReady && geoData) renderBaseMap(geoData);
    }, [geoData, leafletReady]);

    useEffect(() => {
        if (mapInstance.current && leafletReady && tripSegmentsGeometry) {
            renderTripRoutes();
        }
    }, [tripSegmentsGeometry, leafletReady, mapZoom]);

    useEffect(() => {
        if (mapInstance.current && leafletReady && !isDraggingRef.current) renderPins();
    }, [pins, editingPin, pinMode, leafletReady]);

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
    };

    const renderBaseMap = (data: CustomFeatureCollection) => {
        if (!baseLinesLayer.current || !baseStationsLayer.current) return;

        // Base Lines
        const lineFeatures = data.features.filter((f: CustomGeoJSONFeature) => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
        syncLeafletLayerGroup<CustomGeoJSONFeature>(
            baseLinesLayer.current,
            lineFeatures,
            (f) => f.properties.id || `${f.properties.company}:${f.properties.name}`,
            (f) => {
                const layer = L.geoJSON(f as any, {
                    style: { color: '#475569', weight: 1, opacity: 0.3 }
                });
                if (f.properties.name) layer.bindTooltip(f.properties.name);
                return layer;
            },
            (layer, f) => {
                // Lines are largely static
            }
        );

        // Base Stations
        const stationFeatures = data.features.filter((f: CustomGeoJSONFeature) => f.properties.type === 'station');
        syncLeafletLayerGroup<CustomGeoJSONFeature>(
            baseStationsLayer.current,
            stationFeatures,
            (f) => f.properties.id || `${f.properties.company}:${f.properties.line}:${f.properties.name}`,
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
        );
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
                return L.polyline(item.coords, options as L.PolylineOptions).bindPopup(item.popup);
            },
            (layer, item) => {
                const pl = layer as L.Polyline;
                pl.setLatLngs(item.coords);
                pl.setStyle({ color: item.color, weight: zoomWeight, dashArray: item.fallback ? '5, 10' : undefined });
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
                const marker = layer as L.Marker;
                const isEditing = editingPin?.id === pin.id;
                const icon = L.divIcon({ className: 'pin-marker-icon', html: `<div class="pin-content ${isEditing ? 'dragging' : ''}" style="background:${pin.color}; border-color:${isEditing?'#ffff00':'white'}; transform:${isEditing?'scale(1.2) rotate(45deg)':''}"> ${pin.type==='photo'?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>':'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'} </div>`, iconSize: [32, 32], iconAnchor: [16, 32] });

                marker.setLatLng([pin.lat, pin.lng]);
                marker.setIcon(icon);
                marker.setZIndexOffset(isEditing ? 1000 : 0);
            }
        );
    };

    return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />;
};
