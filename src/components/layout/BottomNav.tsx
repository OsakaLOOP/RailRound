import React from 'react';
import { Layers, Map as MapIcon, PieChart } from 'lucide-react';
import { useStore } from '../../store';
import { useNavigate, useLocation, useParams } from 'react-router-dom';

export const BottomNav: React.FC = () => {
    const setActiveTab = useStore(state => state.setActiveTab);
    const navigate = useNavigate();
    const location = useLocation();
    const { lang } = useParams<{ lang: string }>();

    // 从 URL 推导当前 tab，保持 store activeTab 兼容性
    const parts = location.pathname.split('/').filter(Boolean);
    const lastSeg = parts[parts.length - 1];
    const activeTab = ['records', 'map', 'stats'].includes(lastSeg) ? lastSeg : 'records';

    const handleTabClick = (tab: string) => {
        const langPrefix = lang ? `/${lang}` : '';
        navigate(`${langPrefix}/${tab}`);
    };

    return (
        <nav className="bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30">
            {['records', 'map', 'stats'].map(tab => (
                <button
                    id={`tab-btn-${tab}`}
                    key={tab}
                    onClick={() => handleTabClick(tab)}
                    className={`p-2 rounded-lg ${activeTab === tab ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}
                >
                    {tab === 'records' ? <Layers/> : tab === 'map' ? <MapIcon/> : <PieChart/>}
                </button>
            ))}
        </nav>
    );
};
