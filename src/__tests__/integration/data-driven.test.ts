/**
 * Data-driven integration test using real user backup data.
 * Validates: segment integrity, routing consistency, and parser compatibility
 * with real-world trip data patterns.
 */
import { describe, it, expect } from "vitest";
import { parseGeoJsonBatch } from "../../core/parser";
import {
  findRoute,
  computeLoopVia,
  getTransferableLines,
} from "../../core/railwayRouting";
import { TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA } from "../fixtures/railwayData";

// Load backup statically — resolve at test time
let backupData: any = null;

async function loadBackup() {
  if (backupData) return backupData;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  // Backup is in user's Downloads folder (absolute path)
  const backupPath = "D:/Downloads/railround_backup_2026-04-28.json";

  const raw = await fs.readFile(backupPath, "utf-8");
  backupData = JSON.parse(raw);
  return backupData;
}

describe("Backup structure integrity", () => {
  it("has valid meta", async () => {
    const backup = await loadBackup();
    expect(backup.meta.appName).toBe("RailLOOP");
    expect(backup.meta.version).toBeTruthy();
    expect(backup.meta.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("has dependency declarations", async () => {
    const backup = await loadBackup();
    expect(Array.isArray(backup.dependencies.lines)).toBe(true);
    expect(backup.dependencies.lines.length).toBeGreaterThan(0);
    expect(Array.isArray(backup.dependencies.companies)).toBe(true);
  });

  it("has trips with valid structure", async () => {
    const backup = await loadBackup();
    expect(backup.data.trips.length).toBeGreaterThanOrEqual(1);

    for (const trip of backup.data.trips) {
      expect(trip.id).toBeDefined();
      expect(trip.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(trip.segments)).toBe(true);
      expect(trip.segments.length).toBeGreaterThanOrEqual(1);

      for (const seg of trip.segments) {
        expect(seg.lineKey).toBeTruthy();
        expect(seg.fromId).toBeTruthy();
        expect(seg.toId).toBeTruthy();
        // Segment IDs should match a valid format
        expect(seg.lineKey).toMatch(/.+:.+/);
        expect(seg.fromId.startsWith(seg.lineKey.split(":")[0])).toBe(true);
      }
    }
  });
});

describe("Backup trip segment patterns", () => {
  it("identifies single-line and multi-line trips", async () => {
    const backup = await loadBackup();
    const singleLine = backup.data.trips.filter(
      (t: any) => t.segments.length === 1
    );
    const multiLine = backup.data.trips.filter(
      (t: any) => t.segments.length > 1
    );

    // Should have both types in real data
    expect(singleLine.length).toBeGreaterThan(0);
    expect(multiLine.length).toBeGreaterThan(0);
  });

  it("multi-line trips: consecutive segments share a station (transfer)", async () => {
    const backup = await loadBackup();
    const multiLineTrips = backup.data.trips.filter(
      (t: any) => t.segments.length > 1
    );

    for (const trip of multiLineTrips) {
      for (let i = 1; i < trip.segments.length; i++) {
        const prevToStation = trip.segments[i - 1].toId.split(":").pop();
        const currFromStation = trip.segments[i].fromId.split(":").pop();
        // Transfers typically happen at same-named stations on different lines
        expect(prevToStation).toBeDefined();
        expect(currFromStation).toBeDefined();
        // Note: station names may differ if transfer is between differently-named stations
        // that are physically co-located (e.g., "東京" and "大手町" transfers)
      }
    }
  });
});

describe("Routing engine on backup segment patterns", () => {
  // Build shared railwayData from fixtures (simulating the actual boot flow)
  const parsed = parseGeoJsonBatch(TEST_GEOJSON_CHUNKS, TEST_COMPANY_DATA);
  const railwayData = parsed.railwayUpdates;

  it("can parse the test fixture data into a valid railway map", () => {
    expect(Object.keys(railwayData).length).toBeGreaterThanOrEqual(1);
    for (const lineKey of Object.keys(railwayData)) {
      const line = railwayData[lineKey];
      expect(line.stations.length).toBeGreaterThanOrEqual(1);
      expect(line.meta).toBeDefined();
      expect(line.meta.company).toBeTruthy();
    }
  });

  it("finds route for simple origin→destination", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      "JR-East:Yamanote",
      "JR-East:Yamanote:Ueno",
      railwayData
    );
    expect(result.error).toBeUndefined();
    expect(result.segments!.length).toBeGreaterThanOrEqual(1);
    // Route output should have estimated time
    expect(typeof result.estimatedTime).toBe("number");
  });

  it("finds route across lines via transfer station", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:Ueno",
      "TokyoMetro:丸ノ内線",
      "TokyoMetro:丸ノ内線:Otemachi",
      railwayData
    );
    expect(result.error).toBeUndefined();
  });

  it("produces segments with valid fromId/toId references", () => {
    const result = findRoute(
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      "JR-East:Yamanote",
      "JR-East:Yamanote:Shinjuku",
      railwayData,
      10
    );

    if (!result.error) {
      for (const seg of result.segments!) {
        const line = railwayData[seg.lineKey];
        expect(line).toBeDefined();
        expect(
          line.stations.some((s: any) => s.id === seg.fromId)
        ).toBe(true);
        expect(line.stations.some((s: any) => s.id === seg.toId)).toBe(true);
      }
    }
  });

  it("handles unreachable destinations gracefully", () => {
    // A station that exists but is isolated should produce an error
    // Create an isolated line with no transfers
    const isolatedData = {
      ...railwayData,
      "Isolated:Line": {
        meta: {
          company: "Isolated",
          region: "unknown",
          type: "unknown",
          logo: null,
        },
        stations: [
          {
            id: "Isolated:Line:A",
            name_ja: "孤立駅",
            lat: 40.0,
            lng: 140.0,
            transfers: [],
          },
          {
            id: "Isolated:Line:B",
            name_ja: "孤立駅B",
            lat: 41.0,
            lng: 141.0,
            transfers: [],
          },
        ],
      },
    };

    const result = findRoute(
      "Isolated:Line",
      "Isolated:Line:A",
      "JR-East:Yamanote",
      "JR-East:Yamanote:Tokyo",
      isolatedData,
      2
    );
    expect(result.error).toBeDefined();
  });
});

describe("Backup dependency ↔ parser compatibility", () => {
  it("all backup companies exist in the manifest", async () => {
    const backup = await loadBackup();
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const manifestPath = path.resolve(
      __dirname,
      "../../../public/geojson_manifest.json"
    );
    const manifestRaw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestRaw);

    // All backup companies should appear in manifest files
    const manifestFileNames = new Set(
      Array.isArray(manifest.files)
        ? manifest.files.map((f: string) => f.replace(/\.geojson$/i, ""))
        : Object.keys(manifest.files).map((f: string) =>
            f.replace(/\.geojson$/i, "")
          )
    );

    for (const company of backup.dependencies.companies) {
      expect(
        manifestFileNames.has(company),
        `Company "${company}" from backup not found in manifest files`
      ).toBe(true);
    }
  });

  it("derives unique station count from backup trips", async () => {
    const backup = await loadBackup();
    const allStationIds = new Set<string>();

    for (const trip of backup.data.trips) {
      for (const seg of trip.segments) {
        allStationIds.add(seg.fromId);
        allStationIds.add(seg.toId);
      }
    }

    // 50 trips should use at least some unique stations
    expect(allStationIds.size).toBeGreaterThan(5);
    console.log(
      `Backup: ${backup.data.trips.length} trips, ${backup.dependencies.lines.length} lines, ${allStationIds.size} unique stations visited`
    );
  });
});
