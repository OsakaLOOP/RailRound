// Test DFS logic
const visitedEdges = new Set();
const edgeSequence = [];

function dfs(currentNode, depth) {
  if (depth > 5) return;
  
  const outEdges = ['edge_A'];
  
  for (const candidateEdgeId of outEdges) {
    if (visitedEdges.has(candidateEdgeId)) {
      console.log(`Blocked at depth ${depth}`);
      continue;
    }
    
    edgeSequence.push(candidateEdgeId);
    visitedEdges.add(candidateEdgeId);
    
    console.log(`Pushed at depth ${depth}`);
    dfs(candidateEdgeId, depth + 1);
    
    edgeSequence.pop();
    visitedEdges.delete(candidateEdgeId);
  }
}

dfs('start', 1);
