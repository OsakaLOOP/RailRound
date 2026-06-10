import React, { useMemo, useState } from "react";
import { Filter, Search, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import {
  boundMileageEventsForRichDisplay,
  findLineKeyForMileageEvent,
  lineLabel,
  searchMileageEvents,
  tagsFromInput,
} from "../../utils/mileageUserEvents";
import { EventList, MileageEventListEntry } from "./EventList";
import { eventKindLabel, eventVisibilityLabel, mileageEventKinds, mileageEventVisibilities } from "./display";

interface Props {
  events?: readonly UserEventV2[];
  compact?: boolean;
  showSource?: boolean;
  showTimestamp?: boolean;
  showVisibility?: boolean;
  showRunContext?: boolean;
  selectedId?: string | null;
  onSelect?: (entry: MileageEventListEntry) => void;
  onViewMap?: (entry: MileageEventListEntry) => void;
}

export const EventSearchPanel: React.FC<Props> = ({
  events,
  compact = false,
  showSource,
  showTimestamp,
  showVisibility,
  showRunContext,
  selectedId,
  onSelect,
  onViewMap,
}) => {
  const { t } = useTranslation();
  const { railwayData, mileageUserEvents, trips } = useStore(
    useShallow((state) => ({
      railwayData: state.railwayData,
      mileageUserEvents: state.mileageUserEvents,
      trips: state.trips,
    }))
  );
  const sourceEvents = events ?? mileageUserEvents;
  const lineKeys = useMemo(() => {
    const keys = new Set(Object.keys(railwayData));
    sourceEvents.forEach((event) => {
      const key = findLineKeyForMileageEvent(event);
      if (key) keys.add(key);
    });
    return Array.from(keys).sort();
  }, [railwayData, sourceEvents]);
  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "rail_graph" | "legacy">("all");
  const [lineKey, setLineKey] = useState("");
  const [fromKm, setFromKm] = useState("");
  const [toKm, setToKm] = useState("");

  const matchedEvents = useMemo(
    () =>
      searchMileageEvents(sourceEvents, railwayData, {
        query,
        tags: tagsFromInput(tags),
        kind: kind as any,
        visibility: visibility as any,
        lineKey: lineKey || undefined,
        fromKm: fromKm.trim() ? Number(fromKm) : null,
        toKm: toKm.trim() ? Number(toKm) : null,
      }),
    [fromKm, kind, lineKey, query, railwayData, sourceEvents, tags, toKm, visibility],
  );

  const entries = useMemo(
    () =>
      boundMileageEventsForRichDisplay(matchedEvents, railwayData, trips).filter((entry) => {
        if (sourceFilter === "all") return true;
        if (sourceFilter === "rail_graph") return entry.lineContext.source === "rail_graph_runtime";
        return entry.lineContext.source !== "rail_graph_runtime";
      }),
    [matchedEvents, railwayData, sourceFilter, trips],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1.5">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("mileageEvents.searchPlaceholder", "Search events, trips, lines, stations, tags")}
          />
        </div>
        <button
          type="button"
          className={`rounded-md border px-2 py-2 text-slate-500 hover:bg-slate-50 ${
            advancedOpen ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200"
          }`}
          onClick={() => setAdvancedOpen((value) => !value)}
          title={t("mileageEvents.advancedFilters", "Advanced filters")}
        >
          <Filter size={15} />
        </button>
      </div>

      {advancedOpen && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.type", "Type")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="all">{t("mileageEvents.filter.allTypes", "All types")}</option>
                {mileageEventKinds.map((item) => (
                  <option key={item} value={item}>
                    {eventKindLabel(item, t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.visibilityLabel", "Visibility")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
              >
                <option value="all">{t("mileageEvents.filter.allVisibility", "All visibility")}</option>
                {mileageEventVisibilities.map((item) => (
                  <option key={item} value={item}>
                    {eventVisibilityLabel(item, t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.filter.source", "Source")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}
            >
              <option value="all">{t("mileageEvents.filter.allSources", "All sources")}</option>
              <option value="rail_graph">{t("mileageEvents.sourceRailGraph", "Rail graph snapshot")}</option>
              <option value="legacy">{t("mileageEvents.sourceLegacy", "GeoJSON axis")}</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.line", "Line")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={lineKey}
              onChange={(event) => setLineKey(event.target.value)}
            >
              <option value="">{t("mileageEvents.filter.allLines", "All lines")}</option>
              {lineKeys.map((key) => (
                <option key={key} value={key}>
                  {lineLabel(key)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.fromKm", "From km")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={fromKm}
                inputMode="decimal"
                onChange={(event) => setFromKm(event.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.toKm", "To km")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={toKm}
                inputMode="decimal"
                onChange={(event) => setToKm(event.target.value)}
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Tag size={12} />
              {t("mileageEvents.tags", "Tags")}
            </span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder={t("mileageEvents.tagsPlaceholder", "Tags, separated by comma")}
            />
          </label>
        </div>
      )}

      <div className="text-[11px] font-medium text-slate-400">
        {t("mileageEvents.searchCount", "{{count}} events", { count: entries.length })}
      </div>

      <EventList
        entries={entries}
        selectedId={selectedId}
        compact={compact}
        showSource={showSource}
        showTimestamp={showTimestamp}
        showVisibility={showVisibility}
        showRunContext={showRunContext}
        onSelect={onSelect}
        onViewMap={onViewMap}
      />
    </div>
  );
};
