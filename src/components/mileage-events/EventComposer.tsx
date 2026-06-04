import React, { useEffect, useMemo, useState } from "react";
import { MapPinned, Navigation, Plus, Route, TrainFront } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import { getTripRailGraphSnapshot } from "../../utils/railGraphTripPersistence";
import { tripLineSummary } from "../../utils/tripProductProjection";
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

type ComposerSource = "station" | "map" | "mileage" | "trip";

interface Props {
  event?: UserEventV2 | null;
  defaultLineKey?: string;
  defaultStationId?: string;
  defaultTripId?: string | number;
  defaultSource?: ComposerSource;
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
  defaultSource = "station",
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

  const lineKeys = useMemo(() => Object.keys(railwayData).sort(), [railwayData]);
  const eventLineKey = event ? findLineKeyForMileageEvent(event) : null;
  const initialLineKey = eventLineKey || defaultLineKey || lineKeys[0] || "";

  const [source, setSource] = useState<ComposerSource>(defaultSource);
  const [lineKey, setLineKey] = useState(initialLineKey);
  const [stationId, setStationId] = useState(defaultStationId || "");
  const [distanceKm, setDistanceKm] = useState(event ? (event.mileage.distanceMeters / 1000).toFixed(1) : "0");
  const [tripId, setTripId] = useState<string>(defaultTripId !== undefined ? String(defaultTripId) : "");
  const [tripRatio, setTripRatio] = useState("0.5");
  const [title, setTitle] = useState(event?.title ?? "");
  const [body, setBody] = useState(event?.body ?? "");
  const [kind, setKind] = useState(event?.kind ?? "user_note");
  const [visibility, setVisibility] = useState(event?.visibility ?? "private");
  const [tagsInput, setTagsInput] = useState(tagsToInput(event?.tags));
  const [mediaUrl, setMediaUrl] = useState(String(event?.payload?.mediaUrl ?? ""));
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
  }, [defaultTripId, event]);

  const lineContext = useMemo(
    () => (lineKey ? buildAppMileageLineContext(railwayData, lineKey) : null),
    [lineKey, railwayData],
  );
  const selectedTrip = useMemo(
    () => trips.find((candidate) => String(candidate.id) === tripId) ?? trips[0] ?? null,
    [tripId, trips],
  );
  const selectedTripUsesRailGraph = !!(selectedTrip && getTripRailGraphSnapshot(selectedTrip));
  const stations = lineContext?.line.stations ?? [];
  const effectiveStationId = stationId || stations[0]?.id || "";
  const editableLocation = !event;

  const tripOptionLabel = (trip: typeof trips[number]) => {
    const source = getTripRailGraphSnapshot(trip)
      ? t("mileageEvents.tripSourceRailGraph", "Rail graph")
      : t("mileageEvents.tripSourceLegacy", "Legacy GeoJSON");
    return `${trip.date} - ${source} - ${tripLineSummary(trip, railwayData)}`;
  };

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
            ratio: Number(tripRatio),
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
        <div className="grid grid-cols-4 gap-1 rounded-md bg-slate-100 p-1">
          {[
            ["station", TrainFront, t("mileageEvents.createSource.station", "Station")] as const,
            ["map", MapPinned, t("mileageEvents.createSource.map", "Map")] as const,
            ["mileage", Navigation, t("mileageEvents.createSource.mileage", "Mileage")] as const,
            ["trip", Route, t("mileageEvents.createSource.trip", "Trip")] as const,
          ].map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSource(key)}
              className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-1.5 text-[11px] font-semibold ${
                source === key ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={13} />
              <span className="truncate">{label}</span>
            </button>
          ))}
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
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
          {mapPoint
            ? t("mileageEvents.mapPointReady", "Current map point will be projected to mileage.")
            : t("mileageEvents.mapPointMissing", "Click the map or use the current map center first.")}
        </div>
      )}

      {editableLocation && source === "trip" && (
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
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
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.position", "Position")}
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={tripRatio}
              inputMode="decimal"
              onChange={(changeEvent) => setTripRatio(changeEvent.target.value)}
            />
          </label>
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
              {trip.date} · {String(trip.id)}
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
          disabled={!event && (
            source === "trip"
              ? trips.length === 0
              : (!lineContext || (source === "station" && !effectiveStationId) || (source === "map" && !mapPoint))
          )}
        >
          <Plus size={14} />
          {event ? t("mileageEvents.action.save", "Save") : t("mileageEvents.action.create", "Create event")}
        </button>
      </div>
    </div>
  );
};
