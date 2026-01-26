import React, { useState, useEffect, useRef } from 'react';
import { useDrag, DropZone } from './DragContext';
import chestGif from './../assets/chest_animated.gif';

const CHEST_GIF = chestGif;

const Chest = ({ onDropItem, activeTab }) => {
    const { isDragging } = useDrag();
    const [isOpen, setIsOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [animating, setAnimating] = useState(false);
    const [staticChestSrc, setStaticChestSrc] = useState(null);
    const [animationKey, setAnimationKey] = useState(0); // Key to force restart GIF
    const timerRef = useRef(null);
    const inventoryRef = useRef(null);
    const chestIconRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (!isOpen) return;
            // If backdrop is present (activeTab === 'map'), it handles clicks.
            // If NOT map, we need manual detection.
            if (activeTab === 'map') return;

            if (
                inventoryRef.current && !inventoryRef.current.contains(e.target) &&
                chestIconRef.current && !chestIconRef.current.contains(e.target) &&
                !isDragging // Don't close if currently dragging
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, activeTab, isDragging]);

    useEffect(() => {
        const saved = localStorage.getItem('rail_chest_items');
        if (saved) setItems(JSON.parse(saved));

        // Generate static frame from GIF (Frame 0) to "freeze" it effectively
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = CHEST_GIF;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            setStaticChestSrc(canvas.toDataURL());
        };
    }, []);

    const saveItems = (newItems) => {
        setItems(newItems);
        localStorage.setItem('rail_chest_items', JSON.stringify(newItems));
    };

    const handleDrop = (item) => {
        if (!item) return;

        // Prevent self-drop (dragging from chest back to chest)
        // Check if item id exists in current items?
        // Actually, item.id passed from dragItem might match one in items.
        // If we just dropped it, it's fine (maybe reordering, but here we just append).
        // For simplicity, if it's already in the chest (by ID check), we ignore or remove/re-add.
        // But since we generate a NEW ID on drop, we just need to know if the SOURCE was this chest.
        // We can't easily know source unless item has a flag.
        // User didn't ask for reordering, just fixing the bug.
        // If I drag from chest, `dragItem` has an ID.
        // If I drop on chest, `handleDrop` is called.
        // I should probably Check if item is already in list?
        if (items.some(i => i.id === item.id)) return;

        const newItems = [...items, { ...item, id: Date.now() }]; // unique ID for chest
        saveItems(newItems);

        // Restart animation
        if (timerRef.current) clearTimeout(timerRef.current);
        setAnimationKey(prev => prev + 1); // Force re-mount of IMG to restart GIF
        setAnimating(true);

        // Duration of GIF loop (approx 2200ms based on user info/testing)
        timerRef.current = setTimeout(() => {
            setAnimating(false);
        }, 2200);

        if (onDropItem) onDropItem(item);
    };

    const removeItem = (id) => {
        saveItems(items.filter(i => i.id !== id));
    };

    return (
        <>
            {/* The Chest Icon / Drop Target */}
            <div className="fixed bottom-24 right-4 z-[500]" ref={chestIconRef}>
                <DropZone
                    onDrop={handleDrop}
                    className="relative group"
                    activeClassName="ring-4 ring-white bg-transparent rounded-sm"
                >
                    <div
                        className={`w-16 h-16 transition-transform duration-200 cursor-pointer ${isDragging ? 'scale-110' : ''} ${animating ? 'animate-bounce' : ''}`}
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {/* Chest Image */}
                        {animating ? (
                            <img
                                key={animationKey}
                                src={CHEST_GIF}
                                alt="Chest"
                                className="w-full h-full object-contain pixelated"
                            />
                        ) : (
                            <img
                                src={staticChestSrc || CHEST_GIF}
                                alt="Chest"
                                className={`w-full h-full object-contain pixelated ${!staticChestSrc ? 'grayscale-[0.5]' : ''}`}
                            />
                        )}

                        {/* Badge count */}
                        {items.length > 0 && (
                            <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                                {items.length}
                            </div>
                        )}
                    </div>
                </DropZone>
            </div>

            {/* Backdrop - Only on Map */}
            {isOpen && activeTab === 'map' && (
                <div
                    className={`fixed inset-0 z-[490] bg-black/20 backdrop-blur-sm transition-opacity duration-200 ${isDragging ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* Inventory Container - Positioned relative to chest icon (Fixed Bottom Right) */}
            {isOpen && (
                <div
                    ref={inventoryRef}
                    className="fixed bottom-44 right-4 z-[495] w-64 bg-[#c6c6c6] border-4 border-[#373737] p-3 rounded-lg shadow-2xl animate-pop-in origin-bottom-right"
                    style={{ boxShadow: 'inset -4px -4px #555, inset 4px 4px #fff' }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Bubble Tail */}
                    <div className="absolute -bottom-[14px] right-6 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[14px] border-t-[#373737]"></div>
                    <div className="absolute -bottom-[8px] right-[26px] w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[12px] border-t-[#c6c6c6] z-10"></div>

                    <h3 className="text-gray-800 font-bold mb-2 flex justify-between items-center pixel-font">
                        <span>Inventory</span>
                        <span className="text-xs text-gray-600">{items.length} slots</span>
                    </h3>

                    <div className="grid grid-cols-4 gap-0.5 max-h-60 overflow-y-auto p-1 bg-[#C6C6C6]">
                        {items.length === 0 && <div className="col-span-4 text-center text-gray-500 text-xs py-4 pixel-font">Empty Inventory</div>}
                        {items.map(item => (
                            <ChestItem key={item.id} item={item} onRemove={() => removeItem(item.id)} />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
};

// Reusing the SVG from StationMenu might be better if exported, but inline is safe for now to avoid exports refactor issues.
const McSlotSvg = () => (
    <svg viewBox="0 0 50 50" preserveAspectRatio="none" className="w-full h-full absolute inset-0 z-0" style={{ imageRendering: 'pixelated' }}>
        <rect x="0" y="0" width="50" height="50" fill="#8B8B8B" />
        <path d="M0 0 H50 V2 H2 V50 H0 Z" fill="#373737" />
        <path d="M50 50 H0 V48 H48 V0 H50 Z" fill="#FFFFFF" />
    </svg>
);

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
                        <img src="/src/assets/rail_bg.png" className="absolute inset-0 w-full h-full object-contain pixelated opacity-80" alt="" />
                        {item.logo && <img src={item.logo} className="w-6 h-6 object-contain z-10 filter drop-shadow-sm" alt={item.lineKey} />}
                    </div>

                    {/* Hover Controls */}
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        className="absolute -top-1 -right-1 bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-sm text-[10px]"
                    >
                        &times;
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white text-center truncate px-0.5 pointer-events-none">
                        {item.name}
                    </div>
                </div>
            )}
        </div>
    );
}

export default Chest;
