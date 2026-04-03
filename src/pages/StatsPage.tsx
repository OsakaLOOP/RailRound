import React, { useMemo, useState } from 'react';
import { Github, Folder, TrendingUp, Move, MapPin, Map as MapIcon} from 'lucide-react';
import { useStore } from '../store';
import { calcDist } from '../core/tripCalculator';
import * as turf from '@turf/turf';
import { useShallow } from 'zustand/react/shallow';
import { useUserData } from '../hooks/useUserData';

const CITIES = {
    China: [
        { name: '北京', lat: 39.9042, lng: 116.4074 },
        { name: '上海', lat: 31.2304, lng: 121.4737 },
        { name: '广州', lat: 23.1291, lng: 113.2644 },
        { name: '深圳', lat: 22.5431, lng: 114.0579 },
        { name: '南京', lat: 32.0603, lng: 118.7969 },
        { name: '杭州', lat: 30.2741, lng: 120.1551 },
    ],
    Japan: [
        { name: '東京', lat: 35.6812, lng: 139.7671 },
        { name: '大阪', lat: 34.6937, lng: 135.5023 },
        { name: '京都', lat: 35.0116, lng: 135.7681 },
        { name: '札幌', lat: 43.0618, lng: 141.3545 },
        { name: '福岡', lat: 33.5902, lng: 130.4017 },
        { name: '名古屋', lat: 35.1815, lng: 136.9066 },
    ]
};

export const StatsPage: React.FC = () => {
    const {
        trips, railwayData, geoData, user, userProfile, segmentGeometries, companyDB, badgeSettings, setBadgeSettings, pins, folders
    } = useStore(useShallow(state => ({
        trips: state.trips,
        railwayData: state.railwayData,
        geoData: state.geoData,
        user: state.user,
        userProfile: state.userProfile,
        segmentGeometries: state.segmentGeometries,
        companyDB: state.companyDB,
        badgeSettings: state.badgeSettings,
        setBadgeSettings: state.setBadgeSettings,
        pins: state.pins,
        folders: state.folders
    })));
    const setModalState = useStore(state => state.setModalState);
    const { saveData } = useUserData();

    const { totalTrips, uniqueLines, totalDist, totalCost, rankedSegments } = useMemo(() => {
        const _totalTrips = trips.length;
        let _totalCost = 0;
        let _totalDist = 0;

        const uniqueLinesSet = new Set<string>();
        const counts = new Map<string, number>();

        for (let i = 0; i < trips.length; i++) {
            const t = trips[i];
            _totalCost += (t.cost || 0);

            const segments = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
            for (let j = 0; j < segments.length; j++) {
                const seg = segments[j];
                if (!seg.lineKey) continue;

                uniqueLinesSet.add(seg.lineKey);
                counts.set(seg.lineKey, (counts.get(seg.lineKey) || 0) + 1);

                if (segmentGeometries && turf) {
                    const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                    const geom = segmentGeometries.get(key);
                    if (geom && geom.coords) {
                        if (geom.isMulti) {
                            for (let k = 0; k < geom.coords.length; k++) {
                                const c = geom.coords[k];
                                _totalDist += turf.length(turf.lineString(c.map((p: any) => [p[1], p[0]])));
                            }
                        } else {
                            _totalDist += turf.length(turf.lineString(geom.coords.map((p: any) => [p[1], p[0]])));
                        }
                    } else {
                        const line = railwayData[seg.lineKey];
                        if (line && line.stations) {
                            let s1, s2;
                            for (let k = 0; k < line.stations.length; k++) {
                                const st = line.stations[k];
                                if (st.id === seg.fromId) s1 = st;
                                else if (st.id === seg.toId) s2 = st;
                                if (s1 && s2) break;
                            }
                            if (s1 && s2) _totalDist += calcDist(s1.lat, s1.lng, s2.lat, s2.lng);
                        }
                    }
                }
            }
        }

        const _uniqueLines = uniqueLinesSet.size;
        const _rankedSegments = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

        return { totalTrips: _totalTrips, uniqueLines: _uniqueLines, totalDist: _totalDist, totalCost: _totalCost, rankedSegments: _rankedSegments };
    }, [trips, segmentGeometries, railwayData]);

    const uniqueStationsCount = useMemo(() => {
        let count = 0;
        if (railwayData) {
            const uniqueStations = new Set<string>();
            for (const lineKey in railwayData) {
                if (Object.prototype.hasOwnProperty.call(railwayData, lineKey)) {
                    const line = railwayData[lineKey];
                    if (line.stations) {
                        for (let i = 0; i < line.stations.length; i++) {
                            uniqueStations.add(line.stations[i].id);
                        }
                    }
                }
            }
            count = uniqueStations.size;
        }
        return count;
    }, [railwayData]);

    return (
      <div id="stats-view-content" className="flex-1 overflow-y-auto p-4 space-y-4">
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
                                <button onClick={() => window.open('/api/oauth?provider=github', '_self')} className="flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded text-xs font-bold hover:bg-black transition-colors"><Github size={12}/> 绑定 GitHub</button>
                            )}
                        </div>
                    </div>
                </div>
                {userProfile?.bindings?.github && (
                   <button onClick={() => setModalState({ cardModalUser: user })} className="absolute right-4 top-4 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                       <Github size={14}/> 装饰代码
                   </button>
                )}
            </div>
        )}

        <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border text-center hover:scale-102 hover:shadow-md transition-all duration-300 cursor-default"><div className="text-xs text-gray-400 mb-1">记录数</div><div className="text-3xl font-bold text-gray-800">{totalTrips}</div></div>
            <div className="bg-white p-4 rounded-xl shadow-sm border text-center hover:scale-102 hover:shadow-md transition-all duration-300 cursor-default"><div className="text-xs text-gray-400 mb-1">制霸路线</div><div className="text-3xl font-bold text-indigo-600">{uniqueLines}</div></div>
        </div>

        <div className="space-y-4">
            <button onClick={() => setModalState({ folderManagerOpen: true })} className="w-full bg-white p-4 rounded-xl shadow-sm border flex items-center justify-between group hover:bg-gray-50 transition-colors">
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

            {/* Personal Settings */}
            <div className="bg-white rounded-xl shadow-sm border p-4 flex flex-col gap-4">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">个人偏好设置</div>
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-gray-700 font-bold text-sm">
                            <MapIcon size={16} /> 地图初始位置
                        </div>
                        <div className="flex items-center bg-gray-100 rounded-lg p-1">
                            <button
                                onClick={() => {
                                    const newSettings = { ...badgeSettings, defaultMapCenter: { mode: 'fixed' as const, lat: badgeSettings.defaultMapCenter?.lat || 35.6812, lng: badgeSettings.defaultMapCenter?.lng || 139.7671 } };
                                    setBadgeSettings(newSettings);
                                    if (user) saveData(user.token, trips, pins, folders, newSettings).catch(console.error);
                                }}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${(!badgeSettings.defaultMapCenter || badgeSettings.defaultMapCenter.mode === 'fixed') ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                固定兴趣
                            </button>
                            <button
                                onClick={() => {
                                    const newSettings = { ...badgeSettings, defaultMapCenter: { mode: 'latest' as const, lat: badgeSettings.defaultMapCenter?.lat || 35.6812, lng: badgeSettings.defaultMapCenter?.lng || 139.7671 } };
                                    setBadgeSettings(newSettings);
                                    if (user) saveData(user.token, trips, pins, folders, newSettings).catch(console.error);
                                }}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${badgeSettings.defaultMapCenter?.mode === 'latest' ? 'bg-white shadow text-amber-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                跟随最新
                            </button>
                        </div>
                    </div>
                    {(!badgeSettings.defaultMapCenter || badgeSettings.defaultMapCenter.mode === 'fixed') && (
                        <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                            <MapPin size={14} className="text-emerald-500 shrink-0 ml-1" />
                            <select
                                className="bg-transparent text-gray-700 text-sm font-bold w-full outline-none cursor-pointer"
                                value={`${badgeSettings.defaultMapCenter?.lat || 35.6812},${badgeSettings.defaultMapCenter?.lng || 139.7671}`}
                                onChange={(e) => {
                                    const [lat, lng] = e.target.value.split(',').map(Number);
                                    const newSettings = { ...badgeSettings, defaultMapCenter: { mode: 'fixed' as const, lat, lng } };
                                    setBadgeSettings(newSettings);
                                    if (user) saveData(user.token, trips, pins, folders, newSettings).catch(console.error);
                                }}
                            >
                                {Object.entries(CITIES).map(([country, cities]) => (
                                    <optgroup key={country} label={country === 'China' ? '中国' : '日本'}>
                                        {cities.map(city => (
                                            <option key={city.name} value={`${city.lat},${city.lng}`}>{city.name}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-teal-600 hover:to-emerald-800 p-6 rounded-xl shadow-lg text-white transition-all duration-500 hover:-translate-y-1 hover:shadow-xl cursor-default group">
            <div className="flex items-center justify-between mb-2"><h3 className="font-bold flex items-center gap-2"><TrendingUp size={18} className="group-hover:-translate-y-1 group-hover:scale-110 transition-transform duration-300"/> 里程统计</h3><span className="text-xs bg-white/20 px-2 py-1 rounded">总距离</span></div>
            <div className="text-4xl font-bold mb-2">{Math.round(totalDist)} <span className="text-lg font-normal opacity-80">km</span></div>
            <div className="border-t border-white/20 pt-2 flex items-center gap-2 text-sm opacity-90"><span className="font-bold">¥</span> 总开销: {totalCost.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border overflow-hidden"><div className="p-3 border-b bg-slate-50 font-bold text-sm text-slate-600">常乘路线排行</div>
          {rankedSegments.map(([line, count]: [string, any], idx) => {
              const icon = railwayData[line]?.meta?.icon;
              return (
                  <div key={line} className="p-3 border-b last:border-0 flex justify-between items-center hover:bg-slate-50 transition-colors duration-200">
                      <div className="flex items-center gap-3">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${idx===0?'bg-yellow-100 text-yellow-700':'bg-slate-100 text-slate-600'}`}>{idx+1}</span>
                          {icon && <img src={icon} alt="" className="line-icon" />}
                          <span>{line}</span>
                      </div>
                      <span className="font-bold text-slate-400 text-sm">{count}</span>
                  </div>
              )
          })}
        </div>

        <div className="text-center text-xs text-gray-400 mt-8 pb-4">
             加载了 {Object.keys(companyDB).length} 家公司，
             {Object.keys(railwayData).length} 条线路，
             {uniqueStationsCount} 个站点。<br/>
             <div className="relative flex py-5 items-center mt-4 text-gray-500">
                <div className="flex-grow border-t-2 border-dashed border-gray-300/70"></div>
                <span className="flex-shrink mx-4 px-3 py-1 text-sm font-bold tracking-[0.2em] bg-slate-50 rounded-full shadow-sm border border-gray-100 text-gray-600">
                  分・割・線・な・の・だ
                </span>
                <div className="flex-grow border-t-2 border-dashed border-gray-300/70"></div>
             </div>
             Licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-500 hover:underline transition-all">CC BY-SA 4.0</a>
             <br/>
             Copyleft <span aria-label="Copyleft icon" style={{display: 'inline-block', transform: 'rotateY(180deg)'}}>&copy;</span> 2026-2027 @OsakaLOOP
             <br/>
             <div><span style={{ display: "inline" }}>更多详情, 参见</span><button style={{ display: "inline" }} onClick={() => setModalState({ isLoginOpen: true })} className="text-xs text-blue-400 hover:text-blue-500 hover:underline transition-all items-center gap-1">用户指南</button></div>
        </div>
      </div>
    );
};
