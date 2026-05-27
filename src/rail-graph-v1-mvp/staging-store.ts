import { createProjectForWorkspace, createLineWorkspace, type LineWorkspaceState, type MvpGlobalSettings } from "./pipeline";
import { pointToPolylineMeters, featureBbox, bboxExpandMeters, bboxesIntersect, type Bbox } from "./spatial-helpers";
import type { GeoJSONPosition } from "../rail-graph-v1/geojson";

function fidOf(f: any): string {
  const props = f.properties || {};
  if (typeof props._fid === "string" && props._fid.length > 0) return props._fid;
  return `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
}

function isLineGeometry(f: any): boolean {
  const t = f?.geometry?.type;
  return t === "LineString" || t === "MultiLineString";
}

function geometryLines(g: any): GeoJSONPosition[][] {
  if (!g) return [];
  if (g.type === "LineString") return g.coordinates?.length >= 2 ? [g.coordinates] : [];
  if (g.type === "MultiLineString") return (g.coordinates || []).filter((l: any) => l && l.length >= 2);
  return [];
}

function featureCentroid(f: any): GeoJSONPosition | null {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === "Point") return g.coordinates;
  const bbox = featureBbox(f);
  if (!bbox) return null;
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

const BUFFER_M = 250;

export function collectRelatedFeatures(
  queueFids: Set<string>,
  passFeatures: any[],
): any[] {
  const queueWays: any[] = [];
  const nonQueueFeatures: any[] = [];

  for (const f of passFeatures) {
    const fid = fidOf(f);
    if (queueFids.has(fid)) {
      queueWays.push(f);
    } else {
      nonQueueFeatures.push(f);
    }
  }

  if (queueWays.length === 0) return [];

  const allLines: GeoJSONPosition[][] = [];
  for (const w of queueWays) {
    for (const line of geometryLines(w.geometry)) allLines.push(line);
  }
  if (allLines.length === 0) return [...queueWays];

  const corridorBbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const w of queueWays) {
    const bb = featureBbox(w);
    if (bb) {
      if (bb[0] < corridorBbox[0]) corridorBbox[0] = bb[0];
      if (bb[1] < corridorBbox[1]) corridorBbox[1] = bb[1];
      if (bb[2] > corridorBbox[2]) corridorBbox[2] = bb[2];
      if (bb[3] > corridorBbox[3]) corridorBbox[3] = bb[3];
    }
  }
  const expandedBbox = bboxExpandMeters(corridorBbox, BUFFER_M);

  const matched: any[] = [...queueWays];

  for (const f of nonQueueFeatures) {
    if (isLineGeometry(f)) continue;

    const fBbox = featureBbox(f);
    if (fBbox && !bboxesIntersect(expandedBbox, fBbox)) continue;

    const pt = featureCentroid(f);
    if (!pt) continue;

    let minDist = Infinity;
    for (const line of allLines) {
      const d = pointToPolylineMeters(pt, line);
      if (d < minDist) minDist = d;
      if (minDist <= BUFFER_M) break;
    }
    if (minDist <= BUFFER_M) {
      matched.push(f);
    }
  }

  return matched;
}

export async function exportQueueToNewWorkspace(
  currentWorkspace: LineWorkspaceState,
  queueFids: Set<string>,
  passFeatures: any[],
  globalSettings: MvpGlobalSettings,
): Promise<LineWorkspaceState> {
  const newName = `${currentWorkspace.project.lineName}_extracted`;
  const newLineName = `${currentWorkspace.project.lineName}_v2`;

  const features = collectRelatedFeatures(queueFids, passFeatures);

  const featureCollection = {
    type: "FeatureCollection",
    features,
  };

  const project = createProjectForWorkspace(newName, currentWorkspace.project.companyName, newLineName, globalSettings);
  const workspace = createLineWorkspace(project);

  const targetPath = `${project.lineDir}\\matched_assets.geojson`;

  const response = await fetch("/api/rail-graph-mvp/workspace/seed-source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectKey: workspace.key,
      sourceGeoJsonPath: targetPath,
      geojsonSourceDir: globalSettings.geojsonSourceDir,
      matchedOutputRoot: globalSettings.matchedOutputRoot,
      featureCollection,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to seed source GeoJSON: ${response.statusText}`);
  }

  return workspace;
}
