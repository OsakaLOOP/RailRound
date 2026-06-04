// ============================================================
// Rail Graph v1 - User-facing trip planner
// ============================================================

import type { DeployedSystem, PathPreset, PlanTripResult, TripPlanRequest } from "./deployment.types";
import type { RunEvent } from "./event.types";
import type { RunContext, SystemContext } from "./graph.types";
import type { EntityRef } from "./primitives";
import type { RunSpec } from "./runtime.types";
import type { ServicePattern, ServiceTraceEntry } from "./service-template.types";
import type { TransferScore, TransferScoringPolicy } from "./transfer-scorer";
import type {
  StationMeta,
  StationStop,
  TripEvent,
  TripResult,
  TripRuntimeArtifacts,
  TripResultSegment,
  TripSegmentMileageProfile,
  TripSegmentRuntimeArtifacts,
} from "./user-facing.types";
import { fingerprint } from "./fingerprint";
import { resolveRunContext } from "./run-resolver";
import {
  mergeTransferScoringPolicies,
  scoreTransfer,
  transferPolicyFromTopologyRelations,
} from "./transfer-scorer";

export interface PlanTripArgs {
  system: SystemContext;
  deployed?: DeployedSystem | null;
  request: TripPlanRequest;
}

export function planTrip(args: PlanTripArgs): PlanTripResult {
  const transferPolicy = transferPolicyForPlan(args);
  const preset = args.request.presetId
    ? args.deployed?.generatedPresets.find((item) => item.presetId === args.request.presetId)
    : undefined;

  if (args.request.presetId && !preset) {
    return {
      status: "invalid_request",
      reason: "Preset was not found in deployed system.",
    };
  }

  const plan = preset
    ? { specs: [preset.runSpec], planUsed: "preset" as const, preset, transfers: [] }
    : resolvePlanFromRequest(args.system, args.request, args.deployed?.generatedPresets ?? [], transferPolicy);
  if ("error" in plan) return plan.error;

  const contexts = plan.specs.map((spec) => resolveRunContext({
    system: args.system,
    spec,
  }));
  const failed = contexts.find((context) => !context.path || !context.resolvedPath);
  if (failed) {
    return {
      status: "unreachable",
      reason: failed.diagnostics.find((diag) => diag.level === "fatal")?.message ?? "Run path could not be resolved.",
      suggestions: args.deployed?.generatedPresets,
    };
  }

  const built = buildTripResultFromContexts({
    system: args.system,
    contexts,
    preset: plan.preset,
    planUsed: plan.planUsed,
    transfers: plan.transfers,
  });

  return {
    status: "ok",
    trip: built.trip,
    runtimeArtifacts: built.runtimeArtifacts,
  };
}

export function buildTripResult(args: {
  system: SystemContext;
  context: RunContext;
  preset?: PathPreset;
  planUsed: TripResult["planUsed"];
}): { trip: TripResult; runtimeArtifacts: TripRuntimeArtifacts } {
  return buildTripResultFromContexts({
    system: args.system,
    contexts: [args.context],
    preset: args.preset,
    planUsed: args.planUsed,
    transfers: [],
  });
}

function buildTripResultFromContexts(args: {
  system: SystemContext;
  contexts: readonly RunContext[];
  preset?: PathPreset;
  planUsed: TripResult["planUsed"];
  transfers: readonly TransferScore[];
}): { trip: TripResult; runtimeArtifacts: TripRuntimeArtifacts } {
  if (args.contexts.length === 0) {
    throw new Error("Cannot build TripResult without at least one resolved run context.");
  }
  const segmentResults = args.contexts.map((context, index) => {
    if (!context.path || !context.resolvedPath) {
      throw new Error("Cannot build TripResult without a resolved run path.");
    }
    const pattern = args.system.graph.indexes.patternById[context.path.patternRef];
    if (!pattern) {
      throw new Error(`Cannot build TripResult; pattern is missing: ${context.path.patternRef}`);
    }
    return buildTripResultSegment({
      system: args.system,
      context,
      pattern,
      preset: args.contexts.length === 1 ? args.preset : undefined,
      segmentIndex: index,
    });
  });
  const segments = segmentResults.map((result, index) =>
    index === 0 ? result.segment : withTransferEvent({
      segment: result.segment,
      previous: segmentResults[index - 1].segment,
      transfer: args.transfers[index - 1],
    })
  );
  const runtimeSegments = segmentResults.map((result) => result.runtimeArtifacts);
  const departureTime = firstTimestamp(args.contexts[0]);
  const arrivalTime = lastTimestamp(args.contexts[args.contexts.length - 1]);
  const routeFingerprint = fingerprint({
    graphId: args.system.graphId,
    runIds: args.contexts.map((context) => context.runId),
    segments: runtimeSegments.map((segment) => ({
      patternRef: segment.patternRef,
      pathId: segment.resolvedPath.pathId,
    })),
  });
  const tripId = `trip:${fingerprint({
    runIds: args.contexts.map((context) => context.runId),
    presetId: args.preset?.presetId,
    departureTime,
    arrivalTime,
  }).slice(0, 16)}`;
  const trip: TripResult = {
    tripId,
    presetId: args.preset?.presetId,
    planUsed: args.planUsed,
    segments,
    totalDistanceKm: Number(segments.reduce((sum, segment) => sum + segment.distanceKm, 0).toFixed(3)),
    totalTimeMinutes: segments.reduce((sum, segment) => sum + segment.timeMinutes, 0),
    routeFingerprint,
    departureTime,
    arrivalTime,
    timeOfDay: departureTime ? timeOfDay(departureTime) : undefined,
    eventTypeSummary: [...new Set(segments.flatMap((segment) => segment.events.map((event) => event.type)))],
  };
  const runtimeArtifacts: TripRuntimeArtifacts = {
    tripId,
    graphId: args.system.graphId,
    runId: args.contexts.map((context) => context.runId).join("+"),
    routeFingerprint,
    segments: runtimeSegments,
  };
  return {
    trip,
    runtimeArtifacts,
  };
}

function transferPolicyForPlan(args: PlanTripArgs): TransferScoringPolicy | undefined {
  return mergeTransferScoringPolicies(
    args.deployed?.transferPolicy,
    transferPolicyFromTopologyRelations(args.deployed?.relations ?? args.system.graph.topo.base.relations),
    args.request.transferPolicy,
  );
}

function resolvePlanFromRequest(
  system: SystemContext,
  request: TripPlanRequest,
  suggestions: readonly PathPreset[],
  transferPolicy?: TransferScoringPolicy,
): {
  specs: RunSpec[];
  planUsed: "auto";
  transfers: TransferScore[];
  preset?: undefined;
} | {
  error: Exclude<PlanTripResult, { status: "ok" }>;
} {
  const candidates = Object.values(system.graph.indexes.patternById)
    .filter((pattern) =>
      traceContainsStation(pattern, request.startStationRef)
      && traceContainsStation(pattern, request.endStationRef)
    )
    .sort((left, right) => patternScore(left, request) - patternScore(right, request)
      || left.patternId.localeCompare(right.patternId));
  const pattern = candidates[0];
  if (!pattern) {
    const crossPattern = resolveCrossPatternPlan(system, request, transferPolicy);
    if (crossPattern) return crossPattern;
    return unreachable("No deployed service pattern covers the requested station pair.", suggestions);
  }
  return {
    specs: [{
      systemId: request.systemId,
      patternRef: pattern.patternId,
      startStationRef: request.startStationRef,
      endStationRef: request.endStationRef,
      viaRefs: request.viaRefs,
      directionHint: directionPreferenceToHint(request.directionPreference),
    }],
    planUsed: "auto",
    transfers: [],
  };
}

function resolveCrossPatternPlan(
  system: SystemContext,
  request: TripPlanRequest,
  transferPolicy?: TransferScoringPolicy,
): {
  specs: RunSpec[];
  planUsed: "auto";
  transfers: TransferScore[];
  preset?: undefined;
} | null {
  const patterns = Object.values(system.graph.indexes.patternById);
  const transferGraph = buildTransferGraph(patterns);
  const startPatterns = patterns.filter((pattern) => traceContainsStation(pattern, request.startStationRef));
  const targetPatterns = patterns.filter((pattern) => traceContainsStation(pattern, request.endStationRef));
  if (startPatterns.length === 0 || targetPatterns.length === 0) return null;

  interface SearchState {
    patternId: EntityRef;
    currentStation: EntityRef;
    specs: RunSpec[];
    transfers: TransferScore[];
    visitedPatternIds: EntityRef[];
    cost: number;
  }

  const queue: SearchState[] = startPatterns.map((pattern) => ({
    patternId: pattern.patternId,
    currentStation: request.startStationRef,
    specs: [],
    transfers: [],
    visitedPatternIds: [pattern.patternId],
    cost: 0,
  }));
  let best: SearchState | null = null;
  const bestSeen = new Map<string, number>();

  while (queue.length > 0) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift()!;
    if (best && current.cost >= best.cost) continue;
    const seenKey = `${current.patternId}:${current.currentStation}`;
    const previousCost = bestSeen.get(seenKey);
    if (previousCost !== undefined && previousCost <= current.cost) continue;
    bestSeen.set(seenKey, current.cost);

    const currentPattern = system.graph.indexes.patternById[current.patternId];
    if (!currentPattern) continue;

    if (traceContainsStation(currentPattern, request.endStationRef)) {
      const spec = specForPatternSlice(currentPattern, request.systemId, current.currentStation, request.endStationRef, request.directionPreference);
      const candidate = {
        ...current,
        specs: [...current.specs, spec],
        cost: current.cost + patternSliceCost(currentPattern, current.currentStation, request.endStationRef),
      };
      if (!best || candidate.cost < best.cost) best = candidate;
    }

    for (const relation of transferGraph.byPatternId.get(current.patternId) ?? []) {
      const nextPatternId = relation.patternA === current.patternId ? relation.patternB : relation.patternA;
      if (current.visitedPatternIds.includes(nextPatternId)) continue;
      const nextPattern = system.graph.indexes.patternById[nextPatternId];
      if (!nextPattern) continue;
      for (const transferStation of relation.sharedStations) {
        if (!traceContainsStation(currentPattern, transferStation)) continue;
        const transfer = scoreTransfer({
          policy: transferPolicy,
          fromPatternRef: currentPattern.patternId,
          toPatternRef: nextPattern.patternId,
          stationRef: transferStation,
        });
        if (!transfer.allowed) continue;
        const spec = specForPatternSlice(currentPattern, request.systemId, current.currentStation, transferStation, request.directionPreference);
        const cost = current.cost
          + patternSliceCost(currentPattern, current.currentStation, transferStation)
          + transfer.costMeters;
        if (best && cost >= best.cost) continue;
        queue.push({
          patternId: nextPattern.patternId,
          currentStation: transferStation,
          specs: [...current.specs, spec],
          transfers: [...current.transfers, transfer],
          visitedPatternIds: [...current.visitedPatternIds, nextPattern.patternId],
          cost,
        });
      }
    }
  }

  if (!best || best.specs.length < 2) return null;
  return {
    specs: best.specs,
    planUsed: "auto",
    transfers: best.transfers,
  };
}

function buildTransferGraph(patterns: readonly ServicePattern[]): {
  transfers: TransferRelation[];
  byPatternId: Map<EntityRef, TransferRelation[]>;
} {
  const transfers: TransferRelation[] = [];
  const byPatternId = new Map<EntityRef, TransferRelation[]>();
  const stationSets = new Map(patterns.map((pattern) => [
    pattern.patternId,
    new Set(pattern.traceSequence.map((entry) => entry.stationRef)),
  ] as const));

  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      const left = patterns[i];
      const right = patterns[j];
      const leftStations = stationSets.get(left.patternId) ?? new Set<EntityRef>();
      const rightStations = stationSets.get(right.patternId) ?? new Set<EntityRef>();
      const sharedStations = [...leftStations].filter((stationRef) => rightStations.has(stationRef));
      if (sharedStations.length === 0) continue;
      const relation = {
        patternA: left.patternId,
        patternB: right.patternId,
        sharedStations,
      };
      transfers.push(relation);
      pushTransfer(byPatternId, left.patternId, relation);
      pushTransfer(byPatternId, right.patternId, relation);
    }
  }

  return { transfers, byPatternId };
}

interface TransferRelation {
  patternA: EntityRef;
  patternB: EntityRef;
  sharedStations: EntityRef[];
}

function pushTransfer(map: Map<EntityRef, TransferRelation[]>, patternRef: EntityRef, relation: TransferRelation): void {
  const current = map.get(patternRef);
  if (current) current.push(relation);
  else map.set(patternRef, [relation]);
}

function specForPatternSlice(
  pattern: ServicePattern,
  systemId: string,
  startStationRef: EntityRef,
  endStationRef: EntityRef,
  directionPreference: string | undefined,
): RunSpec {
  const trace = sortedTrace(pattern.traceSequence);
  const startIndex = trace.findIndex((entry) => entry.stationRef === startStationRef);
  const endIndex = trace.findIndex((entry) => entry.stationRef === endStationRef);
  const forward = startIndex <= endIndex;
  return {
    systemId,
    patternRef: pattern.patternId,
    startStationRef,
    endStationRef,
    directionHint: directionPreferenceToHint(directionPreference)
      ?? (forward ? pattern.directionConvention.forwardDirection : pattern.directionConvention.reverseDirection),
  };
}

function patternSliceCost(pattern: ServicePattern, startStationRef: EntityRef, endStationRef: EntityRef): number {
  const trace = sortedTrace(pattern.traceSequence);
  const startIndex = trace.findIndex((entry) => entry.stationRef === startStationRef);
  const endIndex = trace.findIndex((entry) => entry.stationRef === endStationRef);
  if (startIndex < 0 || endIndex < 0) return Number.POSITIVE_INFINITY;
  const from = Math.min(startIndex, endIndex);
  const to = Math.max(startIndex, endIndex);
  const edgeRefs = new Set(pattern.edgeSequence.slice(from, to));
  return pattern.pathSegments
    .filter((segment) => edgeRefs.has(segment.edgeRef))
    .reduce((sum, segment) => sum + Math.max(1, segment.distanceMeters), 0);
}

function unreachable(reason: string, suggestions: readonly PathPreset[]): {
  error: Exclude<PlanTripResult, { status: "ok" }>;
} {
  return {
    error: {
      status: "unreachable",
      reason,
      suggestions: [...suggestions],
    },
  };
}

function buildTripResultSegment(args: {
  system: SystemContext;
  context: RunContext;
  pattern: ServicePattern;
  preset?: PathPreset;
  segmentIndex: number;
}): { segment: TripResultSegment; runtimeArtifacts: TripSegmentRuntimeArtifacts } {
  const path = args.context.path!;
  const resolvedPath = args.context.resolvedPath!;
  const trace = sortedTrace(path.traceSequence);
  const first = trace[0];
  const last = trace[trace.length - 1] ?? first;
  const timeline = args.context.timeline ?? [];
  const segmentId = `segment:${fingerprint({
    runId: args.context.runId,
    pathId: resolvedPath.pathId,
    patternRef: args.pattern.patternId,
  }).slice(0, 16)}`;
  const segment: TripResultSegment = {
    segmentId,
    lineLabel: args.preset?.serviceLabel
      ?? args.system.graph.displayStore.patternDisplay[args.pattern.patternId]?.displayName
      ?? args.pattern.displayName
      ?? args.pattern.serviceType,
    displayColor: args.preset?.displayColor
      ?? args.system.graph.displayStore.patternDisplay[args.pattern.patternId]?.displayColor
      ?? args.pattern.displayColor
      ?? "#64748b",
    fromStation: stationMeta(args.system, first.stationRef),
    toStation: stationMeta(args.system, last.stationRef),
    viaStations: trace.map((entry) => stationStop(args.system, entry, timeline)),
    landmarkLabel: args.preset?.landmarkLabels[0],
    distanceKm: Number((resolvedPath.totalDistanceMeters / 1000).toFixed(3)),
    timeMinutes: tripDurationMinutes(args.context) ?? args.preset?.estimatedTimeMinutes ?? Math.max(1, Math.round(resolvedPath.totalDistanceMeters / 1000)),
    geometry: resolvedPath.geometry,
    mileageProfile: mileageProfileFromResolvedPath({
      pattern: args.pattern,
      resolvedPath,
      trace,
      timeline,
    }),
    events: (args.context.events ?? []).flatMap((event) => tripEventFromRunEvent(args.system, event)),
    mileageEvents: args.context.mileageUserEvents ? [...args.context.mileageUserEvents] : undefined,
  };
  return {
    segment,
    runtimeArtifacts: {
      segmentId,
      segmentIndex: args.segmentIndex,
      systemRef: args.pattern.systemRef,
      lineRef: args.pattern.lineRef,
      patternRef: args.pattern.patternId,
      companyRef: args.pattern.companyRef,
      serviceType: args.pattern.serviceType,
      direction: resolvedPath.direction,
      runPath: path,
      resolvedPath,
    },
  };
}

function withTransferEvent(args: {
  segment: TripResultSegment;
  previous: TripResultSegment;
  transfer: TransferScore | undefined;
}): TripResultSegment {
  const transferStationRef = args.transfer?.stationRef;
  const transferStation = transferStationRef
    ? args.segment.fromStation.stationRef === transferStationRef
      ? args.segment.fromStation
      : args.previous.toStation.stationRef === transferStationRef
        ? args.previous.toStation
        : undefined
    : undefined;
  const transferEvent: TripEvent = {
    type: "transfer",
    source: "transfer",
    label: transferStation ? `Transfer: ${transferStation.name}` : "Transfer",
    timestamp: args.segment.viaStations[0]?.arrivalTime ?? args.segment.viaStations[0]?.departureTime,
    fromLine: args.previous.lineLabel,
    toLine: args.segment.lineLabel,
    transferMode: args.transfer?.transferMode ?? "alight",
    walkMinutes: args.transfer?.walkMinutes ?? 0,
    waitMinutes: args.transfer?.waitMinutes,
    costMeters: args.transfer?.costMeters,
    reason: args.transfer?.reason,
  };
  return {
    ...args.segment,
    events: [transferEvent, ...args.segment.events],
  };
}

function tripEventFromRunEvent(system: SystemContext, event: RunEvent): TripEvent[] {
  switch (event.eventType) {
    case "platform_stop": {
      const stationRef = event.payload?.stationRef as EntityRef | undefined;
      return stationRef ? [{
        type: "stop",
        source: "system",
        stationRef,
        platformRef: event.payload?.platformRef as EntityRef | undefined,
        stoppingPointRef: event.payload?.stoppingPointRef as EntityRef | undefined,
        label: stationName(system, stationRef),
        arrivalTime: event.timestamp,
        departureTime: event.timestamp,
      }] : [];
    }
    case "platform_pass": {
      const stationRef = event.payload?.stationRef as EntityRef | undefined;
      return stationRef ? [{
        type: "pass",
        source: "system",
        stationRef,
        platformRef: event.payload?.platformRef as EntityRef | undefined,
        label: stationName(system, stationRef),
        passTime: event.timestamp,
      }] : [];
    }
    case "line_transfer":
      return [{
        type: "transfer",
        source: "transfer",
        label: "Transfer",
        timestamp: event.timestamp,
      }];
    case "scenic_view":
      return [{
        type: "scenic",
        source: "system",
        label: "Scenic view",
        timestamp: event.timestamp,
        viewSide: vehicleViewSide(event),
      }];
    case "user_defined":
      return [{
        type: "note",
        source: "user",
        label: "Note",
        timestamp: event.timestamp,
      }];
    default:
      return [];
  }
}

function stationStop(
  system: SystemContext,
  entry: ServiceTraceEntry,
  timeline: readonly { orderIndex: number; timestamp?: string }[],
): StationStop {
  const time = timeline.find((point) => point.orderIndex === entry.orderIndex)?.timestamp;
  return {
    station: stationMeta(system, entry.stationRef),
    stopType: entry.passageType === "stop" ? "stop" : "pass",
    platformRef: entry.platformRef,
    stoppingPointRef: entry.passageType === "stop" ? entry.stoppingPointRef : undefined,
    platformNumber: entry.passageType === "stop" ? entry.platformNumber : undefined,
    platformName: entry.passageType === "stop" ? entry.platformName : undefined,
    arrivalTime: time,
    departureTime: time,
  };
}

function stationMeta(system: SystemContext, stationRef: EntityRef): StationMeta {
  const display = system.graph.displayStore.stationDisplay[stationRef];
  const station = system.graph.indexes.stationById[stationRef];
  return {
    stationRef,
    name: display?.name ?? station?.name ?? stationRef,
    nameJa: display?.nameJa ?? station?.nameJa,
    coordinates: display?.coordinates ?? [0, 0],
    landmark: display?.landmark,
  };
}

function stationName(system: SystemContext, stationRef: EntityRef): string {
  return stationMeta(system, stationRef).name;
}

function sortedTrace(trace: readonly ServiceTraceEntry[]): ServiceTraceEntry[] {
  return [...trace].sort((left, right) => left.orderIndex - right.orderIndex);
}

function traceContainsStation(pattern: ServicePattern, stationRef: EntityRef): boolean {
  return pattern.traceSequence.some((entry) => entry.stationRef === stationRef);
}

function patternScore(pattern: ServicePattern, request: TripPlanRequest): number {
  const trace = sortedTrace(pattern.traceSequence);
  const startIndex = trace.findIndex((entry) => entry.stationRef === request.startStationRef);
  const endIndex = trace.findIndex((entry) => entry.stationRef === request.endStationRef);
  if (startIndex < 0 || endIndex < 0) return Number.POSITIVE_INFINITY;
  let score = Math.abs(endIndex - startIndex);
  if (request.viaRefs?.length) {
    for (const viaRef of request.viaRefs) {
      const viaIndex = trace.findIndex((entry) => entry.stationRef === viaRef);
      if (viaIndex < 0) score += 100000;
      else if (!indexBetween(viaIndex, startIndex, endIndex)) score += 10000;
    }
  }
  const hint = directionPreferenceToHint(request.directionPreference);
  if (hint && hint !== "unknown") {
    const convention = pattern.directionConvention;
    if (hint !== convention.forwardDirection && hint !== convention.reverseDirection) score += 1000;
  }
  return score;
}

function indexBetween(index: number, start: number, end: number): boolean {
  return start <= end
    ? index >= start && index <= end
    : index <= start && index >= end;
}

function directionPreferenceToHint(value: string | undefined): RunSpec["directionHint"] {
  if (value === "up" || value === "down" || value === "clockwise" || value === "counterclockwise" || value === "unknown") {
    return value;
  }
  return undefined;
}

function tripDurationMinutes(context: RunContext): number | undefined {
  const first = firstTimestamp(context);
  const last = lastTimestamp(context);
  if (!first || !last) return undefined;
  const start = Date.parse(first);
  const end = Date.parse(last);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.round((end - start) / 60000);
}

function firstTimestamp(context: RunContext): string | undefined {
  return context.timeline?.find((point) => point.timestamp)?.timestamp;
}

function lastTimestamp(context: RunContext): string | undefined {
  return [...(context.timeline ?? [])].reverse().find((point) => point.timestamp)?.timestamp;
}

function timeOfDay(timestamp: string): TripResult["timeOfDay"] {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function mileageProfileFromResolvedPath(args: {
  pattern: ServicePattern;
  resolvedPath: NonNullable<RunContext["resolvedPath"]>;
  trace: readonly ServiceTraceEntry[];
  timeline: readonly { orderIndex: number; timestamp?: string }[];
}): TripSegmentMileageProfile {
  const edgeMileage: TripSegmentMileageProfile["edgeMileage"] = {};
  const stationMileage: TripSegmentMileageProfile["stationMileage"] = {};
  const mileageTimeline: TripSegmentMileageProfile["timeline"] = [];
  let cursor = 0;

  for (const segment of args.resolvedPath.segments) {
    edgeMileage[segment.edgeRef] = {
      edgeRef: segment.edgeRef,
      startMeters: cursor,
      endMeters: cursor + segment.distanceMeters,
      coordinates: segment.geometry.coordinates,
    };
    cursor += segment.distanceMeters;
  }

  for (const passage of args.resolvedPath.stationPassages) {
    const traceEntry = args.trace.find((entry) => entry.stationRef === passage.stationRef);
    stationMileage[passage.stationRef] = {
      stationRef: passage.stationRef,
      distanceMeters: passage.distanceMetersFromStart,
    };
    const timestamp = args.timeline.find((point) => point.orderIndex === passage.orderIndex)?.timestamp
      ?? passage.departureTime
      ?? passage.arrivalTime;
    if (timestamp) {
      mileageTimeline.push({
        distanceMeters: passage.distanceMetersFromStart,
        timestamp,
      });
    }
    if (traceEntry?.stationRef) {
      stationMileage[traceEntry.stationRef] = {
        ...stationMileage[traceEntry.stationRef],
        stationRef: traceEntry.stationRef,
      };
    }
  }

  const firstTime = mileageTimeline[0]?.timestamp;
  const lastTime = mileageTimeline[mileageTimeline.length - 1]?.timestamp;
  return {
    systemRef: args.pattern.systemRef,
    lineRef: args.pattern.lineRef,
    patternRef: args.pattern.patternId,
    companyRef: args.pattern.companyRef,
    serviceType: args.pattern.serviceType,
    direction: args.resolvedPath.direction,
    totalDistanceMeters: args.resolvedPath.totalDistanceMeters,
    edgeSequence: args.resolvedPath.segments.map((segment) => segment.edgeRef),
    stationSequence: args.resolvedPath.stationPassages.map((passage) => passage.stationRef),
    edgeMileage,
    stationMileage,
    timeline: mileageTimeline.length >= 2 ? mileageTimeline : undefined,
    linearTimeRange: firstTime && lastTime ? {
      startTime: firstTime,
      endTime: lastTime,
      startMeters: 0,
      endMeters: Math.max(1, args.resolvedPath.totalDistanceMeters),
    } : undefined,
  };
}

function vehicleViewSide(event: RunEvent): "left" | "right" | "front" | "back" | undefined {
  const side = (event.payload?.vehicleView as { side?: unknown } | undefined)?.side;
  return side === "left" || side === "right" || side === "front" || side === "back" ? side : undefined;
}
