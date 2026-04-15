import React, { useState, useEffect, useRef } from 'react';
import { useDrag, DropZone } from './DragContext';
import chestGif from './../assets/chest_animated.gif';
import chestOn from './../assets/chest_on.png';
import chestOff from './../assets/chest_off.png';
import rail_bg from './../assets/rail_bg.png';
import { useStore } from './../store'; // To trigger auto route
import { findRoute } from '../core/railwayRouting';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
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
    const [pos, setPos] = useState(() => {
        const saved = localStorage.getItem('rail_chest_pos');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse chest position", e);
            }
        }
        return { x: window.innerWidth - 80, y: window.innerHeight - 200 };
    });
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
            if (isDraggingChest.current) {
                if (!hasMoved.current) {
                    setIsOpen(prev => !prev);
                } else {
                    // Record position when dragging ends
                    setPos(currentPos => {
                        localStorage.setItem('rail_chest_pos', JSON.stringify(currentPos));
                        return currentPos;
                    });
                }
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
    }, []);

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

    const triggerAutoRoute = () => {
        if (!ticketStart || !ticketEnd) return;
        setIsStamping(true);

        // Stamp Animation Sequence
        setTimeout(() => {
            // Restore actual logic
            const store = useStore.getState();
            const { setAutoForm, setModalState, setEditorMode, railwayData, addTrip, isAprilFool, setTripForm } = store;
            setAutoForm({
                startLine: ticketStart.lineKey,
                startStation: ticketStart.id,
                endLine: ticketEnd.lineKey,
                endStation: ticketEnd.id
            });

            // Trigger auto route search directly
            if (railwayData) {
                const toastId = toast.loading(t('chest.searchingRoute', '正在寻找路径...'));
                setTimeout(() => {
                    const result = findRoute(
                        ticketStart.lineKey,
                        ticketStart.id,
                        ticketEnd.lineKey,
                        ticketEnd.id,
                        railwayData,
                        isAprilFool ? -1 : 6 // max transfers override
                    );

                    if (result && result.segments && result.segments.length > 0) {
                        toast.success(t('chest.routeFound', '找到路径'), { id: toastId });
                        const newTrip = {
                            id: Date.now(),
                            date: new Date().toISOString().split('T')[0],
                            memo: t('chest.autoGenerated', 'Chest Auto Planned'),
                            segments: result.segments,
                            cost: 0,
                            // Legacy support
                            lineKey: result.segments[0].lineKey,
                            fromId: result.segments[0].fromId,
                            toId: result.segments[result.segments.length - 1].toId
                        };
                        addTrip(newTrip);
                        // Also populate the form so the editor shows what we just added if it opens
                        setTripForm(newTrip);
                        setEditorMode('manual');
                    } else {
                        toast.error(t('chest.routeNotFound', '未找到路径'), { id: toastId });
                        setEditorMode('auto');
                    }
                }, 100);
            }

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
                className="fixed z-[500] select-none touch-none"
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
                        onMouseEnter={() => { if (isGlobalDragging) setIsHovering(true); }}
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
                <div className="fixed inset-0 z-[490] bg-black/20 backdrop-blur-sm select-none" onClick={() => setIsOpen(false)}>
                    {/* Dock both modals at the bottom-24, centered horizontally */}
                    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 flex flex-col sm:flex-row items-end justify-center gap-4 p-4 pointer-events-none overflow-visible w-max max-w-[100vw]">

                        {/* Left Modal (Original Chest) */}
                        <div
                            className="w-[300px] h-[190px] bg-[#c6c6c6] border-4 border-[#373737] p-2 rounded-lg shadow-2xl animate-slide-up pointer-events-auto flex flex-col shrink-0"
                            style={{ boxShadow: 'inset -4px -4px #555, inset 4px 4px #fff' }}
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-gray-800 font-bold mb-2 flex justify-between items-center pixel-font shrink-0 text-sm px-1">
                                <span>{t('chest.inventory', 'Inventory')}</span>
                                <span className="text-[10px] text-gray-600">{t('chest.slots', '{{count}} slots', { count: totalSlots })}</span>
                            </h3>

                            <div className="flex flex-wrap gap-0.5 overflow-y-auto p-1 bg-[#C6C6C6] flex-1 content-start select-none">
                                {items.length === 0 && <div className="w-full text-center text-gray-500 text-xs py-4 pixel-font">{t('chest.empty', 'Empty Inventory')}</div>}
                                {items.map(item => (
                                    <ChestItem
                                        key={item.chestInstanceId || getStackId(item)}
                                        item={item}
                                        onRemove={() => removeStack(getStackId(item))}
                                        onDragSuccess={() => commitDragRemove(item)}
                                        pos='left'
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Right Modal (JR Ticket) */}
                        <div
                            className="w-[400px] h-[190px] bg-[#dbeafe] shadow-2xl animate-slide-up pointer-events-auto relative overflow-hidden shrink-0"
                            style={{
                                // Both modals are exactly 190px tall.
                                border: '1px solid #bfdbfe',
                                borderRadius: '0'
                            }}
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Dark Blue Stripe - rendered BEFORE (under) the watermark pattern */}
                            <div className="absolute bottom-8 left-0 right-0 h-10 bg-[#cbe3f7] z-0"></div>

                            {/* SVG Background Texture */}
                            <svg className="absolute inset-0 w-full h-full opacity-100 pointer-events-none z-10" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                    <linearGradient id="jr-gradient" x1="0%" y1="0%" x2="100%" y2="20%">
                                        <stop offset="0%" stop-color="#889bcd" stop-opacity="0.1" /> <stop offset="30%" stop-color="#a5b4de" stop-opacity="0.15" />    <stop offset="90%" stop-color="#e3edfc" stop-opacity="0.6" />  </linearGradient>
                                </defs>
                                <pattern id="jr-bg" width="200" height="120" patternUnits="userSpaceOnUse" patternTransform="scale(0.35)">
                                    <g transform="translate(50, 0) scale(0.2)">
                                        <path d="M0 0 C31.38945098 -0.09134368 62.77886665 -0.16208677 94.16841908 -0.20426132 C97.87823012 -0.20926386 101.58804091 -0.21444118 105.29785156 -0.21972656 C106.40563867 -0.22130043 106.40563867 -0.22130043 107.53580531 -0.22290608 C119.4778805 -0.24028884 131.41987829 -0.27181471 143.36190763 -0.30861118 C155.62485532 -0.34608002 167.8877626 -0.36824838 180.15076518 -0.37635398 C187.71149609 -0.38182947 195.2720082 -0.39909338 202.83267173 -0.43166587 C208.64019774 -0.45540387 214.44758502 -0.45780489 220.25514984 -0.45243073 C222.6302576 -0.45352791 225.00537392 -0.4614409 227.38043213 -0.4768219 C246.89811393 -0.59698129 259.84670379 1.35718558 274.625 15.125 C279.76756675 20.46745451 283.4392101 26.52797089 287 33 C287.47308594 33.84949219 287.94617188 34.69898438 288.43359375 35.57421875 C301.54901403 61.60076927 301.14148585 95.18341182 292.875 122.5 C286.50523208 140.44246939 277.29951925 155.93535656 259.71875 164.62109375 C253.00514825 167.02827332 245.56017055 166.84890315 238.5 167.1875 C236.99472824 167.26901935 235.48951845 167.35169169 233.984375 167.43554688 C230.3235365 167.63700828 226.662103 167.82281173 223 168 C224.40466704 169.73045281 225.81130832 171.45930316 227.21875 173.1875 C228.00185547 174.15042969 228.78496094 175.11335937 229.59179688 176.10546875 C231.83342123 178.79978124 234.13714854 181.41194443 236.5 184 C239.52282421 187.31989486 242.42512161 190.69764112 245.25 194.1875 C249.41084769 199.32694428 253.71734489 204.32326152 258.05932617 209.30908203 C261.59160084 213.36783358 265.09427037 217.44890109 268.5625 221.5625 C274.33591356 228.40867268 280.16544931 235.2059162 286 242 C288.14635913 244.49954926 290.29209058 246.99963558 292.4375 249.5 C292.9214624 250.06323975 293.4054248 250.62647949 293.90405273 251.20678711 C294.82325675 252.27809998 295.74057119 253.35103775 296.65576172 254.42578125 C297.58329181 255.51199884 298.51765868 256.5924027 299.45751953 257.66796875 C303 261.77908764 303 261.77908764 303 264 C292.16067502 264.41909424 281.32330703 264.73786472 270.47749901 264.93261909 C265.43942444 265.02615583 260.40693103 265.15269909 255.37207031 265.35791016 C220.0631382 266.76016012 220.0631382 266.76016012 212.35839844 260.15917969 C209.16014383 256.52303177 206.97637407 252.66170986 205.05706787 248.23382568 C203.39789696 244.72761884 200.99440465 241.93943451 198.5 239 C197.6104661 237.87825265 196.72456554 236.75360607 195.84375 235.625 C195.39 235.0475 194.93625 234.47 194.46875 233.875 C191.02949975 229.48446777 187.61291437 225.07623535 184.19140625 220.671875 C180.64109508 216.10385976 177.0790019 211.5455646 173.5 207 C166.35403533 197.92215892 159.27575265 188.79164276 152.18847656 179.66796875 C146.30842339 172.09926862 140.42816506 164.53111114 134.5 157 C127.96339579 148.69513876 121.47716378 140.35126701 115 132 C114.5157959 131.37641602 114.0315918 130.75283203 113.53271484 130.11035156 C97 108.80414803 97 108.80414803 97 107 C97.64383951 106.99853344 98.28767902 106.99706688 98.95102882 106.99555588 C114.62556931 106.95848527 130.29985086 106.89946743 145.97420692 106.81609726 C153.55426 106.77630766 161.13420926 106.74391483 168.71435547 106.72900391 C175.32212822 106.7159869 181.92967257 106.68902125 188.53731668 106.64538693 C192.03525629 106.62277286 195.53291419 106.60708926 199.03093338 106.60811615 C202.93833798 106.60900164 206.84516762 106.57874222 210.75244141 106.54589844 C211.90906281 106.5509288 213.0656842 106.55595917 214.25735474 106.56114197 C220.45902698 106.48038555 224.30824041 106.21390146 229 102 C234.02051012 95.17760817 234.67275229 85.91168708 233.55859375 77.77734375 C232.22709944 71.63725284 230.84455165 67.10733727 226 63 C218.41815559 59.1172629 210.14019631 59.55761103 201.84155273 59.56762695 C200.32299509 59.55859719 198.8044447 59.54826701 197.28590393 59.53674316 C193.18737448 59.50928947 189.08898377 59.49990456 184.99037433 59.49388909 C180.69820384 59.48447498 176.40613576 59.45826923 172.11402893 59.43388367 C163.99700937 59.39029827 155.88000978 59.3617025 147.762909 59.33856028 C138.51735146 59.31146583 129.27189734 59.26755701 120.0264138 59.22227156 C101.01766388 59.12953935 82.00888661 59.05780643 63 59 C63.00368717 59.76199833 63.00737434 60.52399666 63.01117325 61.30908585 C63.09968808 79.889672 63.16578908 98.47021582 63.20724869 117.05096817 C63.22783354 126.0366602 63.25587572 135.02221109 63.30175781 144.0078125 C63.34175091 151.84387428 63.36746242 159.67983378 63.37635398 167.51599479 C63.38154772 171.66140903 63.39366876 175.80653081 63.42292023 179.95185089 C63.45028706 183.86217212 63.45840262 187.7720834 63.45243073 191.6824913 C63.45352154 193.10942445 63.4613481 194.53637284 63.4768219 195.9632225 C63.65254487 213.01879521 58.53639662 224.28131535 46.9375 236.5625 C19.16916275 263.45714128 -23.6679734 268.22239379 -60.5625 268.25 C-61.37713715 268.25067474 -62.19177429 268.25134949 -63.03109741 268.25204468 C-101.81293399 268.2013284 -147.92699017 263.12376831 -176.9375 234.5 C-191.0952729 219.65061175 -191.58346761 204.24629085 -191.390625 184.63671875 C-191.38315157 182.39085904 -191.37746386 180.14499275 -191.37347412 177.89912415 C-191.35830463 172.02842762 -191.31909861 166.15813583 -191.2746582 160.28759766 C-191.22626566 153.22228609 -191.20813012 146.15683813 -191.18484497 139.09140778 C-191.14624176 128.39399157 -191.06952674 117.69746097 -191 107 C-169.55 107 -148.1 107 -126 107 C-125.98582031 112.754375 -125.97164063 118.50875 -125.95703125 124.4375 C-125.93696388 128.09250873 -125.91543683 131.7473929 -125.88867188 135.40234375 C-125.84636813 141.19812871 -125.80934407 146.99359777 -125.80444336 152.78955078 C-125.80015116 157.46475686 -125.77161227 162.13925471 -125.72656822 166.8142395 C-125.71362261 168.5938809 -125.7092751 170.37360718 -125.71384621 172.15328979 C-125.98851734 185.01118527 -125.98851734 185.01118527 -120 196 C-106.23505808 206.93315601 -83.54587986 207.39780837 -66.8125 207.3125 C-65.72524628 207.31026428 -65.72524628 207.31026428 -64.61602783 207.3079834 C-53.48558329 207.26688788 -42.84848884 206.60631046 -32 204 C-31.33387695 203.85014648 -30.66775391 203.70029297 -29.98144531 203.54589844 C-20.87885114 201.48962896 -11.35239202 199.24358222 -4.5 192.5625 C-1.40244368 187.27084129 -0.70479286 182.33433887 -0.7215271 176.29312134 C-0.7128385 175.15837106 -0.7128385 175.15837106 -0.70397437 174.00069654 C-0.68702624 171.47649485 -0.68410236 168.95247657 -0.68115234 166.42822266 C-0.67185058 164.61454828 -0.66168154 162.80087818 -0.65071106 160.98721313 C-0.62342497 156.07037893 -0.60826573 151.15357335 -0.59528303 146.23668337 C-0.57964645 141.09569295 -0.55285789 135.95476094 -0.5272522 130.81381226 C-0.4804738 121.08172624 -0.44372511 111.34962922 -0.41057932 101.61748827 C-0.37235134 90.53650811 -0.32294293 79.45558664 -0.27259517 68.37465596 C-0.16928926 45.58314747 -0.08002446 22.79160128 0 0 Z " fill="url(#jr-gradient)" />
                                    </g>
                                </pattern>
                                <rect width="100%" height="100%" fill="url(#jr-bg)" />
                            </svg>

                            {/* Top Title - Centered */}
                            <div className="absolute top-3 left-0 right-0 text-center text-gray-800 tracking-[0.3em] font-serif text-sm z-20 font-bold">
                                乗 車 券
                            </div>

                            {/* Slots Container - Moved up significantly */}
                            <div className="absolute top-12 left-0 right-0 flex items-center justify-center z-20 gap-6">
                                {/* Start Slot */}
                                <DropZone
                                    onDrop={(item) => handleTicketDrop(setTicketStart, ticketStart, item)}
                                >
                                    <div className="w-16 h-16 bg-white/50 rounded-sm border border-dashed border-blue-400 relative flex items-center justify-center shadow-sm backdrop-blur-sm">
                                        {!ticketStart && <span className="text-xs text-blue-400/50">{t('chest.origin', '起点')}</span>}
                                        {ticketStart && (
                                            <ChestItem
                                                item={ticketStart}
                                                onRemove={() => { handleDrop(ticketStart, true); setTicketStart(null); }}
                                                onDragSuccess={() => setTicketStart(null)}
                                                pos='right'
                                            />
                                        )}
                                    </div>
                                </DropZone>

                                {/* Arrow */}
                                <div className="text-gray-800 font-bold scale-x-200 text-3xl px-4">→</div>

                                {/* End Slot */}
                                <DropZone
                                    onDrop={(item) => handleTicketDrop(setTicketEnd, ticketEnd, item)}
                                >
                                    <div className="w-16 h-16 bg-white/50 rounded-sm border border-dashed border-blue-400 relative flex items-center justify-center shadow-sm backdrop-blur-sm">
                                        {!ticketEnd && <span className="text-xs text-blue-400/50">{t('chest.dest', '终点')}</span>}
                                        {ticketEnd && (
                                            <ChestItem
                                                item={ticketEnd}
                                                onRemove={() => { handleDrop(ticketEnd, true); setTicketEnd(null); }}
                                                onDragSuccess={() => setTicketEnd(null)}
                                                pos='right'
                                            />
                                        )}
                                    </div>
                                </DropZone>
                            </div>

                            {/* Bottom Button */}
                            <button
                                className={`absolute bottom-2 right-2 z-30 w-28 h-12 rounded-lg text-blue-500 border-2 flex flex-col items-center justify-center cursor-pointer transition-all duration-300
                                    ${(ticketStart && ticketEnd) ? 'border-blue-700 opacity-100 shadow-md hover:scale-105' : 'border-dashed border-blue-400 bg-transparent opacity-50 cursor-not-allowed text-blue-50'}
                                    ${isStamping ? 'stamp-animation' : ''}
                                `}
                                style={{
                                    fontFamily: '"MS Mincho", "Noto Serif CJP", serif'
                                }}
                                disabled={!ticketStart || !ticketEnd || isStamping}
                                onClick={triggerAutoRoute}
                            >
                                <span className="text-[10px] tracking-[0.2em] font-bold leading-none mb-1">{t('chest.memorial', '乘车纪念')}</span>
                                <div className="w-20 h-px bg-current mb-1"></div>
                                <span className="text-[12px] tracking-[0.3em] font-bold leading-none">{t('chest.used', '使用済')}</span>
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

const ChestItem = ({ item, onRemove, onDragSuccess, pos }) => {
    const { startDrag, isDragging, dragItem } = useDrag();
    const isHidden = isDragging && dragItem?.chestInstanceId === item.chestInstanceId;

    const handleDragStart = (e) => {
        e.stopPropagation();
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
            className={pos === 'left' ? "relative group w-12 h-12" : "relative group w-full h-full"}
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
