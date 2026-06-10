import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { BaseTopologyLayer, TopologyEdge } from "../rail-graph-v1/base-topology.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { ServicePattern } from "../rail-graph-v1/service-template.types";
import { buildAdjacency } from "../rail-graph-v1/topology";
import { buildDeployedSystem, buildSystemContext } from "../rail-graph-v1/types";

describe("rail-graph deployment export script", () => {
  it("exports a validated SystemContext + DeployedSystem bundle", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rail-graph-export-"));
    try {
      const inputPath = join(tmp, "bundle.json");
      const outputPath = join(tmp, "public", "rail-graph", "deployed-system.json");
      const system = buildSystemContext({
        baseTopology: fixtureTopology(),
        servicePatterns: [fixturePattern()],
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const deployed = buildDeployedSystem({
        system,
        systemId: "manual:system:test",
        version: "v1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).deployed;
      writeFileSync(inputPath, `${JSON.stringify({ system, deployed }, null, 2)}\n`, "utf8");

      execFileSync(
        process.execPath,
        ["scripts/export-rail-graph-deployment.mjs", "--input", inputPath, "--output", outputPath],
        { cwd: process.cwd(), stdio: "pipe" },
      );

      const exported = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(exported.system.graphId).toBe(system.graphId);
      expect(exported.deployed.sourceGraphId).toBe(system.graphId);
      expect(exported.deployed.generatedPresets.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("builds a deployment bundle from compiled aggregate files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rail-graph-build-"));
    try {
      const aggregatePath = join(tmp, "aggregate-state.json");
      const patternsPath = join(tmp, "service-patterns.json");
      const outputPath = join(tmp, "deployed-system.json");
      writeFileSync(
        aggregatePath,
        `${JSON.stringify(fixtureAggregateState("compiled-topology"), null, 2)}\n`,
        "utf8",
      );
      writeFileSync(patternsPath, `${JSON.stringify([fixturePattern()], null, 2)}\n`, "utf8");

      execFileSync(
        process.execPath,
        [
          "./node_modules/tsx/dist/cli.mjs",
          "scripts/build-rail-graph-deployment-bundle.ts",
          "--aggregate-state",
          aggregatePath,
          "--service-patterns",
          patternsPath,
          "--output",
          outputPath,
          "--system-id",
          "manual:system:test",
          "--version",
          "test",
        ],
        { cwd: process.cwd(), stdio: "pipe" },
      );

      const exported = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(exported.system.graphId).toBe(exported.deployed.sourceGraphId);
      expect(exported.deployed.systemId).toBe("manual:system:test");
      expect(exported.deployed.generatedPresets).toHaveLength(1);
      expect(exported.deployed.stations[0].coordinates).toEqual([140, 38]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects no-direction aggregate deployment unless explicitly marked verify-only", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rail-graph-build-no-direction-"));
    try {
      const aggregatePath = join(tmp, "aggregate-state.json");
      const patternsPath = join(tmp, "service-patterns.json");
      const outputPath = join(tmp, "deployed-system.json");
      writeFileSync(
        aggregatePath,
        `${JSON.stringify(fixtureAggregateState("no-direction-graph"), null, 2)}\n`,
        "utf8",
      );
      writeFileSync(patternsPath, `${JSON.stringify([fixturePattern()], null, 2)}\n`, "utf8");

      expect(() =>
        execFileSync(
          process.execPath,
          [
            "./node_modules/tsx/dist/cli.mjs",
            "scripts/build-rail-graph-deployment-bundle.ts",
            "--aggregate-state",
            aggregatePath,
            "--service-patterns",
            patternsPath,
            "--output",
            outputPath,
          ],
          { cwd: process.cwd(), stdio: "pipe" },
        )
      ).toThrow();

      execFileSync(
        process.execPath,
        [
          "./node_modules/tsx/dist/cli.mjs",
          "scripts/build-rail-graph-deployment-bundle.ts",
          "--aggregate-state",
          aggregatePath,
          "--service-patterns",
          patternsPath,
          "--output",
          outputPath,
          "--allow-no-direction-verify",
        ],
        { cwd: process.cwd(), stdio: "pipe" },
      );
      const exported = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(exported.system.diagnostics.some((diag: { code: string }) =>
        diag.code === "RAIL_GRAPH_NO_DIRECTION_VERIFY_CONTEXT"
      )).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function fixtureAggregateState(mode: "compiled-topology" | "no-direction-graph") {
  const topo = fixtureTopology();
  return {
    aggregateKey: "test-aggregate",
    memberWorkspaceKeys: ["fixture"],
    mode,
    featureCollection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [140, 38] },
          properties: {
            railGraph: {
              schemaVersion: "rail-graph-v1",
              kind: "station_point",
              id: "manual:station:a",
              source: "manual",
            },
          },
        },
      ],
    },
    topo,
    diagnostics: [],
    perWorkspaceEdgeCount: { fixture: topo.edges.length },
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: mode === "compiled-topology" ? "import" : "fixtures",
      note: "test fixture",
    },
  };
}

function fixtureTopology(): BaseTopologyLayer {
  const edge: TopologyEdge = {
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
  return {
    nodes: [
      { id: "manual:node:a" as EntityRef, kind: "line_endpoint", coordinates: [140.0000, 38.0000] },
      { id: "manual:node:b" as EntityRef, kind: "line_endpoint", coordinates: [140.0010, 38.0000] },
    ],
    edges: [edge],
    adjacency: buildAdjacency([edge]),
    stations: [
      { id: "manual:station:a" as EntityRef, name: "A", platformRefs: ["manual:platform:a" as EntityRef] },
      { id: "manual:station:b" as EntityRef, name: "B", platformRefs: ["manual:platform:b" as EntityRef] },
    ],
    platforms: [
      { id: "manual:platform:a" as EntityRef, stationRef: "manual:station:a" as EntityRef, type: "side", number: 1 },
      { id: "manual:platform:b" as EntityRef, stationRef: "manual:station:b" as EntityRef, type: "side", number: 1 },
    ],
    platformTrackBindings: [
      { id: "manual:binding:a" as EntityRef, stationRef: "manual:station:a" as EntityRef, platformRef: "manual:platform:a" as EntityRef, edgeRef: "manual:edge:e1" as EntityRef, side: "left" },
      { id: "manual:binding:b" as EntityRef, stationRef: "manual:station:b" as EntityRef, platformRef: "manual:platform:b" as EntityRef, edgeRef: "manual:edge:e1" as EntityRef, side: "right" },
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
        id: "manual:stop:b" as EntityRef,
        stationRef: "manual:station:b" as EntityRef,
        platformRef: "manual:platform:b" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
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
    edgeSequence: ["manual:edge:e1" as EntityRef],
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
        passageType: "stop",
        stopType: "mandatory_stop",
        stationRef: "manual:station:b" as EntityRef,
        platformRef: "manual:platform:b" as EntityRef,
        edgeRef: "manual:edge:e1" as EntityRef,
        stoppingPointRef: "manual:stop:b" as EntityRef,
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
    ],
  };
}
