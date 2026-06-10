import React from 'react';
import { Magnet, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore, PinMode } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useAppRouteState } from '../../hooks/useAppRouteState';

export const FabButton: React.FC = () => {
    const { pinMode, editingPin, setPinMode, setEditingPin } = useStore(useShallow(state => ({
        pinMode: state.pinMode,
        editingPin: state.editingPin,
        setPinMode: state.setPinMode,
        setEditingPin: state.setEditingPin
    })));
    const { tab: activeTab } = useAppRouteState();
    const { t } = useTranslation();

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
                import('../../core/railwayRouting').then(({ findNearestPointOnLine }) => {
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

    const label = pinMode === PinMode.Idle
        ? t('map.pinToolAdd', '添加地图图钉')
        : pinMode === PinMode.Free
            ? t('map.pinToolSnap', '切换为吸附模式')
            : t('map.pinToolExit', '退出图钉模式');

    return (
        <div id="btn-pins-fab" className="absolute bottom-4 left-4 z-[400] flex flex-col gap-3">
            <button
                onClick={togglePinMode}
                className={`rl-map-control rl-focus flex items-center justify-center transition-all active:scale-95 ${pinMode===PinMode.Idle ? '' : 'rl-map-control-active'} ${pinMode===PinMode.Snap ? 'ring-4 ring-[var(--rl-brand-ring)]' : ''}`}
                title={label}
                aria-label={label}
            >
                {pinMode === PinMode.Snap ? <Magnet size={24} /> : <MapPin size={24} />}
            </button>
        </div>
    );
};
