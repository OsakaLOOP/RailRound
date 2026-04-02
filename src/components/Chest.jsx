import React, { useState, useEffect, useRef } from 'react';
import { useDrag, DropZone } from './DragContext';
import chestGif from './../assets/chest_animated.gif';
import chestOn from './../assets/chest_on.png';
import chestOff from './../assets/chest_off.png';
import rail_bg from './../assets/rail_bg.png';
import { useStore } from './../store'; // To trigger auto route

const CHEST_GIF = chestGif;
const CHEST_ON = chestOn;
const CHEST_OFF = chestOff;
const RAIL_BG = rail_bg;

const McSlotSvg = () => (
    <svg viewBox="0 0 50 50" preserveAspectRatio="none" className="w-full h-full absolute inset-0 z-0" style={{ imageRendering: 'pixelated' }}>
        <rect x="0" y="0" width="50" height="50" fill="#8B8B8B" />
        <path d="M0 0 H50 V2 H2 V50 H0 Z" fill="#373737" />
        <path d="M50 50 H0 V48 H48 V0 H50 Z" fill="#FFFFFF" />
    </svg>
);

const Chest = ({ onDropItem } = {}) => {
    const { isDragging: isGlobalDragging } = useDrag();
    const [isOpen, setIsOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [animState, setAnimState] = useState('closed');
    const [animationKey, setAnimationKey] = useState(0);
    const timerRef = useRef(null);
    const [isHovering, setIsHovering] = useState(false);
    const [justDropped, setJustDropped] = useState(false);

    // Jr Ticket Modal State
    const [ticketStart, setTicketStart] = useState(null);
    const [ticketEnd, setTicketEnd] = useState(null);
    const [isStamping, setIsStamping] = useState(false);

    // Draggable Chest state
    const [pos, setPos] = useState({ x: window.innerWidth - 80, y: window.innerHeight - 160 });
    const isDraggingChest = useRef(false);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const initialPos = useRef({ x: 0, y: 0 });
    const hasMoved = useRef(false);

    const handlePointerDown = (e) => {
        isDraggingChest.current = true;
        hasMoved.current = false;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        dragStartPos.current = { x: clientX, y: clientY };
        initialPos.current = { ...pos };
        e.stopPropagation();

        if (!e.touches) {
             e.preventDefault();
        }
    };

    useEffect(() => {
        const handlePointerMove = (e) => {
            if (!isDraggingChest.current) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const dx = clientX - dragStartPos.current.x;
            const dy = clientY - dragStartPos.current.y;

            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                hasMoved.current = true;
            }

            if (hasMoved.current) {
                setPos({
                    x: initialPos.current.x + dx,
                    y: initialPos.current.y + dy
                });
            }
        };

        const handlePointerUp = (e) => {
            if (isDraggingChest.current && !hasMoved.current) {
                 setIsOpen(prev => !prev);
            }
            isDraggingChest.current = false;
        };

        window.addEventListener('mousemove', handlePointerMove);
        window.addEventListener('mouseup', handlePointerUp);
        window.addEventListener('touchmove', handlePointerMove, { passive: false });
        window.addEventListener('touchend', handlePointerUp);

        return () => {
            window.removeEventListener('mousemove', handlePointerMove);
            window.removeEventListener('mouseup', handlePointerUp);
            window.removeEventListener('touchmove', handlePointerMove);
            window.removeEventListener('touchend', handlePointerUp);
        };
    }, [pos]);

    const shouldBeOpen = (isOpen || isHovering) && !justDropped;

    useEffect(() => {
        const saved = localStorage.getItem('rail_chest_items');
        if (saved) {
            try {
                const parsedItems = JSON.parse(saved).map(item => ({
                    ...item,
                    count: item.count || 1
                }));
                setItems(parsedItems);
            } catch (e) {
                console.error("Failed to parse chest items", e);
            }
        }
        setPos({ x: window.innerWidth - 80, y: window.innerHeight - 160 });
    }, []);

    useEffect(() => {
        if (!isOpen) {
            // Restore slots to chest when closing
            if (ticketStart) {
                handleDrop(ticketStart, true);
                setTicketStart(null);
            }
            if (ticketEnd) {
                handleDrop(ticketEnd, true);
                setTicketEnd(null);
            }
        }
    }, [isOpen]);

    useEffect(() => {
        if (shouldBeOpen) {
            if (animState === 'closed') {
                setAnimState('opening');
                setAnimationKey(prev => prev + 1);
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => {
                    setAnimState('open');
                }, 2000);
            }
        } else {
            if (animState !== 'closed') {
                setAnimState('closed');
                if (timerRef.current) clearTimeout(timerRef.current);
            }
        }
    }, [shouldBeOpen, animState]);

    const saveItems = (newItems) => {
        setItems(newItems);
        localStorage.setItem('rail_chest_items', JSON.stringify(newItems));
    };

    const getStackId = (item) => {
        return item.id || item.name;
    };

    const handleDrop = (item, isRestoring = false) => {
        if (!item) return;

        const stackId = getStackId(item);

        setItems(prevItems => {
            const existingIndex = prevItems.findIndex(i => getStackId(i) === stackId);
            let newItems = [...prevItems];

            if (existingIndex >= 0) {
                newItems[existingIndex] = {
                    ...newItems[existingIndex],
                    count: (newItems[existingIndex].count || 1) + 1
                };
            } else {
                newItems.push({
                    ...item,
                    chestInstanceId: Date.now() + Math.random(),
                    count: 1
                });
            }
            localStorage.setItem('rail_chest_items', JSON.stringify(newItems));
            return newItems;
        });

        if (!isRestoring) setJustDropped(true);
        if (onDropItem) onDropItem(item);
    };

    const removeStack = (stackId) => {
        setItems(prevItems => {
            const newItems = prevItems.filter(i => getStackId(i) !== stackId);
            localStorage.setItem('rail_chest_items', JSON.stringify(newItems));
            return newItems;
        });
    };

    const commitDragRemove = (item) => {
         setItems(prevItems => {
            const stackId = getStackId(item);
            const existingIndex = prevItems.findIndex(i => getStackId(i) === stackId);
            if (existingIndex === -1) return prevItems;

            let newItems = [...prevItems];
            if (newItems[existingIndex].count > 1) {
                newItems[existingIndex] = {
                    ...newItems[existingIndex],
                    count: newItems[existingIndex].count - 1
                };
            } else {
                newItems.splice(existingIndex, 1);
            }

            localStorage.setItem('rail_chest_items', JSON.stringify(newItems));
            return newItems;
        });
    }

    const triggerAutoRoute = () => {
        if (!ticketStart || !ticketEnd) return;
        setIsStamping(true);

        // Stamp Animation Sequence
        setTimeout(() => {
            // Restore actual logic
            const { setAutoForm, setModalState, setEditorMode } = useStore.getState();
            setAutoForm({
                startLine: ticketStart.lineKey,
                startStation: ticketStart.id,
                endLine: ticketEnd.lineKey,
                endStation: ticketEnd.id
            });
            setEditorMode('auto');
            setModalState({ isTripEditorOpen: true });

            // Clear slots without putting them back to chest
            setTicketStart(null);
            setTicketEnd(null);
            setIsStamping(false);
            setIsOpen(false);
        }, 800); // Wait for stamp animation
    };

    const handleTicketDrop = (setter, existingItem, newItem) => {
        // If there's an item there, move it back to chest
        if (existingItem) {
            handleDrop(existingItem, true);
        }
        // newItem comes from DragContext, it has count logic attached.
        // We set it stripped of count for the single slot.
        setter({ ...newItem, count: 1 });
    };

    let imgSrc;
    let imgClass = "w-full h-full object-contain pixelated select-none pointer-events-none";

    if (animState === 'closed') {
        imgSrc = CHEST_OFF;
    } else if (animState === 'opening') {
        imgSrc = CHEST_GIF;
    } else {
        imgSrc = CHEST_ON;
    }

    const totalSlots = items.length;

    return (
        <>
            <div
                className="fixed z-[500]"
                style={{ left: pos.x, top: pos.y, userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
            >
                <DropZone
                    onDrop={handleDrop}
                    className="relative group"
                >
                    <div
                        className={`w-16 h-16 transition-transform duration-200 cursor-grab active:cursor-grabbing ${isGlobalDragging ? 'scale-110' : ''}`}
                        onMouseDown={handlePointerDown}
                        onTouchStart={handlePointerDown}
                        onMouseEnter={() => { if(isGlobalDragging) setIsHovering(true); }}
                        onMouseLeave={() => { setIsHovering(false); setJustDropped(false); }}
                    >
                        <img
                            key={animState === 'opening' ? animationKey : 'static'}
                            src={imgSrc}
                            alt="Chest"
                            className={imgClass}
                            draggable={false}
                        />

                        {totalSlots > 0 && (
                            <div className="absolute bottom-[66%] -right-2 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm pointer-events-none">
                                {totalSlots}
                            </div>
                        )}
                    </div>
                </DropZone>
            </div>

            {isOpen && (
                <div className="fixed inset-0 z-[490] bg-black/20 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
                    <div className="absolute inset-0 flex items-center justify-center gap-4 p-4 pointer-events-none">

                        {/* Left Modal (Original Chest) */}
                        <div
                            className="w-full max-w-sm bg-[#c6c6c6] border-4 border-[#373737] p-4 rounded-lg shadow-2xl animate-slide-up pointer-events-auto h-[350px] flex flex-col"
                            style={{ boxShadow: 'inset -4px -4px #555, inset 4px 4px #fff' }}
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-gray-800 font-bold mb-4 flex justify-between items-center pixel-font shrink-0">
                                <span>Inventory</span>
                                <span className="text-xs text-gray-600">{totalSlots} slots</span>
                            </h3>

                            <div className="flex flex-wrap gap-0.5 overflow-y-auto p-2 bg-[#C6C6C6] flex-1 content-start">
                                {items.length === 0 && <div className="w-full text-center text-gray-500 text-xs py-4 pixel-font">Empty Inventory</div>}
                                {items.map(item => (
                                    <ChestItem
                                        key={item.chestInstanceId || getStackId(item)}
                                        item={item}
                                        onRemove={() => removeStack(getStackId(item))}
                                        onDragSuccess={() => commitDragRemove(item)}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Right Modal (JR Ticket) */}
                        <div
                            className="w-[200px] bg-[#dbeafe] rounded-lg shadow-2xl animate-slide-up pointer-events-auto h-[350px] flex flex-col relative overflow-hidden"
                            style={{
                                // Equivalent aspect ratio: 5.75 x 12.
                                // Since left is max-w-sm (384px max, usually slightly less), setting width to ~200px creates the correct ticket ratio roughly (5.75:12)
                                border: '1px solid #bfdbfe'
                            }}
                            onClick={e => e.stopPropagation()}
                        >
                            {/* SVG Background Texture */}
                            <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                                <pattern id="jr-bg" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
                                    <text x="0" y="20" fontSize="14" fill="#1e3a8a" fontFamily="sans-serif" fontWeight="bold">JR</text>
                                </pattern>
                                <rect width="100%" height="100%" fill="url(#jr-bg)" />
                            </svg>

                            {/* Top Title */}
                            <div className="pt-6 pb-2 text-center text-gray-800 tracking-[0.3em] font-serif text-sm relative z-10 font-bold">
                                乗 車 券
                            </div>

                            {/* Slots Container - Center Above Stripe */}
                            <div className="flex-1 flex flex-col items-center justify-center pb-12 relative z-10 gap-2">
                                <div className="flex items-center gap-2">
                                    {/* Start Slot */}
                                    <DropZone
                                        onDrop={(item) => handleTicketDrop(setTicketStart, ticketStart, item)}
                                    >
                                        <div className="w-12 h-12 bg-white/50 rounded-sm border border-dashed border-blue-400 relative flex items-center justify-center">
                                            {!ticketStart && <span className="text-xs text-blue-400/50">起点</span>}
                                            {ticketStart && (
                                                <ChestItem
                                                    item={ticketStart}
                                                    onRemove={() => { handleDrop(ticketStart, true); setTicketStart(null); }}
                                                    onDragSuccess={() => setTicketStart(null)}
                                                />
                                            )}
                                        </div>
                                    </DropZone>

                                    {/* Arrow */}
                                    <div className="text-gray-800 font-bold">→</div>

                                    {/* End Slot */}
                                    <DropZone
                                        onDrop={(item) => handleTicketDrop(setTicketEnd, ticketEnd, item)}
                                    >
                                        <div className="w-12 h-12 bg-white/50 rounded-sm border border-dashed border-blue-400 relative flex items-center justify-center">
                                            {!ticketEnd && <span className="text-xs text-blue-400/50">終点</span>}
                                            {ticketEnd && (
                                                <ChestItem
                                                    item={ticketEnd}
                                                    onRemove={() => { handleDrop(ticketEnd, true); setTicketEnd(null); }}
                                                    onDragSuccess={() => setTicketEnd(null)}
                                                />
                                            )}
                                        </div>
                                    </DropZone>
                                </div>
                            </div>

                            {/* Dark Blue Stripe */}
                            <div className="absolute bottom-20 left-0 right-0 h-16 bg-[#cbe3f7] z-0 border-y border-[#9bbbd9]"></div>

                            {/* Bottom Button */}
                            <button
                                className={`absolute bottom-4 right-4 z-20 w-32 h-14 rounded-lg bg-blue-600/90 text-blue-50 border-2 flex flex-col items-center justify-center cursor-pointer transition-all duration-300
                                    ${(ticketStart && ticketEnd) ? 'border-blue-700 opacity-100 shadow-md hover:bg-blue-600' : 'border-dashed border-blue-400 bg-transparent opacity-50 cursor-not-allowed text-blue-600'}
                                    ${isStamping ? 'stamp-animation' : ''}
                                `}
                                style={{
                                    fontFamily: '"MS Mincho", "Noto Serif CJP", serif'
                                }}
                                disabled={!ticketStart || !ticketEnd || isStamping}
                                onClick={triggerAutoRoute}
                            >
                                <span className="text-[12px] tracking-[0.2em] font-bold leading-none mb-1">乗車記念</span>
                                <div className="w-24 h-px bg-current opacity-50 mb-1"></div>
                                <span className="text-[14px] tracking-[0.3em] font-bold leading-none">使用済</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>
                {`
                @keyframes stampDown {
                    0% { transform: rotate(0deg) translateY(0); opacity: 1; }
                    20% { transform: rotate(-15deg) translateY(-20px) scale(1.1); opacity: 1; }
                    40% { transform: rotate(-15deg) translateY(-20px) scale(1.1); opacity: 1; }
                    80% { transform: rotate(-5deg) translateY(10px) scale(0.95); opacity: 0.8; }
                    100% { transform: rotate(0deg) translateY(0); opacity: 0; }
                }
                .stamp-animation {
                    animation: stampDown 0.8s cubic-bezier(0.25, 1, 0.5, 1) forwards;
                    pointer-events: none;
                }
                `}
            </style>
        </>
    );
};

const ChestItem = ({ item, onRemove, onDragSuccess }) => {
    const { startDrag, isDragging, dragItem } = useDrag();
    const isHidden = isDragging && dragItem?.chestInstanceId === item.chestInstanceId;

    const handleDragStart = (e) => {
        startDrag({
            ...item,
            chestInstanceId: item.chestInstanceId || Date.now(),
            onDragEnd: (droppedOnValidZone) => {
                if (droppedOnValidZone && onDragSuccess) {
                    onDragSuccess();
                }
            }
        }, e);
    };

    return (
        <div
            className="w-12 h-12 relative group"
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
        >
            <McSlotSvg />

            {!isHidden && (
                <div className="absolute inset-0 z-10 p-1 cursor-grab active:cursor-grabbing hover:bg-white/10">
                    <div className="w-full h-full flex items-center justify-center relative">
                        <img src={RAIL_BG} className="absolute inset-0 w-full h-full object-contain pixelated opacity-80" alt="" draggable={false} />

                        {item.logo && (
                            <img src={item.logo} className="w-4 h-4 mb-2 object-contain z-10 filter drop-shadow-sm" alt={item.lineKey || item.name} draggable={false} />
                        )}
                    </div>

                    <button
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
                        onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
                        className="absolute -top-1 -right-1 bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-sm text-[10px]"
                    >
                        &times;
                    </button>

                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white text-center truncate px-0.5 pointer-events-none">
                        {item.name}
                    </div>

                    {(item.count > 1) && (
                        <div className="absolute -top-1 -left-1 bg-blue-500 text-white text-[10px] font-bold w-4 h-4 rounded flex items-center justify-center z-20 shadow-sm pointer-events-none">
                            {item.count}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default Chest;
