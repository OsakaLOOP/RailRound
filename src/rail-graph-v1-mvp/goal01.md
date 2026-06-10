# Goal 01: Senseki Clean Rule Verification

## Fixed Acceptance Target

Implement and refine autonomous heuristic clean rules for `src/rail-graph-v1-mvp` until the fixed verification command passes:

```powershell
npm run rail:mvp:clean-verify:senseki
```

The reference is fixed and must not be guessed:

```text
D:\Downloads\senseki-demo-2026-05-20T00-15-43.railround.json
```

The reference object set is exactly:

```text
snapshot.source.features
```

Do not use `snapshot.overrides` as the clean reference. `overrides` are annotation edits only; the acceptance comparison is against the exported source object set.

## Completion Definition

The goal is complete only when the verifier prints:

```text
SENSEKI CLEAN VERIFY: PASS
```

PASS requires all of the following:

- `diff_after_exceptions < 5`
- `false_delete == 0`
- `rule_gap == 0`
- `rule_conflicts == 0`
- every non-exception diff is classified as `manual_required`
- any `manual_required` object has a concrete reason showing that tags and geometry cannot provide a high-confidence automatic decision

Known exceptions are allowed only for Ishinomaki-area platforms and the manually accepted hard-to-semanticize branch or siding objects described in the user requirement.

## Reports To Read In Order

The verifier writes compact batch reports under:

```text
src\rail-graph-v1-mvp\.verify
```

Read them in this order:

```text
senseki-00-input-summary.json
senseki-01-reference-shape.json
senseki-02-rule-hits.json
senseki-03-rule-conflicts.json
senseki-04-final-residual.json
senseki-05-reference-match.json
senseki-06-diff-classification.json
senseki-clean-diff.md
```

Use the reports as the primary context. Do not repeatedly load the full Senseki data or full exported snapshot unless a specific diff requires inspection.

## Rule Design Constraints

Clean rules must be deterministic, explainable, and based on high-confidence OSM tags or simple geography:

- OSM tags: `railway`, `public_transport`, `station`, `stop_position`, `platform`, `service`, `usage`, `operator`, `name`, `ref`, `route`, `abandoned`, `disused`, `construction`, `layer`, `tunnel`, `bridge`
- geography: target-line corridor, main-line topology connectivity, station-area relation, isolated short components, branch or siding relation, nearby track/platform direction and distance

Rules must be mutually non-interfering. If the verifier reports a feature removed by more than one rule, treat it as a rule design bug.

Do not create a rule whose reason is effectively:

- "to match the reference"
- "looks wrong"
- "probably noise"
- "the model thinks so"

Each automatic removal needs a stable rule id, a narrow category, and an inspectable reason.

## Current Fixed Reference Counts

The fixed snapshot currently has:

```text
snapshot.source.features: 479
snapshot.overrides: 247
```

The 479 source features include line/platform/point/switch/entrance/crossing-style objects. This is the clean comparison target.

The 247 overrides are annotation edits:

```text
track_geometry: 211
platform_area: 36
```

These counts are diagnostic context only; they do not replace the fixed reference target.
