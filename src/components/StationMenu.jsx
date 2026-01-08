import React from 'react';
import { useDrag } from './DragContext';
import { X } from 'lucide-react';

const McSlotSvg = ({ className = "" }) => (
    <svg
        viewBox="0 0 50 50"
        preserveAspectRatio="none"
        className={`w-full h-full ${className}`}
        style={{ imageRendering: 'pixelated' }}
    >
        {/* Background */}
        <rect x="0" y="0" width="50" height="50" fill="#8B8B8B" />
        {/* Top/Left Shadow (Dark) */}
        <path d="M0 0 H50 V2 H2 V50 H0 Z" fill="#373737" />
        {/* Bottom/Right Highlight (Light) */}
        <path d="M50 50 H0 V48 H48 V0 H50 Z" fill="#FFFFFF" />
    </svg>
);

const StationMenu = ({ position, stationData, railwayData, onClose }) => {
    const { startDrag, isDragging, dragItem } = useDrag();

    if (!position || !stationData) return null;

    // 1. Identify all lines for this station
    const lines = [];
    if (railwayData) {
        Object.keys(railwayData).forEach(key => {
            const line = railwayData[key];
            const match = line.stations.find(s => s.name_ja === stationData.name_ja);
            if (match) {
                lines.push({
                    lineKey: key,
                    stationId: match.id,
                    name: match.name_ja,
                    logo: line.meta.logo, // Company logo
                    icon: line.meta.icon, // Line icon
                    company: line.meta.company
                });
            }
        });
    }

    if (lines.length === 0) return null;

    // Calculate fixed width based on items to centering
    // Slot width ~50px + gap.

    return (
        <div
            className="fixed z-[1000] animate-pop-in"
            style={{
                left: position.x,
                top: position.y,
                transform: 'translate(-50%, -100%) translateY(-24px)'
            }}
        >
            {/* Minecraft Panel Container */}
            <div
                className="bg-[#C6C6C6] p-2 flex flex-col gap-1 min-w-[140px] shadow-2xl"
                style={{
                    boxShadow: 'inset 2px 2px 0px #FFFFFF, inset -2px -2px 0px #555555, 4px 4px 10px rgba(0,0,0,0.5)',
                    border: '2px solid #000' // Outer black border common in MC
                }}
            >
                <div className="flex justify-between items-center px-1 mb-1">
                    <span className="font-bold text-[#404040] text-xs pixel-font shadow-white drop-shadow-[1px_1px_0_#FFF]">{stationData.name_ja}</span>
                    <button onClick={onClose} className="text-[#404040] hover:text-black"><X size={12}/></button>
                </div>

                {/* Inventory Bar (Horizontal Slots) */}
                <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                    {lines.map((line) => {
                        const isBeingDragged = isDragging && dragItem?.type === 'station' && dragItem?.lineKey === line.lineKey && dragItem?.id === line.stationId;

                        return (
                            <div
                                key={line.lineKey}
                                className="shrink-0 w-12 h-12 relative group"
                                onMouseDown={(e) => {
                                    startDrag({
                                        type: 'station',
                                        id: line.stationId,
                                        lineKey: line.lineKey,
                                        name: line.name,
                                        logo: line.icon || line.logo
                                    }, e);
                                }}
                                onTouchStart={(e) => {
                                    startDrag({
                                        type: 'station',
                                        id: line.stationId,
                                        lineKey: line.lineKey,
                                        name: line.name,
                                        logo: line.icon || line.logo
                                    }, e);
                                }}
                            >
                                {/* Slot Background */}
                                <div className="absolute inset-0 z-0">
                                    <McSlotSvg />
                                </div>

                                {/* Content - Hidden if dragging */}
                                {!isBeingDragged && (
                                    <div className="absolute inset-0 z-10 p-1 flex items-center justify-center cursor-grab active:cursor-grabbing hover:bg-white/10 transition-colors">
                                        <div className="relative w-full h-full flex items-center justify-center">
                                            {/* Rail (as requested, floating on rail) */}
                                            <img src="/src/assets/rail_bg.png" className="absolute inset-0 w-full h-full object-contain pixelated opacity-80" alt="" />

                                            {/* Icon */}
                                            {(line.icon || line.logo) && (
                                                <img src={line.icon || line.logo} className="w-6 h-6 object-contain z-20 filter drop-shadow-sm" alt="" />
                                            )}
                                        </div>

                                        {/* Tooltip on Hover */}
                                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#100010] border-2 border-[#2a007a] text-white text-[10px] px-2 py-1 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 pixel-font">
                                            {line.lineKey.split(':')[1] || line.lineKey}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Pointer (Optional, maybe pixelated triangle) */}
            <div
                className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-[6px] w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#000]"
            ></div>
             <div
                className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-[3px] w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-[#C6C6C6]"
            ></div>
        </div>
    );
};

export default StationMenu;
