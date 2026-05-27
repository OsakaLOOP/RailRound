# Mileage-Centric UserEvent Layer

> Status: implementation goal for the UserEvent v2 layer and user-facing entry points.
> The invariant is strict: UserEvent identity and ordering are mileage-based only.

## Model

`UserEventV2` lives in `src/rail-graph-v1/mileage-event.types.ts`.

- `MileageRef`: stable event coordinate. It contains `systemRef`, optional `lineRef` / `patternRef` / `direction`, and `distanceMeters`.
- `MileageRange`: optional event range with `startMeters` and `endMeters`.
- `UserEventV2`: user-created event, always `schemaVersion: "mileage-user-event-v1"`.
- `BoundMileageEvent`: runtime projection result for one run/path. It may include nearby `stationRef`, `edgeRef`, coordinates, order index, and timestamp, but those are derived fields.

Hard invariants:

- `distanceMeters` is stored in meters and is the only primary event position.
- Station, edge, coordinate, and time values are query/project inputs, not event anchors.
- UserEvent changes are warm metadata. They do not change topology, pathfinding, graphId, or ServicePattern identity.
- Sorting is by projected run mileage, then order index, then event id.

## Public API

Core implementation is in `src/rail-graph-v1/mileage-events.ts`.

Primary functions:

- `buildMileageProjectionContext(args)`: builds an edge/station mileage index from topology, ServicePattern, or an explicit edge/station sequence.
- `projectEventToRunPath(event, runPath, context)`: projects one mileage event onto a selected run/path.
- `queryEventsByMileage(events, window)`: direct mileage window query.
- `queryEventsNearPlace(events, place, context, radiusMeters)`: projects station/edge/coordinate/place to mileage, then runs a mileage query.
- `queryEventsByTime(events, timeline, context, range)`: projects a time window to a mileage range, then runs a mileage query.
- `convertLegacyUserEvent(legacy, context)`: converts old station/edge aggregate events into `UserEventV2`.
- `validateUserEventV2(value)`: shared runtime validator for stores and adapters.

Failure semantics:

- Query functions return empty results plus diagnostics when projection is unavailable.
- Legacy conversion throws for one unprojectable event; aggregate compatibility catches that and reports diagnostics.
- Time projection uses `timeline` first. If no timeline exists, `linearTimeRange` may be used and results are marked with `timestampInference: "linear"`.

## RailGraph Integration

The public layer is wired into these types:

- `RailGraph.eventLayer.mileageUserEvents?: UserEventV2[]`
- `RunContext.mileageUserEvents?: readonly BoundMileageEvent[] | null`
- `TripResultSegment.mileageEvents?: BoundMileageEvent[]`
- `NormalizedEntityBatch.mileageUserEvents?: UserEventV2[]`
- `src/rail-graph-v1/types.ts` re-exports the mileage event types.

Bottom-layer developers should attach final data here instead of inventing a parallel user event container.

## Aggregate Compatibility

Aggregate compatibility lives in `src/rail-graph-aggregate/user-event/`.

- `mileage-adapter.ts`: builds aggregate mileage contexts and converts legacy station/edge events.
- `mileage-store.ts`: reads/writes `aggregates/{aggregateKey}/user-events-v2.json`.
- `mileage-integration.ts`: direct aggregate entry point. It loads V2 events if present, otherwise reads legacy `user-events.json` and projects them.
- `mileage-query.ts`: aggregate-ready query helpers for ServicePattern, CrossPattern, mileage, place, and time.

Current aggregate data may still use the no-direction substitute graph. That is acceptable for compatibility verification. Once annotated aggregate topology is ready, replace the context builder internals while keeping the same public APIs and V2 store.

## User-Facing UI

The user app exposes a mileage event panel on the map:

- Component: `src/components/map/MileageEventsPanel.tsx`
- App-side adapter: `src/utils/mileageUserEvents.ts`
- State: `src/store/index.ts` stores `mileageUserEvents`
- Sync: `src/hooks/useUserData.ts`, `src/services/api.js`, and `public/functions/api/user/data.js` persist `mileage_user_events`

The panel supports:

- line timeline view sorted by projected mileage;
- station/place query, projected to mileage before matching;
- time-window query, projected to mileage via the available linear time range;
- creating events from station or exact mileage. Saved events are always `UserEventV2`, never station-bound records.

All user-facing UI text is under `mileageEvents` in the four app locale files.

## Verification

Run:

```bash
npm run rail:events:mileage-verify
```

The script:

- loads aggregate data through `loadAggregateMileageUserEvents()`;
- accepts V2 data or legacy station/edge data projected through the compatibility layer;
- verifies single ServicePattern projection, CrossPattern projection, mileage query, place query, and time query;
- writes reports under `src/rail-graph-aggregate/.verify/`.

Expected banner:

```text
MILEAGE EVENTS VERIFY: PASS
```

## Final Bottom-Layer Catch-Up Contract

To replace the current substitute index with final data, implementers only need to provide a more accurate `MileageProjectionContext`:

- `edgeMileage`: every traversable edge has start/end mileage and geometry.
- `stationMileage`: every queryable station has a mileage point.
- `timeline`: optional real timetable projection points.
- `linearTimeRange`: optional fallback when real timetable is unavailable.

Do not change the saved event schema, query API, or user UI contract when swapping the index source.
