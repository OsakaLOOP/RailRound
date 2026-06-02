# Rail Graph Integration Verify Summary

- startedAt: `2026-06-02T05:32:07.195Z`
- updatedAt: `2026-06-02T05:32:23.957Z`
- status: **FAIL**
- failedAt: `TypeScript no-emit`

## Commands
- PASS `npm run rail:mvp:clean-verify:senseki` (1s)
- PASS `npm run rail:aggregate:verify:patterns` (1s)
- PASS `npm run rail:aggregate:verify:compiled-topology` (1s)
- PASS `npm run rail:aggregate:verify:cross-pf` (1s)
- PASS `npm run rail:aggregate:verify:events` (1s)
- PASS `npm run rail:events:mileage-verify` (1s)
- PASS `npm run rail:deployment:build -- --aggregate-key senseki-tohoku --output src/rail-graph-aggregate/.verify/deployed-system.verify.json --allow-no-direction-verify` (1s)
- PASS `npx vitest run src/__tests__/rail-graph-system-context.test.ts src/__tests__/rail-graph-service-template.test.ts src/__tests__/rail-graph-render-geometry.test.ts src/__tests__/rail-graph-runtime-events.test.ts src/__tests__/rail-graph-deployment.test.ts src/__tests__/rail-graph-deployment-export-script.test.ts src/__tests__/rail-graph-trip-planner.test.ts src/__tests__/rail-graph-app-route-planner.test.ts src/__tests__/rail-graph-saved-trip-roundtrip.test.ts src/__tests__/mileage-events-runtime-adapter.test.ts src/__tests__/trip-product-projection.test.ts src/__tests__/core/railwayRouting.test.ts` (4s)
- FAIL `npx tsc --noEmit -p tsconfig.json` (8s)
- PENDING `npm run build` (Root src/blog production build)

## Acceptance
- no-direction fallback remains verify-only.
- compiled topology enters SystemContext.
- confirmed ServicePattern resolves geometry, timeline, and events.
- deployed preset can be consumed by the trip planner.
- aggregate workspace can build a deployment bundle; no-direction output remains explicit verify-only.
- saved app trips preserve rail-graph TripResult product snapshots through API/load round-trip without default runtime artifacts.
- records/search/stats product projections can consume saved rail-graph TripResult snapshots even when legacy segments are stale.
- mileage UserEvent projects to rail-graph TripResult and legacy app-line data remains compatible.
