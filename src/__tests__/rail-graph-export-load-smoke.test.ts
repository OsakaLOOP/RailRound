// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  exportSensekiSnapshot,
  exportTopology,
  importGeoJson,
  importSensekiSnapshot,
  loadGeoJson,
} from "../rail-graph-v1-mvp/app";
import { SENSEKI_RAIL, SENSEKI_STATIONS } from "../rail-graph-v1-mvp/senseki-data";

describe("rail-graph export/load smoke", () => {
  it("round-trips the MVP Senseki snapshot through the real import path", () => {
    loadGeoJson(SENSEKI_RAIL);
    importGeoJson(SENSEKI_STATIONS);

    const before = exportTopology();
    const snapshot = exportSensekiSnapshot();
    const imported = importSensekiSnapshot(snapshot);
    const after = exportTopology();

    expect(snapshot.schemaVersion).toBe("senseki-demo-v2");
    expect(snapshot.workflow).toMatchObject({
      exportMode: "forced_direction",
      noDirectionPathfindingExportable: true,
    });
    expect(snapshot.source.features.length).toBeGreaterThan(0);
    expect(before.edges.length).toBeGreaterThan(0);
    expect(after.edges.length).toBe(before.edges.length);
    expect(after.stations.length).toBe(before.stations.length);
    expect(imported.bindingsRestored).toBe(snapshot.bindings.length);
    expect(imported.stoppingPointsRestored).toBe(snapshot.stoppingPoints.length);
  });
});
