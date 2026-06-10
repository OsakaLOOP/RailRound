import type { IntentionChain } from "../rail-graph-v1/chain.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import { importWorkspaces, loadAggregate } from "./aggregate-state";
import { findEdgeByOsmId } from "./no-direction-graph";
import { adaptChainToPattern } from "./service-pattern/adapter";
import { saveServicePatterns, type StoredServicePattern } from "./service-pattern/store";
import { saveUserEvents } from "./user-event/store";
import type { UserEvent } from "./user-event/types";

const AGGREGATE_KEY = "senseki-tohoku";
const nodeProcess = globalThis as unknown as {
  process?: { exit(code?: number): never };
};

async function main(): Promise<void> {
  await importWorkspaces({
    aggregateKey: AGGREGATE_KEY,
    allowNoDirection: true,
    noDirectionReason: "verify",
  });
  const aggregate = await loadAggregate({
    aggregateKey: AGGREGATE_KEY,
    allowNoDirection: true,
    noDirectionReason: "verify",
  });

  const sendai = mustEdge("1015018069", "仙台側 edge");
  const connector = mustEdge("351315049", "仙石東北 connector edge");
  const ishinomaki = mustEdge("882389027", "石巻側 edge");

  const tohokuChain = chainFromNodes({
    originNodeRef: sendai.fromNodeRef,
    viaEdgeRefs: [connector.id],
    terminusNodeRef: connector.toNodeRef,
  });
  const sensekiChain = chainFromNodes({
    originNodeRef: connector.toNodeRef,
    terminusNodeRef: ishinomaki.toNodeRef,
  });
  const throughChain = chainFromNodes({
    originNodeRef: sendai.fromNodeRef,
    viaEdgeRefs: [connector.id],
    terminusNodeRef: ishinomaki.toNodeRef,
  });

  const patterns: StoredServicePattern[] = [
    adaptChainToPattern({
      chain: tohokuChain,
      aggregate,
      patternId: "aggregate:pattern:tohoku-connector" as EntityRef,
      displayName: "東北本線 connector segment",
      displayColor: "#2563eb",
      lineRef: "aggregate:line:tohoku-main" as EntityRef,
      serviceType: "local",
    }),
    adaptChainToPattern({
      chain: sensekiChain,
      aggregate,
      patternId: "aggregate:pattern:senseki-east" as EntityRef,
      displayName: "仙石線 east segment",
      displayColor: "#16a34a",
      lineRef: "aggregate:line:senseki" as EntityRef,
      serviceType: "local",
    }),
    adaptChainToPattern({
      chain: throughChain,
      aggregate,
      patternId: "aggregate:pattern:senseki-tohoku-through" as EntityRef,
      displayName: "仙石東北ライン through",
      displayColor: "#dc2626",
      lineRef: "aggregate:line:senseki-tohoku" as EntityRef,
      serviceType: "rapid",
    }),
  ];

  await saveServicePatterns({ aggregateKey: AGGREGATE_KEY, patterns });

  const transferStationRef = connector.toNodeRef;
  const events: UserEvent[] = [
    {
      id: "aggregate:event:sendai-origin-note" as EntityRef,
      kind: "user_defined",
      anchor: { kind: "station", stationRef: patterns[0].traceSequence[0].stationRef },
      title: "仙台側起点確認",
      payload: { source: "seed-default-data" },
    },
    {
      id: "aggregate:event:connector-transfer" as EntityRef,
      kind: "user_defined",
      anchor: { kind: "station", stationRef: transferStationRef },
      title: "联络线换乘/直通接续点",
      payload: { source: "seed-default-data", appearsInTwoHops: true },
    },
    {
      id: "aggregate:event:connector-edge-midpoint" as EntityRef,
      kind: "user_defined",
      anchor: { kind: "edge", edgeRef: connector.id, measure: 0.5 },
      title: "联络线中点",
      payload: { source: "seed-default-data" },
    },
  ];
  await saveUserEvents({ aggregateKey: AGGREGATE_KEY, events });

  console.log("Seeded aggregate default data");
  console.log(`aggregateKey=${AGGREGATE_KEY}`);
  console.log(`patterns=${patterns.length}`);
  for (const pattern of patterns) {
    console.log(`- ${pattern.patternId}: edges=${pattern.edgeSequence.length}, stations=${pattern.traceSequence.length}`);
  }
  console.log(`events=${events.length}`);

  function mustEdge(osmId: string, label: string) {
    const edge = findEdgeByOsmId(aggregate.topo, osmId);
    if (!edge) throw new Error(`Missing ${label}: OSM way ${osmId}`);
    return edge;
  }
}

function chainFromNodes(args: {
  originNodeRef: EntityRef;
  terminusNodeRef: EntityRef;
  viaEdgeRefs?: EntityRef[];
}): IntentionChain {
  return {
    mode: "sketch",
    nodes: [
      { kind: "origin", at: { nodeRef: args.originNodeRef }, direction: "down" },
      ...(args.viaEdgeRefs ?? []).map((edgeRef) => ({ kind: "via_edge" as const, edgeRef })),
      { kind: "terminus", at: { nodeRef: args.terminusNodeRef } },
    ],
  };
}

main().catch((error) => {
  console.error(error);
  nodeProcess.process?.exit(1);
  throw error;
});
