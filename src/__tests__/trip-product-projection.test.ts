import { describe, expect, it } from "vitest";
import { calculateLatestStats } from "../core/tripCalculator";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { TripResult } from "../rail-graph-v1/user-facing.types";
import type { Trip } from "../store";
import {
  tripLineSummary,
  tripToKmlPathItems,
  tripProductDistanceKm,
  tripSearchText,
  tripToProductSegments,
  tripToProductRouteSegments,
  tripToRouteSliceData,
} from "../utils/tripProductProjection";

describe("trip product projection", () => {
  it("uses saved rail-graph product snapshots before stale legacy segments", () => {
    const trip = fixtureSavedRailGraphTrip();

    expect(tripToProductSegments(trip)).toMatchObject([{
      source: "rail_graph",
      lineKey: "manual:line:test",
      lineLabel: "Local A-B",
      fromName: "Alpha",
      toName: "Beta",
      distanceKm: 12.5,
    }]);
    expect(tripSearchText(trip).toLowerCase()).toContain("alpha");
    expect(tripSearchText(trip).toLowerCase()).toContain("local a-b");
    expect(tripLineSummary(trip)).toBe("Local A-B");
    expect(tripProductDistanceKm(trip)).toBe(12.5);
  });

  it("uses saved rail-graph product snapshots for latest stats cards", () => {
    const trip = fixtureSavedRailGraphTrip();

    const stats = calculateLatestStats([trip], new Map(), {}, null);

    expect(stats.lines).toBe(1);
    expect(stats.dist).toBe(12.5);
    expect(stats.latest[0]).toMatchObject({
      id: "trip:rail:1",
      title: "Local A-B",
      dist: 12.5,
    });
    expect(stats.latest[0].svg_points).toContain("M ");
  });

  it("projects saved rail-graph snapshots into route export and KML user-data surfaces", () => {
    const trip = fixtureSavedRailGraphTrip();

    expect(tripToProductRouteSegments(trip)).toEqual([{
      lineKey: "manual:line:test",
      fromId: "manual:station:a",
      toId: "manual:station:b",
      fromStation: "Alpha",
      toStation: "Beta",
    }]);

    const routeData = tripToRouteSliceData(trip);
    expect(routeData).toMatchObject({
      distance: "12.5",
      color: "#2563eb",
      meta: {
        lineKey: "manual:line:test",
        lineName: "Local A-B",
      },
      pathSegments: [{
        lineKey: "manual:line:test",
        fromName: "Alpha",
        toName: "Beta",
      }],
    });
    expect(routeData?.routeCoords).toEqual([[38, 140], [38.1, 140.1]]);

    expect(tripToKmlPathItems(trip)).toEqual([{
      name: "2026-01-01 - Trip trip:rail:1 Segment 1",
      coordinates: "140,38,0 140.1,38.1,0",
      lineKey: "manual:line:test",
    }]);
  });
});

function fixtureSavedRailGraphTrip(): Trip {
  return {
    id: "trip:rail:1",
    date: "2026-01-01",
    memo: "Saved product trip",
    cost: 0,
    segments: [{
      id: "stale",
      lineKey: "missing:legacy",
      fromId: "x",
      toId: "y",
    }],
    railGraph: {
      tripResult: fixtureTripResult(),
    },
  };
}

function fixtureTripResult(): TripResult {
  return {
    tripId: "trip:rail:1",
    planUsed: "auto",
    segments: [{
      segmentId: "segment:1",
      lineLabel: "Local A-B",
      displayColor: "#2563eb",
      fromStation: {
        stationRef: "manual:station:a" as EntityRef,
        name: "Alpha",
        coordinates: [140, 38],
      },
      toStation: {
        stationRef: "manual:station:b" as EntityRef,
        name: "Beta",
        coordinates: [140.1, 38.1],
      },
      viaStations: [],
      distanceKm: 12.5,
      timeMinutes: 20,
      geometry: {
        type: "LineString",
        coordinates: [[140, 38], [140.1, 38.1]],
      },
      mileageProfile: {
        systemRef: "manual:system:test" as EntityRef,
        lineRef: "manual:line:test" as EntityRef,
        patternRef: "manual:pattern:local" as EntityRef,
        direction: "down",
        totalDistanceMeters: 12500,
        edgeSequence: ["manual:edge:e1" as EntityRef],
        stationSequence: ["manual:station:a" as EntityRef, "manual:station:b" as EntityRef],
        edgeMileage: {
          "manual:edge:e1": {
            edgeRef: "manual:edge:e1" as EntityRef,
            startMeters: 0,
            endMeters: 12500,
          },
        },
        stationMileage: {
          "manual:station:a": {
            stationRef: "manual:station:a" as EntityRef,
            distanceMeters: 0,
          },
          "manual:station:b": {
            stationRef: "manual:station:b" as EntityRef,
            distanceMeters: 12500,
          },
        },
      },
      events: [],
    }],
    totalDistanceKm: 12.5,
    totalTimeMinutes: 20,
    routeFingerprint: "route:fingerprint:1",
    eventTypeSummary: [],
  };
}
