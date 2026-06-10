import React, { useEffect, useMemo } from 'react';
import { Move, Magnet, Camera, MessageSquare, Trash2, X, MapPinned } from 'lucide-react';
import { useStore, PinMode } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useUserData } from '../../hooks/useUserData';
import { useTranslation } from 'react-i18next';
import { showConfirm } from '../../utils/alerts';
import { openMileageEventsPanel } from '../../utils/mileageEventUiBridge';
import { findNearestPointOnLine } from '../../core/railwayRouting';
import { lineLabel } from '../../utils/mileageUserEvents';
import { RailGraphBadge } from '../rail-graph/RailGraphBadges';
import { pinMileageEventBridgePayload } from '../../utils/pinEventBridge';

const COLOR_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#64748b'];

export const PinEditor: React.FC = () => {
    const { editingPin, pinMode, pins, user, trips, folders, badgeSettings, railwayData, setActiveRailGraphSelection } = useStore(useShallow(state => ({
        editingPin: state.editingPin,
        pinMode: state.pinMode,
        pins: state.pins,
        user: state.user,
        trips: state.trips,
        folders: state.folders,
        badgeSettings: state.badgeSettings,
        railwayData: state.railwayData,
        setActiveRailGraphSelection: state.setActiveRailGraphSelection
    })));
    const setEditingPin = useStore(state => state.setEditingPin);
    const setPinMode = useStore(state => state.setPinMode);
    const setPins = useStore(state => state.setPins);
    const { saveData } = useUserData();
    const { t } = useTranslation();
    const eventLineKey = useMemo(() => {
        if (!editingPin) return '';
        if (editingPin.lineKey && railwayData[editingPin.lineKey]) return editingPin.lineKey;
        const nearest = findNearestPointOnLine(railwayData, editingPin.lat, editingPin.lng);
        return nearest.lineKey || Object.keys(railwayData).sort()[0] || '';
    }, [editingPin, railwayData]);
    const eventAxisLabel = eventLineKey ? lineLabel(eventLineKey) : '';

    const savePin = () => {
        if (!editingPin) return;
        const newPin = { ...editingPin, id: editingPin.isTemp ? Date.now() : editingPin.id };
        delete newPin.isTemp;

        const newPins = editingPin.isTemp ? [...pins, newPin] : pins.map(p => p.id === newPin.id ? newPin : p);
        setPins(newPins);

        if (user) {
            saveData(user.token, trips, newPins, folders, badgeSettings).catch(e => console.error('Pin sync failed', e));
        }

        setEditingPin(null);
        setPinMode(PinMode.Idle);
    };

    const deletePin = async (id: string | number) => {
        if(await showConfirm(t('common.deleteConfirm', '删除?'))) {
            const newPins = pins.filter(p => p.id !== id);
            setPins(newPins);
            if (editingPin?.id === id) {
                setEditingPin(null);
                setPinMode(PinMode.Idle);
            }

            if (user) {
                saveData(user.token, trips, newPins, folders, badgeSettings).catch(e => console.error('Pin sync failed', e));
            }
        }
    };

    const createEventFromPin = () => {
        if (!editingPin || !eventLineKey) return;
        const bridgePayload = pinMileageEventBridgePayload({
            pin: editingPin,
            lineKey: eventLineKey,
            railwayData,
        });
        if (!bridgePayload) return;
        setActiveRailGraphSelection(bridgePayload.activeSelection);
        openMileageEventsPanel(bridgePayload.openDetail);
        setEditingPin(null);
        setPinMode(PinMode.Idle);
    };

    useEffect(() => {
        if (!editingPin) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setEditingPin(null);
                setPinMode(PinMode.Idle);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                savePin();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [editingPin, savePin, setEditingPin, setPinMode]);

    if (!editingPin) return null;

    return (
        <div id="pin-editor" className="absolute bottom-6 left-4 right-4 z-[400] bg-white rounded-xl shadow-2xl p-4 animate-slide-up max-w-md mx-auto border border-gray-200">
            <div className="flex justify-between items-center mb-3 border-b pb-2">
                <span className="font-bold text-gray-700 flex items-center gap-2">
                    {pinMode === PinMode.Snap ? <Magnet size={16} className="text-indigo-600"/> : <Move size={16} />}
                    {pinMode === PinMode.Snap ? t('pin.titleSnap', `吸附: {{line}}`, { line: eventAxisLabel || t('app.unknown', '未知') }) : t('pin.titleFree', '自由位置')}
                </span>
                <button onClick={() => { setEditingPin(null); setPinMode(PinMode.Idle); }} className="absolute right-0">
                    <X size={18} className="text-gray-400"/>
                </button>
            </div>
            <div className="flex gap-3 mb-3">
                <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
                    {['photo', 'comment'].map(type => (
                        <button key={type} onClick={() => setEditingPin({ ...editingPin, type: type as any })} className={`p-2 rounded-md ${editingPin.type === type ? 'bg-white shadow text-blue-600' : 'text-gray-400'}`}>
                            {type === 'photo' ? <Camera size={18}/> : <MessageSquare size={18}/>}
                        </button>
                    ))}
                </div>
                <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
                    {COLOR_PALETTE.map(c => (
                        <button key={c} onClick={() => setEditingPin({ ...editingPin, color: c })} className={`w-6 h-6 rounded-full border-2 ${editingPin.color === c ? 'border-gray-600 scale-110' : 'border-transparent'}`} style={{ background: c }} />
                    ))}
                </div>
            </div>
            <input className="w-full p-2 border rounded text-sm mb-2" placeholder={t('pin.placeholderMemo', "备注...")} value={editingPin.comment || ''} onChange={e => setEditingPin({ ...editingPin, comment: e.target.value })} />
            {editingPin.type === 'photo' && (
                <input className="w-full p-2 border rounded text-sm mb-3" placeholder={t('pin.placeholderUrl', "图片URL...")} value={editingPin.imageUrl || ''} onChange={e => setEditingPin({ ...editingPin, imageUrl: e.target.value })} />
            )}
            <button
                type="button"
                onClick={createEventFromPin}
                disabled={!eventLineKey}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
            >
                <MapPinned size={16} />
                {t('pin.createEvent', 'Create user event')}
            </button>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <RailGraphBadge
                    icon="legacy"
                    label={t('pin.eventAxis', 'Event axis')}
                    value={eventAxisLabel || t('mileageEvents.unknown', 'Unknown')}
                    tone="slate"
                    className="max-w-full rounded bg-white"
                />
                <span className="min-w-0">
                    {eventLineKey
                        ? t('pin.eventAxisHint', 'Uses {{line}} as the GeoJSON mileage axis.', { line: eventAxisLabel })
                        : t('pin.eventAxisMissing', 'Load GeoJSON line data before creating a pin event.')}
                </span>
            </div>
            <div className="flex gap-2">
                {!editingPin.isTemp && (
                    <button onClick={() => deletePin(editingPin.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                        <Trash2 size={20}/>
                    </button>
                )}
                <button onClick={savePin} className="flex-1 bg-slate-800 text-white py-2 rounded-lg font-bold text-sm hover:bg-slate-700">
                    {editingPin.isTemp ? t('pin.btnCreate', '添加') : t('pin.btnUpdate', '更新')}
                </button>
            </div>
        </div>
    );
};
