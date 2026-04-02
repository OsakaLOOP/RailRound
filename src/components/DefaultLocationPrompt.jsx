import React, { useState, useEffect } from 'react';
import { MapPin, Navigation, Map, Check, Globe } from 'lucide-react';
import { createPortal } from 'react-dom';

const CITIES = {
    Japan: [
        { label: '东京', lat: 35.68, lng: 139.76 },
        { label: '大阪', lat: 34.69, lng: 135.50 },
        { label: '京都', lat: 35.01, lng: 135.76 },
        { label: '名古屋', lat: 35.18, lng: 136.90 },
        { label: '札幌', lat: 43.06, lng: 141.35 },
        { label: '福冈', lat: 33.59, lng: 130.40 },
    ],
    China: [
        { label: '北京', lat: 39.90, lng: 116.40 },
        { label: '上海', lat: 31.23, lng: 121.47 },
        { label: '广州', lat: 23.12, lng: 113.26 },
        { label: '深圳', lat: 22.54, lng: 114.05 },
        { label: '南京', lat: 32.06, lng: 118.79 },
        { label: '杭州', lat: 30.27, lng: 120.15 },
    ]
};

export default function DefaultLocationPrompt({ onClose }) {
    const [mode, setMode] = useState(null); // 'latest' | 'fixed'
    const [country, setCountry] = useState(null); // 'Japan' | 'China'
    const [selectedCity, setSelectedCity] = useState(null);

    const handleConfirm = () => {
        let pref = {};
        if (mode === 'latest') {
            pref = { mode: 'latest' };
        } else if (mode === 'fixed' && selectedCity) {
            pref = { mode: 'fixed', center: [selectedCity.lat, selectedCity.lng], label: selectedCity.label };
        } else {
            return; // Selection not complete
        }

        localStorage.setItem('rail_default_location_pref', JSON.stringify(pref));
        onClose();
    };

    const isReady = mode === 'latest' || (mode === 'fixed' && selectedCity);

    return createPortal(
        <div className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in pointer-events-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 bg-slate-50 border-b flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
                        <Map size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-lg text-slate-800">设置默认地图中心</h3>
                        <p className="text-xs text-slate-500 mt-1">每次打开应用时，地图应该停留在哪里？</p>
                    </div>
                </div>

                <div className="p-6 flex-1 overflow-y-auto">
                    {/* Primary Mode Selection */}
                    <div className="flex flex-col gap-3 mb-6">
                        <button
                            onClick={() => { setMode('latest'); setSelectedCity(null); }}
                            className={`p-4 rounded-xl border-2 flex items-center gap-4 transition-all text-left ${mode === 'latest' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${mode === 'latest' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                <Navigation size={16} />
                            </div>
                            <div className="flex-1">
                                <div className={`font-bold ${mode === 'latest' ? 'text-emerald-800' : 'text-slate-700'}`}>跟随最新记录</div>
                                <div className="text-xs text-slate-500 mt-0.5">地图将自动定位到您最近一次行程的终点站</div>
                            </div>
                            {mode === 'latest' && <Check className="text-emerald-500" size={20} />}
                        </button>

                        <button
                            onClick={() => setMode('fixed')}
                            className={`p-4 rounded-xl border-2 flex items-center gap-4 transition-all text-left ${mode === 'fixed' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${mode === 'fixed' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                <MapPin size={16} />
                            </div>
                            <div className="flex-1">
                                <div className={`font-bold ${mode === 'fixed' ? 'text-emerald-800' : 'text-slate-700'}`}>固定常用地点</div>
                                <div className="text-xs text-slate-500 mt-0.5">每次打开地图时都定位到您指定的城市</div>
                            </div>
                            {mode === 'fixed' && <Check className="text-emerald-500" size={20} />}
                        </button>
                    </div>

                    {/* Secondary Selection (Country & City) */}
                    {mode === 'fixed' && (
                        <div className="animate-fade-in space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-2 block flex items-center gap-1"><Globe size={14}/> 选择区域</label>
                                <div className="flex gap-2">
                                    {['Japan', 'China'].map(c => (
                                        <button
                                            key={c}
                                            onClick={() => { setCountry(c); setSelectedCity(null); }}
                                            className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-colors border ${country === c ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                        >
                                            {c === 'Japan' ? '日本' : '中国'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {country && (
                                <div className="animate-fade-in">
                                    <label className="text-xs font-bold text-slate-500 mb-2 block">选择城市</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {CITIES[country].map(city => (
                                            <button
                                                key={city.label}
                                                onClick={() => setSelectedCity(city)}
                                                className={`py-2 px-3 rounded-lg text-sm transition-all border ${selectedCity?.label === city.label ? 'bg-emerald-500 text-white border-emerald-600 shadow-md font-bold' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}`}
                                            >
                                                {city.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                    >
                        跳过并使用默认(东京)
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!isReady}
                        className="px-6 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                        保存设置
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
