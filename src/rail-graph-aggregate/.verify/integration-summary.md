# Rail Graph Integration Verify Summary

- startedAt: `2026-06-04T04:46:57.997Z`
- updatedAt: `2026-06-04T04:48:22.639Z`
- status: **PASS**

## Commands
- PASS `npm run rail:mvp:clean-verify:senseki` (1s)
- PASS `npm run rail:aggregate:verify:patterns` (1s)
- PASS `npm run rail:aggregate:verify:compiled-topology` (1s)
- PASS `npm run rail:aggregate:verify:cross-pf` (1s)
- PASS `npm run rail:aggregate:verify:events` (1s)
- PASS `npm run rail:events:mileage-verify` (1s)
- PASS `npm run rail:deployment:build -- --aggregate-key senseki-tohoku --output src/rail-graph-aggregate/.verify/deployed-system.verify.json --allow-no-direction-verify` (2s)
- PASS `npm run rail:deployment:assert` (1s)
- PASS `npm run rail:exports:load-smoke` (1s)
- PASS `npx vitest run src/__tests__/rail-graph-system-context.test.ts src/__tests__/rail-graph-service-template.test.ts src/__tests__/rail-graph-render-geometry.test.ts src/__tests__/rail-graph-runtime-events.test.ts src/__tests__/rail-graph-deployment.test.ts src/__tests__/rail-graph-deployment-export-script.test.ts src/__tests__/rail-graph-trip-planner.test.ts src/__tests__/rail-graph-app-route-planner.test.ts src/__tests__/rail-graph-saved-trip-roundtrip.test.ts src/__tests__/rail-graph-export-load-smoke.test.ts src/__tests__/mileage-events-runtime-adapter.test.ts src/__tests__/trip-product-projection.test.ts src/__tests__/core/railwayRouting.test.ts` (11s)
- PASS `npx tsc --noEmit -p tsconfig.json` (13s)
- PASS `npm run build` (50s)

## Acceptance
- no-direction fallback remains verify-only.
- compiled topology enters SystemContext.
- confirmed ServicePattern resolves geometry, timeline, and events.
- deployed preset can be consumed by the trip planner.
- aggregate workspace can build a deployment bundle; no-direction output remains explicit verify-only.
- default deployment bundle is present, app-consumable, and not built from no-direction verify data.
- MVP snapshot export/import and aggregate deployment export are loadable by real loaders.
- default deployment bundle can drive app route planning against current GeoJSON railwayData with source=rail_graph.
- railGraphLoadState records loaded/fallback status without disabling legacy fallback.
- transfer scorer supports explicit penalty, forbidden relations, walk/wait costs, and product transfer event diagnostics.
- saved app trips preserve rail-graph TripResult product snapshots through API/load round-trip without default runtime artifacts.
- records/search/stats product projections can consume saved rail-graph TripResult snapshots even when legacy segments are stale.
- mileage UserEvent projects to rail-graph TripResult and directly loaded legacy GeoJSON app-line data remains compatible.
