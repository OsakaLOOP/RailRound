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
    const geoDataRef = useRef<CustomFeatureCollection | null>(null);
    const visitedStationsRef = useRef<Set<string>>(new Set());
    const routeLayer = useRef<L.LayerGroup | null>(null);
    const railLayerRef = useRef<L.TileLayer | null>(null);
    const rubberBandLayerRef = useRef<L.LayerGroup | null>(null);

    // For local long-press routing drag
    const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const routeDragRef = useRef<{ active: boolean, startStation: CustomGeoJSONFeature | null, currentSnap: CustomGeoJSONFeature | null, rubberLine: L.Polyline | null, snapCircleCenter: L.CircleMarker | null }>({ active: false, startStation: null, currentSnap: null, rubberLine: null, snapCircleCenter: null });
    const wasDraggingRef = useRef(false);

    const [isMapInitialized, setIsMapInitialized] = React.useState(false);

    const {
        geoData, leafletReady, tripSegmentsGeometry, activeTab, mapZoom,
        setMapZoom, setLeafletReady, pins, editingPin, pinMode, railwayData,
        setEditingPin, setPinMode, visitedStations
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
        setPinMode: state.setPinMode,
        visitedStations: state.visitedStations
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
    }, [geoData, leafletReady, isMapInitialized, visitedStations]);

    useEffect(() => {
        if (isMapInitialized && leafletReady && tripSegmentsGeometry) {
            renderTripRoutes();
        }
    }, [tripSegmentsGeometry, leafletReady, mapZoom, isMapInitialized]);

    useEffect(() => {
        if (isMapInitialized && leafletReady && !isDraggingRef.current) renderPins();
    }, [pins, editingPin, pinMode, leafletReady, isMapInitialized]);

    useEffect(() => {
        const handleCreateTempPin = () => {
            if (!mapInstance.current) return;
            const c = mapInstance.current.getCenter();
            setEditingPin({ id: 'temp', lat: c.lat, lng: c.lng, type: 'photo', color: '#ef4444', isTemp: true } as any);
            mapInstance.current.panBy([0, 150]);
        };
        window.addEventListener('map:create-temp-pin', handleCreateTempPin);
        return () => window.removeEventListener('map:create-temp-pin', handleCreateTempPin);
    }, [setEditingPin]);

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
        rubberBandLayerRef.current = L.layerGroup().addTo(map);

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

        // Listen to moveend to update stations with new bounds
        map.on('moveend', () => {
            renderStations();
        });

        map.on('click', (e: L.LeafletMouseEvent) => {
            if (wasDraggingRef.current) {
                wasDraggingRef.current = false;
                return;
            }

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

        // Global mouse/touch move and up listeners for localized drag
        const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
            if (!routeDragRef.current.active || !routeDragRef.current.startStation || !rubberBandLayerRef.current) return;

            const startStation = routeDragRef.current.startStation;
            const startLat = startStation.geometry.coordinates[1];
            const startLng = startStation.geometry.coordinates[0];

            let clientX, clientY;
            if ('touches' in e) {
                clientX = (e as TouchEvent).touches[0].clientX;
                clientY = (e as TouchEvent).touches[0].clientY;
            } else {
                clientX = (e as MouseEvent).clientX;
                clientY = (e as MouseEvent).clientY;
            }

            const mapRect = map.getContainer().getBoundingClientRect();
            const containerPoint = L.point(clientX - mapRect.left, clientY - mapRect.top);
            const mouseLatLng = map.containerPointToLatLng(containerPoint);

            let nearestDist = Infinity;
            let nearestStation: any = null;
            let nearestLatLng: L.LatLng | null = null;

            if (geoDataRef.current) {
                geoDataRef.current.features.forEach((f: any) => {
                    if (f.properties.type === 'station' && f.geometry?.coordinates) {
                        const lat = f.geometry.coordinates[1];
                        const lng = f.geometry.coordinates[0];
                        // Skip the start station itself
                        if (f.properties.name === startStation.properties.name && f.properties.line === startStation.properties.line) return;

                        const stPoint = map.latLngToContainerPoint([lat, lng]);
                        const dist = containerPoint.distanceTo(stPoint);

                        if (dist < 40 && dist < nearestDist) {
                            nearestDist = dist;
                            nearestStation = f;
                            nearestLatLng = L.latLng(lat, lng);
                        }
                    }
                });
            }

            routeDragRef.current.currentSnap = nearestStation;

            const rubberLine = routeDragRef.current.rubberLine;
            const snapCircleCenter = routeDragRef.current.snapCircleCenter;

            if (rubberLine && snapCircleCenter) {
                if (nearestStation && nearestLatLng) {
                    rubberLine.setLatLngs([[startLat, startLng], nearestLatLng]);
                    snapCircleCenter.setLatLng(nearestLatLng).setStyle({ opacity: 1, fillOpacity: 1 });

                    // Clear fail class, add success class immediately if needed, but usually we just pulse
                    const lineElement = rubberLine.getElement();
                    if (lineElement) {
                        lineElement.classList.add('rubber-band-success');
                    }

                } else {
                    rubberLine.setLatLngs([[startLat, startLng], mouseLatLng]);
                    snapCircleCenter.setStyle({ opacity: 0, fillOpacity: 0 });
                    const lineElement = rubberLine.getElement();
                    if (lineElement) {
                        lineElement.classList.remove('rubber-band-success');
                    }
                }
            }
        };

        const handleGlobalUp = (e: MouseEvent | TouchEvent) => {
            if (pressTimerRef.current) {
                clearTimeout(pressTimerRef.current);
                pressTimerRef.current = null;

                // If the drag wasn't active, we still disabled map dragging on mousedown, so re-enable it.
                if (!routeDragRef.current.active) {
                    map.dragging.enable();
                }
            }

            if (!routeDragRef.current.active) return;

            routeDragRef.current.active = false;
            map.dragging.enable();
            wasDraggingRef.current = true; // prevent click

            const currentSnap = routeDragRef.current.currentSnap;
            const startStation = routeDragRef.current.startStation;
            const rubberLine = routeDragRef.current.rubberLine;

            if (currentSnap && startStation) {
                // Success: Snap, animate, then trigger auto-plan and fade out
                if (rubberLine) {
                    const lineElement = rubberLine.getElement();
                    if (lineElement) {
                        lineElement.classList.add('rubber-band-success');
                        lineElement.classList.remove('rubber-band-line'); // stop dash flow
                    }
                }

                setTimeout(() => {
                    const snapProps = currentSnap.properties;
                    const snapLineKey = `${snapProps.company}:${snapProps.line}`;
                    const startLineKey = `${startStation.properties.company}:${startStation.properties.line}`;

                    const startStationId = startStation.properties.id || `${startStation.properties.company}:${startStation.properties.line}:${startStation.properties.name}`;
                    const endStationId = snapProps.id || `${snapProps.company}:${snapProps.line}:${snapProps.name}`;

                    const { setEditorMode, setAutoForm, startEditingTrip } = useStore.getState();
                    setEditorMode('auto');
                    setAutoForm({
                        startLine: startLineKey,
                        startStation: startStationId,
                        endLine: snapLineKey,
                        endStation: endStationId
                    });
                    startEditingTrip();

                    if (rubberBandLayerRef.current) rubberBandLayerRef.current.clearLayers();
                    routeDragRef.current = { active: false, startStation: null, currentSnap: null, rubberLine: null, snapCircleCenter: null };
                }, 300); // Wait for success animation

            } else {
                // Fail: Animate fail and disappear
                if (rubberLine) {
                    const lineElement = rubberLine.getElement();
                    if (lineElement) {
                        lineElement.classList.add('rubber-band-fail');
                        lineElement.classList.remove('rubber-band-line');
                    }
                }

                setTimeout(() => {
                    if (rubberBandLayerRef.current) rubberBandLayerRef.current.clearLayers();
                    routeDragRef.current = { active: false, startStation: null, currentSnap: null, rubberLine: null, snapCircleCenter: null };
                }, 300);
            }
        };

        window.addEventListener('mousemove', handleGlobalMove);
        window.addEventListener('touchmove', handleGlobalMove, { passive: false });
        window.addEventListener('mouseup', handleGlobalUp);
        window.addEventListener('touchend', handleGlobalUp);

        // Store cleanup on map instance for unmounting
        (map as any)._customDragCleanup = () => {
            window.removeEventListener('mousemove', handleGlobalMove);
            window.removeEventListener('touchmove', handleGlobalMove);
            window.removeEventListener('mouseup', handleGlobalUp);
            window.removeEventListener('touchend', handleGlobalUp);
        };

        setIsMapInitialized(true);
    };

    useEffect(() => {
        return () => {
            if (mapInstance.current && (mapInstance.current as any)._customDragCleanup) {
                (mapInstance.current as any)._customDragCleanup();
            }
        };
    }, []);


    const renderStations = () => {
        if (!baseStationsLayer.current || !mapInstance.current || !geoDataRef.current) return;

        const map = mapInstance.current;
        const currentZoom = map.getZoom();

        // At zoom < 6, strictly provide empty array to clear/hide stations
        if (currentZoom < 6) {
            syncLeafletLayerGroup<CustomGeoJSONFeature>(
                baseStationsLayer.current,
                [],
                (f) => f.properties.id || `${f.properties.company}:${f.properties.line}:${f.properties.name}`,
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
            (f) => f.properties.id || `${f.properties.company}:${f.properties.line}:${f.properties.name}`,
            (f) => {
                const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number];
                const isVisited = visitedStationsRef.current.has(f.properties.id || '');
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
                layer._cachedIsVisited = isVisited;
                if (f.properties.name) layer.bindTooltip(f.properties.name);

                // @ts-ignore
                layer._cachedLat = latlng[0];
                // @ts-ignore
                layer._cachedLng = latlng[1];
                // @ts-ignore
                layer._cachedName = f.properties.name;

                const handlePointerDown = (e: L.LeafletMouseEvent) => {
                    L.DomEvent.stopPropagation(e);

                    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);

                    wasDraggingRef.current = false;
                    map.dragging.disable(); // Immediately prevent map pan

                    pressTimerRef.current = setTimeout(() => {
                        // Long press confirmed
                        wasDraggingRef.current = true; // disable click
                        routeDragRef.current.active = true;
                        routeDragRef.current.startStation = f;

                        if (rubberBandLayerRef.current) rubberBandLayerRef.current.clearLayers();

                        const startLat = f.geometry.coordinates[1];
                        const startLng = f.geometry.coordinates[0];
                        const routeColor = '#ec4899'; // default active color

                        const rubberLine = L.polyline([[startLat, startLng], [startLat, startLng]], {
                            color: routeColor,
                            weight: 6,
                            opacity: 0.8,
                            lineCap: 'round',
                            dashArray: '8, 8',
                            className: 'rubber-band-line'
                        }).addTo(rubberBandLayerRef.current!);

                        const snapCircleCenter = L.circleMarker([0,0], {
                            radius: 8,
                            color: '#fff',
                            weight: 3,
                            fillColor: routeColor,
                            fillOpacity: 1,
                            opacity: 0
                        }).addTo(rubberBandLayerRef.current!);

                        routeDragRef.current.rubberLine = rubberLine;
                        routeDragRef.current.snapCircleCenter = snapCircleCenter;

                    }, 300); // 300ms long press
                };

                const handlePointerUp = (e: L.LeafletMouseEvent) => {
                    if (pressTimerRef.current) {
                        clearTimeout(pressTimerRef.current);
                        pressTimerRef.current = null;

                        // If it wasn't a long press and active drag didn't start, re-enable dragging
                        if (!routeDragRef.current.active) {
                            map.dragging.enable();
                        }
                    }
                };

                layer.on('mousedown', handlePointerDown);
                layer.on('touchstart', handlePointerDown);
                layer.on('mouseup', handlePointerUp);
                layer.on('touchend', handlePointerUp);

                layer.on('click', (e: L.LeafletMouseEvent) => {
                    L.DomEvent.stopPropagation(e);
                    if (wasDraggingRef.current) {
                        wasDraggingRef.current = false;
                        return;
                    }

                    const originalEvent = e.originalEvent as MouseEvent | TouchEvent;
                    const x = 'clientX' in originalEvent ? originalEvent.clientX : (originalEvent as TouchEvent).touches[0].clientX;
                    const y = 'clientY' in originalEvent ? originalEvent.clientY : (originalEvent as TouchEvent).touches[0].clientY;
                    setStationMenu({ x, y, stationData: { name_ja: f.properties.name || '', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } });
                });
                return layer;
            },
            (layer, f) => {
                const marker = layer as any;
                const isVisited = visitedStationsRef.current.has(f.properties.id || '');
                const lineColor = f.properties.stroke || '#64748b';
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

                if (marker._cachedIsVisited !== isVisited) {
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

                // Do nothing else if not changed to optimize DOM updates
            }
        );
    };


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
                    const currentPinMode = useStore.getState().pinMode;
                    if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });
                marker.on('dragend', (e) => {
                    isDraggingRef.current = false;
                    const { lat, lng } = e.target.getLatLng();
                    let newPos = { lat, lng, lineKey: pin.lineKey, percentage: pin.percentage };
                    const currentPinMode = useStore.getState().pinMode;
                    if (currentPinMode === PinMode.Snap) {
                        const snap = findNearestPointOnLine(useStore.getState().railwayData, lat, lng);
                        newPos = { ...newPos, ...snap };
                        e.target.setLatLng(newPos);
                    }
                    setEditingPin((prev) => prev && prev.id === pin.id ? { ...prev, ...newPos } : { ...pin, ...newPos });
                    if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });
                marker.on('click', () => {
                    setEditingPin(pin);
                    const currentPinMode = useStore.getState().pinMode;
                    if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
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
