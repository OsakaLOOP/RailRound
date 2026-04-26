import * as React from "react";
const { useEffect, useMemo, useRef } = React;

import { MapPin, ArrowRight, RotateCcw } from "lucide-react";
import { ErrorBoundary } from "./ErrorBoundary";
import { LineLogo } from "./LineLogo";
import { PromoBanner } from "./PromoBanner";
import { useT, type Locale, detectLocale } from "./i18n";
import type { RouteSliceData, RouteSlicePathData } from "./types";

import "./leaflet-map.css";
import { useLeafletMap } from "./useLeafletMap";

interface Props {
  data: RouteSliceData;
  locale?: Locale;
  height?: string;
  theme?: "light" | "dark";
  labels?: Partial<Record<string, string>>;
  showPromo?: boolean;
}

function createFallbackPath(data: RouteSliceData): RouteSlicePathData {
  return {
    stations: data.stations ?? [],
    routeCoords: data.routeCoords ?? [],
    color: data.color ?? null,
    meta: data.meta ?? null,
  };
}

function getPathKey(path: RouteSlicePathData, idx: number) {
  const startId = path.stations[0]?.id ?? "start";
  const endId = path.stations[path.stations.length - 1]?.id ?? "end";
  const lineKey = path.meta?.lineKey ?? `line-${idx}`;
  return `${idx}-${lineKey}-${startId}-${endId}`;
}

export const RouteSlicePreview: React.FC<Props> = ({
  data,
  locale = detectLocale(),
  height = "400px",
  theme = "light",
  labels,
  showPromo = true,
}) => {
  const t = useT(locale, labels);
  const dark = theme === "dark";

  const mapRef = useRef<HTMLDivElement>(null);
  const {
    mapInstanceRef,
    routeLayerRef,
    mapReady,
    fitBounds,
    resetView,
    getL,
  } = useLeafletMap({
    containerRef: mapRef,
    dark,
  });

  const renderPaths = useMemo(() => {
    const incoming = (data.paths ?? []).filter(
      (path) => (path.stations?.length ?? 0) > 0,
    );
    if (incoming.length > 0) return incoming;
    return [createFallbackPath(data)];
  }, [data]);

  const overallStartName =
    renderPaths[0]?.stations[0]?.name_ja ?? data.stations[0]?.name_ja ?? "";
  const lastPath = renderPaths[renderPaths.length - 1];
  const overallEndName =
    lastPath?.stations[lastPath.stations.length - 1]?.name_ja ??
    data.stations[data.stations.length - 1]?.name_ja ??
    "";

  useEffect(() => {
    const L = getL();
    if (!data || !mapReady || !L) return;

    const map = mapInstanceRef.current;
    const routeLayer = routeLayerRef.current;
    if (!routeLayer || !map) return;

    routeLayer.clearLayers();
    let bounds = L.latLngBounds([]);

    for (const path of renderPaths) {
      const pathColor = path.color || data.color || "#39C5BB";
      if (path.routeCoords.length >= 2) {
        const polyline = L.polyline(path.routeCoords, {
          color: pathColor,
          weight: 4,
          opacity: 0.8,
        }).addTo(routeLayer);
        bounds.extend(polyline.getBounds());
      }

      const collapseStationLabels = path.stations.length > 5;
      path.stations.forEach((st, idx) => {
        const isStartEnd = idx === 0 || idx === path.stations.length - 1;
        const marker = L.circleMarker([st.lat, st.lng], {
          radius: isStartEnd ? 6 : 4,
          color: "#ffffff",
          fillColor: pathColor,
          weight: 2,
          fillOpacity: isStartEnd ? 1 : 0.6,
        });

        marker.bindTooltip(st.name_ja, {
          permanent: collapseStationLabels ? isStartEnd : true,
          direction: "top",
          offset: [0, -4],
          className:
            "text-[10px] font-bold bg-white/80 backdrop-blur border border-slate-200/50 text-slate-700 shadow-sm px-1.5 py-0.5 rounded-md",
          opacity: 0.9,
        });
        marker.addTo(routeLayer);
        bounds.extend([st.lat, st.lng]);
      });
    }

    if (bounds.isValid()) fitBounds(bounds);
  }, [
    data,
    mapReady,
    getL,
    mapInstanceRef,
    routeLayerRef,
    fitBounds,
    renderPaths,
  ]);

  const headerColor = data.color || renderPaths[0]?.color || "#39C5BB";

  return (
    <ErrorBoundary>
      <div
        className={`my-8 border rounded-2xl overflow-hidden font-sans not-prose transition-all hover:shadow-xl flex flex-col ${
          dark
            ? "bg-slate-900 border-slate-700 shadow-lg shadow-slate-900/30 text-slate-200"
            : "bg-white border-slate-200/60 shadow-lg shadow-slate-200/20 text-slate-800"
        }`}
        style={{ height }}
      >
        <div
          className={`px-4 py-3 border-b flex justify-between items-center z-[1001] relative shrink-0 ${
            dark
              ? "bg-slate-800/90 border-slate-700 backdrop-blur-md"
              : "bg-slate-50/90 border-slate-200/80 backdrop-blur-md"
          }`}
        >
          <div className="flex flex-col min-w-0">
            <span
              className={`text-[10px] font-bold tracking-wider uppercase mb-1.5 flex items-center gap-1 ${
                dark ? "text-slate-500" : "text-slate-400"
              }`}
            >
              <MapPin size={10} style={{ color: headerColor }} />
              {t("routeSlicePreview")}
            </span>

            <span
              className={`text-[11px] font-medium px-2.5 py-0.5 rounded-md border inline-flex items-center w-fit mb-2 ${
                dark
                  ? "bg-slate-800/80 text-slate-400 border-slate-700"
                  : "bg-slate-100/80 text-slate-500 border-slate-200/80"
              }`}
            >
              {overallStartName}
              <ArrowRight size={12} className="mx-1 text-slate-400 shrink-0" />
              {overallEndName}
            </span>

            <div className="flex flex-col gap-1.5">
              {renderPaths.map((path, idx) => {
                const pathStart = path.stations[0]?.name_ja ?? "";
                const pathEnd = path.stations[path.stations.length - 1]?.name_ja ?? "";
                const lineName = path.meta?.lineName || path.meta?.lineKey || "";

                return (
                  <div
                    key={getPathKey(path, idx)}
                    className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 min-w-0"
                  >
                    {path.meta?.icon ? (
                      <LineLogo
                        src={path.meta.icon}
                        companyIcon={path.meta.companyIcon}
                        recolor={path.meta.recolor}
                        color={path.meta.color}
                        className="h-7 w-auto max-w-[140px]"
                      />
                    ) : path.meta?.logo ? (
                      <img
                        src={path.meta.logo}
                        alt=""
                        className="h-7 w-auto max-w-[140px] object-contain opacity-70 grayscale block"
                        draggable={false}
                      />
                    ) : (
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: path.color || headerColor }}
                      />
                    )}

                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-md border shadow-sm ${
                        dark
                          ? "bg-slate-700 text-slate-300 border-slate-600"
                          : "bg-white text-slate-700 border-slate-200"
                      } whitespace-nowrap`}
                    >
                      {lineName}
                    </span>

                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-md border flex items-center min-w-0 overflow-hidden whitespace-nowrap text-ellipsis ${
                        dark
                          ? "bg-slate-800/80 text-slate-400 border-slate-700"
                          : "bg-slate-100/80 text-slate-500 border-slate-200/80"
                      }`}
                    >
                      {pathStart}
                      <ArrowRight
                        size={11}
                        className="mx-1 text-slate-400 shrink-0"
                      />
                      {pathEnd}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col items-end gap-1.5">
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-md shadow-sm"
                style={{
                  color: headerColor,
                  backgroundColor: headerColor + "1A",
                  borderColor: headerColor + "33",
                }}
              >
                {data.distance} km
              </span>
              <span
                className={`text-[9px] font-bold tracking-wide uppercase ${
                  dark ? "text-slate-500" : "text-slate-400"
                }`}
              >
                Est. {data.time} min
              </span>
            </div>
            <button
              onClick={resetView}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                dark
                  ? "text-slate-500 hover:text-slate-300 hover:bg-slate-700"
                  : "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
              }`}
              title={t("resetView")}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        <div
          className={`flex-1 relative ${dark ? "bg-slate-800" : "bg-slate-50"}`}
          style={{ minHeight: 200 }}
        >
          <div ref={mapRef} className="absolute inset-0 z-0" />
        </div>

        {showPromo && (
          <PromoBanner
            locale={locale}
            color={headerColor}
            labels={labels}
            dark={dark}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};
