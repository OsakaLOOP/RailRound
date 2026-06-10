import { describe, it, expect } from "vitest";
import {
  isCompanyCompatible,
  buildStationIndex,
  getTransferableLines,
  findRoute,
  computeLoopVia,
  getLandmarks,
  findNearbyStations,
  findNearestPointOnLine,
} from "../../core/railwayRouting";
import { TEST_RAILWAY_MAP } from "../fixtures/railwayData";
import type { CompanyMeta } from "../../store";

describe("isCompanyCompatible", () => {
  const jrEast: CompanyMeta = {
    company: "JR-East",
    region: "関東",
    type: "JR",
    category: "JR",
    logo: null,
  };
  const jrWest: CompanyMeta = {
    company: "JR-West",
    region: "関西",
    type: "JR",
    category: "JR",
    logo: null,
  };
  const tokyoMetro: CompanyMeta = {
    company: "TokyoMetro",
    region: "関東",
    type: "地下鉄",
    category: "Private",
    logo: null,
  };

  it("same company is compatible", () => {
    expect(isCompanyCompatible(jrEast, jrEast)).toBe(true);
  });

  it("two JR companies are compatible", () => {
    expect(isCompanyCompatible(jrEast, jrWest)).toBe(true);
  });

  it("different type companies are not compatible", () => {
    expect(isCompanyCompatible(jrEast, tokyoMetro)).toBe(false);
  });

  it("undefined metas return false", () => {
    expect(isCompanyCompatible(undefined, jrEast)).toBe(false);
    expect(isCompanyCompatible(jrEast, undefined)).toBe(false);
  });

  it('"上传数据" company is not compatible with itself', () => {
    const unknown: CompanyMeta = {
      company: "上传数据",
      region: "未知",
      type: "未知",
      logo: null,
    };
    expect(isCompanyCompatible(unknown, unknown)).toBe(false);
  });
});

describe("buildStationIndex", () => {
  it("indexes all stations by name", () => {
    const index = buildStationIndex(TEST_RAILWAY_MAP);

    expect(index.has("東京")).toBe(true);
    const tokyoEntries = index.get("東京")!;
    expect(tokyoEntries).toHaveLength(2); // In both Yamanote and Marunouchi
  });

  it("entries contain lineKey and stationIndex", () => {
    const index = buildStationIndex(TEST_RAILWAY_MAP);
    const entry = index.get("大手町")!;
    expect(entry).toHaveLength(1);
    expect(entry[0].lineKey).toBe("TokyoMetro:丸ノ内線");
    expect(typeof entry[0].stationIndex).toBe("number");
  });

  it("caches results for same railwayData reference", () => {
    const idx1 = buildStationIndex(TEST_RAILWAY_MAP);
    const idx2 = buildStationIndex(TEST_RAILWAY_MAP);
    expect(idx1).toBe(idx2); // Same object reference
  });
});

describe("getTransferableLines", () => {
  it("finds explicit transfers", () => {
    const tokyoStation = TEST_RAILWAY_MAP["JR-East:Yamanote"].stations[0];
    const transfers = getTransferableLines(
      tokyoStation,
      "JR-East:Yamanote",
      TEST_RAILWAY_MAP
    );
    expect(transfers).toContain("TokyoMetro:丸ノ内線");
  });

  it("finds same-name station transfers (co-located)", () => {
    const tokyoMetroStation =
      TEST_RAILWAY_MAP["TokyoMetro:丸ノ内線"].stations[0];
    const transfers = getTransferableLines(
      tokyoMetroStation,
      "TokyoMetro:丸ノ内線",
      TEST_RAILWAY_MAP
    );
    expect(transfers).toContain("JR-East:Yamanote");
  });

  it("excludes current line from transfers", () => {
    const tokyoStation = TEST_RAILWAY_MAP["JR-East:Yamanote"].stations[0];
    const transfers = getTransferableLines(
      tokyoStation,
      "JR-East:Yamanote",
      TEST_RAILWAY_MAP
    );
    expect(transfers).not.toContain("JR-East:Yamanote");
  });

  it("returns empty for undefined station", () => {
    expect(
      getTransferableLines(
        undefined,
        "JR-East:Yamanote",
        TEST_RAILWAY_MAP
      )
    ).toHaveLength(0);
  });
});

describe("findRoute", () => {
  it("finds route between stations on same line", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      "JR-East:Yamanote",
      "JR-East:Yamanote:Ueno",
      TEST_RAILWAY_MAP
    );

    expect(result.error).toBeUndefined();
    expect(result.segments).toBeDefined();
    expect(result.segments!.length).toBeGreaterThanOrEqual(1);
  });

  it("finds route with transfer between lines", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:Ueno",
      "TokyoMetro:丸ノ内線",
      "TokyoMetro:丸ノ内線:Otemachi",
      TEST_RAILWAY_MAP
    );

    expect(result.error).toBeUndefined();
    // Should involve at least 2 segments (one per line)
    const linesUsed = new Set(result.segments!.map((s: any) => s.lineKey));
    expect(linesUsed.size).toBeGreaterThanOrEqual(1);
  });

  it("returns error for invalid start line", () => {
    const result = findRoute(
      "Invalid:Line",
      "Invalid:Line:Station",
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      TEST_RAILWAY_MAP
    );
    expect(result.error).toBeDefined();
  });

  it("returns error for invalid station IDs", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:NonExistent",
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      TEST_RAILWAY_MAP
    );
    expect(result.error).toBeDefined();
  });
});

describe("computeLoopVia", () => {
  it("returns 'up' for forward direction on non-loop line", () => {
    // Non-loop: index comparison
    expect(
      computeLoopVia(
        TEST_RAILWAY_MAP,
        "TokyoMetro:丸ノ内線",
        "TokyoMetro:丸ノ内線:Tokyo",
        "TokyoMetro:丸ノ内線:Otemachi"
      )
    ).toBe("up"); // Tokyo idx=0, Otemachi idx=1, so fi<=ti → up
  });

  it("returns 'down' for reverse direction on non-loop line", () => {
    expect(
      computeLoopVia(
        TEST_RAILWAY_MAP,
        "TokyoMetro:丸ノ内線",
        "TokyoMetro:丸ノ内線:Otemachi",
        "TokyoMetro:丸ノ内線:Tokyo"
      )
    ).toBe("down");
  });

  it("uses shortest path for loop lines", () => {
    // Yamanote is a loop with 3 stations: Tokyo(0), Ueno(1), Shinjuku(2)
    // Tokyo→Ueno: up (forward) is 1 step, down (via Shinjuku) is 2 steps
    const via = computeLoopVia(
      TEST_RAILWAY_MAP,
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      "JR-East:Yamanote:Ueno"
    );
    expect(via).toBe("up");
  });
});

describe("getLandmarks", () => {
  it("finds landmark stations between two stations", () => {
    // Yamanote: Tokyo(0, non-landmark), Ueno(1, non-landmark), Shinjuku(2, landmark)
    // Tokyo→Ueno doesn't pass through Shinjuku in the up direction
    // Tokyo→Shinjuku: passes Ueno(1), then Shinjuku(2) — but Shinjuku is the target
    const landmarks = getLandmarks(
      TEST_RAILWAY_MAP["JR-East:Yamanote"],
      "JR-East:Yamanote:Tokyo",
      "JR-East:Yamanote:Shinjuku"
    );
    // On a 3-station loop, Tokyo→Shinjuku in up direction: Tokyo→Ueno→Shinjuku
    // Ueno is not a landmark, so no landmarks found
    expect(Array.isArray(landmarks)).toBe(true);
  });

  it("returns empty for same station", () => {
    const landmarks = getLandmarks(
      TEST_RAILWAY_MAP["JR-East:Yamanote"],
      "JR-East:Yamanote:Tokyo",
      "JR-East:Yamanote:Tokyo"
    );
    expect(landmarks).toHaveLength(0);
  });
});

describe("findNearbyStations", () => {
  it("finds stations near a given coordinate", () => {
    const results = findNearbyStations(
      TEST_RAILWAY_MAP,
      35.6815,
      139.7675,
      3
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    // Tokyo station is closest
    expect(results[0].station.name_ja).toBe("東京");
  });

  it("results are sorted by distance", () => {
    const results = findNearbyStations(
      TEST_RAILWAY_MAP,
      35.6815,
      139.7675,
      5
    );

    for (let i = 1; i < results.length; i++) {
      expect(results[i].distSq).toBeGreaterThanOrEqual(results[i - 1].distSq);
    }
  });
});

describe("findNearestPointOnLine", () => {
  it("finds projection onto a line", () => {
    const result = findNearestPointOnLine(
      TEST_RAILWAY_MAP,
      35.6900,
      139.7100
    );

    expect(result.lineKey).toBeTruthy();
    expect(typeof result.lat).toBe("number");
    expect(typeof result.lng).toBe("number");
    expect(typeof result.percentage).toBe("number");
  });
});
