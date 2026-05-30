import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { RunSpec } from "../rail-graph-v1/runtime.types";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import {
  buildSystemContext,
  resolveRunContext,
} from "../rail-graph-v1/types";
import { buildAdjacency } from "../rail-graph-v1/topology";

describe("rail-graph runtime events", () => {
  it("builds RunOrder, timeline and events from confirmed template data", () => {
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
              mapBearingDegrees: 270,
            },
          },
          {
            anchorId: "manual:event:user-note" as EntityRef,
            kind: "user_defined",
            geometryRef: "manual:station:b" as EntityRef,
            userDefined: {
              eventKey: "note",
              title: "Watch transfer crowding",
            },
          },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const spec: RunSpec = {
      systemId: "manual:system:test",
      patternRef: pattern.patternId,
      startStationRef: "manual:station:a" as EntityRef,
      endStationRef: "manual:station:c" as EntityRef,
      timetableAnchors: [
        {
          stationRef: "manual:station:a" as EntityRef,
          departureTime: "2026-01-01T00:00:00.000Z",
        },
        {
          stationRef: "manual:station:c" as EntityRef,
          arrivalTime: "2026-01-01T00:10:00.000Z",
        },
      ],
    };

    const context = resolveRunContext({ system, spec });

    expect(context.path?.edgeSequence).toEqual(pattern.edgeSequence);
    expect(context.order?.orderPoints.filter((point) => point.pointKind === "station").map((point) => point.entityRef)).toEqual([
      "manual:station:a",
      "manual:station:b",
      "manual:station:c",
    ]);
    expect(context.timeline?.map((point) => ({
      orderIndex: point.orderIndex,
      timestamp: point.timestamp,
      isSynthesized: point.isSynthesized,
      inference: point.inference,
    }))).toEqual([
      {
        orderIndex: 0,
        timestamp: "2026-01-01T00:00:00.000Z",
        isSynthesized: false,
        inference: "timetable",
      },
      {
        orderIndex: 1,
        timestamp: "2026-01-01T00:03:20.000Z",
        isSynthesized: true,
        inference: "speed_distance",
      },
      {
        orderIndex: 2,
        timestamp: "2026-01-01T00:10:00.000Z",
        isSynthesized: false,
        inference: "timetable",
      },
    ]);

    const eventTypes = context.events?.map((event) => event.eventType);
    expect(eventTypes).toEqual([
      "platform_stop",
      "platform_pass",
      "user_defined",
      "platform_stop",
      "turnback_operation",
      "special_section_pass",
      "scenic_view",
    ]);
    expect(context.events?.find((event) => event.eventType === "platform_pass")?.timestamp).toBe("2026-01-01T00:03:20.000Z");
    expect(context.events?.find((event) => event.eventType === "scenic_view")?.payload?.vehicleView).toMatchObject({
      side: "left",
    });
    expect(context.resolvedAnchors?.[0].vehicleView?.relativeBearingDegrees).toBeLessThan(0);
    expect(context.diagnostics).toEqual([]);
  });

  it("supports manual path override and keeps user anchors out of path mutation", () => {
    const pattern = fixturePattern();
    const system = buildSystemContext({
      baseTopology: fixtureTopology(),
      servicePatterns: [pattern],
      eventLayer: {
        anchors: [{
          anchorId: "manual:event:user-note" as EntityRef,
          kind: "user_defined",
          geometryRef: "manual:station:b" as EntityRef,
          userDefined: { eventKey: "note", title: "Note" },
        }],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const context = resolveRunContext({
      system,
      spec: {
        systemId: "manual:system:test",
        patternRef: pattern.patternId,
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:c" as EntityRef,
        pathOverride: {
          edgeSequence: ["manual:edge:e1" as EntityRef],
          traceSequence: [pattern.traceSequence[0]],
        },
      },
    });

    expect(context.path?.resolvedBy).toBe("manual_override");
    expect(context.path?.edgeSequence).toEqual(["manual:edge:e1"]);
    expect(context.events?.some((event) => event.eventType === "user_defined")).toBe(true);
    expect(context.path?.edgeSequence).toEqual(["manual:edge:e1"]);
  });

  it("returns fatal diagnostics when RunSpec references a missing pattern", () => {
    const system = buildSystemContext({
      baseTopology: fixtureTopology(),
      servicePatterns: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const context = resolveRunContext({
      system,
      spec: {
        systemId: "manual:system:test",
        patternRef: "manual:pattern:missing" as EntityRef,
        startStationRef: "manual:station:a" as EntityRef,
        endStationRef: "manual:station:c" as EntityRef,
      },
    });

    expect(context.path).toBeNull();
    expect(context.events).toBeNull();
    expect(context.diagnostics.map((diag) => diag.code)).toContain("RG_RUN_PATTERN_MISSING");
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
    functionalUse: ["through", "stopping", "turnback"],
    directionRole: "reversible",
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
        direction: "both",
        measure: 1,
        confirmation: "confirmed",
      },
    ],
    signals: [],
    specialSections: [{
      id: "manual:section:bridge" as EntityRef,
      category: "bridge",
      directionSeparation: "none",
      edgeRefs: ["manual:edge:e2" as EntityRef],
    }],
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
        operationType: "turnback",
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
        orderIndex: 2,
        edgeRef: "manual:edge:e2" as EntityRef,
        fromNodeRef: "manual:node:b" as EntityRef,
        toNodeRef: "manual:node:c" as EntityRef,
        measureRange: { startMeasure: 0, endMeasure: 1 },
        distanceMeters: 200,
        geometryRef: "manual:edge:e2" as EntityRef,
        specialSectionRefs: ["manual:section:bridge" as EntityRef],
      },
    ],
  };
}
