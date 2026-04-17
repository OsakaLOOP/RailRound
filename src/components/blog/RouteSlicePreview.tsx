import * as React from 'react';
const { useEffect, useState, useMemo } = React;
import { fetchAndParseData } from '../../utils/fetchAndParseData';
import { findRoute } from '../../core/railwayRouting';
import { calcDist } from '../../core/tripCalculator';
import { MapPin, ArrowRight } from 'lucide-react';

interface Props {
    lineKey: string;
    startStation: string;
    endStation: string;
}

export const RouteSlicePreview: React.FC<Props> = ({ lineKey, startStation, endStation }) => {
    const [data, setData] = useState<{ stations: any[], distance: string, time: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            try {
                const { railwayData, geoData } = await fetchAndParseData();
                if (!mounted) return;

                if (!railwayData || !railwayData[lineKey]) {
                    throw new Error(`无法找到线路数据: ${lineKey}`);
                }

                const line = railwayData[lineKey];
                const startNode = line.stations.find((s: any) => s.name_ja === startStation || s.name_en === startStation);
                const endNode = line.stations.find((s: any) => s.name_ja === endStation || s.name_en === endStation);

                if (!startNode || !endNode) {
                    throw new Error(`无法匹配起始或终点站: ${startStation} -> ${endStation}`);
                }

                const result = findRoute(lineKey, startNode.id, lineKey, endNode.id, railwayData, 0);
                if (!result || result.error || !result.segments) {
                    throw new Error(`无法找到可达路线: ${result?.error || 'Unknown'}`);
                }

                const routeSegments = result.segments;
                // findRoute segments logic: returns array of { lineKey, from, to, path: [...] }
                const stationSequence = routeSegments.flatMap((seg: any) => seg.path.map((p: any) => p.station));

                // Deduplicate consecutive stations
                const uniqueSequence = stationSequence.filter((st, i, arr) => i === 0 || st.id !== arr[i-1].id);

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
                    time: estimatedTime.toFixed(0)
                });
            } catch (e: any) {
                if (mounted) setError(e.message);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        return () => { mounted = false; };
    }, [lineKey, startStation, endStation]);

    if (loading) {
        return <div className="p-4 border rounded-xl bg-slate-50 text-slate-500 animate-pulse text-sm">加载路线数据中: {lineKey} ({startStation} - {endStation})...</div>;
    }

    if (error || !data) {
        return <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-500 text-sm">渲染路线切片失败: {error}</div>;
    }

    return (
        <div className="my-6 border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm font-sans not-prose">
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1">Route Slice Preview</span>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800 bg-white px-2 py-0.5 rounded border shadow-sm">
                            {lineKey.split(':')[1] || lineKey}
                        </span>
                        <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {startStation} <ArrowRight size={12} className="inline mx-0.5" /> {endStation}
                        </span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-bold text-[#39C5BB] bg-[#39C5BB]/10 px-2 py-0.5 rounded">
                        {data.distance} km
                    </span>
                    <span className="text-[10px] font-medium text-slate-400">
                        EST. {data.time} MIN
                    </span>
                </div>
            </div>

            <div className="p-6 overflow-x-auto relative" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                <div className="flex items-center min-w-max pb-4 px-2">
                    {data.stations.map((st, idx) => (
                        <div key={idx} className="flex items-center relative group cursor-default">
                            {/* Station Node */}
                            <div className="flex flex-col items-center relative z-10 w-8">
                                <div className={`w-3.5 h-3.5 rounded-full border-[3px] transition-all duration-300 relative z-20 bg-white
                                    ${(idx === 0 || idx === data.stations.length - 1)
                                        ? 'border-[#39C5BB] scale-125 shadow-sm'
                                        : 'border-slate-300 group-hover:border-[#39C5BB] group-hover:scale-110'}`}
                                />

                                {/* Hover Tooltip for Mobile/Desktop */}
                                <div className="absolute top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-30">
                                    <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap shadow-lg">
                                        {st.name_ja}
                                    </div>
                                    <div className="w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-slate-800 absolute -top-1 left-1/2 -translate-x-1/2"></div>
                                </div>

                                <span className={`absolute -top-6 text-[11px] whitespace-nowrap -rotate-45 origin-bottom-left transition-colors
                                    ${(idx === 0 || idx === data.stations.length - 1)
                                        ? 'font-bold text-slate-800'
                                        : 'text-slate-400 group-hover:text-slate-700'}`}>
                                    {st.name_ja}
                                </span>
                            </div>

                            {/* Connecting Line */}
                            {idx < data.stations.length - 1 && (
                                <div className="w-12 h-1.5 bg-slate-100 mx-0.5 relative overflow-hidden rounded-full">
                                    <div className="absolute inset-0 bg-gradient-to-r from-[#39C5BB] to-[#2dd4bf] opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
