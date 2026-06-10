import React, { useMemo } from "react";
import { ChevronDown, ChevronUp, MapPinned, Route, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MileageEventListEntry } from "../mileage-events/EventList";
import { eventKindLabel, eventLineLabel, eventStationLabel } from "../mileage-events/display";
import {
  RailGraphBadge,
  RailGraphEventPill,
  RailGraphRunBadges,
  compactRailGraphRef,
} from "../rail-graph/RailGraphBadges";
import type { TripDetailEvent, TripDetailEventType, TripDetailModel } from "../../utils/railGraphTripDetailModel";
import { formatKm } from "../../utils/mileageUserEvents";

type TranslateFn = (key: string, fallback: string, options?: Record<string, unknown>) => string;

interface TripEventCenterProps {
  detail: TripDetailModel;
  entries: MileageEventListEntry[];
  allEntryCount: number;
  isExpanded: boolean;
  selectedEventId?: string | null;
  filtered: boolean;
  onToggle: () => void;
  onOpenMapView: () => void;
  onFocusEvent: (entry: MileageEventListEntry) => void;
}

export const TripEventCenter: React.FC<TripEventCenterProps> = ({
  detail,
  entries,
  allEntryCount,
  isExpanded,
  selectedEventId,
  filtered,
  onToggle,
  onOpenMapView,
  onFocusEvent,
}) => {
  const { t } = useTranslation();
  const entryByEventId = useMemo(
    () => new Map(entries.map((entry) => [String(entry.bound.event.id), entry])),
    [entries],
  );
  const replayEvents = useMemo(
    () =>
      detail.events
        .filter((event) => event.importance === "key")
        .sort((left, right) => {
          const leftMeters = left.distanceMeters ?? Number.MAX_SAFE_INTEGER;
          const rightMeters = right.distanceMeters ?? Number.MAX_SAFE_INTEGER;
          return leftMeters - rightMeters || left.id.localeCompare(right.id);
        }),
    [detail.events],
  );
  const source = sourceBadge(detail, t);
  const shownCount = filtered ? entries.length : allEntryCount;

  return (
    <div className="mt-3 border-t border-gray-100 pt-3" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-md bg-slate-50 px-2 py-2 text-left hover:bg-slate-100"
        onClick={onToggle}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-700">
            <MapPinned size={14} className="shrink-0 text-emerald-600" />
            <span>{t("tripsPage.eventCenter.summary", "{{count}} events", { count: allEntryCount })}</span>
            <RailGraphBadge
              icon={source.icon}
              value={source.value}
              tone={source.tone}
              className="rounded bg-white"
            />
            {filtered && allEntryCount !== shownCount && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                {t("tripsPage.eventCenter.filteredCount", "{{count}} shown", { count: shownCount })}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {entries.slice(0, 3).map((entry) => (
              <span
                key={String(entry.bound.event.id)}
                className="inline-flex max-w-[14rem] items-center gap-1 rounded bg-white px-1 py-0.5"
              >
                <RailGraphBadge icon="distance" value={formatKm(entry.bound.distanceMetersFromRunStart)} tone="slate" className="rounded" />
                <RailGraphEventPill
                  type={entry.bound.event.kind}
                  label={entry.bound.event.title}
                  title={entry.bound.event.title}
                  className="max-w-[9rem]"
                />
              </span>
            ))}
            {entries.length === 0 && (
              <span className="text-[11px] text-slate-400">
                {t("tripsPage.eventCenter.noEvents", "No mileage events")}
              </span>
            )}
          </div>
        </div>
        {isExpanded ? <ChevronUp size={16} className="shrink-0 text-slate-400" /> : <ChevronDown size={16} className="shrink-0 text-slate-400" />}
      </button>

      {isExpanded && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <RailGraphBadge
                icon={source.icon}
                value={source.value}
                tone={source.tone}
                className="rounded bg-white"
              />
              <RailGraphBadge
                icon="userEvent"
                value={t("tripsPage.railGraph.userEvents", "{{count}} user events", { count: allEntryCount })}
                tone="violet"
                className="rounded bg-white"
              />
              <RailGraphBadge
                icon="operation"
                value={t("tripsPage.eventCenter.systemEvents", "{{count}} system events", { count: detail.overview.systemEventCount })}
                tone="slate"
                className="rounded bg-white"
              />
            </div>
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              onClick={onOpenMapView}
              title={t("tripsPage.eventCenter.openMapView", "Open in MapView")}
              aria-label={t("tripsPage.eventCenter.openMapView", "Open in MapView")}
            >
              <MapPinned size={13} className="shrink-0" />
              <span className="truncate">{t("tripsPage.eventCenter.openMapView", "Open in MapView")}</span>
            </button>
          </div>

          <TripRunSummary detail={detail} />

          <div className="pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
              <div className="font-semibold text-slate-700">
                {t("tripsPage.eventCenter.replay", "Trip replay")}
              </div>
              <div className="text-[11px] text-slate-400">
                {t("tripsPage.eventCenter.sortedByMileage", "Sorted by trip mileage")}
              </div>
            </div>
            {replayEvents.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
                {t("tripsPage.eventCenter.empty", "No events on this trip")}
              </div>
            ) : (
              <div className="space-y-1.5">
                {replayEvents.map((event) => (
                  <ReplayRow
                    key={event.id}
                    detail={detail}
                    event={event}
                    entry={event.userEventId ? entryByEventId.get(String(event.userEventId)) : undefined}
                    selected={!!event.userEventId && selectedEventId === event.userEventId}
                    onFocusEvent={onFocusEvent}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TripRunSummary: React.FC<{ detail: TripDetailModel }> = ({ detail }) => {
  const { t } = useTranslation();
  const firstSegment = detail.segments[0];
  const visibleSegments = detail.segments.slice(0, 3);
  const hiddenSegmentCount = Math.max(0, detail.segments.length - visibleSegments.length);
  const keyEvents = detail.events.filter((event) => event.importance === "key").slice(0, 5);

  return (
    <div className="border-b border-slate-100 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-slate-600">
        <RailGraphBadge
          icon={detail.kind === "rail_graph" ? "snapshot" : "legacy"}
          value={detail.kind === "rail_graph" ? t("tripsPage.railGraph.run", "Rail graph run") : t("tripsPage.eventCenter.geoJsonAxis", "GeoJSON mileage axis")}
          tone={detail.kind === "rail_graph" ? "emerald" : "slate"}
          className="rounded"
        />
        <RailGraphRunBadges
          meta={{
            serviceType: firstSegment?.serviceType,
            direction: firstSegment?.direction,
            patternRef: firstSegment?.patternRef,
          }}
          badgeClassName="rounded"
          patternClassName="max-w-[12rem]"
        />
        <RailGraphBadge icon="distance" value={formatDistanceKm(detail.overview.totalDistanceKm, t)} tone="slate" className="rounded" />
        {detail.overview.totalTimeMinutes !== undefined && (
          <RailGraphBadge icon="duration" value={formatMinutes(detail.overview.totalTimeMinutes, t)} tone="slate" className="rounded" />
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {visibleSegments.map((segment) => (
          <div key={segment.id} className="grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)] gap-2 text-[11px] text-slate-600">
            <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.displayColor || "#10b981" }} />
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate font-semibold text-slate-800" title={segment.lineLabel}>{segment.lineLabel}</span>
                <RailGraphRunBadges
                  meta={{ serviceType: segment.serviceType, direction: segment.direction }}
                  badgeClassName="rounded bg-white"
                />
              </div>
              <div className="truncate" title={`${segment.fromName} -> ${segment.toName}`}>
                {segment.fromName} <span className="text-slate-300">-&gt;</span> {segment.toName}
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                <RailGraphBadge
                  icon="stops"
                  value={t("tripsPage.railGraph.stopPass", "{{stops}} stops / {{passes}} pass", { stops: segment.stopCount, passes: segment.passCount })}
                  tone="slate"
                  className="rounded bg-white"
                />
                <RailGraphBadge
                  icon="via"
                  value={t("tripsPage.railGraph.via", "{{count}} via", { count: segment.viaStationCount })}
                  tone="slate"
                  className="rounded bg-white"
                />
                {segment.patternRef && (
                  <RailGraphBadge
                    icon="pattern"
                    label={t("mileageEvents.inspector.pattern", "Pattern")}
                    value={compactRailGraphRef(segment.patternRef)}
                    title={String(segment.patternRef)}
                    tone="indigo"
                    className="max-w-[12rem] rounded bg-white"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
        {hiddenSegmentCount > 0 && (
          <div className="flex items-center rounded-md border border-dashed border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500">
            {t("tripsPage.eventCenter.moreSegments", "+{{count}} segments", { count: hiddenSegmentCount })}
          </div>
        )}
      </div>

      {keyEvents.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {keyEvents.map((event) => (
            <RailGraphEventPill
              key={event.id}
              type={event.type}
              label={`${detailEventTypeLabel(event.type, t)} - ${event.label}`}
              title={event.label}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ReplayRow: React.FC<{
  detail: TripDetailModel;
  event: TripDetailEvent;
  entry?: MileageEventListEntry;
  selected: boolean;
  onFocusEvent: (entry: MileageEventListEntry) => void;
}> = ({ detail, event, entry, selected, onFocusEvent }) => {
  const { t } = useTranslation();
  const segment = typeof event.segmentIndex === "number" ? detail.segments[event.segmentIndex] : undefined;
  const line = entry ? eventLineLabel(entry.bound, entry.lineContext) : segment?.lineLabel;
  const station = entry ? eventStationLabel(entry.bound, entry.lineContext) : event.stationName;
  const eventTitle = entry?.bound.event.title ?? event.label;
  const eventType = entry ? eventKindLabel(entry.bound.event.kind, t) : detailEventTypeLabel(event.type, t);
  const eventBody = entry?.bound.event.body;
  const eventTags = entry?.bound.event.tags?.slice(0, 3) ?? [];
  const canFocusMap = !!entry;

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <RailGraphEventPill type={entry?.bound.event.kind ?? event.type} label={eventType} className="max-w-[8rem]" />
        <span className="truncate font-semibold text-slate-800">{eventTitle}</span>
        {canFocusMap && (
          <span
            className="ml-auto shrink-0 rounded p-1 text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-700"
            title={t("mileageEvents.action.viewMap", "View map")}
            aria-label={t("mileageEvents.action.viewMap", "View map")}
          >
            <MapPinned size={13} />
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        {line && (
          <span className="inline-flex max-w-[12rem] items-center gap-1 truncate">
            <Route size={12} className="shrink-0 text-slate-400" />
            <span className="truncate">{line}</span>
          </span>
        )}
        {station && <span className="max-w-[10rem] truncate">{station}</span>}
        {eventTags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            <Tag size={10} />
            {tag}
          </span>
        ))}
      </div>
      {eventBody && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-600">{eventBody}</p>}
    </>
  );

  return (
    <div className="grid grid-cols-[4.25rem_1rem_minmax(0,1fr)] gap-2 text-xs">
      <div className="pt-2 text-right font-mono text-[11px] text-slate-500">
        {event.distanceMeters !== undefined ? formatKm(event.distanceMeters) : "-"}
      </div>
      <div className="flex justify-center pt-2">
        <span className={`h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm ${selected ? "bg-emerald-600" : event.source === "user" ? "bg-violet-500" : "bg-slate-400"}`} />
      </div>
      {canFocusMap ? (
        <button
          type="button"
          className={`group min-w-0 rounded-md border px-2 py-1.5 text-left transition ${
            selected
              ? "border-emerald-300 bg-emerald-50"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
          onClick={() => {
            if (entry) onFocusEvent(entry);
          }}
        >
          {body}
        </button>
      ) : (
        <div className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left">
          {body}
        </div>
      )}
    </div>
  );
};

function sourceBadge(detail: TripDetailModel, t: TranslateFn) {
  if (detail.kind === "rail_graph") {
    return {
      icon: "snapshot" as const,
      tone: "emerald" as const,
      value: t("tripsPage.eventCenter.snapshotAxis", "Saved snapshot axis"),
    };
  }
  return {
    icon: "legacy" as const,
    tone: "slate" as const,
    value: t("tripsPage.eventCenter.geoJsonAxis", "GeoJSON mileage axis"),
  };
}

function detailEventTypeLabel(type: TripDetailEventType, t: TranslateFn) {
  if (type === "departure") return t("tripsPage.railGraph.event.departure", "Departure");
  if (type === "arrival") return t("tripsPage.railGraph.event.arrival", "Arrival");
  if (type === "transfer") return t("tripsPage.railGraph.event.transfer", "Transfer");
  if (type === "scenic") return t("tripsPage.railGraph.event.scenic", "Scenic");
  if (type === "stop") return t("tripsPage.railGraph.event.stop", "Stop");
  if (type === "pass") return t("tripsPage.railGraph.event.pass", "Pass");
  if (type === "user_event") return t("tripsPage.railGraph.event.user", "User event");
  if (type === "note" || type === "user_note") return t("tripsPage.railGraph.event.note", "Note");
  return type;
}

function formatDistanceKm(km: number, t: TranslateFn) {
  return t("tripsPage.railGraph.km", "{{value}} km", { value: Math.max(0, km).toFixed(1) });
}

function formatMinutes(minutes: number, t: TranslateFn) {
  return t("tripsPage.railGraph.minutes", "{{count}} min", { count: Math.max(0, minutes || 0) });
}
