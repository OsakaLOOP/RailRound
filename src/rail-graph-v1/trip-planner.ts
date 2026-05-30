// ============================================================
// Rail Graph v1 - User-facing trip planner
// ============================================================

import type { DeployedSystem, PathPreset, PlanTripResult, TripPlanRequest } from "./deployment.types";
import type { RunEvent } from "./event.types";
import type { RunContext, SystemContext } from "./graph.types";
import type { EntityRef } from "./primitives";
import type { RunSpec } from "./runtime.types";
import type { ServicePattern, ServiceTraceEntry } from "./service-template.types";
import type {
  StationMeta,
  StationStop,
  TripEvent,
  TripResult,
  TripResultSegment,
} from "./user-facing.types";
import { fingerprint } from "./fingerprint";
import { resolveRunContext } from "./run-resolver";

export interface PlanTripArgs {
  system: SystemContext;
  deployed?: DeployedSystem | null;
  request: TripPlanRequest;
}

export function planTrip(args: PlanTripArgs): PlanTripResult {
  const preset = args.request.presetId
    ? args.deployed?.generatedPresets.find((item) => item.presetId === args.request.presetId)
    : undefined;

  if (args.request.presetId && !preset) {
    return {
      status: "invalid_request",
      reason: "Preset was not found in deployed system.",
    };
  }

  const specResult = preset
    ? { spec: preset.runSpec, planUsed: "preset" as const, preset }
    : resolveSpecFromRequest(args.system, args.request, args.deployed?.generatedPresets ?? []);
  if ("error" in specResult) return specResult.error;

  const context = resolveRunContext({
    system: args.system,
    spec: specResult.spec,
  });
  if (!context.path || !context.resolvedPath) {
    return {
      status: "unreachable",
      reason: context.diagnostics.find((diag) => diag.level === "fatal")?.message ?? "Run path could not be resolved.",
      suggestions: args.deployed?.generatedPresets,
    };
  }

  return {
    status: "ok",
    trip: buildTripResult({
      system: args.system,
      context,
      preset: specResult.preset,
      planUsed: specResult.planUsed,
    }),
  };
}

export function buildTripResult(args: {
  system: SystemContext;
  context: RunContext;
  preset?: PathPreset;
  planUsed: TripResult["planUsed"];
}): TripResult {
  if (!args.context.path || !args.context.resolvedPath) {
    throw new Error("Cannot build TripResult without a resolved run path.");
  }
  const pattern = args.system.graph.indexes.patternById[args.context.path.patternRef];
  if (!pattern) {
    throw new Error(`Cannot build TripResult; pattern is missing: ${args.context.path.patternRef}`);
  }
  const departureTime = firstTimestamp(args.context);
  const arrivalTime = lastTimestamp(args.context);
  const segment = buildTripResultSegment({
    system: args.system,
    context: args.context,
    pattern,
    preset: args.preset,
  });
  return {
    tripId: `trip:${fingerprint({
      runId: args.context.runId,
      presetId: args.preset?.presetId,
      departureTime,
      arrivalTime,
    }).slice(0, 16)}`,
    presetId: args.preset?.presetId,
    planUsed: args.planUsed,
    segments: [segment],
    totalDistanceKm: segment.distanceKm,
    totalTimeMinutes: segment.timeMinutes,
    routeFingerprint: fingerprint({
      graphId: args.system.graphId,
      runId: args.context.runId,
      segments: [{
        patternRef: pattern.patternId,
        pathId: args.context.resolvedPath.pathId,
      }],
    }),
    departureTime,
    arrivalTime,
    timeOfDay: departureTime ? timeOfDay(departureTime) : undefined,
    eventTypeSummary: [...new Set((args.context.events ?? []).map((event) => event.eventType))],
    internalRunPaths: [args.context.path],
  };
}

function resolveSpecFromRequest(
  system: SystemContext,
  request: TripPlanRequest,
  suggestions: readonly PathPreset[],
): {
  spec: RunSpec;
  planUsed: "confirmed_template";
  preset?: undefined;
} | {
  error: Exclude<PlanTripResult, { status: "ok" }>;
} {
  if (!request.patternRef) {
    return {
      error: {
        status: "invalid_request",
        reason: "TripPlanRequest.patternRef is required when presetId is not supplied.",
      },
    };
  }
  const pattern = system.graph.indexes.patternById[request.patternRef];
  if (!pattern) {
    return {
      error: {
        status: "unreachable",
        reason: "Requested service pattern was not found.",
        suggestions: [...suggestions],
      },
    };
  }
  if (!traceContainsStation(pattern, request.startStationRef) || !traceContainsStation(pattern, request.endStationRef)) {
    return {
      error: {
        status: "unreachable",
        reason: "Requested station pair is not covered by the service pattern.",
        suggestions: [...suggestions],
      },
    };
  }
  return {
    spec: {
      systemId: request.systemId,
      patternRef: pattern.patternId,
      startStationRef: request.startStationRef,
      endStationRef: request.endStationRef,
      viaRefs: request.viaRefs,
      directionHint: directionPreferenceToHint(request.directionPreference),
    },
    planUsed: "confirmed_template",
  };
}

function buildTripResultSegment(args: {
  system: SystemContext;
  context: RunContext;
  pattern: ServicePattern;
  preset?: PathPreset;
}): TripResultSegment {
  const path = args.context.path!;
  const resolvedPath = args.context.resolvedPath!;
  const trace = sortedTrace(path.traceSequence);
  const first = trace[0];
  const last = trace[trace.length - 1] ?? first;
  const timeline = args.context.timeline ?? [];
  return {
    lineRef: args.pattern.lineRef,
    patternRef: args.pattern.patternId,
    systemRef: args.pattern.systemRef,
    companyRef: args.pattern.companyRef,
    lineLabel: args.preset?.serviceLabel
      ?? args.system.graph.displayStore.patternDisplay[args.pattern.patternId]?.displayName
      ?? args.pattern.displayName
      ?? args.pattern.serviceType,
    displayColor: args.preset?.displayColor
      ?? args.system.graph.displayStore.patternDisplay[args.pattern.patternId]?.displayColor
      ?? args.pattern.displayColor
      ?? "#64748b",
    serviceType: args.pattern.serviceType,
    direction: resolvedPath.direction,
    fromStation: stationMeta(args.system, first.stationRef),
    toStation: stationMeta(args.system, last.stationRef),
    viaStations: trace.map((entry) => stationStop(args.system, entry, timeline)),
    landmarkLabel: args.preset?.landmarkLabels[0],
    distanceKm: Number((resolvedPath.totalDistanceMeters / 1000).toFixed(3)),
    timeMinutes: tripDurationMinutes(args.context) ?? args.preset?.estimatedTimeMinutes ?? Math.max(1, Math.round(resolvedPath.totalDistanceMeters / 1000)),
    resolvedPath,
    geometry: resolvedPath.geometry,
    events: (args.context.events ?? []).flatMap((event) => tripEventFromRunEvent(args.system, event)),
    mileageEvents: args.context.mileageUserEvents ? [...args.context.mileageUserEvents] : undefined,
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

function vehicleViewSide(event: RunEvent): "left" | "right" | "front" | "back" | undefined {
  const side = (event.payload?.vehicleView as { side?: unknown } | undefined)?.side;
  return side === "left" || side === "right" || side === "front" || side === "back" ? side : undefined;
}
