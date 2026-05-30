import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import {
  assertServicePatternValidForTopology,
  hasBlockingServicePatternDiagnostics,
  validateServicePatternAgainstTopology,
  validateServicePatternShape,
} from "../rail-graph-v1/types";
import { buildAdjacency } from "../rail-graph-v1/topology";

describe("rail-graph ServicePattern validation", () => {
  it("accepts stop traces with confirmed station, platform, stopping point and binding", () => {
    const result = validateServicePatternAgainstTopology(fixtureTopology(), fixturePattern());
    expect(result.diagnostics).toEqual([]);
    expect(assertServicePatternValidForTopology(fixtureTopology(), fixturePattern()).patternId).toBe("manual:pattern:local");
  });

  it("reports missing stop binding and stopping point as blocking diagnostics", () => {
    const topo = fixtureTopology();
    topo.platformTrackBindings = [];
    topo.stoppingPoints = [];

    const result = validateServicePatternAgainstTopology(topo, fixturePattern());
    expect(hasBlockingServicePatternDiagnostics(result.diagnostics)).toBe(true);
    expect(result.diagnostics.map((diag) => diag.code)).toEqual(expect.arrayContaining([
      "SERVICE_PATTERN_STOP_BINDING_MISSING",
      "SERVICE_PATTERN_STOP_POINT_MISSING",
    ]));
    expect(() => assertServicePatternValidForTopology(topo, fixturePattern())).toThrow(/SERVICE_PATTERN_STOP_POINT_MISSING/);
  });

  it("can require pass platform refs to have confirmed bindings", () => {
    const pattern = fixturePattern();
    pattern.traceSequence.push({
      orderIndex: 1,
      passageType: "pass",
      stopType: "pass_through",
      stationRef: "manual:station:b" as EntityRef,
      platformRef: "manual:platform:p2" as EntityRef,
      edgeRef: "manual:edge:e2" as EntityRef,
      measureRange: { startMeasure: 0, endMeasure: 1 },
    });

    const relaxed = validateServicePatternAgainstTopology(fixtureTopology(), pattern);
    expect(hasBlockingServicePatternDiagnostics(relaxed.diagnostics)).toBe(false);

    const strict = validateServicePatternAgainstTopology(fixtureTopology(), pattern, {
      requirePassPlatformBinding: true,
    });
    expect(strict.diagnostics.map((diag) => diag.code)).toContain("SERVICE_PATTERN_PASS_BINDING_MISSING");
  });

  it("rejects malformed persisted shapes before topology validation", () => {
    expect(() => validateServicePatternShape({
      patternId: "manual:pattern:bad",
      lineRef: "manual:line:test",
      serviceType: "local",
      topologyType: "linear",
      directionConvention: { forwardLabel: "up", reverseLabel: "down" },
      edgeSequence: [],
      traceSequence: [],
      pathSegments: [],
    })).toThrow(/systemRef is required/);
  });
});

function fixtureTopology(): BaseTopologyLayer {
  const edge1: TopologyEdge = {
    id: "manual:edge:e1" as EntityRef,
    fromNodeRef: "manual:node:a" as EntityRef,
    toNodeRef: "manual:node:b" as EntityRef,
    traversal: "both",
    role: "main",
    lengthMeters: 1000,
    physicalKind: "main",
    functionalUse: ["through", "stopping"],
    directionRole: "up",
  };
  const edge2: TopologyEdge = {
    id: "manual:edge:e2" as EntityRef,
    fromNodeRef: "manual:node:b" as EntityRef,
    toNodeRef: "manual:node:c" as EntityRef,
    traversal: "both",
    role: "main",
    lengthMeters: 1200,
    physicalKind: "main",
    functionalUse: ["through"],
    directionRole: "down",
  };
  const edges = [edge1, edge2];
  return {
    nodes: [
      { id: "manual:node:a" as EntityRef, kind: "line_endpoint" },
      { id: "manual:node:b" as EntityRef, kind: "junction" },
      { id: "manual:node:c" as EntityRef, kind: "line_endpoint" },
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
        measure: 0.25,
        confirmation: "confirmed",
      },
    ],
    signals: [],
    specialSections: [],
    doubleTrackPairs: [],
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
        measure: 0.25,
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
      },
      {
        orderIndex: 1,
        edgeRef: "manual:edge:e2" as EntityRef,
        fromNodeRef: "manual:node:b" as EntityRef,
        toNodeRef: "manual:node:c" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 1200,
      },
    ],
  };
}
