import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { TimetableSet } from "../rail-graph-v1/deployment.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import {
  buildDeployedSystem,
  buildSystemContext,
  fingerprint,
  resolveRunContext,
} from "../rail-graph-v1/types";
import { buildAdjacency } from "../rail-graph-v1/topology";

describe("rail-graph deployment", () => {
  it("publishes confirmed templates and deterministic presets", () => {
    const pattern = fixturePattern();
    const system = buildSystemContext({
      baseTopology: fixtureTopology(),
      servicePatterns: [pattern],
      displayStore: {
        patternDisplay: {
          [pattern.patternId]: {
            displayName: "Local A-C",
            displayColor: "#2563eb",
          },
        },
        stationDisplay: {
          ["manual:station:b"]: {
            stationRef: "manual:station:b" as EntityRef,
            name: "B",
            coordinates: [140.001, 38],
            landmark: true,
          },
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const timetable: TimetableSet = {
      setId: "manual:timetable:local" as EntityRef,
      label: "Base timetable",
      patternRef: pattern.patternId,
      entries: [
        { stationRef: "manual:station:a" as EntityRef, departureTime: "2026-01-01T00:00:00.000Z" },
        { stationRef: "manual:station:c" as EntityRef, arrivalTime: "2026-01-01T00:08:00.000Z" },
      ],
    };

    const result = buildDeployedSystem({
      system,
      systemId: "manual:system:test",
      version: "v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      defaultTimetables: [timetable],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.deployed.sourceGraphId).toBe(system.graphId);
    expect(result.deployed.templates).toHaveLength(1);
    expect(result.deployed.templates[0]).toMatchObject({
      patternRef: pattern.patternId,
      displayName: "Local A-C",
      displayColor: "#2563eb",
    });
    expect(result.deployed.templates[0].resolvedPath.geometry.coordinates.length).toBeGreaterThan(1);
    expect(result.deployed.relations.map((relation) => relation.id)).toEqual(["manual:relation:transfer"]);

    const preset = result.deployed.generatedPresets[0];
    expect(preset.runSpec).toMatchObject({
      systemId: "manual:system:test",
      patternRef: pattern.patternId,
      startStationRef: "manual:station:a",
      endStationRef: "manual:station:c",
      viaRefs: ["manual:station:b"],
    });
    expect(preset).toMatchObject({
      label: "A - C",
      serviceLabel: "Local A-C",
      displayColor: "#2563eb",
      distanceKm: 0.3,
      estimatedTimeMinutes: 8,
      landmarkLabels: ["B"],
    });
    expect(result.deployed.presetHashes[preset.presetId]).toBe(resolveRunContext({
      system,
      spec: preset.runSpec,
    }).runId);
  });

  it("keeps content hashes stable and excludes admin draft state", () => {
    const pattern = fixturePattern();
    const baseTopology = fixtureTopology();
    const system = buildSystemContext({
      baseTopology,
      servicePatterns: [pattern],
      provenance: [{
        entityRef: pattern.patternId,
        sourceRef: "admin:draft:1",
        sourceType: "manual",
        importedAt: "2026-01-01T00:00:00.000Z",
        confidence: "manual",
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const deployedA = buildDeployedSystem({
      system,
      systemId: "manual:system:test",
      version: "v1",
      createdAt: "2026-01-01T00:00:00.000Z",
    }).deployed;
    const deployedB = buildDeployedSystem({
      system,
      systemId: "manual:system:test",
      version: "v1",
      createdAt: "2026-02-01T00:00:00.000Z",
    }).deployed;

    expect(deployedA.contentHash).toBe(deployedB.contentHash);
    expect(JSON.stringify(deployedA)).not.toContain("admin:draft:1");
  });

  it("separates topology graphId from deployed display content", () => {
    const baseTopology = fixtureTopology();
    const pattern = fixturePattern();
    const blue = buildSystemContext({
      baseTopology,
      servicePatterns: [{ ...pattern, displayColor: "#2563eb" }],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const red = buildSystemContext({
      baseTopology,
      servicePatterns: [{ ...pattern, displayColor: "#dc2626" }],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const blueDeploy = buildDeployedSystem({
      system: blue,
      systemId: "manual:system:test",
      version: "v1",
      createdAt: "2026-01-01T00:00:00.000Z",
    }).deployed;
    const redDeploy = buildDeployedSystem({
      system: red,
      systemId: "manual:system:test",
      version: "v1",
      createdAt: "2026-01-01T00:00:00.000Z",
    }).deployed;

    expect(blue.graphId).toBe(red.graphId);
    expect(blue.fingerprints.displayHash).not.toBe(red.fingerprints.displayHash);
    expect(blueDeploy.contentHash).not.toBe(redDeploy.contentHash);
    expect(fingerprint(blueDeploy.generatedPresets)).not.toBe(fingerprint(redDeploy.generatedPresets));
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
    relations: [{
      id: "manual:relation:transfer" as EntityRef,
      kind: "transfer",
      fromRef: "manual:station:b" as EntityRef,
      toRef: "manual:station:c" as EntityRef,
    }],
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
        landmark: true,
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
