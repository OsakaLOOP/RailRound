// ============================================================
// Rail Graph v1 - RunOrder and timeline synthesis
// ============================================================

import type {
  OrderPoint,
  RunOrder,
  TimelinePoint,
} from "./event.types";
import type { Diagnostic } from "./diagnostic-types";
import type { EntityRef } from "./primitives";
import type { ResolvedGeoJsonPath, RunPath, RunSpec, TimetableAnchor } from "./runtime.types";
import type { ServiceTraceEntry } from "./service-template.types";

export interface BuildRunOrderResult {
  order: RunOrder;
  diagnostics: Diagnostic[];
}

export interface SynthesizeTimelineResult {
  timeline: TimelinePoint[];
  diagnostics: Diagnostic[];
}

export function buildRunOrder(path: RunPath): BuildRunOrderResult {
  const orderPoints: OrderPoint[] = [];
  const boundaries: RunOrder["boundaries"] = [];
  const seen = new Set<string>();

  for (const trace of sortedTrace(path.traceSequence)) {
    pushOrderPoint(orderPoints, seen, {
      orderIndex: trace.orderIndex,
      entityRef: trace.stationRef,
      pointKind: "station",
    });
    if (trace.platformRef) {
      pushOrderPoint(orderPoints, seen, {
        orderIndex: trace.orderIndex,
        entityRef: trace.platformRef,
        pointKind: "platform",
      });
    }
    if (trace.passageType === "stop") {
      pushOrderPoint(orderPoints, seen, {
        orderIndex: trace.orderIndex,
        entityRef: trace.stoppingPointRef,
        pointKind: "stopping_point",
      });
    }
  }

  return {
    order: { orderPoints, boundaries },
    diagnostics: [],
  };
}

export function synthesizeTimeline(args: {
  order: RunOrder;
  spec: RunSpec;
  resolvedPath?: ResolvedGeoJsonPath | null;
}): SynthesizeTimelineResult {
  const diagnostics: Diagnostic[] = [];
  const orderedIndexes = uniqueOrderIndexes(args.order);
  const anchors = collectTimelineAnchors(args.order, args.spec.timetableAnchors ?? [], args.resolvedPath);
  const timeline: TimelinePoint[] = orderedIndexes.map((orderIndex) => {
    const anchor = anchors.find((item) => item.orderIndex === orderIndex);
    if (anchor) {
      return {
        orderIndex,
        timestamp: anchor.timestamp,
        isSynthesized: false,
        sourceAnchorRef: anchor.stationRef,
        inference: "timetable",
      };
    }
    const interpolated = interpolateAnchorTime(orderIndex, anchors, args.resolvedPath);
    if (interpolated) {
      return {
        orderIndex,
        timestamp: interpolated.timestamp,
        isSynthesized: true,
        inference: interpolated.inference,
      };
    }
    return {
      orderIndex,
      isSynthesized: true,
      inference: anchors.length >= 2 ? "constant_spacing" : undefined,
    };
  });

  if ((args.spec.timetableAnchors?.length ?? 0) > 0 && anchors.length === 0) {
    diagnostics.push(diagnostic("warn", "RG_TIMELINE_ANCHOR_UNMATCHED", "Timetable anchors did not match any RunOrder station.", {
      anchors: args.spec.timetableAnchors?.map((anchor) => anchor.stationRef),
    }));
  }

  return { timeline, diagnostics };
}

export function timelinePointByOrderIndex(
  timeline: readonly TimelinePoint[] | null | undefined,
  orderIndex: number,
): TimelinePoint | undefined {
  return timeline?.find((point) => point.orderIndex === orderIndex);
}

function pushOrderPoint(
  out: OrderPoint[],
  seen: Set<string>,
  point: OrderPoint,
): void {
  const key = `${point.orderIndex}:${point.pointKind}:${point.entityRef}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(point);
}

function sortedTrace(traceSequence: readonly ServiceTraceEntry[]): ServiceTraceEntry[] {
  return [...traceSequence].sort((left, right) => left.orderIndex - right.orderIndex);
}

function uniqueOrderIndexes(order: RunOrder): number[] {
  return [...new Set(order.orderPoints.map((point) => point.orderIndex))].sort((left, right) => left - right);
}

interface MatchedTimelineAnchor {
  orderIndex: number;
  stationRef: EntityRef;
  timestamp: string;
  distanceMeters?: number;
}

function collectTimelineAnchors(
  order: RunOrder,
  anchors: readonly TimetableAnchor[],
  resolvedPath: ResolvedGeoJsonPath | null | undefined,
): MatchedTimelineAnchor[] {
  const stationPoints = order.orderPoints.filter((point) => point.pointKind === "station");
  const out: MatchedTimelineAnchor[] = [];
  for (const anchor of anchors) {
    const timestamp = anchor.departureTime ?? anchor.arrivalTime;
    if (!timestamp) continue;
    const point = stationPoints.find((item) => item.entityRef === anchor.stationRef);
    if (!point) continue;
    out.push({
      orderIndex: point.orderIndex,
      stationRef: anchor.stationRef,
      timestamp,
      distanceMeters: resolvedPath?.stationPassages.find((passage) =>
        passage.stationRef === anchor.stationRef
      )?.distanceMetersFromStart,
    });
  }
  return out.sort((left, right) => left.orderIndex - right.orderIndex);
}

function interpolateAnchorTime(
  orderIndex: number,
  anchors: readonly MatchedTimelineAnchor[],
  resolvedPath: ResolvedGeoJsonPath | null | undefined,
): { timestamp: string; inference: TimelinePoint["inference"] } | null {
  const before = [...anchors].reverse().find((anchor) => anchor.orderIndex < orderIndex);
  const after = anchors.find((anchor) => anchor.orderIndex > orderIndex);
  if (!before || !after) return null;
  const beforeTime = Date.parse(before.timestamp);
  const afterTime = Date.parse(after.timestamp);
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime)) return null;

  const passageDistance = resolvedPath?.stationPassages.find((passage) =>
    passage.orderIndex === orderIndex
  )?.distanceMetersFromStart;
  const canUseDistance = typeof passageDistance === "number"
    && typeof before.distanceMeters === "number"
    && typeof after.distanceMeters === "number"
    && after.distanceMeters !== before.distanceMeters;
  const ratio = canUseDistance
    ? (passageDistance - before.distanceMeters!) / (after.distanceMeters! - before.distanceMeters!)
    : (orderIndex - before.orderIndex) / (after.orderIndex - before.orderIndex);
  return {
    timestamp: new Date(beforeTime + (afterTime - beforeTime) * clamp01(ratio)).toISOString(),
    inference: canUseDistance ? "speed_distance" : "constant_spacing",
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function diagnostic(level: Diagnostic["level"], code: string, message: string, context?: Record<string, unknown>): Diagnostic {
  return {
    level,
    code,
    stage: "timeline",
    message,
    context,
  };
}
