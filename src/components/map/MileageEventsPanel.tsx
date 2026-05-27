import React, { useMemo, useState } from "react";
import {
  Clock,
  LocateFixed,
  MapPinned,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";
import { useUserData } from "../../hooks/useUserData";
import {
  buildAppMileageLineContext,
  createMileageEventAtDistance,
  createMileageEventFromStation,
  eventsForLine,
  queryLineEventsByStation,
  queryLineEventsByTime,
} from "../../utils/mileageUserEvents";

export const MileageEventsPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    railwayData,
    user,
    trips,
    pins,
    folders,
    badgeSettings,
    mileageUserEvents,
    addMileageUserEvent,
    removeMileageUserEvent,
  } = useStore((state) => ({
    railwayData: state.railwayData,
    user: state.user,
    trips: state.trips,
    pins: state.pins,
    folders: state.folders,
    badgeSettings: state.badgeSettings,
    mileageUserEvents: state.mileageUserEvents,
    addMileageUserEvent: state.addMileageUserEvent,
    removeMileageUserEvent: state.removeMileageUserEvent,
  }));
  const { saveData } = useUserData();

  const lineKeys = useMemo(() => Object.keys(railwayData).sort(), [railwayData]);
  const [open, setOpen] = useState(false);
  const [lineKey, setLineKey] = useState("");
  const [stationId, setStationId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [distanceKm, setDistanceKm] = useState("0");
  const [timeFrom, setTimeFrom] = useState("08:00");
  const [timeTo, setTimeTo] = useState("09:00");
  const [mode, setMode] = useState<"timeline" | "place" | "time">("timeline");

  const effectiveLineKey = lineKey || lineKeys[0] || "";
  const lineContext = useMemo(
    () => effectiveLineKey ? buildAppMileageLineContext(railwayData, effectiveLineKey) : null,
    [railwayData, effectiveLineKey],
  );
  const stations = lineContext?.line.stations ?? [];
  const effectiveStationId = stationId || stations[0]?.id || "";

  const timelineEvents = useMemo(
    () => lineContext ? eventsForLine(mileageUserEvents, lineContext) : [],
    [lineContext, mileageUserEvents],
  );
  const placeEvents = useMemo(() => {
    if (!lineContext || !effectiveStationId) return [];
    return queryLineEventsByStation({
      events: mileageUserEvents,
      lineContext,
      stationId: effectiveStationId,
      radiusMeters: 1000,
    }).items;
  }, [effectiveStationId, lineContext, mileageUserEvents]);
  const timeEvents = useMemo(() => {
    if (!lineContext) return [];
    return queryLineEventsByTime({
      events: mileageUserEvents,
      lineContext,
      fromTime: timeFrom,
      toTime: timeTo,
    }).items;
  }, [lineContext, mileageUserEvents, timeFrom, timeTo]);

  const visibleEvents = mode === "place" ? placeEvents : mode === "time" ? timeEvents : timelineEvents;

  const createFromStation = () => {
    if (!lineContext || !effectiveStationId) return;
    const event = createMileageEventFromStation({
      lineContext,
      stationId: effectiveStationId,
      title: title || t("mileageEvents.defaultTitle", "Mileage event"),
      body,
    });
    if (!event) return;
    addMileageUserEvent(event);
    syncEvents([...mileageUserEvents, event]);
    setTitle("");
    setBody("");
  };

  const createFromMileage = () => {
    if (!lineContext) return;
    const event = createMileageEventAtDistance({
      lineContext,
      distanceMeters: Math.max(0, Number(distanceKm || 0) * 1000),
      title: title || t("mileageEvents.defaultTitle", "Mileage event"),
      body,
    });
    addMileageUserEvent(event);
    syncEvents([...mileageUserEvents, event]);
    setTitle("");
    setBody("");
  };

  const removeEvent = (id: string) => {
    const next = mileageUserEvents.filter((event) => event.id !== id);
    removeMileageUserEvent(id);
    syncEvents(next);
  };

  const syncEvents = (nextEvents: typeof mileageUserEvents) => {
    if (!user?.token) return;
    saveData(user.token, trips, pins, folders, badgeSettings, nextEvents)
      .catch((error) => console.error("Mileage event sync failed", error));
  };

  if (!open) {
    return (
      <button
        className="absolute right-4 top-4 z-[410] flex h-11 w-11 items-center justify-center rounded-lg bg-white text-slate-700 shadow-lg transition hover:bg-emerald-50 hover:text-emerald-700"
        onClick={() => setOpen(true)}
        title={t("mileageEvents.open", "Mileage events")}
      >
        <MapPinned size={22} />
      </button>
    );
  }

  return (
    <section className="absolute right-4 top-4 z-[410] flex max-h-[calc(100dvh-8rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MapPinned size={17} className="text-emerald-600" />
          {t("mileageEvents.title", "Mileage events")}
        </div>
        <button
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          onClick={() => setOpen(false)}
          title={t("common.close", "关闭")}
        >
          <X size={17} />
        </button>
      </header>

      <div className="flex gap-1 border-b border-slate-200 px-2 py-2">
        {[
          ["timeline", LocateFixed, t("mileageEvents.timeline", "沿线")] as const,
          ["place", Search, t("mileageEvents.place", "地点")] as const,
          ["time", Clock, t("mileageEvents.time", "时间")] as const,
        ].map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
              mode === key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2 border-b border-slate-200 p-3">
        <label className="block text-xs font-medium text-slate-600">
          {t("mileageEvents.line", "线路")}
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={effectiveLineKey}
            onChange={(event) => {
              setLineKey(event.target.value);
              setStationId("");
            }}
          >
            {lineKeys.map((key) => (
              <option key={key} value={key}>{lineLabel(key)}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.station", "车站")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={effectiveStationId}
              onChange={(event) => setStationId(event.target.value)}
            >
              {stations.map((station) => (
                <option key={station.id} value={station.id}>{station.name_ja}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.distanceKm", "里程 km")}
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={distanceKm}
              inputMode="decimal"
              onChange={(event) => setDistanceKm(event.target.value)}
            />
          </label>
        </div>

        {mode === "time" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.fromTime", "开始")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={timeFrom}
                onChange={(event) => setTimeFrom(event.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {t("mileageEvents.toTime", "结束")}
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={timeTo}
                onChange={(event) => setTimeTo(event.target.value)}
              />
            </label>
          </div>
        )}

        <input
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder={t("mileageEvents.titlePlaceholder", "标题")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="min-h-16 w-full resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder={t("mileageEvents.bodyPlaceholder", "备注")}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            className="flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
            onClick={createFromStation}
            disabled={!lineContext || !effectiveStationId}
          >
            <Plus size={14} />
            {t("mileageEvents.addAtStation", "按地点添加")}
          </button>
          <button
            className="flex items-center justify-center gap-1 rounded-md bg-slate-800 px-2 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:bg-slate-300"
            onClick={createFromMileage}
            disabled={!lineContext}
          >
            <Plus size={14} />
            {t("mileageEvents.addAtMileage", "按里程添加")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visibleEvents.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
            {t("mileageEvents.empty", "没有匹配的里程事件")}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleEvents.map((entry) => (
              <article key={`${entry.event.id}:${entry.distanceMetersFromRunStart}`} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{entry.event.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {formatKm(entry.distanceMetersFromRunStart)} · {timestampLabel(entry.timestampInference, entry.timestamp, t)}
                    </div>
                  </div>
                  <button
                    className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeEvent(entry.event.id)}
                    title={t("common.deleteConfirm", "确认删除?")}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {entry.event.body && <p className="mt-1 text-xs text-slate-600">{entry.event.body}</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

function lineLabel(lineKey: string): string {
  return lineKey.includes(":") ? lineKey.split(":").slice(1).join(":") : lineKey;
}

function formatKm(meters: number): string {
  return `${(Math.max(0, meters) / 1000).toFixed(1)} km`;
}

function timestampLabel(inference: string, timestamp: string | undefined, t: (key: string, fallback: string) => string): string {
  if (!timestamp) return t("mileageEvents.timeUnknown", "时间未绑定");
  const hhmm = timestamp.slice(11, 16);
  if (inference === "linear") return `${hhmm} ${t("mileageEvents.linear", "估算")}`;
  if (inference === "timeline") return `${hhmm}`;
  return t("mileageEvents.timeUnknown", "时间未绑定");
}
