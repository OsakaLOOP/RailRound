import * as React from 'react';
const { useEffect, useState, useRef } = React;


import { fetchAndParseData } from '../../../../src/utils/fetchAndParseData';
import { findRoute } from '../../../../src/core/railwayRouting';
import { calcDist } from '../../../../src/core/tripCalculator';
import { MapPin, ArrowRight, RotateCcw } from 'lucide-react';
import { ErrorBoundary } from '../../../../src/components/common/ErrorBoundary';
import { cachedTileLayer } from '../../../../src/utils/CachedTileLayer';
import { useTranslation } from 'react-i18next';

interface Props {
    lineKey: string;
    startStation: string;
    endStation: string;
}

export const RouteSlicePreview: React.FC<Props> = ({ lineKey, startStation, endStation }) => {
    const { t } = useTranslation();
    const [data, setData] = useState<{ stations: any[], distance: string, time: string } | null>(null);
    const mapBounds = useRef<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<any>(null);
    const routeLayer = useRef<any>(null);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            try {
                const { railwayData, geoData } = await fetchAndParseData();
                if (!mounted) return;

                if (!railwayData || !railwayData[lineKey]) {
                    throw new Error(t('routeNotFound', { key: lineKey }));
                }

                const line = railwayData[lineKey];
                const startNode = line.stations.find((s: any) => s.name_ja === startStation || s.name_en === startStation);
                const endNode = line.stations.find((s: any) => s.name_ja === endStation || s.name_en === endStation);

                if (!startNode || !endNode) {
                    throw new Error(t('routeNotFound', { key: `${startStation} -> ${endStation}` }));
                }

                const result = findRoute(lineKey, startNode.id, lineKey, endNode.id, railwayData, 0);
                if (!result || result.error || !result.segments) {
                    throw new Error(result?.error || t('routeNotFound'));
                }

                const routeSegments = result.segments;
                // findRoute segments logic: returns array of { lineKey, from, to, path: [...] }
                const stationSequence = routeSegments.flatMap((seg: any) => seg.path.map((p: any) => p.station));

                // Deduplicate consecutive stations
                const uniqueSequence = stationSequence.filter((st: any, i: number, arr: any[]) => i === 0 || st.id !== arr[i-1].id);

                let totalDist = 0;
                for (let i = 0; i < uniqueSequence.length - 1; i++) {
                    const st1 = uniqueSequence[i];
                    const st2 = uniqueSequence[i+1];
                    totalDist += calcDist(st1.lat, st1.lng, st2.lat, st2.lng);
                }
                const estimatedTime = (totalDist / 80) * 60 + (uniqueSequence.length * 1.5); // 80km/h avg + 1.5min stop

                setData({
                    stations: uniqueSequence,
                    distance: totalDist.toFixed(1),
                    time: estimatedTime.toFixed(0),

                });
            } catch (e: any) {
                if (mounted) setError(e.message);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        return () => {
            mounted = false;
        };
    }, [lineKey, startStation, endStation, t]);

    useEffect(() => {
        if (!data || loading || error || !mapRef.current) return;


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

    }, [data, loading, error]);

    useEffect(() => {
        return () => {
            if (mapInstance.current) {
                mapInstance.current.remove();
                mapInstance.current = null;
                routeLayer.current = null;
            }
        };
    }, []);

    const handleResetView = () => {
        if (mapInstance.current && mapBounds.current) {
            if (mapBounds.current) { mapInstance.current.fitBounds(mapBounds.current, { padding: [30, 30] }); }
        }
    };



    return (
        <ErrorBoundary>
            <div className="my-8 border border-slate-200/60 rounded-2xl overflow-hidden bg-white shadow-lg shadow-slate-200/20 font-sans not-prose transition-all hover:shadow-xl flex flex-col h-[400px]">
                <div className="bg-slate-50/90 backdrop-blur-md p-4 border-b border-slate-200/80 flex justify-between items-center z-[1000] relative">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1.5 flex items-center gap-1">
                            <MapPin size={10} className="text-[#39C5BB]"/> {t('routeSlicePreview')}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-sm">
                                {lineKey.split(':')[1] || lineKey}
                            </span>
                            <span className="text-xs text-slate-500 font-medium bg-slate-100/80 px-2.5 py-0.5 rounded-md border border-slate-200/80 flex items-center">
                                {startStation} <ArrowRight size={12} className="mx-1 text-slate-400" /> {endStation}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col items-end gap-1.5">
                            <span className="text-xs font-bold text-[#39C5BB] bg-[#39C5BB]/10 border border-[#39C5BB]/20 px-2.5 py-0.5 rounded-md shadow-sm">
                                {data.distance} km
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 tracking-wide uppercase">
                                Est. {data.time} min
                            </span>
                        </div>
                        <button
                            onClick={handleResetView}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                            title={t('resetView')}
                        >
                            <RotateCcw size={16} />
                        </button>
                    </div>
                </div>


                <div className="flex-1 relative bg-slate-50">
                    <div ref={mapRef} className="absolute inset-0 z-0"></div>

                    {loading && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                            <div className="p-4 border border-slate-200 rounded-xl bg-white text-slate-500 shadow-sm animate-pulse text-sm">
                                {t('loadingRoute', { key: lineKey, start: startStation, end: endStation })}
                            </div>
                        </div>
                    )}

                    {(error || (!loading && !data)) && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                            <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-500 text-sm shadow-sm max-w-md text-center">
                                {t('parseFail')} {error}
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </ErrorBoundary>
    );
};
