# Rail Graph v1 MVP Design

## Goal

This MVP validates the admin-facing base-topology workflow defined by
`docs/rail-graph-v1-plan/10-拓扑分层与启发式边界补丁.md`.

Scope is intentionally narrow:

- import unannotated GeoJSON;
- run the local admin preparation pipeline from the Vite dev workspace;
- review cleaning batches and merged override artifacts produced by external GIS scripts;
- manually annotate features into `railGraph.kind`;
- compile annotated geometry into fixed `BaseTopologyLayer`;
- validate topology/pathfinding against the current Senseki scenarios;
- export annotated GeoJSON, topo JSON, diagnostics, artifacts, and workflow snapshots.

The MVP does not build service templates, runtime paths, events, timelines, or
user-facing trip output. Its local pipeline is an admin/dev workflow used to
prepare, clean, load, compile, validate, and export source data before the final
Rail Graph runtime pipeline exists.

## Entry

- Local entry: `rail-graph-mvp.html`
- Logic: `src/rail-graph-v1-mvp/app.ts`
- Workspace and pipeline model/client: `src/rail-graph-v1-mvp/pipeline.ts`
- Vite local task API: `scripts/rail-graph-mvp-server.js`, mounted from
  `vite.config.js`

The entry is separate from the existing RailRound application. It does not use
the app store, main routes, or i18next resources. If this tool later becomes an
in-app admin route, UI text must be moved to the normal localization files.

The current workspace exposes this admin workflow:

1. `prepare` - run OSM extraction, post-fix, company/line matching, and manifest
   refresh through local Python scripts.
2. `clean` - plan review batches and merge keep/remove decisions into override
   artifacts.
3. `annotate` - load a selected artifact or bundled Senseki demo source and edit
   annotations in the MVP inspector/map.
4. `compile` - build `BaseTopologyLayer` and diagnostics from the current source.
5. `validate` - run Senseki pathfinding scenarios and inspect map/list output.
6. `export` - export snapshots, topology, annotated GeoJSON, and local artifacts.

The Vite-only API exposes:

- `POST /api/rail-graph-mvp/tasks`
- `GET /api/rail-graph-mvp/tasks/:taskId`
- `POST /api/rail-graph-mvp/tasks/:taskId/cancel`
- `POST /api/rail-graph-mvp/artifacts`
- `POST /api/rail-graph-mvp/artifact/read`

These endpoints are local development glue only. They shell out to the configured
`D:\GIS\scripts` project paths and are not part of a production API contract.

## Annotation Model

Raw GeoJSON features may start without `properties.railGraph`.

The editor records annotations in memory and exports them back into:

```json
{
  "properties": {
    "railGraph": {
      "kind": "track_geometry",
      "schemaVersion": "rail-graph-v1",
      "id": "manual:feature:...",
      "source": "manual"
    }
  }
}
```

Supported MVP kinds:

- `track_geometry`
- `station_point`
- `platform_area`
- `switch_point`
- `special_section`
- `unknown`

Only `track_geometry`, `station_point`, and `platform_area` participate in the
minimum topology compile path.

## Topology Compile

The compiler builds only fixed base topology:

- `TopologyEdge` from annotated `LineString` and each part of `MultiLineString`;
- endpoint `TopologyNode` records from edge endpoints;
- `GraphAdjacency` from exact or tolerance-merged endpoints;
- `Station` from annotated station point features;
- `Platform` from annotated platform features;
- `PlatformTrackBinding` from manual user selections;
- `StoppingPoint` from manual confirmed stopping-point selections.

Geometry is kept in the annotated GeoJSON export. The MVP topo export references
geometry through stable IDs but does not attempt to produce a full `RailGraph`.

## Stopping Points

Stopping points are fixed topo facts, not heuristic output.

In this MVP they are always created manually:

1. select a station;
2. select a platform;
3. select an edge;
4. choose direction;
5. provide a measure from `0` to `1`;
6. confirm.

Only confirmed stopping points are exported in `BaseTopologyLayer.stoppingPoints`.

## Invariants

### `PlatformTrackBinding.side` reference frame

The `side` field uses the edge's geometric direction as the only reference frame:

> Looking along `edge.fromNodeRef → edge.toNodeRef`,
> `left` = platform on the left of travel direction,
> `right` = platform on the right.

Consequences:

- `side` is **independent** of `servingDirection` (`up`/`down`).
- `side` is **independent** of editor / annotation order.
- When edge geometry is rebuilt with `fromNodeRef` and `toNodeRef` swapped,
  every binding referencing that edge must flip `left ↔ right`.
  `servingDirection` is *not* flipped by this operation.
- Island platforms (`Platform.type = "island"`) are modeled as a single
  `Platform` plus two bindings — one `side: "left"`, one `side: "right"` —
  each pointing at one of the two adjacent edges. There is no separate
  `PlatformFace` entity in the MVP.

### Track functional role is declared, not inferred

`TopologyEdge.functionalUse` and `TopologyEdge.directionRole` must be set
from annotation. The compiler must not infer `passing` / `siding` /
`through` from edge position, binding state, or graph topology — an edge
without bindings is **not** automatically a passing track. Missing
declarations produce `warn` diagnostics, never silent defaults.

## Diagnostics

Diagnostics are open strings with levels `info`, `warn`, `error`, and `fatal`.

The MVP emits diagnostics for:

- empty or invalid GeoJSON;
- unsupported geometry for a selected kind;
- unannotated or unknown features;
- missing station/platform/edge references in bindings or stopping points;
- topology with no track edges.

## Verification

No unit tests are required for the current docs-only synchronization.

Integration coverage should exercise the whole local workflow:

1. choose the Senseki workspace preset;
2. refresh or run local preparation artifacts;
3. plan/merge cleaning batches when external decision files exist;
4. load a selected GeoJSON/JSON artifact or the bundled Senseki source;
5. compile topology and inspect diagnostics;
6. run Senseki validation/pathfinding;
7. export a workflow snapshot and confirm the exported topology still includes
   edges, nodes, bindings, stopping points, and diagnostics.
