/**
 * Integration test: Parser → RailwayData → Routing pipeline
 * Verifies that GeoJSON parsed data correctly feeds into the routing engine.
 */
import { describe, it, expect } from "vitest";
import { parseGeoJsonBatch } from "../../core/parser";
import {
  findRoute,
  buildStationIndex,
  getTransferableLines,
  findNearbyStations,
} from "../../core/railwayRouting";
import { searchStations } from "../../core/stationSearch";
import {
  TEST_GEOJSON_CHUNKS,
  TEST_COMPANY_DATA,
} from "../fixtures/railwayData";

describe("Parser → RailwayData → Routing pipeline", () => {
  // Build the full data model from GeoJSON, simulating the real boot flow
  const parsed = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);
  const railwayData = parsed.railwayUpdates;

  it("parsed data has correct line count", () => {
    expect(Object.keys(railwayData)).toHaveLength(2);
  });

  it("parsed data stations have correct lat/lng for routing", () => {
    const tokyo = railwayData["JR-East:Yamanote"].stations[0];
    expect(tokyo.lat).toBeCloseTo(35.6812);
    expect(tokyo.lng).toBeCloseTo(139.7671);
  });

  it("station index built from parsed data works", () => {
    const index = buildStationIndex(railwayData);
    expect(index.has("東京")).toBe(true);
    expect(index.get("東京")!.length).toBeGreaterThanOrEqual(2);
  });

  it("findRoute works on parsed data: same-line", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      "JR-East:Yamanote",
      "JR-East:Yamanote:Ueno",
      railwayData
    );
    expect(result.error).toBeUndefined();
    expect(result.segments!.length).toBeGreaterThanOrEqual(1);
  });

  it("findRoute works on parsed data: cross-line with transfer", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:Ueno",
      "TokyoMetro:丸ノ内線",
      "TokyoMetro:丸ノ内線:Otemachi",
      railwayData
    );
    expect(result.error).toBeUndefined();
  });

  it("searchStations finds stations from parsed data", () => {
    const results = searchStations("東京", railwayData);
    expect(results.length).toBeGreaterThanOrEqual(1);
    results.forEach((r) => {
      expect(r.lineKey).toBeDefined();
      expect(r.company).toBeDefined();
    });
  });

  it("findNearbyStations returns correct proximity ordering", () => {
    const results = findNearbyStations(railwayData, 35.6815, 139.7675, 5);
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distSq).toBeGreaterThanOrEqual(results[i - 1].distSq);
    }
  });

  it("transfer detection works: Tokyo station connects both lines", () => {
    const tokyoJR = railwayData["JR-East:Yamanote"].stations[0];
    const transfers = getTransferableLines(
      tokyoJR,
      "JR-East:Yamanote",
      railwayData
    );
    expect(transfers).toContain("TokyoMetro:丸ノ内線");
  });
});
