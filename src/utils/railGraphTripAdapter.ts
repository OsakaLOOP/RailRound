import type { Trip } from "../store";
import type { TripSegment } from "../store";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { DeployedSystem, PlanTripResult, TripPlanRequest } from "../rail-graph-v1/deployment.types";
import type { SystemContext } from "../rail-graph-v1/graph.types";
import type { TripResult, TripResultSegment, TripRuntimeArtifacts } from "../rail-graph-v1/user-facing.types";
import { planTrip } from "../rail-graph-v1/trip-planner";
import { snapshotRailGraphTrip } from "./railGraphTripPersistence";

export interface AppRailGraphTripSegment extends TripSegment {
  railGraphPatternRef: EntityRef;
  railGraphPathId: string;
  geometry: [number, number][];
  eventCount: number;
}

export interface AppRailGraphTripResult {
  tripResult: TripResult;
  runtimeArtifacts: TripRuntimeArtifacts;
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
      runtimeArtifacts: result.runtimeArtifacts,
      segments: tripResultToAppSegments(result.trip, result.runtimeArtifacts),
    },
  };
}

export function tripResultToAppSegments(
  trip: TripResult,
  runtimeArtifacts?: TripRuntimeArtifacts,
): AppRailGraphTripSegment[] {
  return trip.segments.map((segment, index) => tripResultSegmentToAppSegment(
    segment,
    index,
    runtimeArtifacts?.segments.find((artifact) => artifact.segmentId === segment.segmentId),
  ));
}

export function tripResultToLegacyTrip(
  trip: TripResult,
  runtimeArtifacts?: TripRuntimeArtifacts,
): Trip {
  const appSegments = tripResultToAppSegments(trip, runtimeArtifacts);
  const firstSegment = appSegments[0];
  const lastSegment = appSegments[appSegments.length - 1];
  const legacyTrip: Trip = {
    id: trip.tripId,
    date: trip.departureTime?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    memo: trip.presetId ? `rail-graph:${trip.presetId}` : "rail-graph:auto",
    cost: 0,
    segments: appSegments,
    lineKey: firstSegment?.lineKey,
    fromId: firstSegment?.fromId,
    toId: lastSegment?.toId,
  };
  return {
    ...legacyTrip,
    railGraph: snapshotRailGraphTrip(trip),
  };
}

export function tripResultSegmentToAppSegment(
  segment: TripResultSegment,
  index = 0,
  artifact?: TripRuntimeArtifacts["segments"][number],
): AppRailGraphTripSegment {
  const patternRef = artifact?.patternRef ?? segment.mileageProfile.patternRef ?? (`rail-graph:segment:${segment.segmentId}` as EntityRef);
  const lineRef = artifact?.lineRef ?? segment.mileageProfile.lineRef ?? patternRef;
  const direction = artifact?.direction ?? segment.mileageProfile.direction;
  return {
    id: `rail-graph:${patternRef}:${index}`,
    lineKey: String(lineRef),
    fromId: String(segment.fromStation.stationRef),
    toId: String(segment.toStation.stationRef),
    line: segment.lineLabel,
    direction: direction === "up" || direction === "down" ? direction : undefined,
    railGraphPatternRef: patternRef,
    railGraphPathId: artifact?.resolvedPath.pathId ?? segment.segmentId,
    geometry: segment.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    eventCount: segment.events.length,
  };
}
