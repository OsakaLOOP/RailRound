import React from "react";
import { Clock, MapPinned, Route, Tag, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BoundMileageEvent } from "../../rail-graph-v1/mileage-event.types";
import type { MileageLineContextLike } from "../../utils/mileageUserEvents";
import { formatKm } from "../../utils/mileageUserEvents";
import {
  eventKindLabel,
  eventLineLabel,
  eventMileageLabel,
  eventSourceLabel,
  eventStationLabel,
  eventVisibilityLabel,
  timestampLabel,
} from "./display";
import { RailGraphBadge, RailGraphEventPill } from "../rail-graph/RailGraphBadges";

export interface MileageEventListEntry {
  bound: BoundMileageEvent;
  lineContext?: MileageLineContextLike | null;
}

interface Props {
  entries: MileageEventListEntry[];
  selectedId?: string | null;
  emptyLabel?: string;
  showLine?: boolean;
  compact?: boolean;
  onSelect?: (entry: MileageEventListEntry) => void;
  onViewMap?: (entry: MileageEventListEntry) => void;
  onDelete?: (id: string) => void;
}

export const EventList: React.FC<Props> = ({
  entries,
  selectedId,
  emptyLabel,
  showLine = true,
  compact = false,
  onSelect,
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
        const stationLabel = eventStationLabel(entry.bound, entry.lineContext);
        const line = eventLineLabel(entry.bound, entry.lineContext);
        const sourceLabel = eventSourceLabel(entry.lineContext, t);
        const sourceIsRailGraph = entry.lineContext?.source === "rail_graph_runtime";
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
                    <RailGraphEventPill type={event.kind} label={eventKindLabel(event.kind, t)} className="max-w-[8rem]" />
                    <div className="truncate text-sm font-semibold text-slate-800">
                      {event.title}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    <RailGraphBadge
                      icon="distance"
                      value={eventMileageLabel(entry.bound) || formatKm(entry.bound.distanceMetersFromRunStart)}
                      tone="slate"
                      className="rounded bg-white"
                    />
                    {stationLabel && <span>{stationLabel}</span>}
                    {showLine && line && (
                      <span className="inline-flex items-center gap-1">
                        <Route size={12} />
                        {line}
                      </span>
                    )}
                    <RailGraphBadge
                      icon={sourceIsRailGraph ? "snapshot" : "legacy"}
                      value={sourceLabel}
                      tone={sourceIsRailGraph ? "emerald" : "slate"}
                      className="rounded bg-white"
                    />
                    {!compact && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} />
                        {timestampLabel(entry.bound.timestampInference, entry.bound.timestamp, t)}
                      </span>
                    )}
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
