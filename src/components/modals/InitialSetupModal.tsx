import React, { useState } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { MapPin, Globe, ChevronRight, Check } from 'lucide-react';
import { useUserData } from '../../hooks/useUserData';
import { useTranslation } from 'react-i18next';

interface InitialSetupModalProps {
    isOpen: boolean;
    onComplete: () => void;
}

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

// Intricate SVG for Fixed Interest (Local Discovery) - Emerald/Teal theme
const FixedInterestSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
        <defs>
            <linearGradient id="gradFixed" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#0f766e" />
            </linearGradient>
            <filter id="glowFixed">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <circle cx="100" cy="100" r="80" fill="url(#gradFixed)" opacity="0.1" />
        <path d="M100 30 C140 30 170 60 170 100 C170 140 140 170 100 170 C60 170 30 140 30 100 C30 60 60 30 100 30 Z" fill="none" stroke="url(#gradFixed)" strokeWidth="4" strokeDasharray="10 10" className="animate-spin-slow" style={{ transformOrigin: 'center' }} />
        {/* Map Pin / Compass motif */}
        <path d="M100 50 L120 90 L100 150 L80 90 Z" fill="url(#gradFixed)" filter="url(#glowFixed)" />
        <circle cx="100" cy="100" r="10" fill="white" />
        <circle cx="100" cy="100" r="2" fill="#0f766e" />
        <path d="M50 100 A 50 50 0 0 1 150 100" fill="none" stroke="#10b981" strokeWidth="2" opacity="0.6"/>
    </svg>
);

// Intricate SVG for Follow Latest (Exploration/Journey) - Amber/Orange theme
const FollowLatestSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
        <defs>
            <linearGradient id="gradLatest" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
            <filter id="glowLatest">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <circle cx="100" cy="100" r="80" fill="url(#gradLatest)" opacity="0.1" />
        {/* Winding tracks/paths */}
        <path d="M40 160 Q 80 160 100 100 T 160 40" fill="none" stroke="url(#gradLatest)" strokeWidth="8" strokeLinecap="round" filter="url(#glowLatest)" />
        <path d="M40 160 Q 80 160 100 100 T 160 40" fill="none" stroke="white" strokeWidth="2" strokeDasharray="5 10" className="animate-pulse" />
        {/* Stars/Nodes */}
        <circle cx="40" cy="160" r="6" fill="#f59e0b" />
        <circle cx="100" cy="100" r="8" fill="white" stroke="#f59e0b" strokeWidth="3" />
        <circle cx="160" cy="40" r="10" fill="url(#gradLatest)" />
        <path d="M150 40 L170 40 M160 30 L160 50" stroke="white" strokeWidth="2" />
        <path d="M50 50 A 60 60 0 0 1 150 150" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 8" opacity="0.5" className="animate-spin-slow" style={{ transformOrigin: 'center' }}/>
    </svg>
);


// Language SVG - Blue/Indigo theme
const LanguageSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-lg">
        <defs>
            <linearGradient id="gradLang" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#4338ca" />
            </linearGradient>
            <linearGradient id="gradLangLight" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#93c5fd" />
                <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
            <filter id="glowLang">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        {/* Background ambient ring */}
        <circle cx="100" cy="100" r="85" fill="none" stroke="url(#gradLangLight)" strokeWidth="2" opacity="0.4" strokeDasharray="4 8" className="animate-spin-slow" style={{ transformOrigin: 'center' }} />

        {/* Outer orbital path */}
        <circle cx="100" cy="100" r="65" fill="url(#gradLang)" opacity="0.05" />
        <path d="M35 100 A 65 65 0 0 1 165 100 A 65 65 0 0 1 35 100" fill="none" stroke="url(#gradLang)" strokeWidth="6" opacity="0.3" />

        {/* Animated connection line simulating communication */}
        <path d="M 60 120 Q 100 160 140 80" fill="none" stroke="url(#gradLangLight)" strokeWidth="3" filter="url(#glowLang)" strokeDasharray="100" strokeDashoffset="0">
            <animate attributeName="stroke-dashoffset" values="100;0;100" dur="4s" repeatCount="indefinite" />
        </path>

        {/* Left Speech Bubble - Translation/Dialogue */}
        <g transform="translate(45, 60)">
            <path d="M0 20 C0 8.954 8.954 0 20 0 L40 0 C51.046 0 60 8.954 60 20 C60 31.046 51.046 40 40 40 L15 40 L0 50 Z" fill="url(#gradLang)" filter="url(#glowLang)" opacity="0.9" />
            <text x="30" y="26" fontSize="20" fill="white" textAnchor="middle" fontWeight="800">あ</text>
        </g>

        {/* Right Speech Bubble - Translation/Dialogue */}
        <g transform="translate(105, 95)">
            <path d="M0 20 C0 8.954 8.954 0 20 0 L40 0 C51.046 0 60 8.954 60 20 C60 31.046 51.046 40 40 40 L50 50 L45 40 C54.341 38.384 60 30.046 60 20 Z" fill="url(#gradLangLight)" opacity="0.95" />
            <text x="30" y="27" fontSize="22" fill="#1e3a8a" textAnchor="middle" fontWeight="bold">A</text>
        </g>

        {/* Communication Nodes */}
        <circle cx="60" cy="115" r="4" fill="#3b82f6" />
        <circle cx="140" cy="85" r="6" fill="#4338ca" />
    </svg>
);

export const InitialSetupModal: React.FC<InitialSetupModalProps> = ({ isOpen, onComplete }) => {
    const { badgeSettings, setBadgeSettings, user, trips, pins, folders } = useStore(useShallow(state => ({
        badgeSettings: state.badgeSettings,
        setBadgeSettings: state.setBadgeSettings,
        user: state.user,
        trips: state.trips,
        pins: state.pins,
        folders: state.folders
    })));

    const { saveData } = useUserData();
    const { t } = useTranslation();

    // step 1: language, step 2: city
    const [step, setStep] = useState<1 | 2>(1);

    // Language state
    const [selectedLanguage, setSelectedLanguage] = useState<string>(badgeSettings.language || 'zh-cn');

    // City state
    const [mode, setMode] = useState<'fixed' | 'latest' | null>(null);
    const [selectedCountry, setSelectedCountry] = useState<keyof typeof CITIES | null>(null);
    const [selectedCity, setSelectedCity] = useState<{name: string, lat: number, lng: number} | null>({ name: '東京', lat: 35.6812, lng: 139.7671 });

    if (!isOpen) return null;

    const languages = [
        { id: 'zh-CN', label: '简体中文' },
        { id: 'en', label: 'English' },
        { id: 'ja-JP', label: '日本語' },
        { id: 'zh-TW', label: '繁體中文' }
    ];

    const handleSave = (overrideMode?: 'fixed' | 'latest') => {
        const finalMode = overrideMode || mode || 'fixed';
        const newSettings = {
            ...badgeSettings,
            language: selectedLanguage,
            defaultMapCenter: {
                mode: finalMode,
                lat: finalMode === 'fixed' && selectedCity ? selectedCity.lat : 35.6812,
                lng: finalMode === 'fixed' && selectedCity ? selectedCity.lng : 139.7671
            }
        };

        setBadgeSettings(newSettings);

        if (user) {
            saveData(user.token, trips, pins, folders, newSettings).catch(console.error);
        }

        onComplete();
    };

    return (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-scale-up relative">

                <div className={`absolute inset-0 flex flex-col transition-transform duration-500 ease-in-out ${step === 1 ? 'translate-x-0' : '-translate-x-full'} ${step === 1 ? 'opacity-100 relative' : 'opacity-0 absolute pointer-events-none'}`}>
                        <div className="p-8 pb-4 text-center">
                            <h2 className="text-3xl font-bold text-gray-800 mb-2">Language / 语言</h2>
                            <p className="text-gray-500">Choose your preferred language / 选择你的偏好语言</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 pt-4 flex flex-col items-center">
                             <div className="w-40 h-40 mb-8">
                                <LanguageSVG />
                            </div>
                            <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                                {languages.map(lang => (
                                    <button
                                        key={lang.id}
                                        onClick={() => setSelectedLanguage(lang.id)}
                                        className={`p-4 rounded-xl border-2 flex items-center justify-center font-bold transition-all ${selectedLanguage === lang.id ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-md' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50/50'}`}
                                    >
                                        <Globe size={18} className="mr-2 opacity-70" /> {lang.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
                             <button onClick={() => setStep(2)} className="px-6 py-2.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 transition-all flex items-center gap-2">
                                Next <ChevronRight size={16} />
                            </button>
                        </div>
                </div>

                <div className={`absolute inset-0 flex flex-col transition-transform duration-500 ease-in-out ${step === 2 ? 'translate-x-0' : 'translate-x-full'} ${step === 2 ? 'opacity-100 relative' : 'opacity-0 absolute pointer-events-none'}`}>
                        <div className="p-8 pb-4 text-center">
                            <h2 className="text-3xl font-bold text-gray-800 mb-2">你的探索起点</h2>
                            <p className="text-gray-500">每次打开地图时，你希望从哪里开始你的旅程？</p>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 pt-4">
                            {!mode ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <button
                                        onClick={() => setMode('fixed')}
                                        className="group relative flex flex-col items-center p-6 bg-gray-50 rounded-2xl border-2 border-transparent hover:border-emerald-500 hover:bg-emerald-50 transition-all duration-300"
                                    >
                                        <div className="w-40 h-40 mb-4 group-hover:scale-105 transition-transform duration-500">
                                            <FixedInterestSVG />
                                        </div>
                                        <h3 className="text-xl font-bold text-gray-800 mb-2">固定兴趣</h3>
                                        <p className="text-sm text-gray-500 text-center">选择一个心仪的城市<br/>作为每次探索的默认大本营</p>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setMode('latest');
                                            handleSave('latest'); // Fast path
                                        }}
                                        className="group relative flex flex-col items-center p-6 bg-gray-50 rounded-2xl border-2 border-transparent hover:border-amber-500 hover:bg-amber-50 transition-all duration-300"
                                    >
                                        <div className="w-40 h-40 mb-4 group-hover:scale-105 transition-transform duration-500">
                                            <FollowLatestSVG />
                                        </div>
                                        <h3 className="text-xl font-bold text-gray-800 mb-2">跟随最新</h3>
                                        <p className="text-sm text-gray-500 text-center">总是从上一次旅行的终点<br/>继续你的未竟之旅</p>
                                    </button>
                                </div>
                            ) : (
                                <div className="animate-fade-in">
                                    <div className="flex items-center gap-2 mb-6 text-sm text-gray-500 cursor-pointer w-fit hover:text-gray-800 transition-colors" onClick={() => {setMode(null); setSelectedCountry(null);}}>
                                        <ChevronRight className="rotate-180" size={16} /> 返回选择模式
                                    </div>

                                    {!selectedCountry ? (
                                        <div className="space-y-4">
                                            <h3 className="text-lg font-bold text-gray-800 mb-4">选择国家或地区</h3>
                                            {(Object.keys(CITIES) as Array<keyof typeof CITIES>).map(country => (
                                                <button
                                                    key={country}
                                                    onClick={() => setSelectedCountry(country)}
                                                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-emerald-50 border border-gray-100 hover:border-emerald-200 rounded-xl transition-colors group"
                                                >
                                                    <span className="font-bold text-gray-700 group-hover:text-emerald-700">{country === 'China' ? '中国' : '日本'}</span>
                                                    <ChevronRight className="text-gray-400 group-hover:text-emerald-500" />
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 mb-4 text-sm text-gray-500 cursor-pointer w-fit hover:text-gray-800 transition-colors" onClick={() => setSelectedCountry(null)}>
                                                <ChevronRight className="rotate-180" size={16} /> 返回选择国家
                                            </div>
                                            <h3 className="text-lg font-bold text-gray-800 mb-4">选择你的默认大本营</h3>
                                            <div className="grid grid-cols-2 gap-3">
                                                {CITIES[selectedCountry].map(city => (
                                                    <button
                                                        key={city.name}
                                                        onClick={() => setSelectedCity(city)}
                                                        className={`p-3 rounded-xl border flex items-center justify-between transition-all ${selectedCity?.name === city.name ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50/50'}`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <MapPin size={16} className={selectedCity?.name === city.name ? 'text-emerald-500' : 'text-gray-400'} />
                                                            <span className="font-bold">{city.name}</span>
                                                        </div>
                                                        {selectedCity?.name === city.name && <Check size={16} className="text-emerald-600" />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="p-6 bg-gray-50 flex justify-between items-center border-t border-gray-100">
                            <button onClick={() => setStep(1)} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors flex items-center gap-2">
                                <ChevronRight size={16} className="rotate-180" /> Back
                            </button>
                            <div className="flex gap-3">
                                <button onClick={onComplete} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors">
                                    跳过
                                </button>
                                {(mode === 'fixed' && selectedCity) && (
                                    <button onClick={() => handleSave()} className="px-6 py-2.5 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200 transition-all">
                                        确定设置
                                    </button>
                                )}
                            </div>
                        </div>
                </div>

            </div>
        </div>
    );
};
