import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import {
  buildRailGraph,
  buildRailGraphFingerprints,
  buildSystemContext,
  fingerprint,
  sha256Hex,
} from "../rail-graph-v1/types";
import { buildAdjacency } from "../rail-graph-v1/topology";

describe("rail-graph SystemContext builder", () => {
  it("uses stable SHA-256 canonical fingerprints", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  });

  it("builds deterministic graphId and indexes", () => {
    const topo = fixtureTopology();
    const pattern = fixturePattern();
    const left = buildSystemContext({
      baseTopology: topo,
      servicePatterns: [pattern],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const right = buildSystemContext({
      baseTopology: clone(topo),
      servicePatterns: [clone(pattern)],
      createdAt: "2026-05-31T00:00:00.000Z",
    });

    expect(left.graphId).toBe(right.graphId);
    expect(left.graphId).toBe(left.fingerprints.topoHash);
    expect(left.graph.indexes.edgeById["manual:edge:e1"]).toBeTruthy();
    expect(left.graph.indexes.nodeById["manual:node:a"]).toBeTruthy();
    expect(left.graph.indexes.bindingsByEdge["manual:edge:e1"]).toEqual(["manual:binding:a-p1-e1"]);
    expect(left.graph.indexes.stoppingPointsByEdge["manual:edge:e1"]).toEqual(["manual:stop:a-p1-e1"]);
    expect(left.graph.indexes.stoppingPointsByPlatform["manual:platform:p1"]).toEqual(["manual:stop:a-p1-e1"]);
    expect(left.graph.indexes.doubleTrackPairsByEdge["manual:edge:e1"]).toEqual(["manual:double:main"]);
    expect(left.graph.indexes.edgesBySection["manual:section:bridge"]).toEqual(["manual:edge:e1"]);
    expect(left.graph.indexes.patternsByEdge["manual:edge:e1"]).toEqual(["manual:pattern:local"]);
    expect(left.graph.indexes.patternsByStation["manual:station:a"]).toEqual(["manual:pattern:local"]);
  });

  it("keeps geometry, display and event warm data outside graphId", () => {
    const topo = fixtureTopology();
    const pattern = fixturePattern();
    const base = buildSystemContext({ baseTopology: topo, servicePatterns: [pattern] });

    const geometryChanged = clone(topo);
    geometryChanged.edges[0].coordinates = [[139, 35], [139.5, 35.5]];
    geometryChanged.edges[0].geometryRef = "manual:geometry:e1-changed" as EntityRef;
    geometryChanged.edges[0].sourceSlice = { sourceFeatureRef: "changed-source" };
    geometryChanged.nodes[0].coordinates = [139, 35];
    geometryChanged.nodes[0].geometryRef = "manual:position:a-changed" as EntityRef;
    geometryChanged.specialSections[0].geometryRef = "manual:geometry:bridge-changed" as EntityRef;
    const withGeometry = buildSystemContext({ baseTopology: geometryChanged, servicePatterns: [pattern] });

    const withDisplay = buildSystemContext({
      baseTopology: topo,
      servicePatterns: [{
        ...pattern,
        displayName: "Changed label",
        displayColor: "#dc2626",
      }],
    });

    const withEvent = buildSystemContext({
      baseTopology: topo,
      servicePatterns: [pattern],
      eventLayer: {
        anchors: [{
          anchorId: "manual:event:scenic" as EntityRef,
          kind: "scenic_view",
          scenicView: { mode: "fixed_map_point", title: "View" },
        }],
      },
    });

    expect(withGeometry.graphId).toBe(base.graphId);
    expect(withDisplay.graphId).toBe(base.graphId);
    expect(withEvent.graphId).toBe(base.graphId);
    expect(withGeometry.fingerprints.geometryHash).not.toBe(base.fingerprints.geometryHash);
    expect(withDisplay.fingerprints.displayHash).not.toBe(base.fingerprints.displayHash);
    expect(withEvent.fingerprints.eventHash).not.toBe(base.fingerprints.eventHash);
  });

  it("changes graphId when topology or confirmed template order changes", () => {
    const topo = fixtureTopology();
    const pattern = fixturePattern();
    const base = buildSystemContext({ baseTopology: topo, servicePatterns: [pattern] });

    const lengthChanged = clone(topo);
    lengthChanged.edges[0].lengthMeters = 1500;
    const topologyContext = buildSystemContext({ baseTopology: lengthChanged, servicePatterns: [pattern] });

    const templateChanged = buildSystemContext({
      baseTopology: topo,
      servicePatterns: [{
        ...pattern,
        edgeSequence: ["manual:edge:e2" as EntityRef, "manual:edge:e1" as EntityRef],
      }],
    });

    expect(topologyContext.graphId).not.toBe(base.graphId);
    expect(templateChanged.graphId).not.toBe(base.graphId);
  });

  it("rejects no-direction aggregate data unless explicitly used for verification", () => {
    expect(() =>
      buildSystemContext({
        baseTopology: fixtureTopology(),
        servicePatterns: [fixturePattern()],
        sourceMode: "no-direction-graph",
      })
    ).toThrow(/no-direction aggregate data/);

    const verifyContext = buildSystemContext({
      baseTopology: fixtureTopology(),
      servicePatterns: [fixturePattern()],
      sourceMode: "no-direction-graph",
      allowNoDirection: true,
      noDirectionReason: "verify",
    });
    expect(verifyContext.diagnostics.some((diag) => diag.code === "RAIL_GRAPH_NO_DIRECTION_VERIFY_CONTEXT")).toBe(true);
  });

  it("can fingerprint an already built RailGraph", () => {
    const graph = buildRailGraph({
      baseTopology: fixtureTopology(),
      servicePatterns: [fixturePattern()],
    });
    const fingerprints = buildRailGraphFingerprints(graph);
    expect(fingerprints.topoHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprints.geometryHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

function fixtureTopology(): BaseTopologyLayer {
  const edge1: TopologyEdge = {
    id: "manual:edge:e1" as EntityRef,
    fromNodeRef: "manual:node:a" as EntityRef,
    toNodeRef: "manual:node:b" as EntityRef,
    traversal: "both" as const,
    role: "main" as const,
    geometryRef: "manual:geometry:e1" as EntityRef,
    lengthMeters: 1000,
    coordinates: [[139, 35], [139.01, 35.01]] as [number, number][],
    physicalKind: "main" as const,
    functionalUse: ["through", "stopping"],
    directionRole: "up" as const,
  };
  const edge2: TopologyEdge = {
    id: "manual:edge:e2" as EntityRef,
    fromNodeRef: "manual:node:b" as EntityRef,
    toNodeRef: "manual:node:c" as EntityRef,
    traversal: "both" as const,
    role: "main" as const,
    geometryRef: "manual:geometry:e2" as EntityRef,
    lengthMeters: 1200,
    coordinates: [[139.01, 35.01], [139.02, 35.02]] as [number, number][],
    physicalKind: "main" as const,
    functionalUse: ["through"],
    directionRole: "down" as const,
  };
  const edges = [edge1, edge2];
  return {
    nodes: [
      { id: "manual:node:a" as EntityRef, kind: "line_endpoint", coordinates: [139, 35] },
      { id: "manual:node:b" as EntityRef, kind: "junction", coordinates: [139.01, 35.01] },
      { id: "manual:node:c" as EntityRef, kind: "line_endpoint", coordinates: [139.02, 35.02] },
    ],
    edges,
    adjacency: buildAdjacency(edges),
    stations: [
      { id: "manual:station:a" as EntityRef, name: "A", platformRefs: ["manual:platform:p1" as EntityRef] },
      { id: "manual:station:b" as EntityRef, name: "B", platformRefs: ["manual:platform:p2" as EntityRef] },
    ],
    platforms: [
      { id: "manual:platform:p1" as EntityRef, stationRef: "manual:station:a" as EntityRef, type: "side", number: 1 },
      { id: "manual:platform:p2" as EntityRef, stationRef: "manual:station:b" as EntityRef, type: "side", number: 2 },
    ],
    platformTrackBindings: [
      {
        id: "manual:binding:a-p1-e1" as EntityRef,
        stationRef: "manual:station:a" as EntityRef,
        platformRef: "manual:platform:p1" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        side: "left",
        servingDirection: "up",
      },
    ],
    stoppingPoints: [
      {
        id: "manual:stop:a-p1-e1" as EntityRef,
        stationRef: "manual:station:a" as EntityRef,
        platformRef: "manual:platform:p1" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        direction: "up",
        measure: 0.2,
        confirmation: "confirmed",
      },
    ],
    signals: [],
    specialSections: [
      {
        id: "manual:section:bridge" as EntityRef,
        category: "bridge",
        directionSeparation: "none",
        edgeRefs: ["manual:edge:e1" as EntityRef],
      },
    ],
    doubleTrackPairs: [
      {
        id: "manual:double:main" as EntityRef,
        upEdgeRefs: ["manual:edge:e1" as EntityRef],
        downEdgeRefs: ["manual:edge:e2" as EntityRef],
        confirmation: "confirmed",
      },
    ],
    relations: [],
    hardConstraints: [],
  };
}

function fixturePattern(): ServicePattern {
  return {
    patternId: "manual:pattern:local" as EntityRef,
    lineRef: "manual:line:test" as EntityRef,
    systemRef: "manual:system:test" as EntityRef,
    serviceType: "local",
    topologyType: "linear",
    directionConvention: {
      forwardLabel: "up",
      reverseLabel: "down",
      forwardDirection: "up",
      reverseDirection: "down",
    },
    edgeSequence: ["manual:edge:e1" as EntityRef, "manual:edge:e2" as EntityRef],
    traceSequence: [
      {
        orderIndex: 0,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:a" as EntityRef,
        platformRef: "manual:platform:p1" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        stoppingPointRef: "manual:stop:a-p1-e1" as EntityRef,
        measure: 0.2,
        platformNumber: 1,
        platformName: "1",
        landmark: true,
      },
      {
        orderIndex: 1,
        passageType: "pass",
        stopType: "pass_through",
        stationRef: "manual:station:b" as EntityRef,
        platformRef: "manual:platform:p2" as EntityRef,
        edgeRef: "manual:edge:e2" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        landmark: true,
      },
    ],
    pathSegments: [
      {
        orderIndex: 0,
        edgeRef: "manual:edge:e1" as EntityRef,
        fromNodeRef: "manual:node:a" as EntityRef,
        toNodeRef: "manual:node:b" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 1000,
        geometryRef: "manual:geometry:e1" as EntityRef,
      },
      {
        orderIndex: 1,
        edgeRef: "manual:edge:e2" as EntityRef,
        fromNodeRef: "manual:node:b" as EntityRef,
        toNodeRef: "manual:node:c" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 1200,
        geometryRef: "manual:geometry:e2" as EntityRef,
      },
    ],
    displayName: "Local",
    displayColor: "#2563eb",
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
