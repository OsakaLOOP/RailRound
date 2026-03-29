import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isMobile } from 'react-device-detect';
import { useGeo } from '../globalContext';

// --- Global Drag Context ---
const DragContext = createContext(null);

export const DragProvider = ({ children }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragItem, setDragItem] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [dropZone, setDropZone] = useState(null);
  const [targetStation, setTargetStation] = useState(null);

  const { railwayData, mapInstanceRef } = useGeo() || {};

  // Global Mouse/Touch Handlers
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (x, y) => {
      setCursorPos({ x, y });

      let foundTarget = null;
      if (dragItem?.type === 'station' && mapInstanceRef?.current && railwayData) {
          let minDistance = Infinity;
          let bestStation = null;

          Object.keys(railwayData).forEach(lineKey => {
             const line = railwayData[lineKey];
             line.stations.forEach(station => {
                 // Skip the dragged station itself
                 if (station.id === dragItem.id) return;
                 const containerPoint = mapInstanceRef.current.latLngToContainerPoint([station.lat, station.lng]);
                 const dist = Math.hypot(x - containerPoint.x, y - containerPoint.y);
                 if (dist < 30 && dist < minDistance) {
                     minDistance = dist;
                     bestStation = {
                         ...station,
                         lineKey,
                         containerPoint,
                         logo: line.meta.logo,
                         icon: line.meta.icon,
                         company: line.meta.company
                     };
                 }
             });
          });

          if (bestStation) {
              foundTarget = bestStation;
          }
      }
      setTargetStation(foundTarget);

      // Manual Drop Zone Detection for Touch (and Mouse consistency)
      // Since the overlay might block events or touch/mouse enter behavior varies
      // We hide the overlay pointer events, so document.elementFromPoint works
      const target = document.elementFromPoint(x, y);
      if (target) {
          const zone = target.closest('[data-dropzone-id]');
          if (zone) {
              const id = zone.getAttribute('data-dropzone-id');
              // We need to map ID back to the callback.
              // Since we can't easily pass callbacks via DOM attributes,
              // we rely on a registry or the DropZone component updating the context itself on hover (mouse).
              // For Touch, we need a registry.
              const handler = window.__dropZoneRegistry?.[id];
              if (handler) {
                  setDropZone({ onDrop: handler });
                  return;
              }
          }
      }
      setDropZone(null);
    };

    const onMouseMove = (e) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e) => {
        // e.preventDefault(); // Prevent scrolling while dragging
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
    };

    const onEnd = () => {
      if (targetStation && dragItem?.type === 'station') {
        window.dispatchEvent(new CustomEvent('stationDrop', {
            detail: { startStation: dragItem, endStation: targetStation }
        }));
      } else if (dropZone) {
        dropZone.onDrop(dragItem);
      }
      setIsDragging(false);
      setDragItem(null);
      setDropZone(null);
      setTargetStation(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, dragItem, dropZone]);

  const startDrag = (item, e) => {
    // e.preventDefault();
    // e.stopPropagation();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setDragItem(item);
    setCursorPos({ x: clientX, y: clientY });
    setIsDragging(true);
  };

  return (
    <DragContext.Provider value={{ isDragging, dragItem, startDrag, setDropZone }}>
      {children}
      {isDragging && dragItem && (
        <DragOverlay item={dragItem} pos={cursorPos} targetStation={targetStation} />
      )}
    </DragContext.Provider>
  );
};

export const useDrag = () => useContext(DragContext);

// --- Drop Zone Component ---
// Uses a global registry pattern for touch detection compatibility
if (!window.__dropZoneRegistry) window.__dropZoneRegistry = {};

export const DropZone = ({ onDrop, children, className = "", activeClassName = "ring-2 ring-emerald-400 bg-emerald-50" }) => {
    const { isDragging, setDropZone } = useDrag();
    const [isOver, setIsOver] = useState(false);
    const idRef = useRef(Math.random().toString(36).substr(2, 9));

    useEffect(() => {
        window.__dropZoneRegistry[idRef.current] = onDrop;
        return () => { delete window.__dropZoneRegistry[idRef.current]; };
    }, [onDrop]);

    // Polling or Context-driven active state check would be cleaner, but for now
    // we let the Provider setDropZone, and we check if *we* are the active one.
    // However, DropZone doesn't know if IT is the active one from context easily without an ID.
    // Let's simplify: purely CSS visual feedback based on 'isDragging' + local hover is handled by mouse.
    // For touch, we might miss the "highlight" visual unless we share state back.
    // BUT the requirement is "accurate data dropping", visual highlight is secondary (but good).

    return (
        <div
            data-dropzone-id={idRef.current}
            className={`${className} ${isDragging && isOver ? activeClassName : ''}`}
            onMouseEnter={() => { if(isDragging) { setIsOver(true); setDropZone({ onDrop }); } }}
            onMouseLeave={() => { if(isDragging) { setIsOver(false); setDropZone(null); } }}
        >
            {children}
        </div>
    );
};

const DragOverlay = ({ item, pos, targetStation }) => {
    const renderLine = () => {
        if (!item.originPos) return null;

        const x1 = item.originPos.x;
        const y1 = item.originPos.y;

        const x2 = targetStation ? targetStation.containerPoint.x : pos.x;
        const y2 = targetStation ? targetStation.containerPoint.y : pos.y;

        const isSnapped = !!targetStation;

        return (
            <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998, width: '100%', height: '100%' }}>
                <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isSnapped ? '#38bdf8' : '#94a3b8'}
                    strokeWidth={isSnapped ? 6 : 4}
                    strokeLinecap="round"
                    className="dash-line"
                />
                {isSnapped && (
                    <circle cx={x2} cy={y2} r="8" fill="#38bdf8" stroke="white" strokeWidth="2" />
                )}
            </svg>
        );
    };

    return createPortal(
        <>
            {renderLine()}
            <div
                style={{
                    position: 'fixed',
                    left: pos.x,
                    top: pos.y,
                    transform: 'translate(-50%, -50%) rotate(-5deg)',
                    pointerEvents: 'none', // Crucial: lets events pass through to DropZones
                    zIndex: 9999,
                    width: '120px',
                    height: '120px',
                }}
                className="animate-pop-in filter drop-shadow-xl"
            >
                <div className="relative w-full h-full">
                    {/* Rail Background */}
                    <img src="/src/assets/rail_bg.png" alt="" className="w-full h-full object-contain pixelated" />

                    {/* Logo */}
                    {item.logo && (
                        <img
                            src={item.logo}
                            alt=""
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full w-12 h-12 object-contain"
                        />
                    )}

                    {/* Text Label */}
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap font-bold border border-white/20">
                        {item.name || item.lineKey}
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
};
