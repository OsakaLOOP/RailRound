import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  Download,
  LocateFixed,
  MapPinned,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";
import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import {
  buildAppMileageLineContext,
  createMileageEventFromCoordinates,
  eventsForLine,
  lineLabel,
  queryEventsNearPlace,
  queryLineEventsByStation,
  queryLineEventsByTime,
} from "../../utils/mileageUserEvents";
import { EventComposer } from "../mileage-events/EventComposer";
import { EventInspector } from "../mileage-events/EventInspector";
import { EventList, MileageEventListEntry } from "../mileage-events/EventList";
import { EventSearchPanel } from "../mileage-events/EventSearchPanel";
import { useMileageEventActions } from "../mileage-events/useMileageEventActions";

type PanelMode = "line" | "place" | "time" | "create";
type PlaceSource = "station" | "map";

export const MileageEventsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { railwayData, mileageUserEvents } = useStore((state) => ({
    railwayData: state.railwayData,
    mileageUserEvents: state.mileageUserEvents,
  }));
  const { importEvents, persistEvents } = useMileageEventActions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lineKeys = useMemo(() => Object.keys(railwayData).sort(), [railwayData]);
  const [open, setOpen] = useState(false);
  const [lineKey, setLineKey] = useState("");
  const [stationId, setStationId] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(1000);
  const [timeFrom, setTimeFrom] = useState("08:00");
  const [timeTo, setTimeTo] = useState("09:00");
  const [mode, setMode] = useState<PanelMode>("line");
  const [placeSource, setPlaceSource] = useState<PlaceSource>("station");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mapPoint, setMapPoint] = useState<{ lat: number; lng: number } | null>(null);

  const effectiveLineKey = lineKey || lineKeys[0] || "";
  const lineContext = useMemo(
    () => (effectiveLineKey ? buildAppMileageLineContext(railwayData, effectiveLineKey) : null),
    [railwayData, effectiveLineKey],
  );
  const stations = lineContext?.line.stations ?? [];
  const effectiveStationId = stationId || stations[0]?.id || "";

  useEffect(() => {
    const handleSelect = (event: Event) => {
      const customEvent = event as CustomEvent<{ eventId?: string }>;
      if (!customEvent.detail?.eventId) return;
      setOpen(true);
      setSelectedEventId(customEvent.detail.eventId);
    };
    const handleMapPoint = (event: Event) => {
      const customEvent = event as CustomEvent<{ lat?: number; lng?: number }>;
      if (typeof customEvent.detail?.lat !== "number" || typeof customEvent.detail?.lng !== "number") return;
      setMapPoint({ lat: customEvent.detail.lat, lng: customEvent.detail.lng });
      if (mode === "place") {
        setPlaceSource("map");
        return;
      }
      if (mode === "create") return;
      setMode("create");
    };
    window.addEventListener("mileage-event:select", handleSelect);
    window.addEventListener("mileage-events:map-point", handleMapPoint);
    return () => {
      window.removeEventListener("mileage-event:select", handleSelect);
      window.removeEventListener("mileage-events:map-point", handleMapPoint);
    };
  }, [mode]);

  const lineEntries = useMemo<MileageEventListEntry[]>(
    () =>
      lineContext
        ? eventsForLine(mileageUserEvents, lineContext).map((bound) => ({ bound, lineContext }))
        : [],
    [lineContext, mileageUserEvents],
  );
  const placeEntries = useMemo<MileageEventListEntry[]>(() => {
    if (!lineContext) return [];
    if (placeSource === "map") {
      if (!mapPoint) return [];
      return queryEventsNearPlace({
        events: mileageUserEvents,
        lineContext,
        place: { coordinates: [mapPoint.lng, mapPoint.lat] },
        radiusMeters,
      }).items.map((bound) => ({ bound, lineContext }));
    }
    if (!effectiveStationId) return [];
    return queryLineEventsByStation({
      events: mileageUserEvents,
      lineContext,
      stationId: effectiveStationId,
      radiusMeters,
    }).items.map((bound) => ({ bound, lineContext }));
  }, [effectiveStationId, lineContext, mapPoint, mileageUserEvents, placeSource, radiusMeters]);
  const timeEntries = useMemo<MileageEventListEntry[]>(() => {
    if (!lineContext) return [];
    return queryLineEventsByTime({
      events: mileageUserEvents,
      lineContext,
      fromTime: timeFrom,
      toTime: timeTo,
    }).items.map((bound) => ({ bound, lineContext }));
  }, [lineContext, mileageUserEvents, timeFrom, timeTo]);

  const selectedEvent = useMemo(
    () => mileageUserEvents.find((event) => event.id === selectedEventId) ?? null,
    [mileageUserEvents, selectedEventId],
  );

  const selectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    window.dispatchEvent(
      new CustomEvent("mileage-event:select", {
        detail: { eventId },
      }),
    );
  };

  const focusEventOnMap = (entry: MileageEventListEntry) => {
    selectEvent(entry.bound.event.id);
    if (!entry.bound.coordinates) return;
    window.dispatchEvent(
      new CustomEvent("map:fly-to-location", {
        detail: {
          lat: entry.bound.coordinates[1],
          lng: entry.bound.coordinates[0],
          zoom: 15,
        },
      }),
    );
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ mileageUserEvents }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `railloop_mileage_events_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 0);
  };

  const handleImport = (changeEvent: React.ChangeEvent<HTMLInputElement>) => {
    const file = changeEvent.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const incoming = Array.isArray(parsed)
          ? parsed
          : parsed.mileageUserEvents || parsed.mileage_user_events || [];
        importEvents(
          incoming.filter(
            (event: any): event is UserEventV2 =>
              event?.schemaVersion === "mileage-user-event-v1" && event?.id && event?.mileage,
          ),
        );
      } catch (error) {
        console.error("Mileage event import failed", error);
      } finally {
        changeEvent.target.value = "";
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const convertLegacyPins = () => {
    const pins = useStore.getState().pins;
    if (!lineContext || pins.length === 0) return;
    const created = pins
      .map((pin) => {
        const title = pin.comment || t("mileageEvents.legacyPinTitle", "Imported map pin");
        const event = {
          lineContext,
          coordinates: [pin.lng, pin.lat] as [number, number],
          title,
          body: pin.imageUrl || undefined,
          tags: ["legacy-pin"],
          mediaUrl: pin.imageUrl,
        };
        return event;
      });
    const next = created
      .map((draft) => createMileageEventFromCoordinates(draft))
      .filter((event): event is UserEventV2 => event !== null);
    if (next.length) persistEvents([...mileageUserEvents, ...next]);
  };

  if (!open) {
    return (
      <button
        className="absolute right-4 top-4 z-[520] flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/95 text-slate-700 shadow-[0_18px_45px_rgba(15,23,42,0.20)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-emerald-50 hover:text-emerald-700"
        onClick={() => setOpen(true)}
        title={t("mileageEvents.open", "Mileage events")}
      >
        <MapPinned size={22} />
      </button>
    );
  }

  return (
    <section className="absolute inset-x-2 bottom-3 z-[520] flex max-h-[82dvh] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.26)] ring-1 ring-slate-900/5 backdrop-blur-xl md:inset-y-4 md:left-auto md:right-4 md:max-h-none md:w-[min(24rem,calc(100vw-2rem))]">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <MapPinned size={17} />
            </span>
            {t("mileageEvents.title", "Mileage events")}
          </div>
          <div className="mt-1 truncate text-xs text-slate-500">
            {t("mileageEvents.panelSubtitle", "Search, project and edit events on the mileage axis")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            onClick={handleExport}
            title={t("mileageEvents.action.exportJson", "Export JSON")}
          >
            <Download size={16} />
          </button>
          <button
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            onClick={() => fileInputRef.current?.click()}
            title={t("mileageEvents.action.importJson", "Import JSON")}
          >
            <Upload size={16} />
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            onClick={() => setOpen(false)}
            title={t("common.close", "Close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-slate-200/80 bg-slate-50/80 p-2">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-200/70 p-1">
              {[
                ["line", LocateFixed, t("mileageEvents.timeline", "Line")] as const,
                ["place", Search, t("mileageEvents.place", "Place")] as const,
                ["time", Clock, t("mileageEvents.time", "Time")] as const,
                ["create", Plus, t("mileageEvents.create", "Create")] as const,
              ].map(([key, Icon, label]) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    mode === key
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-slate-500 hover:bg-white/60 hover:text-slate-800"
                  }`}
                >
                  <Icon size={14} />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {selectedEvent ? (
              <EventInspector
                event={selectedEvent}
                onClose={() => setSelectedEventId(null)}
                onDeleted={() => setSelectedEventId(null)}
              />
            ) : (
              <>
                {mode !== "create" && (
                  <div className="mb-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <label className="block text-xs font-medium text-slate-600">
                      {t("mileageEvents.line", "Line")}
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        value={effectiveLineKey}
                        onChange={(event) => {
                          setLineKey(event.target.value);
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

                    {mode === "place" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                          {[
                            ["station", Search, t("mileageEvents.createSource.station", "Station")] as const,
                            ["map", MapPinned, t("mileageEvents.createSource.map", "Map")] as const,
                          ].map(([key, Icon, label]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setPlaceSource(key)}
                              className={`flex min-w-0 items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold ${
                                placeSource === key ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                              }`}
                            >
                              <Icon size={13} />
                              <span className="truncate">{label}</span>
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                          {placeSource === "station" ? (
                            <label className="block text-xs font-medium text-slate-600">
                              {t("mileageEvents.station", "Station")}
                              <select
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                                value={effectiveStationId}
                                onChange={(event) => setStationId(event.target.value)}
                              >
                                {stations.map((station) => (
                                  <option key={station.id} value={station.id}>
                                    {station.name_ja}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                              {mapPoint
                                ? t("mileageEvents.mapPointReady", "Current map point will be projected to mileage.")
                                : t("mileageEvents.mapPointMissing", "Click the map or use the current map center first.")}
                              <button
                                type="button"
                                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                                onClick={() => window.dispatchEvent(new CustomEvent("mileage-events:request-map-center"))}
                              >
                                {t("mileageEvents.useMapCenter", "Use map center")}
                              </button>
                            </div>
                          )}
                          <label className="block text-xs font-medium text-slate-600">
                            {t("mileageEvents.radius", "Radius")}
                            <select
                              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                              value={radiusMeters}
                              onChange={(event) => setRadiusMeters(Number(event.target.value))}
                            >
                              <option value={500}>500 m</option>
                              <option value={1000}>1 km</option>
                              <option value={3000}>3 km</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    )}

                    {mode === "time" && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs font-medium text-slate-600">
                          {t("mileageEvents.fromTime", "From")}
                          <input
                            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                            value={timeFrom}
                            onChange={(event) => setTimeFrom(event.target.value)}
                          />
                        </label>
                        <label className="block text-xs font-medium text-slate-600">
                          {t("mileageEvents.toTime", "To")}
                          <input
                            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                            value={timeTo}
                            onChange={(event) => setTimeTo(event.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {mode === "line" && (
                  <EventSearchPanel
                    events={lineEntries.map((entry) => entry.bound.event)}
                    compact
                    selectedId={selectedEventId}
                    onSelect={(entry) => selectEvent(entry.bound.event.id)}
                    onViewMap={focusEventOnMap}
                  />
                )}
                {mode === "place" && (
                  <EventList
                    entries={placeEntries}
                    selectedId={selectedEventId}
                    emptyLabel={t("mileageEvents.emptyPlace", "No events near this place")}
                    onSelect={(entry) => selectEvent(entry.bound.event.id)}
                    onViewMap={focusEventOnMap}
                  />
                )}
                {mode === "time" && (
                  <EventList
                    entries={timeEntries}
                    selectedId={selectedEventId}
                    emptyLabel={t("mileageEvents.emptyTime", "No events in this time window")}
                    onSelect={(entry) => selectEvent(entry.bound.event.id)}
                    onViewMap={focusEventOnMap}
                  />
                )}
                {mode === "create" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                        onClick={() => window.dispatchEvent(new CustomEvent("mileage-events:request-map-center"))}
                      >
                        {t("mileageEvents.useMapCenter", "Use map center")}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                        onClick={convertLegacyPins}
                      >
                        {t("mileageEvents.convertPins", "Convert pins")}
                      </button>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <EventComposer
                        defaultLineKey={effectiveLineKey}
                        defaultStationId={effectiveStationId}
                        defaultSource={mapPoint ? "map" : "station"}
                        mapPoint={mapPoint}
                        onSaved={(event) => selectEvent(event.id)}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
