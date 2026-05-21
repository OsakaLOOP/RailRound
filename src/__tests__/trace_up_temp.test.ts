/**
 * @vitest-environment jsdom
 */
import { describe, it } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from '../rail-graph-v1-mvp/app';
import { SENSEKI_RAIL } from '../rail-graph-v1-mvp/senseki-data';
import { SENSEKI_PF_OVERRIDES } from '../rail-graph-v1-mvp/poc-senseki-pathfinding';
import { buildTopologyLookup } from '../rail-graph-v1/topology';

describe('Trace UP mainline contiguous segments', () => {
  it('should print the contiguous UP chain and find reversals', () => {
    // Load and annotate
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      const index = SENSEKI_RAIL.features.findIndex(f => 
        f.properties?.railGraph?.id === id || 
        f.properties?.osm_id === id.replace("osm:way:", "")
      );
      if (index !== -1) {
        annotateFeature(index, annotation as any);
      }
    });

    const topo = exportTopology();
    const lookup = buildTopologyLookup(topo);

    // Find the start edge for 775723282(1)
    const startEdges = topo.edges.filter(e => e.sourceSlice?.sourceFeatureRef?.includes("775723282(1)"));
    if (startEdges.length === 0) {
      throw new Error("Could not find start edge for 775723282(1)");
    }

    // Node D should be the one connected to crossover 1320551299
    const crossoverEdge = topo.edges.find(e => e.sourceSlice?.sourceFeatureRef === "osm:way:1320551299");
    if (!crossoverEdge) {
      throw new Error("Could not find crossover edge 1320551299");
    }

    let startNode = crossoverEdge.toNodeRef;
    let candidates = startEdges.filter(e => e.fromNodeRef === startNode || e.toNodeRef === startNode);
    if (candidates.length === 0) {
      startNode = crossoverEdge.fromNodeRef;
      candidates = startEdges.filter(e => e.fromNodeRef === startNode || e.toNodeRef === startNode);
    }

    function getNodeLon(nodeId: string, edge: any): number {
      if (!edge || !edge.coordinates || edge.coordinates.length === 0) return 0;
      if (edge.fromNodeRef === nodeId) {
        return edge.coordinates[0][0];
      } else {
        return edge.coordinates[edge.coordinates.length - 1][0];
      }
    }

    candidates.sort((a, b) => {
      const otherA = a.fromNodeRef === startNode ? a.toNodeRef : a.fromNodeRef;
      const otherB = b.fromNodeRef === startNode ? b.toNodeRef : b.fromNodeRef;
      return getNodeLon(otherB, b) - getNodeLon(otherA, a);
    });

    const startEdge = candidates[0];

    const visitedEdges = new Set<string>();
    let currentEdge = startEdge;
    let currentNode = startNode;

    const chain: any[] = [];

    while (currentEdge) {
      visitedEdges.add(currentEdge.id);
      const nextNode = currentEdge.fromNodeRef === currentNode ? currentEdge.toNodeRef : currentEdge.fromNodeRef;
      
      const fromLon = getNodeLon(currentEdge.fromNodeRef, currentEdge);
      const toLon = getNodeLon(currentEdge.toNodeRef, currentEdge);
      const isCoordWestToEast = toLon > fromLon;
      
      const traversal = currentEdge.fromNodeRef === currentNode ? "from -> to" : "to -> from";
      
      chain.push({
        edgeId: currentEdge.id,
        sourceFeatureRef: currentEdge.sourceSlice?.sourceFeatureRef,
        fromNode: currentEdge.fromNodeRef,
        toNode: currentEdge.toNodeRef,
        fromLon,
        toLon,
        isCoordWestToEast,
        traversal,
        lengthMeters: currentEdge.lengthMeters,
        directionRole: currentEdge.directionRole
      });

      currentNode = nextNode;
      
      const outEdges = topo.adjacency.outEdges[currentNode] ?? [];
      const inEdges = topo.adjacency.inEdges[currentNode] ?? [];
      const allConnected = Array.from(new Set([...outEdges, ...inEdges]));
      
      const nextCandidates = allConnected
        .map(id => lookup.edgesById[id])
        .filter(e => e && e.directionRole === "up" && !visitedEdges.has(e.id));
        
      if (nextCandidates.length === 0) {
        console.log(`\nStopped tracing at node ${currentNode}.`);
        console.log(`All connected edges at this node (total ${allConnected.length}):`);
        allConnected.forEach(id => {
          const e = lookup.edgesById[id];
          console.log(`  - Edge: ${id} (Ref: ${e?.sourceSlice?.sourceFeatureRef}), traversal: ${e?.traversal}, role: ${e?.directionRole}`);
        });
        break;
      }
      
      // Sort descending by longitude of the other end to keep moving eastwards
      nextCandidates.sort((a, b) => {
        const otherA = a.fromNodeRef === currentNode ? a.toNodeRef : a.fromNodeRef;
        const otherB = b.fromNodeRef === currentNode ? b.toNodeRef : b.fromNodeRef;
        return getNodeLon(otherB, b) - getNodeLon(otherA, a);
      });
      
      currentEdge = nextCandidates[0];
    }

    console.log(`\nContiguous UP Chain (Length: ${chain.length}):`);
    chain.forEach((item, index) => {
      console.log(`[${index}] Way: ${item.sourceFeatureRef} (${item.edgeId})`);
      console.log(`    Nodes: ${item.fromNode} -> ${item.toNode}`);
      console.log(`    Role: ${item.directionRole}`);
      console.log(`    Coords: Lon ${item.fromLon.toFixed(5)} -> ${item.toLon.toFixed(5)} (W->E: ${item.isCoordWestToEast})`);
      console.log(`    Traversal: ${item.traversal} (Length: ${item.lengthMeters.toFixed(1)}m)`);
    });
  });
});
