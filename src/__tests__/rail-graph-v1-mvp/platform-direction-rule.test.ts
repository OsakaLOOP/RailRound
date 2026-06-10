import { describe, expect, it } from "vitest";
import type { AnnotatedFeature } from "../../rail-graph-v1/annotation.types";
import { handlePlatformDirectionMatch } from "../../rail-graph-v1-mvp/rule-handlers";
import { platformDirectionVector } from "../../rail-graph-v1-mvp/spatial-helpers";

function platform(id: string, station: string, coords: number[][]): AnnotatedFeature {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords] },
    properties: {
      osm_id: id,
      class_main: "platform",
      railGraph: { kind: "platform_area", schemaVersion: "rail-graph-v1", id, source: "test" },
      sourceTags: {
        class_main: "platform",
        railway: "platform",
        nearest_station: station,
        source_line_name: "仙石線",
      },
    },
  } as unknown as AnnotatedFeature;
}

function track(id: string, station: string, coords: number[][], name = "JR仙石線"): AnnotatedFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      osm_id: id,
      class_main: "rail",
      railGraph: { kind: "track_geometry", schemaVersion: "rail-graph-v1", id, source: "test" },
      sourceTags: {
        class_main: "rail",
        railway: "rail",
        nearest_station: station,
        name,
      },
    },
  } as unknown as AnnotatedFeature;
}

const PARAMS = {
  max_distance_m: 60,
  same_station_bonus_m: 0,
  max_angle_diff_deg: 25,
  min_platform_confidence: 0.55,
  min_track_confidence: 0.25,
  min_platform_long_edge_m: 8,
  require_same_nearest_station: true,
  remove_if_station_mismatch: true,
};

const PARAMS_WITH_NEAREST_MISMATCH = {
  ...PARAMS,
  remove_if_nearest_track_station_mismatch: true,
  nearest_station_mismatch_max_distance_m: 20,
  nearest_station_mismatch_margin_m: 15,
};

const PARAMS_WITH_TARGET_LINE = {
  ...PARAMS,
  require_target_line_track: true,
  remove_if_no_target_line_track: true,
  remove_if_target_line_angle_mismatch: true,
  target_line_field: "source_line_name",
  target_line_match_fields: ["name", "name:ja", "name:en", "KSJ2:LIN"],
};

describe("platform direction rule", () => {
  it("places the detected platform direction vector at the polygon centroid", () => {
    const f = platform("p1", "A", [
      [140.0000, 38.0000],
      [140.0010, 38.0000],
      [140.0010, 38.0001],
      [140.0000, 38.0001],
      [140.0000, 38.0000],
    ]);

    const vector = platformDirectionVector(f);

    expect(vector).not.toBeNull();
    expect(vector!.origin[0]).toBeCloseTo(140.0005, 6);
    expect(vector!.origin[1]).toBeCloseTo(38.00005, 6);
    expect(vector!.lengthMeters).toBeGreaterThan(80);
  });

  it("keeps a platform when a nearby same-station track is parallel", () => {
    const f = platform("p1", "A", [
      [140.0000, 38.0000],
      [140.0010, 38.0000],
      [140.0010, 38.0001],
      [140.0000, 38.0001],
      [140.0000, 38.0000],
    ]);
    const ref = [
      track("t1", "A", [
        [140.0000, 37.99995],
        [140.0010, 37.99995],
      ]),
    ];

    expect(handlePlatformDirectionMatch(f, PARAMS, ref)).toBe(true);
  });

  it("removes a platform when only nearby parallel tracks belong to another nearest station", () => {
    const f = platform("p1", "A", [
      [140.0000, 38.0000],
      [140.0010, 38.0000],
      [140.0010, 38.0001],
      [140.0000, 38.0001],
      [140.0000, 38.0000],
    ]);
    const ref = [
      track("t1", "B", [
        [140.0000, 37.99995],
        [140.0010, 37.99995],
      ]),
    ];

    expect(handlePlatformDirectionMatch(f, PARAMS, ref)).toBe(false);
  });

  it("removes a platform when the nearest parallel track belongs to another station and same-station tracks are farther", () => {
    const f = platform("p1", "A", [
      [140.0000, 38.0000],
      [140.0010, 38.0000],
      [140.0010, 38.0001],
      [140.0000, 38.0001],
      [140.0000, 38.0000],
    ]);
    const ref = [
      track("t-near", "B", [
        [140.0000, 37.99995],
        [140.0010, 37.99995],
      ]),
      track("t-same", "A", [
        [140.0000, 38.00045],
        [140.0010, 38.00045],
      ]),
    ];

    expect(handlePlatformDirectionMatch(f, PARAMS_WITH_NEAREST_MISMATCH, ref)).toBe(false);
  });

  it("lets the nearest-station mismatch check override a passing target-line track farther away", () => {
    const f = platform("p1", "A", [
      [140.0000, 38.0000],
      [140.0010, 38.0000],
      [140.0010, 38.0001],
      [140.0000, 38.0001],
      [140.0000, 38.0000],
    ]);
    const ref = [
      track("t-near", "B", [
        [140.0000, 37.99995],
        [140.0010, 37.99995],
      ], "JR仙石線"),
      track("t-same", "A", [
        [140.0000, 38.00045],
        [140.0010, 38.00045],
      ], "JR仙石線"),
    ];

    expect(handlePlatformDirectionMatch(f, {
      ...PARAMS_WITH_TARGET_LINE,
      remove_if_nearest_track_station_mismatch: true,
      nearest_station_mismatch_max_distance_m: 20,
      nearest_station_mismatch_margin_m: 15,
    }, ref)).toBe(false);
  });

  it("removes a platform when only non-target-line tracks are parallel and the target line is perpendicular", () => {
    const f = platform("p1", "A", [
      [140.0000, 38.0000],
      [140.0001, 38.0010],
      [140.0002, 38.0010],
      [140.0001, 38.0000],
      [140.0000, 38.0000],
    ]);
    const ref = [
      track("t-other", "A", [
        [140.00008, 38.0000],
        [140.00018, 38.0010],
      ], "東北新幹線"),
      track("t-target", "A", [
        [139.9997, 38.0005],
        [140.0007, 38.0005],
      ], "JR仙石線"),
    ];

    expect(handlePlatformDirectionMatch(f, PARAMS_WITH_TARGET_LINE, ref)).toBe(false);
  });
});
