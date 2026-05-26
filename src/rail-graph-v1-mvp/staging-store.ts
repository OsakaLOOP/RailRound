import { createProjectForWorkspace, createLineWorkspace, type LineWorkspaceState, type MvpGlobalSettings } from "./pipeline";

/* 仅对某个独立的功能或者组件/长工具函数添加简短中英注释 / Export staged way features to a new workspace and seed its source GeoJSON. */
export async function exportStagedToNewWorkspace(
  currentWorkspace: LineWorkspaceState,
  staging: NonNullable<LineWorkspaceState["staging"]>,
  globalSettings: MvpGlobalSettings,
  sourceFeatures: any[]
): Promise<LineWorkspaceState> {
  const newName = `${currentWorkspace.project.lineName}_extracted`;
  const newLineName = `${currentWorkspace.project.lineName}_v2`;
  
  const stagedSet = new Set(staging.stagedWayFids);
  const filteredFeatures = sourceFeatures.filter(f => {
    const props = f.properties || {};
    const fid = props._fid || `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
    return stagedSet.has(fid);
  });
  
  const featureCollection = {
    type: "FeatureCollection",
    features: filteredFeatures
  };
  
  const project = createProjectForWorkspace(newName, currentWorkspace.project.companyName, newLineName, globalSettings);
  const workspace = createLineWorkspace(project);
  
  const response = await fetch("/api/rail-graph-mvp/workspace/seed-source", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      projectKey: workspace.key,
      sourceGeoJsonPath: workspace.project.sourceGeoJsonPath,
      geojsonSourceDir: globalSettings.geojsonSourceDir,
      featureCollection
    })
  });
  
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to seed source GeoJSON: ${response.statusText}`);
  }
  
  return workspace;
}
