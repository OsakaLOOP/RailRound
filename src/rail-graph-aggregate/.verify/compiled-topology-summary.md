# Goal02 Aggregate Compiled-Topology Verify Summary

- aggregateKey: `synthetic-compiled-topology`
- mode: `compiled-topology`
- stub findPaths calls: **1**
- real findPathsV2 candidates: **1**

## Checks
- PASS adaptChainToPattern with stub findPaths does not throw
- PASS compiled-topology branch calls provided findPaths
- PASS provided findPaths receives compiled aggregate topology
- PASS stub pattern preserves compiled-topology metadata
- PASS stub pattern edgeSequence uses stub candidate
- PASS real findPathsV2 candidates do not throw
- PASS real findPathsV2 returns at least one candidate
- PASS real findPathsV2 candidate edgeSequence matches synthetic route
- PASS real findPathsV2 candidate nodeSequence matches synthetic route
- PASS adaptChainToPattern with real findPathsV2 does not throw
- PASS real pattern has path segments for every edge
- PASS real pattern trace sequence includes route nodes