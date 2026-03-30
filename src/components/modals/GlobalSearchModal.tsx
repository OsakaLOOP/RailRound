import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Map as MapIcon, MapPin, Building2, Train } from 'lucide-react';
import { useStore } from '../../store';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (lineKey: string, stationId?: string) => void;
}

export const GlobalSearchModal: React.FC<Props> = ({ isOpen, onClose, onSelect }) => {
    const railwayData = useStore(state => state.railwayData);
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const results = useMemo(() => {
        if (!query.trim()) return { lines: [], stations: [] };

        const lowerQuery = query.toLowerCase();
        const matchedLines: any[] = [];
        const matchedStations: any[] = [];

        Object.entries(railwayData).forEach(([lineKey, lineData]) => {
            const displayName = lineKey.includes(':') ? lineKey.split(':').slice(1).join(':') : lineKey;

            // Check line match
            if (lineKey.toLowerCase().includes(lowerQuery) || displayName.toLowerCase().includes(lowerQuery)) {
                matchedLines.push({
                    lineKey,
                    displayName,
                    company: lineData.meta.company || '',
                    logo: lineData.meta.logo || null,
                    icon: lineData.meta.icon || null
                });
            }

            // Check station match
            lineData.stations.forEach(station => {
                if (station.name_ja.toLowerCase().includes(lowerQuery)) {
                    matchedStations.push({
                        lineKey,
                        lineDisplayName: displayName,
                        stationId: station.id,
                        stationName: station.name_ja,
                        company: lineData.meta.company || '',
                        logo: lineData.meta.logo || null,
                        icon: lineData.meta.icon || null
                    });
                }
            });
        });

        // (the code up there already populated `matchedLines` and `matchedStations` so no need to do performSearch here)
        return {
            lines: matchedLines.slice(0, 50), // Limit results for performance
            stations: matchedStations.slice(0, 100)
        };
    }, [query, railwayData]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[700] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div
                className="bg-white w-full max-w-2xl max-h-[85vh] h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up ring-1 ring-black/5"
                onClick={e => e.stopPropagation()}
            >
                {/* Header / Search Input */}
                <div className="p-4 border-b bg-white flex items-center gap-3 shrink-0 sticky top-0 z-20 shadow-sm">
                    <Search className="text-gray-400" size={20} />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="搜索线路或车站..."
                        className="flex-1 bg-transparent border-none outline-none text-lg text-gray-800 placeholder:text-gray-400"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="p-1 hover:bg-gray-100 rounded-full text-gray-400 transition">
                            <X size={16} />
                        </button>
                    )}
                    <button onClick={onClose} className="p-2 ml-2 hover:bg-gray-100 rounded-full text-gray-500 transition">
                        关闭
                    </button>
                </div>

                {/* Results Area */}
                <div className="flex-1 overflow-y-auto bg-gray-50">
                    {!query.trim() ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <Search size={48} className="text-gray-200" />
                            <p>输入线路名或车站名进行搜索</p>
                        </div>
                    ) : results.lines.length === 0 && results.stations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <p>没有找到相关结果</p>
                        </div>
                    ) : (
                        <div className="p-4 space-y-6">
                            {/* Line Results */}
                            {results.lines.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                                        <Train size={14} /> 线路 ({results.lines.length})
                                    </h4>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                                        {results.lines.map((line, idx) => (
                                            <button
                                                key={`line-${idx}`}
                                                onClick={() => { onSelect(line.lineKey); onClose(); }}
                                                className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                                            >
                                                {line.icon ? (
                                                    <img src={line.icon} alt="" className="line-icon w-5 h-5 object-contain" />
                                                ) : line.logo ? (
                                                    <img src={line.logo} alt="" className="line-icon w-5 h-5 object-contain opacity-70 grayscale" />
                                                ) : (
                                                    <MapIcon size={16} className="text-gray-300 group-hover:text-blue-400" />
                                                )}
                                                <div className="flex-1">
                                                    <div className="font-bold text-gray-800">{line.displayName}</div>
                                                    <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                                                        {line.company && <><Building2 size={10} /> {line.company}</>}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Station Results */}
                            {results.stations.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                                        <MapPin size={14} /> 车站 ({results.stations.length})
                                    </h4>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                                        {results.stations.map((station, idx) => (
                                            <button
                                                key={`station-${idx}`}
                                                onClick={() => { onSelect(station.lineKey, station.stationId); onClose(); }}
                                                className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                                            >
                                                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                                                    <MapPin size={12} className="text-emerald-600" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-gray-800 text-base">{station.stationName}</div>
                                                    <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5 truncate">
                                                        {station.icon ? (
                                                            <img src={station.icon} alt="" className="w-3 h-3 object-contain inline-block" />
                                                        ) : station.logo ? (
                                                            <img src={station.logo} alt="" className="w-3 h-3 object-contain inline-block grayscale opacity-60" />
                                                        ) : (
                                                            <Train size={10} />
                                                        )}
                                                        <span className="truncate">{station.lineDisplayName}</span>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
