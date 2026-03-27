import React from 'react';
import { Layers, Map as MapIcon, PieChart } from 'lucide-react';
import { useStore } from '../../store';

export const BottomNav: React.FC = () => {
    const { activeTab, setActiveTab } = useStore(state => ({
        activeTab: state.activeTab,
        setActiveTab: state.setActiveTab
    }));

    return (
        <nav className="bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30">
            {['records', 'map', 'stats'].map(t => (
                <button
                    id={`tab-btn-${t}`}
                    key={t}
                    onClick={() => setActiveTab(t as any)}
                    className={`p-2 rounded-lg ${activeTab === t ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}
                >
                    {t === 'records' ? <Layers/> : t === 'map' ? <MapIcon/> : <PieChart/>}
                </button>
            ))}
        </nav>
    );
};
