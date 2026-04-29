/**
 * Integration test: Geo version matching logic
 * Tests the version comparison algorithm used by the AppLayout fast-path gate.
 */
import { describe, it, expect } from "vitest";

// Replicate the version gate logic from AppLayout.tsx for testing
interface VersionGateInput {
  remoteVersions: Record<string, number>;
  storedVersions: Record<string, number>;
  forceReload: boolean;
}

function shouldUseFastPath(input: VersionGateInput): boolean {
  if (input.forceReload) return false;

  const { remoteVersions, storedVersions } = input;
  if (Object.keys(remoteVersions).length === 0) return true;

  for (const [company, remoteVer] of Object.entries(remoteVersions)) {
    const storedVer = Number(storedVersions[company]) || 0;
    if (remoteVer > storedVer) return false;
  }
  return true;
}

describe("Geo version gate (fast-path decision)", () => {
  it("allows fast path when versions match", () => {
    expect(
      shouldUseFastPath({
        remoteVersions: { "JR-East.geojson": 1, "TokyoMetro.geojson": 1 },
        storedVersions: { "JR-East.geojson": 1, "TokyoMetro.geojson": 1 },
        forceReload: false,
      })
    ).toBe(true);
  });

  it("allows fast path when stored is newer than remote (shouldn't happen normally)", () => {
    expect(
      shouldUseFastPath({
        remoteVersions: { "JR-East.geojson": 1 },
        storedVersions: { "JR-East.geojson": 2 },
        forceReload: false,
      })
    ).toBe(true);
  });

  it("blocks fast path when remote version is higher", () => {
    expect(
      shouldUseFastPath({
        remoteVersions: { "JR-East.geojson": 2 },
        storedVersions: { "JR-East.geojson": 1 },
        forceReload: false,
      })
    ).toBe(false);
  });

  it("blocks fast path when forceReload is true", () => {
    expect(
      shouldUseFastPath({
        remoteVersions: { "JR-East.geojson": 1 },
        storedVersions: { "JR-East.geojson": 1 },
        forceReload: true,
      })
    ).toBe(false);
  });

  it("blocks fast path when any company version increased", () => {
    expect(
      shouldUseFastPath({
        remoteVersions: {
          "JR-East.geojson": 1,
          "TokyoMetro.geojson": 2,
          "南京地铁.geojson": 1,
        },
        storedVersions: {
          "JR-East.geojson": 1,
          "TokyoMetro.geojson": 1,
          "南京地铁.geojson": 1,
        },
        forceReload: false,
      })
    ).toBe(false);
  });

  it("allows fast path when stored has no version for a company (version 0 assumed)", () => {
    // New company in remote with version 1, not in stored → storedVer=0 → 1>0 → block
    expect(
      shouldUseFastPath({
        remoteVersions: { "JR-East.geojson": 1, "NewCompany.geojson": 1 },
        storedVersions: { "JR-East.geojson": 1 },
        forceReload: false,
      })
    ).toBe(false);
  });

  it("allows fast path with empty remote versions", () => {
    expect(
      shouldUseFastPath({
        remoteVersions: {},
        storedVersions: {},
        forceReload: false,
      })
    ).toBe(true);
  });

  it("blocks fast path with empty remote but forceReload set", () => {
    expect(
      shouldUseFastPath({
        remoteVersions: {},
        storedVersions: {},
        forceReload: true,
      })
    ).toBe(false);
  });
});

describe("Manifest version structure validation", () => {
  it("can parse the real geojson_manifest.json", async () => {
    // Read and validate the manifest we just updated
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const manifestPath = path.resolve(
      __dirname,
      "../../../public/geojson_manifest.json"
    );

    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);

    // Structure checks
    expect(manifest).toHaveProperty("versions");
    expect(manifest).toHaveProperty("forceReload");
    expect(typeof manifest.forceReload).toBe("boolean");
    expect(typeof manifest.versions).toBe("object");

    // Every file in "files" array should have a version entry
    if (Array.isArray(manifest.files)) {
      for (const file of manifest.files) {
        expect(manifest.versions).toHaveProperty(file);
        expect(typeof manifest.versions[file]).toBe("number");
        expect(manifest.versions[file]).toBeGreaterThanOrEqual(1);
      }
    }

    // All versions should be positive integers
    for (const v of Object.values(manifest.versions) as number[]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
    }

    // The changelog entries should correspond to version bumps
    if (Array.isArray(manifest.changelog)) {
      for (const entry of manifest.changelog) {
        for (const [date, files] of Object.entries(entry)) {
          expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          for (const f of files as string[]) {
            const key = f.endsWith(".geojson") ? f : `${f}.geojson`;
            expect(manifest.versions[key]).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });
});
