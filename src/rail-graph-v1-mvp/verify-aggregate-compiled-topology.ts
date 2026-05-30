// ============================================================
// Goal 02 Verify · Aggregate compiled-topology ServicePattern path
//
// Usage:
//   npm run rail:aggregate:verify:compiled-topology
//
// This check is intentionally synthetic. Current real aggregate fixtures are
// no-direction verification data, so this script proves the product branch in
// service-pattern/adapter.ts without depending on human-annotated imports.
// ============================================================

import fs from "node:fs";
import path from "node:path";

import type { AggregateState } from "../rail-graph-aggregate/aggregate-state";
import {
  adaptChainToPattern,
  resolveChainCandidates,
} from "../rail-graph-aggregate/service-pattern/adapter";
import type { BaseTopologyLayer } from "../rail-graph-v1/base-topology.types";
import type { IntentionChain } from "../rail-graph-v1/chain.types";
import type { FindPathsV2Args, FindPathsV2Result } from "../rail-graph-v1/pathfinding-v2";
import type { EntityRef } from "../rail-graph-v1/primitives";
import { buildAdjacency, buildTopologyLookup } from "../rail-graph-v1/topology";

const OUT_DIR = path.resolve("src", "rail-graph-aggregate", ".verify");
const PHASE = "compiled-topology";

interface Failure {
  check: string;
  detail: string;
}

const failures: Failure[] = [];
const checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }> = [];

function assert(check: string, condition: boolean, detail: string): void {
  if (condition) {
    checks.push({ check, status: "PASS" });
  } else {
    checks.push({ check, status: "FAIL", detail });
    failures.push({ check, detail });
  }
}

function writeReport(name: string, data: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`,
    "utf8",
  );
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("[verify-compiled-topology] starting synthetic compiled topology check");

  const aggregate = createSyntheticCompiledAggregate();
  const lookup = buildTopologyLookup(aggregate.topo);
  const chain = createSyntheticChain();

  writeReport(`${PHASE}-01-input.json`, {
    aggregateKey: aggregate.aggregateKey,
    mode: aggregate.mode,
    topoCounts: {
      nodes: aggregate.topo.nodes.length,
      edges: aggregate.topo.edges.length,
    },
    chain,
  });

  const stubCapture: {
    calls: number;
    args?: FindPathsV2Args;
  } = { calls: 0 };
  const stubFindPaths = (args: FindPathsV2Args): FindPathsV2Result => {
    stubCapture.calls += 1;
    stubCapture.args = args;
    return {
      candidates: [{
        edgeSequence: ["synthetic:edge:a-b", "synthetic:edge:b-c"] as EntityRef[],
        edgeEntryNodes: ["synthetic:node:a", "synthetic:node:b"] as EntityRef[],
        turnbackAt: [],
        totalDistanceMeters: 200,
        startKind: "main",
        localDiagnostics: [],
      }],
      diagnostics: [],
      stats: {
        lgBuildTimeMs: 0,
        searchInvocations: 1,
        totalExpansions: 2,
      },
    };
  };

  let stubPatternError: string | undefined;
  const stubPattern = (() => {
    try {
      return adaptChainToPattern({
        aggregate,
        chain,
        lookup,
        findPaths: stubFindPaths,
        patternId: "synthetic:pattern:stub" as EntityRef,
        displayName: "Synthetic compiled topology stub",
      });
    } catch (error) {
      stubPatternError = (error as Error).message;
      return null;
    }
  })();

  assert("adaptChainToPattern with stub findPaths does not throw", !stubPatternError, stubPatternError ?? "");
  assert("compiled-topology branch calls provided findPaths", stubCapture.calls === 1, `stubCalls=${stubCapture.calls}`);
  assert(
    "provided findPaths receives compiled aggregate topology",
    stubCapture.args?.topo === aggregate.topo && stubCapture.args?.lookup === lookup,
    "findPaths args did not receive the expected topo/lookup references",
  );
  assert(
    "stub pattern preserves compiled-topology metadata",
    stubPattern?.metadata?.graphMode === "compiled-topology",
    `metadata=${JSON.stringify(stubPattern?.metadata ?? null)}`,
  );
  assert(
    "stub pattern edgeSequence uses stub candidate",
    JSON.stringify(stubPattern?.edgeSequence ?? []) === JSON.stringify(["synthetic:edge:a-b", "synthetic:edge:b-c"]),
    `edgeSequence=${JSON.stringify(stubPattern?.edgeSequence ?? [])}`,
  );

  let realCandidatesError: string | undefined;
  let realCandidates: ReturnType<typeof resolveChainCandidates> = [];
  try {
    realCandidates = resolveChainCandidates({
      aggregate,
      chain,
      lookup,
      maxCandidates: 2,
    });
  } catch (error) {
    realCandidatesError = (error as Error).message;
  }

  const firstReal = realCandidates[0];
  assert("real findPathsV2 candidates do not throw", !realCandidatesError, realCandidatesError ?? "");
  assert("real findPathsV2 returns at least one candidate", realCandidates.length >= 1, `count=${realCandidates.length}`);
  assert(
    "real findPathsV2 candidate edgeSequence matches synthetic route",
    JSON.stringify(firstReal?.edgeSequence ?? []) === JSON.stringify(["synthetic:edge:a-b", "synthetic:edge:b-c"]),
    `edgeSequence=${JSON.stringify(firstReal?.edgeSequence ?? [])}`,
  );
  assert(
    "real findPathsV2 candidate nodeSequence matches synthetic route",
    JSON.stringify(firstReal?.nodeSequence ?? []) === JSON.stringify(["synthetic:node:a", "synthetic:node:b", "synthetic:node:c"]),
    `nodeSequence=${JSON.stringify(firstReal?.nodeSequence ?? [])}`,
  );

  let realPatternError: string | undefined;
  const realPattern = (() => {
    try {
      return adaptChainToPattern({
        aggregate,
        chain,
        lookup,
        patternId: "synthetic:pattern:real-v2" as EntityRef,
        displayName: "Synthetic compiled topology real v2",
      });
    } catch (error) {
      realPatternError = (error as Error).message;
      return null;
    }
  })();

  assert("adaptChainToPattern with real findPathsV2 does not throw", !realPatternError, realPatternError ?? "");
  assert(
    "real pattern has path segments for every edge",
    (realPattern?.pathSegments.length ?? 0) === 2,
    `pathSegments=${realPattern?.pathSegments.length ?? 0}`,
  );
  assert(
    "real pattern trace sequence includes route nodes",
    JSON.stringify(realPattern?.traceSequence.map((entry) => entry.stationRef) ?? []) === JSON.stringify([
      "synthetic:node:a",
      "synthetic:node:b",
      "synthetic:node:c",
    ]),
    `trace=${JSON.stringify(realPattern?.traceSequence.map((entry) => entry.stationRef) ?? [])}`,
  );

  writeReport(`${PHASE}-02-stub-pattern.json`, {
    stubCalls: stubCapture.calls,
    stubPattern,
  });
  writeReport(`${PHASE}-03-real-candidates.json`, {
    error: realCandidatesError ?? null,
    candidates: realCandidates,
  });
  writeReport(`${PHASE}-04-real-pattern.json`, {
    error: realPatternError ?? null,
    realPattern,
  });

  const allPass = failures.length === 0;
  writeReport(`${PHASE}-summary.md`, renderSummaryMd({
    checks,
    failures,
    stubCalls: stubCapture.calls,
    realCandidateCount: realCandidates.length,
  }));

  console.log("");
  console.log("====================================================");
  if (allPass) {
    console.log("AGGREGATE VERIFY (compiled-topology): PASS");
  } else {
    console.log("AGGREGATE VERIFY (compiled-topology): FAIL");
    for (const failure of failures) {
      console.log(`  x ${failure.check}`);
      console.log(`    ${failure.detail}`);
    }
  }
  console.log("====================================================");
  console.log(`Report dir: ${OUT_DIR}`);
  console.log("");

  process.exit(allPass ? 0 : 1);
}

function createSyntheticCompiledAggregate(): AggregateState {
  const topo = createSyntheticTopology();
  const now = new Date().toISOString();
  return {
    aggregateKey: "synthetic-compiled-topology",
    memberWorkspaceKeys: ["synthetic-a", "synthetic-b"],
    mode: "compiled-topology",
    featureCollection: {
      type: "FeatureCollection",
      features: [],
    },
    topo,
    diagnostics: [],
    perWorkspaceEdgeCount: {
      "synthetic-a": 1,
      "synthetic-b": 1,
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: "import",
      note: "Synthetic compiled topology used only for adapter verification.",
    },
  };
}

function createSyntheticTopology(): BaseTopologyLayer {
  const nodes: BaseTopologyLayer["nodes"] = [
    { id: "synthetic:node:a" as EntityRef, kind: "line_endpoint", name: "A" },
    { id: "synthetic:node:b" as EntityRef, kind: "junction", name: "B" },
    { id: "synthetic:node:c" as EntityRef, kind: "line_endpoint", name: "C" },
  ];
  const edges: BaseTopologyLayer["edges"] = [
    {
      id: "synthetic:edge:a-b" as EntityRef,
      fromNodeRef: "synthetic:node:a" as EntityRef,
      toNodeRef: "synthetic:node:b" as EntityRef,
      traversal: "both",
      role: "main",
      lengthMeters: 100,
      coordinates: [[140.0000, 38.0000], [140.0010, 38.0000]],
      geometryRef: "synthetic:geometry:a-b" as EntityRef,
      physicalKind: "main",
      functionalUse: ["through"],
      directionRole: "bidirectional",
    },
    {
      id: "synthetic:edge:b-c" as EntityRef,
      fromNodeRef: "synthetic:node:b" as EntityRef,
      toNodeRef: "synthetic:node:c" as EntityRef,
      traversal: "both",
      role: "main",
      lengthMeters: 100,
      coordinates: [[140.0010, 38.0000], [140.0020, 38.0000]],
      geometryRef: "synthetic:geometry:b-c" as EntityRef,
      physicalKind: "main",
      functionalUse: ["through"],
      directionRole: "bidirectional",
    },
  ];

  return {
    nodes,
    edges,
    adjacency: buildAdjacency(edges),
    stations: nodes.map((node) => ({
      id: node.id,
      name: node.name ?? String(node.id),
      platformRefs: [],
    })),
    platforms: [],
    platformTrackBindings: [],
    stoppingPoints: [],
    signals: [],
    specialSections: [],
    doubleTrackPairs: [],
    relations: [],
    hardConstraints: [],
  };
}

function createSyntheticChain(): IntentionChain {
  return {
    mode: "strict",
    nodes: [
      {
        kind: "origin",
        at: { nodeRef: "synthetic:node:a" as EntityRef },
        direction: "down",
      },
      {
        kind: "terminus",
        at: { nodeRef: "synthetic:node:c" as EntityRef },
      },
    ],
  };
}

function renderSummaryMd(args: {
  checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }>;
  failures: Failure[];
  stubCalls: number;
  realCandidateCount: number;
}): string {
  const lines: string[] = [];
  lines.push("# Goal02 Aggregate Compiled-Topology Verify Summary");
  lines.push("");
  lines.push("- aggregateKey: `synthetic-compiled-topology`");
  lines.push("- mode: `compiled-topology`");
  lines.push(`- stub findPaths calls: **${args.stubCalls}**`);
  lines.push(`- real findPathsV2 candidates: **${args.realCandidateCount}**`);
  lines.push("");
  lines.push("## Checks");
  for (const check of args.checks) {
    lines.push(`- ${check.status} ${check.check}${check.detail ? ` - ${check.detail}` : ""}`);
  }
  if (args.failures.length > 0) {
    lines.push("");
    lines.push("## Failure detail");
    for (const failure of args.failures) {
      lines.push(`### ${failure.check}`);
      lines.push("```");
      lines.push(failure.detail);
      lines.push("```");
    }
  }
  return lines.join("\n");
}

main();
