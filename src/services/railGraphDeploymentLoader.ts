import type { DeployedSystem } from "../rail-graph-v1/deployment.types";
import type { SystemContext } from "../rail-graph-v1/graph.types";
import type { RailGraphRuntimeState } from "../store";

export interface RailGraphDeploymentBundle {
  system: SystemContext;
  deployed: DeployedSystem;
}

export interface LoadRailGraphDeploymentOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

export type LoadRailGraphDeploymentResult =
  | {
      status: "loaded";
      runtime: RailGraphRuntimeState;
    }
  | {
      status: "not_found" | "invalid" | "error";
      reason: string;
    };

export const DEFAULT_RAIL_GRAPH_DEPLOYMENT_URL = "/rail-graph/deployed-system.json";

export async function loadDefaultRailGraphDeployment(
  options: LoadRailGraphDeploymentOptions = {},
): Promise<LoadRailGraphDeploymentResult> {
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  if (!fetcher) {
    return { status: "error", reason: "fetch is unavailable in this runtime." };
  }

  const url = options.url ?? DEFAULT_RAIL_GRAPH_DEPLOYMENT_URL;
  try {
    const response = await fetcher(url, { cache: "no-cache" });
    if (!response.ok) {
      return response.status === 404
        ? { status: "not_found", reason: `Rail graph deployment bundle was not found at ${url}.` }
        : { status: "error", reason: `Rail graph deployment bundle request failed with HTTP ${response.status}.` };
    }
    const json = await response.json();
    const bundle = parseRailGraphDeploymentBundle(json);
    if (!bundle) {
      return { status: "invalid", reason: "Rail graph deployment bundle is missing system/deployed data." };
    }
    return {
      status: "loaded",
      runtime: {
        system: bundle.system,
        deployed: bundle.deployed,
        source: "static_bundle",
        loadedAt: options.now?.() ?? new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Rail graph deployment bundle could not be loaded.",
    };
  }
}

export function parseRailGraphDeploymentBundle(value: unknown): RailGraphDeploymentBundle | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const system = record.system;
  const deployed = record.deployed;
  if (!isSystemContextLike(system) || !isDeployedSystemLike(deployed)) return null;
  if (system.graphId !== deployed.sourceGraphId) return null;
  return {
    system: system as SystemContext,
    deployed: deployed as DeployedSystem,
  };
}

function isSystemContextLike(value: unknown): value is SystemContext {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const graph = record.graph as Record<string, unknown> | undefined;
  const topo = graph?.topo as Record<string, unknown> | undefined;
  const serviceTemplates = topo?.serviceTemplates as Record<string, unknown> | undefined;
  return typeof record.graphId === "string"
    && !!graph
    && graph.schemaVersion === "rail-graph-v1"
    && !!topo?.base
    && Array.isArray(serviceTemplates?.servicePatterns);
}

function isDeployedSystemLike(value: unknown): value is DeployedSystem {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.systemId === "string"
    && typeof record.sourceGraphId === "string"
    && typeof record.contentHash === "string"
    && Array.isArray(record.templates)
    && Array.isArray(record.stations)
    && Array.isArray(record.generatedPresets)
    && !!record.presetHashes
    && typeof record.presetHashes === "object";
}
