import React, { useMemo, useState } from "react";
import { Combine, Filter, Search, Tag, Tags } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import type { MileageUserEventVisibility, UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import {
  boundMileageEventsForDisplay,
  findLineKeyForMileageEvent,
  lineLabel,
  normalizeTags,
  searchMileageEvents,
  tagsFromInput,
  updateMileageEventFromDraft,
} from "../../utils/mileageUserEvents";
import { EventList, MileageEventListEntry } from "./EventList";
import { eventKindLabel, eventVisibilityLabel, mileageEventKinds, mileageEventVisibilities } from "./display";
import { useMileageEventActions } from "./useMileageEventActions";

interface Props {
  events?: readonly UserEventV2[];
  compact?: boolean;
  selectedId?: string | null;
  onSelect?: (entry: MileageEventListEntry) => void;
  onViewMap?: (entry: MileageEventListEntry) => void;
}

export const EventSearchPanel: React.FC<Props> = ({
  events,
  compact = false,
  selectedId,
  onSelect,
  onViewMap,
}) => {
  const { t } = useTranslation();
  const { railwayData, mileageUserEvents } = useStore(
    useShallow((state) => ({
      railwayData: state.railwayData,
      mileageUserEvents: state.mileageUserEvents,
    }))
  );
  const { persistEvents } = useMileageEventActions();
  const sourceEvents = events ?? mileageUserEvents;
  const lineKeys = useMemo(() => Object.keys(railwayData).sort(), [railwayData]);
  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [bulkTags, setBulkTags] = useState("");
  const [bulkVisibility, setBulkVisibility] = useState<MileageUserEventVisibility>("private");
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState("all");
  const [visibility, setVisibility] = useState("all");
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
    () => boundMileageEventsForDisplay(matchedEvents, railwayData),
    [matchedEvents, railwayData],
  );
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedEventIds.has(entry.bound.event.id)),
    [entries, selectedEventIds],
  );
  const allVisibleSelected = entries.length > 0 && entries.every((entry) => selectedEventIds.has(entry.bound.event.id));

  const toggleSelected = (entry: MileageEventListEntry) => {
    setSelectedEventIds((current) => {
      const next = new Set(current);
      if (next.has(entry.bound.event.id)) next.delete(entry.bound.event.id);
      else next.add(entry.bound.event.id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedEventIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        entries.forEach((entry) => next.delete(entry.bound.event.id));
      } else {
        entries.forEach((entry) => next.add(entry.bound.event.id));
      }
      return next;
    });
  };

  const applyBulkTags = () => {
    const tagsToAdd = tagsFromInput(bulkTags);
    if (!tagsToAdd?.length || selectedEventIds.size === 0) return;
    const next = mileageUserEvents.map((event) => {
      if (!selectedEventIds.has(event.id)) return event;
      return updateMileageEventFromDraft(event, {
        tags: normalizeTags([...(event.tags ?? []), ...tagsToAdd]),
      });
    });
    persistEvents(next);
    setBulkTags("");
  };

  const applyBulkVisibility = () => {
    if (selectedEventIds.size === 0) return;
    persistEvents(
      mileageUserEvents.map((event) =>
        selectedEventIds.has(event.id)
          ? updateMileageEventFromDraft(event, { visibility: bulkVisibility })
          : event,
      ),
    );
  };

  const mergeSelectedDuplicates = () => {
    if (selectedEntries.length < 2) return;
    const groups = new Map<string, UserEventV2[]>();
    selectedEntries.forEach((entry) => {
      const event = entry.bound.event;
      const key = [
        event.mileage.systemRef,
        event.mileage.lineRef ?? "",
        findLineKeyForMileageEvent(event) ?? "",
        Math.round(event.mileage.distanceMeters / 10),
      ].join("|");
      groups.set(key, [...(groups.get(key) ?? []), event]);
    });

    const replacements = new Map<string, UserEventV2>();
    const removed = new Set<string>();
    groups.forEach((group) => {
      if (group.length < 2) return;
      const [base, ...duplicates] = group.sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
      const mergedBody = [base.body, ...duplicates.map((event) => event.body)].filter(Boolean).join("\n\n");
      const mergedTags = normalizeTags(group.flatMap((event) => event.tags ?? []));
      const mergedPayload = group.reduce<Record<string, unknown>>(
        (payload, event) => ({ ...payload, ...(event.payload ?? {}) }),
        {},
      );
      replacements.set(base.id, {
        ...base,
        body: mergedBody || undefined,
        tags: mergedTags,
        payload: mergedPayload,
        updatedAt: new Date().toISOString(),
      });
      duplicates.forEach((event) => removed.add(event.id));
    });

    if (replacements.size === 0) return;
    persistEvents(
      mileageUserEvents
        .filter((event) => !removed.has(event.id))
        .map((event) => replacements.get(event.id) ?? event),
    );
    setSelectedEventIds((current) => {
      const next = new Set(current);
      removed.forEach((id) => next.delete(id));
      return next;
    });
  };

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
        <button
          type="button"
          className={`rounded-md border px-2 py-2 text-slate-500 hover:bg-slate-50 ${
            bulkOpen ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200"
          }`}
          onClick={() => setBulkOpen((value) => !value)}
          title={t("mileageEvents.bulk.title", "Batch actions")}
        >
          <Tags size={15} />
        </button>
      </div>

      {advancedOpen && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="grid grid-cols-2 gap-2">
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
          <div className="grid grid-cols-2 gap-2">
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

      {bulkOpen && (
        <div className="space-y-2 rounded-md border border-emerald-100 bg-emerald-50/40 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              onClick={toggleAllVisible}
              disabled={entries.length === 0}
            >
              {allVisibleSelected
                ? t("mileageEvents.bulk.clearVisible", "Clear visible")
                : t("mileageEvents.bulk.selectVisible", "Select visible")}
            </button>
            <span className="text-xs font-semibold text-emerald-700">
              {t("mileageEvents.bulk.selectedCount", "{{count}} selected", { count: selectedEventIds.size })}
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm"
              value={bulkTags}
              onChange={(event) => setBulkTags(event.target.value)}
              placeholder={t("mileageEvents.bulk.tagsPlaceholder", "Add tags to selected")}
            />
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
              onClick={applyBulkTags}
              disabled={selectedEventIds.size === 0 || !bulkTags.trim()}
            >
              <Tag size={13} />
              {t("mileageEvents.bulk.addTags", "Add tags")}
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <select
              className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm"
              value={bulkVisibility}
              onChange={(event) => setBulkVisibility(event.target.value as MileageUserEventVisibility)}
            >
              {mileageEventVisibilities.map((item) => (
                <option key={item} value={item}>
                  {eventVisibilityLabel(item, t)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:text-slate-300"
              onClick={applyBulkVisibility}
              disabled={selectedEventIds.size === 0}
            >
              {t("mileageEvents.bulk.applyVisibility", "Apply visibility")}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:text-slate-300"
              onClick={mergeSelectedDuplicates}
              disabled={selectedEntries.length < 2}
            >
              <Combine size={13} />
              {t("mileageEvents.bulk.mergeDuplicates", "Merge duplicates")}
            </button>
          </div>
        </div>
      )}

      <EventList
        entries={entries}
        selectedId={selectedId}
        selectedIds={selectedEventIds}
        compact={compact}
        selectable={bulkOpen}
        onSelect={onSelect}
        onToggleSelect={toggleSelected}
        onViewMap={onViewMap}
      />
    </div>
  );
};
