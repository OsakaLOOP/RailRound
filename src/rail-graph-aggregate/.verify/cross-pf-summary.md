# Goal02 PR2 · Cross-Pattern Pathfinding Verify Summary

- Test OD: `manual:node:140.882407,38.260333` → `manual:node:141.067899,38.378709`
- Transfer relations in graph: **6**
- Forward hops: **2** (transferStations: ["manual:node:141.062555,38.376911"])
- Reverse hops: **2**

## Checks
- ✅ transfer graph: 至少 1 条 transfer relation
- ✅ resolveCrossPattern 不抛
- ✅ crossPath 非 null
- ✅ crossPath.hops 至少 2 个 (确实换乘)
- ✅ transferStations[0] 'manual:node:141.062555,38.376911' 在 hops[0] 和 hops[1] 内
- ✅ totalEdgeCount ≤ aggregate.topo.edges.length
- ✅ 正反向 edgeCount 一致 (允许 ±10% 浮动)
- ✅ 正反向 hop 数一致
- ✅ [REGRESS] pattern[aggregate:pattern:tohoku-connector].edgeSequence ⊂ aggregate.topo
- ✅ [REGRESS] pattern[aggregate:pattern:senseki-east].edgeSequence ⊂ aggregate.topo
- ✅ [REGRESS] pattern[aggregate:pattern:senseki-tohoku-through].edgeSequence ⊂ aggregate.topo
- ✅ [REGRESS] pattern[aggregate:pattern:ServicePattern-4-mpp5jlxw].edgeSequence ⊂ aggregate.topo