# Rail Graph Aggregate Notes

## 2026-05-27 · Goal02 Substitute Graph Boundary

- Current `aggregate-*.cleaned.geojson` fixtures are clean OSM/KSJ snapshots, not user-in-loop annotated MVP topology snapshots.
- Aggregate PR work therefore uses a clearly named `no-direction-graph` substitute for automated verification:
  - rail `LineString` / `MultiLineString` features are deduplicated by `osm_type:osm_id:class_main`;
  - topology nodes are shared by rounded endpoint coordinates;
  - edges are bidirectional and preserve source geometry/tags;
  - IntentionChain origin/terminus anchors target topology nodes, and `via_edge` anchors target rail edges.
- This is not a replacement for final annotated `compileTopology()` data. The UI and storage are structured so an annotated aggregate topology can replace the substitute graph once the user-in-loop annotate pass exists.
- `loadAggregate()` keeps the product/default behavior strict: a persisted `mode: "no-direction-graph"` aggregate is rejected unless the caller explicitly passes `allowNoDirection: true` with `noDirectionReason: "verify"`.
- Verify and seed-data preparation scripts are the only current callers allowed to pass that flag. The browser UI no longer imports fixture fallback data implicitly.
- ServicePattern resolving now branches by aggregate mode:
  - `mode: "compiled-topology"` uses `findPathsV2` through `service-pattern/adapter.ts`;
  - `mode: "no-direction-graph"` keeps the fixture substitute resolver for verify-only data.
