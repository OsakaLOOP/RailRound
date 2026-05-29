import { describe, expect, it } from "vitest";
import type { AnnotatedFeature } from "../../rail-graph-v1/annotation.types";
import { preSplitSourceFeatures } from "../../rail-graph-v1-mvp/pre-split-helper";

function rail(id: string, coords: number[][]): AnnotatedFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      osm_type: "way",
      osm_id: id,
      class_main: "rail",
      source_line_name: "test",
      railGraph: { kind: "track_geometry", schemaVersion: "rail-graph-v1", id, source: "test" },
    },
  } as unknown as AnnotatedFeature;
}

function multirail(id: string, lines: number[][][]): AnnotatedFeature {
  return {
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: lines },
    properties: {
      osm_type: "way",
      osm_id: id,
      class_main: "rail",
      source_line_name: "test",
      railGraph: { kind: "track_geometry", schemaVersion: "rail-graph-v1", id, source: "test" },
    },
  } as unknown as AnnotatedFeature;
}

describe("pre-split helper", () => {
  it("flattens MultiLineString track features to LineStrings", () => {
    const f = multirail("multi-w", [
      [[140, 38], [140.001, 38]],
      [[140.002, 38], [140.003, 38]],
    ]);

    const result = preSplitSourceFeatures([f]);
    expect(result.length).toBe(2);
    expect(result[0].geometry.type).toBe("LineString");
    expect(result[0].properties?.railGraph?.id).toBe("multi-w:line_0");
    expect(result[0].properties?.railGraph?.preSplitOriginalId).toBe("multi-w");
    expect(result[1].geometry.type).toBe("LineString");
    expect(result[1].properties?.railGraph?.id).toBe("multi-w:line_1");
  });

  it("snaps a degree-1 endpoint to an existing node within 0.5m", () => {
    // 0.000001 degrees is ~0.11 meters
    const f1 = rail("main", [[140, 38], [140.01, 38]]);
    const f2 = rail("branch", [[140.010001, 38.000001], [140.02, 38]]); // ~0.15m away from main's end

    const result = preSplitSourceFeatures([f1, f2]);
    expect(result.length).toBe(2);
    
    // Main way should be untouched
    const main = result.find(r => r.properties?.railGraph?.id === "main");
    expect(main).toBeDefined();

    // Branch way should have its start coordinate snapped to main's end coordinate
    const branch = result.find(r => r.properties?.railGraph?.id === "branch");
    expect(branch).toBeDefined();
    expect(branch?.geometry.coordinates[0]).toEqual(main?.geometry.coordinates[main.geometry.coordinates.length - 1]);
  });

  it("splits a main track when a degree-1 endpoint snaps to the middle of it", () => {
    const main = rail("main", [[140, 38], [140.02, 38]]);
    // Midpoint of main is [140.01, 38]. Branch endpoint is very close to it.
    const branch = rail("branch", [[140.01, 38.000001], [140.01, 38.01]]);

    const result = preSplitSourceFeatures([main, branch]);
    
    // Result should contain branch (snapped) and two split parts of main
    expect(result.length).toBe(3);

    const snappedBranch = result.find(r => r.properties?.railGraph?.id === "branch");
    expect(snappedBranch?.geometry.coordinates[0]).toEqual([140.01, 38]);

    const mainPartA = result.find(r => r.properties?.railGraph?.id === "main:part_A");
    const mainPartB = result.find(r => r.properties?.railGraph?.id === "main:part_B");

    expect(mainPartA).toBeDefined();
    expect(mainPartB).toBeDefined();

    expect(mainPartA?.geometry.coordinates).toEqual([[140, 38], [140.01, 38]]);
    expect(mainPartB?.geometry.coordinates).toEqual([[140.01, 38], [140.02, 38]]);

    expect(mainPartA?.properties?.railGraph?.preSplitStartMeasure).toBe(0);
    expect(mainPartA?.properties?.railGraph?.preSplitEndMeasure).toBe(0.5);
    expect(mainPartB?.properties?.railGraph?.preSplitStartMeasure).toBe(0.5);
    expect(mainPartB?.properties?.railGraph?.preSplitEndMeasure).toBe(1.0);
  });
});
