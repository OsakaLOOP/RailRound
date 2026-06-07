import type { RailGraphActiveSelection } from "../store";
import {
  lineLabel,
  type MileageLineContextLike,
} from "./mileageUserEvents";
import type {
  MileageEventSelectDetail,
  MileageEventsActiveAxisDetail,
  MileageEventsOpenDetail,
  MileageEventsProjectionSource,
} from "./mileageEventUiBridge";
import type { ProductTripSegment } from "./tripProductProjection";

export type RailGraphSelectionDraft = Omit<RailGraphActiveSelection, "updatedAt">;

export type MileageEventsProjectionDetail = Omit<MileageEventSelectDetail, "eventId">;

type ProductSelectionSegment = Pick<
  ProductTripSegment,
  "id" | "lineKey" | "lineLabel" | "displayColor" | "source" | "patternRef" | "direction" | "serviceType"
>;

export interface ProductSegmentSelectionInput {
  kind?: RailGraphSelectionDraft["kind"];
  source?: RailGraphSelectionDraft["source"];
  segment?: ProductSelectionSegment | null;
  lineContext?: MileageLineContextLike | null;
  tripId?: RailGraphSelectionDraft["tripId"];
  tripSegmentIndex?: number;
  routeItemId?: string;
  eventId?: string;
  lineKey?: string | null;
  label?: string;
  color?: string;
  patternRef?: string;
  direction?: string;
  serviceType?: string;
  geometrySource?: RailGraphSelectionDraft["geometrySource"];
}

export function productSegmentSelectionLineKey(segment?: ProductSelectionSegment | null): string | undefined {
  if (!segment) return undefined;
  if (segment.source === "rail_graph") {
    return `rail-graph:${String(segment.patternRef ?? segment.id)}`;
  }
  return segment.lineKey || undefined;
}

function lineContextLabel(lineContext?: MileageLineContextLike | null): string | undefined {
  if (!lineContext) return undefined;
  if (lineContext.source === "rail_graph_runtime") {
    return lineContext.segment.lineLabel || lineLabel(lineContext.lineKey);
  }
  return lineLabel(lineContext.lineKey);
}

function lineContextColor(lineContext?: MileageLineContextLike | null): string | undefined {
  if (!lineContext) return undefined;
  if (lineContext.source === "rail_graph_runtime") return lineContext.segment.displayColor || undefined;
  return lineContext.line.meta.color || undefined;
}

export function selectionFromProductSegment(
  input: ProductSegmentSelectionInput,
  extras: Partial<RailGraphSelectionDraft> = {},
): RailGraphSelectionDraft | null {
  const segment = input.segment ?? null;
  const lineContext = input.lineContext ?? null;
  const lineKey = input.lineKey ?? lineContext?.lineKey ?? productSegmentSelectionLineKey(segment) ?? null;
  const tripSegmentIndex = input.tripSegmentIndex ?? (
    lineContext?.source === "rail_graph_runtime" ? lineContext.segmentIndex : undefined
  );

  if (!segment && !lineContext && !lineKey && input.tripId === undefined && !input.routeItemId && !input.eventId) return null;

  const source: RailGraphSelectionDraft["source"] = input.source ?? (
    lineContext?.source === "rail_graph_runtime" || segment?.source === "rail_graph" || lineKey?.startsWith("rail-graph:")
      ? "rail_graph_snapshot"
      : "legacy_geojson"
  );
  const contextPatternRef = lineContext?.source === "rail_graph_runtime"
    ? lineContext.segment.mileageProfile.patternRef
    : undefined;
  const contextDirection = lineContext?.source === "rail_graph_runtime"
    ? lineContext.segment.mileageProfile.direction
    : undefined;
  const contextServiceType = lineContext?.source === "rail_graph_runtime"
    ? lineContext.segment.mileageProfile.serviceType
    : undefined;

  return {
    kind: input.kind ?? (input.eventId ? "event" : "route"),
    source,
    lineKey,
    tripId: input.tripId,
    tripSegmentIndex,
    routeItemId: input.routeItemId ?? segment?.id,
    eventId: input.eventId,
    label: input.label ?? segment?.lineLabel ?? lineContextLabel(lineContext) ?? (lineKey ? lineLabel(lineKey) : undefined),
    color: input.color ?? segment?.displayColor ?? lineContextColor(lineContext),
    patternRef: input.patternRef ?? (segment?.patternRef ? String(segment.patternRef) : undefined) ?? (
      contextPatternRef ? String(contextPatternRef) : undefined
    ),
    direction: input.direction ?? segment?.direction ?? contextDirection,
    serviceType: input.serviceType ?? segment?.serviceType ?? contextServiceType,
    geometrySource: input.geometrySource ?? (source === "rail_graph_snapshot" ? "saved_snapshot" : "geojson"),
    ...extras,
  };
}

export function railGraphSelectionSourceFromProjection(
  source?: MileageEventsProjectionSource,
): RailGraphSelectionDraft["source"] {
  return source === "rail_graph_runtime" ? "rail_graph_snapshot" : "legacy_geojson";
}

export function projectionSourceFromRailGraphSelection(
  source?: RailGraphActiveSelection["source"],
): MileageEventsProjectionSource {
  return source === "rail_graph_snapshot" ? "rail_graph_runtime" : "legacy_app";
}

export function activeAxisFromRailGraphSelection(
  selection: RailGraphActiveSelection | RailGraphSelectionDraft,
): MileageEventsActiveAxisDetail {
  return {
    lineKey: selection.lineKey ?? null,
    source: projectionSourceFromRailGraphSelection(selection.source),
    tripId: selection.tripId,
    tripSegmentIndex: selection.tripSegmentIndex,
    routeItemId: selection.routeItemId,
  };
}

export function projectionDetailFromRailGraphSelection(
  selection?: RailGraphActiveSelection | RailGraphSelectionDraft | null,
): MileageEventsProjectionDetail | null {
  if (!selection) return null;
  return {
    lineKey: selection.lineKey ?? undefined,
    source: projectionSourceFromRailGraphSelection(selection.source),
    tripId: selection.tripId,
    tripSegmentIndex: selection.tripSegmentIndex,
    routeItemId: selection.routeItemId,
  };
}

export function projectionDetailFromMileageEventsOpen(
  detail: Partial<MileageEventsOpenDetail>,
): MileageEventsProjectionDetail | null {
  if (!detail.lineKey && !detail.source && detail.tripId === undefined) return null;
  return {
    lineKey: detail.lineKey,
    source: detail.source,
    tripId: detail.tripId,
    tripSegmentIndex: detail.tripSegmentIndex,
    routeItemId: detail.routeItemId,
  };
}

export function eventProjectionDetailFromPanelEntry(
  input: {
    lineKey?: string;
    source?: MileageEventsProjectionSource;
    orderIndex?: number;
  },
  inherited?: MileageEventsProjectionDetail | null,
): MileageEventsProjectionDetail {
  return {
    lineKey: input.lineKey,
    source: input.source,
    tripId: inherited?.tripId,
    tripSegmentIndex: input.orderIndex ?? inherited?.tripSegmentIndex,
    routeItemId: inherited?.routeItemId,
  };
}

export function selectionFromMileageEventSelect(
  detail: Partial<MileageEventSelectDetail>,
  extras: Partial<RailGraphSelectionDraft> = {},
): RailGraphSelectionDraft | null {
  if (!detail.eventId) return null;
  return {
    kind: "event",
    source: railGraphSelectionSourceFromProjection(detail.source),
    lineKey: detail.lineKey ?? null,
    tripId: detail.tripId,
    tripSegmentIndex: detail.tripSegmentIndex,
    routeItemId: detail.routeItemId,
    eventId: detail.eventId,
    ...extras,
  };
}

export function selectionFromActiveAxis(
  detail: Partial<MileageEventsActiveAxisDetail>,
  extras: Partial<RailGraphSelectionDraft> = {},
): RailGraphSelectionDraft | null {
  if (!detail.lineKey && !detail.source && detail.tripId === undefined) return null;
  return {
    kind: "axis",
    source: railGraphSelectionSourceFromProjection(detail.source),
    lineKey: detail.lineKey ?? null,
    tripId: detail.tripId,
    tripSegmentIndex: detail.tripSegmentIndex,
    routeItemId: detail.routeItemId,
    ...extras,
  };
}

export function selectionFromMileageEventsOpen(
  detail: Partial<MileageEventsOpenDetail>,
  extras: Partial<RailGraphSelectionDraft> = {},
): RailGraphSelectionDraft | null {
  if (!detail.lineKey && !detail.source && detail.tripId === undefined && !detail.eventId) return null;
  return {
    kind: detail.eventId ? "event" : "axis",
    source: railGraphSelectionSourceFromProjection(detail.source),
    lineKey: detail.lineKey ?? null,
    tripId: detail.tripId,
    tripSegmentIndex: detail.tripSegmentIndex,
    routeItemId: detail.routeItemId,
    eventId: detail.eventId,
    ...extras,
  };
}

export function openDetailMatchesActiveRouteSelection(
  detail: Partial<MileageEventsOpenDetail>,
  selection?: RailGraphActiveSelection | RailGraphSelectionDraft | null,
): boolean {
  if (detail.eventId || selection?.kind !== "route") return false;
  if (detail.source && selection.source !== railGraphSelectionSourceFromProjection(detail.source)) return false;
  if (detail.routeItemId) return selection.routeItemId === detail.routeItemId;
  return (
    detail.tripId !== undefined &&
    String(selection.tripId) === String(detail.tripId) &&
    selection.tripSegmentIndex === detail.tripSegmentIndex
  );
}
