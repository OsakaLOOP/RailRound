import * as React from "react";
const { useEffect, useState, useRef } = React;

import { fetchAndParseData } from "../../../../src/utils/fetchAndParseData";
import { findRoute } from "../../../../src/core/railwayRouting";
import {
  calcDist,
  sliceGeoJsonPath,
} from "../../../../src/core/tripCalculator";
import { MapPin, ArrowRight, RotateCcw } from "lucide-react";
import { ErrorBoundary } from "../../../../src/components/common/ErrorBoundary";
import { LineLogo } from "../../../../src/components/LineLogo";
import { useTranslation } from "react-i18next";

import "./leaflet-map.css";
import { useLeafletMap } from "./useLeafletMap";

interface Props {
  lineKey: string;
  startStation: string;
  endStation: string;
}

interface Station {
  id: string;
  name_ja: string;
  name_en?: string;
  lat: number;
  lng: number;
}

interface RouteData {
  stations: Station[];
  routeCoords: [number, number][];
  distance: string;
  time: string;
  color: string | null;
  meta: {
    icon?: string | null;
    logo?: string | null;
    companyIcon?: string | null;
    recolor?: boolean;
    color?: string | null;
  } | null;
}

export const RouteSlicePreview: React.FC<Props> = ({
  lineKey,
  startStation,
  endStation,
}) => {
  const { t } = useTranslation();

  const [data, setData] = useState<RouteData | null>(null);
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

  // Data loading — independent from map lifecycle
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const { railwayData, geoData } = await fetchAndParseData();
        if (!mounted) return;

        if (!railwayData?.[lineKey]) {
          throw new Error(t("routeNotFound", { key: lineKey }));
        }

        const line = railwayData[lineKey];
        const startNode = line.stations.find(
          (s: Station) =>
            s.name_ja === startStation || s.name_en === startStation,
        );
        const endNode = line.stations.find(
          (s: Station) => s.name_ja === endStation || s.name_en === endStation,
        );

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

        if (!result || result.error || !result.segments) {
          throw new Error(result?.error || t("routeNotFound"));
        }

        const routeSegments = result.segments;
        const stationSequence = routeSegments.flatMap((seg: any) => {
          const lineObj = railwayData[seg.lineKey];
          if (!lineObj) return [];
          const sIdx = lineObj.stations.findIndex(
            (s: Station) => s.id === seg.fromId,
          );
          const eIdx = lineObj.stations.findIndex(
            (s: Station) => s.id === seg.toId,
          );
          if (sIdx === -1 || eIdx === -1) return [];

          const path: Station[] = [];
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
          (st: Station, i: number, arr: Station[]) =>
            i === 0 || st.id !== arr[i - 1].id,
        );

        // Build actual track coords via GeoJSON slicing (matching main app behavior)
        const allTrackCoords: [number, number][] = [];
        for (const seg of routeSegments) {
          const lineObj = railwayData[seg.lineKey];
          if (!lineObj) continue;
          const s1 = lineObj.stations.find((s: Station) => s.id === seg.fromId);
          const s2 = lineObj.stations.find((s: Station) => s.id === seg.toId);
          if (!s1 || !s2) continue;

          let coords: [number, number][] | null = null;

          if (geoData?.features) {
            const parts = seg.lineKey.split(":");
            const company = parts[0];
            const lineName = parts.slice(1).join(":");
            const feature = geoData.features.find(
              (f: any) =>
                f.properties?.type === "line" &&
                f.properties?.name === lineName &&
                f.properties?.company === company,
            );
            if (feature) {
              const sliced = sliceGeoJsonPath(
                feature,
                s1.lat,
                s1.lng,
                s2.lat,
                s2.lng,
              );
              if (sliced && sliced.length > 0) {
                if (typeof sliced[0][0] === "number") {
                  coords = sliced as [number, number][];
                } else {
                  // Multi-segment (loop line wrap)
                  for (const part of sliced as [number, number][][]) {
                    allTrackCoords.push(...part);
                  }
                  continue;
                }
              }
            }
          }

          // Fallback to station-to-station straight line
          if (!coords) {
            coords = [
              [s1.lat, s1.lng],
              [s2.lat, s2.lng],
            ];
          }
          allTrackCoords.push(...coords);
        }

        let totalDist = 0;
        for (let i = 0; i < uniqueSequence.length - 1; i++) {
          const st1 = uniqueSequence[i];
          const st2 = uniqueSequence[i + 1];
          totalDist += calcDist(st1.lat, st1.lng, st2.lat, st2.lng);
        }
        const estimatedTime =
          (totalDist / 80) * 60 + uniqueSequence.length * 1.5;

        const routeColor = line.meta?.color || null;

        if (mounted) {
          setData({
            stations: uniqueSequence,
            routeCoords: allTrackCoords,
            distance: totalDist.toFixed(1),
            time: estimatedTime.toFixed(0),
            color: routeColor,
            meta: {
              icon: line.meta?.icon || null,
              logo: line.meta?.logo || null,
              companyIcon: line.meta?.companyIcon || null,
              recolor: line.meta?.recolor || false,
              color: routeColor,
            },
          });
        }
      } catch (e: any) {
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

  // Route drawing — waits for both data and map to be ready
  useEffect(() => {
    const L = getL();
    if (!data || loading || error || !mapReady || !L) return;

    const map = mapInstanceRef.current;
    const routeLayer = routeLayerRef.current;
    if (!routeLayer || !map) return;

    routeLayer.clearLayers();
    let bounds = L.latLngBounds([]);

    const polyline = L.polyline(data.routeCoords, {
      color: data.color || "#39C5BB",
      weight: 4,
      opacity: 0.8,
    }).addTo(routeLayer);
    bounds.extend(polyline.getBounds());

    data.stations.forEach((st, idx) => {
      const isStartEnd = idx === 0 || idx === data.stations.length - 1;
      const marker = L.circleMarker([st.lat, st.lng], {
        radius: isStartEnd ? 6 : 4,
        color: "#ffffff",
        fillColor: data.color || "#39C5BB",
        weight: 2,
        fillOpacity: isStartEnd ? 1 : 0.6,
      });

      marker.bindTooltip(st.name_ja, {
        permanent: true,
        direction: "top",
        offset: [0, -4],
        className:
          "text-[10px] font-bold bg-white/80 backdrop-blur border border-slate-200/50 text-slate-700 shadow-sm px-1.5 py-0.5 rounded-md",
        opacity: 0.9,
      });

      marker.addTo(routeLayer);
    });

    if (bounds.isValid()) {
      fitBounds(bounds);
    }
  }, [
    data,
    loading,
    error,
    mapReady,
    getL,
    mapInstanceRef,
    routeLayerRef,
    fitBounds,
  ]);

  return (
    <ErrorBoundary>
      <div className="my-8 border border-slate-200/60 rounded-2xl overflow-hidden bg-white shadow-lg shadow-slate-200/20 font-sans text-slate-800 not-prose transition-all hover:shadow-xl flex flex-col h-[400px]">
        <div className="bg-slate-50/90 backdrop-blur-md px-4 py-3 border-b border-slate-200/80 flex justify-between items-center z-[1001] relative">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1.5 flex items-center gap-1">
              <MapPin size={10} style={{ color: data?.color || "#39C5BB" }} />{" "}
              {t("routeSlicePreview")}
            </span>
            <div className="flex items-center gap-2">
              {data?.meta?.icon ? (
                <LineLogo
                  src={data.meta.icon}
                  companyIcon={data.meta.companyIcon}
                  recolor={data.meta.recolor}
                  color={data.meta.color}
                  className="max-h-[50px] w-auto"
                />
              ) : data?.meta?.logo ? (
                <img
                  src={data.meta.logo}
                  alt=""
                  className="max-h-[50px] w-auto object-contain opacity-70 grayscale"
                  draggable={false}
                />
              ) : null}
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
                <span
                  className="text-xs font-bold px-2.5 py-0.5 rounded-md shadow-sm"
                  style={{
                    color: data.color || "#39C5BB",
                    backgroundColor: (data.color || "#39C5BB") + "1A",
                    borderColor: (data.color || "#39C5BB") + "33",
                  }}
                >
                  {data.distance} km
                </span>
                <span className="text-[9px] font-bold text-slate-400 tracking-wide uppercase">
                  Est. {data.time} min
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
