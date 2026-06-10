import { describe, expect, it } from "vitest";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { TripResult } from "../rail-graph-v1/user-facing.types";
import type { RailwayMap, Trip } from "../store";
import {
  buildAppMileageLineContext,
  createMileageEventFromStation,
} from "../utils/mileageUserEvents";
import { buildTripDetailModel, tripDetailKeyEvents } from "../utils/railGraphTripDetailModel";

describe("rail-graph trip detail model", () => {
  it("projects saved rail-graph snapshots into rich run details", () => {
    const trip = fixtureSavedRailGraphTrip();
    const userEvent = {
      schemaVersion: "mileage-user-event-v1" as const,
      id: "event:rail:1" as EntityRef,
      kind: "user_note" as const,
      title: "Photo note",
      mileage: {
        systemRef: "manual:system:test" as EntityRef,
        lineRef: "manual:line:test" as EntityRef,
        patternRef: "manual:pattern:local" as EntityRef,
        direction: "down" as const,
        distanceMeters: 6000,
      },
      visibility: "private" as const,
    };

    const detail = buildTripDetailModel({
      trip,
      railwayData: fixtureRailwayData(),
      userEvents: [userEvent],
    });

    expect(detail.kind).toBe("rail_graph");
    expect(detail.overview).toMatchObject({
      planUsed: "auto",
      totalDistanceKm: 12.5,
      userEventCount: 1,
      segmentCount: 1,
    });
    expect(detail.segments[0]).toMatchObject({
      patternRef: "manual:pattern:local",
      lineRef: "manual:line:test",
      direction: "down",
      serviceType: "local",
      stopCount: 2,
      passCount: 1,
      userEventCount: 1,
    });
    expect(tripDetailKeyEvents(detail).map((event) => event.type)).toEqual(
      expect.arrayContaining(["departure", "arrival", "scenic", "user_event"]),
    );
    expect(detail.events.find((event) => event.userEventId === "event:rail:1")).toMatchObject({
      label: "Photo note",
      distanceMeters: 6000,
    });
  });

  it("keeps legacy GeoJSON trips and app-line user events consumable", () => {
    const railwayData = fixtureRailwayData();
    const trip: Trip = {
      id: "trip:legacy:1",
      date: "2026-01-02",
      memo: "Legacy trip",
      cost: 0,
      segments: [{
        id: "legacy:segment:1",
        lineKey: "manual:line:test",
        fromId: "manual:station:a",
        toId: "manual:station:b",
      }],
    };
    const lineContext = buildAppMileageLineContext(railwayData, "manual:line:test");
    expect(lineContext).toBeTruthy();
    if (!lineContext) return;
    const userEvent = createMileageEventFromStation({
      lineContext,
      stationId: "manual:station:b",
      title: "Legacy stop note",
      tripId: trip.id,
    });
    expect(userEvent).toBeTruthy();
    if (!userEvent) return;

    const detail = buildTripDetailModel({
      trip,
      railwayData,
      userEvents: [userEvent],
    });

    expect(detail.kind).toBe("legacy");
    expect(detail.segments[0]).toMatchObject({
      source: "legacy",
      lineKey: "manual:line:test",
      fromName: "Alpha",
      toName: "Beta",
    });
    expect(detail.overview.userEventCount).toBe(1);
    expect(detail.events.find((event) => event.type === "user_event")).toMatchObject({
      label: "Legacy stop note",
    });
  });

  it("uses readable fallback labels for unresolved legacy boundary events", () => {
    const trip: Trip = {
      id: "trip:legacy:missing-station",
      date: "2026-01-03",
      cost: 0,
      segments: [{
        id: "legacy:segment:missing",
        lineKey: "manual:line:test",
        fromId: "manual:station:missing-from",
        toId: "manual:station:missing-to",
      }],
    };

    const detail = buildTripDetailModel({
      trip,
      railwayData: fixtureRailwayData(),
      userEvents: [],
    });

    const boundaryLabels = detail.events
      .filter((event) => event.type === "departure" || event.type === "arrival")
      .map((event) => event.label);
    expect(boundaryLabels).toEqual(["Unknown", "Unknown"]);
    expect(boundaryLabels.join(" ")).not.toContain("manual:station");
  });
});

function fixtureSavedRailGraphTrip(): Trip {
  return {
    id: "trip:rail:1",
    date: "2026-01-01",
    memo: "Saved rail graph trip",
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
      viaStations: [{
        station: {
          stationRef: "manual:station:a" as EntityRef,
          name: "Alpha",
          coordinates: [140, 38],
        },
        stopType: "stop",
        departureTime: "2026-01-01T08:00:00.000Z",
      }, {
        station: {
          stationRef: "manual:station:mid" as EntityRef,
          name: "Middle",
          coordinates: [140.05, 38.05],
        },
        stopType: "pass",
      }, {
        station: {
          stationRef: "manual:station:b" as EntityRef,
          name: "Beta",
          coordinates: [140.1, 38.1],
        },
        stopType: "stop",
        arrivalTime: "2026-01-01T08:20:00.000Z",
      }],
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
        serviceType: "local",
        totalDistanceMeters: 12500,
        edgeSequence: ["manual:edge:e1" as EntityRef],
        stationSequence: [
          "manual:station:a" as EntityRef,
          "manual:station:mid" as EntityRef,
          "manual:station:b" as EntityRef,
        ],
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
          "manual:station:mid": {
            stationRef: "manual:station:mid" as EntityRef,
            distanceMeters: 6000,
          },
          "manual:station:b": {
            stationRef: "manual:station:b" as EntityRef,
            distanceMeters: 12500,
          },
        },
      },
      events: [{
        type: "scenic",
        source: "system",
        label: "Bay view",
        title: "Bay view",
        timestamp: "2026-01-01T08:10:00.000Z",
      }],
    }],
    totalDistanceKm: 12.5,
    totalTimeMinutes: 20,
    routeFingerprint: "route:fingerprint:1",
    departureTime: "2026-01-01T08:00:00.000Z",
    arrivalTime: "2026-01-01T08:20:00.000Z",
    eventTypeSummary: ["scenic"],
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
      stations: [{
        id: "manual:station:a",
        name_ja: "Alpha",
        lat: 38,
        lng: 140,
        transfers: [],
        distToNext: 12.5,
      }, {
        id: "manual:station:b",
        name_ja: "Beta",
        lat: 38.1,
        lng: 140.1,
        transfers: [],
      }],
    },
  };
}
