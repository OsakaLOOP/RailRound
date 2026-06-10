import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserData } from "../hooks/useUserData";
import { useStore } from "../store";
import type { Trip } from "../store";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { TripResult } from "../rail-graph-v1/user-facing.types";

vi.mock("../services/api", () => ({
  api: {
    getData: vi.fn(),
    saveData: vi.fn(),
  },
}));

describe("rail-graph saved trip round-trip", () => {
  const initialState = useStore.getState();
  let originalKv: unknown;

  beforeEach(() => {
    originalKv = (globalThis as any).RAILROUND_KV;
    useStore.setState(initialState, true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as any).RAILROUND_KV = originalKv;
  });

  it("preserves Trip.railGraph product snapshots through the Edge user data API", async () => {
    const { onRequest } = await import(edgeUserDataModulePath());
    const kv = makeMockKV();
    await kv.put("session:test-token", "alice");
    (globalThis as any).RAILROUND_KV = kv;
    const trip = fixtureSavedTrip();

    const post = await onRequest({
      request: new Request("https://railround.test/api/user/data", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trips: [trip],
          pins: [],
          latest_5: null,
          folders: [],
          badge_settings: { enabled: true },
          mileage_user_events: [],
          version: "test",
        }),
      }),
    } as any);
    expect(post.status).toBe(200);

    const get = await onRequest({
      request: new Request("https://railround.test/api/user/data", {
        method: "GET",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
      }),
    } as any);
    const data = await get.json();

    expect(get.status).toBe(200);
    expect(data.trips[0].railGraph.tripResult.routeFingerprint).toBe("route:fingerprint:1");
    expect(data.trips[0].railGraph.runtimeArtifacts).toBeUndefined();
    expect(JSON.stringify(data.trips[0].railGraph.tripResult)).not.toContain("resolvedPath");
    expect(JSON.stringify(data.trips[0].railGraph.tripResult)).not.toContain("internalRunPaths");
  });

  it("loads cloud rail-graph trip snapshots into the app store without trimming them", async () => {
    const { api } = await import("../services/api");
    vi.mocked(api.getData).mockResolvedValue({
      username: "alice",
      trips: [fixtureSavedTrip()],
      pins: [],
      folders: [],
      badge_settings: { enabled: true },
      mileage_user_events: [],
    });

    const { loadUserData } = useUserData();
    await loadUserData("test-token", false);

    const [loadedTrip] = useStore.getState().trips;
    expect(loadedTrip.railGraph?.tripResult.routeFingerprint).toBe("route:fingerprint:1");
    expect(loadedTrip.railGraph?.runtimeArtifacts).toBeUndefined();
    expect(JSON.stringify(loadedTrip.railGraph?.tripResult)).not.toContain("resolvedPath");
    expect(JSON.stringify(loadedTrip.railGraph?.tripResult)).not.toContain("internalRunPaths");
  });
});

function fixtureSavedTrip(): Trip {
  const tripResult = fixtureTripResult();
  return {
    id: "trip:rail:1",
    date: "2026-01-01",
    memo: "rail-graph:auto",
    cost: 0,
    lineKey: "manual:line:test",
    fromId: "manual:station:a",
    toId: "manual:station:b",
    segments: [{
      id: "rail-graph:manual:pattern:local:0",
      lineKey: "manual:line:test",
      fromId: "manual:station:a",
      toId: "manual:station:b",
      line: "Local A-B",
      direction: "down",
    }],
    railGraph: {
      tripResult,
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
        name: "A",
        coordinates: [140, 38],
      },
      toStation: {
        stationRef: "manual:station:b" as EntityRef,
        name: "B",
        coordinates: [140.001, 38.001],
      },
      viaStations: [{
        station: {
          stationRef: "manual:station:a" as EntityRef,
          name: "A",
          coordinates: [140, 38],
        },
        stopType: "stop",
        departureTime: "2026-01-01T00:00:00.000Z",
      }, {
        station: {
          stationRef: "manual:station:b" as EntityRef,
          name: "B",
          coordinates: [140.001, 38.001],
        },
        stopType: "stop",
        arrivalTime: "2026-01-01T00:05:00.000Z",
      }],
      distanceKm: 0.1,
      timeMinutes: 5,
      geometry: {
        type: "LineString",
        coordinates: [[140, 38], [140.001, 38.001]],
      },
      mileageProfile: {
        systemRef: "manual:system:test" as EntityRef,
        lineRef: "manual:line:test" as EntityRef,
        patternRef: "manual:pattern:local" as EntityRef,
        direction: "down",
        totalDistanceMeters: 100,
        edgeSequence: ["manual:edge:e1" as EntityRef],
        stationSequence: ["manual:station:a" as EntityRef, "manual:station:b" as EntityRef],
        edgeMileage: {
          "manual:edge:e1": {
            edgeRef: "manual:edge:e1" as EntityRef,
            startMeters: 0,
            endMeters: 100,
            coordinates: [[140, 38], [140.001, 38.001]],
          },
        },
        stationMileage: {
          "manual:station:a": {
            stationRef: "manual:station:a" as EntityRef,
            distanceMeters: 0,
            coordinates: [140, 38],
            name: "A",
          },
          "manual:station:b": {
            stationRef: "manual:station:b" as EntityRef,
            distanceMeters: 100,
            coordinates: [140.001, 38.001],
            name: "B",
          },
        },
        timeline: [{
          distanceMeters: 0,
          timestamp: "2026-01-01T00:00:00.000Z",
        }, {
          distanceMeters: 100,
          timestamp: "2026-01-01T00:05:00.000Z",
        }],
      },
      events: [{
        type: "stop",
        source: "system",
        stationRef: "manual:station:a" as EntityRef,
        label: "A",
        departureTime: "2026-01-01T00:00:00.000Z",
      }, {
        type: "stop",
        source: "system",
        stationRef: "manual:station:b" as EntityRef,
        label: "B",
        arrivalTime: "2026-01-01T00:05:00.000Z",
      }],
    }],
    totalDistanceKm: 0.1,
    totalTimeMinutes: 5,
    routeFingerprint: "route:fingerprint:1",
    departureTime: "2026-01-01T00:00:00.000Z",
    arrivalTime: "2026-01-01T00:05:00.000Z",
    eventTypeSummary: ["stop"],
  };
}

function makeMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function edgeUserDataModulePath(): string {
  return "../../public/functions/api/user/data.js";
}
