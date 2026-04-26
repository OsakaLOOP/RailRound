import React, { createContext, useContext, useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { isMobile } from 'react-device-detect';
import railBg from './../assets/rail_bg.png'
// --- Global Drag Context ---
const DragContext = createContext(null);

export const DragProvider = ({ children }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragItem, setDragItem] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [dropZone, setDropZone] = useState(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragThresholdMet = useRef(false);

  // Global Mouse/Touch Handlers
  useEffect(() => {
    if (!dragItem) return;

    const handleMove = (x, y) => {
      if (!dragThresholdMet.current) {
         const dx = x - dragStartPos.current.x;
         const dy = y - dragStartPos.current.y;
         if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
             dragThresholdMet.current = true;
             setIsDragging(true);
         } else {
             return; // Ignore small movements
         }
      }

      setCursorPos({ x, y });

      // 拖拽激活时, 禁止全局文字选择 / Prevent global text selection during active drag
      if (!document.body.classList.contains('dragging-active')) {
          document.body.classList.add('dragging-active');
          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';
      }

      const target = document.elementFromPoint(x, y);
      if (target) {
          const zone = target.closest('[data-dropzone-id]');
          if (zone) {
              const id = zone.getAttribute('data-dropzone-id');
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
        if (dragThresholdMet.current) {
            e.preventDefault(); // Prevent scrolling while actively dragging an item
        }
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
    };

    const onEnd = () => {
      if (!dragThresholdMet.current) {
          // It was a click, not a drag.
          if (dragItem?.onClick) {
              dragItem.onClick();
          }
          setIsDragging(false);
          setDragItem(null);
          setDropZone(null);
          return;
      }

      let droppedOnValidZone = false;
      if (dropZone) {
        dropZone.onDrop(dragItem);
        droppedOnValidZone = true;
      }

      if (dragItem?.onDragEnd) {
          dragItem.onDragEnd(droppedOnValidZone);
      }

      setIsDragging(false);
      setDragItem(null);
      setDropZone(null);
      document.body.classList.remove('dragging-active');
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    };

    const onBlur = () => {
        if (isDragging) onEnd();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('blur', onBlur);
    };
  }, [isDragging, dragItem, dropZone]);

  const startDrag = (item, e) => {
    if (e && e.type === 'mousedown') {
        e.preventDefault(); // 阻止默认事件, 防止文字选择和原生拖拽 / Prevent default to avoid text selection and native drag
    }
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setDragItem(item);
    setCursorPos({ x: clientX, y: clientY });
    dragStartPos.current = { x: clientX, y: clientY };
    dragThresholdMet.current = false;

    // We no longer start dragging immediately for mouse, 
    // to allow distinguishing between click and drag.
    // Movement threshold (5px) will be checked in handleMove.
  };

  return (
    <DragContext.Provider value={{ isDragging, dragItem, startDrag, setDropZone }}>
      {children}
      {isDragging && dragItem && (
        <DragOverlay item={dragItem} pos={cursorPos} />
      )}
    </DragContext.Provider>
  );
};

export const useDrag = () => useContext(DragContext);

if (!window.__dropZoneRegistry) window.__dropZoneRegistry = {};

export const DropZone = ({ onDrop, children, className = "", activeClassName = "dropzone-glow" }) => {
    const { isDragging, setDropZone } = useDrag();
    const [isOver, setIsOver] = useState(false);
    const dropZoneId = useId();

    useEffect(() => {
        window.__dropZoneRegistry[dropZoneId] = onDrop;
        return () => { delete window.__dropZoneRegistry[dropZoneId]; };
    }, [onDrop, dropZoneId]);

    return (
        <div
            data-dropzone-id={dropZoneId}
            className={`${className} ${isDragging && isOver ? activeClassName : ''}`}
            onMouseEnter={() => { if(isDragging) { setIsOver(true); setDropZone({ onDrop }); } }}
            onMouseLeave={() => { if(isDragging) { setIsOver(false); setDropZone(null); } }}
        >
            {children}
        </div>
    );
};

const DragOverlay = ({ item, pos }) => {
    return createPortal(
        <div
            style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                transform: 'translate(-50%, -50%) rotate(-5deg)',
                pointerEvents: 'none',
                zIndex: 9999,
                width: '120px',
                height: '120px',
            }}
            className="animate-pop-in filter drop-shadow-xl"
        >
            <div className="relative w-full h-full">
                <img src={railBg} alt="" className="w-full h-full object-contain pixelated" draggable={false} />
                {item.logo && (
                    <img
                        src={item.logo}
                        alt=""
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full w-12 h-12 object-contain"
                        draggable={false}
                    />
                )}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap font-bold border border-white/20">
                    {item.name || item.lineKey}
                </div>
            </div>
        </div>,
        document.body
    );
};
