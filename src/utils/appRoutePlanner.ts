import type { RailwayMap } from "../store";
import { findRoute } from "../core/railwayRouting";
import type { RailGraphRuntimeState } from "../store";
import type { DirectionLabel, EntityRef } from "../rail-graph-v1/primitives";
import type { PlanTripResult } from "../rail-graph-v1/deployment.types";
import type { AppRailGraphTripResult } from "./railGraphTripAdapter";
import { planRailGraphTripForApp, tripResultToAppSegments } from "./railGraphTripAdapter";
import { buildTripResult } from "../rail-graph-v1/trip-planner";
import { resolveRunContext } from "../rail-graph-v1/run-resolver";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import type { TripEvent, TripResult, TripRuntimeArtifacts } from "../rail-graph-v1/user-facing.types";

export type LegacyRouteResult = ReturnType<typeof findRoute>;

export type AppRouteCandidate =
  | {
    source: "rail_graph";
    candidateId: string;
    candidateKind: "preset" | "pattern" | "auto";
    label: string;
    description?: string;
    trip: AppRailGraphTripResult;
    segments: AppRailGraphTripResult["segments"];
    estimatedTime?: number;
    totalDistanceKm: number;
    totalTimeMinutes: number;
    presetId?: string;
    patternRef?: EntityRef;
    lineRef?: EntityRef;
    direction?: DirectionLabel;
    directionLabel?: string;
    serviceType?: string;
    viaStationCount: number;
    eventTypeSummary: TripEvent["type"][];
    keyEventLabels: string[];
  }
  | {
    source: "legacy";
    candidateId: string;
    candidateKind: "legacy";
    label: string;
    description?: string;
    segments: NonNullable<LegacyRouteResult["segments"]>;
    estimatedTime?: number;
    railGraphFallbackReason?: string;
  };

export type AppRouteCandidatesResult =
  | {
    status: "ok";
    source: "rail_graph" | "legacy";
    candidates: AppRouteCandidate[];
    best: AppRouteCandidate;
    railGraphFallbackReason?: string;
  }
  | {
    status: "error";
    source: "legacy" | "rail_graph";
    error: string;
    railGraphFallbackReason?: string;
  };

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
  const candidates = planAppRouteCandidates(args);
  if (candidates.status === "error") {
    return {
      source: candidates.source,
      status: "error",
      error: candidates.error,
      railGraphFallbackReason: candidates.railGraphFallbackReason,
    };
  }

  const best = candidates.best;
  if (best.source === "rail_graph") {
    return {
      source: "rail_graph",
      status: "ok",
      trip: best.trip,
      segments: best.segments,
      estimatedTime: best.estimatedTime,
    };
  }

  return {
    source: "legacy",
    status: "ok",
    segments: best.segments,
    estimatedTime: best.estimatedTime,
    railGraphFallbackReason: best.railGraphFallbackReason,
  };
}

export function planAppRouteCandidates(args: PlanAppRouteArgs): AppRouteCandidatesResult {
  const railGraphResult = tryPlanRailGraphCandidates(args);
  if (railGraphResult?.status === "ok" && railGraphResult.candidates.length > 0) {
    return {
      status: "ok",
      source: "rail_graph",
      candidates: railGraphResult.candidates,
      best: railGraphResult.candidates[0],
    };
  }
  const railGraphFallbackReason = railGraphResult?.status === "skip" ? railGraphResult.reason : undefined;

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
      railGraphFallbackReason,
    };
  }

  const fallbackCandidate: AppRouteCandidate = {
    source: "legacy",
    candidateId: "legacy:auto",
    candidateKind: "legacy",
    label: "Legacy route",
    segments: legacy.segments,
    estimatedTime: legacy.estimatedTime,
    railGraphFallbackReason,
  };
  return {
    status: "ok",
    source: "legacy",
    candidates: [fallbackCandidate],
    best: fallbackCandidate,
    railGraphFallbackReason,
  };
}

function tryPlanRailGraphCandidates(args: PlanAppRouteArgs): ({
  status: "ok";
  candidates: Extract<AppRouteCandidate, { source: "rail_graph" }>[];
} | { status: "skip"; reason: string }) | null {
  const runtime = args.railGraphRuntime;
  if (!runtime) return null;
  const startStationRef = appStationToRailGraphRef(runtime, args.startStationId, args.startLineKey);
  const endStationRef = appStationToRailGraphRef(runtime, args.endStationId, args.endLineKey);
  if (!startStationRef || !endStationRef) {
    return { status: "skip", reason: "Rail graph runtime does not contain the requested station pair." };
  }

  const candidates: Extract<AppRouteCandidate, { source: "rail_graph" }>[] = [];
  const seenFingerprints = new Set<string>();

  for (const preset of runtime.deployed.generatedPresets.filter((candidate) =>
    candidate.startStation === startStationRef && candidate.endStation === endStationRef
  )) {
    const result = planRailGraphTripForApp({
      system: runtime.system,
      deployed: runtime.deployed,
      request: {
        systemId: runtime.deployed.systemId,
        startStationRef,
        endStationRef,
        presetId: preset.presetId,
      },
    });
    if (result.status !== "ok") continue;
    pushRailGraphCandidate(candidates, seenFingerprints, candidateFromTrip({
      candidateKind: "preset",
      trip: result.trip,
      label: preset.label || preset.serviceLabel || "Preset route",
      description: preset.shortLabel,
      presetId: preset.presetId,
      patternRef: preset.patternRef,
      directionLabel: preset.directionLabel,
    }, args.railwayData));
  }

  for (const pattern of directPatternCandidates(runtime, startStationRef, endStationRef)) {
    const result = planDirectPatternCandidate({
      runtime,
      pattern,
      startStationRef,
      endStationRef,
    });
    if (!result) continue;
    pushRailGraphCandidate(candidates, seenFingerprints, candidateFromTrip({
      candidateKind: "pattern",
      trip: result,
      label: pattern.displayName ?? String(pattern.lineRef),
      description: String(pattern.patternId),
      patternRef: pattern.patternId,
    }, args.railwayData));
  }

  const autoResult = planRailGraphTripForApp({
    system: runtime.system,
    deployed: runtime.deployed,
    request: {
      systemId: runtime.deployed.systemId,
      startStationRef,
      endStationRef,
    },
  });
  if (autoResult.status === "ok") {
    pushRailGraphCandidate(candidates, seenFingerprints, candidateFromTrip({
      candidateKind: "auto",
      trip: autoResult.trip,
      label: "Auto route",
    }, args.railwayData));
  }

  if (candidates.length === 0) {
    if (autoResult.status !== "ok") return { status: "skip", reason: railGraphErrorReason(autoResult) };
    return { status: "skip", reason: "Rail graph result is not consumable by the current app railwayData model." };
  }

  return {
    status: "ok",
    candidates: candidates.sort(compareRailGraphCandidates),
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

function directPatternCandidates(
  runtime: RailGraphRuntimeState,
  startStationRef: EntityRef,
  endStationRef: EntityRef,
): ServicePattern[] {
  return Object.values(runtime.system.graph.indexes.patternById)
    .filter((pattern) =>
      traceContainsStation(pattern, startStationRef)
      && traceContainsStation(pattern, endStationRef)
      && startStationRef !== endStationRef
    )
    .sort((left, right) =>
      patternSliceScore(left, startStationRef, endStationRef) - patternSliceScore(right, startStationRef, endStationRef)
      || String(left.patternId).localeCompare(String(right.patternId))
    );
}

function planDirectPatternCandidate(args: {
  runtime: RailGraphRuntimeState;
  pattern: ServicePattern;
  startStationRef: EntityRef;
  endStationRef: EntityRef;
}): AppRailGraphTripResult | null {
  const directionHint = directionForPatternSlice(args.pattern, args.startStationRef, args.endStationRef);
  const context = resolveRunContext({
    system: args.runtime.system,
    spec: {
      systemId: args.runtime.deployed.systemId,
      patternRef: args.pattern.patternId,
      startStationRef: args.startStationRef,
      endStationRef: args.endStationRef,
      directionHint,
    },
  });
  if (!context.path || !context.resolvedPath) return null;
  const built = buildTripResult({
    system: args.runtime.system,
    context,
    planUsed: "auto",
  });
  return {
    tripResult: built.trip,
    runtimeArtifacts: built.runtimeArtifacts,
    segments: tripResultToAppSegments(built.trip, built.runtimeArtifacts),
  };
}

function candidateFromTrip(args: {
  candidateKind: "preset" | "pattern" | "auto";
  trip: AppRailGraphTripResult;
  label: string;
  description?: string;
  presetId?: string;
  patternRef?: EntityRef;
  directionLabel?: string;
}, railwayData: RailwayMap): Extract<AppRouteCandidate, { source: "rail_graph" }> | null {
  if (!segmentsAreLegacyConsumable(args.trip.segments, railwayData)) return null;
  const firstRuntime = args.trip.runtimeArtifacts.segments[0];
  const firstSegment = args.trip.tripResult.segments[0];
  const keyEvents = keyTripEvents(args.trip.tripResult);
  const patternRef = args.patternRef ?? firstRuntime?.patternRef ?? firstSegment?.mileageProfile.patternRef;
  const direction = firstRuntime?.direction ?? firstSegment?.mileageProfile.direction;
  return {
    source: "rail_graph",
    candidateId: [
      args.candidateKind,
      args.presetId ?? patternRef ?? args.trip.tripResult.routeFingerprint,
      direction ?? "unknown",
    ].join(":"),
    candidateKind: args.candidateKind,
    label: args.label,
    description: args.description,
    trip: args.trip,
    segments: args.trip.segments,
    estimatedTime: args.trip.tripResult.totalTimeMinutes,
    totalDistanceKm: args.trip.tripResult.totalDistanceKm,
    totalTimeMinutes: args.trip.tripResult.totalTimeMinutes,
    presetId: args.presetId ?? args.trip.tripResult.presetId,
    patternRef,
    lineRef: firstRuntime?.lineRef ?? firstSegment?.mileageProfile.lineRef,
    direction,
    directionLabel: args.directionLabel ?? direction,
    serviceType: firstRuntime?.serviceType ?? firstSegment?.mileageProfile.serviceType,
    viaStationCount: args.trip.tripResult.segments.reduce((sum, segment) => sum + Math.max(0, segment.viaStations.length - 2), 0),
    eventTypeSummary: args.trip.tripResult.eventTypeSummary,
    keyEventLabels: keyEvents.map((event) => event.label).slice(0, 4),
  };
}

function pushRailGraphCandidate(
  candidates: Extract<AppRouteCandidate, { source: "rail_graph" }>[],
  seenFingerprints: Set<string>,
  candidate: Extract<AppRouteCandidate, { source: "rail_graph" }> | null,
): void {
  if (!candidate) return;
  const fingerprint = candidate.trip.tripResult.routeFingerprint;
  if (seenFingerprints.has(fingerprint)) return;
  seenFingerprints.add(fingerprint);
  candidates.push(candidate);
}

function compareRailGraphCandidates(
  left: Extract<AppRouteCandidate, { source: "rail_graph" }>,
  right: Extract<AppRouteCandidate, { source: "rail_graph" }>,
): number {
  return candidateKindRank(left.candidateKind) - candidateKindRank(right.candidateKind)
    || left.totalTimeMinutes - right.totalTimeMinutes
    || left.totalDistanceKm - right.totalDistanceKm
    || left.label.localeCompare(right.label);
}

function candidateKindRank(kind: Extract<AppRouteCandidate, { source: "rail_graph" }>["candidateKind"]): number {
  if (kind === "preset") return 0;
  if (kind === "pattern") return 1;
  return 2;
}

function keyTripEvents(trip: TripResult): TripEvent[] {
  const events = trip.segments.flatMap((segment) => segment.events);
  return events.filter((event) =>
    event.type === "transfer"
    || event.type === "scenic"
    || (event.type === "note" && event.source === "user")
  );
}

function traceContainsStation(pattern: ServicePattern, stationRef: EntityRef): boolean {
  return pattern.traceSequence.some((entry) => entry.stationRef === stationRef);
}

function directionForPatternSlice(
  pattern: ServicePattern,
  startStationRef: EntityRef,
  endStationRef: EntityRef,
): DirectionLabel | undefined {
  const trace = [...pattern.traceSequence].sort((left, right) => left.orderIndex - right.orderIndex);
  const startIndex = trace.findIndex((entry) => entry.stationRef === startStationRef);
  const endIndex = trace.findIndex((entry) => entry.stationRef === endStationRef);
  if (startIndex < 0 || endIndex < 0) return undefined;
  return startIndex <= endIndex
    ? pattern.directionConvention.forwardDirection
    : pattern.directionConvention.reverseDirection;
}

function patternSliceScore(pattern: ServicePattern, startStationRef: EntityRef, endStationRef: EntityRef): number {
  const trace = [...pattern.traceSequence].sort((left, right) => left.orderIndex - right.orderIndex);
  const startIndex = trace.findIndex((entry) => entry.stationRef === startStationRef);
  const endIndex = trace.findIndex((entry) => entry.stationRef === endStationRef);
  if (startIndex < 0 || endIndex < 0) return Number.POSITIVE_INFINITY;
  return Math.abs(endIndex - startIndex);
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
