import type { RailwayMap, Trip, TripSegment } from "../store";
import type { TripResult, TripResultSegment } from "../rail-graph-v1/user-facing.types";
import { getTripRailGraphSnapshot } from "./railGraphTripPersistence";
import { lineLabel } from "./mileageUserEvents";
import type { ManualSegmentInput } from "./routeSerializer";
import type { RouteSliceData } from "./routeExportTypes";

export interface ProductTripSegment {
  id: string;
  lineKey: string;
  lineLabel: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  company?: string;
  displayColor?: string;
  loopVia?: "up" | "down" | "auto";
  distanceKm: number;
  geometry?: [number, number][];
  source: "rail_graph" | "legacy";
}

export function tripToProductSegments(trip: Trip, railwayData?: RailwayMap): ProductTripSegment[] {
  const railGraphTrip = getTripRailGraphSnapshot(trip)?.tripResult;
  if (railGraphTrip) return railGraphTripToProductSegments(railGraphTrip, railwayData);
  return legacyTripToProductSegments(trip, railwayData);
}

export function tripLineSummary(trip: Trip, railwayData?: RailwayMap): string {
  const names = Array.from(
    new Set(
      tripToProductSegments(trip, railwayData)
        .map((segment) => segment.lineLabel || lineLabel(segment.lineKey))
        .filter(Boolean),
    ),
  );
  if (names.length === 0) return "Unknown";
  return names.length > 2 ? `${names.slice(0, 2).join(" / ")} +${names.length - 2}` : names.join(" / ");
}

export function tripSearchText(trip: Trip, railwayData?: RailwayMap): string {
  const segmentText = tripToProductSegments(trip, railwayData)
    .map((segment) => [
      segment.lineLabel,
      segment.lineKey,
      segment.fromName,
      segment.fromId,
      segment.toName,
      segment.toId,
      segment.company ?? "",
    ].join(" "))
    .join(" ");
  return [trip.date, trip.memo ?? "", String(trip.id), segmentText].join(" ");
}

export function tripProductDistanceKm(trip: Trip, railwayData?: RailwayMap): number {
  return tripToProductSegments(trip, railwayData).reduce((sum, segment) => sum + segment.distanceKm, 0);
}

export function tripToProductRouteSegments(trip: Trip, railwayData?: RailwayMap): ManualSegmentInput[] {
  return tripToProductSegments(trip, railwayData)
    .filter((segment) => segment.lineKey && segment.fromId && segment.toId)
    .map((segment) => ({
      lineKey: segment.lineKey,
      fromId: segment.fromId,
      toId: segment.toId,
      fromStation: segment.fromName,
      toStation: segment.toName,
    }));
}

export function tripToRouteSliceData(trip: Trip, railwayData?: RailwayMap): RouteSliceData | null {
  const segments = tripToProductSegments(trip, railwayData).filter((segment) => segment.geometry?.length);
  if (segments.length === 0) return null;

  const stations = segments.flatMap((segment, index) => {
    const from = {
      id: segment.fromId,
      name_ja: segment.fromName,
      lat: segment.geometry?.[0]?.[0] ?? 0,
      lng: segment.geometry?.[0]?.[1] ?? 0,
    };
    const toCoords = segment.geometry?.[segment.geometry.length - 1];
    const to = {
      id: segment.toId,
      name_ja: segment.toName,
      lat: toCoords?.[0] ?? from.lat,
      lng: toCoords?.[1] ?? from.lng,
    };
    return index === 0 ? [from, to] : [to];
  });
  const paths = segments.map((segment) => ({
    stations: stationsForSegment(segment),
    routeCoords: segment.geometry ?? [],
    color: segment.displayColor ?? null,
    meta: {
      icon: null,
      logo: null,
      companyIcon: null,
      recolor: false,
      color: segment.displayColor ?? null,
      lineKey: segment.lineKey,
      lineName: segment.lineLabel || lineLabel(segment.lineKey),
    },
  }));
  const first = segments[0];
  return {
    stations,
    routeCoords: segments.flatMap((segment) => segment.geometry ?? []),
    distance: tripProductDistanceKm(trip, railwayData).toFixed(1),
    time: String(getTripRailGraphSnapshot(trip)?.tripResult.totalTimeMinutes ?? 0),
    color: first.displayColor ?? null,
    meta: {
      icon: null,
      logo: null,
      companyIcon: null,
      recolor: false,
      color: first.displayColor ?? null,
      lineKey: first.lineKey,
      lineName: first.lineLabel || lineLabel(first.lineKey),
    },
    paths,
    routeMode: "manual",
    pathSegments: segments.map((segment) => ({
      lineKey: segment.lineKey,
      fromId: segment.fromId,
      toId: segment.toId,
      fromName: segment.fromName,
      toName: segment.toName,
    })),
  };
}

export function tripToKmlPathItems(trip: Trip, railwayData?: RailwayMap): Array<{
  name: string;
  coordinates: string;
  lineKey: string;
}> {
  if (trip.isWalk) return [];
  const tripName = `${trip.date} - Trip ${trip.id}`;
  return tripToProductSegments(trip, railwayData)
    .filter((segment) => segment.geometry?.length)
    .map((segment, index) => ({
      name: `${tripName} Segment ${index + 1}`,
      coordinates: (segment.geometry ?? []).map(([lat, lng]) => `${lng},${lat},0`).join(" "),
      lineKey: segment.lineKey,
    }));
}

function stationsForSegment(segment: ProductTripSegment) {
  const first = segment.geometry?.[0];
  const last = segment.geometry?.[segment.geometry.length - 1];
  return [{
    id: segment.fromId,
    name_ja: segment.fromName,
    lat: first?.[0] ?? 0,
    lng: first?.[1] ?? 0,
  }, {
    id: segment.toId,
    name_ja: segment.toName,
    lat: last?.[0] ?? first?.[0] ?? 0,
    lng: last?.[1] ?? first?.[1] ?? 0,
  }];
}

function railGraphTripToProductSegments(trip: TripResult, railwayData?: RailwayMap): ProductTripSegment[] {
  return trip.segments.map((segment, index) => railGraphSegmentToProductSegment(segment, index, railwayData));
}

function railGraphSegmentToProductSegment(
  segment: TripResultSegment,
  index: number,
  railwayData?: RailwayMap,
): ProductTripSegment {
  const lineKey = String(segment.mileageProfile.lineRef ?? segment.mileageProfile.patternRef ?? segment.segmentId);
  const line = railwayData?.[lineKey];
  return {
    id: segment.segmentId || `rail-graph:${index}`,
    lineKey,
    lineLabel: segment.lineLabel || lineLabel(lineKey),
    fromId: String(segment.fromStation.stationRef),
    toId: String(segment.toStation.stationRef),
    fromName: segment.fromStation.name,
    toName: segment.toStation.name,
    company: line?.meta?.company,
    displayColor: segment.displayColor || line?.meta?.color || undefined,
    distanceKm: segment.distanceKm,
    geometry: segment.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    source: "rail_graph",
  };
}

function legacyTripToProductSegments(trip: Trip, railwayData?: RailwayMap): ProductTripSegment[] {
  const segments = trip.segments?.length
    ? trip.segments
    : [{ id: "legacy", lineKey: trip.lineKey || "", fromId: trip.fromId || "", toId: trip.toId || "" }];
  return segments.map((segment, index) => legacySegmentToProductSegment(segment, index, railwayData));
}

function legacySegmentToProductSegment(
  segment: TripSegment,
  index: number,
  railwayData?: RailwayMap,
): ProductTripSegment {
  const line = railwayData?.[segment.lineKey];
  const from = line?.stations.find((station) => station.id === segment.fromId);
  const to = line?.stations.find((station) => station.id === segment.toId);
  return {
    id: segment.id ? String(segment.id) : `legacy:${index}`,
    lineKey: segment.lineKey || "",
    lineLabel: segment.lineKey ? lineLabel(segment.lineKey) : "",
    fromId: segment.fromId || "",
    toId: segment.toId || "",
    fromName: from?.name_ja || segment.fromId || "",
    toName: to?.name_ja || segment.toId || "",
    company: line?.meta?.company,
    displayColor: line?.meta?.color || undefined,
    loopVia: segment.loopVia,
    distanceKm: 0,
    source: "legacy",
  };
}
