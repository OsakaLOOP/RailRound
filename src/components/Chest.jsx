import React, { useState, useEffect } from 'react';
import { useDrag, DropZone } from './DragContext';
import chestGif from '../chest_animated.gif';

const CHEST_GIF = chestGif;
// Or just use the Rail BG as placeholder for static if needed, or the first frame.
// Actually, let's just use the GIF for now, or a simple div.

const Chest = ({ onDropItem }) => {
    const { isDragging } = useDrag();
    const [isOpen, setIsOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('rail_chest_items');
        if (saved) setItems(JSON.parse(saved));
    }, []);

    const saveItems = (newItems) => {
        setItems(newItems);
        localStorage.setItem('rail_chest_items', JSON.stringify(newItems));
    };

    const handleDrop = (item) => {
        if (!item) return;

        // Prevent duplicates? Maybe not.
        const newItems = [...items, { ...item, id: Date.now() }]; // unique ID for chest
        saveItems(newItems);

        setAnimating(true);
        setTimeout(() => setAnimating(false), 2200); // GIF loop approx

        if (onDropItem) onDropItem(item);
    };

    const removeItem = (id) => {
        saveItems(items.filter(i => i.id !== id));
    };

    return (
        <>
            {/* The Chest Icon / Drop Target */}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[500]">
                <DropZone onDrop={handleDrop} className="relative group">
                    <div
                        className={`w-20 h-20 transition-transform duration-200 cursor-pointer ${isDragging ? 'scale-110' : ''} ${animating ? 'animate-bounce' : ''}`}
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {/* Chest Image */}
                        <img
                            src={CHEST_GIF}
                            alt="Chest"
                            className={`w-full h-full object-contain pixelated ${animating ? '' : 'grayscale-[0.2]'}`}
                        />
                        {/* Badge count */}
                        {items.length > 0 && (
                            <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                                {items.length}
                            </div>
                        )}
                    </div>
                </DropZone>
            </div>

            {/* The "Open" Chest Inventory (Modal-ish) */}
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

                        <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto p-2 bg-[#8b8b8b] rounded" style={{ boxShadow: 'inset 2px 2px 0 #373737, inset -2px -2px 0 #fff' }}>
                            {items.length === 0 && <div className="col-span-4 text-center text-white/50 text-xs py-4">Empty</div>}
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
    const { startDrag } = useDrag();

    return (
        <div
            className="w-16 h-16 bg-[#8b8b8b] relative group hover:bg-[#a0a0a0] transition-colors border-2 border-transparent hover:border-white cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => startDrag(item, e)}
            onTouchStart={(e) => startDrag(item, e)}
        >
            <div className="w-full h-full flex items-center justify-center relative">
                 <img src="/src/assets/rail_bg.png" className="absolute inset-0 w-full h-full opacity-50 pixelated" alt="" />
                 {item.logo && <img src={item.logo} className="w-8 h-8 object-contain z-10" alt={item.lineKey} />}
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-sm"
            >
                &times;
            </button>
            <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white text-center truncate px-1">
                {item.name}
            </div>
        </div>
    );
}

export default Chest;
