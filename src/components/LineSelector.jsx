import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Map as MapIcon, Train, Building2 } from 'lucide-react';

export const LineSelector = ({ isOpen, onClose, onSelect, railwayData, allowedLines }) => {
    const [activeTab, setActiveTab] = useState('JR');
    const [selectedRegion, setSelectedRegion] = useState('all');

    const normalizeRegion = (region) => {
        if (region === '北海道' || region === '東北') return '北海道・東北';
        if (region === '九州' || region === '沖縄' || region === '九州・沖縄') return '九州・沖縄';
        return region || '其他';
    };

    const { groups } = useMemo(() => {
        const groups = { JR: {}, Private: {}, City: {} };
        if (!railwayData) return { groups };

        Object.keys(railwayData).forEach(key => {
            if (allowedLines && !allowedLines.includes(key)) return;
            const line = railwayData[key];
            const { region, type, company, logo, icon } = line.meta;
            let category = 'City';
            if (type === 'JR') category = 'JR';
            else if (type === '私鉄'||type === '第三セクター') category = 'Private';
            const normRegion = normalizeRegion(region);
            if (!groups[category][normRegion]) groups[category][normRegion] = {};
            const compKey = company || '其他';
            if (!groups[category][normRegion][compKey]) groups[category][normRegion][compKey] = { logo, lines: [] };
            groups[category][normRegion][compKey].lines.push({ key, icon });
        });

        // Sorting logic (simplified from original for brevity, but keeping core structure)
        Object.values(groups).forEach(regionGroup => {
            Object.values(regionGroup).forEach(companyGroup => {
                Object.values(companyGroup).forEach(companyData => {
                   companyData.lines.sort((a, b) => a.key.localeCompare(b.key, 'ja'));
                });
            });
        });

        return { groups };
    }, [railwayData, allowedLines]);

    const regionsForActiveTab = useMemo(() => {
        if (!groups[activeTab]) return ['all'];
        const regs = Object.keys(groups[activeTab]);
        const order = ['北海道・東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄', '其他'];
        regs.sort((a, b) => {
            const idxA = order.indexOf(a);
            const idxB = order.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return idxA !== -1 ? -1 : 1;
        });
        return ['all', ...regs];
    }, [groups, activeTab]);

    useEffect(() => {
        if (!regionsForActiveTab.includes(selectedRegion)) setSelectedRegion('all');
    }, [activeTab, regionsForActiveTab]);

    if (!isOpen) return null;
    const currentRegionData = groups[activeTab];

    return createPortal(
        <div className="fixed inset-0 z-[600] bg-black/50 flex items-center justify-center p-4 animate-fade-in pointer-events-auto" onClick={onClose}>
            <div className="bg-white w-full max-w-2xl max-h-[85vh] h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up ring-1 ring-black/5" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800"><MapIcon size={20}/> 选择线路</h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                <div className="flex border-b bg-white shrink-0">
                    {['JR', 'Private', 'City'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>{tab === 'JR' ? 'JR 集団' : tab === 'Private' ? '私鉄・第三セクター' : '地下鉄・新交通'}</button>
                    ))}
                </div>
                <div className="p-2 border-b bg-white overflow-x-auto flex gap-2 shrink-0 no-scrollbar">
                    {regionsForActiveTab.length > 1 ? (regionsForActiveTab.map(r => (<button key={r} onClick={() => setSelectedRegion(r)} className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${selectedRegion === r ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{r === 'all' ? '全部地域' : r}</button>))) : (<span className="text-xs text-gray-400 px-2 py-1">无地域分类</span>)}
                </div>
                <div className="flex-1 overflow-y-auto bg-gray-50">
                    {(!currentRegionData || Object.keys(currentRegionData).length === 0) ? (
                        <div className="text-center text-gray-400 py-10">无符合条件的线路</div>
                    ) : (
                        Object.keys(currentRegionData).map(region => {
                            if (selectedRegion !== 'all' && selectedRegion !== region) return null;
                            return (
                                <div key={region} className="relative">
                                    <div className="sticky top-0 z-10 bg-gray-100/95 backdrop-blur border-y border-gray-200 px-4 py-1.5">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{region}</h4>
                                    </div>
                                    <div className="p-4 grid gap-4">
                                        {Object.entries(currentRegionData[region]).map(([company, data]) => (
                                            <div key={company} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                                                    {data.logo ? (<img src={data.logo} alt="" className="company-logo-sm h-5 w-auto" />) : (<Building2 size={16} className="text-gray-400"/>)}
                                                    <span className="font-bold text-sm text-gray-700">{company}</span>
                                                </div>
                                                <div className="divide-y divide-gray-50">
                                                    {data.lines.map(line => {
                                                        const displayName = line.key.includes(':') ? line.key.split(':').slice(1).join(':') : line.key;
                                                        return (
                                                        <button key={line.key} onClick={() => { onSelect(line.key); onClose(); }} className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group">
                                                            {line.icon ? (<img src={line.icon} alt="" className="line-icon" />) : (
                                                                data.logo ? <img src={data.logo} alt="" className="line-icon opacity-50 grayscale" /> : <Train size={14} className="text-gray-300 group-hover:text-blue-400"/>
                                                            )}
                                                            {displayName}
                                                        </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
