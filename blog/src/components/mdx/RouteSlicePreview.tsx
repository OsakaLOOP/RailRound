import * as React from "react";
const { useEffect, useState, useRef } = React;

import { fetchAndParseData } from "../../../../src/utils/fetchAndParseData";
import { findRoute } from "../../../../src/core/railwayRouting";
import { calcDist } from "../../../../src/core/tripCalculator";
import { MapPin, ArrowRight, RotateCcw } from "lucide-react";
import { ErrorBoundary } from "../../../../src/components/common/ErrorBoundary";
import { useTranslation } from "react-i18next";

interface Props {
  lineKey: string;
  startStation: string;
  endStation: string;
}

// Dynamically inject leaflet CSS as Astro client:only doesn't handle side-effect CSS imports reliably
const ensureLeafletCSS = (): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve();
    if (document.querySelector('link[data-leaflet-css]')) return resolve();
    
    console.log("[RouteSlicePreview] Injecting Leaflet CSS via CDN");
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-leaflet-css', 'true');
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.crossOrigin = '';
    link.onload = () => resolve();
    link.onerror = () => {
      console.warn("[RouteSlicePreview] Failed to load Leaflet CSS from CDN");
      resolve();
    };
    document.head.appendChild(link);
  });
};

export const RouteSlicePreview: React.FC<Props> = ({
  lineKey,
  startStation,
  endStation,
}) => {
  const { t } = useTranslation();
  const [data, setData] = useState<{
    stations: any[];
    distance: string;
    time: string;
  } | null>(null);
  
  const mapBounds = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const routeLayer = useRef<any>(null);

  // Data Loading
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      console.log("[RouteSlicePreview] Loading data for:", { lineKey, startStation, endStation });
      try {
        const { railwayData } = await fetchAndParseData();
        if (!mounted) return;

        if (!railwayData || !railwayData[lineKey]) {
          console.warn("[RouteSlicePreview] lineKey not found in data:", lineKey);
          throw new Error(t("routeNotFound", { key: lineKey }));
        }

        const line = railwayData[lineKey];
        const startNode = line.stations.find(
          (s: any) => s.name_ja === startStation || s.name_en === startStation,
        );
        const endNode = line.stations.find(
          (s: any) => s.name_ja === endStation || s.name_en === endStation,
        );

        console.log("[RouteSlicePreview] Search result:", { startNode, endNode });

        if (!startNode || !endNode) {
          throw new Error(
            t("routeNotFound", { key: `${startStation} -> ${endStation}` }),
          );
        }

        const result = findRoute(
          lineKey,
          startNode.id,
          lineKey,
          endNode.id,
          railwayData,
          6,
        );
        
        console.log("[RouteSlicePreview] findRoute result:", result);

        if (!result || result.error || !result.segments) {
          throw new Error(result?.error || t("routeNotFound"));
        }

        const routeSegments = result.segments;
        const stationSequence = routeSegments.flatMap((seg: any) => {
          const lineObj = railwayData[seg.lineKey];
          if (!lineObj) return [];
          const sIdx = lineObj.stations.findIndex((s: any) => s.id === seg.fromId);
          const eIdx = lineObj.stations.findIndex((s: any) => s.id === seg.toId);
          if (sIdx === -1 || eIdx === -1) return [];

          const path = [];
          if (lineObj.meta?.isLoop) {
            const len = lineObj.stations.length;
            let curr = sIdx;
            const dir = seg.loopVia === "up" ? 1 : -1;
            while (true) {
              path.push(lineObj.stations[curr]);
              if (curr === eIdx) break;
              curr = (curr + dir + len) % len;
            }
          } else {
            const step = sIdx <= eIdx ? 1 : -1;
            for (let i = sIdx; step === 1 ? i <= eIdx : i >= eIdx; i += step) {
              path.push(lineObj.stations[i]);
            }
          }
          return path;
        });

        const uniqueSequence = stationSequence.filter(
          (st: any, i: number, arr: any[]) =>
            i === 0 || st.id !== arr[i - 1].id,
        );

        let totalDist = 0;
        for (let i = 0; i < uniqueSequence.length - 1; i++) {
          const st1 = uniqueSequence[i];
          const st2 = uniqueSequence[i + 1];
          totalDist += calcDist(st1.lat, st1.lng, st2.lat, st2.lng);
        }
        const estimatedTime =
          (totalDist / 80) * 60 + uniqueSequence.length * 1.5;

        setData({
          stations: uniqueSequence,
          distance: totalDist.toFixed(1),
          time: estimatedTime.toFixed(0),
        });
        console.log("[RouteSlicePreview] Processed sequence length:", uniqueSequence.length, { distance: totalDist.toFixed(1), time: estimatedTime.toFixed(0) });
      } catch (e: any) {
        console.error("[RouteSlicePreview] Data load error:", e);
        if (mounted) setError(e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [lineKey, startStation, endStation, t]);

  // Effect 1: Initialize Leaflet Map independently
  useEffect(() => {
    let mounted = true;
    if (!mapRef.current) {
      console.warn("[RouteSlicePreview] mapRef.current is null on init effect");
      return;
    }

    const init = async () => {
      console.log("[RouteSlicePreview] Effect 1: Triggering CSS injection & Leaflet load");
      await ensureLeafletCSS();
      if (!mounted || !mapRef.current) return;

      const LModule = await import("leaflet");
      if (!mounted || !mapRef.current) return;
      const L = LModule.default || LModule;

      if (!mapInstance.current && mapRef.current) {
        console.log("[RouteSlicePreview] L instance loaded, creating map on container:", mapRef.current);
        mapInstance.current = L.map(mapRef.current, {
          zoomControl: false,
          attributionControl: false,
          scrollWheelZoom: false,
        });

        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          {
            subdomains: "abcd",
            maxZoom: 20,
          },
        ).addTo(mapInstance.current);

        routeLayer.current = L.layerGroup().addTo(mapInstance.current);
        console.log("[RouteSlicePreview] Map instance created successfully", { mapReady: !!mapInstance.current, layerReady: !!routeLayer.current });
        setMapReady(true);
      }
    };

    init();

    return () => {
      mounted = false;
      if (mapInstance.current) {
        console.log("[RouteSlicePreview] Cleanup: Destroying map instance");
        mapInstance.current.remove();
        mapInstance.current = null;
        routeLayer.current = null;
        setMapReady(false);
      }
    };
  }, []);

  // Effect 2: Draw data on the map
  useEffect(() => {
    if (!data || loading || error || !mapReady || !mapInstance.current || !routeLayer.current) {
      console.log("[RouteSlicePreview] Effect 2 skipped:", { hasData: !!data, mapReady, instance: !!mapInstance.current });
      return;
    }

    import("leaflet").then((LModule) => {
      const L = LModule.default || LModule;
      const map = mapInstance.current;
      if (!routeLayer.current || !map) return;

      console.log("[RouteSlicePreview] Drawing route on map with stations count:", data.stations.length);
      routeLayer.current.clearLayers();
      let bounds = L.latLngBounds([]);

      const latLngs = data.stations.map(
        (st: any) => [st.lat, st.lng] as [number, number],
      );
      
      console.log("[RouteSlicePreview] Generated LatLngs:", latLngs.length);
      
      const polyline = L.polyline(latLngs, {
        color: "#39C5BB",
        weight: 4,
        opacity: 0.8,
      }).addTo(routeLayer.current);
      bounds.extend(polyline.getBounds());

      data.stations.forEach((st: any, idx: number) => {
        const isStartEnd = idx === 0 || idx === data.stations.length - 1;
        const marker = L.circleMarker([st.lat, st.lng], {
          radius: isStartEnd ? 6 : 4,
          fillColor: "#ffffff",
          color: isStartEnd ? "#39C5BB" : "#94a3b8",
          weight: 2,
          fillOpacity: 1,
        });

        marker.bindTooltip(st.name_ja, {
          permanent: true,
          direction: "top",
          offset: [0, -4],
          className:
            "text-[10px] font-bold bg-white/80 backdrop-blur border border-slate-200/50 text-slate-700 shadow-sm px-1.5 py-0.5 rounded-md",
          opacity: 0.9,
        });

        marker.addTo(routeLayer.current);
      });

      if (bounds.isValid()) {
        mapBounds.current = bounds;
        console.log("[RouteSlicePreview] Computed bounds:", bounds.toBBoxString());
        // Small delay to ensure container is fully rendered and CSS applied
        setTimeout(() => {
          if (!map) return;
          map.invalidateSize();
          map.fitBounds(bounds, { padding: [30, 30] });
          console.log("[RouteSlicePreview] Viewport adjusted with bounds and invalidateSize()");
        }, 150);
      } else {
        console.warn("[RouteSlicePreview] Computed bounds are invalid");
      }
    });
  }, [data, loading, error, mapReady]);

  const handleResetView = () => {
    if (mapInstance.current && mapBounds.current) {
      mapInstance.current.invalidateSize();
      mapInstance.current.fitBounds(mapBounds.current, { padding: [30, 30] });
    }
  };

  return (
    <ErrorBoundary>
      <style>{`
        .leaflet-container img {
          border-radius: 0 !important;
          max-width: none !important;
        }
        .leaflet-tooltip-pane {
          z-index: 1000 !important;
        }
        .leaflet-pane, .leaflet-tile, .leaflet-layer,
        .leaflet-tile-container, .leaflet-pane > svg {
          position: absolute !important;
          left: 0;
          top: 0;
        }
      `}</style>
      <div className="my-8 border border-slate-200/60 rounded-2xl overflow-hidden bg-white shadow-lg shadow-slate-200/20 font-sans not-prose transition-all hover:shadow-xl flex flex-col h-[400px]">
        <div className="bg-slate-50/90 backdrop-blur-md p-4 border-b border-slate-200/80 flex justify-between items-center z-[1000] relative">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1.5 flex items-center gap-1">
              <MapPin size={10} className="text-[#39C5BB]" />{" "}
              {t("routeSlicePreview")}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-sm">
                {lineKey.split(":")[1] || lineKey}
              </span>
              <span className="text-xs text-slate-500 font-medium bg-slate-100/80 px-2.5 py-0.5 rounded-md border border-slate-200/80 flex items-center">
                {startStation}{" "}
                <ArrowRight size={12} className="mx-1 text-slate-400" />{" "}
                {endStation}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-xs font-bold text-[#39C5BB] bg-[#39C5BB]/10 border border-[#39C5BB]/20 px-2.5 py-0.5 rounded-md shadow-sm">
                  {data.distance} km
                </span>
                <span className="text-[9px] font-bold text-slate-400 tracking-wide uppercase">
                  Est. {data.time} min
                </span>
              </div>
            )}
            <button
              onClick={handleResetView}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              title={t("resetView")}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 relative bg-slate-50 min-h-[300px]">
          <div ref={mapRef} className="absolute inset-0 z-0"></div>

          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
              <div className="p-4 border border-slate-200 rounded-xl bg-white text-slate-500 shadow-sm animate-pulse text-sm">
                {t("loadingRoute", {
                  key: lineKey,
                  start: startStation,
                  end: endStation,
                })}
              </div>
            </div>
          )}

          {(error || (!loading && !data)) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
              <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-500 text-sm shadow-sm max-w-md text-center">
                <div className="font-bold mb-1">{t("parseFail")}</div>
                <div className="text-xs opacity-80">{error || "Unknown Error"}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};
