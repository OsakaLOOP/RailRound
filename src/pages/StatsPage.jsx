import React, { useEffect, useState } from 'react';
import { useAuth, useUserData, useGeo } from '../globalContext';
import { api } from '../services/api';
import { Github, Folder, TrendingUp, Move, Eye, EyeOff, Loader2, Lock, X } from 'lucide-react';
import { useNavigate, Outlet } from 'react-router-dom';
import { VersionBadge } from '../components/VersionBadge';

// Helper to calc stats using worker
const useAsyncStats = (trips, workerRef) => {
    const [stats, setStats] = useState({ totalTrips: 0, uniqueLines: 0, totalDist: 0, totalCost: 0, topLines: [] });

    useEffect(() => {
        if (!workerRef.current || trips.length === 0) return;

        // Use Worker to calculate latest 5 (and total dist/lines)
        const id = Date.now() + Math.random();
        const handler = (e) => {
            if (e.data.id === id && e.data.success) {
                const res = e.data.result;
                // Aggregate top lines locally since worker logic for latest5 doesn't include full aggregation
                // Or I can add aggregation to worker. For now, aggregate locally as it's not super heavy (looping trips).

                // Local Aggregation for Top Lines & Cost
                let cost = 0;
                const lineCounts = {};
                trips.forEach(t => {
                    cost += (t.cost || 0);
                    (t.segments || [{lineKey:t.lineKey}]).forEach(s => {
                        lineCounts[s.lineKey] = (lineCounts[s.lineKey]||0)+1;
                    });
                });
                const top = Object.entries(lineCounts).sort((a,b) => b[1]-a[1]).slice(0, 3);

                setStats({
                    totalTrips: res.count,
                    uniqueLines: res.lines,
                    totalDist: res.dist,
                    totalCost: cost,
                    topLines: top
                });
                workerRef.current.removeEventListener('message', handler);
            }
        };
        workerRef.current.addEventListener('message', handler);
        workerRef.current.postMessage({ type: 'CALC_STATS', id, payload: { trips } });

        return () => workerRef.current?.removeEventListener('message', handler);

    }, [trips, workerRef]);

    return stats;
};

export default function StatsPage() {
    const { trips, folders, badgeSettings } = useUserData();
    const { user, userProfile } = useAuth();
    const { railwayData, companyDB, workerRef } = useGeo();
    const navigate = useNavigate();

    const stats = useAsyncStats(trips, workerRef);
    const meta = React.useContext(React.createContext(null)); // Mock or use useMeta

    return (
      <div id="stats-view-content" className="flex-1 overflow-y-auto p-4 space-y-4 pb-24 pointer-events-auto bg-slate-100 min-h-full">
        {user && (
            <div className="bg-white p-4 rounded-xl shadow-sm border relative">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center text-xl font-bold text-gray-500 overflow-hidden">
                        {userProfile?.bindings?.github?.avatar_url ? (
                            <img src={userProfile.bindings.github.avatar_url} alt="Avatar" className="w-full h-full object-cover"/>
                        ) : (
                            user.username.charAt(0).toUpperCase()
                        )}
                    </div>
                    <div>
                        <div className="font-bold text-lg">{user.username}</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                            {userProfile?.bindings?.github ? (
                                <span className="flex items-center gap-1 text-emerald-600"><Github size={12}/> GitHub 已绑定 ({userProfile.bindings.github.login})</span>
                            ) : (
                                <button onClick={() => api.initiateOAuth('github', user?.token)} className="flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded text-xs font-bold hover:bg-black transition-colors"><Github size={12}/> 绑定 GitHub</button>
                            )}
                        </div>
                    </div>
                </div>
                {userProfile?.bindings?.github && (
                   <button onClick={() => navigate('/stats/card')} className="absolute right-4 top-4 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                       <Github size={14}/> 装饰代码
                   </button>
                )}
            </div>
        )}

        <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border text-center"><div className="text-xs text-gray-400 mb-1">记录数</div><div className="text-3xl font-bold text-gray-800">{stats.totalTrips}</div></div>
            <div className="bg-white p-4 rounded-xl shadow-sm border text-center"><div className="text-xs text-gray-400 mb-1">制霸路线</div><div className="text-3xl font-bold text-indigo-600">{stats.uniqueLines}</div></div>
        </div>

        {user && (
            <button onClick={() => navigate('/stats/folders')} className="w-full bg-white p-4 rounded-xl shadow-sm border flex items-center justify-between group hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center text-yellow-600">
                        <Folder size={20}/>
                    </div>
                    <div className="text-left">
                        <div className="font-bold text-gray-800">Star Folders</div>
                        <div className="text-xs text-gray-400">Manage trip collections & badges</div>
                    </div>
                </div>
                <Move size={16} className="text-gray-300 group-hover:text-gray-500"/>
            </button>
        )}

        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-6 rounded-xl shadow-lg text-white">
            <div className="flex items-center justify-between mb-2"><h3 className="font-bold flex items-center gap-2"><TrendingUp size={18}/> 里程统计</h3><span className="text-xs bg-white/20 px-2 py-1 rounded">总距离</span></div>
            <div className="text-4xl font-bold mb-2">{Math.round(stats.totalDist)} <span className="text-lg font-normal opacity-80">km</span></div>
            <div className="border-t border-white/20 pt-2 flex items-center gap-2 text-sm opacity-90"><span className="font-bold">¥</span> 总开销: {stats.totalCost.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border overflow-hidden"><div className="p-3 border-b bg-slate-50 font-bold text-sm text-slate-600">常乘路线排行</div>
          {stats.topLines.map(([line, count], idx) => { const icon = railwayData[line]?.meta?.icon; return ( <div key={line} className="p-3 border-b last:border-0 flex justify-between items-center"><div className="flex items-center gap-3"><span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${idx===0?'bg-yellow-100 text-yellow-700':'bg-slate-100 text-slate-600'}`}>{idx+1}</span>{icon && <img src={icon} alt="" className="line-icon" />}<span>{line}</span></div><span className="font-bold text-slate-400 text-sm">{count}</span></div> )})}
        </div>

        <div className="text-center text-xs text-gray-400 mt-8 pb-4">
             加载了 {companyDB ? Object.keys(companyDB).length : 0} 家公司，
             {railwayData ? Object.keys(railwayData).length : 0} 条线路。<br/>
             <div className="relative flex py-5 items-center mt-4 text-gray-500">
                <div className="flex-grow border-t-2 border-dashed border-gray-300/70"></div>
                <span className="flex-shrink mx-4 px-3 py-1 text-sm font-bold tracking-[0.2em] bg-slate-50 rounded-full shadow-sm border border-gray-100 text-gray-600">
                  分・割・線・な・の・だ
                </span>
                <div className="flex-grow border-t-2 border-dashed border-gray-300/70"></div>
            </div>
             Lisenced under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-500 hover:underline transition-all">CC BY-SA 4.0</a>
             <br/>
             Copyleft <span aria-label="Copyleft icon" style={{display: 'inline-block', transform: 'rotateY(180deg)'}}>&copy;</span> 2025-2026 @OsakaLOOP
             <br/>
             <div><span display="inline">更多详情, 参见</span><button display="inline" onClick={() => navigate('/login')} className="text-xs text-blue-400 hover:text-blue-500 hover:underline transition-all items-center gap-1">用户指南</button>
        </div></div>
        <Outlet />
      </div>
    );
}
