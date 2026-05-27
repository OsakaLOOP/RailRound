import type {
  BoundMileageEvent,
  MileageTimestampInference,
  MileageUserEventKind,
  MileageUserEventVisibility,
} from "../../rail-graph-v1/mileage-event.types";
import type { AppMileageLineContext } from "../../utils/mileageUserEvents";
import {
  findLineKeyForMileageEvent,
  formatKm,
  lineLabel,
  stationNameForBoundEvent,
} from "../../utils/mileageUserEvents";

export const mileageEventKinds: MileageUserEventKind[] = [
  "user_note",
  "scenic",
  "warning",
  "operation_hint",
  "custom",
];

export const mileageEventVisibilities: MileageUserEventVisibility[] = [
  "private",
  "shared",
  "public",
];

export function eventKindLabel(kind: MileageUserEventKind, t: (key: string, fallback: string) => string): string {
  const fallback: Record<MileageUserEventKind, string> = {
    user_note: "Note",
    scenic: "Scenic",
    warning: "Reminder",
    operation_hint: "Operation",
    custom: "Custom",
  };
  return t(`mileageEvents.kind.${kind}`, fallback[kind] ?? kind);
}

export function eventVisibilityLabel(
  visibility: MileageUserEventVisibility,
  t: (key: string, fallback: string) => string,
): string {
  const fallback: Record<MileageUserEventVisibility, string> = {
    private: "Private",
    shared: "Shared",
    public: "Public",
  };
  return t(`mileageEvents.visibility.${visibility}`, fallback[visibility] ?? visibility);
}

export function timestampLabel(
  inference: MileageTimestampInference | undefined,
  timestamp: string | undefined,
  t: (key: string, fallback: string) => string,
): string {
  if (!timestamp) return t("mileageEvents.timeUnknown", "No time bound");
  const hhmm = timestamp.slice(11, 16);
  if (inference === "linear") return `${hhmm} ${t("mileageEvents.linear", "estimated")}`;
  if (inference === "timeline") return hhmm;
  return t("mileageEvents.timeUnknown", "No time bound");
}

export function eventLineLabel(bound: BoundMileageEvent | null | undefined, lineContext: AppMileageLineContext | null | undefined): string {
  const lineKey = lineContext?.lineKey ?? (bound ? findLineKeyForMileageEvent(bound.event) : null);
  return lineKey ? lineLabel(lineKey) : "";
}

export function eventStationLabel(bound: BoundMileageEvent | null | undefined, lineContext: AppMileageLineContext | null | undefined): string {
  if (!bound || !lineContext) return "";
  return stationNameForBoundEvent(bound, lineContext) ?? "";
}

export function eventMileageLabel(bound: BoundMileageEvent | null | undefined): string {
  if (!bound) return "";
  return formatKm(bound.event.mileage.distanceMeters);
}

export function eventKindTone(kind: MileageUserEventKind): string {
  if (kind === "scenic") return "bg-sky-50 text-sky-700 border-sky-100";
  if (kind === "warning") return "bg-amber-50 text-amber-700 border-amber-100";
  if (kind === "operation_hint") return "bg-violet-50 text-violet-700 border-violet-100";
  if (kind === "custom") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-100";
}
