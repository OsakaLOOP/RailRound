// ============================================================
// Rail Graph v1 - Runtime RunContext resolver
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type { RunContext, SystemContext } from "./graph.types";
import { fingerprint } from "./fingerprint";
import { resolveEventAnchors } from "./event-anchors";
import { generateRunEvents } from "./events";
import {
  buildRenderGeometryPlan,
  resolveRunPathGeometry,
} from "./render-geometry";
import type { RunPath, RunSpec } from "./runtime.types";
import type { ServicePathSegment, ServicePattern, ServiceTraceEntry } from "./service-template.types";
import { buildRunOrder, synthesizeTimeline } from "./timeline";

export interface ResolveRunContextArgs {
  system: SystemContext;
  spec: RunSpec;
}

export function resolveRunContext(args: ResolveRunContextArgs): RunContext {
  const diagnostics: Diagnostic[] = [];
  const path = resolveRunPath(args.system, args.spec, diagnostics);
  if (!path) {
    return emptyRunContext(args.system, args.spec, diagnostics);
  }
  const resolvedPath = resolveRunPathGeometry({
    graph: args.system.graph,
    path,
    sourceGraphId: args.system.graphId,
  });
  const renderPlan = buildRenderGeometryPlan({
    graph: args.system.graph,
    path,
  });
  const orderResult = buildRunOrder(path);
  const timelineResult = synthesizeTimeline({
    order: orderResult.order,
    spec: args.spec,
    resolvedPath,
  });
  const anchorResult = resolveEventAnchors({
    graph: args.system.graph,
    path,
    order: orderResult.order,
    resolvedPath,
    timeline: timelineResult.timeline,
  });
  const eventResult = generateRunEvents({
    path,
    order: orderResult.order,
    resolvedPath,
    timeline: timelineResult.timeline,
    scenicResolutions: anchorResult.scenic,
    userDefinedResolutions: anchorResult.userDefined,
  });
  const allDiagnostics = [
    ...diagnostics,
    ...resolvedPath.diagnostics,
    ...renderPlan.diagnostics,
    ...orderResult.diagnostics,
    ...timelineResult.diagnostics,
    ...anchorResult.diagnostics,
    ...eventResult.diagnostics,
  ];
  return {
    runId: runId(args.system.graphId, args.spec, path),
    graphId: args.system.graphId,
    graph: args.system.graph,
    spec: args.spec,
    path,
    resolvedPath,
    renderPlan,
    order: orderResult.order,
    timeline: timelineResult.timeline,
    resolvedAnchors: anchorResult.scenic,
    events: eventResult.events,
    mileageUserEvents: null,
    diagnostics: allDiagnostics,
  };
}

export function resolveRunPath(
  system: SystemContext,
  spec: RunSpec,
  diagnostics: Diagnostic[] = [],
): RunPath | null {
  const pattern = system.graph.indexes.patternById[spec.patternRef];
  if (!pattern) {
    diagnostics.push(diagnostic("fatal", "RG_RUN_PATTERN_MISSING", "RunSpec.patternRef does not exist in graph.", {
      patternRef: spec.patternRef,
    }));
    return null;
  }
  if (spec.pathOverride) {
    return {
      patternRef: pattern.patternId,
      edgeSequence: [...spec.pathOverride.edgeSequence],
      traceSequence: [...(spec.pathOverride.traceSequence ?? pattern.traceSequence)],
      pathSegments: pattern.pathSegments.filter((segment) => spec.pathOverride?.edgeSequence.includes(segment.edgeRef)),
      chosenDirection: spec.directionHint ?? pattern.directionConvention.forwardDirection ?? "unknown",
      resolvedBy: "manual_override",
    };
  }
  return createRunPathFromRunSpec(pattern, spec);
}

function createRunPathFromRunSpec(pattern: ServicePattern, spec: RunSpec): RunPath {
  const trace = sortedTrace(pattern.traceSequence);
  const startIndex = trace.findIndex((entry) => entry.stationRef === spec.startStationRef);
  const endIndex = trace.findIndex((entry) => entry.stationRef === spec.endStationRef);
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) {
    return fullPatternRunPath(pattern, spec.directionHint);
  }

  const forward = startIndex <= endIndex;
  const selectedTrace = forward
    ? trace.slice(startIndex, endIndex + 1)
    : trace.slice(endIndex, startIndex + 1).reverse();
  const selectedEdges = forward
    ? pattern.edgeSequence.slice(startIndex, endIndex)
    : pattern.edgeSequence.slice(endIndex, startIndex).reverse();
  const selectedSegments = selectPathSegments(pattern.pathSegments, selectedEdges, !forward);

  return {
    patternRef: pattern.patternId,
    edgeSequence: selectedEdges,
    traceSequence: normalizeTraceOrder(selectedTrace),
    pathSegments: selectedSegments,
    chosenDirection: spec.directionHint
      ?? (forward ? pattern.directionConvention.forwardDirection : pattern.directionConvention.reverseDirection)
      ?? pattern.directionConvention.forwardDirection
      ?? "unknown",
    resolvedBy: "confirmed_template",
    loopDecision: pattern.cycleCheck
      ? {
        isLoopRun: pattern.cycleCheck.isCycle,
        directionSource: spec.directionHint ? "explicit" : "template_default",
        fullCycleDistanceMeters: pattern.pathSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
        chosenDistanceMeters: selectedSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
      }
      : undefined,
  };
}

function fullPatternRunPath(pattern: ServicePattern, direction?: RunSpec["directionHint"]): RunPath {
  return {
    patternRef: pattern.patternId,
    edgeSequence: [...pattern.edgeSequence],
    traceSequence: normalizeTraceOrder(sortedTrace(pattern.traceSequence)),
    pathSegments: normalizePathSegmentOrder(pattern.pathSegments),
    chosenDirection: direction ?? pattern.directionConvention.forwardDirection ?? "unknown",
    resolvedBy: "confirmed_template",
    loopDecision: pattern.cycleCheck
      ? {
        isLoopRun: pattern.cycleCheck.isCycle,
        directionSource: direction ? "explicit" : "template_default",
        fullCycleDistanceMeters: pattern.pathSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
        chosenDistanceMeters: pattern.pathSegments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
      }
      : undefined,
  };
}

function selectPathSegments(
  pathSegments: readonly ServicePathSegment[],
  edgeSequence: readonly string[],
  reverse: boolean,
): ServicePathSegment[] {
  const remaining = [...pathSegments];
  const selected: ServicePathSegment[] = [];
  for (const edgeRef of edgeSequence) {
    const index = remaining.findIndex((segment) => segment.edgeRef === edgeRef);
    if (index < 0) continue;
    const [segment] = remaining.splice(index, 1);
    selected.push(segment);
  }
  return normalizePathSegmentOrder(selected, reverse);
}

function normalizeTraceOrder(trace: readonly ServiceTraceEntry[]): ServiceTraceEntry[] {
  return trace.map((entry, orderIndex) => ({ ...entry, orderIndex }));
}

function normalizePathSegmentOrder(
  pathSegments: readonly ServicePathSegment[],
  reverse = false,
): ServicePathSegment[] {
  return pathSegments.map((segment, orderIndex) => ({
    ...segment,
    orderIndex,
    fromNodeRef: reverse ? segment.toNodeRef : segment.fromNodeRef,
    toNodeRef: reverse ? segment.fromNodeRef : segment.toNodeRef,
    measureRange: reverse
      ? {
        startMeasure: segment.measureRange.endMeasure,
        endMeasure: segment.measureRange.startMeasure,
      }
      : segment.measureRange,
  }));
}

function sortedTrace(traceSequence: readonly ServiceTraceEntry[]): ServiceTraceEntry[] {
  return [...traceSequence].sort((left, right) => left.orderIndex - right.orderIndex);
}

function emptyRunContext(
  system: SystemContext,
  spec: RunSpec,
  diagnostics: Diagnostic[],
): RunContext {
  return {
    runId: runId(system.graphId, spec, null),
    graphId: system.graphId,
    graph: system.graph,
    spec,
    path: null,
    resolvedPath: null,
    renderPlan: null,
    order: null,
    timeline: null,
    resolvedAnchors: null,
    events: null,
    mileageUserEvents: null,
    diagnostics,
  };
}

function runId(graphId: string, spec: RunSpec, path: RunPath | null): string {
  return `run:${fingerprint({
    graphId,
    spec,
    path: path ? {
      patternRef: path.patternRef,
      edgeSequence: path.edgeSequence,
      traceSequence: path.traceSequence,
      pathSegments: path.pathSegments,
    } : null,
  }).slice(0, 16)}`;
}

function diagnostic(level: Diagnostic["level"], code: string, message: string, context?: Record<string, unknown>): Diagnostic {
  return {
    level,
    code,
    stage: "run-resolver",
    message,
    context,
  };
}
