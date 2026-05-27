# Goal02 PR3 · UserEvent L4 Aggregation Verify Summary

- Total user events loaded: **3**
- Events aggregated on first pattern: **3**
- Events aggregated on cross-pattern path: **3**

## Checks
- ✅ 至少 1 个 event anchor=station
- ✅ 至少 1 个 event anchor=edge
- ✅ aggregateEventsAlongPath 不抛 (single)
- ✅ single pattern: orderIndex 单调非降
- ✅ single pattern: 无幽灵 event (anchor 全部命中)
- ✅ cross path: orderIndex 单调非降
- ✅ cross path: 无幽灵 event
- ✅ 至少 1 个 event 横跨 ≥ 2 个 hop
- ✅ [REGRESS PR1] pattern[aggregate:pattern:tohoku-connector].edgeSequence ⊂ aggregate
- ✅ [REGRESS PR1] pattern[aggregate:pattern:senseki-east].edgeSequence ⊂ aggregate
- ✅ [REGRESS PR1] pattern[aggregate:pattern:senseki-tohoku-through].edgeSequence ⊂ aggregate
- ✅ [REGRESS PR2] crossPath 非空