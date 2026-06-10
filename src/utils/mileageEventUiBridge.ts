import type { MileageLineContextLike } from "./mileageUserEvents";

export type MileageEventsPanelMode = "line" | "place" | "time" | "create";
export type MileageEventsPlaceSource = "station" | "map";
export type MileageEventsComposerSource = "station" | "map" | "mileage" | "trip";
export type MileageEventsProjectionSource = MileageLineContextLike["source"] | "rail_graph_runtime";

export interface MileageEventsOpenDetail {
  mode?: MileageEventsPanelMode;
  lineKey?: string;
  source?: MileageEventsProjectionSource;
  eventId?: string;
  tripId?: string | number;
  tripSegmentIndex?: number;
  routeItemId?: string;
  create?: {
    source?: MileageEventsComposerSource;
    tripId?: string | number;
    tripSegmentIndex?: number;
    tripRatio?: number;
    lineKey?: string;
    stationId?: string;
    mapPoint?: { lat: number; lng: number };
    title?: string;
    body?: string;
    tags?: string[];
    mediaUrl?: string;
  };
}

export interface MileageEventSelectDetail {
  eventId: string;
  lineKey?: string;
  source?: MileageEventsProjectionSource;
  tripId?: string | number;
  tripSegmentIndex?: number;
  routeItemId?: string;
}

export interface MileageEventsActiveAxisDetail {
  lineKey: string | null;
  source?: MileageEventsProjectionSource;
  tripId?: string | number;
  tripSegmentIndex?: number;
  routeItemId?: string;
}

export interface MileageEventsMapPointDetail {
  lat: number;
  lng: number;
}

export const mileageEventUiEvents = {
  open: "mileage-events:open",
  select: "mileage-event:select",
  mapPoint: "mileage-events:map-point",
  requestMapCenter: "mileage-events:request-map-center",
} as const;

export function customEventDetail<T>(event: Event): Partial<T> {
  return ((event as CustomEvent<T>).detail ?? {}) as Partial<T>;
}

export function mileageEventTripId(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

export function openMileageEventsPanel(detail: MileageEventsOpenDetail) {
  window.dispatchEvent(new CustomEvent(mileageEventUiEvents.open, { detail }));
}

export function selectMileageEventOnMap(detail: MileageEventSelectDetail) {
  window.dispatchEvent(new CustomEvent(mileageEventUiEvents.select, { detail }));
}

export function setMileageEventsMapPoint(detail: MileageEventsMapPointDetail) {
  window.dispatchEvent(new CustomEvent(mileageEventUiEvents.mapPoint, { detail }));
}

export function requestMileageEventsMapCenter() {
  window.dispatchEvent(new CustomEvent(mileageEventUiEvents.requestMapCenter));
}
