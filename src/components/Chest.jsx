import React, { useState, useEffect, useRef } from 'react';
import { useDrag, DropZone } from './DragContext';
import chestGif from './../assets/chest_animated.gif';
import chestOn from './../assets/chest_on.png';
import chestOff from './../assets/chest_off.png';

const CHEST_GIF = chestGif;
const CHEST_ON = chestOn;
const CHEST_OFF = chestOff;

// Reusing the SVG from StationMenu - duplicate definition for now to avoid large refactors
// Ideally this should be a shared component.
const McSlotSvg = () => (
    <svg viewBox="0 0 50 50" preserveAspectRatio="none" className="w-full h-full absolute inset-0 z-0" style={{ imageRendering: 'pixelated' }}>
        <rect x="0" y="0" width="50" height="50" fill="#8B8B8B" />
        <path d="M0 0 H50 V2 H2 V50 H0 Z" fill="#373737" />
        <path d="M50 50 H0 V48 H48 V0 H50 Z" fill="#FFFFFF" />
    </svg>
);

const Chest = ({ onDropItem }) => {
    const { isDragging } = useDrag();
    const [isOpen, setIsOpen] = useState(false); // Manual open state
    const [items, setItems] = useState([]);

    // Animation State: 'closed' | 'opening' | 'open'
    // We treat 'closing' as instant 'closed' (showing OFF png) per plan
    const [animState, setAnimState] = useState('closed');
    const [animationKey, setAnimationKey] = useState(0); // Key to force restart GIF
    const timerRef = useRef(null);

    // Determines if the chest should be visually open (manual or dragging near)
    // Note: This logic is slightly complex because "dragging near" is handled by DropZone internally via hovering,
    // but here we just toggle animations based on `isOpen` (manual) or `isDragging`.
    // Actually, user req: "Front half triggers on manual open OR dragging element into range".
    // "Range" usually implies Hover. But `isDragging` is global.
    // Let's refine: The original code just used `isDragging` to scale.
    // We will trigger 'opening' if `isOpen` is true OR if `isDragging` is true (assuming global drag means potential drop).
    // Wait, "dragging element into range" -> DropZone usually handles this.
    // But since the DropZone wraps the div, we can use `onMouseEnter` / `onMouseLeave` on the DropZone?
    // No, DropZone doesn't expose hover state easily.
    // However, the original code had `scale-110` on `isDragging`.
    // Let's implement: If `isOpen` is true, it's OPEN.
    // If `isDragging` is true, we should probably trigger OPENING (as if getting ready).
    // Let's stick to `isOpen` (manual) for now, but also check `isDragging`.
    // User said: "manually open, OR drag element reach box range".
    // So we need a hover state.
    const [isHovering, setIsHovering] = useState(false);
    // Track drop to force close even if hovering
    const [justDropped, setJustDropped] = useState(false);

    // derived target state
    const shouldBeOpen = (isOpen || isHovering) && !justDropped;

    useEffect(() => {
        const saved = localStorage.getItem('rail_chest_items');
        if (saved) setItems(JSON.parse(saved));
    }, []);

    useEffect(() => {
        // State Machine for Animation
        if (shouldBeOpen) {
            if (animState === 'closed') {
                // Start Opening
                setAnimState('opening');
                setAnimationKey(prev => prev + 1); // Restart GIF
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => {
                    setAnimState('open');
                }, 2000); // 20 frames / 41 frames * 4.1s approx 2s
            }
            // If already opening or open, do nothing
        } else {
            // Should be closed
            if (animState !== 'closed') {
                // Instant close (per plan)
                setAnimState('closed');
                if (timerRef.current) clearTimeout(timerRef.current);
            }
        }
    }, [shouldBeOpen, animState]);


    const saveItems = (newItems) => {
        setItems(newItems);
        localStorage.setItem('rail_chest_items', JSON.stringify(newItems));
    };

    const handleDrop = (item) => {
        if (!item) return;
        const newItems = [...items, { ...item, id: Date.now() }];
        saveItems(newItems);

        // On drop, we might want to keep it open for a moment or close it?
        // "Back half triggers on exit interface OR mouse release (drop)".
        // Mouse release = Drop. So on Drop, it should CLOSE.
        // `shouldBeOpen` depends on `isHovering`. On drop, hover might still be true?
        // Actually, DropZone consumes the drop. `isHovering` might flicker.
        // We can force close logic here if needed, but the effect hook should handle it when `isHovering` becomes false (mouse leaves or drag ends).
        // When drag ends, `isDragging` becomes false (globally), but we are using local hover.
        // If we drop, we are no longer dragging, so `isHovering` logic might need to ensure it clears if it was dependent on drag.
        // Actually, for a DropZone, usually you drop and the mouse is still there.
        // User said: "mouse release, drop element -> play closing".
        // If I drop, `isOpen` (manual) is false. `isHovering` might be true.
        // I'll assume standard behavior: Drop -> Process -> Drag ends.
        // If Drag Ends, does "Reach box range" still apply?
        // "Drag element reach box range" implies dragging is active.
        // So `shouldBeOpen` = `isOpen` || (`isHovering` && `isDragging`).

        // Force close on drop
        setJustDropped(true);

        if (onDropItem) onDropItem(item);
    };

    const removeItem = (id) => {
        saveItems(items.filter(i => i.id !== id));
    };

    // Derived image source
    let imgSrc;
    let imgClass = "w-full h-full object-contain pixelated";

    if (animState === 'closed') {
        imgSrc = CHEST_OFF;
    } else if (animState === 'opening') {
        imgSrc = CHEST_GIF;
    } else { // open
        imgSrc = CHEST_ON;
    }

    return (
        <>
            {/* The Chest Icon / Drop Target */}
            <div className="fixed bottom-24 right-4 z-[500]">
                <DropZone
                    onDrop={handleDrop}
                    className="relative group"
                >
                    <div
                        className={`w-16 h-16 transition-transform duration-200 cursor-pointer ${isDragging ? 'scale-110' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
                        onMouseEnter={() => { if(isDragging) setIsHovering(true); }}
                        onMouseLeave={() => { setIsHovering(false); setJustDropped(false); }}
                    >
                        <img
                            key={animState === 'opening' ? animationKey : 'static'}
                            src={imgSrc}
                            alt="Chest"
                            className={imgClass}
                        />

                        {/* Badge count - Positioned 2/3 height from bottom.
                            Height is h-16 (4rem). 2/3 up is approx bottom-[66%].
                            The original code had `-top-2 -right-2` which is way up.
                            User wants "red dot placed at height approx 2/3".
                            We'll use bottom-[66%] relative to container.
                        */}
                        {items.length > 0 && (
                            <div className="absolute bottom-[66%] -right-2 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                                {items.length}
                            </div>
                        )}
                    </div>
                </DropZone>
            </div>

            {/* The "Open" Chest Inventory */}
            {isOpen && (
                <div className="fixed inset-0 z-[490] bg-black/20 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
                    <div
                        className="absolute bottom-28 left-1/2 -translate-x-1/2 w-full max-w-sm bg-[#c6c6c6] border-4 border-[#373737] p-4 rounded-lg shadow-2xl animate-slide-up"
                        style={{ boxShadow: 'inset -4px -4px #555, inset 4px 4px #fff' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 className="text-gray-800 font-bold mb-4 flex justify-between items-center pixel-font">
                            <span>Inventory</span>
                            <span className="text-xs text-gray-600">{items.length} slots</span>
                        </h3>

                        <div className="grid grid-cols-4 gap-1 max-h-60 overflow-y-auto p-2 bg-[#C6C6C6]">
                            {items.length === 0 && <div className="col-span-4 text-center text-gray-500 text-xs py-4 pixel-font">Empty Inventory</div>}
                            {items.map(item => (
                                <ChestItem key={item.id} item={item} onRemove={() => removeItem(item.id)} />
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const ChestItem = ({ item, onRemove }) => {
    const { startDrag, isDragging, dragItem } = useDrag();
    const isHidden = isDragging && dragItem?.id === item.id;

    return (
        <div
            className="w-12 h-12 relative group"
            onMouseDown={(e) => startDrag(item, e)}
            onTouchStart={(e) => startDrag(item, e)}
        >
            <McSlotSvg />

            {!isHidden && (
                <div className="absolute inset-0 z-10 p-1 cursor-grab active:cursor-grabbing hover:bg-white/10">
                    <div className="w-full h-full flex items-center justify-center relative">
                        {/* Rail Background */}
                        <img src="/src/assets/rail_bg.png" className="absolute inset-0 w-full h-full object-contain pixelated opacity-80" alt="" />

                        {/* Icon - Unified with StationMenu: w-4 h-4 mb-2 (moved up) */}
                        {item.logo && (
                            <img src={item.logo} className="w-4 h-4 mb-2 object-contain z-10 filter drop-shadow-sm" alt={item.lineKey || item.name} />
                        )}
                    </div>

                    {/* Delete Button - Fixed event propagation */}
                    <button
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
                        onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
                        className="absolute -top-1 -right-1 bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-sm text-[10px]"
                    >
                        &times;
                    </button>

                    {/* Name Label - Bottom Bar */}
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white text-center truncate px-0.5 pointer-events-none">
                        {item.name}
                    </div>
                </div>
            )}
        </div>
    );
}

export default Chest;
