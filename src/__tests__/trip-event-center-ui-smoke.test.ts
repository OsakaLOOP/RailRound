/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { TripEventCenter } from "../components/trips/TripEventCenter";
import type { MileageEventListEntry } from "../components/mileage-events/EventList";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { TripDetailModel } from "../utils/railGraphTripDetailModel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof fallback === "string" ? fallback : _key;
      const values = typeof fallback === "object" && fallback !== null ? fallback : options;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
    },
  }),
}));

describe("TripEventCenter rail-graph UI smoke", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a read-only detail-model replay without raw ids or map-editor wording", () => {
    const onOpenMapView = vi.fn();
    const onFocusEvent = vi.fn();
    const entry = fixtureEntry();

    act(() => {
      root.render(React.createElement(TripEventCenter, {
        detail: fixtureDetail(),
        entries: [entry],
        allEntryCount: 1,
        filtered: false,
        isExpanded: true,
        selectedEventId: "event-photo",
        onToggle: vi.fn(),
        onOpenMapView,
        onFocusEvent,
      }));
    });

    expect(host.textContent).toContain("Rail graph run");
    expect(host.textContent).toContain("Scenic");
    expect(host.textContent).toContain("Scenic window");
    expect(host.textContent).toContain("Photo stop");
    expect(host.textContent).toContain("Open in MapView");
    expect(host.textContent).not.toContain("internal-trip-id");
    expect(host.textContent).not.toContain("manual:pattern:local");
    expect(host.textContent).not.toContain("Open map editor");
    expect(host.textContent).not.toContain("Passing station");

    const openMapButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Open in MapView"),
    );
    expect(openMapButton).toBeTruthy();
    act(() => {
      openMapButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenMapView).toHaveBeenCalledTimes(1);

    const eventButton = Array.from(host.querySelectorAll("button")).reverse().find((button) =>
      button.textContent?.includes("Photo stop"),
    );
    expect(eventButton).toBeTruthy();
    act(() => {
      eventButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFocusEvent).toHaveBeenCalledWith(entry);
  });
});

function fixtureDetail(): TripDetailModel {
  return {
    kind: "rail_graph",
    tripId: "internal-trip-id",
    date: "2026-06-05",
    overview: {
      title: "Readable Alpha Line",
      planUsed: "preset",
      totalDistanceKm: 12.5,
      totalTimeMinutes: 18,
      eventTypeSummary: ["departure", "scenic", "user_event", "arrival"],
      userEventCount: 1,
      systemEventCount: 4,
      segmentCount: 1,
    },
    segments: [{
      id: "segment-1",
      index: 0,
      source: "rail_graph",
      lineKey: "internal:line:alpha",
      lineLabel: "Readable Alpha Line",
      displayColor: "#10b981",
      fromId: "internal:station:alpha",
      fromName: "Alpha",
      toId: "internal:station:beta",
      toName: "Beta",
      distanceKm: 12.5,
      timeMinutes: 18,
      systemRef: ref("internal:system"),
      lineRef: ref("internal:line:alpha"),
      patternRef: ref("manual:pattern:local"),
      direction: "up",
      serviceType: "Local",
      viaStations: [],
      viaStationCount: 2,
      stopCount: 1,
      passCount: 1,
      systemEventCount: 4,
      userEventCount: 1,
      keyEvents: [],
      geoSource: {
        code: "rail_graph_snapshot",
        hasGeometry: true,
        hasFallback: false,
        missingGeometryCount: 0,
      },
    }],
    events: [{
      id: "segment-1:departure",
      source: "system",
      type: "departure",
      label: "Alpha",
      segmentIndex: 0,
      distanceMeters: 0,
      stationName: "Alpha",
      importance: "key",
    }, {
      id: "segment-1:scenic",
      source: "system",
      type: "scenic",
      label: "Scenic window",
      segmentIndex: 0,
      distanceMeters: 4500,
      importance: "key",
    }, {
      id: "user:event-photo",
      source: "user",
      type: "user_event",
      label: "Photo stop",
      segmentIndex: 0,
      distanceMeters: 5000,
      importance: "key",
      userEventId: ref("event-photo"),
    }, {
      id: "segment-1:pass",
      source: "system",
      type: "pass",
      label: "Passing station",
      segmentIndex: 0,
      distanceMeters: 6500,
      importance: "detail",
    }, {
      id: "segment-1:arrival",
      source: "system",
      type: "arrival",
      label: "Beta",
      segmentIndex: 0,
      distanceMeters: 12500,
      stationName: "Beta",
      importance: "key",
    }],
    geoSource: {
      code: "rail_graph_snapshot",
      hasGeometry: true,
      hasFallback: false,
      missingGeometryCount: 0,
    },
  };
}

function fixtureEntry(): MileageEventListEntry {
  return {
    bound: {
      event: {
        schemaVersion: "mileage-user-event-v1",
        id: ref("event-photo"),
        kind: "scenic",
        title: "Photo stop",
        body: "Left-side viewpoint",
        visibility: "private",
        tags: ["window"],
        mileage: {
          systemRef: ref("internal:system"),
          lineRef: ref("internal:line:alpha"),
          patternRef: ref("manual:pattern:local"),
          direction: "up",
          distanceMeters: 5000,
        },
        payload: {
          tripId: "internal-trip-id",
        },
      },
      distanceMetersFromRunStart: 5000,
      orderIndex: 0,
      timestampInference: "unknown",
      diagnostics: [],
    },
    lineContext: null,
  };
}

function ref(value: string): EntityRef {
  return value as EntityRef;
}
