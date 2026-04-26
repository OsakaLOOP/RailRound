import * as React from "react";
const { useEffect, useMemo, useRef, useState } = React;

import { MapPin, ArrowRight, RotateCcw, Shuffle } from "lucide-react";
import { ErrorBoundary } from "../../../../src/components/common/ErrorBoundary";
import { LineLogo } from "../../../../src/components/LineLogo";
import { useTranslation } from "react-i18next";
import { fetchAndParseData } from "../../../../src/utils/fetchAndParseData";
import { computeAndSerializeRoute } from "../../../../src/utils/routeSerializer";
import type { RouteSliceData, RouteSliceMode, RouteSlicePathData } from "./types";

import "./leaflet-map.css";
import { useLeafletMap } from "./useLeafletMap";

type ManualSegmentInput = {
  lineKey: string;
  fromId?: string;
  toId?: string;
  fromStation?: string;
  toStation?: string;
  loopVia?: "up" | "down" | "auto";
};

interface Props {
  lineKey?: string;
  startStation?: string;
  endStation?: string;
  mode?: RouteSliceMode;
  manualSegments?: ManualSegmentInput[];
  enableModeSwitch?: boolean;
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
  lineKey,
  startStation,
  endStation,
  mode,
  manualSegments,
  enableModeSwitch = false,
}) => {
  const { t } = useTranslation();

  const fallbackMode: RouteSliceMode =
    mode ?? (manualSegments && manualSegments.length > 0 ? "manual" : "auto");
  const [activeMode, setActiveMode] = useState<RouteSliceMode>(fallbackMode);

  useEffect(() => {
    if (!enableModeSwitch) setActiveMode(fallbackMode);
  }, [enableModeSwitch, fallbackMode]);

  useEffect(() => {
    if (
      enableModeSwitch &&
      activeMode === "manual" &&
      (!manualSegments || manualSegments.length === 0)
    ) {
      setActiveMode("auto");
    }
  }, [enableModeSwitch, activeMode, manualSegments]);

  const modeInUse = enableModeSwitch ? activeMode : fallbackMode;

  const [data, setData] = useState<RouteSliceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const {
    mapInstanceRef,
    routeLayerRef,
    mapReady,
    fitBounds,
    resetView,
    getL,
  } = useLeafletMap({ containerRef: mapRef });

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        setData(null);

        const { railwayData, geoData } = await fetchAndParseData();
        if (!mounted) return;

        const result =
          modeInUse === "manual"
            ? await computeAndSerializeRoute(
                {
                  mode: "manual",
                  segments: manualSegments || [],
                  railwayData,
                  geoData,
                },
                { inlineLogos: false },
              )
            : await computeAndSerializeRoute(
                {
                  mode: "auto",
                  lineKey: lineKey || "",
                  startStation: startStation || "",
                  endStation: endStation || "",
                  railwayData,
                  geoData,
                },
                { inlineLogos: false },
              );

        if (mounted) setData(result as RouteSliceData);
      } catch (e: any) {
        if (mounted) setError(e.message || "Unknown Error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [lineKey, startStation, endStation, manualSegments, modeInUse]);

  const renderPaths = useMemo(() => {
    if (!data) return [] as RouteSlicePathData[];
    const incoming = (data.paths ?? []).filter(
      (path) => (path.stations?.length ?? 0) > 0,
    );
    if (incoming.length > 0) return incoming;
    return [createFallbackPath(data)];
  }, [data]);

  const overallStartName =
    renderPaths[0]?.stations[0]?.name_ja || startStation || "";
  const lastPath = renderPaths[renderPaths.length - 1];
  const overallEndName =
    lastPath?.stations[lastPath.stations.length - 1]?.name_ja ||
    endStation ||
    "";
  const fallbackLineName = lineKey ? lineKey.split(":")[1] || lineKey : "";

  useEffect(() => {
    const L = getL();
    if (!data || loading || error || !mapReady || !L) return;

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
    loading,
    error,
    mapReady,
    getL,
    mapInstanceRef,
    routeLayerRef,
    fitBounds,
    renderPaths,
  ]);

  const canSwitchMode =
    enableModeSwitch &&
    !!lineKey &&
    !!startStation &&
    !!endStation &&
    !!manualSegments &&
    manualSegments.length > 0;

  const headerColor = data?.color || renderPaths[0]?.color || "#39C5BB";

  return (
    <ErrorBoundary>
      <div className="my-8 border border-slate-200/60 rounded-2xl overflow-hidden bg-white shadow-lg shadow-slate-200/20 font-sans text-slate-800 not-prose transition-all hover:shadow-xl flex flex-col h-[400px]">
        <div className="bg-slate-50/90 backdrop-blur-md px-4 py-3 border-b border-slate-200/80 flex justify-between items-center z-[1001] relative">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1.5 flex items-center gap-1">
              <MapPin size={10} style={{ color: headerColor }} />
              {t("routeSlicePreview")}
            </span>

            <span className="text-[11px] text-slate-500 font-medium bg-slate-100/80 px-2.5 py-0.5 rounded-md border border-slate-200/80 inline-flex items-center w-fit mb-2">
              {overallStartName}
              <ArrowRight size={12} className="mx-1 text-slate-400 shrink-0" />
              {overallEndName}
            </span>

            <div className="flex flex-col gap-1.5">
              {renderPaths.length > 0 ? (
                renderPaths.map((path, idx) => {
                  const pathStart = path.stations[0]?.name_ja ?? "";
                  const pathEnd =
                    path.stations[path.stations.length - 1]?.name_ja ?? "";
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
                          className="max-h-[50px] w-auto max-w-[140px]"
                        />
                      ) : path.meta?.logo ? (
                        <img
                          src={path.meta.logo}
                          alt=""
                          className="max-h-[50px] w-auto max-w-[140px] object-contain opacity-70 grayscale block"
                          draggable={false}
                        />
                      ) : (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: path.color || headerColor }}
                        />
                      )}

                      <span className="text-xs font-bold text-slate-700 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-sm whitespace-nowrap">
                        {lineName}
                      </span>

                      <span className="text-[11px] text-slate-500 font-medium bg-slate-100/80 px-2 py-0.5 rounded-md border border-slate-200/80 flex items-center min-w-0 overflow-hidden whitespace-nowrap text-ellipsis">
                        {pathStart}
                        <ArrowRight
                          size={11}
                          className="mx-1 text-slate-400 shrink-0"
                        />
                        {pathEnd}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-sm">
                    {fallbackLineName}
                  </span>
                </div>
              )}
            </div>

            {canSwitchMode && (
              <div className="inline-flex items-center border border-slate-200 rounded-md overflow-hidden mt-2 w-fit">
                <button
                  onClick={() => setActiveMode("manual")}
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                    modeInUse === "manual"
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                  title={t("manualMode", "Manual mode")}
                >
                  Manual
                </button>
                <button
                  onClick={() => setActiveMode("auto")}
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors border-l border-slate-200 ${
                    modeInUse === "auto"
                      ? "bg-slate-800 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                  title={t("autoMode", "Auto mode")}
                >
                  Auto
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {data && (
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
                <span className="text-[9px] font-bold text-slate-400 tracking-wide uppercase flex items-center gap-1">
                  <Shuffle size={10} />
                  {modeInUse}
                </span>
              </div>
            )}
            <button
              onClick={resetView}
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
                  key: lineKey || "",
                  start: startStation || "",
                  end: endStation || "",
                })}
              </div>
            </div>
          )}

          {(error || (!loading && !data)) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
              <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-500 text-sm shadow-sm max-w-md text-center">
                <div className="font-bold mb-1">{t("parseFail")}</div>
                <div className="text-xs opacity-80">
                  {error || "Unknown Error"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};
