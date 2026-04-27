import React from 'react';
import { Layers, Map as MapIcon, PieChart } from 'lucide-react';
import { APP_TABS } from '../../utils/routes';
import { useAppRouteState } from '../../hooks/useAppRouteState';
import { useAppNavigation } from '../../hooks/useAppNavigation';

export const BottomNav: React.FC = () => {
    const { tab: activeTab } = useAppRouteState();
    const { goToTab } = useAppNavigation();

    return (
        <nav className="bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30">
            {APP_TABS.map(tab => (
                <button
                    id={`tab-btn-${tab}`}
                    key={tab}
                    onClick={() => goToTab(tab)}
                    className={`p-2 rounded-lg ${activeTab === tab ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}
                >
                    {tab === 'records' ? <Layers/> : tab === 'map' ? <MapIcon/> : <PieChart/>}
                </button>
            ))}
        </nav>
    );
};
