import React, { useState, useEffect, useCallback, useMemo } from "react";
import { X, Copy, Download, CheckCircle2, Loader2, Moon, Sun } from "lucide-react";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { computeAndSerializeRoute, ROUTE_EXPORT_ERRORS } from "../../utils/routeSerializer";
import { generateRouteMdx } from "../../utils/codeGenerator";
import type { RouteSliceData } from "../../utils/routeExportTypes";
import { RouteSlicePreview } from "@blog-src/components/mdx/RouteSlicePreviewStatic";
import { tripToProductRouteSegments, tripToRouteSliceData } from "../../utils/tripProductProjection";
import { buildTripDetailModel, tripDetailKeyEvents } from "../../utils/railGraphTripDetailModel";
import { RailGraphBadge, RailGraphEventPill, RailGraphRunBadges } from "../rail-graph/RailGraphBadges";

const LOCALES = ["en", "ja", "zh-cn", "zh-tw"] as const;
const HEIGHTS = ["300px", "400px", "500px", "600px"] as const;
const NO_TRIP_SEGMENTS_ERROR = "No segments found in this trip";

export const ExportRouteModal: React.FC = () => {
  const { isOpen, trip, railwayData, geoData, mileageUserEvents } = useStore(
    useShallow((state) => ({
      isOpen: state.modals.exportRouteModalOpen,
      trip: state.modals.currentTripForExport,
      railwayData: state.railwayData,
      geoData: state.geoData,
      mileageUserEvents: state.mileageUserEvents,
    })),
  );
  const setModalState = useStore((state) => state.setModalState);
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState<RouteSliceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locale, setLocale] = useState<"en" | "ja" | "zh-cn" | "zh-tw">("en");
  const [height, setHeight] = useState("400px");
  const [packageSource, setPackageSource] = useState<"npm" | "cdn">("npm");
  const [showPromo, setShowPromo] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [routeMode, setRouteMode] = useState<"manual" | "auto">("manual");
  const [copied, setCopied] = useState(false);
  const tripDetail = useMemo(() => {
    if (!trip) return null;
    return buildTripDetailModel({ trip, railwayData, userEvents: mileageUserEvents });
  }, [trip, railwayData, mileageUserEvents]);
  const isRailGraphExport = tripDetail?.kind === "rail_graph";

  const onClose = useCallback(() => {
    setModalState({ exportRouteModalOpen: false, currentTripForExport: null });
  }, [setModalState]);

  const routeErrorMessage = useCallback((message?: string) => {
    if (message === ROUTE_EXPORT_ERRORS.missingLine) {
      return t("exportRoute.errors.missingLine", ROUTE_EXPORT_ERRORS.missingLine);
    }
    if (message === ROUTE_EXPORT_ERRORS.missingStation) {
      return t("exportRoute.errors.missingStation", ROUTE_EXPORT_ERRORS.missingStation);
    }
    if (message === ROUTE_EXPORT_ERRORS.notFound) {
      return t("exportRoute.errors.notFound", ROUTE_EXPORT_ERRORS.notFound);
    }
    if (message === NO_TRIP_SEGMENTS_ERROR) {
      return t("exportRoute.errors.noSegments", "This trip has no route segments to export.");
    }
    return t("exportRoute.errors.computeFailed", "Failed to compute route.");
  }, [t]);

  useEffect(() => {
    if (!isOpen) return;
    const lang = navigator.language?.toLowerCase() || "en";
    if (lang.startsWith("ja")) setLocale("ja");
    else if (lang.startsWith("zh-tw") || lang.startsWith("zh-hk")) setLocale("zh-tw");
    else if (lang.startsWith("zh")) setLocale("zh-cn");
    else setLocale("en");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !trip) return;
    if (trip.railGraph?.tripResult) {
      setRouteMode("manual");
      return;
    }
    const hasSegments = tripToProductRouteSegments(trip, railwayData).length > 0;
    setRouteMode(hasSegments ? "manual" : "auto");
  }, [isOpen, trip, railwayData]);

  useEffect(() => {
    if (!isOpen || !trip || !railwayData) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setRouteData(null);

    const compute = async () => {
      try {
        const productRouteData = tripToRouteSliceData(trip, railwayData);
        if (productRouteData) {
          if (!cancelled) setRouteData(productRouteData);
          return;
        }

        const segments = tripToProductRouteSegments(trip, railwayData);
        if (segments.length === 0) throw new Error(NO_TRIP_SEGMENTS_ERROR);
        const firstSegment = segments[0];
        const lastSegment = segments[segments.length - 1];
        const startLineKey = firstSegment.lineKey;
        const startStationId = firstSegment.fromId;
        const endLineKey = lastSegment.lineKey;
        const endStationId = lastSegment.toId;
        if (!startLineKey || !startStationId || !endLineKey || !endStationId) {
          throw new Error(NO_TRIP_SEGMENTS_ERROR);
        }

        const result =
          routeMode === "manual"
            ? await computeAndSerializeRoute({
                mode: "manual",
                segments: segments.map((seg: any) => ({
                  lineKey: seg.lineKey,
                  fromId: seg.fromId,
                  toId: seg.toId,
                  ...(seg.loopVia ? { loopVia: seg.loopVia } : {}),
                })),
                railwayData,
                geoData,
              })
            : await computeAndSerializeRoute({
                mode: "auto",
                startLineKey,
                startStationId,
                endLineKey,
                endStationId,
                railwayData,
                geoData,
              });

        if (!cancelled) setRouteData(result);
      } catch (e: any) {
        if (!cancelled) setError(routeErrorMessage(e.message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    compute();
    return () => { cancelled = true; };
  }, [isOpen, trip, railwayData, geoData, routeMode, routeErrorMessage]);

  const handleCopy = async () => {
    if (!routeData) return;
    const code = generateRouteMdx(routeData, { locale, height, theme, showPromo, packageSource });
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!routeData) return;
    const code = generateRouteMdx(routeData, { locale, height, theme, showPromo, packageSource });
    const blob = new Blob([code], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `route-preview-${routeData.meta?.lineName || "route"}.mdx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const generatedCode =
    routeData && generateRouteMdx(routeData, { locale, height, theme, showPromo, packageSource });

  const getDefaultLocaleLabel = () => {
    const lang = navigator.language?.toLowerCase() || "en";
    if (lang.startsWith("ja")) return "日本語";
    if (lang.startsWith("zh-tw") || lang.startsWith("zh-hk")) return "繁體中文";
    if (lang.startsWith("zh")) return "简体中文";
    return "English";
  };

  const renderSourceSummary = () => {
    if (!tripDetail) return null;
    if (tripDetail.kind === "rail_graph") {
      const firstSegment = tripDetail.segments[0];
      const keyEvents = tripDetailKeyEvents(tripDetail, 3);
      return (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                <RailGraphBadge
                  icon="snapshot"
                  value={t("exportRoute.railGraphSource", "Rail graph snapshot")}
                  tone="emerald"
                  className="rounded"
                />
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-800">
                {tripDetail.overview.title}
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-slate-500">
              <div>{t("exportRoute.km", "{{value}} km", { value: tripDetail.overview.totalDistanceKm.toFixed(1) })}</div>
              {tripDetail.overview.totalTimeMinutes !== undefined && (
                <div>{t("exportRoute.minutes", "{{count}} min", { count: tripDetail.overview.totalTimeMinutes })}</div>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
            <RailGraphRunBadges
              meta={{
                serviceType: firstSegment?.serviceType,
                direction: firstSegment?.direction,
                patternRef: firstSegment?.patternRef,
              }}
              patternClassName="max-w-[12rem]"
              showLabels
            />
            <RailGraphBadge icon="distance" value={t("exportRoute.geoSourceRailGraph", "Saved geometry")} tone="slate" className="rounded bg-white" />
            <RailGraphBadge
              icon="userEvent"
              value={t("exportRoute.userEvents", "{{count}} user events", { count: tripDetail.overview.userEventCount })}
              tone="violet"
              className="rounded bg-white"
            />
          </div>
          {keyEvents.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {keyEvents.map((event) => (
                <RailGraphEventPill key={event.id} type={event.type} label={event.label} title={event.label} />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <RailGraphBadge icon="legacy" value={t("exportRoute.legacySource", "Legacy GeoJSON route")} tone="slate" className="rounded" />
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {t("exportRoute.legacySourceDesc", "The preview is computed from current GeoJSON line data.")}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">
            {t("exportRoute.title", "Export Route Preview")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {renderSourceSummary()}

          {loading && (
            <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
              <Loader2 size={20} className="animate-spin" />
              {t("exportRoute.loading", "Computing route data...")}
            </div>
          )}
          {error && (
            <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-500 text-sm">
              {error}
            </div>
          )}

          {routeData && !loading && (
            <div>
              <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase mb-2">
                {t("exportRoute.preview", "Preview")}
              </label>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <RouteSlicePreview
                  data={routeData}
                  locale={locale}
                  height="300px"
                  theme={theme}
                  showPromo={showPromo}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase mb-2">
              {t("exportRoute.options", "Options")}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">
                  {t("exportRoute.pathMode", "Path Mode")}
                </label>
                {isRailGraphExport ? (
                  <div className="w-full rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                    {t("exportRoute.pathModeRailGraph", "Saved rail graph")}
                  </div>
                ) : (
                  <select
                    value={routeMode}
                    onChange={(e) => setRouteMode(e.target.value as "manual" | "auto")}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="manual">
                      {t("exportRoute.pathModeManual", "Manual (Exact Segments)")}
                    </option>
                    <option value="auto">
                      {t("exportRoute.pathModeAuto", "Auto Search")}
                    </option>
                  </select>
                )}
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t("exportRoute.language", "Language")}</label>
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as any)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">
                    {getDefaultLocaleLabel()} (auto)
                  </option>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l === "en"
                        ? "English"
                        : l === "ja"
                          ? "日本語"
                          : l === "zh-cn"
                            ? "简体中文"
                            : "繁體中文"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t("exportRoute.height", "Height")}</label>
                <select
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {HEIGHTS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t("exportRoute.theme", "Theme")}</label>
                <div className="flex gap-2 mt-2">
                  <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${theme === "light" ? "bg-white text-slate-700 border-slate-300 shadow-sm" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
                    <input
                      type="radio"
                      name="theme"
                      value="light"
                      checked={theme === "light"}
                      onChange={() => setTheme("light")}
                      className="sr-only"
                    />
                    <Sun size={13} /> {t("exportRoute.themeLight", "Light")}
                  </label>
                  <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${theme === "dark" ? "bg-slate-800 text-white border-slate-600 shadow-sm" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
                    <input
                      type="radio"
                      name="theme"
                      value="dark"
                      checked={theme === "dark"}
                      onChange={() => setTheme("dark")}
                      className="sr-only"
                    />
                    <Moon size={13} /> {t("exportRoute.themeDark", "Dark")}
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t("exportRoute.package", "Package")}</label>
                <select
                  value={packageSource}
                  onChange={(e) => setPackageSource(e.target.value as any)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="npm">{t("exportRoute.packageNpm", "npm (@railloop)")}</option>
                  <option value="cdn">{t("exportRoute.packageCdn", "CDN")}</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t("exportRoute.promo", "Promo")}</label>
                <label className="flex items-center gap-2 text-xs text-slate-600 mt-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPromo}
                    onChange={(e) => setShowPromo(e.target.checked)}
                    className="rounded"
                  />
                  {t("exportRoute.promoShow", "Show promo banner")}
                </label>
              </div>
            </div>
          </div>

          {generatedCode && (
            <div>
              <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase mb-2">
                {t("exportRoute.code", "Generated Code")}
              </label>
              <pre className="bg-slate-900 text-slate-100 text-[11px] leading-relaxed p-4 rounded-xl overflow-x-auto max-h-64">
                <code>{generatedCode}</code>
              </pre>
            </div>
          )}
        </div>

        {routeData && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 shrink-0">
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <Download size={14} />
              {t("exportRoute.download", "Download .mdx")}
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <CheckCircle2 size={14} /> {t("exportRoute.copied", "Copied!")}
                </>
              ) : (
                <>
                  <Copy size={14} /> {t("exportRoute.copy", "Copy Code")}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
