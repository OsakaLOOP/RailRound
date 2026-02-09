import React, { useState, useEffect } from 'react';
import { useAuth, useUserData, useGeo } from '../globalContext';
import { useNavigate, Outlet } from 'react-router-dom';
import { Train, Star, Edit2, Trash2 } from 'lucide-react';
import { DropZone } from '../components/DragContext';
import { RouteSlice } from '../components/RouteSlice';

export default function TripsPage() {
    const { trips, setTrips, saveData, folders, setFolders } = useUserData();
    const { user } = useAuth();
    const { railwayData } = useGeo();
    const navigate = useNavigate();

    // Logic from RecordsView
    const onDelete = (id) => {
        if (confirm('确认删除?')) {
            const newTrips = trips.filter(t => t.id !== id);
            setTrips(newTrips);
            if (user) saveData(newTrips, null, null, null);
        }
    };

    const onEdit = (trip) => {
        navigate(`/trips/${trip.id}/edit`);
    };

    const onAdd = (item) => {
        // Pass initial data via state
        navigate('/trips/new', { state: { initialStation: item } });
    };

    const onAddToFolder = (trip) => {
        // Implement modal or inline expansion?
        // Original was a modal. User wants router.
        // Navigate to /trips/:id/add-to-folder?
        // Or keep it as a local modal since it's small?
        // User said "UI popup control... directly native Router".
        // Let's use a sub-route: /records/folder/:tripId
        navigate(`/trips/folder/${trip.id}`);
    };

    return (
        <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-3 pb-24 pointer-events-auto bg-slate-100 min-h-full">
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
                                    {t.cost > 0 && <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">¥{t.cost}</span>}
                                    <button onClick={() => onAddToFolder(t)} className="text-gray-400 hover:text-yellow-500"><Star size={14}/></button>
                                    <button onClick={() => onEdit(t)} className="text-gray-400 hover:text-blue-500"><Edit2 size={14}/></button>
                                    <button onClick={(e) => { e.stopPropagation(); onDelete(t.id); }} className="text-gray-400 hover:text-red-500"><Trash2 size={14}/></button>
                                </div>
                            </div>
                            <div className="flex flex-row">
                                <div className="flex-1 space-y-2 relative">{segments.length > 1 && <div className="absolute left-[5px] top-2 bottom-2 w-0.5 bg-gray-200 z-0"></div>}
                                    {segments.map((seg, idx) => {
                                        const line = railwayData[seg.lineKey];
                                        const icon = line?.meta?.icon;
                                        const getSt = (id) => line?.stations.find(s => s.id === id)?.name_ja || id;
                                        return (
                                            <div key={idx} className="relative z-10 flex flex-col text-sm"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm shrink-0"></div>{icon && <img src={icon} alt="" className="line-icon" />}<span className="font-bold text-emerald-700 text-xs">{seg.lineKey}</span></div><div className="pl-5 font-medium text-gray-700">{getSt(seg.fromId)} <span className="text-gray-300 mx-1">→</span> {getSt(seg.toId)}</div></div>
                                        )
                                    })}
                                </div>
                                <RouteSlice segments={segments} />
                            </div>
                            {t.memo && <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded mt-3">{t.memo}</div>}
                        </div>
                    );
                })
            )}
            <DropZone onDrop={(item) => {
                if (item.type === 'station') {
                    onAdd(item);
                }
            }}>
                <button id="btn-add-trip" onClick={() => onAdd()} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-400 rounded-xl hover:bg-gray-50 font-bold transition">+ 记录新行程</button>
            </DropZone>
            <Outlet />
        </div>
    );
}
