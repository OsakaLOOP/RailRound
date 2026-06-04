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
import { planRailGraphTripForApp, tripResultToAppSegments, tripResultToLegacyTrip } from "../utils/railGraphTripAdapter";

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
    expect(result.trip.segments[0].mileageProfile).toMatchObject({
      systemRef: "manual:system:test",
      lineRef: "manual:line:test",
      patternRef: "manual:pattern:local",
      totalDistanceMeters: 300,
    });
    expect(result.runtimeArtifacts.segments[0]).toMatchObject({
      patternRef: "manual:pattern:local",
    });
    expect("internalRunPaths" in result.trip).toBe(false);
    expect("resolvedPath" in result.trip.segments[0]).toBe(false);
    expect(deployed.presetHashes[preset.presetId]).toBe(resolveRunContext({
      system,
      spec: preset.runSpec,
    }).runId);
  });

  it("plans from station refs without exposing service-pattern internals to the request or trip result", () => {
    const { system } = fixtureDeployment();
    const result = planTrip({
      system,
      request: {
        systemId: "manual:system:test",
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:c" as EntityRef,
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.trip.planUsed).toBe("auto");
    expect(result.trip.segments[0].fromStation.name).toBe("A");
    expect(result.trip.segments[0].toStation.name).toBe("C");
    expect(result.trip.eventTypeSummary).toContain("scenic");
    expect(result.runtimeArtifacts.segments[0].runPath.patternRef).toBe("manual:pattern:local");
    expect(Object.keys(result.trip.segments[0])).not.toContain("resolvedPath");
    expect(Object.keys(result.trip.segments[0])).not.toContain("patternRef");
  });

  it("returns unreachable with suggestions for unmatched station requests", () => {
    const { system, deployed } = fixtureDeployment();
    const result = planTrip({
      system,
      deployed,
      request: {
        systemId: "manual:system:test",
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
    expect(result.trip.runtimeArtifacts.segments[0].resolvedPath.pathId).toBeTruthy();
    expect(tripResultToAppSegments(result.trip.tripResult, result.trip.runtimeArtifacts)).toHaveLength(1);
  });

  it("persists rail-graph trips as product snapshots without default runtime artifacts", () => {
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
    const trip = tripResultToLegacyTrip(result.trip.tripResult, result.trip.runtimeArtifacts);
    expect(trip.railGraph?.tripResult.routeFingerprint).toBe(result.trip.tripResult.routeFingerprint);
    expect(trip.railGraph?.runtimeArtifacts).toBeUndefined();
    expect(JSON.stringify(trip.railGraph?.tripResult)).not.toContain("resolvedPath");
    expect(JSON.stringify(trip.railGraph?.tripResult)).not.toContain("internalRunPaths");
  });

  it("auto-discovers transfer points and returns multi-segment product trips", () => {
    const local = fixturePattern();
    const branch = fixtureBranchPattern();
    const system = buildSystemContext({
      baseTopology: fixtureTopologyWithBranch(),
      servicePatterns: [local, branch],
      displayStore: {
        patternDisplay: {
          [local.patternId]: { displayName: "Local A-C", displayColor: "#2563eb" },
          [branch.patternId]: { displayName: "Branch C-D", displayColor: "#dc2626" },
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const result = planTrip({
      system,
      request: {
        systemId: "manual:system:test",
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:d" as EntityRef,
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.trip.planUsed).toBe("auto");
    expect(result.trip.segments).toHaveLength(2);
    expect(result.trip.segments.map((segment) => segment.lineLabel)).toEqual(["Local A-C", "Branch C-D"]);
    expect(result.trip.segments[0].fromStation.stationRef).toBe("manual:station:a");
    expect(result.trip.segments[0].toStation.stationRef).toBe("manual:station:c");
    expect(result.trip.segments[1].fromStation.stationRef).toBe("manual:station:c");
    expect(result.trip.segments[1].toStation.stationRef).toBe("manual:station:d");
    expect(result.trip.segments[1].events[0]).toMatchObject({
      type: "transfer",
      source: "transfer",
      fromLine: "Local A-C",
      toLine: "Branch C-D",
    });
    expect(result.trip.totalDistanceKm).toBe(0.7);
    expect(result.runtimeArtifacts.segments.map((segment) => segment.patternRef)).toEqual([
      "manual:pattern:local",
      "manual:pattern:branch",
    ]);
    expect(Object.keys(result.trip.segments[1])).not.toContain("resolvedPath");
  });

  it("scores explicit transfer relations without changing fixed topology", () => {
    const local = fixturePattern();
    const branch = fixtureBranchPatternFromB();
    const system = buildSystemContext({
      baseTopology: fixtureTopologyWithBranch(),
      servicePatterns: [local, branch],
      displayStore: {
        patternDisplay: {
          [local.patternId]: { displayName: "Local A-C", displayColor: "#2563eb" },
          [branch.patternId]: { displayName: "Branch B-D", displayColor: "#dc2626" },
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const baseRequest = {
      systemId: "manual:system:test",
      startStationRef: "manual:station:a" as EntityRef,
      endStationRef: "manual:station:d" as EntityRef,
    };
    const defaultResult = planTrip({ system, request: baseRequest });
    expect(defaultResult.status).toBe("ok");
    if (defaultResult.status !== "ok") return;
    expect(defaultResult.trip.segments[0].toStation.stationRef).toBe("manual:station:b");

    const penalized = planTrip({
      system,
      request: {
        ...baseRequest,
        transferPolicy: {
          relations: [{
            fromPatternRef: local.patternId,
            toPatternRef: branch.patternId,
            stationRef: "manual:station:b" as EntityRef,
            penaltyMeters: 1000,
            reason: "crowded concourse",
          }, {
            fromPatternRef: local.patternId,
            toPatternRef: branch.patternId,
            stationRef: "manual:station:c" as EntityRef,
            walkMinutes: 2,
            waitMinutes: 3,
            penaltyMeters: 40,
            reason: "signed transfer",
          }],
        },
      },
    });
    expect(penalized.status).toBe("ok");
    if (penalized.status !== "ok") return;
    expect(penalized.trip.segments[0].toStation.stationRef).toBe("manual:station:c");
    expect(penalized.trip.segments[1].events[0]).toMatchObject({
      type: "transfer",
      walkMinutes: 2,
      waitMinutes: 3,
      costMeters: 740,
      reason: "signed transfer",
    });

    const forbidden = planTrip({
      system,
      request: {
        ...baseRequest,
        transferPolicy: {
          relations: [{
            fromPatternRef: local.patternId,
            toPatternRef: branch.patternId,
            stationRef: "manual:station:b" as EntityRef,
            forbidden: true,
            reason: "closed passage",
          }],
        },
      },
    });
    expect(forbidden.status).toBe("ok");
    if (forbidden.status !== "ok") return;
    expect(forbidden.trip.segments[0].toStation.stationRef).toBe("manual:station:c");
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

function fixtureTopologyWithBranch(): BaseTopologyLayer {
  const base = fixtureTopology();
  const edge3: TopologyEdge = {
    id: "manual:edge:e3" as EntityRef,
    fromNodeRef: "manual:node:c" as EntityRef,
    toNodeRef: "manual:node:d" as EntityRef,
    traversal: "both",
    role: "main",
    lengthMeters: 400,
    coordinates: [[140.0010, 38.0010], [140.0020, 38.0010]],
    geometryRef: "manual:edge:e3" as EntityRef,
    physicalKind: "main",
    functionalUse: ["through", "stopping"],
    directionRole: "down",
  };
  const edges = [...base.edges, edge3];
  return {
    ...base,
    nodes: [
      ...base.nodes,
      { id: "manual:node:d" as EntityRef, kind: "line_endpoint", coordinates: [140.0020, 38.0010] },
    ],
    edges,
    adjacency: buildAdjacency(edges),
    stations: [
      ...base.stations,
      { id: "manual:station:d" as EntityRef, name: "D", platformRefs: ["manual:platform:d" as EntityRef] },
    ],
    platforms: [
      ...base.platforms,
      { id: "manual:platform:d" as EntityRef, stationRef: "manual:station:d" as EntityRef, type: "side", number: 1 },
    ],
    platformTrackBindings: [
      ...base.platformTrackBindings,
      { id: "manual:binding:d" as EntityRef, stationRef: "manual:station:d" as EntityRef, platformRef: "manual:platform:d" as EntityRef, edgeRef: "manual:edge:e3" as EntityRef, side: "right" },
    ],
    stoppingPoints: [
      ...base.stoppingPoints,
      {
        id: "manual:stop:d" as EntityRef,
        stationRef: "manual:station:d" as EntityRef,
        platformRef: "manual:platform:d" as EntityRef,
        edgeRef: "manual:edge:e3" as EntityRef,
        direction: "down",
        measure: 1,
        confirmation: "confirmed",
      },
    ],
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

function fixtureBranchPattern(): ServicePattern {
  return {
    patternId: "manual:pattern:branch" as EntityRef,
    lineRef: "manual:line:branch" as EntityRef,
    systemRef: "manual:system:test" as EntityRef,
    serviceType: "local",
    topologyType: "linear",
    directionConvention: {
      forwardLabel: "down",
      reverseLabel: "up",
      forwardDirection: "down",
      reverseDirection: "up",
    },
    edgeSequence: ["manual:edge:e3" as EntityRef],
    traceSequence: [
      {
        orderIndex: 0,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:c" as EntityRef,
        platformRef: "manual:platform:c" as EntityRef,
        edgeRef: "manual:edge:e3" as EntityRef,
        stoppingPointRef: "manual:stop:c" as EntityRef,
        measure: 0,
      },
      {
        orderIndex: 1,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:d" as EntityRef,
        platformRef: "manual:platform:d" as EntityRef,
        edgeRef: "manual:edge:e3" as EntityRef,
        stoppingPointRef: "manual:stop:d" as EntityRef,
        measure: 1,
      },
    ],
    pathSegments: [
      {
        orderIndex: 0,
        edgeRef: "manual:edge:e3" as EntityRef,
        fromNodeRef: "manual:node:c" as EntityRef,
        toNodeRef: "manual:node:d" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 400,
        geometryRef: "manual:edge:e3" as EntityRef,
      },
    ],
  };
}

function fixtureBranchPatternFromB(): ServicePattern {
  return {
    patternId: "manual:pattern:branch-from-b" as EntityRef,
    lineRef: "manual:line:branch" as EntityRef,
    systemRef: "manual:system:test" as EntityRef,
    serviceType: "local",
    topologyType: "linear",
    directionConvention: {
      forwardLabel: "down",
      reverseLabel: "up",
      forwardDirection: "down",
      reverseDirection: "up",
    },
    edgeSequence: ["manual:edge:e2" as EntityRef, "manual:edge:e3" as EntityRef],
    traceSequence: [
      {
        orderIndex: 0,
        passageType: "pass",
        stopType: "pass_through",
        stationRef: "manual:station:b" as EntityRef,
        platformRef: "manual:platform:b" as EntityRef,
        edgeRef: "manual:edge:e2" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 0 },
      },
      {
        orderIndex: 1,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:c" as EntityRef,
        platformRef: "manual:platform:c" as EntityRef,
        edgeRef: "manual:edge:e3" as EntityRef,
        stoppingPointRef: "manual:stop:c" as EntityRef,
        measure: 0,
      },
      {
        orderIndex: 2,
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:d" as EntityRef,
        platformRef: "manual:platform:d" as EntityRef,
        edgeRef: "manual:edge:e3" as EntityRef,
        stoppingPointRef: "manual:stop:d" as EntityRef,
        measure: 1,
      },
    ],
    pathSegments: [
      {
        orderIndex: 0,
        edgeRef: "manual:edge:e2" as EntityRef,
        fromNodeRef: "manual:node:b" as EntityRef,
        toNodeRef: "manual:node:c" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 200,
        geometryRef: "manual:edge:e2" as EntityRef,
      },
      {
        orderIndex: 1,
        edgeRef: "manual:edge:e3" as EntityRef,
        fromNodeRef: "manual:node:c" as EntityRef,
        toNodeRef: "manual:node:d" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 400,
        geometryRef: "manual:edge:e3" as EntityRef,
      },
    ],
  };
}
