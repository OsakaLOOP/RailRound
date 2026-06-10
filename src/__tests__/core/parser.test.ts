import { describe, it, expect } from "vitest";
import { parseGeoJsonBatch } from "../../core/parser";
import {
  TEST_GEOJSON_CHUNKS,
  TEST_COMPANY_DATA,
} from "../fixtures/railwayData";

describe("parseGeoJsonBatch", () => {
  it("parses multiple company GeoJSON chunks", () => {
    const result = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);

    expect(result.newFeatures).toHaveLength(7); // 2 line + 5 station features
    expect(Object.keys(result.railwayUpdates)).toHaveLength(2);
  });

  it("builds correct line keys", () => {
    const result = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);

    expect(result.railwayUpdates).toHaveProperty("JR-East:Yamanote");
    expect(result.railwayUpdates).toHaveProperty("TokyoMetro:丸ノ内線");
  });

  it("extracts correct station count per line", () => {
    const result = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);

    expect(result.railwayUpdates["JR-East:Yamanote"].stations).toHaveLength(3);
    expect(
      result.railwayUpdates["TokyoMetro:丸ノ内線"].stations
    ).toHaveLength(2);
  });

  it("preserves station properties", () => {
    const result = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);

    const tokyoStation = result.railwayUpdates[
      "JR-East:Yamanote"
    ].stations.find((s) => s.name_ja === "東京");
    expect(tokyoStation).toBeDefined();
    expect(tokyoStation!.lat).toBeCloseTo(35.6812);
    expect(tokyoStation!.lng).toBeCloseTo(139.7671);
    expect(tokyoStation!.transfers).toContain("TokyoMetro:丸ノ内線");
  });

  it("preserves line metadata", () => {
    const result = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);

    const yamanoteMeta = result.railwayUpdates["JR-East:Yamanote"].meta;
    expect(yamanoteMeta.company).toBe("JR-East");
    expect(yamanoteMeta.isLoop).toBe(true);
    expect(yamanoteMeta.color).toBe("#80C241");
  });

  it("reverses loop line station order (外回り→内回り normalization)", () => {
    // Feed stations in 外回り order (clockwise) — they should be reversed to 内回り
    const features = [
      {
        type: "Feature",
        properties: {
          type: "line",
          name: "TestLoop",
          company: "JR-East",
          isLoop: true,
        },
        geometry: { type: "LineString", coordinates: [] },
      },
      // Stations in clockwise order: A, B, C
      {
        type: "Feature",
        properties: {
          type: "station",
          name: "A",
          line: "TestLoop",
          company: "JR-East",
        },
        geometry: { type: "Point", coordinates: [0, 0] },
      },
      {
        type: "Feature",
        properties: {
          type: "station",
          name: "B",
          line: "TestLoop",
          company: "JR-East",
        },
        geometry: { type: "Point", coordinates: [1, 1] },
      },
      {
        type: "Feature",
        properties: {
          type: "station",
          name: "C",
          line: "TestLoop",
          company: "JR-East",
        },
        geometry: { type: "Point", coordinates: [2, 2] },
      },
    ] as any;

    const result = parseGeoJsonBatch(
      [
        {
          json: { type: "FeatureCollection", features },
          company: "JR-East",
        },
      ],
      TEST_COMPANY_DATA
    );

    const stations = result.railwayUpdates["JR-East:TestLoop"].stations;
    expect(stations[0].name_ja).toBe("A"); // first stays
    // After the reverse: original [A,B,C] → [A,C,B]
    expect(stations[1].name_ja).toBe("C");
    expect(stations[2].name_ja).toBe("B");
  });

  it("handles empty input", () => {
    const result = parseGeoJsonBatch([], TEST_COMPANY_DATA);
    expect(result.newFeatures).toHaveLength(0);
    expect(Object.keys(result.railwayUpdates)).toHaveLength(0);
  });

  it("handles chunk with null json", () => {
    const result = parseGeoJsonBatch(
      [{ json: null, company: "Unknown" }],
      TEST_COMPANY_DATA
    );
    expect(result.newFeatures).toHaveLength(0);
  });

  it("preserves landmark flag on stations", () => {
    const result = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);

    const shinjuku = result.railwayUpdates["JR-East:Yamanote"].stations.find(
      (s) => s.name_ja === "新宿"
    );
    expect(shinjuku!.landmark).toBe(true);
  });
});
