import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { DeployedSystem } from "../rail-graph-v1/deployment.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import {
  buildDeployedSystem,
  buildSystemContext,
  planTrip,
  resolveRunContext,
} from "../rail-graph-v1/types";
import { buildAdjacency } from "../rail-graph-v1/topology";
import { planRailGraphTripForApp, tripResultToAppSegments } from "../utils/railGraphTripAdapter";

describe("rail-graph trip planner", () => {
  it("plans a trip directly from a deployed preset", () => {
    const { system, deployed } = fixtureDeployment();
    const preset = deployed.generatedPresets[0];

    const result = planTrip({
      system,
      deployed,
      request: {
        presetId: preset.presetId,
        systemId: deployed.systemId,
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:c" as EntityRef,
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.trip.presetId).toBe(preset.presetId);
    expect(result.trip.planUsed).toBe("preset");
    expect(result.trip.totalDistanceKm).toBe(0.3);
    expect(result.trip.totalTimeMinutes).toBe(10);
    expect(result.trip.segments[0].geometry.coordinates.length).toBeGreaterThan(1);
    expect(result.trip.segments[0].events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "stop",
      "pass",
      "scenic",
      "note",
    ]));
    expect(result.trip.segments[0].events.filter((event) => event.type === "stop")).toHaveLength(2);
    expect(deployed.presetHashes[preset.presetId]).toBe(resolveRunContext({
      system,
      spec: preset.runSpec,
    }).runId);
  });

  it("plans from confirmed template station refs without mutating old routing", () => {
    const { system, pattern } = fixtureDeployment();
    const result = planTrip({
      system,
      request: {
        systemId: "manual:system:test",
        patternRef: pattern.patternId,
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:c" as EntityRef,
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.trip.planUsed).toBe("confirmed_template");
    expect(result.trip.segments[0].fromStation.name).toBe("A");
    expect(result.trip.segments[0].toStation.name).toBe("C");
    expect(result.trip.eventTypeSummary).toContain("scenic_view");
  });

  it("returns unreachable with suggestions for unmatched station requests", () => {
    const { system, deployed, pattern } = fixtureDeployment();
    const result = planTrip({
      system,
      deployed,
      request: {
        systemId: "manual:system:test",
        patternRef: pattern.patternId,
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:missing" as EntityRef,
      },
    });

    expect(result.status).toBe("unreachable");
    if (result.status !== "unreachable") return;
    expect(result.suggestions?.[0].presetId).toBe(deployed.generatedPresets[0].presetId);
  });

  it("adapts TripResult to app TripSegment shape", () => {
    const { system, deployed } = fixtureDeployment();
    const preset = deployed.generatedPresets[0];
    const result = planRailGraphTripForApp({
      system,
      deployed,
      request: {
        presetId: preset.presetId,
        systemId: deployed.systemId,
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:c" as EntityRef,
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.trip.segments[0]).toMatchObject({
      lineKey: "manual:line:test",
      fromId: "manual:station:a",
      toId: "manual:station:c",
      railGraphPatternRef: "manual:pattern:local",
      eventCount: 5,
    });
    expect(result.trip.segments[0].geometry[0]).toEqual([38, 140]);
    expect(tripResultToAppSegments(result.trip.tripResult)).toHaveLength(1);
  });
});

function fixtureDeployment(): {
  system: ReturnType<typeof buildSystemContext>;
  deployed: DeployedSystem;
  pattern: ServicePattern;
} {
  const pattern = fixturePattern();
  const system = buildSystemContext({
    baseTopology: fixtureTopology(),
    servicePatterns: [pattern],
    eventLayer: {
      anchors: [
        {
          anchorId: "manual:event:scenic" as EntityRef,
          kind: "scenic_view",
          geometryRef: "manual:edge:e2" as EntityRef,
          scenicView: {
            mode: "directional_view",
            title: "Bay view",
            side: "right",
          },
        },
        {
          anchorId: "manual:event:user-note" as EntityRef,
          kind: "user_defined",
          geometryRef: "manual:station:b" as EntityRef,
          userDefined: {
            eventKey: "note",
            title: "Crowding note",
          },
        },
      ],
    },
    displayStore: {
      patternDisplay: {
        [pattern.patternId]: {
          displayName: "Local A-C",
          displayColor: "#2563eb",
        },
      },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const deployed = buildDeployedSystem({
    system,
    systemId: "manual:system:test",
    version: "v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    defaultTimetables: [{
      setId: "manual:timetable:local",
      label: "Base timetable",
      patternRef: pattern.patternId,
      entries: [
        { stationRef: "manual:station:a" as EntityRef, departureTime: "2026-01-01T00:00:00.000Z" },
        { stationRef: "manual:station:c" as EntityRef, arrivalTime: "2026-01-01T00:10:00.000Z" },
      ],
    }],
  }).deployed;
  return { system, deployed, pattern };
}

function fixtureTopology(): BaseTopologyLayer {
  const edge1: TopologyEdge = {
    id: "manual:edge:e1" as EntityRef,
    fromNodeRef: "manual:node:a" as EntityRef,
    toNodeRef: "manual:node:b" as EntityRef,
    traversal: "both",
    role: "main",
    lengthMeters: 100,
    coordinates: [[140.0000, 38.0000], [140.0010, 38.0000]],
    geometryRef: "manual:edge:e1" as EntityRef,
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
    coordinates: [[140.0010, 38.0000], [140.0010, 38.0010]],
    geometryRef: "manual:edge:e2" as EntityRef,
    physicalKind: "main",
    functionalUse: ["through", "stopping"],
    directionRole: "down",
  };
  const edges = [edge1, edge2];
  return {
    nodes: [
      { id: "manual:node:a" as EntityRef, kind: "line_endpoint", coordinates: [140.0000, 38.0000] },
      { id: "manual:node:b" as EntityRef, kind: "junction", coordinates: [140.0010, 38.0000] },
      { id: "manual:node:c" as EntityRef, kind: "line_endpoint", coordinates: [140.0010, 38.0010] },
    ],
    edges,
    adjacency: buildAdjacency(edges),
    stations: [
      { id: "manual:station:a" as EntityRef, name: "A", platformRefs: ["manual:platform:a" as EntityRef] },
      { id: "manual:station:b" as EntityRef, name: "B", platformRefs: ["manual:platform:b" as EntityRef] },
      { id: "manual:station:c" as EntityRef, name: "C", platformRefs: ["manual:platform:c" as EntityRef] },
    ],
    platforms: [
      { id: "manual:platform:a" as EntityRef, stationRef: "manual:station:a" as EntityRef, type: "side", number: 1 },
      { id: "manual:platform:b" as EntityRef, stationRef: "manual:station:b" as EntityRef, type: "side", number: 1 },
      { id: "manual:platform:c" as EntityRef, stationRef: "manual:station:c" as EntityRef, type: "side", number: 1 },
    ],
    platformTrackBindings: [
      { id: "manual:binding:a" as EntityRef, stationRef: "manual:station:a" as EntityRef, platformRef: "manual:platform:a" as EntityRef, edgeRef: "manual:edge:e1" as EntityRef, side: "left" },
      { id: "manual:binding:b" as EntityRef, stationRef: "manual:station:b" as EntityRef, platformRef: "manual:platform:b" as EntityRef, edgeRef: "manual:edge:e1" as EntityRef, side: "right" },
      { id: "manual:binding:c" as EntityRef, stationRef: "manual:station:c" as EntityRef, platformRef: "manual:platform:c" as EntityRef, edgeRef: "manual:edge:e2" as EntityRef, side: "right" },
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
        geometryRef: "manual:edge:e1" as EntityRef,
      },
      {
        orderIndex: 1,
        edgeRef: "manual:edge:e2" as EntityRef,
        fromNodeRef: "manual:node:b" as EntityRef,
        toNodeRef: "manual:node:c" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 200,
        geometryRef: "manual:edge:e2" as EntityRef,
      },
    ],
  };
}
