import React, { useEffect, useMemo, useState } from "react";
import { MapPinned, Navigation, Plus, Route, TrainFront } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import { getTripRailGraphSnapshot } from "../../utils/railGraphTripPersistence";
import { tripLineSummary, tripToProductSegments } from "../../utils/tripProductProjection";
import {
  buildAppMileageLineContext,
  createMileageEventAtDistance,
  createMileageEventFromCoordinates,
  createMileageEventFromStation,
  createMileageEventFromTripPosition,
  findLineKeyForMileageEvent,
  formatKm,
  lineLabel,
  tagsFromInput,
  tagsToInput,
  updateMileageEventFromDraft,
} from "../../utils/mileageUserEvents";
import { eventKindLabel, eventVisibilityLabel, mileageEventKinds, mileageEventVisibilities } from "./display";
import { useMileageEventActions } from "./useMileageEventActions";
import { requestMileageEventsMapCenter } from "../../utils/mileageEventUiBridge";

type ComposerSource = "station" | "map" | "mileage" | "trip";

interface Props {
  event?: UserEventV2 | null;
  defaultLineKey?: string;
  defaultStationId?: string;
  defaultTripId?: string | number;
  defaultTripSegmentIndex?: number;
  defaultTripRatio?: number;
  defaultSource?: ComposerSource;
  defaultTitle?: string;
  defaultBody?: string;
  defaultTags?: string[];
  defaultMediaUrl?: string;
  resetKey?: string | number;
  mapPoint?: { lat: number; lng: number } | null;
  compact?: boolean;
  onSaved?: (event: UserEventV2) => void;
  onCancel?: () => void;
}

export const EventComposer: React.FC<Props> = ({
  event,
  defaultLineKey,
  defaultStationId,
  defaultTripId,
  defaultTripSegmentIndex,
  defaultTripRatio,
  defaultSource = "station",
  defaultTitle = "",
  defaultBody = "",
  defaultTags,
  defaultMediaUrl = "",
  resetKey,
  mapPoint,
  compact = false,
  onSaved,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { railwayData, trips } = useStore(
    useShallow((state) => ({
      railwayData: state.railwayData,
      trips: state.trips,
    }))
  );
  const { addEvent, updateEvent } = useMileageEventActions();
  const defaultTagsInput = tagsToInput(defaultTags);

  const lineKeys = useMemo(() => Object.keys(railwayData).sort(), [railwayData]);
  const eventLineKey = event ? findLineKeyForMileageEvent(event) : null;
  const initialLineKey = eventLineKey || defaultLineKey || lineKeys[0] || "";

  const [source, setSource] = useState<ComposerSource>(defaultSource);
  const [lineKey, setLineKey] = useState(initialLineKey);
  const [stationId, setStationId] = useState(defaultStationId || "");
  const [distanceKm, setDistanceKm] = useState(event ? (event.mileage.distanceMeters / 1000).toFixed(1) : "0");
  const [tripId, setTripId] = useState<string>(defaultTripId !== undefined ? String(defaultTripId) : "");
  const [tripSegmentIndex, setTripSegmentIndex] = useState(defaultTripSegmentIndex ?? 0);
  const [tripRatio, setTripRatio] = useState(defaultTripRatio !== undefined ? defaultTripRatio.toFixed(3) : "0.5");
  const [title, setTitle] = useState(event?.title ?? defaultTitle);
  const [body, setBody] = useState(event?.body ?? defaultBody);
  const [kind, setKind] = useState(event?.kind ?? "user_note");
  const [visibility, setVisibility] = useState(event?.visibility ?? "private");
  const [tagsInput, setTagsInput] = useState(event ? tagsToInput(event.tags) : defaultTagsInput);
  const [mediaUrl, setMediaUrl] = useState(String(event?.payload?.mediaUrl ?? defaultMediaUrl));
  const [linkedTripId, setLinkedTripId] = useState<string>(String(event?.payload?.tripId ?? defaultTripId ?? ""));

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setBody(event.body ?? "");
      setKind(event.kind);
      setVisibility(event.visibility);
      setTagsInput(tagsToInput(event.tags));
      setMediaUrl(String(event.payload?.mediaUrl ?? ""));
      setLinkedTripId(String(event.payload?.tripId ?? ""));
      setDistanceKm((event.mileage.distanceMeters / 1000).toFixed(1));
      if (eventLineKey) setLineKey(eventLineKey);
    }
  }, [event, eventLineKey]);

  useEffect(() => {
    if (event) return;
    setSource(defaultSource);
  }, [defaultSource, event]);

  useEffect(() => {
    if (event) return;
    setTitle(defaultTitle);
    setBody(defaultBody);
    setTagsInput(defaultTagsInput);
    setMediaUrl(defaultMediaUrl);
  }, [defaultBody, defaultMediaUrl, defaultTagsInput, defaultTitle, event, resetKey]);

  useEffect(() => {
    if (event) return;
    const nextLineKey = defaultLineKey || lineKeys[0] || "";
    setLineKey((current) => {
      if (defaultLineKey && current !== defaultLineKey) return defaultLineKey;
      if (!current) return nextLineKey;
      if (lineKeys.length > 0 && !lineKeys.includes(current)) return nextLineKey;
      return current;
    });
  }, [defaultLineKey, event, lineKeys]);

  useEffect(() => {
    if (event) return;
    if (defaultStationId !== undefined) setStationId(defaultStationId);
  }, [defaultStationId, event]);

  useEffect(() => {
    if (event) return;
    if (defaultTripId !== undefined) {
      const nextTripId = String(defaultTripId);
      setTripId(nextTripId);
      setLinkedTripId(nextTripId);
    }
    if (defaultTripSegmentIndex !== undefined) setTripSegmentIndex(defaultTripSegmentIndex);
    if (defaultTripRatio !== undefined) setTripRatio(defaultTripRatio.toFixed(3));
  }, [defaultTripId, defaultTripRatio, defaultTripSegmentIndex, event]);

  const lineContext = useMemo(
    () => (lineKey ? buildAppMileageLineContext(railwayData, lineKey) : null),
    [lineKey, railwayData],
  );
  const selectedTrip = useMemo(
    () => trips.find((candidate) => String(candidate.id) === tripId) ?? trips[0] ?? null,
    [tripId, trips],
  );
  const selectedTripUsesRailGraph = !!(selectedTrip && getTripRailGraphSnapshot(selectedTrip));
  const selectedTripSegments = useMemo(
    () => (selectedTrip ? tripToProductSegments(selectedTrip, railwayData) : []),
    [railwayData, selectedTrip],
  );
  const effectiveTripSegmentIndex = selectedTripSegments.length > 0
    ? Math.max(0, Math.min(selectedTripSegments.length - 1, tripSegmentIndex))
    : 0;
  const selectedTripSegment = selectedTripSegments[effectiveTripSegmentIndex] ?? null;
  const tripRatioNumber = Number.isFinite(Number(tripRatio))
    ? Math.max(0, Math.min(1, Number(tripRatio)))
    : 0;
  const stations = lineContext?.line.stations ?? [];
  const effectiveStationId = stationId || stations[0]?.id || "";
  const editableLocation = !event;

  useEffect(() => {
    if (event || selectedTripSegments.length === 0) return;
    setTripSegmentIndex((current) => Math.max(0, Math.min(selectedTripSegments.length - 1, current)));
  }, [event, selectedTripSegments.length]);

  const tripOptionLabel = (trip: typeof trips[number]) => {
    const source = getTripRailGraphSnapshot(trip)
      ? t("mileageEvents.tripSourceRailGraph", "Rail graph")
      : t("mileageEvents.tripSourceLegacy", "Legacy GeoJSON");
    return `${trip.date} - ${source} - ${tripLineSummary(trip, railwayData)}`;
  };
  const sourceTargetLabel = (key: ComposerSource) => {
    if (key === "trip") {
      if (!selectedTrip) return t("mileageEvents.sourceTarget.noTrip", "No trip selected");
      if (selectedTripSegments.length === 0) {
        return t("mileageEvents.sourceTarget.noProjectableTrip", "No projectable segment");
      }
      return selectedTripUsesRailGraph
        ? t("mileageEvents.sourceTarget.railGraphTrip", "Saved snapshot")
        : t("mileageEvents.sourceTarget.legacyTrip", "Legacy trip");
    }
    return lineContext
      ? t("mileageEvents.sourceTarget.geoJsonAxis", "GeoJSON axis")
      : t("mileageEvents.sourceTarget.noAxis", "No axis loaded");
  };
  const sourceCards = [
    {
      key: "station",
      Icon: TrainFront,
      label: t("mileageEvents.createSource.station", "Station"),
      hint: t("mileageEvents.createSourceHint.station", "Snap the event to a station on the selected mileage axis."),
      tone: "text-sky-700",
      ring: "ring-sky-200",
      bg: "bg-sky-50",
    },
    {
      key: "map",
      Icon: MapPinned,
      label: t("mileageEvents.createSource.map", "Map"),
      hint: t("mileageEvents.createSourceHint.map", "Project the current map point to the mileage axis."),
      tone: "text-emerald-700",
      ring: "ring-emerald-200",
      bg: "bg-emerald-50",
    },
    {
      key: "mileage",
      Icon: Navigation,
      label: t("mileageEvents.createSource.mileage", "Mileage"),
      hint: t("mileageEvents.createSourceHint.mileage", "Place the event by an exact kilometer value."),
      tone: "text-amber-700",
      ring: "ring-amber-200",
      bg: "bg-amber-50",
    },
    {
      key: "trip",
      Icon: Route,
      label: t("mileageEvents.createSource.trip", "Trip"),
      hint: t("mileageEvents.createSourceHint.trip", "Attach the event to a position on a saved trip segment."),
      tone: "text-indigo-700",
      ring: "ring-indigo-200",
      bg: "bg-indigo-50",
    },
  ] satisfies Array<{
    key: ComposerSource;
    Icon: typeof TrainFront;
    label: string;
    hint: string;
    tone: string;
    ring: string;
    bg: string;
  }>;
  const sourceBlockedReason = (key: ComposerSource) => {
    if (event) return "";
    if (key === "trip") {
      if (trips.length === 0 || !selectedTrip) {
        return t("mileageEvents.disabledReason.noTrip", "Add a trip before creating an event from trip position.");
      }
      if (selectedTripSegments.length === 0) {
        return t("mileageEvents.disabledReason.noTripSegment", "The selected trip has no segment that can receive a mileage event.");
      }
      return "";
    }
    if (!lineContext) {
      return t("mileageEvents.disabledReason.noLineAxis", "Load GeoJSON line data before creating an event on this axis.");
    }
    if (key === "station" && !effectiveStationId) {
      return t("mileageEvents.disabledReason.noStation", "Select a station before creating this event.");
    }
    if (key === "map" && !mapPoint) {
      return t("mileageEvents.disabledReason.noMapPoint", "Click the map or use the map center before creating this event.");
    }
    return "";
  };
  const createBlockedReason = sourceBlockedReason(source);
  const createDisabled = !event && !!createBlockedReason;

  const submit = () => {
    if (event) {
      const updated = updateMileageEventFromDraft(event, {
        title,
        body,
        kind,
        visibility,
        tags: tagsFromInput(tagsInput),
        mediaUrl,
        tripId: linkedTripId || undefined,
      });
      updateEvent(updated);
      onSaved?.(updated);
      return;
    }

    const draft = {
      title: title || t("mileageEvents.defaultTitle", "Mileage event"),
      body,
      kind,
      visibility,
      tags: tagsFromInput(tagsInput),
      mediaUrl,
      tripId: linkedTripId || undefined,
    };

    let created: UserEventV2 | null = null;
    if (source === "trip") {
      const trip = trips.find((candidate) => String(candidate.id) === tripId) ?? trips[0];
      created = trip
        ? createMileageEventFromTripPosition({
            railwayData,
            trip,
            segmentIndex: effectiveTripSegmentIndex,
            ratio: tripRatioNumber,
            ...draft,
          })
        : null;
    } else if (!lineContext) {
      return;
    } else if (source === "station") {
      created = createMileageEventFromStation({
        lineContext,
        stationId: effectiveStationId,
        ...draft,
      });
    } else if (source === "map") {
      created = mapPoint
        ? createMileageEventFromCoordinates({
            lineContext,
            coordinates: [mapPoint.lng, mapPoint.lat],
            ...draft,
          })
        : null;
    } else {
      created = createMileageEventAtDistance({
        lineContext,
        distanceMeters: Number(distanceKm || 0) * 1000,
        ...draft,
      });
    }

    if (!created) return;
    addEvent(created);
    setTitle("");
    setBody("");
    setTagsInput("");
    setMediaUrl("");
    onSaved?.(created);
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {editableLocation && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {sourceCards.map(({ key, Icon, label, hint, tone, ring, bg }) => {
            const selected = source === key;
            const cardBlockedReason = sourceBlockedReason(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSource(key)}
                aria-pressed={selected}
                aria-describedby={cardBlockedReason ? `mileage-event-source-${key}-reason` : undefined}
                className={`min-w-0 rounded-md border p-2 text-left transition ${
                  selected
                    ? `border-transparent bg-white shadow-sm ring-2 ${ring}`
                    : cardBlockedReason
                      ? "border-amber-200 bg-amber-50/50 hover:border-amber-300 hover:bg-white"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded ${selected ? bg : "bg-white"} ${tone}`}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block break-words text-xs font-semibold ${selected ? "text-slate-900" : "text-slate-600"}`}>
                      {label}
                    </span>
                    <span className={`mt-0.5 block break-words text-[10px] font-semibold leading-tight ${cardBlockedReason ? "text-amber-600" : "text-slate-400"}`}>
                      {sourceTargetLabel(key)}
                    </span>
                  </span>
                </span>
                <span className="mt-1.5 line-clamp-2 block min-h-[2.1em] text-[10px] leading-snug text-slate-500">
                  {hint}
                </span>
                {cardBlockedReason && (
                  <span
                    id={`mileage-event-source-${key}-reason`}
                    className="mt-1.5 block rounded border border-amber-200 bg-white/80 px-1.5 py-1 text-[10px] font-semibold leading-snug text-amber-700"
                  >
                    {cardBlockedReason}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {editableLocation && source !== "trip" && (
        <label className="block text-xs font-medium text-slate-600">
          {t("mileageEvents.line", "Line")}
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={lineKey}
            onChange={(changeEvent) => {
              setLineKey(changeEvent.target.value);
              setStationId("");
            }}
          >
            {lineKeys.map((key) => (
              <option key={key} value={key}>
                {lineLabel(key)}
              </option>
            ))}
          </select>
        </label>
      )}

      {editableLocation && source === "station" && (
        <label className="block text-xs font-medium text-slate-600">
          {t("mileageEvents.station", "Station")}
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={effectiveStationId}
            onChange={(changeEvent) => setStationId(changeEvent.target.value)}
          >
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name_ja}
              </option>
            ))}
          </select>
        </label>
      )}

      {editableLocation && source === "mileage" && (
        <label className="block text-xs font-medium text-slate-600">
          {t("mileageEvents.distanceKm", "Mileage km")}
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={distanceKm}
            inputMode="decimal"
            onChange={(changeEvent) => setDistanceKm(changeEvent.target.value)}
          />
          {lineContext && (
            <span className="mt-1 block text-[11px] text-slate-400">
              {t("mileageEvents.totalMileage", "Line range")} {formatKm(lineContext.totalMeters)}
            </span>
          )}
        </label>
      )}

      {editableLocation && source === "map" && (
        <div className="rounded-md border border-emerald-100 bg-emerald-50/70 p-2 text-xs text-slate-600">
          <div>
            {mapPoint
              ? t("mileageEvents.mapPointReady", "Current map point will be projected to mileage.")
              : t("mileageEvents.mapPointMissing", "Click the map or use the current map center first.")}
          </div>
          <button
            type="button"
            className="rl-secondary-action mt-2 w-full px-2 py-1.5 text-[11px] font-semibold"
            onClick={requestMileageEventsMapCenter}
          >
            {t("mileageEvents.useMapCenter", "Use map center")}
          </button>
        </div>
      )}

      {editableLocation && source === "trip" && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.trip", "Trip")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={tripId}
              onChange={(changeEvent) => setTripId(changeEvent.target.value)}
            >
              <option value="">{t("mileageEvents.latestTrip", "Latest trip")}</option>
              {trips.map((trip) => (
                <option key={String(trip.id)} value={String(trip.id)}>
                  {tripOptionLabel(trip)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-slate-400">
              {selectedTripUsesRailGraph
                ? t("mileageEvents.tripSourceHintRailGraph", "Creates the event on the saved rail-graph run snapshot.")
                : t("mileageEvents.tripSourceHintLegacy", "Creates the event on the current GeoJSON mileage axis.")}
            </span>
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.tripSegment", "Segment")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={effectiveTripSegmentIndex}
                onChange={(changeEvent) => setTripSegmentIndex(Number(changeEvent.target.value))}
              >
                {selectedTripSegments.map((segment, index) => (
                  <option key={`${segment.id}:${index}`} value={index}>
                    {index + 1}. {segment.lineLabel || lineLabel(segment.lineKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.position", "Position")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={`${Math.round(tripRatioNumber * 100)}%`}
                readOnly
              />
            </label>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={tripRatioNumber}
            onChange={(changeEvent) => setTripRatio(changeEvent.target.value)}
            className="w-full accent-emerald-600"
            aria-label={t("mileageEvents.tripPositionPercent", "Trip position percentage")}
          />
          {selectedTripSegment && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
              {t("mileageEvents.tripSegmentSummary", "{{from}} to {{to}} · {{distance}} km", {
                from: selectedTripSegment.fromName || t("mileageEvents.unknown", "Unknown"),
                to: selectedTripSegment.toName || t("mileageEvents.unknown", "Unknown"),
                distance: Math.max(0, selectedTripSegment.distanceKm || 0).toFixed(1),
              })}
            </div>
          )}
        </div>
      )}

      <input
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder={t("mileageEvents.titlePlaceholder", "Title")}
        value={title}
        onChange={(changeEvent) => setTitle(changeEvent.target.value)}
      />
      <textarea
        className="min-h-16 w-full resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder={t("mileageEvents.bodyPlaceholder", "Note")}
        value={body}
        onChange={(changeEvent) => setBody(changeEvent.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-medium text-slate-600">
          {t("mileageEvents.type", "Type")}
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={kind}
            onChange={(changeEvent) => setKind(changeEvent.target.value as typeof kind)}
          >
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
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={visibility}
            onChange={(changeEvent) => setVisibility(changeEvent.target.value as typeof visibility)}
          >
            {mileageEventVisibilities.map((item) => (
              <option key={item} value={item}>
                {eventVisibilityLabel(item, t)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder={t("mileageEvents.tagsPlaceholder", "Tags, separated by comma")}
        value={tagsInput}
        onChange={(changeEvent) => setTagsInput(changeEvent.target.value)}
      />
      <input
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder={t("mileageEvents.mediaPlaceholder", "Photo URL or attachment placeholder")}
        value={mediaUrl}
        onChange={(changeEvent) => setMediaUrl(changeEvent.target.value)}
      />
      <label className="block text-xs font-medium text-slate-600">
        {t("mileageEvents.linkedTrip", "Linked trip")}
        <select
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={linkedTripId}
          onChange={(changeEvent) => setLinkedTripId(changeEvent.target.value)}
        >
          <option value="">{t("mileageEvents.noLinkedTrip", "No linked trip")}</option>
          {trips.map((trip) => (
            <option key={String(trip.id)} value={String(trip.id)}>
              {tripOptionLabel(trip)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        {onCancel && (
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            onClick={onCancel}
          >
            {t("common.cancel", "Cancel")}
          </button>
        )}
        <button
          type="button"
          className={`${onCancel ? "" : "col-span-2"} flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300`}
          onClick={submit}
          disabled={createDisabled}
        >
          <Plus size={14} />
          {event ? t("mileageEvents.action.save", "Save") : t("mileageEvents.action.create", "Create event")}
        </button>
      </div>
      {createBlockedReason && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-700">
          {createBlockedReason}
        </div>
      )}
    </div>
  );
};
