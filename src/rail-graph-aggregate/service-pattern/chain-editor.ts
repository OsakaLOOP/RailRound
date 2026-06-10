import type { IntentionChain, IntentionNode } from "../../rail-graph-v1/chain.types";
import type { EntityRef } from "../../rail-graph-v1/primitives";

export type ChainEditorMode = "idle" | "picking-origin" | "picking-via" | "picking-terminus";

export interface ChainEditorState {
  mode: ChainEditorMode;
  chain: IntentionChain;
}

export function createChainEditorState(): ChainEditorState {
  return {
    mode: "idle",
    chain: { mode: "sketch", nodes: [] },
  };
}

export function setChainEditorMode(state: ChainEditorState, mode: ChainEditorMode): ChainEditorState {
  return { ...state, mode };
}

export function addNodeSelection(state: ChainEditorState, selection: {
  nodeRef?: EntityRef;
  edgeRef?: EntityRef;
  direction?: "up" | "down";
}): ChainEditorState {
  const nodes = [...state.chain.nodes];
  if (state.mode === "picking-origin" && selection.nodeRef) {
    const origin: IntentionNode = {
      kind: "origin",
      at: { nodeRef: selection.nodeRef },
      direction: selection.direction ?? "down",
    };
    return {
      mode: "idle",
      chain: { ...state.chain, nodes: [origin, ...nodes.filter((node) => node.kind !== "origin")] },
    };
  }
  if (state.mode === "picking-via" && selection.edgeRef) {
    const terminus = nodes.find((node) => node.kind === "terminus");
    const withoutTerminus = nodes.filter((node) => node.kind !== "terminus");
    const nextNodes: IntentionNode[] = [...withoutTerminus, { kind: "via_edge", edgeRef: selection.edgeRef }];
    if (terminus) nextNodes.push(terminus);
    return { mode: "idle", chain: { ...state.chain, nodes: nextNodes } };
  }
  if (state.mode === "picking-terminus" && selection.nodeRef) {
    const terminus: IntentionNode = { kind: "terminus", at: { nodeRef: selection.nodeRef } };
    return {
      mode: "idle",
      chain: { ...state.chain, nodes: [...nodes.filter((node) => node.kind !== "terminus"), terminus] },
    };
  }
  return state;
}

export function replaceChainNodes(state: ChainEditorState, nodes: IntentionNode[]): ChainEditorState {
  return { ...state, chain: { ...state.chain, nodes } };
}

export function describeChainNode(node: IntentionNode): string {
  switch (node.kind) {
    case "origin":
      return `origin ${"nodeRef" in node.at ? node.at.nodeRef : node.at.edgeRef}`;
    case "terminus":
      return `terminus ${"nodeRef" in node.at ? node.at.nodeRef : node.at.edgeRef}`;
    case "via_edge":
      return `via ${node.edgeRef}`;
    case "passage":
      return `passage ${node.through}`;
    case "service_stop":
      return `stop ${node.at}`;
    case "reversal":
      return `reversal ${node.at ?? ""}`;
    case "technical_stop":
      return `technical ${node.at}`;
    case "operation":
      return `operation ${node.at}`;
  }
}
