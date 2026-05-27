# Goal02 PR1 · Aggregate Patterns Verify Summary

- aggregateKey: `senseki-tohoku`
- members: `["senseki","tohoku-main"]`
- topo: {"nodes":348,"edges":357,"stations":348,"platforms":0}
- patterns loaded: **3**
- render plans built: **3**
- chain round-trip: 3/3

## Checks
- ✅ aggregate.topo.edges 非空
- ✅ aggregate 至少跨 2 个 workspace
- ✅ merged edges ≥ 80% of sum (allow dedup)
- ✅ patterns 数量 ≥ 1
- ✅ pattern[aggregate:pattern:tohoku-connector].edgeSequence 全部在 aggregate.topo
- ✅ pattern[aggregate:pattern:senseki-east].edgeSequence 全部在 aggregate.topo
- ✅ pattern[aggregate:pattern:senseki-tohoku-through].edgeSequence 全部在 aggregate.topo
- ✅ render-plan: 每个 pattern 至少 1 个 polylineSegment
- ✅ render-plan: 每个 pattern 有非空 displayColor
- ✅ ≥ 1 个 pattern 完成 chain round-trip