/**
 * @vitest-environment jsdom
 */
import { describe, it } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from '../rail-graph-v1-mvp/app';
import { SENSEKI_RAIL } from '../rail-graph-v1-mvp/senseki-data';
import { SENSEKI_PF_OVERRIDES } from '../rail-graph-v1-mvp/poc-senseki-pathfinding';
import { buildTopologyLookup, isDirectionRoleCompatible } from '../rail-graph-v1/topology';
import { calculateTurnAngle } from '../rail-graph-v1/geometry-math';

describe('Step 3: Trace DFS Step-by-Step', () => {
  it('should print detailed step-by-step trace of DFS for S3', () => {
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

    const edge1320 = topo.edges.find(e => e.sourceSlice?.sourceFeatureRef === "osm:way:1320551298")!;
    const dead1320 = topo.adjacency.outEdges[edge1320.fromNodeRef]?.length === 1 && topo.adjacency.inEdges[edge1320.fromNodeRef]?.length === 1 
      ? edge1320.fromNodeRef 
      : edge1320.toNodeRef;

    const startNode = dead1320;
    // target node is the fromNode of 775730626
    const edge7757_30626 = topo.edges.find(e => e.sourceSlice?.sourceFeatureRef === "osm:way:775730626")!;
    const targetNode = edge7757_30626.fromNodeRef;

    console.log(`DFS Simulation Start:`);
    console.log(`Start Node: ${startNode}`);
    console.log(`Target Node: ${targetNode}`);

    // Initial state
    const firstEdgeId = edge1320.id;
    const nextNode = edge1320.fromNodeRef === startNode ? edge1320.toNodeRef : edge1320.fromNodeRef;
    
    let state = {
      currentNode: nextNode,
      currentDirectionRole: "down",
      edgeSequence: [firstEdgeId],
      segmentVisitedEdges: new Set([firstEdgeId]),
      totalDistanceMeters: edge1320.lengthMeters
    };

    console.log(`\n--- State after 1st edge (${edge1320.sourceSlice?.sourceFeatureRef}) ---`);
    console.log(`currentNode: ${state.currentNode}`);
    console.log(`currentDirectionRole: ${state.currentDirectionRole}`);
    console.log(`edgeSequence:`, state.edgeSequence);

    // Let's trace next step outEdges
    const outEdges = topo.adjacency.outEdges[state.currentNode] ?? [];
    console.log(`Out edges from current node (${state.currentNode}):`, outEdges);

    outEdges.forEach(candidateEdgeId => {
      const edge = lookup.edgesById[candidateEdgeId];
      console.log(`\nEvaluating candidate edge: ${candidateEdgeId} (ref: ${edge?.sourceSlice?.sourceFeatureRef})`);
      if (!edge) {
        console.log(`  Filtered: Edge not found in lookup.`);
        return;
      }

      // Check 1: Physical anti-oscillation
      const lastEdgeId = state.edgeSequence[state.edgeSequence.length - 1];
      if (candidateEdgeId === lastEdgeId) {
        console.log(`  Filtered: candidateEdgeId === lastEdgeId (anti-oscillation)`);
        return;
      }

      // Check 2: Turn angle
      const edgeIn = lookup.edgesById[lastEdgeId];
      const edgeOut = edge;
      if (edgeIn?.coordinates && edgeOut?.coordinates) {
        const nodeCoord = edgeIn.fromNodeRef === state.currentNode ? edgeIn.coordinates[0] : edgeIn.coordinates[edgeIn.coordinates.length - 1];
        const angle = calculateTurnAngle(edgeIn.coordinates, edgeOut.coordinates, nodeCoord);
        console.log(`  Turn angle from ${edgeIn.sourceSlice?.sourceFeatureRef} to ${edgeOut.sourceSlice?.sourceFeatureRef}: ${angle}°`);
        if (angle >= 90) {
          console.log(`  Filtered: Angle ${angle}° >= 90° (blunt angle)`);
          return;
        }
      }

      // Check 3: Visited edges
      if (state.segmentVisitedEdges.has(candidateEdgeId)) {
        console.log(`  Filtered: Already visited in current segment.`);
        return;
      }

      // Check 4: Forward only traversal
      if (edge.traversal === "forward" && edge.fromNodeRef !== state.currentNode) {
        console.log(`  Filtered: Forward-only edge entered from wrong node.`);
        return;
      }

      // Check 5: Direction role compatibility
      const compat = isDirectionRoleCompatible(state.currentDirectionRole as any, edge.directionRole);
      console.log(`  Direction compatibility between train's ${state.currentDirectionRole} and edge's ${edge.directionRole}: ${compat}`);
      if (!compat) {
        console.log(`  Filtered: Direction role incompatible.`);
        return;
      }

      // Check 6: Geometric arrow consistency
      if (edge.traversal === "both" && (edge.directionRole === "up" || edge.directionRole === "down")) {
        const matchesDirection = state.currentDirectionRole === edge.directionRole;
        const enteringFromNode = state.currentNode === edge.fromNodeRef;
        console.log(`  Geometric arrow consistency: matchesDirection (${matchesDirection}) === enteringFromNode (${enteringFromNode})? ${matchesDirection === enteringFromNode}`);
        if (matchesDirection !== enteringFromNode) {
          console.log(`  Filtered: Geometric arrow consistency check failed.`);
          return;
        }
      }

      console.log(`  >> Candidate edge ${candidateEdgeId} PASSED all checks!`);

      // Let's simulate pushing this edge
      const nextNextNode = edge.fromNodeRef === state.currentNode ? edge.toNodeRef : edge.fromNodeRef;
      const nextDirectionRole = (edge.directionRole === "up" || edge.directionRole === "down") ? edge.directionRole : state.currentDirectionRole;
      
      const subState = {
        currentNode: nextNextNode,
        currentDirectionRole: nextDirectionRole,
        edgeSequence: [...state.edgeSequence, candidateEdgeId],
        segmentVisitedEdges: new Set([...state.segmentVisitedEdges, candidateEdgeId]),
        totalDistanceMeters: state.totalDistanceMeters + edge.lengthMeters
      };

      console.log(`  -- SubState after pushing:`);
      console.log(`     currentNode: ${subState.currentNode}`);
      console.log(`     currentDirectionRole: ${subState.currentDirectionRole}`);
      console.log(`     edgeSequence:`, subState.edgeSequence);

      // Now evaluate further from subState.currentNode
      const subOutEdges = topo.adjacency.outEdges[subState.currentNode] ?? [];
      console.log(`     Out edges from sub-currentNode (${subState.currentNode}):`, subOutEdges);
      
      subOutEdges.forEach(subCandId => {
        const subEdge = lookup.edgesById[subCandId];
        console.log(`     Evaluating sub-candidate: ${subCandId} (ref: ${subEdge?.sourceSlice?.sourceFeatureRef})`);
        
        if (subCandId === candidateEdgeId) {
          console.log(`       Filtered: subCandId === candidateEdgeId (anti-oscillation)`);
          return;
        }

        // Angle check
        if (edgeOut?.coordinates && subEdge?.coordinates) {
          const subNodeCoord = edgeOut.fromNodeRef === subState.currentNode ? edgeOut.coordinates[0] : edgeOut.coordinates[edgeOut.coordinates.length - 1];
          const subAngle = calculateTurnAngle(edgeOut.coordinates, subEdge.coordinates, subNodeCoord);
          console.log(`       Turn angle from ${edgeOut.sourceSlice?.sourceFeatureRef} to ${subEdge.sourceSlice?.sourceFeatureRef}: ${subAngle}°`);
          if (subAngle >= 90) {
            console.log(`       Filtered: Angle ${subAngle}° >= 90°`);
            return;
          }
        }

        if (subState.segmentVisitedEdges.has(subCandId)) {
          console.log(`       Filtered: Already visited.`);
          return;
        }

        const subCompat = isDirectionRoleCompatible(subState.currentDirectionRole as any, subEdge?.directionRole);
        console.log(`       Direction compatibility: ${subCompat}`);
        if (!subCompat) {
          console.log(`       Filtered: Direction role incompatible.`);
          return;
        }

        // Geometric arrow consistency
        if (subEdge?.traversal === "both" && (subEdge.directionRole === "up" || subEdge.directionRole === "down")) {
          const matchesDirection = subState.currentDirectionRole === subEdge.directionRole;
          const enteringFromNode = subState.currentNode === subEdge.fromNodeRef;
          console.log(`       Geometric arrow consistency: matchesDirection (${matchesDirection}) === enteringFromNode (${enteringFromNode})? ${matchesDirection === enteringFromNode}`);
          if (matchesDirection !== enteringFromNode) {
            console.log(`       Filtered: Geometric arrow consistency check failed.`);
            return;
          }
        }

        console.log(`       >> Sub-candidate edge ${subCandId} PASSED all checks!`);
        
        // Sim next node
        const subNextNode = subEdge!.fromNodeRef === subState.currentNode ? subEdge!.toNodeRef : subEdge!.fromNodeRef;
        const subNextDirectionRole = (subEdge!.directionRole === "up" || subEdge!.directionRole === "down") ? subEdge!.directionRole : subState.currentDirectionRole;
        const subSubState = {
          currentNode: subNextNode,
          currentDirectionRole: subNextDirectionRole,
          edgeSequence: [...subState.edgeSequence, subCandId],
          segmentVisitedEdges: new Set([...subState.segmentVisitedEdges, subCandId]),
          totalDistanceMeters: subState.totalDistanceMeters + subEdge!.lengthMeters
        };

        console.log(`       -- SubSubState:`);
        console.log(`          currentNode: ${subSubState.currentNode}`);
        console.log(`          currentDirectionRole: ${subSubState.currentDirectionRole}`);
        console.log(`          edgeSequence:`, subSubState.edgeSequence);

        // Now from subSubState.currentNode
        const subSubOut = topo.adjacency.outEdges[subSubState.currentNode] ?? [];
        console.log(`          Out edges from subSub-currentNode (${subSubState.currentNode}):`, subSubOut);

        subSubOut.forEach(subSubCandId => {
          const subSubEdge = lookup.edgesById[subSubCandId];
          console.log(`          Evaluating subSub-candidate: ${subSubCandId} (ref: ${subSubEdge?.sourceSlice?.sourceFeatureRef})`);
          
          if (subSubCandId === subCandId) {
            console.log(`            Filtered: subSubCandId === subCandId (anti-oscillation)`);
            return;
          }

          if (subEdge?.coordinates && subSubEdge?.coordinates) {
            const subSubNodeCoord = subEdge.fromNodeRef === subSubState.currentNode ? subEdge.coordinates[0] : subEdge.coordinates[edgeOut.coordinates.length - 1]; // wait, using index of coords
            const subSubAngle = calculateTurnAngle(subEdge.coordinates, subSubEdge.coordinates, subSubNodeCoord);
            console.log(`            Turn angle from ${subEdge.sourceSlice?.sourceFeatureRef} to ${subSubEdge.sourceSlice?.sourceFeatureRef}: ${subSubAngle}°`);
            if (subSubAngle >= 90) {
              console.log(`            Filtered: Angle ${subSubAngle}° >= 90°`);
              return;
            }
          }
          
          const subSubCompat = isDirectionRoleCompatible(subSubState.currentDirectionRole as any, subSubEdge?.directionRole);
          console.log(`            Direction compatibility: ${subSubCompat}`);
          if (!subSubCompat) {
            console.log(`            Filtered: Direction role incompatible.`);
            return;
          }

          if (subSubEdge?.traversal === "both" && (subSubEdge.directionRole === "up" || subSubEdge.directionRole === "down")) {
            const matchesDirection = subSubState.currentDirectionRole === subSubEdge.directionRole;
            const enteringFromNode = subSubState.currentNode === subSubEdge.fromNodeRef;
            console.log(`            Geometric arrow: ${matchesDirection === enteringFromNode}`);
            if (matchesDirection !== enteringFromNode) {
              console.log(`            Filtered: Geometric arrow consistency check failed.`);
              return;
            }
          }

          console.log(`            >> SubSub-candidate ${subSubCandId} PASSED all checks!`);
        });
      });
    });
  });
});
