import React, { useMemo, useState } from "react";
import {
  Copy,
  Download,
  Edit2,
  Eye,
  FileJson,
  Link2Off,
  MapPinned,
  Route,
  Share2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import {
  boundMileageEventForDisplay,
  formatKm,
  lineLabel,
  mileageEventProjectionStatus,
  updateMileageEventFromDraft,
} from "../../utils/mileageUserEvents";
import {
  eventKindLabel,
  eventLineLabel,
  eventMileageLabel,
  eventStationLabel,
  eventVisibilityLabel,
  timestampLabel,
} from "./display";
import { EventComposer } from "./EventComposer";
import { useMileageEventActions } from "./useMileageEventActions";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { showConfirm } from "../../utils/alerts";

interface Props {
  event: UserEventV2 | null;
  onClose?: () => void;
  onDeleted?: () => void;
}

export const EventInspector: React.FC<Props> = ({ event, onClose, onDeleted }) => {
  const { t } = useTranslation();
  const { goToTab } = useAppNavigation();
  const { railwayData, trips } = useStore(
    useShallow((state) => ({
      railwayData: state.railwayData,
      trips: state.trips,
    }))
  );
  const { removeEvent, updateEvent } = useMileageEventActions();
  const [editing, setEditing] = useState(false);

  const projected = useMemo(
    () => (event ? boundMileageEventForDisplay(event, railwayData) : null),
    [event, railwayData],
  );
  const projectionStatus = useMemo(
    () => (event ? mileageEventProjectionStatus(event, railwayData) : null),
    [event, railwayData],
  );

  if (!event) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
        {t("mileageEvents.inspector.empty", "Select an event to inspect")}
      </div>
    );
  }

  const bound = projected?.bound ?? null;
  const lineContext = projected?.lineContext ?? null;
  const lineName = eventLineLabel(bound, lineContext) || (projectionStatus?.lineKey ? lineLabel(projectionStatus.lineKey) : "");
  const trip = trips.find((candidate) => String(candidate.id) === String(event.payload?.tripId));
  const mediaUrl = typeof event.payload?.mediaUrl === "string" ? event.payload.mediaUrl : "";
  const createdFrom = typeof event.payload?.createdFrom === "string" ? event.payload.createdFrom : "";

  const deleteEvent = async () => {
    const confirmed = await showConfirm(
      t("mileageEvents.action.delete", "Delete"),
      t("mileageEvents.deleteConfirm", "Delete this mileage event?"),
    );
    if (!confirmed) return;
    removeEvent(event.id);
    onDeleted?.();
    onClose?.();
  };

  const openInMap = () => {
    goToTab("map");
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("mileage-event:select", {
          detail: { eventId: event.id },
        }),
      );
      if (!bound?.coordinates) return;
      window.dispatchEvent(
        new CustomEvent("map:fly-to-location", {
          detail: { lat: bound.coordinates[1], lng: bound.coordinates[0], zoom: 15 },
        }),
      );
    }, 150);
  };

  const openInRecords = () => {
    goToTab("records");
    if (event.payload?.tripId) {
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("records:mileage-event:select", {
            detail: { eventId: event.id, tripId: event.payload?.tripId },
          }),
        );
        document.getElementById(`trip-${event.payload?.tripId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 150);
    }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#event-${encodeURIComponent(event.id)}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(event, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(event.id).replace(/[^a-zA-Z0-9_-]+/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 0);
  };

  const cycleVisibility = () => {
    const next = event.visibility === "private" ? "shared" : event.visibility === "shared" ? "public" : "private";
    updateEvent(updateMileageEventFromDraft(event, { visibility: next }));
  };

  const unlinkTrip = () => {
    updateEvent(updateMileageEventFromDraft(event, { tripId: "" }));
  };

  if (editing) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">
            {t("mileageEvents.inspector.edit", "Edit event")}
          </div>
          <button
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={() => setEditing(false)}
            title={t("common.close", "Close")}
          >
            <X size={16} />
          </button>
        </div>
        <EventComposer
          event={event}
          compact
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              {eventKindLabel(event.kind, t)}
            </span>
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              {eventVisibilityLabel(event.visibility, t)}
            </span>
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">{event.title}</h3>
        </div>
        {onClose && (
          <button
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            title={t("common.close", "Close")}
          >
            <X size={16} />
          </button>
        )}
      </header>

      <div className="space-y-3 p-3">
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <InfoTerm label={t("mileageEvents.inspector.mileage", "Mileage")} value={bound ? eventMileageLabel(bound) : formatKm(event.mileage.distanceMeters)} />
          <InfoTerm label={t("mileageEvents.inspector.station", "Nearby station")} value={eventStationLabel(bound, lineContext) || t("mileageEvents.unknown", "Unknown")} />
          <InfoTerm label={t("mileageEvents.inspector.line", "Line")} value={lineName || t("mileageEvents.unknown", "Unknown")} />
          <InfoTerm label={t("mileageEvents.inspector.time", "Time")} value={timestampLabel(bound?.timestampInference, bound?.timestamp, t)} />
        </dl>

        {projectionStatus && projectionStatus.code !== "projected" && (
          <ProjectionStatusNotice status={projectionStatus} />
        )}

        {event.body && <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs leading-relaxed text-slate-700">{event.body}</p>}

        {event.tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {event.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                <Tag size={10} />
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-amber-100 bg-amber-50 p-2 text-xs text-amber-700">
            {t("mileageEvents.quality.noTags", "No tags yet")}
          </div>
        )}

        <dl className="space-y-1 text-xs text-slate-600">
          <InfoRow label={t("mileageEvents.linkedTrip", "Linked trip")} value={trip ? `${trip.date} · ${String(trip.id)}` : t("mileageEvents.noLinkedTrip", "No linked trip")} />
          {createdFrom && <InfoRow label={t("mileageEvents.inspector.source", "Source")} value={t(`mileageEvents.source.${createdFrom}`, createdFrom)} />}
          {mediaUrl && (
            <InfoRow
              label={t("mileageEvents.inspector.media", "Media")}
              value={
                <a href={mediaUrl} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                  {mediaUrl}
                </a>
              }
            />
          )}
          <InfoRow label={t("mileageEvents.inspector.createdAt", "Created")} value={event.createdAt?.slice(0, 16).replace("T", " ") || "-"} />
          <InfoRow label={t("mileageEvents.inspector.updatedAt", "Updated")} value={event.updatedAt?.slice(0, 16).replace("T", " ") || "-"} />
        </dl>

        {import.meta.env.DEV && projectionStatus?.diagnostics.length ? (
          <details className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold">{t("mileageEvents.inspector.diagnostics", "Diagnostics")}</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px]">
              {JSON.stringify(projectionStatus.diagnostics, null, 2)}
            </pre>
          </details>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <ActionButton icon={<Edit2 size={14} />} label={t("mileageEvents.action.edit", "Edit")} onClick={() => setEditing(true)} />
          <ActionButton icon={<Trash2 size={14} />} label={t("mileageEvents.action.delete", "Delete")} onClick={deleteEvent} danger />
          <ActionButton icon={<MapPinned size={14} />} label={t("mileageEvents.action.viewMap", "View map")} onClick={openInMap} />
          <ActionButton icon={<Route size={14} />} label={t("mileageEvents.action.viewRecords", "View records")} onClick={openInRecords} />
          <ActionButton icon={<Copy size={14} />} label={t("mileageEvents.action.copyLink", "Copy link")} onClick={copyLink} />
          <ActionButton icon={<FileJson size={14} />} label={t("mileageEvents.action.exportJson", "Export JSON")} onClick={exportJson} />
          <ActionButton icon={event.visibility === "private" ? <Share2 size={14} /> : <Eye size={14} />} label={t("mileageEvents.action.toggleVisibility", "Toggle visibility")} onClick={cycleVisibility} />
          <ActionButton icon={<Link2Off size={14} />} label={t("mileageEvents.action.unlinkTrip", "Unlink trip")} onClick={unlinkTrip} disabled={!event.payload?.tripId} />
        </div>
      </div>
    </section>
  );
};

const ProjectionStatusNotice: React.FC<{
  status: ReturnType<typeof mileageEventProjectionStatus>;
}> = ({ status }) => {
  const { t } = useTranslation();
  const distance = formatKm(status.distanceMeters);
  const range = status.totalMeters !== undefined ? `0.0 km - ${formatKm(status.totalMeters)}` : "";
  const line = status.lineKey ? lineLabel(status.lineKey) : t("mileageEvents.unknown", "Unknown");
  const tone =
    status.state === "failed"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-sky-200 bg-sky-50 text-sky-800";
  const title =
    status.state === "failed"
      ? t("mileageEvents.projection.failedTitle", "Projection needs attention")
      : t("mileageEvents.projection.warningTitle", "Projection warning");

  const detail = (() => {
    if (status.code === "linear_time") {
      return t("mileageEvents.projection.linearTime", "No timetable is bound, so the event time is estimated from mileage.");
    }
    if (status.code === "unknown_time") {
      return t("mileageEvents.projection.unknownTime", "No timetable or fallback time range is available for this event.");
    }
    if (status.code === "missing_line") {
      return t("mileageEvents.projection.missingLine", "The saved line cannot be found in current railway data.");
    }
    if (status.code === "missing_line_data") {
      return t("mileageEvents.projection.missingLineData", "The saved line has no usable stations or mileage data.");
    }
    if (status.code === "unsupported_scope") {
      return t("mileageEvents.projection.unsupportedScope", "The event mileage belongs to a system or pattern that is not loaded here.");
    }
    if (status.code === "out_of_range") {
      return t(
        "mileageEvents.projection.outOfRange",
        "The saved mileage {{distance}} is outside the loaded line range {{range}}.",
        { distance, range },
      );
    }
    return t("mileageEvents.projection.unresolved", "The event mileage could not be matched to the selected run path.");
  })();

  return (
    <div className={`rounded-md border p-2 text-xs ${tone}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-0.5 leading-relaxed">{detail}</div>
      <div className="mt-1 text-[11px] opacity-80">
        {t("mileageEvents.projection.context", "Line {{line}} · mileage {{distance}}", {
          line,
          distance,
        })}
      </div>
    </div>
  );
};

const InfoTerm: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-md bg-slate-50 p-2">
    <dt className="text-[10px] font-semibold uppercase text-slate-400">{label}</dt>
    <dd className="mt-0.5 truncate font-medium text-slate-700">{value}</dd>
  </div>
);

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3">
    <dt className="shrink-0 text-slate-400">{label}</dt>
    <dd className="min-w-0 text-right text-slate-700">{value}</dd>
  </div>
);

const ActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}> = ({ icon, label, onClick, danger, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
      danger
        ? "border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
    }`}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
);
