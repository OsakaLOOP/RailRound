import React from 'react';
import { Magnet, MapPin } from 'lucide-react';
import { useStore, PinMode } from '../../store';
import { useShallow } from 'zustand/react/shallow';

export const FabButton: React.FC = () => {
    const { activeTab, pinMode, editingPin, setPinMode, setEditingPin } = useStore(useShallow(state => ({
        activeTab: state.activeTab,
        pinMode: state.pinMode,
        editingPin: state.editingPin,
        setPinMode: state.setPinMode,
        setEditingPin: state.setEditingPin
    })));

    const togglePinMode = () => {
        if (pinMode === PinMode.Idle) {
            setPinMode(PinMode.Free);
            // Dispatch a custom event so MapContainer can create the temp pin and pan the map
            window.dispatchEvent(new CustomEvent('map:create-temp-pin'));
        }
        else if (pinMode === PinMode.Free) {
            setPinMode(PinMode.Snap);
            if (editingPin) {
                const railwayData = useStore.getState().railwayData;
                import('../../utils/railwayRouting').then(({ findNearestPointOnLine }) => {
                    const snap = findNearestPointOnLine(railwayData, editingPin.lat, editingPin.lng);
                    setEditingPin({ ...editingPin, ...snap });
                });
            }
        }
        else {
            setPinMode(PinMode.Idle);
            setEditingPin(null);
        }
    };

    if (activeTab !== 'map') return null;

    return (
        <div id="btn-pins-fab" className="absolute bottom-4 left-4 z-[400] flex flex-col gap-3">
            <button
                onClick={togglePinMode}
                className={`p-3 rounded-full shadow-lg transition-all transform hover:scale-105 ${pinMode===PinMode.Idle?'bg-white text-gray-700':pinMode===PinMode.Free?'bg-blue-500 text-white':'bg-indigo-600 text-white ring-4 ring-indigo-200'}`}
            >
                {pinMode === PinMode.Snap ? <Magnet size={24} /> : <MapPin size={24} />}
            </button>
        </div>
    );
};
