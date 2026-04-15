import React, { useState, useMemo, useEffect } from 'react';
import { X, Map as MapIcon, Building2, Train, Search } from 'lucide-react';
import { useStore } from '../../store';
import { buildLineSelectorGroups, CategoryKey, RegionGroup } from '../../utils/lineSelectorBuilder';
import { useTranslation } from 'react-i18next';
import { LineLogo } from '../LineLogo';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (lineKey: string) => void;
    allowedLines: string[] | null;
    onSwitchMode?: () => void;
    isEmbedded?: boolean;
}

export const LineSelector: React.FC<Props> = ({ isOpen, onClose, onSelect, allowedLines, onSwitchMode, isEmbedded }) => {
    const railwayData = useStore(state => state.railwayData);

    const [activeTab, setActiveTab] = useState<CategoryKey>('JR');
    const [selectedRegion, setSelectedRegion] = useState('all');
    const [isLoaded, setIsLoaded] = useState(false);

    // Cleaned up: One function call handles all grouping, sorting, formatting
    const groupsData = useMemo(() => {
        return buildLineSelectorGroups(railwayData, allowedLines);
    }, [railwayData, allowedLines]);

    const activeRegions = groupsData[activeTab] || [];
    const regionNames = ['all', ...activeRegions.map(r => r.name)];
    const { t } = useTranslation();

    useEffect(() => {
        if (!regionNames.includes(selectedRegion)) {
            setSelectedRegion('all');
        }
    }, [activeTab, regionNames, selectedRegion]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (isOpen || isEmbedded) {
            setIsLoaded(false);
            const timer = setTimeout(() => {
                setIsLoaded(true);
            }, 50); // delay rendering to allow modal animation to start smoothly
            return () => clearTimeout(timer);
        } else {
            setIsLoaded(false);
        }
    }, [isOpen, isEmbedded]);

    if (!isOpen && !isEmbedded) return null;

    // Filter regions based on selection
    const filteredRegions = activeRegions.filter(r => selectedRegion === 'all' || r.name === selectedRegion);

    const content = (
        <div className="flex flex-col h-full w-full bg-white">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800">
                    <MapIcon size={20} /> {t('lineSel.title', '选择线路')}
                </h3>
                <div className="flex items-center gap-3">
                    {onSwitchMode && (
                        <button
                            onClick={onSwitchMode}
                            className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-blue-600 bg-white border border-gray-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg shadow-sm transition-all"
                            title={t('search.placeholder', '搜索线路或车站...')}
                        >
                            <Search size={14} />
                            <span className="hidden sm:inline">{t('common.search', '搜索')}</span>
                        </button>
                    )}
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full transition-colors"><X className="text-gray-400 hover:text-gray-600" /></button>
                </div>
            </div>

            <div className="flex border-b bg-white shrink-0">
                {(['JR', 'Private', 'City'] as CategoryKey[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 relative ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
                    >
                        <span>{tab === 'JR' ? t('lineSel.jr', 'JR 集団') : tab === 'Private' ? t('lineSel.private', '私鉄・第三セクター') : t('lineSel.subway', '地下鉄・新交通')}</span>
                        {tab === 'City' && (
                            <div className="absolute -top-1 right-1/2 translate-x-1/2 -translate-y-full">
                                <div className="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded-full shadow-lg animate-bounce-subtle whitespace-nowrap ring-2 ring-white">
                                    {t('lineSel.cnMainlandEnt', '中国大陆入口')}
                                </div>
                                <div className="w-1.5 h-1.5 bg-blue-600 rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-0.5 border-r border-b border-blue-600"></div>
                            </div>
                        )}
                    </button>
                ))}
            </div>

            <div className="p-2 border-b bg-white overflow-x-auto flex gap-2 shrink-0 no-scrollbar">
                {regionNames.length > 1 ? (
                    regionNames.map(r => (
                        <button
                            key={r}
                            onClick={() => setSelectedRegion(r)}
                            className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${selectedRegion === r ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                            {r === 'all' ? t('lineSel.allRegions', '全部地域') : (t(`regions.${r}`, r) || r)}
                        </button>
                    ))
                ) : (
                    <span className="text-xs text-gray-400 px-2 py-1">{t('lineSel.noRegion', '无地域分类')}</span>
                )}
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50">
                {!isLoaded ? (
                    <div className="p-4 grid gap-4 animate-pulse">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                <div className="h-10 bg-gray-100 border-b border-gray-100 flex items-center px-4">
                                    <div className="w-24 h-4 bg-gray-200 rounded"></div>
                                </div>
                                <div className="divide-y divide-gray-50">
                                    {[1, 2, 3, 4].map(j => (
                                        <div key={j} className="w-full px-4 py-3 flex items-center gap-3">
                                            <div className="w-5 h-5 rounded-full bg-gray-200"></div>
                                            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : filteredRegions.length === 0 ? (
                    <div className="text-center text-gray-400 py-10">{t('lineSel.noResult', '无符合条件的线路')}</div>
                ) : (
                    filteredRegions.map(region => (
                        <div key={region.name} className="relative">
                            <div className="sticky top-0 z-10 bg-gray-100/95 backdrop-blur border-y border-gray-200 px-4 py-1.5">
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t(`regions.${region.name}`, region.name) || region.name}</h4>
                            </div>
                            <div className="p-4 grid gap-4">
                                {region.companies.map(company => (
                                    <div key={company.name} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                                            {company.logo ? (
                                                <img src={company.logo} alt="" className="company-logo-sm h-5 w-auto" draggable={false} />
                                            ) : (
                                                <Building2 size={16} className="text-gray-400" />
                                            )}
                                            <span className="font-bold text-sm text-gray-700">{company.name}</span>
                                        </div>
                                        <div className="divide-y divide-gray-50">
                                            {company.lines.map(line => (
                                                <button
                                                    key={line.key}
                                                    onClick={() => { onSelect(line.key); onClose(); }}
                                                    className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                                                >
                                                    {line.icon ? (
                                                        <LineLogo src={line.icon!} companyIcon={line.companyIcon} recolor={line.recolor} color={line.color} className="line-icon" />
                                                    ) : (
                                                        company.logo ?
                                                            <img src={company.logo} alt="" className="line-icon opacity-50 grayscale" draggable={false} /> :
                                                            <Train size={14} className="text-gray-300 group-hover:text-blue-400" />
                                                    )}
                                                    {line.displayName}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    if (isEmbedded) return content;

    return (
        <div className="fixed inset-0 z-[600] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-2xl max-h-[85vh] h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up ring-1 ring-black/5" onClick={e => e.stopPropagation()}>
                {content}
            </div>
        </div>
    );
};
