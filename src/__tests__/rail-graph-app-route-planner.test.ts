import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import type { RailwayMap, RailGraphRuntimeState } from "../store";
import { useStore } from "../store";
import { parseGeoJsonBatch } from "../core/parser";
import { buildAdjacency } from "../rail-graph-v1/topology";
import { buildDeployedSystem, buildSystemContext } from "../rail-graph-v1/types";
import { loadDefaultRailGraphDeployment, parseRailGraphDeploymentBundle } from "../services/railGraphDeploymentLoader";
import { planAppRoute, planAppRouteCandidates } from "../utils/appRoutePlanner";
import { tripResultToLegacyTrip } from "../utils/railGraphTripAdapter";

describe("rail-graph app route planner facade", () => {
  it("uses rail-graph runtime before legacy routing when the result is app-consumable", () => {
    const runtime = fixtureRuntime();
    const result = planAppRoute({
      startLineKey: "manual:line:test",
      startStationId: "manual:station:a",
      endLineKey: "manual:line:test",
      endStationId: "manual:station:c",
      railwayData: fixtureRailwayData(),
      railGraphRuntime: runtime,
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("rail_graph");
    if (result.status !== "ok") return;
    expect(result.segments[0]).toMatchObject({
      lineKey: "manual:line:test",
      fromId: "manual:station:a",
      toId: "manual:station:c",
      railGraphPatternRef: "manual:pattern:local",
    });
  });

  it("returns app-consumable rail-graph route candidates for TripEditor selection", () => {
    const runtime = fixtureRuntime();
    const result = planAppRouteCandidates({
      startLineKey: "manual:line:test",
      startStationId: "manual:station:a",
      endLineKey: "manual:line:test",
      endStationId: "manual:station:c",
      railwayData: fixtureRailwayData(),
      railGraphRuntime: runtime,
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("rail_graph");
    if (result.status !== "ok") return;
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.best.source).toBe("rail_graph");
    if (result.best.source !== "rail_graph") return;
    expect(result.best).toMatchObject({
      candidateKind: expect.stringMatching(/preset|pattern|auto/),
      patternRef: "manual:pattern:local",
      direction: "down",
      serviceType: "local",
      viaStationCount: 1,
    });
    expect(result.best.segments[0]).toMatchObject({
      lineKey: "manual:line:test",
      fromId: "manual:station:a",
      toId: "manual:station:c",
    });
  });

  it("falls back to legacy routing when no rail-graph runtime is loaded", () => {
    const result = planAppRoute({
      startLineKey: "manual:line:test",
      startStationId: "manual:station:a",
      endLineKey: "manual:line:test",
      endStationId: "manual:station:c",
      railwayData: fixtureRailwayData(),
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("legacy");
    if (result.status !== "ok") return;
    expect(result.segments[0]).toMatchObject({
      lineKey: "manual:line:test",
      fromId: "manual:station:a",
      toId: "manual:station:c",
    });
  });

  it("returns a legacy candidate when rail-graph runtime is absent", () => {
    const result = planAppRouteCandidates({
      startLineKey: "manual:line:test",
      startStationId: "manual:station:a",
      endLineKey: "manual:line:test",
      endStationId: "manual:station:c",
      railwayData: fixtureRailwayData(),
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("legacy");
    if (result.status !== "ok") return;
    expect(result.best).toMatchObject({
      source: "legacy",
      candidateKind: "legacy",
    });
  });

  it("falls back to legacy routing when rail-graph output cannot be consumed by current app data", () => {
    const runtime = fixtureRuntime();
    const railwayData = fixtureRailwayData();
    railwayData["manual:line:test"].stations = railwayData["manual:line:test"].stations.map((station) => ({
      ...station,
      id: `legacy:${station.id}`,
    }));
    const result = planAppRoute({
      startLineKey: "manual:line:test",
      startStationId: "legacy:manual:station:a",
      endLineKey: "manual:line:test",
      endStationId: "legacy:manual:station:c",
      railwayData,
      railGraphRuntime: runtime,
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("legacy");
    if (result.status !== "ok" || result.source !== "legacy") return;
    expect(result.railGraphFallbackReason).toBeTruthy();
  });

  it("parses deployment bundles only when SystemContext and DeployedSystem match", () => {
    const runtime = fixtureRuntime();
    const parsed = parseRailGraphDeploymentBundle({
      system: runtime.system,
      deployed: runtime.deployed,
    });
    expect(parsed?.system.graphId).toBe(runtime.system.graphId);

    const invalid = parseRailGraphDeploymentBundle({
      system: runtime.system,
      deployed: {
        ...runtime.deployed,
        sourceGraphId: "other",
      },
    });
    expect(invalid).toBeNull();
  });

  it("loads the default bundle and plans against current GeoJSON railwayData through rail-graph", async () => {
    const bundle = readJson(path.resolve("public", "rail-graph", "deployed-system.json"));
    const loaded = await loadDefaultRailGraphDeployment({
      url: "/rail-graph/deployed-system.json",
      now: () => "2026-06-04T00:00:00.000Z",
      fetchImpl: (async () => new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
    });
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;

    const preset = loaded.runtime.deployed.generatedPresets[0];
    expect(preset).toBeTruthy();
    const template = loaded.runtime.deployed.templates.find((candidate) => candidate.patternRef === preset.patternRef);
    expect(template).toBeTruthy();
    if (!preset || !template) return;

    const railwayData = loadWillerRailwayData();
    const result = planAppRoute({
      startLineKey: String(template.lineRef),
      startStationId: String(preset.startStation),
      endLineKey: String(template.lineRef),
      endStationId: String(preset.endStation),
      railwayData,
      railGraphRuntime: loaded.runtime,
    });

    expect(result.status).toBe("ok");
    expect(result.source).toBe("rail_graph");
    if (result.status !== "ok" || result.source !== "rail_graph") return;
    expect(result.trip.tripResult.segments.length).toBeGreaterThan(0);
    expect(result.trip.tripResult.totalDistanceKm).toBeGreaterThan(0);
    expect(result.trip.segments[0].geometry.length).toBeGreaterThan(1);

    const savedTrip = tripResultToLegacyTrip(result.trip.tripResult);
    expect(savedTrip.railGraph?.tripResult.routeFingerprint).toBe(result.trip.tripResult.routeFingerprint);
    expect(savedTrip.railGraph?.runtimeArtifacts).toBeUndefined();
  });

  it("tracks runtime load status and fallback reason separately from legacy routing", () => {
    const initialState = useStore.getState();
    useStore.setState(initialState, true);
    const runtime = fixtureRuntime();

    useStore.getState().setRailGraphLoadState({
      status: "loading",
      reason: "loading default deployment",
    });
    expect(useStore.getState().railGraphLoadState).toMatchObject({
      status: "loading",
      reason: "loading default deployment",
    });

    useStore.getState().setRailGraphRuntime(runtime);
    expect(useStore.getState().railGraphLoadState).toMatchObject({
      status: "loaded",
      loadedAt: runtime.loadedAt,
    });

    useStore.getState().setRailGraphLoadState({
      status: "invalid",
      reason: "bad deployment bundle",
      fallbackReason: "bad deployment bundle",
    });
    expect(useStore.getState().railGraphRuntime).toBe(runtime);
    expect(useStore.getState().railGraphLoadState).toMatchObject({
      status: "invalid",
      fallbackReason: "bad deployment bundle",
    });

    useStore.getState().clearRailGraphRuntime();
    expect(useStore.getState().railGraphRuntime).toBeNull();
    expect(useStore.getState().railGraphLoadState.status).toBe("idle");
  });
});

function loadWillerRailwayData(): RailwayMap {
  const source = readJson(path.resolve("public", "geojson", "WILLER TRAINS.geojson"));
  return parseGeoJsonBatch([{ json: source, company: "WILLER TRAINS" }]).railwayUpdates;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function fixtureRuntime(): RailGraphRuntimeState {
  const system = buildSystemContext({
    baseTopology: fixtureTopology(),
    servicePatterns: [fixturePattern()],
    displayStore: {
      patternDisplay: {
        "manual:pattern:local": {
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
  }).deployed;
  return {
    system,
    deployed,
    source: "test",
    loadedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fixtureRailwayData(): RailwayMap {
  return {
    "manual:line:test": {
      meta: {
        company: "manual",
        region: "test",
        type: "JR",
        logo: null,
      },
      stations: [
        {
          id: "manual:station:a",
          name_ja: "A",
          lat: 38.0000,
          lng: 140.0000,
          transfers: [],
          distToNext: 0.1,
        },
        {
          id: "manual:station:b",
          name_ja: "B",
          lat: 38.0000,
          lng: 140.0010,
          transfers: [],
          distToNext: 0.2,
        },
        {
          id: "manual:station:c",
          name_ja: "C",
          lat: 38.0010,
          lng: 140.0010,
          transfers: [],
        },
      ],
    },
  };
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
