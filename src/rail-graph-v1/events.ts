// ============================================================
// Rail Graph v1 - Runtime event stream generation
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type {
  BoundUserEvent,
  RunEvent,
  RunEventType,
  RunOrder,
  ScenicViewResolution,
  TimelinePoint,
} from "./event.types";
import type { EntityRef } from "./primitives";
import type { ResolvedGeoJsonPath, RunPath } from "./runtime.types";
import type { OperationType, ServiceTraceEntry } from "./service-template.types";
import { timelinePointByOrderIndex } from "./timeline";

export interface GenerateRunEventsResult {
  events: RunEvent[];
  diagnostics: Diagnostic[];
}

export function generateRunEvents(args: {
  path: RunPath;
  order: RunOrder;
  resolvedPath?: ResolvedGeoJsonPath | null;
  timeline?: readonly TimelinePoint[] | null;
  scenicResolutions?: readonly ScenicViewResolution[];
  userDefinedResolutions?: readonly BoundUserEvent[];
}): GenerateRunEventsResult {
  const events: RunEvent[] = [];
  for (const trace of [...args.path.traceSequence].sort((left, right) => left.orderIndex - right.orderIndex)) {
    events.push(traceEvent(trace, args.timeline));
    if (trace.passageType === "stop" && trace.operationType) {
      events.push(operationEvent(args.path.patternRef, trace, args.timeline));
    }
  }
  for (const segment of args.resolvedPath?.segments ?? []) {
    for (const sectionRef of segment.specialSectionRefs ?? []) {
      events.push({
        eventId: eventId(args.path.patternRef, "special_section_pass", segment.orderIndex, sectionRef),
        eventType: "special_section_pass",
        orderIndex: segment.orderIndex,
        timestamp: timelinePointByOrderIndex(args.timeline, segment.orderIndex)?.timestamp,
        entityRefs: [sectionRef, segment.edgeRef],
        payload: { edgeRef: segment.edgeRef },
        source: { rule: "path_segment.specialSectionRefs" },
      });
    }
  }
  for (const boundary of args.order.boundaries) {
    const eventType = boundary.kind === "line_transfer" ? "line_transfer" : "system_change";
    events.push({
      eventId: eventId(args.path.patternRef, eventType, boundary.boundaryIndex, boundary.entityRefs.join("|")),
      eventType,
      orderIndex: boundary.boundaryIndex,
      timestamp: timelinePointByOrderIndex(args.timeline, boundary.boundaryIndex)?.timestamp,
      entityRefs: boundary.entityRefs,
      source: { rule: `run_boundary.${boundary.kind}` },
    });
  }
  for (const scenic of args.scenicResolutions ?? []) {
    events.push({
      eventId: eventId(args.path.patternRef, "scenic_view", scenic.orderIndex ?? 0, scenic.anchorRef),
      eventType: "scenic_view",
      orderIndex: scenic.orderIndex ?? 0,
      timestamp: scenic.timestamp,
      entityRefs: scenic.entityRefs,
      payload: { vehicleView: scenic.vehicleView },
      source: { rule: "event_anchor.scenic_view", anchorRef: scenic.anchorRef },
    });
  }
  for (const user of args.userDefinedResolutions ?? []) {
    events.push({
      eventId: eventId(args.path.patternRef, "user_defined", user.orderIndex ?? 0, user.anchorRef),
      eventType: "user_defined",
      orderIndex: user.orderIndex ?? 0,
      timestamp: user.timestamp,
      entityRefs: user.entityRefs,
      source: { rule: "event_anchor.user_defined", anchorRef: user.anchorRef },
    });
  }

  return {
    events: sortEvents(events),
    diagnostics: [],
  };
}

function traceEvent(trace: ServiceTraceEntry, timeline: readonly TimelinePoint[] | null | undefined): RunEvent {
  const eventType: RunEventType = trace.passageType === "stop" ? "platform_stop" : "platform_pass";
  const entityRefs = [
    trace.stationRef,
    trace.platformRef,
    trace.edgeRef,
    trace.passageType === "stop" ? trace.stoppingPointRef : undefined,
  ].filter(Boolean) as EntityRef[];
  return {
    eventId: eventId(trace.stationRef, eventType, trace.orderIndex, trace.edgeRef),
    eventType,
    orderIndex: trace.orderIndex,
    timestamp: timelinePointByOrderIndex(timeline, trace.orderIndex)?.timestamp,
    entityRefs,
    payload: {
      stationRef: trace.stationRef,
      platformRef: trace.platformRef,
      edgeRef: trace.edgeRef,
      passageType: trace.passageType,
      stopType: trace.stopType,
    },
    source: { rule: "service_trace" },
  };
}

function operationEvent(
  patternRef: EntityRef,
  trace: Extract<ServiceTraceEntry, { passageType: "stop" }>,
  timeline: readonly TimelinePoint[] | null | undefined,
): RunEvent {
  const operationType = trace.operationType as OperationType;
  return {
    eventId: eventId(patternRef, operationEventType(operationType), trace.orderIndex, trace.stoppingPointRef),
    eventType: operationEventType(operationType),
    orderIndex: trace.orderIndex,
    timestamp: timelinePointByOrderIndex(timeline, trace.orderIndex)?.timestamp,
    entityRefs: [trace.stationRef, trace.platformRef, trace.edgeRef, trace.stoppingPointRef],
    payload: { operationType },
    source: { rule: "service_trace.operationType" },
  };
}

function operationEventType(operationType: OperationType): RunEventType {
  switch (operationType) {
    case "coupling": return "coupling_operation";
    case "decoupling": return "decoupling_operation";
    case "turnback": return "turnback_operation";
    case "stabling": return "stabling_operation";
  }
}

function sortEvents(events: RunEvent[]): RunEvent[] {
  return [...events].sort((left, right) =>
    left.orderIndex - right.orderIndex
    || eventRank(left.eventType) - eventRank(right.eventType)
    || left.eventId.localeCompare(right.eventId)
  );
}

function eventRank(eventType: RunEventType): number {
  switch (eventType) {
    case "platform_stop": return 10;
    case "platform_pass": return 20;
    case "coupling_operation":
    case "decoupling_operation":
    case "turnback_operation":
    case "stabling_operation": return 30;
    case "special_section_pass": return 40;
    case "system_change":
    case "service_type_change":
    case "line_transfer": return 50;
    case "through_service": return 55;
    case "scenic_view": return 60;
    case "user_defined": return 70;
    case "switch_pass": return 80;
    default: return 90;
  }
}

function eventId(scopeRef: EntityRef, eventType: RunEventType, orderIndex: number, suffix: string): string {
  return `${scopeRef}:${eventType}:${orderIndex}:${suffix}`;
}
