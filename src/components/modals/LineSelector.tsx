import React, { useState, useMemo, useEffect } from 'react';
import { X, Map as MapIcon, Building2, Train } from 'lucide-react';
import { useStore } from '../../store';
import { buildLineSelectorGroups, CategoryKey, RegionGroup } from '../../utils/lineSelectorBuilder';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (lineKey: string) => void;
    allowedLines: string[] | null;
}

export const LineSelector: React.FC<Props> = ({ isOpen, onClose, onSelect, allowedLines }) => {
    const railwayData = useStore(state => state.railwayData);

    const [activeTab, setActiveTab] = useState<CategoryKey>('JR');
    const [selectedRegion, setSelectedRegion] = useState('all');

    // Cleaned up: One function call handles all grouping, sorting, formatting
    const groupsData = useMemo(() => {
        return buildLineSelectorGroups(railwayData, allowedLines);
    }, [railwayData, allowedLines]);

    const activeRegions = groupsData[activeTab] || [];
    const regionNames = ['all', ...activeRegions.map(r => r.name)];

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

    if (!isOpen) return null;

    // Filter regions based on selection
    const filteredRegions = activeRegions.filter(r => selectedRegion === 'all' || r.name === selectedRegion);

    return (
        <div className="fixed inset-0 z-[600] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-2xl max-h-[85vh] h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up ring-1 ring-black/5" onClick={e => e.stopPropagation()}>

                <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800"><MapIcon size={20}/> 选择线路</h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
                </div>

                <div className="flex border-b bg-white shrink-0">
                    {(['JR', 'Private', 'City'] as CategoryKey[]).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
                        >
                            {tab === 'JR' ? 'JR 集団' : tab === 'Private' ? '私鉄・第三セクター' : '地下鉄・新交通'}
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
                                {r === 'all' ? '全部地域' : r}
                            </button>
                        ))
                    ) : (
                        <span className="text-xs text-gray-400 px-2 py-1">无地域分类</span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-50">
                    {filteredRegions.length === 0 ? (
                        <div className="text-center text-gray-400 py-10">无符合条件的线路</div>
                    ) : (
                        filteredRegions.map(region => (
                            <div key={region.name} className="relative">
                                <div className="sticky top-0 z-10 bg-gray-100/95 backdrop-blur border-y border-gray-200 px-4 py-1.5">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{region.name}</h4>
                                </div>
                                <div className="p-4 grid gap-4">
                                    {region.companies.map(company => (
                                        <div key={company.name} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                                                {company.logo ? (
                                                    <img src={company.logo} alt="" className="company-logo-sm h-5 w-auto" />
                                                ) : (
                                                    <Building2 size={16} className="text-gray-400"/>
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
                                                            <img src={line.icon} alt="" className="line-icon" />
                                                        ) : (
                                                            company.logo ?
                                                                <img src={company.logo} alt="" className="line-icon opacity-50 grayscale" /> :
                                                                <Train size={14} className="text-gray-300 group-hover:text-blue-400"/>
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
        </div>
    );
};
