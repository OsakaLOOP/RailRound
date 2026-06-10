# Goal02 Aggregate / ServicePattern / UserEvent Audit

Date: 2026-05-27

## Scope Status

Goal02 PR1-PR3 code paths are implemented for the current available data:

- PR1: aggregate workspace shell, ServicePattern store, IntentionChain editor, adapter, render plan, JSON persistence, aggregate API endpoint, Vite entry.
- PR2: cross-pattern transfer graph, route resolver, route-query UI, cross-path render plan.
- PR3: legacy UserEvent schema/store, station and edge anchors, path aggregation, events-on-path UI.

Current real data status:

- Available data is cleaned fixture output, not human-annotated MVP topology.
- `mode: "no-direction-graph"` is therefore verify-only fallback data.
- Product/default `loadAggregate()` rejects persisted no-direction data unless the caller explicitly passes `allowNoDirection: true` with `noDirectionReason: "verify"`.
- `mode: "compiled-topology"` is the product path. ServicePattern resolving branches to `findPathsV2` for compiled topology through `service-pattern/adapter.ts`.
- A synthetic compiled-topology verify proves that adapter branch independently from no-direction fixture data while real annotated aggregate data is still pending.

## Verify Evidence

Latest commands run:

```text
npm run rail:aggregate:verify:patterns
AGGREGATE VERIFY (PR1 · patterns): PASS

npm run rail:aggregate:verify:compiled-topology
AGGREGATE VERIFY (compiled-topology): PASS

npm run rail:aggregate:verify:cross-pf
AGGREGATE VERIFY (PR2 · cross-pf): PASS

npm run rail:aggregate:verify:events
AGGREGATE VERIFY (PR3 · events): PASS
```

Additional boundary check:

```text
DEFAULT LOAD REJECTED NO-DIRECTION: PASS
```

Local aggregate TypeScript spot check:

```text
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --jsx react-jsx --strict --skipLibCheck --esModuleInterop --allowSyntheticDefaultImports --resolveJsonModule src/rail-graph-aggregate/app.ts src/rail-graph-aggregate/service-pattern/adapter.ts src/rail-graph-v1-mvp/verify-aggregate-compiled-topology.ts
```

## Completion Caveat

Do not mark the full Goal02 objective complete yet. The current implementation is intentionally staged:

- Verify can use no-direction fallback because annotated cross-workspace topology is not ready.
- Product UI/default load will not silently use fallback data.
- Final completion still requires the human-in-loop annotation pass to produce/import compiled aggregate topology and then re-run PR1-PR3 verification against that compiled aggregate data.

## Next Human-In-Loop Step

1. Finish annotation for member workspaces in the MVP app.
2. Export or import a compiled aggregate state with `mode: "compiled-topology"`.
3. Confirm ServicePattern IntentionChain resolving uses `findPathsV2` over the compiled aggregate topology.
4. Re-run:

```text
npm run rail:aggregate:verify:patterns
npm run rail:aggregate:verify:compiled-topology
npm run rail:aggregate:verify:cross-pf
npm run rail:aggregate:verify:events
```
