import { describe, expect, it } from "vitest";
import type { AggregateState } from "../rail-graph-aggregate/aggregate-state";
import { buildPatternRenderPlan } from "../rail-graph-aggregate/service-pattern/render-plan";
import type { StoredServicePattern } from "../rail-graph-aggregate/service-pattern/store";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import {
  buildRailGraph,
  buildRenderGeometryPlan,
  createRunPathFromServicePattern,
  resolveServicePatternGeometry,
} from "../rail-graph-v1/types";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import { buildAdjacency } from "../rail-graph-v1/topology";

describe("rail-graph render geometry", () => {
  it("resolves confirmed service pattern segments into stitched GeoJSON", () => {
    const topo = fixtureTopology();
    const pattern = fixturePattern();
    const graph = buildRailGraph({ baseTopology: topo, servicePatterns: [pattern] });

    const resolved = resolveServicePatternGeometry({
      graph,
      patternRef: pattern.patternId,
      sourceGraphId: "manual:graph:test",
    });

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.patternRef).toBe(pattern.patternId);
    expect(resolved.segments).toHaveLength(2);
    expect(resolved.segments[0].geometrySource).toBe("geometry_store");
    expect(resolved.geometry.coordinates).toEqual([
      [140.0000, 38.0000],
      [140.0010, 38.0000],
      [140.0020, 38.0000],
      [140.0030, 38.0000],
    ]);
    expect(resolved.totalDistanceMeters).toBe(300);
    expect(resolved.stationPassages.map((entry) => ({
      stationRef: entry.stationRef,
      distance: entry.distanceMetersFromStart,
    }))).toEqual([
      { stationRef: "manual:station:a", distance: 0 },
      { stationRef: "manual:station:b", distance: 100 },
      { stationRef: "manual:station:c", distance: 300 },
    ]);
  });

  it("falls back to edge coordinates when geometry store has no edge geometry", () => {
    const topo = fixtureTopology();
    const pattern = fixturePattern();
    const graph = buildRailGraph({ baseTopology: topo, servicePatterns: [pattern] });
    graph.geometryStore.edgeGeometries = {};

    const resolved = resolveServicePatternGeometry({
      graph,
      patternRef: pattern.patternId,
      sourceGraphId: "manual:graph:test",
    });

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.segments[0].geometrySource).toBe("edge_coordinates");
    expect(resolved.geometry.coordinates[0]).toEqual([140.0000, 38.0000]);
    expect(resolved.geometry.coordinates.at(-1)).toEqual([140.0030, 38.0000]);
  });

  it("slices measure ranges and reverses geometry for reverse traversal", () => {
    const topo = fixtureTopology();
    const pattern = fixturePattern({
      edgeSequence: ["manual:edge:e1" as EntityRef],
      pathSegments: [{
        orderIndex: 0,
        edgeRef: "manual:edge:e1" as EntityRef,
        fromNodeRef: "manual:node:b" as EntityRef,
        toNodeRef: "manual:node:a" as EntityRef,
        measureRange: { startMeasure: 0.25, endMeasure: 0.75 },
        distanceMeters: 50,
      }],
      traceSequence: [],
    });
    const graph = buildRailGraph({ baseTopology: topo, servicePatterns: [pattern] });

    const resolved = resolveServicePatternGeometry({
      graph,
      patternRef: pattern.patternId,
      sourceGraphId: "manual:graph:test",
    });

    expect(resolved.segments[0].geometry.coordinates).toEqual([
      [140.00075, 38.0000],
      [140.00025, 38.0000],
    ]);
    expect(resolved.totalDistanceMeters).toBe(50);
  });

  it("builds admin offset render plans without mutating topology coordinates", () => {
    const topo = fixtureTopology();
    const pattern = fixturePattern();
    const originalCoordinates = topo.edges[0].coordinates?.map((coord) => [...coord]);
    const graph = buildRailGraph({ baseTopology: topo, servicePatterns: [pattern] });

    const plan = buildRenderGeometryPlan({
      graph,
      path: createRunPathFromServicePattern(pattern),
      edgeOffsets: {
        "manual:edge:e1": { offsetMeters: 5, offsetSide: "right" },
      },
    });

    expect(plan.geometrySource).toBe("mixed");
    expect(plan.offsetSegments[0]).toMatchObject({
      edgeRef: "manual:edge:e1",
      offsetMeters: 5,
      offsetSide: "right",
    });
    expect(topo.edges[0].coordinates).toEqual(originalCoordinates);
  });

  it("adds resolved runtime paths to aggregate pattern render plans", () => {
    const topo = fixtureTopology();
    const patterns = [
      fixturePattern({ patternId: "manual:pattern:one" as EntityRef, displayColor: "#2563eb" }),
      fixturePattern({ patternId: "manual:pattern:two" as EntityRef, displayColor: "#dc2626" }),
    ] as StoredServicePattern[];
    const aggregate = fixtureAggregate(topo);

    const plans = buildPatternRenderPlan(aggregate, patterns);

    expect(plans).toHaveLength(2);
    expect(plans[0].resolvedPath?.totalDistanceMeters).toBe(300);
    expect(plans[1].renderGeometryPlan?.offsetSegments[0].offsetMeters).toBe(5);
    expect(plans[1].polylineSegments[0].strokeStyle.offset).toBe(5);
  });
});

function fixtureTopology(): BaseTopologyLayer {
  const edge1: TopologyEdge = {
    id: "manual:edge:e1" as EntityRef,
    fromNodeRef: "manual:node:a" as EntityRef,
    toNodeRef: "manual:node:b" as EntityRef,
    traversal: "both",
    role: "main",
    lengthMeters: 100,
    coordinates: [[140.0000, 38.0000], [140.0010, 38.0000]],
    geometryRef: "manual:geometry:e1" as EntityRef,
    physicalKind: "main",
    functionalUse: ["through", "stopping"],
    directionRole: "down",
  };
  const edge2: TopologyEdge = {
    id: "manual:edge:e2" as EntityRef,
    fromNodeRef: "manual:node:b" as EntityRef,
    toNodeRef: "manual:node:c" as EntityRef,
    traversal: "both",
    role: "main",
    lengthMeters: 200,
    coordinates: [[140.0010, 38.0000], [140.0020, 38.0000], [140.0030, 38.0000]],
    geometryRef: "manual:geometry:e2" as EntityRef,
    physicalKind: "main",
    functionalUse: ["through", "stopping"],
    directionRole: "down",
  };
  const edges = [edge1, edge2];
  return {
    nodes: [
      { id: "manual:node:a" as EntityRef, kind: "line_endpoint", coordinates: [140.0000, 38.0000] },
      { id: "manual:node:b" as EntityRef, kind: "junction", coordinates: [140.0010, 38.0000] },
      { id: "manual:node:c" as EntityRef, kind: "line_endpoint", coordinates: [140.0030, 38.0000] },
    ],
    edges,
    adjacency: buildAdjacency(edges),
    stations: [
      { id: "manual:station:a" as EntityRef, name: "A", platformRefs: ["manual:platform:a"] as EntityRef[] },
      { id: "manual:station:b" as EntityRef, name: "B", platformRefs: ["manual:platform:b"] as EntityRef[] },
      { id: "manual:station:c" as EntityRef, name: "C", platformRefs: ["manual:platform:c"] as EntityRef[] },
    ],
    platforms: [
      { id: "manual:platform:a" as EntityRef, stationRef: "manual:station:a" as EntityRef, type: "side", number: 1 },
      { id: "manual:platform:b" as EntityRef, stationRef: "manual:station:b" as EntityRef, type: "side", number: 1 },
      { id: "manual:platform:c" as EntityRef, stationRef: "manual:station:c" as EntityRef, type: "side", number: 1 },
    ],
    platformTrackBindings: [
      {
        id: "manual:binding:a-e1" as EntityRef,
        stationRef: "manual:station:a" as EntityRef,
        platformRef: "manual:platform:a" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        side: "left",
      },
      {
        id: "manual:binding:b-e1" as EntityRef,
        stationRef: "manual:station:b" as EntityRef,
        platformRef: "manual:platform:b" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        side: "right",
      },
      {
        id: "manual:binding:c-e2" as EntityRef,
        stationRef: "manual:station:c" as EntityRef,
        platformRef: "manual:platform:c" as EntityRef,
        edgeRef: "manual:edge:e2" as EntityRef,
        side: "right",
      },
    ],
    stoppingPoints: [
      {
        id: "manual:stop:a" as EntityRef,
        stationRef: "manual:station:a" as EntityRef,
        platformRef: "manual:platform:a" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        direction: "down",
        measure: 0,
        confirmation: "confirmed",
      },
      {
        id: "manual:stop:c" as EntityRef,
        stationRef: "manual:station:c" as EntityRef,
        platformRef: "manual:platform:c" as EntityRef,
        edgeRef: "manual:edge:e2" as EntityRef,
        direction: "down",
        measure: 1,
        confirmation: "confirmed",
      },
    ],
    signals: [],
    specialSections: [{
      id: "manual:section:tunnel" as EntityRef,
      category: "tunnel",
      directionSeparation: "none",
      edgeRefs: ["manual:edge:e2" as EntityRef],
    }],
    doubleTrackPairs: [],
    relations: [],
    hardConstraints: [],
  };
}

function fixturePattern(overrides: Partial<ServicePattern> = {}): ServicePattern {
  return {
    patternId: "manual:pattern:local" as EntityRef,
    lineRef: "manual:line:test" as EntityRef,
    systemRef: "manual:system:test" as EntityRef,
    serviceType: "local",
    topologyType: "linear",
    directionConvention: {
      forwardLabel: "down",
      reverseLabel: "up",
      forwardDirection: "down",
      reverseDirection: "up",
    },
    edgeSequence: ["manual:edge:e1" as EntityRef, "manual:edge:e2" as EntityRef],
    traceSequence: [
      {
        orderIndex: 0,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:a" as EntityRef,
        platformRef: "manual:platform:a" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        stoppingPointRef: "manual:stop:a" as EntityRef,
        measure: 0,
      },
      {
        orderIndex: 1,
        passageType: "pass",
        stopType: "pass_through",
        stationRef: "manual:station:b" as EntityRef,
        platformRef: "manual:platform:b" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        measureRange: { startMeasure: 1, endMeasure: 1 },
      },
      {
        orderIndex: 2,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:c" as EntityRef,
        platformRef: "manual:platform:c" as EntityRef,
        edgeRef: "manual:edge:e2" as EntityRef,
        stoppingPointRef: "manual:stop:c" as EntityRef,
        measure: 1,
      },
    ],
    pathSegments: [
      {
        orderIndex: 0,
        edgeRef: "manual:edge:e1" as EntityRef,
        fromNodeRef: "manual:node:a" as EntityRef,
        toNodeRef: "manual:node:b" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 100,
        geometryRef: "manual:geometry:e1" as EntityRef,
      },
      {
        orderIndex: 1,
        edgeRef: "manual:edge:e2" as EntityRef,
        fromNodeRef: "manual:node:b" as EntityRef,
        toNodeRef: "manual:node:c" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 200,
        geometryRef: "manual:geometry:e2" as EntityRef,
        specialSectionRefs: ["manual:section:tunnel" as EntityRef],
      },
    ],
    displayName: "Local",
    displayColor: "#2563eb",
    ...overrides,
  };
}

function fixtureAggregate(topo: BaseTopologyLayer): AggregateState {
  return {
    aggregateKey: "manual-aggregate",
    memberWorkspaceKeys: ["manual-a", "manual-b"],
    mode: "compiled-topology",
    featureCollection: { type: "FeatureCollection", features: [] },
    topo,
    diagnostics: [],
    perWorkspaceEdgeCount: { "manual-a": 1, "manual-b": 1 },
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "import",
      note: "test",
    },
  };
}
