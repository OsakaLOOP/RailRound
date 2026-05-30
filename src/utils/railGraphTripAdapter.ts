import type { TripSegment } from "../store";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { DeployedSystem, PlanTripResult, TripPlanRequest } from "../rail-graph-v1/deployment.types";
import type { SystemContext } from "../rail-graph-v1/graph.types";
import type { TripResult, TripResultSegment } from "../rail-graph-v1/user-facing.types";
import { planTrip } from "../rail-graph-v1/trip-planner";

export interface AppRailGraphTripSegment extends TripSegment {
  railGraphPatternRef: EntityRef;
  railGraphPathId: string;
  geometry: [number, number][];
  eventCount: number;
}

export interface AppRailGraphTripResult {
  tripResult: TripResult;
  segments: AppRailGraphTripSegment[];
}

export function planRailGraphTripForApp(args: {
  system: SystemContext;
  deployed?: DeployedSystem | null;
  request: TripPlanRequest;
}): Exclude<PlanTripResult, { status: "ok" }> | {
  status: "ok";
  trip: AppRailGraphTripResult;
} {
  const result = planTrip(args);
  if (result.status !== "ok") return result;
  return {
    status: "ok",
    trip: {
      tripResult: result.trip,
      segments: tripResultToAppSegments(result.trip),
    },
  };
}

export function tripResultToAppSegments(trip: TripResult): AppRailGraphTripSegment[] {
  return trip.segments.map((segment, index) => tripResultSegmentToAppSegment(segment, index));
}

export function tripResultSegmentToAppSegment(
  segment: TripResultSegment,
  index = 0,
): AppRailGraphTripSegment {
  return {
    id: `rail-graph:${segment.patternRef}:${index}`,
    lineKey: String(segment.lineRef),
    fromId: String(segment.fromStation.stationRef),
    toId: String(segment.toStation.stationRef),
    line: segment.lineLabel,
    direction: segment.direction === "up" || segment.direction === "down" ? segment.direction : undefined,
    railGraphPatternRef: segment.patternRef,
    railGraphPathId: segment.resolvedPath.pathId,
    geometry: segment.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    eventCount: segment.events.length,
  };
}
