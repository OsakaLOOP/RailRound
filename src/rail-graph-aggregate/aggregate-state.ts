import type { BaseTopologyLayer } from "../rail-graph-v1/base-topology.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import type {
  AggregateFeatureCollection,
} from "./no-direction-graph";
import {
  DEFAULT_FIXTURE_SOURCES,
  buildNoDirectionAggregate,
  type FixtureSource,
} from "./no-direction-graph";
import { isNodeRuntime, readAggregateJson, writeAggregateJson } from "./storage";
import { importCompiledAggregateFromMvpWorkspaces } from "./workspace-import";

export interface AggregateState {
  aggregateKey: string;
  memberWorkspaceKeys: string[];
  mode: "compiled-topology" | "no-direction-graph";
  featureCollection: AggregateFeatureCollection;
  topo: BaseTopologyLayer;
  diagnostics: Diagnostic[];
  perWorkspaceEdgeCount: Record<string, number>;
  metadata: {
    createdAt: string;
    updatedAt: string;
    source: "fixtures" | "import";
    note: string;
  };
}

export interface LoadAggregateArgs {
  aggregateKey: string;
  memberWorkspaceKeys?: string[];
  /**
   * Only verification paths may enable this while the annotated
   * human-in-loop aggregate import is not ready.
   */
  allowNoDirection?: boolean;
  noDirectionReason?: "verify";
}

export interface ImportWorkspacesArgs {
  aggregateKey: string;
  memberWorkspaceKeys?: string[];
  fixtureSources?: FixtureSource[];
  /**
   * Current implementation imports cleaned fixtures into a no-direction graph.
   * Keep this explicit so product/default callers do not silently regress from
   * annotated aggregate topology to the verification substitute.
   */
  allowNoDirection?: boolean;
  noDirectionReason?: "verify";
}

const AGGREGATE_STATE_FILE = "aggregate-state.json";

export async function loadAggregate(args: LoadAggregateArgs): Promise<AggregateState> {
  try {
    const stored = await readAggregateJson<AggregateState>({
      aggregateKey: args.aggregateKey,
      file: AGGREGATE_STATE_FILE,
    });
    if (stored.mode === "no-direction-graph" && !args.allowNoDirection) {
      throw new Error(
        `Aggregate '${args.aggregateKey}' is a no-direction verification graph. ` +
        "Pass allowNoDirection only from verify, or import annotated aggregate data.",
      );
    }
    return normalizeAggregateState(stored, args);
  } catch (error) {
    if (!args.allowNoDirection) {
      throw new Error(
        `Aggregate '${args.aggregateKey}' is not ready. Expected aggregates/${args.aggregateKey}/${AGGREGATE_STATE_FILE}; ` +
        "default loadAggregate() will not generate the no-direction verification graph. " +
        `Cause: ${(error as Error).message}`,
      );
    }
    const seeded = await importWorkspaces({
      aggregateKey: args.aggregateKey,
      fixtureSources: DEFAULT_FIXTURE_SOURCES,
      allowNoDirection: true,
      noDirectionReason: args.noDirectionReason ?? "verify",
    });
    return normalizeAggregateState(seeded, args);
  }
}

export async function importWorkspaces(args: ImportWorkspacesArgs): Promise<AggregateState> {
  if (!args.allowNoDirection) return await importCompiledWorkspaces(args);

  const fixtureSources = args.fixtureSources ?? DEFAULT_FIXTURE_SOURCES;
  const sources = [];
  for (const fixture of fixtureSources) {
    sources.push({
      workspaceKey: fixture.workspaceKey,
      featureCollection: await readFixture(fixture),
    });
  }

  const built = buildNoDirectionAggregate({
    aggregateKey: args.aggregateKey,
    sources,
  });
  const now = new Date().toISOString();
  const state: AggregateState = {
    aggregateKey: args.aggregateKey,
    memberWorkspaceKeys: sources.map((source) => source.workspaceKey),
    mode: "no-direction-graph",
    featureCollection: built.featureCollection,
    topo: built.topo,
    diagnostics: built.diagnostics,
    perWorkspaceEdgeCount: built.perWorkspaceEdgeCount,
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: "fixtures",
      note: `No-direction aggregate graph generated from real cleaned fixtures for ${args.noDirectionReason ?? "verify"}. It is a validation substitute until user-in-loop annotated aggregate data is available.`,
    },
  };

  await saveAggregate(state);
  return state;
}

async function importCompiledWorkspaces(args: ImportWorkspacesArgs): Promise<AggregateState> {
  if (isNodeRuntime()) {
    throw new Error(
      "Compiled aggregate import requires the browser MVP workspace state and the Vite fs API. " +
      "Open rail-graph-aggregate.html and use Import MVP Workspaces.",
    );
  }
  const imported = await importCompiledAggregateFromMvpWorkspaces({
    memberWorkspaceKeys: args.memberWorkspaceKeys,
  });
  const now = new Date().toISOString();
  const state: AggregateState = {
    aggregateKey: args.aggregateKey,
    memberWorkspaceKeys: imported.memberWorkspaceKeys,
    mode: "compiled-topology",
    featureCollection: imported.featureCollection,
    topo: imported.topo,
    diagnostics: imported.diagnostics,
    perWorkspaceEdgeCount: imported.perWorkspaceEdgeCount,
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: "import",
      note: `Compiled aggregate imported from ${imported.memberWorkspaceKeys.length} MVP workspace(s). ` +
        `features=${imported.importedFeatureCount}, deduped=${imported.dedupedFeatureCount}.`,
    },
  };
  await saveAggregate(state);
  return state;
}

export async function saveAggregate(state: AggregateState): Promise<void> {
  await writeAggregateJson({
    aggregateKey: state.aggregateKey,
    file: AGGREGATE_STATE_FILE,
  }, {
    ...state,
    metadata: {
      ...state.metadata,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function readFixture(fixture: FixtureSource): Promise<AggregateFeatureCollection> {
  if (isNodeRuntime()) {
    const fsModule = "node:fs/promises";
    const fs = await import(fsModule) as {
      readFile(path: string, encoding: "utf8"): Promise<string>;
    };
    const text = await fs.readFile(fixture.nodePath, "utf8");
    return JSON.parse(text) as AggregateFeatureCollection;
  }
  const response = await fetch(fixture.browserPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch fixture ${fixture.label}: ${response.statusText}`);
  }
  return await response.json() as AggregateFeatureCollection;
}

function normalizeAggregateState(state: AggregateState, args: LoadAggregateArgs): AggregateState {
  return {
    ...state,
    aggregateKey: state.aggregateKey || args.aggregateKey,
    memberWorkspaceKeys: state.memberWorkspaceKeys?.length
      ? state.memberWorkspaceKeys
      : (args.memberWorkspaceKeys ?? DEFAULT_FIXTURE_SOURCES.map((source) => source.workspaceKey)),
  };
}
