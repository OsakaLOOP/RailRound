// ============================================================
// Rail Graph v1 - Event anchor resolution
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type {
  BoundUserEvent,
  EventAnchor,
  RunOrder,
  ScenicViewResolution,
  TimelinePoint,
} from "./event.types";
import type { GeoJSONPosition } from "./geojson";
import type { RailGraph } from "./graph.types";
import type { EntityRef } from "./primitives";
import type { ResolvedGeoJsonPath, RunPath } from "./runtime.types";
import { timelinePointByOrderIndex } from "./timeline";

export interface ResolveEventAnchorsResult {
  scenic: ScenicViewResolution[];
  userDefined: BoundUserEvent[];
  diagnostics: Diagnostic[];
}

export function resolveEventAnchors(args: {
  graph: RailGraph;
  path: RunPath;
  order: RunOrder;
  resolvedPath?: ResolvedGeoJsonPath | null;
  timeline?: readonly TimelinePoint[] | null;
}): ResolveEventAnchorsResult {
  const scenic: ScenicViewResolution[] = [];
  const userDefined: BoundUserEvent[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const anchor of args.graph.eventLayer.anchors) {
    const binding = bindAnchorToRun(anchor, args.path, args.order, args.resolvedPath);
    if (anchor.kind === "scenic_view" && anchor.scenicView) {
      const timelinePoint = binding.orderIndex !== undefined
        ? timelinePointByOrderIndex(args.timeline, binding.orderIndex)
        : undefined;
      scenic.push({
        anchorRef: anchor.anchorId,
        orderIndex: binding.orderIndex,
        timestamp: timelinePoint?.timestamp,
        entityRefs: binding.entityRefs,
        geometryRef: anchor.geometryRef,
        vehicleView: resolveVehicleView(anchor, binding.segmentCoordinates),
      });
      continue;
    }
    if (anchor.kind === "user_defined" && anchor.userDefined) {
      const timelinePoint = binding.orderIndex !== undefined
        ? timelinePointByOrderIndex(args.timeline, binding.orderIndex)
        : undefined;
      userDefined.push({
        anchorRef: anchor.anchorId,
        orderIndex: binding.orderIndex,
        timestamp: timelinePoint?.timestamp,
        entityRefs: [
          ...binding.entityRefs,
          ...(anchor.userDefined.entityRefs ?? []),
        ],
      });
    }
  }

  return { scenic, userDefined, diagnostics };
}

function bindAnchorToRun(
  anchor: EventAnchor,
  path: RunPath,
  order: RunOrder,
  resolvedPath: ResolvedGeoJsonPath | null | undefined,
): {
  orderIndex?: number;
  entityRefs: EntityRef[];
  segmentCoordinates?: GeoJSONPosition[];
} {
  if (anchor.geometryRef) {
    const segment = resolvedPath?.segments.find((item) =>
      item.edgeRef === anchor.geometryRef || item.geometryRef === anchor.geometryRef
    );
    if (segment) {
      return {
        orderIndex: segment.orderIndex,
        entityRefs: [segment.edgeRef],
        segmentCoordinates: segment.geometry.coordinates,
      };
    }
    const matchingTrace = path.traceSequence.find((trace) =>
      trace.stationRef === anchor.geometryRef
      || trace.edgeRef === anchor.geometryRef
      || trace.platformRef === anchor.geometryRef
      || (trace.passageType === "stop" && trace.stoppingPointRef === anchor.geometryRef)
    );
    if (matchingTrace) {
      return {
        orderIndex: matchingTrace.orderIndex,
        entityRefs: [anchor.geometryRef],
      };
    }
  }

  const firstStation = order.orderPoints.find((point) => point.pointKind === "station");
  const firstSegment = resolvedPath?.segments[0];
  return {
    orderIndex: firstStation?.orderIndex ?? firstSegment?.orderIndex,
    entityRefs: firstStation ? [firstStation.entityRef] : firstSegment ? [firstSegment.edgeRef] : [],
    segmentCoordinates: firstSegment?.geometry.coordinates,
  };
}

function resolveVehicleView(
  anchor: EventAnchor,
  segmentCoordinates: GeoJSONPosition[] | undefined,
): ScenicViewResolution["vehicleView"] | undefined {
  const scenic = anchor.scenicView;
  if (!scenic) return undefined;
  const runDirectionBearingDegrees = bearingFromCoordinates(segmentCoordinates) ?? 0;
  const relativeBearingDegrees = scenic.mapBearingDegrees !== undefined
    ? normalizeSignedBearing(scenic.mapBearingDegrees - runDirectionBearingDegrees)
    : sideToRelativeBearing(scenic.side);
  return {
    side: scenic.side && scenic.side !== "unknown"
      ? scenic.side
      : sideFromRelativeBearing(relativeBearingDegrees),
    relativeBearingDegrees,
    runDirectionBearingDegrees,
  };
}

function bearingFromCoordinates(coordinates: GeoJSONPosition[] | undefined): number | undefined {
  if (!coordinates || coordinates.length < 2) return undefined;
  return bearingDegrees(coordinates[0], coordinates[1]);
}

function bearingDegrees(from: GeoJSONPosition, to: GeoJSONPosition): number {
  const fromLat = toRadians(from[1]);
  const toLat = toRadians(to[1]);
  const deltaLng = toRadians(to[0] - from[0]);
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat)
    - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

function sideFromRelativeBearing(relativeBearingDegrees: number): "left" | "right" | "front" | "back" | "unknown" {
  const abs = Math.abs(relativeBearingDegrees);
  if (abs <= 45) return "front";
  if (abs >= 135) return "back";
  return relativeBearingDegrees > 0 ? "right" : "left";
}

function sideToRelativeBearing(side: "left" | "right" | "front" | "back" | "unknown" | undefined): number {
  switch (side) {
    case "left": return -90;
    case "right": return 90;
    case "back": return 180;
    case "front": return 0;
    default: return 0;
  }
}

function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeSignedBearing(value: number): number {
  const normalized = normalizeBearing(value);
  return normalized > 180 ? normalized - 360 : normalized;
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function toDegrees(value: number): number {
  return value * 180 / Math.PI;
}
