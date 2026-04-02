import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Train, Edit2, Trash2, Star, Plus, MapPin } from 'lucide-react';
import { useStore } from '../store';
import { DropZone } from '../components/DragContext';
import { getRouteVisualData } from '../core/tripCalculator';
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

import { useUserData } from '../hooks/useUserData';

export const TripsPage: React.FC = () => {
    const { trips, railwayData, user, pins, folders, badgeSettings } = useStore(useShallow(state => ({
        trips: state.trips,
        railwayData: state.railwayData,
        user: state.user,
        pins: state.pins,
        folders: state.folders,
        badgeSettings: state.badgeSettings
    })));
    const setModalState = useStore(state => state.setModalState);
    const startEditingTrip = useStore(state => state.startEditingTrip);
    const removeTrip = useStore(state => state.removeTrip);
    const { saveData } = useUserData();

    const handleDeleteTrip = (id: string | number) => {
        if (confirm('确认删除?')) {
            removeTrip(id);
            if (user) {
                const newTrips = trips.filter(t => t.id !== id);
                saveData(user.token, newTrips, pins, folders, badgeSettings).catch((e: any) => alert('云端同步失败'));
            }
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-3 pb-4">
            {trips.length === 0 ? (
                <div className="text-center text-gray-400 py-10 flex flex-col items-center justify-center flex-1">
                    <Train size={48} className="opacity-20 mb-4"/>
                    <p>暂无行程记录</p>
                    <p className="text-xs mt-2">点击下方按钮添加你的第一次乗り鉄<br/>注意: 自定义线路可以导入 company_data 和 geojson</p>
                </div>
            ) : (
                trips.map(t => {
                    const segments = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
                    const isWalk = t.isWalk;

                    if (isWalk) {
                        let startName = t.fromId || '';
                        let endName = t.toId || '';
                        Object.values(railwayData).forEach(line => {
                            const s = line.stations.find(st => st.id === t.fromId);
                            if (s) startName = s.name_ja;
                            const e = line.stations.find(st => st.id === t.toId);
                            if (e) endName = e.name_ja;
                        });

                        const isTree = t.walkType === 'tree';
                        const cls = {
                            bg: isTree ? 'bg-green-50' : 'bg-purple-50',
                            border: isTree ? 'border-green-100' : 'border-purple-100',
                            date: isTree ? 'text-green-400' : 'text-purple-400',
                            tagText: isTree ? 'text-green-600' : 'text-purple-500',
                            tagBg: isTree ? 'bg-green-200/50' : 'bg-purple-200/50',
                            btnEdit: isTree ? 'text-green-400 hover:text-green-600' : 'text-purple-400 hover:text-purple-600',
                            btnDel: isTree ? 'text-green-400 hover:text-red-500' : 'text-purple-400 hover:text-red-500',
                            icon: isTree ? 'text-green-500' : 'text-purple-500',
                            title: isTree ? 'text-green-700' : 'text-purple-700',
                            stations: isTree ? 'text-green-900' : 'text-purple-900',
                            arrow: isTree ? 'text-green-300' : 'text-purple-300',
                            memo: isTree ? 'text-green-600' : 'text-purple-600',
                            label: isTree ? '步行' : '搭便车'
                        };

                        return (
                            <div key={t.id} className={`${cls.bg} p-4 rounded-lg border ${cls.border} shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1 cursor-pointer`} onClick={() => useStore.getState().startEditingWalkTrip(t)}>
                                <div className={`flex justify-between mb-2 pb-2 border-b ${cls.border}`}>
                                    <span className={`text-xs font-bold ${cls.date}`}>{t.date}</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs font-mono ${cls.tagText} ${cls.tagBg} px-1.5 py-0.5 rounded`}>步行</span>
                                        <button onClick={(e) => { e.stopPropagation(); useStore.getState().startEditingWalkTrip(t); }} className={cls.btnEdit}><Edit2 size={14}/></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteTrip(t.id); }} className={cls.btnDel}><Trash2 size={14}/></button>
                                    </div>
                                </div>
                                <div className="flex flex-row">
                                    <div className="flex-1 space-y-2 relative">
                                        <div className="relative z-10 flex flex-col text-sm">
                                            <div className="flex items-center gap-2">
                                                <MapPin size={14} className={`${cls.icon} shrink-0`}/>
                                                <span className={`font-bold ${cls.title} text-xs`}>{cls.label}</span>
                                            </div>
                                            <div className={`pl-5 font-medium ${cls.stations}`}>{startName} <span className={`${cls.arrow} mx-1`}>→</span> {endName}</div>
                                        </div>
                                    </div>
                                </div>
                                {t.memo && <div className={`text-xs ${cls.memo} bg-white/60 p-2 rounded mt-3`}>{t.memo}</div>}
                            </div>
                        );
                    }

                    return (
                        <div key={t.id} className="bg-white p-4 rounded-lg border shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1">
                            <div className="flex justify-between mb-2 pb-2 border-b border-gray-50">
                                <span className="text-xs font-bold text-gray-400">{t.date}</span>
                                <div className="flex items-center gap-2">
                                    {(t.cost || 0) > 0 && <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">¥{t.cost}</span>}
                                    <button onClick={() => setModalState({ addToFolderModalOpen: true, currentTripForFolder: t })} className="text-gray-400 hover:text-yellow-500"><Star size={14}/></button>
                                    <button onClick={() => startEditingTrip(t)} className="text-gray-400 hover:text-blue-500"><Edit2 size={14}/></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteTrip(t.id); }} className="text-gray-400 hover:text-red-500"><Trash2 size={14}/></button>
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
                <button id="btn-add-trip" onClick={() => startEditingTrip()} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-400 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300 font-bold transition-all duration-300 active:scale-[0.98] group flex items-center justify-center gap-2">
                    <Plus className="group-hover:rotate-90 transition-transform duration-300" size={18} /> 记录新行程
                </button>
            </DropZone>
        </div>
    );
};
