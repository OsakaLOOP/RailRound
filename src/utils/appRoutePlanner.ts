import type { RailwayMap } from "../store";
import { findRoute } from "../core/railwayRouting";
import type { RailGraphRuntimeState } from "../store";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { PlanTripResult } from "../rail-graph-v1/deployment.types";
import type { AppRailGraphTripResult } from "./railGraphTripAdapter";
import { planRailGraphTripForApp } from "./railGraphTripAdapter";

export type LegacyRouteResult = ReturnType<typeof findRoute>;

export type AppRoutePlannerResult =
  | {
    source: "rail_graph";
    status: "ok";
    trip: AppRailGraphTripResult;
    segments: AppRailGraphTripResult["segments"];
    estimatedTime?: number;
  }
  | {
    source: "legacy";
    status: "ok";
    segments: NonNullable<LegacyRouteResult["segments"]>;
    estimatedTime?: number;
    railGraphFallbackReason?: string;
  }
  | {
    source: "legacy" | "rail_graph";
    status: "error";
    error: string;
    railGraphFallbackReason?: string;
  };

export interface PlanAppRouteArgs {
  startLineKey: string;
  startStationId: string;
  endLineKey: string;
  endStationId: string;
  railwayData: RailwayMap;
  maxTransfersOverride?: number;
  railGraphRuntime?: RailGraphRuntimeState | null;
}

export function planAppRoute(args: PlanAppRouteArgs): AppRoutePlannerResult {
  const railGraphResult = tryPlanRailGraphRoute(args);
  if (railGraphResult?.status === "ok") return railGraphResult;

  const legacy = findRoute(
    args.startLineKey,
    args.startStationId,
    args.endLineKey,
    args.endStationId,
    args.railwayData,
    args.maxTransfersOverride,
  );
  if (legacy.error || !legacy.segments) {
    return {
      source: "legacy",
      status: "error",
      error: legacy.error ?? "Route planner returned no segments.",
      railGraphFallbackReason: railGraphResult?.reason,
    };
  }
  return {
    source: "legacy",
    status: "ok",
    segments: legacy.segments,
    estimatedTime: legacy.estimatedTime,
    railGraphFallbackReason: railGraphResult?.reason,
  };
}

function tryPlanRailGraphRoute(args: PlanAppRouteArgs): ({
  source: "rail_graph";
  status: "ok";
  trip: AppRailGraphTripResult;
  segments: AppRailGraphTripResult["segments"];
  estimatedTime?: number;
} | { status: "skip"; reason: string }) | null {
  const runtime = args.railGraphRuntime;
  if (!runtime) return null;
  const startStationRef = appStationToRailGraphRef(runtime, args.startStationId, args.startLineKey);
  const endStationRef = appStationToRailGraphRef(runtime, args.endStationId, args.endLineKey);
  if (!startStationRef || !endStationRef) {
    return { status: "skip", reason: "Rail graph runtime does not contain the requested station pair." };
  }

  const result = planRailGraphTripForApp({
    system: runtime.system,
    deployed: runtime.deployed,
    request: {
      systemId: runtime.deployed.systemId,
      startStationRef,
      endStationRef,
    },
  });
  if (result.status !== "ok") {
    return { status: "skip", reason: railGraphErrorReason(result) };
  }
  if (!segmentsAreLegacyConsumable(result.trip.segments, args.railwayData)) {
    return { status: "skip", reason: "Rail graph result is not consumable by the current app railwayData model." };
  }
  return {
    source: "rail_graph",
    status: "ok",
    trip: result.trip,
    segments: result.trip.segments,
    estimatedTime: result.trip.tripResult.totalTimeMinutes,
  };
}

function appStationToRailGraphRef(
  runtime: RailGraphRuntimeState,
  stationId: string,
  lineKey: string,
): EntityRef | null {
  if (runtime.system.graph.indexes.stationById[stationId]) return stationId as EntityRef;
  const byDisplayId = runtime.deployed.stations.find((station) => station.stationRef === stationId);
  if (byDisplayId) return byDisplayId.stationRef;

  const line = runtime.system.graph.indexes.patternById[lineKey];
  if (line?.traceSequence.some((entry) => entry.stationRef === stationId)) return stationId as EntityRef;

  return null;
}

function railGraphErrorReason(result: Exclude<PlanTripResult, { status: "ok" }>): string {
  return result.reason;
}

function segmentsAreLegacyConsumable(
  segments: AppRailGraphTripResult["segments"],
  railwayData: RailwayMap,
): boolean {
  return segments.every((segment) => {
    const line = railwayData[segment.lineKey];
    return !!line
      && line.stations.some((station) => station.id === segment.fromId)
      && line.stations.some((station) => station.id === segment.toId);
  });
}
