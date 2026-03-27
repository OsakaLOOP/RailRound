import React from 'react';
import { Magnet, MapPin } from 'lucide-react';
import { useStore, PinMode } from '../../store';

export const FabButton: React.FC = () => {
    const { activeTab, pinMode, editingPin, setPinMode, setEditingPin } = useStore(state => ({
        activeTab: state.activeTab,
        pinMode: state.pinMode,
        editingPin: state.editingPin,
        setPinMode: state.setPinMode,
        setEditingPin: state.setEditingPin
    }));

    const togglePinMode = () => {
        if (pinMode === PinMode.Idle) {
            setPinMode(PinMode.Free);
            // Trigger temporary pin logic handled elsewhere or we mock here
            // Note: need map instance for center. For simplicity, handled mostly in MapContainer click
            // For robust temp pin creation, ideally it requests center from store or map.
        }
        else if (pinMode === PinMode.Free) {
            setPinMode(PinMode.Snap);
            // Snap logic handled by PinEditor or MapContainer dragend
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
