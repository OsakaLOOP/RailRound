import { useTranslation } from 'react-i18next';
import { showConfirm } from '../../utils/confirm';
import React, { useEffect } from 'react';
import { Edit2, X, AlertTriangle, Save, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useUserData } from '../../hooks/useUserData';
import * as turf from '@turf/turf';

export const WalkTripEditor: React.FC = () => {
    const {
        isOpen, isEditing, form, railwayData, trips, pins, folders, badgeSettings, user
    } = useStore(useShallow(state => ({
        isOpen: state.isWalkTripEditing,
        isEditing: !!state.editingTripId,
        form: state.tripForm,
        railwayData: state.railwayData,
        trips: state.trips,
        pins: state.pins,
        folders: state.folders,
        badgeSettings: state.badgeSettings,
        user: state.user
    })));

    const setForm = useStore(state => state.setTripForm);
    const closeEditor = useStore(state => state.closeWalkTripEditor);
    const setTrips = useStore(state => state.setTrips);
    const { saveData } = useUserData();

    // Replicating TripEditor keydown logic
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
    const { t } = useTranslation();
            if (e.key === 'Escape') closeEditor();
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                onSave();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeEditor, form]);

    if (!isOpen) return null;

    const generateBezierPath = (startLngLat: [number, number], endLngLat: [number, number]): [number, number][] => {
        const line = turf.lineString([startLngLat, endLngLat]);

        // Add some random curvature by computing an offset point in the middle
        const distance = turf.length(line, { units: 'kilometers' });
        const bearing = turf.bearing(startLngLat, endLngLat);
        const midpoint = turf.midpoint(startLngLat, endLngLat);

        // Shift midpoint randomly perpendicular to the bearing
        const offsetBearing = bearing + (Math.random() > 0.5 ? 90 : -90);
        const offsetDistance = distance * (0.1 + Math.random() * 0.2); // 10% to 30% of total distance offset
        const controlPoint = turf.destination(midpoint, offsetDistance, offsetBearing, { units: 'kilometers' });

        // Generate bezier path
        const bezierLine = turf.bezierSpline(turf.lineString([
            startLngLat,
            controlPoint.geometry.coordinates,
            endLngLat
        ]));

        // We need [lat, lng] format for Leaflet
        return bezierLine.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    };

    const onSave = async () => {
        if (!form.date) return;
        if (!form.fromId || !form.toId) {
            alert(t('walk.noStartEnd', '缺少起止点'));
            return;
        }

        const newTripsToAdd = [];
        const nextTrips = trips.filter(t => t.id !== form.id);

        let walkPath = form.walkPath;
        if (!walkPath) {
            // Find coordinates for the Bezier curve
            let startCoords = null;
            let endCoords = null;
            Object.values(railwayData).forEach(line => {
                const s = line.stations.find(st => st.id === form.fromId);
                if (s) startCoords = [s.lng, s.lat];
                const e = line.stations.find(st => st.id === form.toId);
                if (e) endCoords = [e.lng, e.lat];
            });

            if (startCoords && endCoords) {
                walkPath = generateBezierPath(startCoords as [number, number], endCoords as [number, number]);
            }
        }

        const finalTrip = {
            id: form.id || Date.now().toString(),
            date: form.date,
            memo: form.memo || '',
            cost: form.cost || 0,
            isWalk: true,
            walkType: form.walkType || 'ufo',
            fromId: form.fromId,
            toId: form.toId,
            walkPath: walkPath,
            segments: [] // Optional
        };

        newTripsToAdd.push(finalTrip);
        const finalTrips = [...newTripsToAdd, ...nextTrips].sort((a,b) => b.date.localeCompare(a.date));

        setTrips(finalTrips);
        if (user) {
            saveData(user.token, finalTrips, pins, folders, badgeSettings).catch((e: any) => alert(t('walk.saveFail', '云端保存失败: ') + e.message));
        }
        closeEditor();
    };

    const onDelete = async () => {
        if (!(await showConfirm(t('walk.delConfirm', "确定要删除这条步行记录吗？")))) return;
        const nextTrips = trips.filter(t => t.id !== form.id);
        setTrips(nextTrips);
        if (user) {
            saveData(user.token, nextTrips, pins, folders, badgeSettings).catch((e: any) => alert(t('walk.delFail', '云端删除失败: ') + e.message));
        }
        closeEditor();
    };

    // Resolving station names for read-only display
    let startName = t('walk.unknownStart', "未知起点");
    let endName = t('walk.unknownEnd', "未知终点");
    Object.values(railwayData).forEach(line => {
        const s = line.stations.find(st => st.id === form.fromId);
        if (s) startName = s.name_ja;
        const e = line.stations.find(st => st.id === form.toId);
        if (e) endName = e.name_ja;
    });

    const isTree = form.walkType === 'tree';

    const colors = {
        bgHeader: isTree ? 'bg-green-50' : 'bg-purple-50',
        textHeader: isTree ? 'text-green-800' : 'text-purple-800',
        bgBox: isTree ? 'bg-green-100/50' : 'bg-purple-100/50',
        textBoxTitle: isTree ? 'text-green-900' : 'text-purple-900',
        textBoxValue: isTree ? 'text-green-700' : 'text-purple-700',
        borderBox: isTree ? 'border-green-200' : 'border-purple-200',
        textWarning: isTree ? 'text-green-600' : 'text-purple-500',
        ringFocus: isTree ? 'focus:ring-green-500' : 'focus:ring-purple-500',
        bgSaveBtn: isTree ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700',
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-slide-up relative overflow-hidden">
            <div className={`p-4 border-b ${colors.bgHeader} relative z-10`}>
              <div className="flex justify-between items-center">
                 <h3 className={`font-bold text-lg flex items-center gap-2 ${colors.textHeader}`}>
                    <Edit2 size={18} />
                    {isEditing ? t('walk.editTitle', '编辑步行路线') : t('walk.newTitle', '新建步行路线')}
                 </h3>
                 <button onClick={closeEditor}><X className="text-gray-400 hover:text-gray-600"/></button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
                {/* Read-Only Origin/Dest display */}
                <div className={`${colors.bgBox} p-4 rounded-lg flex flex-col gap-2`}>
                    <div className={`flex justify-between items-center text-sm font-semibold ${colors.textBoxTitle}`}>
                        <span>{t('walk.start', '起点')}</span>
                        <span className={colors.textBoxValue}>{startName}</span>
                    </div>
                    <div className={`border-b ${colors.borderBox} border-dashed my-1`}></div>
                    <div className={`flex justify-between items-center text-sm font-semibold ${colors.textBoxTitle}`}>
                        <span>{t('walk.end', '终点')}</span>
                        <span className={colors.textBoxValue}>{endName}</span>
                    </div>
                    <p className={`text-xs ${colors.textWarning} mt-2 text-center flex items-center justify-center gap-1`}>
                        <AlertTriangle size={12}/> {t('walk.noChangeWarning', '步行起止点和类型无法更改')}
                    </p>
                </div>

                <div className="space-y-4 pt-4 border-t">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('walk.date', '日期')}</label>
                        <input type="date" value={form.date || ''} onChange={(e) => setForm({ date: e.target.value })} className={`w-full border rounded-lg p-2 focus:ring-2 ${colors.ringFocus} outline-none`} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('walk.memo', '备注')}</label>
                        <textarea placeholder={t('walk.memoPlaceholder', "例如：逛街、散步...")} value={form.memo || ''} onChange={(e) => setForm({ memo: e.target.value })} className={`w-full border rounded-lg p-2 focus:ring-2 ${colors.ringFocus} outline-none min-h-[80px]`} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('walk.cost', '花费 (可选)')}</label>
                        <input type="number" placeholder={t('walk.costPlaceholder', "花费 (円)")} value={form.cost || ''} onChange={(e) => setForm({ cost: parseInt(e.target.value) || 0 })} className={`w-full border rounded-lg p-2 focus:ring-2 ${colors.ringFocus} outline-none`} />
                    </div>
                </div>
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-between gap-3">
               {isEditing && (
                 <button onClick={onDelete} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-colors">
                     <Trash2 size={16} /> {t('walk.delete', '删除')}
                 </button>
               )}
               <button onClick={onSave} className={`flex-1 text-white py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition shadow-sm ${colors.bgSaveBtn}`}>
                   <Save size={16} /> {t('walk.save', '保存行程')}
               </button>
            </div>
          </div>
        </div>
    );
};
