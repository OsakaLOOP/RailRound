import type { EntityRef } from "../../rail-graph-v1/primitives";
import { buildSystemContext } from "../../rail-graph-v1/graph-builder";
import {
  buildRenderGeometryPlan,
  createRunPathFromServicePattern,
  resolveServicePatternGeometry,
} from "../../rail-graph-v1/render-geometry";
import type { RenderGeometryPlan, ResolvedGeoJsonPath } from "../../rail-graph-v1/runtime.types";
import type { AggregateState } from "../aggregate-state";
import type { CrossPatternPath } from "../cross-pattern/types";
import { nodeCoordinate } from "../no-direction-graph";
import type { StoredServicePattern } from "./store";

export interface PatternRenderPlan {
  patternId: EntityRef;
  displayName?: string;
  displayColor: string;
  polylineSegments: PatternPolylineSegment[];
  stationMarkers: PatternStationMarker[];
  resolvedPath?: ResolvedGeoJsonPath;
  renderGeometryPlan?: RenderGeometryPlan;
}

export interface PatternPolylineSegment {
  edgeRef: EntityRef;
  coords: [number, number][];
  strokeStyle: {
    color: string;
    weight: number;
    dashArray?: string;
    offset?: number;
  };
}

export interface PatternStationMarker {
  stationRef: EntityRef;
  orderIndex: number;
  coord: [number, number] | null;
  label?: string;
}

export function buildPatternRenderPlan(
  aggregate: AggregateState,
  patterns: StoredServicePattern[],
): PatternRenderPlan[] {
  const edgesById = new Map(aggregate.topo.edges.map((edge) => [edge.id, edge] as const));
  const edgeUseOrder = buildEdgeUseOrder(patterns);
  const context = buildSystemContext({
    baseTopology: aggregate.topo,
    servicePatterns: patterns,
    sourceMode: aggregate.mode,
    allowNoDirection: aggregate.mode === "no-direction-graph",
    noDirectionReason: aggregate.mode === "no-direction-graph" ? "verify" : undefined,
  });
  const graph = context.graph;

  return patterns.map((pattern, patternIndex) => {
    const edgeOffsets = buildPatternEdgeOffsets(edgeUseOrder, pattern);
    return {
      patternId: pattern.patternId,
      displayName: pattern.displayName,
      displayColor: pattern.displayColor || fallbackColor(patternIndex),
      polylineSegments: pattern.edgeSequence.flatMap((edgeRef) => {
      const edge = edgesById.get(edgeRef);
      if (!edge?.coordinates || edge.coordinates.length < 2) return [];
      const useIndex = edgeUseOrder.get(edgeRef)?.indexOf(pattern.patternId) ?? 0;
      return [{
        edgeRef,
        coords: edge.coordinates,
        strokeStyle: {
          color: pattern.displayColor || fallbackColor(patternIndex),
          weight: 4,
          dashArray: useIndex % 2 === 1 ? "6 4" : undefined,
          offset: useIndex * 5,
        },
      }];
      }),
      stationMarkers: pattern.traceSequence.map((trace) => ({
        stationRef: trace.stationRef,
        orderIndex: trace.orderIndex,
        coord: nodeCoordinate(aggregate.topo, trace.stationRef),
        label: String(trace.stationRef),
      })),
      resolvedPath: resolveServicePatternGeometry({
        graph,
        patternRef: pattern.patternId,
        sourceGraphId: context.graphId,
      }),
      renderGeometryPlan: buildRenderGeometryPlan({
        graph,
        path: createRunPathFromServicePattern(pattern),
        edgeOffsets,
      }),
    };
  });
}

export function buildCrossPatternRenderPlan(
  aggregate: AggregateState,
  crossPath: CrossPatternPath,
): PatternRenderPlan {
  const edgesById = new Map(aggregate.topo.edges.map((edge) => [edge.id, edge] as const));
  const colors = ["#dc2626", "#0891b2", "#7c3aed", "#16a34a"];
  return {
    patternId: "aggregate:cross-pattern:selected" as EntityRef,
    displayName: "Route Query",
    displayColor: colors[0],
    polylineSegments: crossPath.hops.flatMap((hop, hopIndex) =>
      hop.edgeSequence.flatMap((edgeRef) => {
        const edge = edgesById.get(edgeRef);
        if (!edge?.coordinates || edge.coordinates.length < 2) return [];
        return [{
          edgeRef,
          coords: edge.coordinates,
          strokeStyle: {
            color: colors[hopIndex % colors.length],
            weight: 6,
            dashArray: hopIndex % 2 === 1 ? "8 5" : undefined,
            offset: hopIndex * 6,
          },
        }];
      })
    ),
    stationMarkers: crossPath.hops.flatMap((hop) =>
      hop.stationSequence.map((stationRef, orderIndex) => ({
        stationRef,
        orderIndex,
        coord: nodeCoordinate(aggregate.topo, stationRef),
        label: stationRef,
      }))
    ),
  };
}

function buildEdgeUseOrder(patterns: StoredServicePattern[]): Map<EntityRef, EntityRef[]> {
  const out = new Map<EntityRef, EntityRef[]>();
  for (const pattern of patterns) {
    for (const edgeRef of pattern.edgeSequence) {
      const list = out.get(edgeRef) ?? [];
      if (!list.includes(pattern.patternId)) list.push(pattern.patternId);
      out.set(edgeRef, list);
    }
  }
  return out;
}

function buildPatternEdgeOffsets(
  edgeUseOrder: Map<EntityRef, EntityRef[]>,
  pattern: StoredServicePattern,
): Record<string, { offsetMeters: number; offsetSide: "right" }> {
  const out: Record<string, { offsetMeters: number; offsetSide: "right" }> = {};
  for (const edgeRef of pattern.edgeSequence) {
    const useIndex = edgeUseOrder.get(edgeRef)?.indexOf(pattern.patternId) ?? 0;
    out[edgeRef] = {
      offsetMeters: useIndex * 5,
      offsetSide: "right",
    };
  }
  return out;
}

function fallbackColor(index: number): string {
  const colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];
  return colors[index % colors.length];
}
