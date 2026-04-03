import React, { useState, useEffect, useRef } from 'react';
import { Bell, Clock, GitCommit, Loader2, AlertCircle, MapPin } from 'lucide-react';

const VersionBadge = ({ version: currentVersion }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [showDot, setShowDot] = useState(false);
    const [show, setShow] = useState(false);
    
    const modalContentRef = useRef(null);
    const timerRef = useRef(null);

    // Data States
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    const open = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setShow(true);
        if (showDot) {
            localStorage.setItem('rail_last_viewed_version', String(currentVersion));
            setShowDot(false);
        }
    };

    const close = () => {
        timerRef.current = setTimeout(() => {
            setShow(false);
        }, 200); 
    };

    const handleTriggerWheel = (e) => {
        if (show && modalContentRef.current) {
            modalContentRef.current.scrollBy({
                top: e.deltaY,
                behavior: 'smooth'
            });
        }
    };

    useEffect(() => {
        const lastViewed = localStorage.getItem('rail_last_viewed_version');
        if (!lastViewed || lastViewed !== String(currentVersion)) {
            setShowDot(true);
        }

    }, [currentVersion]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        
        fetch(`/changelog.json?t=${new Date().getTime()}`)
            .then(res => {
                if (!res.ok) throw new Error("Failed to load");
                return res.json();
            })
            .then(json => {
                if (active) {
                    setData(json);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (active) {
                    setError(true);
                    setLoading(false);
                }
            });

        return () => { active = false; };
    }, []);

    const getTypeStyle = (type) => {
        switch (type) {
            case 'feat': return 'bg-emerald-100 text-emerald-600 border-emerald-200';
            case 'fix': return 'bg-blue-100 text-blue-600 border-blue-200';
            case 'security': return 'bg-red-100 text-red-600 border-red-200';
            case 'next': return 'bg-purple-100 text-purple-600 border-purple-200';
            default: return 'bg-gray-100 text-gray-500 border-gray-200';
        }
    };

    return (
        <div 
            className="relative flex items-center z-50" 
            onWheel={handleTriggerWheel}
            onMouseEnter={open} 
            onMouseLeave={close}
        >
            {/* Badge Trigger */}
            <span className="cursor-help bg-[#39C5BB] hover:bg-teal-500 transition-colors text-white rounded px-1.5 py-0.5 text-[10px] font-bold ml-2 shadow-sm flex items-center gap-1 relative">
                v{currentVersion}
                {showDot && (
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse absolute -top-1 -right-1 border border-slate-900 shadow-sm pointer-events-none"></span>
                )}
            </span>

            {/* Popover Modal */}
            {show && (
                <div className="absolute top-full left-0 mt-3 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 p-0 overflow-hidden animate-fade-in origin-top-left">
                    
                    {/* Header */}
                    <div className="bg-slate-50 p-3 border-b border-gray-100 flex justify-between items-center relative z-20">
                        <div className="flex items-center gap-2 text-slate-700 font-bold text-xs">
                            <Bell size={14} className="text-[#39C5BB]" />
                            <span>更新日志</span>
                        </div>
                        {data?.meta?.lastUpdated && (
                            <span className="text-[10px] text-gray-400 font-mono bg-white px-1.5 py-0.5 rounded border">
                                {data.meta.lastUpdated}
                            </span>
                        )}
                    </div>

                    {/* Content Body */}
                    <div ref={modalContentRef} className="min-h-[100px] max-h-[300px] overflow-y-auto custom-scrollbar p-3 bg-slate-50/30 relative">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-4 text-gray-400 gap-2">
                                <Loader2 size={16} className="animate-spin"/>
                                <span className="text-xs">加载日志中...</span>
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center py-4 text-red-400 gap-2">
                                <AlertCircle size={16}/>
                                <span className="text-xs">无法获取更新日志</span>
                            </div>
                        ) : (
                            <div className="relative">
                                {data.logs.map((log, idx) => {
                                    const showDivider = idx > 0 && data.logs[idx - 1].type === 'next' && log.type !== 'next';
                                    const isLastItem = idx === data.logs.length - 1;
                                    
                                    const isPrecedingDivider = !isLastItem && log.type === 'next' && data.logs[idx + 1] && data.logs[idx + 1].type !== 'next';
                                    
                                    return (
                                        <React.Fragment key={idx}>
                                            {showDivider && (
                                                <div className="flex items-center gap-2 py-1 mt-0 mb-1 animate-fade-in relative z-20 my-1">
                                                    <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-slate-200 flex-1 border-t border-dashed border-slate-300"></div>
                                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 bg-white px-2 py-0.5 rounded-full border border-slate-100 shadow-sm">
                                                        <MapPin size={10} className="text-[#39C5BB]" fill="currentColor" />
                                                        You are here
                                                    </span>
                                                    <div className="h-px bg-gradient-to-l from-transparent via-slate-200 to-slate-200 flex-1 border-t border-dashed border-slate-300"></div>
                                                </div>
                                            )}

                                            <div className={`flex gap-3 items-stretch group relative ${!isLastItem ? 'pb-4' : ''}`}>
                                                {/* Line and Badge Container */}
                                                <div className="mt-0.5 min-w-[36px] flex flex-col items-center shrink-0 relative">
                                                    
                                                    {/* Top Line (Connects to previous) */}
                                                    {idx > 0 && !showDivider && (
                                                        <div className="absolute -top-4 h-6 w-px bg-slate-200"></div>
                                                    )}
                                                    
                                                    {/* Bottom Line (Connects to next) */}
                                                    {!isLastItem && (
                                                        <div className="absolute top-2 h-full w-px bg-slate-200"></div>
                                                    )}

                                                    <span className={`relative z-10 text-[10px] font-bold px-1.5 py-0.5 rounded block text-center border shadow-sm ${getTypeStyle(log.type)}`}>
                                                        v{log.version}
                                                    </span>
                                                </div>

                                                <div className="flex-1 pt-0.5">
                                                    <div className="text-xs text-gray-700 leading-relaxed font-medium group-hover:text-black transition-colors">
                                                        {log.content}
                                                    </div>
                                                    <div className="text-[10px] text-gray-300 mt-1">{log.date}</div>
                                                </div>
                                            </div>
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-2 bg-slate-900 text-white text-[10px] flex justify-between items-center px-3 relative z-20">
                        <div className="flex items-center gap-1 opacity-70">
                            <Clock size={10} />
                            <span>Latest: {data?.meta?.latestVersion || currentVersion}</span>
                        </div>
                        <a href="https://github.com/OsakaLOOP/RailRound" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#39C5BB] transition-colors font-bold">
                            Full History <GitCommit size={10} />
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export { VersionBadge };