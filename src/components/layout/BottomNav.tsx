import React from 'react';
import { Layers, Map as MapIcon, PieChart } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

export const BottomNav: React.FC = () => {
    const { activeTab, setActiveTab } = useStore(useShallow(state => ({
        activeTab: state.activeTab,
        setActiveTab: state.setActiveTab
    })));

    return (
        <nav className="bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30">
            {['records', 'map', 'stats'].map(tab => (
                <button
                    id={`tab-btn-${tab}`}
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`p-2 rounded-lg ${activeTab === tab ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}
                >
                    {tab === 'records' ? <Layers/> : tab === 'map' ? <MapIcon/> : <PieChart/>}
                </button>
            ))}
        </nav>
    );
};
