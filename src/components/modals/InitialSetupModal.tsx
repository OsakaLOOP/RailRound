import React, { useState } from 'react';
import { useStore } from '../../store';
import { useNavigate, useLocation } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { MapPin, Globe, ChevronRight, Check } from 'lucide-react';
import { useUserData } from '../../hooks/useUserData';
import { useTranslation, Trans } from 'react-i18next';

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

// Intricate SVG for Fixed Interest (City Skyline / Monorail / Vertical Station Sign)
// Emerald/Teal theme
const FixedInterestSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-lg overflow-hidden rounded-full">
        <defs>
            <linearGradient id="fixBg" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#022c22" />
                <stop offset="50%" stopColor="#064e3b" />
                <stop offset="100%" stopColor="#0f766e" />
            </linearGradient>
            <linearGradient id="fixTrainBody" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="50%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#6ee7b7" />
            </linearGradient>
            <linearGradient id="fixBuildingDark" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0a3d36" />
                <stop offset="100%" stopColor="#042f2e" />
            </linearGradient>
            <filter id="fixGlow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="fixHeadlight">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="fixStarGlow">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
        </defs>

        {/* Night sky background */}
        <circle cx="100" cy="100" r="100" fill="url(#fixBg)" />

        {/* Stars */}
        <g filter="url(#fixStarGlow)">
            <circle cx="30" cy="25" r="1" fill="#a7f3d0" opacity="0.6" />
            <circle cx="85" cy="18" r="0.8" fill="#a7f3d0" opacity="0.4" />
            <circle cx="145" cy="22" r="1.2" fill="#a7f3d0" opacity="0.5" />
            <circle cx="170" cy="40" r="0.7" fill="#a7f3d0" opacity="0.3" />
            <circle cx="55" cy="35" r="0.9" fill="#a7f3d0" opacity="0.5" />
            <circle cx="120" cy="30" r="0.6" fill="#a7f3d0" opacity="0.4" />
        </g>

        {/* Moon crescent */}
        <circle cx="160" cy="35" r="12" fill="#a7f3d0" opacity="0.15" />
        <circle cx="160" cy="35" r="12" fill="none" stroke="#a7f3d0" strokeWidth="0.5" opacity="0.3" />
        <circle cx="155" cy="32" r="10" fill="url(#fixBg)" /> {/* cuts out crescent */}

        {/* Far Background Skyline - varied shapes */}
        <path d="M 0 135 L 10 110 L 18 110 L 22 120 L 28 100 L 38 100 L 38 108 L 42 92 L 52 92 L 56 108 L 60 88 L 68 88 L 72 95 L 72 110 L 78 102 L 86 102 L 86 118 L 200 118 L 200 200 L 0 200 Z" fill="#0d6054" opacity="0.35" />

        {/* Building A - Left squat block */}
        <rect x="8" y="110" width="18" height="90" fill="#0a3d36" />
        <rect x="11" y="116" width="4" height="5" fill="#6ee7b7" opacity="0.9" filter="url(#fixGlow)" />
        <rect x="19" y="116" width="4" height="5" fill="#34d399" opacity="0.2" />
        <rect x="11" y="128" width="4" height="5" fill="#34d399" opacity="0.3" />
        <rect x="19" y="128" width="4" height="5" fill="#6ee7b7" opacity="0.7" filter="url(#fixGlow)" />

        {/* Building B - Tall narrow tower */}
        <rect x="30" y="78" width="14" height="122" fill="#064e3b" />
        <rect x="33" y="84" width="3" height="5" fill="#6ee7b7" opacity="0.8" filter="url(#fixGlow)" />
        <rect x="39" y="84" width="3" height="5" fill="#34d399" opacity="0.25" />
        <rect x="33" y="96" width="3" height="5" fill="#a7f3d0" opacity="0.9" filter="url(#fixGlow)" />
        <rect x="39" y="96" width="3" height="5" fill="#34d399" opacity="0.2" />
        <rect x="33" y="108" width="3" height="5" fill="#34d399" opacity="0.3" />
        <rect x="39" y="108" width="3" height="5" fill="#6ee7b7" opacity="0.6" filter="url(#fixGlow)" />

        {/* Building C - Wide mid block */}
        <rect x="48" y="92" width="22" height="108" fill="url(#fixBuildingDark)" />
        <rect x="52" y="98" width="5" height="6" fill="#6ee7b7" opacity="0.9" filter="url(#fixGlow)" />
        <rect x="60" y="98" width="5" height="6" fill="#34d399" opacity="0.2" />
        <rect x="52" y="112" width="5" height="6" fill="#a7f3d0" opacity="0.8" filter="url(#fixGlow)" />
        <rect x="60" y="112" width="5" height="6" fill="#6ee7b7" opacity="0.5" filter="url(#fixGlow)" />

        {/* Building D - Right tall tower */}
        <rect x="130" y="82" width="16" height="118" fill="#064e3b" />
        <rect x="134" y="88" width="4" height="6" fill="#a7f3d0" opacity="0.9" filter="url(#fixGlow)" />
        <rect x="140" y="88" width="4" height="6" fill="#34d399" opacity="0.25" />
        <rect x="134" y="102" width="4" height="6" fill="#34d399" opacity="0.2" />
        <rect x="140" y="102" width="4" height="6" fill="#6ee7b7" opacity="0.8" filter="url(#fixGlow)" />
        <rect x="134" y="116" width="4" height="6" fill="#6ee7b7" opacity="0.6" filter="url(#fixGlow)" />

        {/* Building E - Far right squat */}
        <rect x="150" y="98" width="20" height="102" fill="url(#fixBuildingDark)" />
        <rect x="154" y="104" width="5" height="6" fill="#6ee7b7" opacity="0.7" filter="url(#fixGlow)" />
        <rect x="162" y="104" width="5" height="6" fill="#34d399" opacity="0.3" />
        <rect x="154" y="118" width="5" height="6" fill="#a7f3d0" opacity="0.8" filter="url(#fixGlow)" />

        {/* Elevated Track Structure */}
        <rect x="0" y="140" width="200" height="6" fill="#0f766e" />
        <line x1="0" y1="141" x2="200" y2="141" stroke="#5eead4" strokeWidth="1" />
        <line x1="0" y1="144" x2="200" y2="144" stroke="#5eead4" strokeWidth="1" />
        {/* Pillars - Highlighting to be more visible */}
        <rect x="22" y="146" width="6" height="54" fill="#0f766e" />
        <rect x="22" y="146" width="2" height="54" fill="#14b8a6" opacity="0.3" />
        <rect x="75" y="146" width="6" height="54" fill="#0f766e" />
        <rect x="75" y="146" width="2" height="54" fill="#14b8a6" opacity="0.3" />
        <rect x="125" y="146" width="6" height="54" fill="#0f766e" />
        <rect x="125" y="146" width="2" height="54" fill="#14b8a6" opacity="0.3" />
        <rect x="172" y="146" width="6" height="54" fill="#0f766e" />
        <rect x="172" y="146" width="2" height="54" fill="#14b8a6" opacity="0.3" />

        {/* Japanese Station Name Board (駅名標) - Shifted UPwards with dual posts */}
        <g transform="translate(74, 55)">
            {/* Dual Posts extending down to the track (Track is at y=140, so 140-55 = 85. Posts start at y=38, need height 47) */}
            <rect x="10" y="38" width="2.5" height="47" fill="#0f766e" />
            <rect x="39.5" y="38" width="2.5" height="47" fill="#0f766e" />

            {/* Board body */}
            <rect x="0" y="0" width="52" height="38" rx="2" fill="#042f2e" stroke="#14b8a6" strokeWidth="0.8" />
            {/* Colored stripe top */}
            <rect x="0" y="0" width="52" height="3" rx="2" fill="#10b981" />
            {/* Main station name - large */}
            <text x="26" y="18" fontSize="10" fill="#fff" textAnchor="middle" fontWeight="800">中央駅</text>
            {/* Romanization */}
            <text x="26" y="26" fontSize="4" fill="#5eead4" textAnchor="middle" fontWeight="400">Chūō</text>
            {/* Prev station (left) */}
            <text x="4" y="34" fontSize="3.5" fill="#a7f3d0" textAnchor="start">◀ 東町</text>
            {/* Next station (right) */}
            <text x="48" y="34" fontSize="3.5" fill="#a7f3d0" textAnchor="end">公園 ▶</text>
        </g>

        {/* Monorail Train with Ultra-Smooth Heavy-Vehicle Animation */}
        <g>
            <animateTransform attributeName="transform" type="translate"
                values="-160,0; 10,0; 10.0,0; 280,0; 280.0,0"
                keyTimes="0; 0.45; 0.65; 0.98; 1"
                dur="18s" repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4, 0, 0.2, 1; 0, 0, 1, 1; 0.4, 0, 0.2, 1; 0, 0, 1, 1"
                additive="replace" fill="freeze" />
            <rect x="70" y="130" width="45" height="10" rx="3" fill="url(#fixTrainBody)" />
            <path d="M 115 130 Q 120 135 115 140 Z" fill="#6ee7b7" />
            <rect x="75" y="132" width="8" height="5" rx="1" fill="#ccfbf1" filter="url(#fixGlow)" opacity="0.9" />
            <rect x="88" y="132" width="8" height="5" rx="1" fill="#ccfbf1" filter="url(#fixGlow)" opacity="0.7" />
            <rect x="101" y="132" width="8" height="5" rx="1" fill="#ccfbf1" filter="url(#fixGlow)" opacity="0.8" />
            <path d="M 116 132 L 120 135 L 116 138 Z" fill="#022c22" />
            {/* Front Headlight */}
            <circle cx="118" cy="138" r="2" fill="#fff" filter="url(#fixHeadlight)" />
            <path d="M 118 138 L 145 130 L 145 145 Z" fill="#a7f3d0" opacity="0.15" filter="url(#fixHeadlight)" />
            <line x1="70" y1="138" x2="116" y2="138" stroke="#059669" strokeWidth="1" />
        </g>

        {/* Ground */}
        <rect x="0" y="180" width="200" height="20" fill="#042f2e" />
        <line x1="0" y1="185" x2="200" y2="185" stroke="#0a3d36" strokeWidth="0.5" />
        <line x1="0" y1="195" x2="200" y2="195" stroke="#0a3d36" strokeWidth="0.5" />
    </svg>
);

// Intricate SVG for Follow Latest (Explore / Realistic Fuji & Curved Rail / Compass)
// Amber/Orange theme
const FollowLatestSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-lg rounded-full overflow-hidden">
        <defs>
            <radialGradient id="expBg" cx="50%" cy="50%" r="55%">
                <stop offset="0%" stopColor="#fef3c7" />
                <stop offset="100%" stopColor="#fde68a" />
            </radialGradient>
            <linearGradient id="expCompassRing" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#b45309" />
                <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
            <linearGradient id="expTrack" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#78350f" />
                <stop offset="100%" stopColor="#451a03" />
            </linearGradient>
            <linearGradient id="expFuji" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f5f5f4" stopOpacity="0.8" />
                <stop offset="40%" stopColor="#a8a29e" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#d6d3d1" stopOpacity="0.15" />
            </linearGradient>
            <filter id="expShadow">
                <feDropShadow dx="1" dy="2" stdDeviation="2" floodOpacity="0.2" />
            </filter>
            <clipPath id="expClip"><circle cx="100" cy="100" r="100" /></clipPath>
        </defs>

        <g clipPath="url(#expClip)">
            <circle cx="100" cy="100" r="100" fill="url(#expBg)" />

            {/* Background Mountain Range / Large abstract Fuji */}
            <g transform="translate(10, 40)" opacity="0.6">
                <path d="M 0 100 L 80 15 L 90 15 L 180 100 Z" fill="url(#expFuji)" />
                {/* Snow cap */}
                <path d="M 60 36 L 80 15 L 90 15 L 110 36 Q 85 45 60 36 Z" fill="#fff" opacity="0.9" />
            </g>

            {/* Near hills - Extended Bezier landscape towards top-right */}
            <path d="M 0 160 C 40 130 110 170 160 130 C 185 110 195 90 200 75 L 200 200 L 0 200 Z" fill="#d97706" opacity="0.12" />
            <path d="M 0 180 C 60 160 140 190 200 150 L 200 200 L 0 200 Z" fill="#d97706" opacity="0.08" />

            {/* Hot Air Balloon - Smooth floating */}
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0.0; 0,-8.5; 0,0.0" dur="8s" repeatCount="indefinite" calcMode="spline" keySplines="0.445 0.05 0.55 0.95; 0.445 0.05 0.55 0.95" />
                <g transform="translate(140, 30) scale(0.7)">
                    <path d="M 10 0 C 25 0 25 15 10 25 C -5 15 -5 0 10 0 Z" fill="#ef4444" opacity="0.8" />
                    <rect x="7" y="27" width="6" height="5" rx="1" fill="#92400e" />
                    <line x1="8" y1="25" x2="8" y2="27" stroke="#451a03" strokeWidth="0.5" />
                    <line x1="12" y1="25" x2="12" y2="27" stroke="#451a03" strokeWidth="0.5" />
                </g>
            </g>

            {/* Double Arc Rail Tracks - gentle convex curve shifted right */}
            <g stroke="url(#expTrack)" strokeWidth="3" fill="none" strokeLinecap="round">
                <path d="M 5 155 Q 115 185 215 65" />
                <path d="M 10 165 Q 120 195 220 75" />
            </g>

            {/* Track Sleepers - shifted right to match tracks */}
            <g stroke="#78350f" strokeWidth="1.8" opacity="0.4">
                <line x1="27" y1="160" x2="32" y2="170" />
                <line x1="49" y1="161" x2="54" y2="171" />
                <line x1="81" y1="158" x2="86" y2="168" />
                <line x1="113" y1="148" x2="118" y2="158" />
                <line x1="144" y1="131" x2="149" y2="141" />
                <line x1="175" y1="107" x2="180" y2="117" />
                <line x1="195" y1="88" x2="200" y2="98" />
            </g>

            {/* Milestone - Moved Right and Down closer to ground */}
            <g transform="translate(60, 120) scale(1.2)">
                {/* Shadow base */}
                <path d="M 2 30 L 2 6 L 6 0 L 10 6 L 10 30 Z" fill="#374151" opacity="0.6" filter="url(#expShadow)" />
                {/* Base pedestal */}
                <rect x="0" y="27" width="12" height="4" rx="0.5" fill="#9ca3af" />
                <rect x="1" y="28" width="10" height="2" fill="#d1d5db" />
                {/* Obelisk body */}
                <path d="M 3 27 L 3 7 L 6 1 L 9 7 L 9 27 Z" fill="#d1d5db" />
                {/* Pointed cap */}
                <path d="M 4 7 L 6 1 L 8 7 Z" fill="#f3f4f6" />
                {/* Number */}
                <text x="6" y="15" fontSize="4.5" fill="#1f2937" textAnchor="middle" fontWeight="900">12</text>
                <text x="6" y="22" fontSize="3.5" fill="#4b5563" textAnchor="middle" fontWeight="700">km</text>
            </g>

            {/* Tree cluster */}
            <g transform="translate(150, 140) scale(1.2)" opacity="0.8">
                <path d="M 10 20 L 15 5 L 20 20 Z" fill="#059669" />
                <rect x="14" y="20" width="2" height="4" fill="#78350f" />
                <path d="M 0 25 L 6 10 L 12 25 Z" fill="#10b981" />
                <rect x="5" y="25" width="2" height="4" fill="#78350f" />
            </g>

            {/* Central Compass */}
            <g transform="translate(100, 100)" filter="url(#expShadow)">
                <g>
                    <animateTransform attributeName="transform" type="rotate" values="-2; 2; -2" dur="12s" repeatCount="indefinite" calcMode="spline" keySplines="0.445 0.05 0.55 0.95; 0.445 0.05 0.55 0.95" />
                    <circle cx="0" cy="0" r="32" fill="url(#expCompassRing)" />
                    <circle cx="0" cy="0" r="28" fill="#fff" />
                    <circle cx="0" cy="0" r="25" fill="#fcd34d" opacity="0.1" />

                    {/* Ticks */}
                    <g stroke="#92400e" strokeWidth="1.2">
                        <line x1="0" y1="-26" x2="0" y2="-21" />
                        <line x1="0" y1="26" x2="0" y2="21" />
                        <line x1="-26" y1="0" x2="-21" y2="0" />
                        <line x1="26" y1="0" x2="21" y2="0" />
                    </g>
                    <g stroke="#b45309" strokeWidth="0.8" transform="rotate(45)">
                        <line x1="0" y1="-26" x2="0" y2="-23" />
                        <line x1="0" y1="26" x2="0" y2="23" />
                        <line x1="-26" y1="0" x2="-23" y2="0" />
                        <line x1="26" y1="0" x2="23" y2="0" />
                    </g>

                    {/* Letters */}
                    <text x="0" y="-12" fontSize="5" fill="#92400e" textAnchor="middle" fontWeight="800">N</text>
                    <text x="0" y="16" fontSize="4" fill="#b45309" textAnchor="middle" fontWeight="700">S</text>
                    <text x="-12" y="1.5" fontSize="4" fill="#b45309" textAnchor="middle" fontWeight="700">E</text>
                    <text x="12" y="1.5" fontSize="4" fill="#b45309" textAnchor="middle" fontWeight="700">W</text>

                    {/* Needle - Damped Magnetic Snap Animation */}
                    <g>
                        <animateTransform attributeName="transform" type="rotate"
                            values="0; 12; -6; 3; 0"
                            keyTimes="0; 0.2; 0.5; 0.8; 1"
                            dur="5s" repeatCount="indefinite"
                            calcMode="spline"
                            keySplines="0.175, 0.885, 0.32, 1.275; 0.445, 0.05, 0.55, 0.95; 0.445, 0.05, 0.55, 0.95; 0.445, 0.05, 0.55, 0.95" />
                        <path d="M -3 0 L 0 -20 L 3 0 Z" fill="#dc2626" />
                        <path d="M -3 0 L 0 20 L 3 0 Z" fill="#d1d5db" />
                        <circle cx="0" cy="0" r="3.5" fill="#92400e" />
                        <circle cx="0" cy="0" r="1.5" fill="#fcd34d" />
                    </g>
                </g>
            </g>
        </g>
    </svg>
);


// Language SVG - 3D Globe with orbiting characters
// Blue/Indigo theme
const LanguageSVG = () => (
    <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-lg overflow-hidden rounded-full">
        <defs>
            <radialGradient id="langBg" cx="50%" cy="45%" r="55%">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="100%" stopColor="#1e1b4b" />
            </radialGradient>
            <radialGradient id="earthGrad" cx="40%" cy="35%" r="60%">
                <stop offset="0%" stopColor="#60a5fa" />
                <stop offset="40%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#1e40af" />
            </radialGradient>
            <radialGradient id="earthHighlight" cx="30%" cy="25%" r="50%">
                <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="landGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <filter id="textGlow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <clipPath id="earthClip">
                <circle cx="100" cy="100" r="48" />
            </clipPath>
        </defs>

        {/* Background */}
        <circle cx="100" cy="100" r="100" fill="url(#langBg)" />

        {/* Subtle star dots */}
        <circle cx="25" cy="30" r="1" fill="#c7d2fe" opacity="0.5" />
        <circle cx="170" cy="25" r="1.2" fill="#c7d2fe" opacity="0.4" />
        <circle cx="45" cy="165" r="0.8" fill="#c7d2fe" opacity="0.6" />
        <circle cx="160" cy="170" r="1" fill="#c7d2fe" opacity="0.3" />
        <circle cx="15" cy="90" r="0.8" fill="#c7d2fe" opacity="0.4" />
        <circle cx="185" cy="85" r="1" fill="#c7d2fe" opacity="0.5" />
        <circle cx="80" cy="15" r="0.9" fill="#c7d2fe" opacity="0.3" />
        <circle cx="130" cy="185" r="0.7" fill="#c7d2fe" opacity="0.4" />

        {/* Signal waves rings */}
        <circle cx="100" cy="100" r="60" fill="none" stroke="#818cf8" strokeWidth="0.8" opacity="0.25">
            <animate attributeName="r" values="55;70;55" dur="4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.25;0.05;0.25" dur="4s" repeatCount="indefinite" />
        </circle>
        <circle cx="100" cy="100" r="72" fill="none" stroke="#818cf8" strokeWidth="0.6" opacity="0.15">
            <animate attributeName="r" values="68;85;68" dur="5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.15;0.03;0.15" dur="5s" repeatCount="indefinite" />
        </circle>

        {/* 3D Globe */}
        <g>
            <circle cx="100" cy="100" r="48" fill="url(#earthGrad)" />

            {/* Continents */}
            <g clipPath="url(#earthClip)" fill="url(#landGrad)" opacity="0.85">
                <path d="M115,78 L122,75 L128,78 L130,85 L126,92 L128,98 L124,105 L118,108 L112,105 L108,98 L105,90 L108,82 Z" />
                <path d="M132,80 L134,76 L136,78 L135,84 L133,88 L131,86 Z" />
                <path d="M134,88 L136,86 L137,90 L135,93 Z" />
                <path d="M118,112 L122,110 L125,114 L120,118 L116,116 Z" />
                <path d="M102,95 L106,92 L108,98 L105,106 L100,108 L98,102 Z" />
                <path d="M82,72 L88,68 L92,70 L94,76 L90,80 L84,78 Z" />
                <path d="M88,88 L94,85 L96,92 L94,100 L90,108 L86,112 L82,108 L80,98 L82,92 Z" />
                <path d="M128,120 L136,118 L140,122 L138,128 L132,128 L128,125 Z" />
            </g>

            {/* Grid Lines */}
            <g clipPath="url(#earthClip)" fill="none" stroke="#bfdbfe" strokeWidth="0.4" opacity="0.3">
                <ellipse cx="100" cy="100" rx="48" ry="3" />
                <ellipse cx="100" cy="86" rx="44" ry="3" />
                <ellipse cx="100" cy="114" rx="44" ry="3" />
                <ellipse cx="100" cy="100" rx="3" ry="48" />
                <ellipse cx="100" cy="100" rx="20" ry="48" />
                <ellipse cx="100" cy="100" rx="36" ry="48" />
            </g>

            {/* 3D Highlight & Atmosphere */}
            <circle cx="100" cy="100" r="48" fill="url(#earthHighlight)">
                <animate attributeName="opacity" values="0.6; 1; 0.6" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95" />
            </circle>
            <circle cx="100" cy="100" r="48" fill="none" stroke="#93c5fd" strokeWidth="1.5" opacity="0.4">
                <animate attributeName="opacity" values="0.3; 0.7; 0.3" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95" />
            </circle>
        </g>

        {/* Orbiting Language Characters - Enhanced sub-pixel smoothness */}
        <g transform="translate(38, 42)" filter="url(#textGlow)">
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0.0; 0,-6.5; 0,0.0" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95" />
                <circle cx="0" cy="0" r="14" fill="#4338ca" opacity="0.8" />
                <text x="0" y="5" fontSize="14" fill="#e0e7ff" textAnchor="middle" fontWeight="700">文</text>
            </g>
        </g>
        <g transform="translate(162, 48)" filter="url(#textGlow)">
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0.0; 0,-6.5; 0,0.0" dur="4.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95" />
                <circle cx="0" cy="0" r="13" fill="#6366f1" opacity="0.75" />
                <text x="0" y="5" fontSize="15" fill="#e0e7ff" textAnchor="middle" fontWeight="800">A</text>
            </g>
        </g>
        <g transform="translate(42, 158)" filter="url(#textGlow)">
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0.0; 0,-5.5; 0,0.0" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95" />
                <circle cx="0" cy="0" r="14" fill="#4338ca" opacity="0.8" />
                <text x="0" y="5" fontSize="13" fill="#e0e7ff" textAnchor="middle" fontWeight="700">あ</text>
            </g>
        </g>
        <g transform="translate(155, 155)" filter="url(#textGlow)">
            <g>
                <animateTransform attributeName="transform" type="translate" values="0,0.0; 0,-5.5; 0,0.0" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0.05 0.55 0.95; 0.45 0.05 0.55 0.95" />
                <circle cx="0" cy="0" r="13" fill="#6366f1" opacity="0.7" />
                <text x="0" y="5" fontSize="13" fill="#e0e7ff" textAnchor="middle" fontWeight="700">繁</text>
            </g>
        </g>

        {/* Connection arcs from character bubbles to globe surface */}
        <path d="M49 53 Q72 72 80 85" fill="none" stroke="#818cf8" strokeWidth="1" opacity="0.4" />
        <path d="M150 52 Q130 68 120 82" fill="none" stroke="#818cf8" strokeWidth="1" opacity="0.4" />
        <path d="M50 150 Q70 138 82 120" fill="none" stroke="#818cf8" strokeWidth="1" opacity="0.4" />
        <path d="M143 148 Q128 135 118 120" fill="none" stroke="#818cf8" strokeWidth="1" opacity="0.4" />
    </svg>
);

export const InitialSetupModal: React.FC<InitialSetupModalProps> = ({ isOpen, onComplete }) => {
    const navigate = useNavigate();
    const location = useLocation();

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
    const [selectedCity, setSelectedCity] = useState<{ name: string, lat: number, lng: number } | null>({ name: '東京', lat: 35.6812, lng: 139.7671 });

    if (!isOpen) return null;

    const languages = [
        { id: 'zh-CN', label: '简体中文' },
        { id: 'en', label: 'English' },
        { id: 'ja-JP', label: '日本語' },
        { id: 'zh-TW', label: '繁體中文' }
    ];

    // Helper to check if selection is complete
    const isComplete = (mode === 'latest') || (mode === 'fixed' && selectedCity);

    const handleLanguageSelect = (langId: string) => {
        setSelectedLanguage(langId);
        setStep(2);

        // Instant visual update of app language
        const parts = location.pathname.split('/');
        if (parts.length > 1 && ['zh-cn', 'en', 'ja-jp', 'zh-tw'].includes(parts[1].toLowerCase())) {
            parts[1] = langId.toLowerCase();
        } else {
            parts.splice(1, 0, langId.toLowerCase());
        }
        navigate(parts.join('/') + location.search, { replace: true });
    };

    const handleBack = () => {
        if (step === 2) {
            if (mode) {
                setMode(null);
                setSelectedCountry(null);
                setSelectedCity(null);
            } else {
                setStep(1);
            }
        }
    };

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
                                    onClick={() => handleLanguageSelect(lang.id)}
                                    className={`p-4 rounded-xl border-2 flex items-center justify-center font-bold transition-all ${selectedLanguage === lang.id ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-md' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50/50'}`}
                                >
                                    <Globe size={18} className="mr-2 opacity-70" /> {lang.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={`absolute inset-0 flex flex-col transition-transform duration-500 ease-in-out ${step === 2 ? 'translate-x-0' : 'translate-x-full'} ${step === 2 ? 'opacity-100 relative' : 'opacity-0 absolute pointer-events-none'}`}>
                    <div className="p-8 pb-4 text-center">
                        {!mode ? (
                            <>
                                <h2 className="text-3xl font-bold text-gray-800 mb-2">{t('tutorial.welcome.title', '欢迎来到 RailLOOP')}</h2>
                                <p className="text-gray-500 max-w-lg mx-auto mb-4">{t('tutorial.welcome.content', 'RailLOOP 是一个个人向旅铁手账, 旨在帮助你追踪和管理你的铁路旅程, 直观可感地展示旅行足迹.')}</p>
                                <h3 className="text-xl font-bold text-gray-700">{t('setup.startTitle', '你的探索起点')}</h3>
                                <p className="text-gray-500 text-sm mt-1">{t('setup.startDesc', '每次打开地图时，你希望从哪里开始你的旅程？')}</p>
                            </>
                        ) : (
                            <>
                                <h2 className="text-3xl font-bold text-gray-800 mb-2">{t('setup.startTitle', '你的探索起点')}</h2>
                                <p className="text-gray-500">{t('setup.startDesc', '每次打开地图时，你希望从哪里开始你的旅程？')}</p>
                            </>
                        )}
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
                                    <p className="text-sm text-gray-500 text-center">
                                        <Trans i18nKey="setup.fixedInterestDesc">
                                            选择一个心仪的城市<br />作为每次探索的默认大本营
                                        </Trans>
                                    </p>
                                </button>

                                <button
                                    onClick={() => setMode('latest')}
                                    className="group relative flex flex-col items-center p-6 bg-gray-50 rounded-2xl border-2 border-transparent hover:border-amber-500 hover:bg-amber-50 transition-all duration-300"
                                >
                                    <div className="w-40 h-40 mb-4 group-hover:scale-105 transition-transform duration-500">
                                        <FollowLatestSVG />
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-800 mb-2">{t('setup.followLatest', '跟随最新')}</h3>
                                    <p className="text-sm text-gray-500 text-center">
                                        <Trans i18nKey="setup.followLatestDesc">
                                            总是从上一次旅行的终点<br />继续你的未竟之旅
                                        </Trans>
                                    </p>
                                </button>
                            </div>
                        ) : (
                            <div className="animate-fade-in px-2">
                                {mode === 'fixed' ? (
                                    <>
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
                                                <h3 className="text-lg font-bold text-gray-800 mb-4">{t('setup.chooseBase', '选择你的默认大本营')}</h3>
                                                <div className="grid grid-cols-2 gap-3 pb-8">
                                                    {CITIES[selectedCountry].map(city => {
                                                        const isAvailable = selectedCountry === 'Japan' || city.name === '北京' || city.name === '南京';
                                                        return (
                                                            <button
                                                                key={city.name}
                                                                onClick={() => isAvailable && setSelectedCity(city)}
                                                                className={`p-3 rounded-xl border flex items-center justify-between transition-all min-h-[56px] ${isAvailable
                                                                    ? selectedCity?.name === city.name
                                                                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm'
                                                                        : 'bg-white border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50/50'
                                                                    : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                                                                    }`}
                                                                disabled={!isAvailable}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <MapPin size={16} className={selectedCity?.name === city.name && isAvailable ? 'text-emerald-500' : 'text-gray-400'} />
                                                                    <span className="font-bold text-sm">
                                                                        {city.name}
                                                                    </span>
                                                                </div>
                                                                {selectedCity?.name === city.name && isAvailable ? (
                                                                    <Check size={16} className="text-emerald-600" />
                                                                ) : !isAvailable && (
                                                                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded">{t('common.comingSoon', 'TODO')}</span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 text-center animate-scale-up">
                                        <div className="w-48 h-48 mb-6">
                                            <FollowLatestSVG />
                                        </div>
                                        <h3 className="text-2xl font-bold text-gray-800 mb-2">{t('setup.followLatest', '跟随最新')}</h3>
                                        <p className="text-gray-500 max-w-sm">{t('setup.followLatestSummary', '已准备就绪！每次启动应用将自动定位到您上一次记录的终点。')}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="p-6 bg-gray-50 flex justify-between items-center border-t border-gray-100 shrink-0">
                        <div>
                            {step === 2 && (
                                <button onClick={handleBack} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors flex items-center gap-2">
                                    <ChevronRight size={16} className="rotate-180" /> {t('common.back', '返回')}
                                </button>
                            )}
                        </div>
                        <div className="flex gap-3">
                            {!isComplete ? (
                                <button onClick={() => handleSave()} className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors">
                                    {t('setup.skip', '跳过')}
                                </button>
                            ) : (
                                <button onClick={() => handleSave()} className="px-8 py-2.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 transition-all transform active:scale-95">
                                    {t('common.confirm', '确认完成')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>


            </div>
        </div>
    );
};
