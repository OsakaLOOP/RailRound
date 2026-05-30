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
  createRunPathFromServicePattern,
  resolveRunPathGeometry,
} from "./render-geometry";
import type { RunPath, RunSpec } from "./runtime.types";
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
  return createRunPathFromServicePattern(pattern, spec.directionHint);
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
