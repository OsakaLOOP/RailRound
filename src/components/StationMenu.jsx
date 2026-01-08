import React from 'react';
import { useDrag } from './DragContext';
import { X } from 'lucide-react';

// Shared logic for transferable lines from the main app
// We might need to pass this helper function or import it if extracted
// For now, we will assume the data is passed in 'stationData' which contains candidates.
// OR we recalculate it if `railwayData` is passed.

const StationMenu = ({ position, stationData, railwayData, onClose, getTransferableLines }) => {
    const { startDrag } = useDrag();

    if (!position || !stationData) return null;

    // 1. Identify all lines for this station
    // stationData: { id, name_ja, lineKey, lat, lng ... }
    // We want ALL lines that have a station with this name (ignoring company).

    const lines = [];
    if (railwayData) {
        Object.keys(railwayData).forEach(key => {
            const line = railwayData[key];
            const match = line.stations.find(s => s.name_ja === stationData.name_ja);
            if (match) {
                // Check distance if needed, but name match is usually enough for "same station" in this context
                // unless strict coordinates. Let's assume name match.
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

    return (
        <div
            className="fixed z-[1000] animate-pop-in"
            style={{
                left: position.x,
                top: position.y,
                transform: 'translate(-50%, -100%) translateY(-20px)' // Position above the click
            }}
        >
            <div className="bg-white/90 backdrop-blur rounded-xl shadow-2xl border border-gray-200 p-2 flex flex-col gap-2 min-w-[200px]">
                <div className="flex justify-between items-center px-2 pb-2 border-b border-gray-100">
                    <span className="font-bold text-gray-800 text-sm">{stationData.name_ja}</span>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14}/></button>
                </div>

                <div className="flex gap-2 overflow-x-auto p-1 max-w-[300px] scrollbar-thin">
                    {lines.map((line) => (
                        <div
                            key={line.lineKey}
                            className="shrink-0 w-20 h-20 relative cursor-grab active:cursor-grabbing group transition-transform hover:scale-105"
                            onMouseDown={(e) => {
                                startDrag({
                                    type: 'station',
                                    id: line.stationId,
                                    lineKey: line.lineKey,
                                    name: line.name,
                                    logo: line.icon || line.logo
                                }, e);
                                // Don't close immediately? Or maybe close on drag start?
                                // Usually better to keep open until interaction ends, but global drag might need cleanup.
                                // Let's keep it open.
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
                            {/* Rail BG */}
                            <img src="/src/assets/rail_bg.png" className="w-full h-full object-contain" alt="" />

                            {/* Icons */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center -mt-2">
                                {(line.icon || line.logo) && (
                                    <img src={line.icon || line.logo} className="w-8 h-8 object-contain drop-shadow-md" alt="" />
                                )}
                            </div>

                            {/* Line Name Label */}
                            <div className="absolute bottom-1 left-1 right-1 text-[8px] bg-black/70 text-white text-center rounded px-1 truncate">
                                {line.lineKey.split(':')[1] || line.lineKey}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="text-[10px] text-gray-400 text-center">Drag to Chest or Trip</div>
            </div>

            {/* Triangle Pointer */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-white/90 filter drop-shadow-sm"></div>
        </div>
    );
};

export default StationMenu;
