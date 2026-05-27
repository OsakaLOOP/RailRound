import React from "react";
import { Clock, MapPinned, Route, Tag, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BoundMileageEvent } from "../../rail-graph-v1/mileage-event.types";
import type { AppMileageLineContext } from "../../utils/mileageUserEvents";
import { formatKm } from "../../utils/mileageUserEvents";
import {
  eventKindLabel,
  eventKindTone,
  eventLineLabel,
  eventMileageLabel,
  eventStationLabel,
  eventVisibilityLabel,
  timestampLabel,
} from "./display";

export interface MileageEventListEntry {
  bound: BoundMileageEvent;
  lineContext?: AppMileageLineContext | null;
}

interface Props {
  entries: MileageEventListEntry[];
  selectedId?: string | null;
  selectedIds?: Set<string>;
  emptyLabel?: string;
  showLine?: boolean;
  compact?: boolean;
  selectable?: boolean;
  onSelect?: (entry: MileageEventListEntry) => void;
  onToggleSelect?: (entry: MileageEventListEntry) => void;
  onViewMap?: (entry: MileageEventListEntry) => void;
  onDelete?: (id: string) => void;
}

export const EventList: React.FC<Props> = ({
  entries,
  selectedId,
  selectedIds,
  emptyLabel,
  showLine = true,
  compact = false,
  selectable = false,
  onSelect,
  onToggleSelect,
  onViewMap,
  onDelete,
}) => {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
        {emptyLabel ?? t("mileageEvents.empty", "No matching mileage events")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const event = entry.bound.event;
        const selected = selectedId === event.id;
        const checked = selectedIds?.has(event.id) ?? false;
        const stationLabel = eventStationLabel(entry.bound, entry.lineContext);
        const line = eventLineLabel(entry.bound, entry.lineContext);
        return (
          <article
            key={`${event.id}:${entry.bound.distanceMetersFromRunStart}`}
            className={`group rounded-lg border p-2 transition ${
              selected
                ? "border-emerald-300 bg-emerald-50/80 shadow-sm shadow-emerald-900/5"
                : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
            }`}
          >
            <div className="flex items-start gap-2">
              {selectable && (
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  checked={checked}
                  onChange={(changeEvent) => {
                    changeEvent.stopPropagation();
                    onToggleSelect?.(entry);
                  }}
                  onClick={(clickEvent) => clickEvent.stopPropagation()}
                  aria-label={t("mileageEvents.bulk.selectEvent", "Select event")}
                />
              )}
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  onSelect?.(entry);
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${eventKindTone(event.kind)}`}
                    >
                      {eventKindLabel(event.kind, t)}
                    </span>
                    <div className="truncate text-sm font-semibold text-slate-800">
                      {event.title}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <MapPinned size={12} />
                      {eventMileageLabel(entry.bound) || formatKm(entry.bound.distanceMetersFromRunStart)}
                    </span>
                    {stationLabel && <span>{stationLabel}</span>}
                    {showLine && line && (
                      <span className="inline-flex items-center gap-1">
                        <Route size={12} />
                        {line}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      {timestampLabel(entry.bound.timestampInference, entry.bound.timestamp, t)}
                    </span>
                    {!compact && (
                      <span>{eventVisibilityLabel(event.visibility, t)}</span>
                    )}
                  </div>
                </div>
                {!compact && event.body && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{event.body}</p>
                )}
                {!compact && event.tags?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {event.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                      >
                        <Tag size={10} />
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
              {onViewMap || onDelete ? (
                <div className="flex shrink-0 items-center gap-1 opacity-100 md:opacity-70 md:transition md:group-hover:opacity-100">
                  {onViewMap && (
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onViewMap(entry);
                      }}
                      title={t("mileageEvents.action.viewMap", "View map")}
                    >
                      <MapPinned size={15} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onDelete(event.id);
                      }}
                      title={t("mileageEvents.action.delete", "Delete")}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
};
