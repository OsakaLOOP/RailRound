import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import type { TripResult } from "../rail-graph-v1/user-facing.types";
import { parseGeoJsonBatch } from "../core/parser";
import {
  buildDeployedSystem,
  buildSystemContext,
  planTrip,
} from "../rail-graph-v1/types";
import { buildAdjacency } from "../rail-graph-v1/topology";
import {
  buildAppMileageLineContext,
  buildRailGraphMileageLineContext,
  boundMileageEventForDisplay,
  createMileageEventFromPlace,
  createMileageEventFromStation,
  createMileageEventFromTripPosition,
  mileageEventProjectionStatus,
  nearestStationNameForEvent,
  projectEventsToTrip,
  queryEventsByMileage,
  queryEventsByText,
  queryEventsByTime,
} from "../utils/mileageUserEvents";
import { tripResultToLegacyTrip } from "../utils/railGraphTripAdapter";
import type { RailwayMap } from "../store";

describe("mileage events runtime adapter", () => {
  it("builds mileage context from rail-graph TripResult and creates mileage-only events", () => {
    const trip = fixtureTripResult();
    const lineContext = buildRailGraphMileageLineContext(trip);
    expect(lineContext).not.toBeNull();
    if (!lineContext) return;

    const event = createMileageEventFromPlace({
      lineContext,
      place: { stationRef: "manual:station:b" as EntityRef },
      title: "Runtime note",
      kind: "user_note",
      tripId: trip.tripId,
    });

    expect(event).not.toBeNull();
    expect(event?.schemaVersion).toBe("mileage-user-event-v1");
    expect(event?.mileage).toMatchObject({
      systemRef: "manual:system:test",
      lineRef: "manual:line:test",
      patternRef: "manual:pattern:local",
      distanceMeters: 100,
    });
    expect(event?.payload?.contextSource).toBe("rail_graph_runtime");
  });

  it("queries runtime events by mileage and timeline", () => {
    const trip = fixtureTripResult();
    const lineContext = buildRailGraphMileageLineContext(trip)!;
    const runtimeEvent = createMileageEventFromPlace({
      lineContext,
      place: { stationRef: "manual:station:b" as EntityRef },
      title: "Runtime note",
      tripId: trip.tripId,
    })!;

    const mileageQuery = queryEventsByMileage({
      events: [runtimeEvent],
      lineContext,
      fromMeters: 90,
      toMeters: 110,
    });
    const timeQuery = queryEventsByTime({
      events: [runtimeEvent],
      lineContext,
      fromTime: "2026-01-01T00:03:00.000Z",
      toTime: "2026-01-01T00:04:00.000Z",
    });

    expect(mileageQuery.items.map((event) => event.id)).toEqual([runtimeEvent.id]);
    expect(timeQuery.items).toHaveLength(1);
    expect(timeQuery.items[0].timestampInference).toBe("timeline");
  });

  it("projects runtime events to TripResult segments instead of legacy station lists", () => {
    const trip = fixtureTripResult();
    const lineContext = buildRailGraphMileageLineContext(trip)!;
    const runtimeEvent = createMileageEventFromPlace({
      lineContext,
      place: { distanceMeters: 250 },
      title: "Runtime midpoint",
      tripId: trip.tripId,
    })!;

    const projected = projectEventsToTrip([runtimeEvent], trip);

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      distanceMetersFromRunStart: 250,
      edgeRef: "manual:edge:e2",
      timestampInference: "timeline",
    });
  });

  it("projects saved app trips from their rail-graph product snapshot before legacy segments", () => {
    const trip = fixtureTripResult();
    const savedTrip = tripResultToLegacyTrip(trip);
    savedTrip.segments = [{
      id: "stale",
      lineKey: "missing:legacy",
      fromId: "x",
      toId: "y",
    }];
    const lineContext = buildRailGraphMileageLineContext(trip)!;
    const runtimeEvent = createMileageEventFromPlace({
      lineContext,
      place: { distanceMeters: 250 },
      title: "Saved trip event",
      tripId: savedTrip.id,
    })!;

    const projected = projectEventsToTrip([runtimeEvent], {}, savedTrip);

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      distanceMetersFromRunStart: 250,
      edgeRef: "manual:edge:e2",
      timestampInference: "timeline",
    });
  });

  it("creates trip-position events on saved rail-graph snapshots", () => {
    const trip = fixtureTripResult();
    const savedTrip = tripResultToLegacyTrip(trip);
    const event = createMileageEventFromTripPosition({
      railwayData: {},
      trip: savedTrip,
      ratio: 0.5,
      title: "Rail graph trip note",
    });

    expect(event).not.toBeNull();
    if (!event) return;
    expect(event.mileage).toMatchObject({
      systemRef: "manual:system:test",
      lineRef: "manual:line:test",
      patternRef: "manual:pattern:local",
      direction: "down",
      distanceMeters: 150,
    });
    expect(event.payload).toMatchObject({
      contextSource: "rail_graph_runtime",
      source: "rail_graph",
      tripId: savedTrip.id,
      segmentIndex: 0,
    });
    expect(projectEventsToTrip([event], {}, savedTrip)).toHaveLength(1);
  });

  it("keeps legacy app-line events compatible", () => {
    const lineKey = "app:test-line";
    const railwayData: RailwayMap = {
      [lineKey]: {
        meta: {
          company: "Test Railway",
          region: "test",
          type: "fixture",
          logo: null,
          icon: null,
        },
        stations: [
          { id: "a", name_ja: "Alpha", lat: 35.0, lng: 139.0, transfers: [], distToNext: 5 },
          { id: "b", name_ja: "Beta", lat: 35.0, lng: 139.05, transfers: [] },
        ],
      },
    };
    const lineContext = buildAppMileageLineContext(railwayData, lineKey)!;
    const event = createMileageEventFromPlace({
      lineContext,
      place: { stationRef: `app-station:${lineKey}:b` as EntityRef },
      title: "Legacy note",
    })!;

    expect(event.mileage.lineRef).toBe(`app-line:${lineKey}`);
    expect(event.payload?.contextSource).toBe("legacy_app");
    expect(projectEventsToTrip([event], railwayData, {
      id: "legacy-trip",
      date: "2026-01-01",
      segments: [{ id: "seg", lineKey, fromId: "a", toId: "b" }],
    })).toHaveLength(1);
  });

  it("keeps directly loaded GeoJSON lines compatible with mileage event projection", () => {
    const railwayData = loadWillerRailwayData();
    const lineKey = "WILLER TRAINS:宮津線";
    const line = railwayData[lineKey];
    expect(line?.stations.length).toBeGreaterThan(3);
    if (!line) return;

    const lineContext = buildAppMileageLineContext(railwayData, lineKey);
    expect(lineContext).not.toBeNull();
    if (!lineContext) return;

    const from = line.stations[0];
    const to = line.stations[2];
    const event = createMileageEventFromStation({
      lineContext,
      stationId: to.id,
      title: "GeoJSON legacy time note",
      tripId: "legacy-geojson-trip",
    });
    expect(event).not.toBeNull();
    if (!event) return;

    expect(event.mileage.lineRef).toBe(`app-line:${lineKey}`);
    expect(event.payload?.contextSource).toBe("legacy_app");
    expect(nearestStationNameForEvent(event, railwayData)).toBe(to.name_ja);
    expect(queryEventsByText([event], railwayData, "GeoJSON")).toHaveLength(1);

    const display = boundMileageEventForDisplay(event, railwayData);
    expect(display?.lineContext.lineKey).toBe(lineKey);
    expect(mileageEventProjectionStatus(event, railwayData)).toMatchObject({
      state: "warning",
      code: "linear_time",
      lineKey,
    });

    const projected = projectEventsToTrip([event], railwayData, {
      id: "legacy-geojson-trip",
      date: "2026-06-04",
      segments: [{ id: "geojson-seg", lineKey, fromId: from.id, toId: to.id }],
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].timestampInference).toBe("linear");
  });

  it("infers scenic viewpoint data on legacy GeoJSON axes without blocking projection", () => {
    const lineKey = "app:test-scenic-line";
    const railwayData: RailwayMap = {
      [lineKey]: {
        meta: {
          company: "Test Railway",
          region: "test",
          type: "fixture",
          logo: null,
          color: "#0f766e",
        },
        stations: [
          { id: "a", name_ja: "Alpha", lat: 35.0, lng: 139.0, transfers: [], distToNext: 5 },
          { id: "b", name_ja: "Beta", lat: 35.0, lng: 139.05, transfers: [] },
        ],
      },
    };
    const lineContext = buildAppMileageLineContext(railwayData, lineKey)!;
    const event = createMileageEventFromPlace({
      lineContext,
      place: { coordinates: [139.04, 35.01] },
      title: "Window view",
      kind: "scenic",
    })!;

    expect(event.payload?.viewpoint).toMatchObject({
      facing: "left",
      source: "inferred_from_geojson",
      coordinates: [139.04, 35.01],
    });
    expect(event.payload?.targetCoordinates).toEqual([139.04, 35.01]);
    expect(typeof event.payload?.viewpoint?.targetBearingDegrees).toBe("number");

    const display = boundMileageEventForDisplay(event, railwayData);
    expect(display?.bound.scenicVisibility?.status).not.toBe("unavailable");
    expect(display?.bound.scenicVisibility?.facing).toBe("left");
    expect(display?.bound.scenicVisibility?.confidence).toBeGreaterThan(0);

    const stationEvent = createMileageEventFromStation({
      lineContext,
      stationId: "a",
      title: "Default side view",
      kind: "scenic",
    })!;
    expect(stationEvent.payload).not.toHaveProperty("targetCoordinates");
    expect(stationEvent.payload?.viewpoint).toMatchObject({
      facing: "right",
      source: "inferred_from_geojson",
    });
    expect(stationEvent.payload?.viewpoint?.coordinates).toBeUndefined();
    expect(stationEvent.payload?.viewpoint?.targetBearingDegrees).toBeGreaterThan(150);
    expect(stationEvent.payload?.viewpoint?.targetBearingDegrees).toBeLessThan(210);
  });
});

function loadWillerRailwayData(): RailwayMap {
  const filePath = path.resolve("public", "geojson", "WILLER TRAINS.geojson");
  const source = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  return parseGeoJsonBatch([{ json: source, company: "WILLER TRAINS" }]).railwayUpdates;
}

function fixtureTripResult(): TripResult {
  const pattern = fixturePattern();
  const system = buildSystemContext({
    baseTopology: fixtureTopology(),
    servicePatterns: [pattern],
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
  const planned = planTrip({
    system,
    deployed,
    request: {
      presetId: deployed.generatedPresets[0].presetId,
      systemId: deployed.systemId,
      startStationRef: "manual:station:a" as EntityRef,
      endStationRef: "manual:station:c" as EntityRef,
    },
  });
  if (planned.status !== "ok") throw new Error(`Fixture trip failed: ${planned.reason}`);
  return planned.trip;
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
