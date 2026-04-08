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

// Intricate SVG for Fixed Interest (Local Discovery / Commute / Monorail emerging from buildings)
// Emerald/Teal theme
const FixedInterestSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-lg overflow-hidden rounded-full">
        <defs>
            <linearGradient id="gradFixedBg" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#022c22" />
                <stop offset="60%" stopColor="#0f766e" />
                <stop offset="100%" stopColor="#ccfbf1" />
            </linearGradient>
            <linearGradient id="gradRail" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="50%" stopColor="#6ee7b7" />
                <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <linearGradient id="gradBuilding" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#064e3b" />
                <stop offset="100%" stopColor="#042f2e" />
            </linearGradient>
            <filter id="glowWindow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
            <filter id="headlightGlow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>

        <circle cx="100" cy="100" r="100" fill="url(#gradFixedBg)" />

        {/* Far Background Skyline */}
        <path d="M 0 150 L 20 100 L 40 100 L 40 120 L 70 80 L 100 80 L 100 130 L 140 60 L 170 60 L 170 150 L 200 110 L 200 200 L 0 200 Z" fill="#115e59" opacity="0.5" />

        {/* Midground Silhouette Buildings */}
        <path d="M 20 200 L 20 90 L 60 90 L 60 200 Z M 130 200 L 130 70 L 180 70 L 180 200 Z" fill="url(#gradBuilding)" />

        {/* Windows - Left Building */}
        <rect x="30" y="100" width="8" height="15" fill="#6ee7b7" filter="url(#glowWindow)" opacity="0.8" />
        <rect x="42" y="100" width="8" height="15" fill="#34d399" opacity="0.3" />
        <rect x="30" y="130" width="8" height="15" fill="#a7f3d0" filter="url(#glowWindow)" />
        <rect x="42" y="160" width="8" height="15" fill="#34d399" filter="url(#glowWindow)" opacity="0.6" />

        {/* Windows - Right Building */}
        <rect x="140" y="80" width="12" height="12" fill="#6ee7b7" filter="url(#glowWindow)" opacity="0.9" />
        <rect x="160" y="80" width="12" height="12" fill="#34d399" opacity="0.2" />
        <rect x="140" y="110" width="12" height="12" fill="#34d399" opacity="0.4" />
        <rect x="160" y="110" width="12" height="12" fill="#a7f3d0" filter="url(#glowWindow)" />
        <rect x="140" y="140" width="12" height="12" fill="#6ee7b7" filter="url(#glowWindow)" opacity="0.7" />

        {/* Rail Infrastructure - Monorail Track */}
        {/* Shadow under track */}
        <path d="M 60 130 Q 100 130 130 155 L 130 165 Q 100 140 60 140 Z" fill="#022c22" opacity="0.6" />
        {/* Track Surface */}
        <path d="M 60 120 Q 100 120 130 145 L 130 155 Q 100 130 60 130 Z" fill="#0f766e" />
        {/* Track Rail Highlights */}
        <path d="M 60 122 Q 100 122 130 147" fill="none" stroke="#5eead4" strokeWidth="1.5" />
        <path d="M 60 128 Q 100 128 130 153" fill="none" stroke="#5eead4" strokeWidth="1.5" />

        {/* The Train / Light Rail sliding out */}
        <g transform="translate(-10, 0)" className="animate-pulse">
            {/* Train Body */}
            <path d="M 70 100 Q 100 100 115 115 L 115 135 Q 100 120 70 120 Z" fill="url(#gradRail)" />
            {/* Window Strip */}
            <path d="M 75 105 Q 100 105 110 115 L 110 122 Q 100 112 75 112 Z" fill="#022c22" />
            {/* Lit Passenger Windows inside strip */}
            <path d="M 80 106 Q 90 106 95 111 L 95 118 Q 90 113 80 113 Z" fill="#ccfbf1" filter="url(#glowWindow)" opacity="0.9" />
            <path d="M 100 108 Q 105 108 108 112 L 108 119 Q 105 115 100 115 Z" fill="#ccfbf1" filter="url(#glowWindow)" opacity="0.7" />

            {/* Front Driver Window */}
            <path d="M 111 118 L 113 121 L 111 125 L 108 122 Z" fill="#ccfbf1" />

            {/* Glowing Headlights */}
            <circle cx="113" cy="128" r="2.5" fill="#fff" filter="url(#headlightGlow)" />
            <circle cx="113" cy="128" r="1" fill="#fff" />
            {/* Headlight beam */}
            <path d="M 113 128 L 140 145 L 130 155 Z" fill="#a7f3d0" filter="url(#headlightGlow)" opacity="0.3" />
        </g>
    </svg>
);

// Intricate SVG for Follow Latest (Exploration/Journey / Realistic Compass & Detailed Road)
// Amber/Orange theme
const FollowLatestSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-lg rounded-full overflow-hidden">
        <defs>
            <linearGradient id="gradLatestBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fffbeb" />
                <stop offset="100%" stopColor="#fef3c7" />
            </linearGradient>
            <linearGradient id="gradCompassRing" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d97706" />
                <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
            <linearGradient id="gradCompassInner" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fcd34d" />
                <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
            <linearGradient id="gradRoad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#451a03" />
                <stop offset="100%" stopColor="#78350f" />
            </linearGradient>
            <filter id="shadowCompass">
                <feDropShadow dx="2" dy="4" stdDeviation="4" floodOpacity="0.3" />
            </filter>
            <filter id="glowPin">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>

        {/* Soft Background */}
        <circle cx="100" cy="100" r="100" fill="url(#gradLatestBg)" />

        {/* Grid lines / Map texture */}
        <path d="M 0 50 L 200 50 M 0 100 L 200 100 M 0 150 L 200 150 M 50 0 L 50 200 M 100 0 L 100 200 M 150 0 L 150 200" stroke="#fde68a" strokeWidth="1" opacity="0.6" />

        {/* --- The Compass (Skeuomorphic) --- */}
        <g transform="translate(100, 100) scale(0.65)" filter="url(#shadowCompass)">
            {/* Outer metallic ring */}
            <circle cx="0" cy="0" r="80" fill="url(#gradCompassRing)" />
            <circle cx="0" cy="0" r="72" fill="#fff" />
            <circle cx="0" cy="0" r="68" fill="url(#gradCompassInner)" opacity="0.1" />

            {/* Compass markings/ticks */}
            <g stroke="#92400e" strokeWidth="2">
                <line x1="0" y1="-68" x2="0" y2="-60" />
                <line x1="0" y1="68" x2="0" y2="60" />
                <line x1="-68" y1="0" x2="-60" y2="0" />
                <line x1="68" y1="0" x2="60" y2="0" />
            </g>
            <g stroke="#b45309" strokeWidth="1" transform="rotate(45)">
                <line x1="0" y1="-68" x2="0" y2="-62" />
                <line x1="0" y1="68" x2="0" y2="62" />
                <line x1="-68" y1="0" x2="-62" y2="0" />
                <line x1="68" y1="0" x2="62" y2="0" />
            </g>

            {/* Compass Rose Stars */}
            <path d="M 0 -55 L 12 -12 L 55 0 L 12 12 L 0 55 L -12 12 L -55 0 L -12 -12 Z" fill="#fcd34d" opacity="0.4" />

            {/* Animated Needle */}
            <g className="animate-spin-slow" style={{ transformOrigin: 'center' }}>
                <path d="M -8 0 L 0 -50 L 8 0 Z" fill="#dc2626" /> {/* North pointing red */}
                <path d="M -8 0 L 0 50 L 8 0 Z" fill="#e5e7eb" /> {/* South pointing white/gray */}
                <circle cx="0" cy="0" r="6" fill="#92400e" />
                <circle cx="0" cy="0" r="3" fill="#fcd34d" />
            </g>
        </g>

        {/* --- Winding Journey Path (Replacing dashed line) --- */}
        {/* Solid thick base for road */}
        <path d="M 30 180 C 60 140, 20 90, 80 50 C 130 10, 160 50, 150 90 C 140 130, 180 120, 180 150" fill="none" stroke="url(#gradRoad)" strokeWidth="10" strokeLinecap="round" filter="url(#shadowCompass)" />
        {/* Road center line marker (solid highlight) */}
        <path d="M 30 180 C 60 140, 20 90, 80 50 C 130 10, 160 50, 150 90 C 140 130, 180 120, 180 150" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" opacity="0.8" />

        {/* --- Roadside Decorations --- */}
        {/* Pine Trees */}
        <g fill="#047857">
            <path d="M 25 130 L 35 110 L 45 130 Z M 33 130 L 37 130 L 37 135 L 33 135 Z" />
            <path d="M 45 60 L 52 45 L 59 60 Z M 50 60 L 54 60 L 54 65 L 50 65 Z" transform="scale(0.8) translate(15, 10)" />
            <path d="M 155 120 L 165 95 L 175 120 Z M 162 120 L 168 120 L 168 126 L 162 126 Z" />
        </g>

        {/* Rocks / Scenery */}
        <path d="M 85 140 Q 90 135 95 140 Q 92 145 85 140 Z" fill="#9ca3af" />
        <path d="M 130 50 Q 135 45 140 50 L 135 52 Z" fill="#6b7280" />

        {/* --- Map Pin (Current location/Latest) --- */}
        <g transform="translate(180, 150) scale(1.2)" className="animate-bounce">
            <path d="M 0 -20 C 8 -20, 12 -12, 12 -6 C 12 4, 0 12, 0 12 C 0 12, -12 4, -12 -6 C -12 -12, -8 -20, 0 -20 Z" fill="#dc2626" filter="url(#glowPin)" />
            <circle cx="0" cy="-9" r="4" fill="#fff" />
        </g>
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
                            <h2 className="text-3xl font-bold text-gray-800 mb-2">{t('setup.langTitle', 'Language / 语言')}</h2>
                            <p className="text-gray-500">{t('setup.langDesc', 'Choose your preferred language / 选择你的偏好语言')}</p>
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
                            <h2 className="text-3xl font-bold text-gray-800 mb-2">{t('setup.startTitle', '你的探索起点')}</h2>
                            <p className="text-gray-500">{t('setup.startDesc', '每次打开地图时，你希望从哪里开始你的旅程？')}</p>
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
                                        <h3 className="text-xl font-bold text-gray-800 mb-2">{t('setup.fixedInterest', '固定兴趣')}</h3>
                                        <p className="text-sm text-gray-500 text-center">{t('setup.fixedInterestDesc', '选择一个心仪的城市<br/>作为每次探索的默认大本营')}</p>
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
                                        <h3 className="text-xl font-bold text-gray-800 mb-2">{t('setup.followLatest', '跟随最新')}</h3>
                                        <p className="text-sm text-gray-500 text-center">{t('setup.followLatestDesc', '总是从上一次旅行的终点<br/>继续你的未竟之旅')}</p>
                                    </button>
                                </div>
                            ) : (
                                <div className="animate-fade-in">
                                    <div className="flex items-center gap-2 mb-6 text-sm text-gray-500 cursor-pointer w-fit hover:text-gray-800 transition-colors" onClick={() => {setMode(null); setSelectedCountry(null);}}>
                                        <ChevronRight className="rotate-180" size={16} /> {t('setup.backToMode', '返回选择模式')}
                                    </div>

                                    {!selectedCountry ? (
                                        <div className="space-y-4">
                                            <h3 className="text-lg font-bold text-gray-800 mb-4">{t('setup.chooseCountry', '选择国家或地区')}</h3>
                                            {(Object.keys(CITIES) as Array<keyof typeof CITIES>).map(country => (
                                                <button
                                                    key={country}
                                                    onClick={() => setSelectedCountry(country)}
                                                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-emerald-50 border border-gray-100 hover:border-emerald-200 rounded-xl transition-colors group"
                                                >
                                                    <span className="font-bold text-gray-700 group-hover:text-emerald-700">{country === 'China' ? t('setup.china', '中国') : t('setup.japan', '日本')}</span>
                                                    <ChevronRight className="text-gray-400 group-hover:text-emerald-500" />
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 mb-4 text-sm text-gray-500 cursor-pointer w-fit hover:text-gray-800 transition-colors" onClick={() => setSelectedCountry(null)}>
                                                <ChevronRight className="rotate-180" size={16} /> {t('setup.backToCountry', '返回选择国家')}
                                            </div>
                                            <h3 className="text-lg font-bold text-gray-800 mb-4">{t('setup.chooseBase', '选择你的默认大本营')}</h3>
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
                                        {t('setup.confirm', '确定设置')}
                                    </button>
                                )}
                            </div>
                        </div>
                </div>

            </div>
        </div>
    );
};
