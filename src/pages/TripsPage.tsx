import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Train, Edit2, Trash2, Star, Plus } from 'lucide-react';
import { useStore } from '../store';
import { DropZone } from '../components/DragContext';
import { getRouteVisualData } from '../utils/stats';
import { isMobile } from 'react-device-detect';
import { useShallow } from 'zustand/react/shallow';

const RouteSlice: React.FC<{ segments: any[] }> = ({ segments }) => {
    const { segmentGeometries, railwayData, geoData } = useStore(useShallow(state => ({
        segmentGeometries: state.segmentGeometries,
        railwayData: state.railwayData,
        geoData: state.geoData
    })));

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const measure = () => {
           if (containerRef.current) {
             const parent = containerRef.current.closest('.bg-white') as HTMLElement;
             if (parent) setContainerWidth(parent.offsetWidth);
           }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    const { visualPaths, totalDist, widthPx, heightPx } = useMemo(
        () => getRouteVisualData(segments, segmentGeometries, railwayData, geoData),
        [segments, segmentGeometries, railwayData, geoData]
    );

    if (visualPaths.length === 0) return <div className="w-28 shrink-0 flex items-center justify-center text-xs text-gray-200 ml-2 border-l border-gray-50">无预览</div>;

    const maxWidth = Math.max(0, containerWidth - 300);
    const shouldRotate = isMobile && widthPx > maxWidth && maxWidth > 0;

    return (
        <div ref={containerRef} className="shrink-0 ml-2 border-l border-gray-50 flex flex-row items-center justify-end pl-2 gap-2" style={{ minWidth: shouldRotate ? '40px' : '100px' }}>
            <div style={{ width: shouldRotate ? heightPx : widthPx, height: shouldRotate ? widthPx : heightPx, maxWidth: shouldRotate ? 'none' : '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="opacity-80" style={{ width: widthPx, height: heightPx, transform: shouldRotate ? 'rotate(90deg)' : 'none', transformOrigin: 'center center' }}>
                  {visualPaths.map((item: any, idx: number) => (
                      <path key={idx} d={item.path} fill="none" stroke={item.color || '#94a3b8'} strokeWidth="4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
              </svg>
            </div>
            <div className="text-[10px] font-bold text-gray-400 shrink-0 text-right">{Math.round(totalDist)}km</div>
        </div>
    );
};

export const TripsPage: React.FC = () => {
    const { trips, railwayData, isRailwayDataReady } = useStore(useShallow(state => ({
        trips: state.trips,
        railwayData: state.railwayData,
        isRailwayDataReady: state.isRailwayDataReady
    })));
    const setModalState = useStore(state => state.setModalState);
    const startEditingTrip = useStore(state => state.startEditingTrip);
    const removeTrip = useStore(state => state.removeTrip);

    return (
        <div className={`flex-1 flex flex-col overflow-y-auto p-4 space-y-3 pb-4 transition-all duration-300 ${!isRailwayDataReady ? 'opacity-50 pointer-events-none select-none blur-[1px]' : ''}`}>
            {trips.length === 0 ? (
                <div className="text-center text-gray-400 py-10 flex flex-col items-center justify-center flex-1">
                    <Train size={48} className="opacity-20 mb-4"/>
                    <p>暂无行程记录</p>
                    <p className="text-xs mt-2">点击下方按钮添加你的第一次乗り鉄<br/>注意: 自定义线路可以导入 company_data 和 geojson</p>
                </div>
            ) : (
                trips.map(t => {
                    const segments = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
                    return (
                        <div key={t.id} className="bg-white p-4 rounded-lg border shadow-sm">
                            <div className="flex justify-between mb-2 pb-2 border-b border-gray-50">
                                <span className="text-xs font-bold text-gray-400">{t.date}</span>
                                <div className="flex items-center gap-2">
                                    {(t.cost || 0) > 0 && <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">¥{t.cost}</span>}
                                    <button onClick={() => setModalState({ addToFolderModalOpen: true, currentTripForFolder: t })} className="text-gray-400 hover:text-yellow-500"><Star size={14}/></button>
                                    <button onClick={() => startEditingTrip(t)} className="text-gray-400 hover:text-blue-500"><Edit2 size={14}/></button>
                                    <button onClick={(e) => { e.stopPropagation(); if (confirm('确认删除?')) removeTrip(t.id); }} className="text-gray-400 hover:text-red-500"><Trash2 size={14}/></button>
                                </div>
                            </div>
                            <div className="flex flex-row">
                                <div className="flex-1 space-y-2 relative">
                                    {segments.length > 1 && <div className="absolute left-[5px] top-2 bottom-2 w-0.5 bg-gray-200 z-0"></div>}
                                    {segments.map((seg, idx) => {
                                        const line = railwayData[seg.lineKey];
                                        const icon = line?.meta?.icon;
                                        const getSt = (id: string) => line?.stations.find(s => s.id === id)?.name_ja || id;
                                        return (
                                            <div key={idx} className="relative z-10 flex flex-col text-sm">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm shrink-0"></div>
                                                    {icon && <img src={icon} alt="" className="line-icon" />}
                                                    <span className="font-bold text-emerald-700 text-xs">{seg.lineKey}</span>
                                                </div>
                                                <div className="pl-5 font-medium text-gray-700">{getSt(seg.fromId)} <span className="text-gray-300 mx-1">→</span> {getSt(seg.toId)}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <RouteSlice segments={segments} />
                            </div>
                            {t.memo && <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded mt-3">{t.memo}</div>}
                        </div>
                    );
                })
            )}
            <DropZone onDrop={(item: any) => {
                if (item.type === 'station') {
                    const newSegments = [{ id: Date.now().toString(), lineKey: item.lineKey, fromId: item.id, toId: '' }];
                    startEditingTrip({ date: new Date().toISOString().split('T')[0], memo: '', segments: newSegments, cost: 0 });
                }
            }}>
                <button id="btn-add-trip" onClick={() => startEditingTrip()} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-400 rounded-xl hover:bg-gray-50 font-bold transition">+ 记录新行程</button>
            </DropZone>
        </div>
    );
};
