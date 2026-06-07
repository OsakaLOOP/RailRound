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
import { useShallow } from "zustand/react/shallow";
import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import {
  boundMileageEventsForRichDisplay,
  buildAppMileageLineContext,
  eventsForLine,
  formatKm,
  lineLabel,
  queryEventsNearPlace,
  queryLineEventsByStation,
  queryLineEventsByTime,
} from "../../utils/mileageUserEvents";
import { tripToProductSegments } from "../../utils/tripProductProjection";
import { EventComposer } from "../mileage-events/EventComposer";
import { EventInspector } from "../mileage-events/EventInspector";
import { EventList, MileageEventListEntry } from "../mileage-events/EventList";
import { EventSearchPanel } from "../mileage-events/EventSearchPanel";
import { useMileageEventActions } from "../mileage-events/useMileageEventActions";
import { RailGraphBadge, RailGraphRunBadges } from "../rail-graph/RailGraphBadges";
import {
  customEventDetail,
  mileageEventUiEvents,
  requestMileageEventsMapCenter,
  selectMileageEventOnMap,
  setActiveMileageLine,
  type MileageEventSelectDetail,
  type MileageEventsComposerSource,
  type MileageEventsMapPointDetail,
  type MileageEventsOpenDetail,
  type MileageEventsPanelMode,
  type MileageEventsPlaceSource,
} from "../../utils/mileageEventUiBridge";
import {
  eventProjectionDetailFromPanelEntry,
  openDetailMatchesActiveRouteSelection,
  projectionDetailFromRailGraphSelection,
  projectionDetailFromMileageEventsOpen,
  railGraphSelectionSourceFromProjection,
  selectionFromMileageEventSelect,
  selectionFromMileageEventsOpen,
  selectionFromProductSegment,
} from "../../utils/railGraphSelection";

export const MileageEventsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { railwayData, mileageUserEvents, trips, activeRailGraphSelection, setActiveRailGraphSelection, clearActiveRailGraphSelection } = useStore(
    useShallow((state) => ({
      railwayData: state.railwayData,
      mileageUserEvents: state.mileageUserEvents,
      trips: state.trips,
      activeRailGraphSelection: state.activeRailGraphSelection,
      setActiveRailGraphSelection: state.setActiveRailGraphSelection,
      clearActiveRailGraphSelection: state.clearActiveRailGraphSelection,
    }))
  );
  const { importEvents } = useMileageEventActions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lineKeys = useMemo(() => Object.keys(railwayData).sort(), [railwayData]);
  const [open, setOpen] = useState(false);
  const [lineKey, setLineKey] = useState("");
  const [stationId, setStationId] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(1000);
  const [timeFrom, setTimeFrom] = useState("08:00");
  const [timeTo, setTimeTo] = useState("09:00");
  const [mode, setMode] = useState<MileageEventsPanelMode>("line");
  const [placeSource, setPlaceSource] = useState<MileageEventsPlaceSource>("station");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedProjection, setSelectedProjection] = useState<{
    lineKey?: string;
    source?: MileageEventSelectDetail["source"];
    tripId?: string | number;
    tripSegmentIndex?: number;
    routeItemId?: string;
  } | null>(null);
  const [mapPoint, setMapPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [composerDraft, setComposerDraft] = useState<{
    source: MileageEventsComposerSource;
    tripId?: string | number;
    tripSegmentIndex?: number;
    tripRatio?: number;
    lineKey?: string;
    stationId?: string;
    title?: string;
    body?: string;
    tags?: string[];
    mediaUrl?: string;
    resetKey: number;
  }>({ source: "station", resetKey: 0 });

  const effectiveLineKey = lineKey || lineKeys[0] || "";
  const lineContext = useMemo(
    () => (effectiveLineKey ? buildAppMileageLineContext(railwayData, effectiveLineKey) : null),
    [railwayData, effectiveLineKey],
  );
  const stations = lineContext?.line.stations ?? [];
  const effectiveStationId = stationId || stations[0]?.id || "";
  const axisIsRailGraph =
    selectedProjection?.source === "rail_graph_runtime" ||
    activeRailGraphSelection?.source === "rail_graph_snapshot";
  const activeRailGraphLineKey = axisIsRailGraph
    ? selectedProjection?.lineKey ?? activeRailGraphSelection?.lineKey ?? ""
    : "";
  const richEventEntries = useMemo(
    () => boundMileageEventsForRichDisplay(mileageUserEvents, railwayData, trips),
    [mileageUserEvents, railwayData, trips],
  );

  useEffect(() => {
    if (axisIsRailGraph && (mode === "place" || mode === "time")) {
      setMode("line");
    }
  }, [axisIsRailGraph, mode]);

  useEffect(() => {
    const handleSelect = (event: Event) => {
      const detail = customEventDetail<MileageEventSelectDetail>(event);
      if (!detail.eventId) return;
      setOpen(true);
      setSelectedEventId(detail.eventId);
      setSelectedProjection({
        lineKey: detail.lineKey,
        source: detail.source,
        tripId: detail.tripId,
        tripSegmentIndex: detail.tripSegmentIndex,
        routeItemId: detail.routeItemId,
      });
      const trip = detail.tripId !== undefined
        ? trips.find((candidate) => String(candidate.id) === String(detail.tripId))
        : null;
      const productSegments = trip ? tripToProductSegments(trip, railwayData) : [];
      const productSegment = typeof detail.tripSegmentIndex === "number"
        ? productSegments[detail.tripSegmentIndex]
        : undefined;
      const selection = productSegment
        ? selectionFromProductSegment({
            kind: "event",
            segment: productSegment,
            source: detail.source ? railGraphSelectionSourceFromProjection(detail.source) : undefined,
            lineKey: detail.lineKey ?? null,
            tripId: detail.tripId,
            tripSegmentIndex: detail.tripSegmentIndex,
            routeItemId: detail.routeItemId,
            eventId: detail.eventId,
          })
        : selectionFromMileageEventSelect(detail);
      if (selection) setActiveRailGraphSelection(selection);
      if (detail.lineKey && lineKeys.includes(detail.lineKey)) {
        setLineKey(detail.lineKey);
        setMode("line");
      } else if (detail.source === "rail_graph_runtime") {
        setActiveMileageLine({ lineKey: detail.lineKey ?? null, source: detail.source });
      }
    };
    const handleOpen = (event: Event) => {
      const detail = customEventDetail<MileageEventsOpenDetail>(event);
      setOpen(true);
      setSelectedEventId(detail.eventId ?? null);
      const projectionDetail = projectionDetailFromMileageEventsOpen(detail);
      if (!detail.eventId || projectionDetail) {
        setSelectedProjection(projectionDetail);
      }
      if (projectionDetail) {
        const selection = selectionFromMileageEventsOpen(detail);
        const currentActiveSelection = useStore.getState().activeRailGraphSelection ?? activeRailGraphSelection;
        if (selection && !openDetailMatchesActiveRouteSelection(detail, currentActiveSelection)) {
          setActiveRailGraphSelection(selection);
        }
      }
      if (detail.lineKey && lineKeys.includes(detail.lineKey)) {
        setLineKey(detail.lineKey);
      }
      if (detail.mode) setMode(detail.mode);
      if (!detail.create) return;

      const create = detail.create;
      const nextLineKey = create.lineKey || detail.lineKey;
      if (nextLineKey && lineKeys.includes(nextLineKey)) setLineKey(nextLineKey);
      if (create.stationId !== undefined) setStationId(create.stationId);
      if (create.mapPoint) {
        setMapPoint(create.mapPoint);
        setPlaceSource("map");
      }
      setMode("create");
      setComposerDraft((current) => ({
        source: create.source ?? "station",
        tripId: create.tripId,
        tripSegmentIndex: create.tripSegmentIndex,
        tripRatio: create.tripRatio,
        lineKey: nextLineKey,
        stationId: create.stationId,
        title: create.title,
        body: create.body,
        tags: create.tags,
        mediaUrl: create.mediaUrl,
        resetKey: current.resetKey + 1,
      }));
    };
    const handleMapPoint = (event: Event) => {
      const detail = customEventDetail<MileageEventsMapPointDetail>(event);
      if (typeof detail.lat !== "number" || typeof detail.lng !== "number") return;
      setMapPoint({ lat: detail.lat, lng: detail.lng });
      if (mode === "place") {
        setPlaceSource("map");
        return;
      }
      if (mode === "create") return;
      setMode("create");
    };
    window.addEventListener(mileageEventUiEvents.select, handleSelect);
    window.addEventListener(mileageEventUiEvents.open, handleOpen);
    window.addEventListener(mileageEventUiEvents.mapPoint, handleMapPoint);
    return () => {
      window.removeEventListener(mileageEventUiEvents.select, handleSelect);
      window.removeEventListener(mileageEventUiEvents.open, handleOpen);
      window.removeEventListener(mileageEventUiEvents.mapPoint, handleMapPoint);
    };
  }, [activeRailGraphSelection, lineKeys, mode, railwayData, setActiveRailGraphSelection, trips]);

  const lineEntries = useMemo<MileageEventListEntry[]>(() => {
    if (axisIsRailGraph) {
      return richEventEntries
        .filter(
          (entry) =>
            entry.lineContext.source === "rail_graph_runtime" &&
            (!activeRailGraphLineKey || entry.lineContext.lineKey === activeRailGraphLineKey),
        )
        .map((entry) => ({ bound: entry.bound, lineContext: entry.lineContext }));
    }
    return lineContext
      ? eventsForLine(mileageUserEvents, lineContext).map((bound) => ({ bound, lineContext }))
      : [];
  }, [activeRailGraphLineKey, axisIsRailGraph, lineContext, mileageUserEvents, richEventEntries]);
  const placeEntries = useMemo<MileageEventListEntry[]>(() => {
    if (axisIsRailGraph || !lineContext) return [];
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
  }, [axisIsRailGraph, effectiveStationId, lineContext, mapPoint, mileageUserEvents, placeSource, radiusMeters]);
  const timeEntries = useMemo<MileageEventListEntry[]>(() => {
    if (axisIsRailGraph || !lineContext) return [];
    return queryLineEventsByTime({
      events: mileageUserEvents,
      lineContext,
      fromTime: timeFrom,
      toTime: timeTo,
    }).items.map((bound) => ({ bound, lineContext }));
  }, [axisIsRailGraph, lineContext, mileageUserEvents, timeFrom, timeTo]);

  const selectedEvent = useMemo(
    () => mileageUserEvents.find((event) => event.id === selectedEventId) ?? null,
    [mileageUserEvents, selectedEventId],
  );
  const currentRailGraphAxis = useMemo(() => {
    if (!activeRailGraphLineKey) return null;
    const entries = richEventEntries.filter(
      (entry) =>
        entry.lineContext.source === "rail_graph_runtime" &&
        entry.lineContext.lineKey === activeRailGraphLineKey,
    );
    const lineContext = entries[0]?.lineContext;
    return {
      label:
        lineContext?.source === "rail_graph_runtime"
          ? lineContext.segment.lineLabel || lineLabel(activeRailGraphLineKey)
          : lineLabel(activeRailGraphLineKey),
      count: entries.length,
      color:
        lineContext?.source === "rail_graph_runtime"
          ? lineContext.segment.displayColor || "#059669"
          : "#059669",
    };
  }, [activeRailGraphLineKey, richEventEntries]);
  const currentAxisLabel =
    activeRailGraphSelection?.label ??
    currentRailGraphAxis?.label ??
    (effectiveLineKey ? lineLabel(effectiveLineKey) : t("mileageEvents.noLineLoaded", "No line loaded"));
  const currentAxisEventCount = currentRailGraphAxis?.count ?? lineEntries.length;
  const selectedLineColor = activeRailGraphSelection?.color ?? currentRailGraphAxis?.color ?? lineContext?.line.meta.color ?? "#0f766e";
  const currentAxisSource = activeRailGraphSelection?.source === "rail_graph_snapshot" || currentRailGraphAxis ? "rail_graph" : "legacy";
  const currentAxisSourceLabel = currentAxisSource === "rail_graph"
    ? t("mileageEvents.sourceRailGraph", "Rail graph snapshot")
    : t("mileageEvents.sourceLegacy", "GeoJSON axis");
  const currentAxisRoleLabel =
    activeRailGraphSelection?.kind === "route"
      ? t("mileageEvents.selectedRoute", "Selected route")
      : activeRailGraphSelection?.kind === "event"
        ? t("mileageEvents.selectedEvent", "Selected event")
        : t("mileageEvents.selectedAxis", "Selected axis");
  const currentAxisGeometryLabel =
    activeRailGraphSelection?.geometrySource === "saved_snapshot"
      ? t("mileageEvents.geometrySavedSnapshot", "Saved geometry")
      : activeRailGraphSelection?.geometrySource === "fallback"
        ? t("mileageEvents.geometryFallback", "Fallback geometry")
        : currentAxisSource === "rail_graph"
          ? t("mileageEvents.geometrySavedSnapshot", "Saved geometry")
          : t("mileageEvents.geometryGeoJson", "GeoJSON geometry");
  const activeTrip = useMemo(
    () => {
      const selectedTripId = selectedProjection?.tripId ?? activeRailGraphSelection?.tripId;
      return selectedTripId !== undefined
        ? trips.find((trip) => String(trip.id) === String(selectedTripId)) ?? null
        : null;
    },
    [activeRailGraphSelection?.tripId, selectedProjection?.tripId, trips],
  );
  const activeTripSegments = useMemo(
    () => (activeTrip ? tripToProductSegments(activeTrip, railwayData) : []),
    [activeTrip, railwayData],
  );
  const activeTripSegmentIndex =
    typeof selectedProjection?.tripSegmentIndex === "number"
      ? selectedProjection.tripSegmentIndex
      : typeof activeRailGraphSelection?.tripSegmentIndex === "number"
        ? activeRailGraphSelection.tripSegmentIndex
        : null;
  const activeTripSegment =
    activeTripSegmentIndex !== null && activeTripSegments.length > 0
      ? activeTripSegments[Math.max(0, Math.min(activeTripSegments.length - 1, activeTripSegmentIndex))]
      : null;

  useEffect(() => {
    if (!open) {
      setActiveMileageLine({ lineKey: null });
      clearActiveRailGraphSelection();
      return;
    }
    if (selectedProjection?.source === "rail_graph_runtime") {
      setActiveMileageLine({
        lineKey: selectedProjection.lineKey ?? null,
        source: selectedProjection.source,
        tripId: selectedProjection.tripId,
        tripSegmentIndex: selectedProjection.tripSegmentIndex,
        routeItemId: selectedProjection.routeItemId,
      });
      return;
    }
    setActiveMileageLine({
      lineKey: lineContext ? effectiveLineKey : null,
      source: selectedProjection?.source,
      tripId: selectedProjection?.tripId,
      tripSegmentIndex: selectedProjection?.tripSegmentIndex,
      routeItemId: selectedProjection?.routeItemId,
    });
  }, [clearActiveRailGraphSelection, effectiveLineKey, lineContext, open, selectedProjection]);

  const selectEvent = (eventId: string, entry?: MileageEventListEntry) => {
    const inheritedProjection = selectedProjection ?? projectionDetailFromRailGraphSelection(activeRailGraphSelection);
    const eventProjection = entry
      ? eventProjectionDetailFromPanelEntry({
          lineKey: entry.lineContext?.lineKey,
          source: entry.lineContext?.source,
          orderIndex: entry.bound.orderIndex,
        }, inheritedProjection)
      : lineContext
        ? { lineKey: effectiveLineKey, source: "legacy_app" as const }
        : inheritedProjection;
    setSelectedEventId(eventId);
    setSelectedProjection(eventProjection ?? null);
    selectMileageEventOnMap({
      eventId,
      lineKey: eventProjection?.lineKey,
      source: eventProjection?.source,
      tripId: eventProjection?.tripId,
      tripSegmentIndex: eventProjection?.tripSegmentIndex,
      routeItemId: eventProjection?.routeItemId,
    });
  };

  const selectComposerEvent = (event: UserEventV2) => {
    const inheritedProjection = selectedProjection ?? projectionDetailFromRailGraphSelection(activeRailGraphSelection);
    if (composerDraft.source === "trip" && inheritedProjection?.source === "rail_graph_runtime") {
      setSelectedEventId(event.id);
      selectMileageEventOnMap({
        eventId: event.id,
        lineKey: inheritedProjection.lineKey,
        source: inheritedProjection.source,
        tripId: inheritedProjection.tripId,
        tripSegmentIndex: inheritedProjection.tripSegmentIndex,
        routeItemId: inheritedProjection.routeItemId,
      });
      return;
    }
    selectEvent(event.id);
  };

  const focusEventOnMap = (entry: MileageEventListEntry) => {
    selectEvent(entry.bound.event.id, entry);
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

  const switchMode = (nextMode: MileageEventsPanelMode) => {
    if (nextMode === "create" && activeRailGraphSelection?.kind === "route") {
      const anchor = activeRailGraphSelection.anchor;
      if (typeof anchor?.lat === "number" && typeof anchor.lng === "number") {
        setMapPoint({ lat: anchor.lat, lng: anchor.lng });
      }
      setComposerDraft((current) => ({
        source: activeRailGraphSelection.source === "rail_graph_snapshot" && activeRailGraphSelection.tripId !== undefined
          ? "trip"
          : "map",
        tripId: activeRailGraphSelection.tripId,
        tripSegmentIndex: activeRailGraphSelection.tripSegmentIndex,
        tripRatio: anchor?.tripRatio,
        lineKey: activeRailGraphSelection.source === "legacy_geojson"
          ? activeRailGraphSelection.lineKey ?? undefined
          : undefined,
        tags: ["trip-event"],
        resetKey: current.resetKey + 1,
      }));
    }
    setMode(nextMode);
  };

  if (!open) {
    return (
      <button
        className="rl-map-control rl-focus absolute right-4 top-4 z-[520] flex items-center justify-center transition-all active:scale-95"
        onClick={() => setOpen(true)}
        title={t("mileageEvents.open", "Mileage events")}
        aria-label={t("mileageEvents.open", "Mileage events")}
      >
        <MapPinned size={22} />
      </button>
    );
  }

  return (
    <section className="rl-modal-panel absolute inset-x-2 bottom-3 z-[520] flex max-h-[82dvh] flex-col overflow-hidden backdrop-blur-xl md:inset-y-4 md:left-auto md:right-4 md:max-h-none md:w-[min(24rem,calc(100vw-2rem))]">
      <header className="rl-modal-header flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
              <MapPinned size={17} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{currentAxisLabel}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <span>{currentAxisRoleLabel}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{t("mileageEvents.title", "Mileage events")}</span>
              </div>
            </div>
          </div>
          <div className="mt-2 rounded-md border border-slate-200 bg-white/80 px-2 py-1.5 text-[11px] text-slate-600">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: selectedLineColor }} />
                <RailGraphBadge
                  icon={currentAxisSource === "rail_graph" ? "snapshot" : "legacy"}
                  value={currentAxisSourceLabel}
                  tone={currentAxisSource === "rail_graph" ? "emerald" : "slate"}
                  className="shrink-0 rounded bg-white"
                />
              </span>
              <RailGraphBadge
                icon="distance"
                value={currentAxisGeometryLabel}
                tone={currentAxisSource === "rail_graph" ? "emerald" : "slate"}
                className="rounded bg-white"
              />
              <RailGraphBadge
                icon="userEvent"
                value={t("mileageEvents.axisEventCount", "{{count}} on axis", { count: currentAxisEventCount })}
                tone="violet"
                className="rounded bg-white"
              />
            </div>
            {activeTripSegment && (
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 border-t border-slate-100 pt-1.5">
                <RailGraphBadge
                  icon="pattern"
                  value={activeTripSegment.lineLabel || lineLabel(activeTripSegment.lineKey)}
                  tone={activeTripSegment.source === "rail_graph" ? "indigo" : "slate"}
                  className="rounded bg-white"
                />
                <RailGraphRunBadges
                  meta={{
                    serviceType: activeTripSegment.serviceType,
                    direction: activeTripSegment.direction,
                    patternRef: activeTripSegment.patternRef,
                  }}
                />
                <RailGraphBadge
                  icon="distance"
                  value={formatKm(Math.max(0, activeTripSegment.distanceKm || 0) * 1000)}
                  tone="slate"
                  className="rounded bg-white"
                />
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-slate-500">
                  {activeTripSegment.fromName || t("mileageEvents.unknown", "Unknown")} → {activeTripSegment.toName || t("mileageEvents.unknown", "Unknown")}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="rl-close-button !w-8 !h-8"
            onClick={handleExport}
            title={t("mileageEvents.action.exportJson", "Export JSON")}
            aria-label={t("mileageEvents.action.exportJson", "Export JSON")}
          >
            <Download size={16} />
          </button>
          <button
            className="rl-close-button !w-8 !h-8"
            onClick={() => fileInputRef.current?.click()}
            title={t("mileageEvents.action.importJson", "Import JSON")}
            aria-label={t("mileageEvents.action.importJson", "Import JSON")}
          >
            <Upload size={16} />
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button
            className="rl-close-button !w-8 !h-8"
            onClick={() => setOpen(false)}
            title={t("common.close", "Close")}
            aria-label={t("common.close", "Close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-slate-200/80 bg-slate-50/80 p-2">
            <div className="rl-segmented grid grid-cols-4 gap-1">
              {[
                ["line", LocateFixed, t("mileageEvents.timeline", "Line")] as const,
                ["place", Search, t("mileageEvents.place", "Place")] as const,
                ["time", Clock, t("mileageEvents.time", "Time")] as const,
                ["create", Plus, t("mileageEvents.create", "Create")] as const,
              ].map(([key, Icon, label]) => {
                const disabled = axisIsRailGraph && (key === "place" || key === "time");
                return (
                  <button
                    key={key}
                    onClick={() => {
                      if (!disabled) switchMode(key);
                    }}
                    disabled={disabled}
                    title={disabled ? t("mileageEvents.snapshotAxisSearchHint", "Place and time search use GeoJSON mileage axes; snapshot route events stay on the selected route.") : undefined}
                    className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      mode === key
                        ? "bg-white text-teal-700 shadow-sm"
                        : "text-slate-500 hover:bg-white/60 hover:text-slate-800 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                    }`}
                  >
                    <Icon size={14} />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {selectedEvent ? (
            <EventInspector
              event={selectedEvent}
              onClose={() => {
                setSelectedEventId(null);
                setSelectedProjection(null);
              }}
              onDeleted={() => {
                setSelectedEventId(null);
                setSelectedProjection(null);
              }}
            />
          ) : !axisIsRailGraph && lineKeys.length === 0 ? (
            <div className="rl-card-muted p-3 text-xs text-slate-500">
              {t("mileageEvents.noLineData", "Load GeoJSON line data before creating mileage events. Saved rail-graph trip events will appear when their snapshot can be projected.")}
            </div>
          ) : (
            <>
              {mode !== "create" && (
                <div className="mb-3 space-y-2 rl-card-muted p-3">
                  {axisIsRailGraph ? (
                    <div className="rounded-md border border-emerald-100 bg-white px-2 py-1.5 text-xs text-slate-600">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <RailGraphBadge
                          icon="snapshot"
                          value={t("mileageEvents.sourceRailGraph", "Rail graph snapshot")}
                          tone="emerald"
                          className="rounded bg-white"
                        />
                        <span className="truncate font-semibold">{currentAxisLabel}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        {t("mileageEvents.snapshotAxisSearchHint", "Place and time search use GeoJSON mileage axes; snapshot route events stay on the selected route.")}
                      </div>
                    </div>
                  ) : (
                    <label className="block text-xs font-medium text-slate-600">
                      {t("mileageEvents.line", "Line")}
                      <select
                        className="rl-input mt-1"
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
                  )}

                  {mode === "place" && (
                    <div className="space-y-2">
                      <div className="rl-segmented grid grid-cols-2 gap-1">
                        {[
                          ["station", Search, t("mileageEvents.createSource.station", "Station")] as const,
                          ["map", MapPinned, t("mileageEvents.createSource.map", "Map")] as const,
                        ].map(([key, Icon, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setPlaceSource(key)}
                            className={`flex min-w-0 items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold transition ${
                              placeSource === key ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
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
                              className="rl-input mt-1"
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
                              className="rl-secondary-action mt-2 w-full px-2 py-1.5 text-[11px] font-semibold"
                              onClick={requestMileageEventsMapCenter}
                            >
                              {t("mileageEvents.useMapCenter", "Use map center")}
                            </button>
                          </div>
                        )}
                        <label className="block text-xs font-medium text-slate-600">
                          {t("mileageEvents.radius", "Radius")}
                          <select
                            className="rl-input mt-1"
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
                          className="rl-input mt-1"
                          value={timeFrom}
                          onChange={(event) => setTimeFrom(event.target.value)}
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-600">
                        {t("mileageEvents.toTime", "To")}
                        <input
                          className="rl-input mt-1"
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
                  showSource={false}
                  showTimestamp={false}
                  showVisibility={false}
                  selectedId={selectedEventId}
                  onSelect={(entry) => selectEvent(entry.bound.event.id, entry)}
                  onViewMap={focusEventOnMap}
                />
              )}
              {mode === "place" && (
                <EventList
                  entries={placeEntries}
                  selectedId={selectedEventId}
                  emptyLabel={t("mileageEvents.emptyPlace", "No events near this place")}
                  showSource={false}
                  showTimestamp={false}
                  showVisibility={false}
                  onSelect={(entry) => selectEvent(entry.bound.event.id, entry)}
                  onViewMap={focusEventOnMap}
                />
              )}
              {mode === "time" && (
                <EventList
                  entries={timeEntries}
                  selectedId={selectedEventId}
                  emptyLabel={t("mileageEvents.emptyTime", "No events in this time window")}
                  showSource={false}
                  showTimestamp
                  showVisibility={false}
                  onSelect={(entry) => selectEvent(entry.bound.event.id, entry)}
                  onViewMap={focusEventOnMap}
                />
              )}
              {mode === "create" && (
                <div className="space-y-3">
                  <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-xs text-slate-600">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <RailGraphBadge
                        icon="userEvent"
                        value={t("mileageEvents.action.create", "Create event")}
                        tone="violet"
                        className="rounded bg-white"
                      />
                      <RailGraphBadge
                        icon={currentAxisSource === "rail_graph" ? "snapshot" : "legacy"}
                        value={currentAxisSourceLabel}
                        tone={currentAxisSource === "rail_graph" ? "emerald" : "slate"}
                        className="rounded bg-white"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">
                        {currentAxisLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {currentAxisRoleLabel} · {currentAxisGeometryLabel}
                    </div>
                  </div>
                  <div className="rl-card p-3 shadow-sm">
                    <EventComposer
                      defaultLineKey={composerDraft.lineKey || effectiveLineKey}
                      defaultStationId={composerDraft.stationId || effectiveStationId}
                      defaultTripId={composerDraft.tripId}
                      defaultTripSegmentIndex={composerDraft.tripSegmentIndex}
                      defaultTripRatio={composerDraft.tripRatio}
                      defaultSource={composerDraft.source || (mapPoint ? "map" : "station")}
                      defaultTitle={composerDraft.title}
                      defaultBody={composerDraft.body}
                      defaultTags={composerDraft.tags}
                      defaultMediaUrl={composerDraft.mediaUrl}
                      resetKey={composerDraft.resetKey}
                      mapPoint={mapPoint}
                      onSaved={selectComposerEvent}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};
