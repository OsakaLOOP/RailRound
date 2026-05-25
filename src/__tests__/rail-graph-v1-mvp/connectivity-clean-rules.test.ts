import { describe, expect, it } from "vitest";
import type { AnnotatedFeature } from "../../rail-graph-v1/annotation.types";
import {
  handleShortConnectedLineComponent,
  handleSingleConnectionSwitch,
} from "../../rail-graph-v1-mvp/rule-handlers";

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

function sw(id: string, coord: number[]): AnnotatedFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: coord },
    properties: {
      osm_type: "node",
      osm_id: id,
      class_main: "switch",
      railway: "switch",
      source_line_name: "test",
      railGraph: { kind: "switch_point", schemaVersion: "rail-graph-v1", id, source: "test" },
    },
  } as unknown as AnnotatedFeature;
}

describe("connectivity clean rules", () => {
  it("removes a switch connected to only one rail line", () => {
    const feature = sw("s1", [140, 38]);
    const refs = [rail("r1", [[140, 38], [140.001, 38]])];

    expect(handleSingleConnectionSwitch(feature, { tolerance_m: 0.5 }, refs)).toBe(false);
  });

  it("keeps a switch connected to two rail lines", () => {
    const feature = sw("s1", [140, 38]);
    const refs = [
      rail("r1", [[139.999, 38], [140, 38]]),
      rail("r2", [[140, 38], [140.001, 38]]),
    ];

    expect(handleSingleConnectionSwitch(feature, { tolerance_m: 0.5 }, refs)).toBe(true);
  });

  it("removes rail lines in a short connected component", () => {
    const refs = [
      rail("short-a", [[140, 38], [140.00005, 38]]),
      rail("short-b", [[140.00005, 38], [140.0001, 38]]),
      rail("long", [[140.01, 38], [140.011, 38]]),
    ];

    expect(handleShortConnectedLineComponent(refs[0], { min_component_length_m: 20 }, refs)).toBe(false);
    expect(handleShortConnectedLineComponent(refs[2], { min_component_length_m: 20 }, refs)).toBe(true);
  });

  it("uses endpoint precision 6 for connected line components", () => {
    const refs = [
      rail("a", [[140, 38], [140.00005, 38]]),
      rail("b", [[140.0000504, 38], [140.0001, 38]]),
    ];

    expect(handleShortConnectedLineComponent(refs[0], {
      endpoint_precision: 6,
      snap_tolerance_m: 0,
      min_component_length_m: 8,
    }, refs)).toBe(true);
  });

  it("uses 0.5m endpoint-to-line snapping for connected line components", () => {
    const refs = [
      rail("main", [[140, 38], [140.001, 38]]),
      rail("branch", [[140.0005, 37.999996], [140.0005, 37.99995]]),
    ];

    expect(handleShortConnectedLineComponent(refs[1], {
      endpoint_precision: 6,
      snap_tolerance_m: 0.5,
      min_component_length_m: 50,
    }, refs)).toBe(true);
  });
});
