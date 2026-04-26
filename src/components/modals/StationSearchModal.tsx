import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Map as MapIcon,
  Building2,
  Train,
  Search,
  MapPin,
  ListFilter,
  TrainTrack,
} from "lucide-react";
import { useStore } from "../../store";
import {
  buildLineSelectorGroups,
  CategoryKey,
} from "../../utils/lineSelectorBuilder";
import { useTranslation } from "react-i18next";
import { LineLogo } from "../LineLogo";

export type SearchModalMode = "line" | "search";

interface Props {
  isOpen: boolean;
  initialMode: SearchModalMode;
  onClose: () => void;
  onSelect: (lineKey: string, stationId?: string) => void;
  allowedLines: string[] | null;
}

export const StationLineSearchModal: React.FC<Props> = ({
  isOpen,
  initialMode,
  onClose,
  onSelect,
  allowedLines,
}) => {
  const { railwayData, badgeSettings } = useStore();
  const { t } = useTranslation();

  const [mode, setMode] = useState<SearchModalMode>(initialMode);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
    }
  }, [isOpen, initialMode]);

  // ==== Line Selector State ====
  const [activeTab, setActiveTab] = useState<CategoryKey>("JR");
  const [selectedRegion, setSelectedRegion] = useState("all");

  const priorityRegion = useMemo(() => {
    const lng = badgeSettings.defaultMapCenter?.lng ?? 139;
    return lng < 126 ? "中国大陆" : undefined;
  }, [badgeSettings.defaultMapCenter]);

  const groupsData = useMemo(
    () => buildLineSelectorGroups(railwayData, allowedLines, priorityRegion),
    [railwayData, allowedLines, priorityRegion],
  );

  const tabStats = useMemo(() => {
    const stats: Record<
      string,
      Record<string, { companies: number; lines: number }>
    > = {};
    Object.entries(groupsData).forEach(([tab, regions]) => {
      const countrySets: Record<
        string,
        { companies: Set<string>; lines: Set<string> }
      > = {};
      regions.forEach((r) => {
        const country = r.name === "中国大陆" ? "CN" : "JP";
        if (!countrySets[country])
          countrySets[country] = { companies: new Set(), lines: new Set() };
        r.companies.forEach((c) => {
          countrySets[country].companies.add(c.name);
          c.lines.forEach((l) => countrySets[country].lines.add(l.key));
        });
      });
      stats[tab] = {};
      Object.entries(countrySets).forEach(([country, s]) => {
        stats[tab][country] = {
          companies: s.companies.size,
          lines: s.lines.size,
        };
      });
    });
    return stats;
  }, [groupsData]);

  const activeRegions = groupsData[activeTab] || [];
  const regionNames = ["all", ...activeRegions.map((r) => r.name)];
  useEffect(() => {
    if (!regionNames.includes(selectedRegion)) setSelectedRegion("all");
  }, [activeTab, regionNames, selectedRegion]);
  const filteredRegions = activeRegions.filter(
    (r) => selectedRegion === "all" || r.name === selectedRegion,
  );

  // ==== Global Search State ====
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isOpen && mode === "search") {
      setQuery("");
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mode]);

  const results = useMemo(() => {
    if (!query.trim()) return { lines: [], stations: [] };
    const lowerQuery = query.toLowerCase();
    const matchedLines: any[] = [];
    const matchedStations: any[] = [];
    Object.entries(railwayData).forEach(([lineKey, lineData]) => {
      const displayName = lineKey.includes(":")
        ? lineKey.split(":").slice(1).join(":")
        : lineKey;
      if (
        lineKey.toLowerCase().includes(lowerQuery) ||
        displayName.toLowerCase().includes(lowerQuery)
      ) {
        matchedLines.push({
          lineKey,
          displayName,
          company: lineData.meta.company || "",
          logo: lineData.meta.logo || null,
          icon: lineData.meta.icon || null,
          companyIcon: lineData.meta.companyIcon || null,
          recolor: lineData.meta.recolor,
          color: lineData.meta.color,
        });
      }
      lineData.stations.forEach((station) => {
        if (station.name_ja.toLowerCase().includes(lowerQuery)) {
          matchedStations.push({
            lineKey,
            lineDisplayName: displayName,
            stationId: station.id,
            stationName: station.name_ja,
            company: lineData.meta.company || "",
            logo: lineData.meta.logo || null,
            icon: lineData.meta.icon || null,
            companyIcon: lineData.meta.companyIcon || null,
            recolor: lineData.meta.recolor,
            color: lineData.meta.color,
          });
        }
      });
    });
    return {
      lines: matchedLines.slice(0, 50),
      stations: matchedStations.slice(0, 100),
    };
  }, [query, railwayData]);

  // ==== Global Keyboard ESC ====
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[700] flex flex-col items-center justify-end md:justify-center p-0 md:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      {/* Unified Container */}
      <div
        className={`relative bg-white w-full rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-bottom md:origin-center animate-slide-up
                ${mode === "line" ? "max-w-3xl h-[85vh]" : "max-w-2xl h-[75vh]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative w-full h-full flex flex-col">
          {/* ===== LINE SELECTOR LAYER ===== */}
          <div
            className={`absolute inset-0 flex flex-col bg-white transition-opacity duration-300 ${mode === "line" ? "opacity-100 pointer-events-auto z-10" : "opacity-0 pointer-events-none z-0"}`}
          >
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800">
                <MapIcon size={20} /> {t("lineSel.title", "选择线路")}
              </h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMode("search")}
                  className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-blue-600 bg-white border border-gray-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg shadow-sm transition-all"
                  title={t("search.placeholder", "搜索线路或车站...")}
                >
                  <Search size={14} />
                  <span className="hidden sm:inline">
                    {t("common.search", "搜索")}
                  </span>
                </button>
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <X className="text-gray-400 hover:text-gray-600" />
                </button>
              </div>
            </div>

            <div className="flex border-b bg-white shrink-0">
              {(["JR", "Private", "City"] as CategoryKey[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 flex flex-col items-center justify-center py-2 transition-all border-b-2 gap-0.5 ${activeTab === tab ? "border-blue-600 text-blue-600 bg-blue-50" : "border-transparent text-gray-500 hover:bg-gray-50"}`}
                >
                  <span className="text-sm font-bold leading-tight">
                    {tab === "JR"
                      ? t("lineSel.jr", "JR 集団")
                      : tab === "Private"
                        ? t("lineSel.private", "私鉄・第三セクター")
                        : t("lineSel.subway", "地下鉄・新交通")}
                  </span>
                  <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 opacity-90 scale-90 mt-0.5">
                    {Object.entries(tabStats[tab] || {})
                      .sort(([a], [b]) => {
                        const priority =
                          priorityRegion === "中国大陆" ? "CN" : "JP";
                        if (a === priority) return -1;
                        if (b === priority) return 1;
                        return 0;
                      })
                      .map(([country, stats]) => (
                        <div key={country} className="flex items-center gap-1">
                          <span
                            className={`fi fi-${country.toLowerCase()} shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
                          ></span>
                          <div className="flex items-center gap-0.5 text-gray-400 text-[9px] font-normal">
                            <Building2 size={9} /> {stats.companies}
                            <TrainTrack size={9} /> {stats.lines}
                          </div>
                        </div>
                      ))}
                  </div>
                </button>
              ))}
            </div>

            <div className="p-2 border-b bg-white overflow-x-auto flex gap-2 shrink-0 no-scrollbar">
              {regionNames.length > 1 ? (
                regionNames.map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRegion(r)}
                    className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${selectedRegion === r ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  >
                    {r === "all"
                      ? t("lineSel.allRegions", "全部地域")
                      : t("regions." + r, r) || r}
                  </button>
                ))
              ) : (
                <span className="text-xs text-gray-400 px-2 py-1">
                  {t("lineSel.noRegion", "无地域分类")}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50">
              {filteredRegions.length === 0 ? (
                <div className="text-center text-gray-400 py-10">
                  {t("lineSel.noResult", "无符合条件的线路")}
                </div>
              ) : (
                filteredRegions.map((region) => (
                  <div key={region.name} className="relative">
                    <div className="sticky top-0 z-10 bg-gray-100/95 backdrop-blur border-y border-gray-200 px-4 py-1.5">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {t("regions." + region.name, region.name) ||
                          region.name}
                      </h4>
                    </div>
                    <div className="p-4 grid gap-4">
                      {region.companies.map((company) => (
                        <div
                          key={company.name}
                          className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm"
                        >
                          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                            {company.logo ? (
                              <img
                                src={company.logo}
                                alt=""
                                className="company-logo-sm h-5 w-auto"
                                draggable={false}
                              />
                            ) : (
                              <Building2 size={16} className="text-gray-400" />
                            )}
                            <span className="font-bold text-sm text-gray-700">
                              {company.name}
                            </span>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {company.lines.map((line) => (
                              <button
                                key={line.key}
                                onClick={() => onSelect(line.key)}
                                className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                              >
                                {line.icon ? (
                                  <LineLogo
                                    src={line.icon!}
                                    companyIcon={line.companyIcon}
                                    recolor={line.recolor}
                                    color={line.color}
                                    className="line-icon"
                                  />
                                ) : company.logo ? (
                                  <img
                                    src={company.logo}
                                    alt=""
                                    className="line-icon opacity-50 grayscale"
                                    draggable={false}
                                  />
                                ) : (
                                  <Train
                                    size={14}
                                    className="text-gray-300 group-hover:text-blue-400"
                                  />
                                )}
                                {line.displayName}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ===== GLOBAL SEARCH LAYER ===== */}
          <div
            className={`absolute inset-0 flex flex-col bg-white transition-opacity duration-300 ${mode === "search" ? "opacity-100 pointer-events-auto z-10" : "opacity-0 pointer-events-none z-0"}`}
          >
            <div className="p-4 border-b bg-white flex items-center gap-3 shrink-0 sticky top-0 z-20 shadow-sm">
              <Search className="text-gray-400" size={20} />
              <input
                ref={inputRef}
                type="text"
                placeholder={t("search.placeholder", "搜索线路或车站...")}
                className="flex-1 bg-transparent border-none outline-none text-lg text-gray-800 placeholder:text-gray-400 min-w-0"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="p-1 hover:bg-gray-100 rounded-full text-gray-400 transition"
                >
                  <X size={16} />
                </button>
              )}
              <button
                onClick={() => setMode("line")}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-blue-600 bg-gray-50 border border-gray-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg shadow-sm transition-all whitespace-nowrap"
                title={t("lineSel.title", "选择线路")}
              >
                <ListFilter size={14} />
                <span className="hidden sm:inline">
                  {t("lineSel.title", "选择线路")}
                </span>
              </button>
              <button
                onClick={onClose}
                className="p-2 ml-1 hover:bg-gray-100 rounded-full text-gray-500 transition shrink-0"
                title={t("common.close", "关闭")}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50">
              {!query.trim() ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                  <Search size={48} className="text-gray-200" />
                  <p>{t("search.instruction", "输入线路名或车站名进行搜索")}</p>
                </div>
              ) : results.lines.length === 0 &&
                results.stations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                  <p>{t("search.noResult", "没有找到相关结果")}</p>
                </div>
              ) : (
                <div className="p-4 space-y-6">
                  {results.lines.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                        <Train size={14} /> {t("search.lines", "线路")} (
                        {results.lines.length})
                      </h4>
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                        {results.lines.map((line, idx) => (
                          <button
                            key={`line-${idx}`}
                            onClick={() => onSelect(line.lineKey)}
                            className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                          >
                            {line.icon ? (
                              <LineLogo
                                src={line.icon!}
                                companyIcon={line.companyIcon}
                                recolor={line.recolor}
                                color={line.color}
                                className="line-icon w-5 h-5 object-contain"
                              />
                            ) : line.logo ? (
                              <img
                                src={line.logo}
                                alt=""
                                className="line-icon w-5 h-5 object-contain opacity-70 grayscale"
                              />
                            ) : (
                              <MapIcon
                                size={16}
                                className="text-gray-300 group-hover:text-blue-400"
                              />
                            )}
                            <div className="flex-1">
                              <div className="font-bold text-gray-800">
                                {line.displayName}
                              </div>
                              <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                                {line.company && (
                                  <>
                                    <Building2 size={10} /> {line.company}
                                  </>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {results.stations.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                        <MapPin size={14} /> {t("search.stations", "车站")} (
                        {results.stations.length})
                      </h4>
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                        {results.stations.map((station, idx) => (
                          <button
                            key={`station-${idx}`}
                            onClick={() =>
                              onSelect(station.lineKey, station.stationId)
                            }
                            className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                          >
                            <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                              <MapPin size={12} className="text-emerald-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-800 text-base">
                                {station.stationName}
                              </div>
                              <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5 truncate">
                                {station.icon ? (
                                  <LineLogo
                                    src={station.icon!}
                                    companyIcon={station.companyIcon}
                                    recolor={station.recolor}
                                    color={station.color}
                                    className="w-3 h-3 object-contain inline-block"
                                  />
                                ) : station.logo ? (
                                  <img
                                    src={station.logo}
                                    alt=""
                                    className="w-3 h-3 object-contain inline-block grayscale opacity-60"
                                  />
                                ) : (
                                  <Train size={10} />
                                )}
                                <span className="truncate">
                                  {station.lineDisplayName}
                                </span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
