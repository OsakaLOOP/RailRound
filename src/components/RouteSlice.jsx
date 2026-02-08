import React, { useState, useEffect, useRef } from 'react';
import { useGeo } from '../globalContext';
import { isMobile } from 'react-device-detect';

export const RouteSlice = ({ segments }) => {
  const { getRouteVisualData } = useGeo();
  const [data, setData] = useState({ visualPaths: [], totalDist: 0, widthPx: 0, heightPx: 0 });
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    let active = true;
    getRouteVisualData(segments).then(res => {
        if (active) setData(res);
    });
    return () => { active = false; };
  }, [segments, getRouteVisualData]);

  useEffect(() => {
    const measure = () => {
       if (containerRef.current) {
         const parent = containerRef.current.closest('.bg-white');
         if (parent) {
             setContainerWidth(parent.offsetWidth);
         }
       }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const { visualPaths, totalDist, widthPx, heightPx } = data;

  if (visualPaths.length ===0) return <div className="w-28 shrink-0 flex items-center justify-center text-xs text-gray-200 ml-2 border-l border-gray-50">Loading...</div>;

  const maxWidth = Math.max(0, containerWidth - 300);
  const shouldRotate = isMobile && widthPx > maxWidth && maxWidth > 0;

  return (
      <div ref={containerRef} className="shrink-0 ml-2 border-l border-gray-50 flex flex-row items-center justify-end pl-2 gap-2" style={{ minWidth: shouldRotate ? '40px' : '100px' }}>
          <div style={{
              width: shouldRotate ? heightPx : widthPx,
              height: shouldRotate ? widthPx : heightPx,
              maxWidth: shouldRotate ? 'none' : '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg
                viewBox="0 0 100 50"
                preserveAspectRatio="none"
                className="opacity-80"
                style={{
                    width: widthPx,
                    height: heightPx,
                    transform: shouldRotate ? 'rotate(90deg)' : 'none',
                    transformOrigin: 'center center'
                }}
            >
                {visualPaths.map((item, idx) => (
                    <path
                        key={idx}
                        d={item.path}
                        fill="none"
                        stroke={item.color || '#94a3b8'}
                        strokeWidth="4"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                ))}
            </svg>
          </div>
          <div className="text-[10px] font-bold text-gray-400 shrink-0 text-right">{Math.round(totalDist)}km</div>
      </div>
  );
};
