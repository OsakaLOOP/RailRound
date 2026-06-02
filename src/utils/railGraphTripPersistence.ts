import type { Trip } from "../store";
import type { TripResult, TripRuntimeArtifacts } from "../rail-graph-v1/user-facing.types";

export interface TripRailGraphSnapshot {
  tripResult: TripResult;
  runtimeArtifacts?: TripRuntimeArtifacts;
}

export function snapshotRailGraphTrip(
  tripResult: TripResult,
  runtimeArtifacts?: TripRuntimeArtifacts,
): TripRailGraphSnapshot {
  return {
    tripResult: clone(tripResult),
    ...(runtimeArtifacts ? { runtimeArtifacts: clone(runtimeArtifacts) } : {}),
  };
}

export function attachRailGraphSnapshot(
  trip: Trip,
  snapshot: TripRailGraphSnapshot | undefined,
): Trip {
  if (!snapshot) return trip;
  return {
    ...clone(trip),
    railGraph: snapshot,
  };
}

export function getTripRailGraphSnapshot(trip: Trip): TripRailGraphSnapshot | null {
  return trip.railGraph ?? null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
