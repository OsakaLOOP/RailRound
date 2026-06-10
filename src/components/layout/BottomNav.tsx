import React from 'react';
import { Layers, Map as MapIcon, PieChart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { APP_TABS } from '../../utils/routes';
import { useAppRouteState } from '../../hooks/useAppRouteState';
import { useAppNavigation } from '../../hooks/useAppNavigation';

export const BottomNav: React.FC = () => {
    const { tab: activeTab } = useAppRouteState();
    const { goToTab } = useAppNavigation();
    const { t } = useTranslation();

    const labels: Record<string, string> = {
        records: t('nav.records', 'Records'),
        map: t('nav.map', 'Map'),
        stats: t('nav.stats', 'Stats'),
    };

    return (
        <nav className="bg-white/95 border-t border-slate-200 px-2 py-1.5 flex justify-around shrink-0 pb-safe z-30 backdrop-blur">
            {APP_TABS.map(tab => (
                <button
                    id={`tab-btn-${tab}`}
                    key={tab}
                    onClick={() => goToTab(tab)}
                    className={`rl-focus min-w-20 px-3 py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${activeTab === tab ? 'rl-tab-active' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                    aria-label={labels[tab]}
                    title={labels[tab]}
                >
                    {tab === 'records' ? <Layers size={22}/> : tab === 'map' ? <MapIcon size={22}/> : <PieChart size={22}/>}
                    <span>{labels[tab]}</span>
                </button>
            ))}
        </nav>
    );
};
