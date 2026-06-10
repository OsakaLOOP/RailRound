// ============================================================
// Rail Graph v1 - Confirmed ServicePattern validation
// ============================================================

import type {
  BaseTopologyLayer,
  PlatformTrackBinding,
  StoppingPoint,
} from "./base-topology.types";
import type { Diagnostic } from "./diagnostic-types";
import type { EntityRef } from "./primitives";
import type {
  ServicePattern,
  ServiceStopEntry,
  ServiceTraceEntry,
} from "./service-template.types";

export interface ServicePatternValidationResult {
  patternRef?: EntityRef;
  diagnostics: Diagnostic[];
}

export interface ValidateServicePatternOptions {
  /**
   * When true, a pass entry with platformRef must also have a confirmed
   * platform-track binding for the same station/edge/platform tuple.
   * Stop entries are always strict.
   */
  requirePassPlatformBinding?: boolean;
}

export function validateServicePatternShape(value: unknown): ServicePattern {
  if (!value || typeof value !== "object") throw new Error("ServicePattern must be an object.");
  const pattern = value as ServicePattern;
  if (!pattern.patternId) throw new Error("ServicePattern.patternId is required.");
  if (!pattern.lineRef) throw new Error(`ServicePattern[${pattern.patternId}].lineRef is required.`);
  if (!pattern.systemRef) throw new Error(`ServicePattern[${pattern.patternId}].systemRef is required.`);
  if (!pattern.serviceType) throw new Error(`ServicePattern[${pattern.patternId}].serviceType is required.`);
  if (!pattern.topologyType) throw new Error(`ServicePattern[${pattern.patternId}].topologyType is required.`);
  if (!pattern.directionConvention) throw new Error(`ServicePattern[${pattern.patternId}].directionConvention is required.`);
  if (!Array.isArray(pattern.edgeSequence)) throw new Error(`ServicePattern[${pattern.patternId}].edgeSequence must be an array.`);
  if (!Array.isArray(pattern.traceSequence)) throw new Error(`ServicePattern[${pattern.patternId}].traceSequence must be an array.`);
  if (!Array.isArray(pattern.pathSegments)) throw new Error(`ServicePattern[${pattern.patternId}].pathSegments must be an array.`);
  return pattern;
}

export function validateServicePatternAgainstTopology(
  topo: BaseTopologyLayer,
  pattern: ServicePattern,
  options: ValidateServicePatternOptions = {},
): ServicePatternValidationResult {
  const diagnostics: Diagnostic[] = [];
  const edgeRefs = new Set(topo.edges.map((edge) => edge.id));
  const stationRefs = new Set(topo.stations.map((station) => station.id));
  const platformRefs = new Set(topo.platforms.map((platform) => platform.id));
  const stoppingPointRefs = new Set(topo.stoppingPoints.map((point) => point.id));

  for (const [index, edgeRef] of pattern.edgeSequence.entries()) {
    if (!edgeRefs.has(edgeRef)) {
      diagnostics.push(error("SERVICE_PATTERN_EDGE_MISSING", "Pattern edgeSequence references a missing topology edge.", {
        patternRef: pattern.patternId,
        index,
        edgeRef,
      }));
    }
  }

  for (const [index, segment] of pattern.pathSegments.entries()) {
    if (!edgeRefs.has(segment.edgeRef)) {
      diagnostics.push(error("SERVICE_PATTERN_SEGMENT_EDGE_MISSING", "Path segment references a missing topology edge.", {
        patternRef: pattern.patternId,
        index,
        edgeRef: segment.edgeRef,
      }));
    }
    if (!pattern.edgeSequence.includes(segment.edgeRef)) {
      diagnostics.push(warn("SERVICE_PATTERN_SEGMENT_OUTSIDE_EDGE_SEQUENCE", "Path segment edge is not listed in edgeSequence.", {
        patternRef: pattern.patternId,
        index,
        edgeRef: segment.edgeRef,
      }));
    }
  }

  for (const [index, trace] of pattern.traceSequence.entries()) {
    validateTraceEntry({
      topo,
      trace,
      index,
      patternRef: pattern.patternId,
      edgeRefs,
      stationRefs,
      platformRefs,
      stoppingPointRefs,
      requirePassPlatformBinding: options.requirePassPlatformBinding ?? false,
      diagnostics,
    });
  }

  return { patternRef: pattern.patternId, diagnostics };
}

export function assertServicePatternValidForTopology(
  topo: BaseTopologyLayer,
  pattern: ServicePattern,
  options?: ValidateServicePatternOptions,
): ServicePattern {
  const result = validateServicePatternAgainstTopology(topo, pattern, options);
  const blocking = result.diagnostics.filter((diag) => diag.level === "error" || diag.level === "fatal");
  if (blocking.length > 0) {
    throw new Error(
      `ServicePattern[${pattern.patternId}] is not valid for topology: `
      + blocking.map((diag) => `${diag.code}: ${diag.message}`).join("; "),
    );
  }
  return pattern;
}

export function hasBlockingServicePatternDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diag) => diag.level === "error" || diag.level === "fatal");
}

function validateTraceEntry(args: {
  topo: BaseTopologyLayer;
  trace: ServiceTraceEntry;
  index: number;
  patternRef: EntityRef;
  edgeRefs: Set<EntityRef>;
  stationRefs: Set<EntityRef>;
  platformRefs: Set<EntityRef>;
  stoppingPointRefs: Set<EntityRef>;
  requirePassPlatformBinding: boolean;
  diagnostics: Diagnostic[];
}): void {
  const context = {
    patternRef: args.patternRef,
    index: args.index,
    stationRef: args.trace.stationRef,
    edgeRef: args.trace.edgeRef,
  };

  if (!args.edgeRefs.has(args.trace.edgeRef)) {
    args.diagnostics.push(error("SERVICE_PATTERN_TRACE_EDGE_MISSING", "Trace entry references a missing topology edge.", context));
  }
  if (!args.stationRefs.has(args.trace.stationRef)) {
    args.diagnostics.push(error("SERVICE_PATTERN_TRACE_STATION_MISSING", "Trace entry references a missing confirmed station.", context));
  }

  if (args.trace.passageType === "stop") {
    validateStopTrace(args.topo, args.trace, context, args);
    return;
  }

  if (args.trace.platformRef && !args.platformRefs.has(args.trace.platformRef)) {
    args.diagnostics.push(error("SERVICE_PATTERN_TRACE_PLATFORM_MISSING", "Pass entry references a missing platform.", {
      ...context,
      platformRef: args.trace.platformRef,
    }));
  }
  if (args.trace.platformRef && args.requirePassPlatformBinding) {
    const binding = findBinding(args.topo.platformTrackBindings, {
      stationRef: args.trace.stationRef,
      platformRef: args.trace.platformRef,
      edgeRef: args.trace.edgeRef,
    });
    if (!binding) {
      args.diagnostics.push(error("SERVICE_PATTERN_PASS_BINDING_MISSING", "Pass entry platformRef has no confirmed PlatformTrackBinding.", {
        ...context,
        platformRef: args.trace.platformRef,
      }));
    }
  }
}

function validateStopTrace(
  topo: BaseTopologyLayer,
  trace: ServiceStopEntry,
  context: Record<string, unknown>,
  args: {
    platformRefs: Set<EntityRef>;
    stoppingPointRefs: Set<EntityRef>;
    diagnostics: Diagnostic[];
  },
): void {
  if (!args.platformRefs.has(trace.platformRef)) {
    args.diagnostics.push(error("SERVICE_PATTERN_STOP_PLATFORM_MISSING", "Stop entry references a missing platform.", {
      ...context,
      platformRef: trace.platformRef,
    }));
  }
  if (!args.stoppingPointRefs.has(trace.stoppingPointRef)) {
    args.diagnostics.push(error("SERVICE_PATTERN_STOP_POINT_MISSING", "Stop entry references a missing stopping point.", {
      ...context,
      platformRef: trace.platformRef,
      stoppingPointRef: trace.stoppingPointRef,
    }));
  }

  const binding = findBinding(topo.platformTrackBindings, trace);
  if (!binding) {
    args.diagnostics.push(error("SERVICE_PATTERN_STOP_BINDING_MISSING", "Stop entry has no confirmed PlatformTrackBinding for station/platform/edge.", {
      ...context,
      platformRef: trace.platformRef,
      stoppingPointRef: trace.stoppingPointRef,
    }));
  }

  const stoppingPoint = topo.stoppingPoints.find((point) => point.id === trace.stoppingPointRef);
  if (stoppingPoint && !stoppingPointMatchesTrace(stoppingPoint, trace)) {
    args.diagnostics.push(error("SERVICE_PATTERN_STOP_POINT_MISMATCH", "Stopping point does not match the stop trace station/platform/edge.", {
      ...context,
      platformRef: trace.platformRef,
      stoppingPointRef: trace.stoppingPointRef,
      actual: {
        stationRef: stoppingPoint.stationRef,
        platformRef: stoppingPoint.platformRef,
        edgeRef: stoppingPoint.edgeRef,
      },
    }));
  }
}

function findBinding(
  bindings: PlatformTrackBinding[],
  input: { stationRef: EntityRef; platformRef: EntityRef; edgeRef: EntityRef },
): PlatformTrackBinding | undefined {
  return bindings.find((binding) =>
    binding.stationRef === input.stationRef
    && binding.platformRef === input.platformRef
    && binding.edgeRef === input.edgeRef
  );
}

function stoppingPointMatchesTrace(point: StoppingPoint, trace: ServiceStopEntry): boolean {
  return point.stationRef === trace.stationRef
    && point.platformRef === trace.platformRef
    && point.edgeRef === trace.edgeRef;
}

function error(code: string, message: string, context?: Record<string, unknown>): Diagnostic {
  return diagnostic("error", code, message, context);
}

function warn(code: string, message: string, context?: Record<string, unknown>): Diagnostic {
  return diagnostic("warn", code, message, context);
}

function diagnostic(
  level: Diagnostic["level"],
  code: string,
  message: string,
  context?: Record<string, unknown>,
): Diagnostic {
  return {
    level,
    code,
    stage: "service-template-validation",
    message,
    context,
  };
}
