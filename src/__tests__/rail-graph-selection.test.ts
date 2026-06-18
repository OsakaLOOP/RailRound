import { describe, expect, it } from "vitest";
import type { RailGraphActiveSelection } from "../store";
import {
  activeAxisFromRailGraphSelection,
  eventProjectionDetailFromPanelEntry,
  isEventSelection,
  isRouteSelection,
  openDetailMatchesActiveRouteSelection,
  productSegmentSelectionLineKey,
  projectionDetailMatchesActiveSelection,
  projectionDetailFromRailGraphSelection,
  projectionDetailFromMileageEventsOpen,
  projectionSourceFromRailGraphSelection,
  railGraphSelectionSourceFromProjection,
  selectionFromActiveAxis,
  selectionFromMileageEventSelect,
  selectionFromMileageEventsOpen,
  selectionFromProductSegment,
} from "../utils/railGraphSelection";
import { pinMileageEventBridgePayload } from "../utils/pinEventBridge";

describe("rail graph active UI selection helpers", () => {
  it("maps bridge projection sources to active selection sources", () => {
    expect(railGraphSelectionSourceFromProjection("rail_graph_runtime")).toBe("rail_graph_snapshot");
    expect(railGraphSelectionSourceFromProjection("legacy_app")).toBe("legacy_geojson");
    expect(railGraphSelectionSourceFromProjection(undefined)).toBe("legacy_geojson");
    expect(projectionSourceFromRailGraphSelection("rail_graph_snapshot")).toBe("rail_graph_runtime");
    expect(projectionSourceFromRailGraphSelection("legacy_geojson")).toBe("legacy_app");
  });

  it("converts an active rail graph selection back to a mileage axis detail", () => {
    const selection: RailGraphActiveSelection = {
      state: "routeSelected",
      kind: "route",
      source: "rail_graph_snapshot",
      lineKey: "rail-graph:pattern:local",
      tripId: 12,
      tripSegmentIndex: 2,
      routeItemId: "route:2",
      updatedAt: 100,
    };

    expect(activeAxisFromRailGraphSelection(selection)).toEqual({
      lineKey: "rail-graph:pattern:local",
      source: "rail_graph_runtime",
      tripId: 12,
      tripSegmentIndex: 2,
      routeItemId: "route:2",
    });
  });

  it("converts active selection to panel projection detail", () => {
    expect(
      projectionDetailFromRailGraphSelection({
        state: "routeSelected",
        kind: "route",
        source: "rail_graph_snapshot",
        lineKey: "rail-graph:pattern:local",
        tripId: "trip:1",
        tripSegmentIndex: 1,
        routeItemId: "route:1",
      }),
    ).toEqual({
      lineKey: "rail-graph:pattern:local",
      source: "rail_graph_runtime",
      tripId: "trip:1",
      tripSegmentIndex: 1,
      routeItemId: "route:1",
    });

    expect(
      projectionDetailFromRailGraphSelection({
        state: "axisSelected",
        kind: "axis",
        source: "legacy_geojson",
        lineKey: "legacy:line",
      }),
    ).toEqual({
      lineKey: "legacy:line",
      source: "legacy_app",
      tripId: undefined,
      tripSegmentIndex: undefined,
      routeItemId: undefined,
    });
  });

  it("prefers state over legacy kind aliases when narrowing active selections", () => {
    expect(isRouteSelection({ state: "routeSelected", kind: "route", source: "legacy_geojson" })).toBe(true);
    expect(isRouteSelection({ state: "creating", kind: "route", source: "legacy_geojson" })).toBe(false);
    expect(isEventSelection({
      state: "eventSelected",
      kind: "event",
      source: "legacy_geojson",
      eventId: "event:1",
    })).toBe(true);
    expect(isEventSelection({
      state: "inspecting",
      kind: "event",
      source: "legacy_geojson",
      eventId: "event:1",
    })).toBe(false);
    expect(isRouteSelection({ kind: "route", source: "legacy_geojson" } as any)).toBe(true);
    expect(isEventSelection({ kind: "event", source: "legacy_geojson", eventId: "event:1" } as any)).toBe(true);
  });

  it("builds panel event projection details while inheriting route context", () => {
    expect(
      eventProjectionDetailFromPanelEntry(
        {
          lineKey: "rail-graph:runtime-pattern",
          source: "rail_graph_runtime",
          orderIndex: 3,
        },
        {
          lineKey: "rail-graph:active-pattern",
          source: "rail_graph_runtime",
          tripId: "trip:active",
          tripSegmentIndex: 1,
          routeItemId: "route:active",
        },
      ),
    ).toEqual({
      lineKey: "rail-graph:runtime-pattern",
      source: "rail_graph_runtime",
      tripId: "trip:active",
      tripSegmentIndex: 3,
      routeItemId: "route:active",
    });
  });

  it("builds panel projection details from open bridge payloads", () => {
    expect(projectionDetailFromMileageEventsOpen({})).toBeNull();
    expect(
      projectionDetailFromMileageEventsOpen({
        lineKey: "rail-graph:pattern:local",
        source: "rail_graph_runtime",
        tripId: "trip:1",
        tripSegmentIndex: 2,
        routeItemId: "route:2",
        eventId: "event:ignored",
      }),
    ).toEqual({
      lineKey: "rail-graph:pattern:local",
      source: "rail_graph_runtime",
      tripId: "trip:1",
      tripSegmentIndex: 2,
      routeItemId: "route:2",
    });
  });

  it("preserves event route context from bridge select details", () => {
    expect(
      selectionFromMileageEventSelect({
        eventId: "event:1",
        source: "rail_graph_runtime",
        lineKey: "rail-graph:pattern:local",
        tripId: "trip:1",
        tripSegmentIndex: 1,
        routeItemId: "route:1",
      }),
    ).toEqual({
      state: "eventSelected",
      kind: "event",
      source: "rail_graph_snapshot",
      lineKey: "rail-graph:pattern:local",
      tripId: "trip:1",
      tripSegmentIndex: 1,
      routeItemId: "route:1",
      eventId: "event:1",
    });
  });

  it("returns null for empty bridge details and creates axis/open selections otherwise", () => {
    expect(selectionFromMileageEventSelect({})).toBeNull();
    expect(selectionFromActiveAxis({})).toBeNull();
    expect(selectionFromMileageEventsOpen({})).toBeNull();
    expect(selectionFromActiveAxis({ source: "legacy_app", lineKey: "JR:line" })).toMatchObject({
      kind: "axis",
      source: "legacy_geojson",
      lineKey: "JR:line",
    });
    expect(selectionFromMileageEventsOpen({ eventId: "event:2", tripId: "trip:2" })).toMatchObject({
      kind: "event",
      source: "legacy_geojson",
      tripId: "trip:2",
      eventId: "event:2",
    });
  });

  it("keeps matching open details from replacing route selections", () => {
    const selection: RailGraphActiveSelection = {
      state: "routeSelected",
      kind: "route",
      source: "rail_graph_snapshot",
      lineKey: "rail-graph:pattern:local",
      tripId: "trip:1",
      tripSegmentIndex: 1,
      routeItemId: "route:1",
      updatedAt: 100,
    };

    expect(
      openDetailMatchesActiveRouteSelection(
        {
          source: "rail_graph_runtime",
          lineKey: "rail-graph:pattern:local",
          tripId: "trip:1",
          tripSegmentIndex: 1,
          routeItemId: "route:1",
        },
        selection,
      ),
    ).toBe(true);
    expect(
      openDetailMatchesActiveRouteSelection(
        {
          source: "rail_graph_runtime",
          eventId: "event:1",
          tripId: "trip:1",
          tripSegmentIndex: 1,
          routeItemId: "route:1",
        },
        selection,
      ),
    ).toBe(false);
    expect(
      openDetailMatchesActiveRouteSelection(
        {
          source: "legacy_app",
          tripId: "trip:1",
          tripSegmentIndex: 1,
        },
        selection,
      ),
    ).toBe(false);
  });

  it("recognizes route and event selections that already cover projection details", () => {
    const routeSelection: RailGraphActiveSelection = {
      state: "routeSelected",
      kind: "route",
      source: "rail_graph_snapshot",
      lineKey: "rail-graph:pattern:local",
      tripId: "trip:1",
      tripSegmentIndex: 1,
      routeItemId: "route:1",
      updatedAt: 100,
    };
    const eventSelection: RailGraphActiveSelection = {
      ...routeSelection,
      state: "eventSelected",
      kind: "event",
      eventId: "event:1",
    };

    expect(
      projectionDetailMatchesActiveSelection(
        {
          source: "rail_graph_runtime",
          lineKey: "rail-graph:pattern:local",
          tripId: "trip:1",
          tripSegmentIndex: 1,
          routeItemId: "route:1",
        },
        routeSelection,
      ),
    ).toBe(true);
    expect(
      projectionDetailMatchesActiveSelection(
        {
          source: "rail_graph_runtime",
          lineKey: "rail-graph:pattern:local",
          tripId: "trip:1",
          tripSegmentIndex: 1,
          routeItemId: "route:1",
        },
        eventSelection,
        "event:1",
      ),
    ).toBe(true);
    expect(
      projectionDetailMatchesActiveSelection(
        {
          source: "legacy_app",
          lineKey: "rail-graph:pattern:local",
          tripId: "trip:1",
          tripSegmentIndex: 1,
        },
        routeSelection,
      ),
    ).toBe(false);
  });

  it("derives active mileage axis state from store selection instead of bridge double writes", () => {
    const selection = selectionFromActiveAxis({
      source: "rail_graph_runtime",
      lineKey: "rail-graph:pattern:local",
      tripId: "trip:active",
      tripSegmentIndex: 2,
      routeItemId: "route:active",
    });

    expect(selection).toMatchObject({
      kind: "axis",
      source: "rail_graph_snapshot",
      lineKey: "rail-graph:pattern:local",
      tripId: "trip:active",
      tripSegmentIndex: 2,
      routeItemId: "route:active",
    });
    expect(activeAxisFromRailGraphSelection(selection!)).toEqual({
      lineKey: "rail-graph:pattern:local",
      source: "rail_graph_runtime",
      tripId: "trip:active",
      tripSegmentIndex: 2,
      routeItemId: "route:active",
    });
  });

  it("builds route selection metadata from rail-graph product segments", () => {
    const segment = {
      id: "segment:local:1",
      lineKey: "line:local",
      lineLabel: "Local",
      displayColor: "#0f766e",
      source: "rail_graph" as const,
      patternRef: "pattern:local" as any,
      direction: "outbound",
      serviceType: "local",
    } as any;

    expect(productSegmentSelectionLineKey(segment)).toBe("rail-graph:pattern:local");
    expect(selectionFromProductSegment({ segment, tripId: "trip:1", tripSegmentIndex: 1 })).toMatchObject({
      kind: "route",
      source: "rail_graph_snapshot",
      lineKey: "rail-graph:pattern:local",
      tripId: "trip:1",
      tripSegmentIndex: 1,
      routeItemId: "segment:local:1",
      label: "Local",
      color: "#0f766e",
      patternRef: "pattern:local",
      direction: "outbound",
      serviceType: "local",
      geometrySource: "saved_snapshot",
    });
  });

  it("keeps legacy product segments on geojson selection semantics", () => {
    const segment = {
      id: "segment:legacy:1",
      lineKey: "legacy:line",
      lineLabel: "Legacy Line",
      displayColor: "#64748b",
      source: "legacy" as const,
    };

    expect(productSegmentSelectionLineKey(segment)).toBe("legacy:line");
    expect(selectionFromProductSegment({ segment, tripId: 8 })).toMatchObject({
      kind: "route",
      source: "legacy_geojson",
      lineKey: "legacy:line",
      tripId: 8,
      routeItemId: "segment:legacy:1",
      label: "Legacy Line",
      color: "#64748b",
      geometrySource: "geojson",
    });
  });

  it("prefers event projection context for rail-graph event route targeting", () => {
    const segment = {
      id: "segment:rapid:1",
      lineKey: "line:rapid",
      lineLabel: "Rapid",
      displayColor: "#2563eb",
      source: "rail_graph" as const,
      patternRef: "pattern:rapid" as any,
      direction: "inbound",
      serviceType: "rapid",
    } as any;
    const lineContext = {
      source: "rail_graph_runtime",
      lineKey: "rail-graph:runtime-pattern",
      segmentIndex: 3,
      segment: {
        lineLabel: "Runtime Rapid",
        displayColor: "#1d4ed8",
        mileageProfile: {
          patternRef: "pattern:runtime",
          direction: "outbound",
          serviceType: "express",
        },
      },
    } as any;

    expect(selectionFromProductSegment({
      kind: "event",
      segment,
      lineContext,
      tripId: "trip:rapid",
      eventId: "event:rapid",
    })).toMatchObject({
      kind: "event",
      source: "rail_graph_snapshot",
      lineKey: "rail-graph:runtime-pattern",
      tripId: "trip:rapid",
      tripSegmentIndex: 3,
      routeItemId: "segment:rapid:1",
      eventId: "event:rapid",
      label: "Rapid",
      color: "#2563eb",
      patternRef: "pattern:rapid",
      direction: "inbound",
      serviceType: "rapid",
      geometrySource: "saved_snapshot",
    });
  });

  it("honors explicit source overrides from map route items", () => {
    expect(selectionFromProductSegment({
      kind: "route",
      source: "rail_graph_snapshot",
      lineKey: "line-ref-without-prefix",
      routeItemId: "route:map",
      label: "Map route",
      color: "#16a34a",
      geometrySource: "saved_snapshot",
    })).toMatchObject({
      kind: "route",
      source: "rail_graph_snapshot",
      lineKey: "line-ref-without-prefix",
      routeItemId: "route:map",
      label: "Map route",
      color: "#16a34a",
      geometrySource: "saved_snapshot",
    });
  });

  it("builds legacy map-source create payloads for pin events", () => {
    const payload = pinMileageEventBridgePayload({
      pin: {
        lat: 35.123,
        lng: 135.456,
        comment: "Bridge photo stop",
        imageUrl: "https://example.test/photo.jpg",
      },
      lineKey: "legacy:line",
      railwayData: {
        "legacy:line": {
          meta: {
            company: "Legacy",
            region: "JP",
            type: "rail",
            logo: null,
            color: "#64748b",
          },
          stations: [],
        },
      },
    });

    expect(payload).toEqual({
      activeSelection: {
        state: "axisSelected",
        kind: "axis",
        source: "legacy_geojson",
        lineKey: "legacy:line",
        label: "line",
        color: "#64748b",
        geometrySource: "geojson",
        anchor: { lat: 35.123, lng: 135.456 },
      },
      openDetail: {
        mode: "create",
        lineKey: "legacy:line",
        source: "legacy_app",
        create: {
          source: "map",
          lineKey: "legacy:line",
          mapPoint: { lat: 35.123, lng: 135.456 },
          title: "Bridge photo stop",
          mediaUrl: "https://example.test/photo.jpg",
          tags: ["pin"],
        },
      },
    });
  });

  it("does not build pin event payloads for missing legacy axes", () => {
    expect(
      pinMileageEventBridgePayload({
        pin: { lat: 35, lng: 135 },
        lineKey: "missing:line",
        railwayData: {},
      }),
    ).toBeNull();
  });
});
