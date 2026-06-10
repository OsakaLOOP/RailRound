// ============================================================
// Mileage UserEvent Verify
//
// Verifies the public mileage event layer and the aggregate compatibility
// adapter against the current senseki-tohoku aggregate data.
// ============================================================

import fs from "node:fs";
import path from "node:path";

import { loadAggregate } from "../rail-graph-aggregate/aggregate-state";
import { loadServicePatterns, type StoredServicePattern } from "../rail-graph-aggregate/service-pattern/store";
import { buildTransferGraph } from "../rail-graph-aggregate/cross-pattern/transfer-graph";
import { resolveCrossPattern, type CrossPatternPath } from "../rail-graph-aggregate/cross-pattern/resolver";
import { loadAggregateMileageUserEvents } from "../rail-graph-aggregate/user-event/mileage-integration";
import {
  buildAggregateMileageContext,
  buildCrossPatternMileageContext,
} from "../rail-graph-aggregate/user-event/mileage-adapter";
import {
  eventsAlongCrossPatternPath,
  eventsAlongServicePattern,
  queryAggregateEventsByTime,
  queryAggregateEventsNearPlace,
} from "../rail-graph-aggregate/user-event/mileage-query";
import {
  queryEventsByMileage,
  resolvePlaceToMileage,
  type MileageQueryResult,
} from "../rail-graph-v1/mileage-events";
import {
  appStationRef,
  buildAppMileageLineContext,
  createMileageEventFromPlace,
  createMileageEventFromTripPosition,
  projectEventsToTrip,
  queryEventsByMileage as queryAppEventsByMileage,
  queryEventsByText,
  queryEventsByTime as queryAppEventsByTime,
  queryEventsByTrip,
  queryEventsNearPlace as queryAppEventsNearPlace,
} from "../utils/mileageUserEvents";
import type { AggregateState } from "../rail-graph-aggregate/aggregate-state";
import type { BoundMileageEvent, UserEventV2 } from "../rail-graph-v1/mileage-event.types";
import type { EntityRef } from "../rail-graph-v1/primitives";
import type { RailwayMap, Trip } from "../store";

const OUT_DIR = path.resolve("src", "rail-graph-aggregate", ".verify");
const PHASE = "mileage-events";
const AGGREGATE_KEY = process.env.AGGREGATE_KEY ?? "senseki-tohoku";
const PATTERNS_JSON_PATH = process.env.PATTERNS_JSON_PATH
  ?? path.resolve("aggregates", AGGREGATE_KEY, "service-patterns.json");
const EVENTS_V2_JSON_PATH = process.env.EVENTS_V2_JSON_PATH
  ?? path.resolve("aggregates", AGGREGATE_KEY, "user-events-v2.json");
const LEGACY_EVENTS_JSON_PATH = process.env.LEGACY_EVENTS_JSON_PATH
  ?? path.resolve("aggregates", AGGREGATE_KEY, "user-events.json");

interface Failure { check: string; detail: string; }

const failures: Failure[] = [];
const checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }> = [];

function assert(check: string, condition: boolean, detail: string): void {
  if (condition) checks.push({ check, status: "PASS" });
  else {
    checks.push({ check, status: "FAIL", detail });
    failures.push({ check, detail });
  }
}

function writeReport(name: string, data: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[verify-mileage-events] starting; aggregateKey=${AGGREGATE_KEY}`);

  const aggregate = await loadAggregate({
    aggregateKey: AGGREGATE_KEY,
    allowNoDirection: true,
    noDirectionReason: "verify",
  });
  const patterns = await loadServicePatterns({ aggregateKey: AGGREGATE_KEY, path: PATTERNS_JSON_PATH });
  const firstPattern = patterns[0];
  if (!firstPattern) {
    throw new Error("DATA NOT READY: service-patterns.json must contain at least one ServicePattern.");
  }

  const loaded = await loadAggregateMileageUserEvents({
    aggregate,
    pattern: firstPattern,
    v2Path: EVENTS_V2_JSON_PATH,
    legacyPath: LEGACY_EVENTS_JSON_PATH,
  });
  const events = loaded.events;
  if (events.length === 0) {
    throw new Error("DATA NOT READY: user-events-v2.json or legacy user-events.json must contain at least one event.");
  }

  writeReport(`${PHASE}-01-loaded.json`, {
    source: loaded.source,
    eventCount: events.length,
    diagnostics: loaded.diagnostics,
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title,
      distanceMeters: event.mileage.distanceMeters,
      range: event.range ?? null,
      systemRef: event.mileage.systemRef,
      lineRef: event.mileage.lineRef ?? null,
      patternRef: event.mileage.patternRef ?? null,
      legacyAnchor: event.payload?.legacyAnchor ?? null,
    })),
  });

  assert("aggregate compatibility entry returns events", events.length >= 1, `events=${events.length}`);
  assert(
    "events are mileage-only records",
    events.every((event) => event.schemaVersion === "mileage-user-event-v1" && Number.isFinite(event.mileage.distanceMeters)),
    "Every event must have schemaVersion=mileage-user-event-v1 and finite mileage.distanceMeters.",
  );
  assert(
    "legacy station/edge anchors are projected through aggregate entry",
    loaded.source === "legacy-projected" || loaded.source === "v2",
    `source=${loaded.source}`,
  );

  const single = eventsAlongServicePattern({ aggregate, pattern: firstPattern, events });
  writeReport(`${PHASE}-02-single-pattern.json`, summarizeBoundEvents(single));
  assert("single ServicePattern projection returns events", single.length >= 1, `events=${single.length}`);
  assert("single ServicePattern events sorted by run mileage", isSorted(single), eventOrder(single));

  const crossPath = pickCrossPath(aggregate, patterns);
  assert("cross-pattern path resolved", crossPath !== null, "Need at least two patterns with a shared transfer station.");
  const cross = crossPath ? eventsAlongCrossPatternPath({ aggregate, crossPath, events }) : [];
  writeReport(`${PHASE}-03-cross-pattern.json`, {
    crossPath: crossPath ? {
      hops: crossPath.hops.length,
      transferStations: crossPath.transferStations,
    } : null,
    events: summarizeBoundEvents(cross),
  });
  assert("cross-pattern projection keeps global mileage order", cross.length >= 1 && isSorted(cross), eventOrder(cross));

  const mileageQuery = queryEventsByMileage(events, {
    systemRef: loaded.context.systemRef,
    fromMeters: Math.max(0, Math.min(...events.map((event) => event.mileage.distanceMeters)) - 1),
    toMeters: Math.max(...events.map((event) => event.mileage.distanceMeters)) + 1,
  });
  assert(
    "queryEventsByMileage returns current events",
    mileageQuery.items.length === events.length,
    `expected=${events.length}, actual=${mileageQuery.items.length}`,
  );

  const placeQuery = runPlaceQuery(aggregate, firstPattern, events);
  writeReport(`${PHASE}-04-place-query.json`, {
    count: placeQuery.items.length,
    diagnostics: placeQuery.diagnostics,
    events: summarizeBoundEvents(placeQuery.items),
  });
  assert("place query projects place to mileage before matching", placeQuery.items.length >= 1, `events=${placeQuery.items.length}`);

  const timeQuery = queryAggregateEventsByTime({
    aggregate,
    pattern: firstPattern,
    events,
    fromTime: "2026-01-01T08:00:00.000Z",
    toTime: "2026-01-01T09:00:00.000Z",
  });
  writeReport(`${PHASE}-05-time-query.json`, {
    count: timeQuery.items.length,
    diagnostics: timeQuery.diagnostics,
    events: summarizeBoundEvents(timeQuery.items),
  });
  assert("time query projects time range to mileage range", timeQuery.items.length >= 1, `events=${timeQuery.items.length}`);
  assert(
    "time query exposes inference diagnostics or timestamps",
    timeQuery.items.every((event) => event.timestampInference === "linear" || event.timestampInference === "timeline" || event.timestampInference === "unknown"),
    "Every time query result must carry timestampInference.",
  );

  runAppWrapperChecks();

  writeReport(`${PHASE}-summary.md`, renderSummary({
    aggregate,
    patterns,
    events,
    source: loaded.source,
    checks,
    failures,
  }));

  const allPass = failures.length === 0;
  console.log("");
  console.log("====================================================");
  console.log(`MILEAGE EVENTS VERIFY: ${allPass ? "PASS" : "FAIL"}`);
  if (!allPass) {
    for (const failure of failures) {
      console.log(`  ✗ ${failure.check}`);
      console.log(`    ${failure.detail}`);
    }
  }
  console.log("====================================================");
  console.log(`Report dir: ${OUT_DIR}`);
  process.exit(allPass ? 0 : 1);
}

function pickCrossPath(aggregate: AggregateState, patterns: StoredServicePattern[]): CrossPatternPath | null {
  void aggregate;
  const graph = buildTransferGraph(patterns);
  for (const transfer of graph.transfers) {
    const left = patterns.find((pattern) => pattern.patternId === transfer.patternA);
    const right = patterns.find((pattern) => pattern.patternId === transfer.patternB);
    if (!left || !right) continue;
    const leftStations = left.traceSequence.map((entry) => entry.stationRef);
    const rightStations = right.traceSequence.map((entry) => entry.stationRef);
    const from = leftStations.find((stationRef) => !rightStations.includes(stationRef));
    const to = rightStations.find((stationRef) => !leftStations.includes(stationRef));
    if (!from || !to) continue;
    const resolved = resolveCrossPattern({ patterns, transferGraph: graph, from, to });
    if (resolved) return resolved;
  }
  return null;
}

function runAppWrapperChecks(): void {
  const lineKey = "app:test-line";
  const railwayData: RailwayMap = {
    [lineKey]: {
      meta: {
        company: "Test Railway",
        region: "test",
        type: "fixture",
        logo: null,
        icon: null,
        color: "#10b981",
      },
      stations: [
        { id: "a", name_ja: "Alpha", lat: 35.0, lng: 139.0, transfers: [], distToNext: 5 },
        { id: "b", name_ja: "Beta", lat: 35.0, lng: 139.05, transfers: [], distToNext: 5 },
        { id: "c", name_ja: "Gamma", lat: 35.0, lng: 139.1, transfers: [] },
      ],
    },
  };
  const lineContext = buildAppMileageLineContext(railwayData, lineKey);
  assert("app wrapper fixture builds line context", lineContext !== null, "Expected test line context.");
  if (!lineContext) return;

  const trip: Trip = {
    id: "trip-app-wrapper",
    date: "2026-01-01",
    segments: [
      { id: "seg-app-wrapper", lineKey, fromId: "a", toId: "c" },
    ],
  };
  const stationEvent = createMileageEventFromPlace({
    lineContext,
    place: { stationRef: appStationRef(lineKey, "b") },
    title: "Bridge view",
    kind: "scenic",
    tags: ["bridge"],
    tripId: trip.id,
  });
  const coordinateEvent = createMileageEventFromPlace({
    lineContext,
    place: { coordinates: [139.1, 35.0] },
    title: "Map point",
    tags: ["map"],
  });
  const tripEvent = createMileageEventFromTripPosition({
    railwayData,
    trip,
    ratio: 0.5,
    title: "Trip midpoint",
    tags: ["midpoint"],
  });
  const appEvents = [stationEvent, coordinateEvent, tripEvent].filter((event): event is UserEventV2 => event !== null);

  assert("app create wrappers produce mileage-only events", appEvents.length === 3, `events=${appEvents.length}`);
  assert(
    "app create wrappers do not persist station anchor as primary event state",
    appEvents.every((event) => event.schemaVersion === "mileage-user-event-v1" && Number.isFinite(event.mileage.distanceMeters)),
    "Expected created events to keep mileage.distanceMeters as the stable anchor.",
  );

  const mileageQuery = queryAppEventsByMileage({
    events: appEvents,
    lineContext,
    fromMeters: 0,
    toMeters: lineContext.totalMeters,
  });
  assert("app queryEventsByMileage wrapper returns line events", mileageQuery.items.length === appEvents.length, `events=${mileageQuery.items.length}`);

  const placeQuery = queryAppEventsNearPlace({
    events: appEvents,
    lineContext,
    place: { stationRef: appStationRef(lineKey, "b") },
    radiusMeters: 100,
  });
  assert("app queryEventsNearPlace wrapper resolves place before matching", placeQuery.items.length >= 1, `events=${placeQuery.items.length}`);

  const timeQuery = queryAppEventsByTime({
    events: appEvents,
    lineContext,
    fromTime: "08:00",
    toTime: "09:00",
  });
  assert("app queryEventsByTime wrapper uses linear fallback", timeQuery.items.length === appEvents.length, `events=${timeQuery.items.length}`);
  assert(
    "app queryEventsByTime wrapper exposes timestamp inference",
    timeQuery.items.every((event) => event.timestampInference === "linear" || event.timestampInference === "timeline" || event.timestampInference === "unknown"),
    "Every app time query result must carry timestampInference.",
  );

  const tripProjection = projectEventsToTrip(appEvents, railwayData, trip);
  const tripQuery = queryEventsByTrip(appEvents, railwayData, trip);
  assert("app projectEventsToTrip wrapper keeps trip mileage order", tripProjection.length >= 2 && isSorted(tripProjection), eventOrder(tripProjection));
  assert("app queryEventsByTrip aliases trip projection", tripQuery.length === tripProjection.length, `query=${tripQuery.length}, projection=${tripProjection.length}`);

  const textQuery = queryEventsByText(appEvents, railwayData, "bridge", { tags: ["bridge"] });
  assert("app queryEventsByText wrapper supports text and tag filters", textQuery.length === 1 && textQuery[0].id === stationEvent?.id, `events=${textQuery.map((event) => event.id).join(", ")}`);

  writeReport(`${PHASE}-06-app-wrappers.json`, {
    events: appEvents.map((event) => ({
      id: event.id,
      title: event.title,
      distanceMeters: event.mileage.distanceMeters,
      lineRef: event.mileage.lineRef,
      createdFrom: event.payload?.createdFrom,
      tags: event.tags ?? [],
    })),
    mileageQuery: mileageQuery.items.length,
    placeQuery: summarizeBoundEvents(placeQuery.items),
    timeQuery: summarizeBoundEvents(timeQuery.items),
    tripProjection: summarizeBoundEvents(tripProjection),
    textQuery: textQuery.map((event) => event.id),
  });
}

function runPlaceQuery(
  aggregate: AggregateState,
  pattern: StoredServicePattern,
  events: UserEventV2[],
): MileageQueryResult<BoundMileageEvent> {
  const context = buildAggregateMileageContext({ aggregate, pattern });
  const stationEvent = events.find((event) => event.payload?.legacyAnchor && (event.payload.legacyAnchor as { kind?: string }).kind === "station");
  const stationRef = stationEvent
    ? nearestStationRefForMileage(stationEvent.mileage.distanceMeters, context.stationMileage)
    : pattern.traceSequence[0]?.stationRef;
  if (stationRef) {
    const resolved = resolvePlaceToMileage({ stationRef }, context);
    assert("station place resolves to mileage", resolved !== null, `stationRef=${stationRef}`);
    return queryAggregateEventsNearPlace({
      aggregate,
      pattern,
      events,
      stationRef,
      radiusMeters: 1000,
    });
  }
  const edgeRef = pattern.edgeSequence[0];
  return queryAggregateEventsNearPlace({
    aggregate,
    pattern,
    events,
    edgeRef,
    radiusMeters: 1000,
  });
}

function nearestStationRefForMileage(distanceMeters: number, stations: Record<string, { stationRef: EntityRef; distanceMeters: number }>): EntityRef | undefined {
  let best: { stationRef: EntityRef; delta: number } | null = null;
  for (const station of Object.values(stations)) {
    const delta = Math.abs(station.distanceMeters - distanceMeters);
    if (!best || delta < best.delta) best = { stationRef: station.stationRef, delta };
  }
  return best?.stationRef;
}

function summarizeBoundEvents(events: BoundMileageEvent[]) {
  return events.map((event) => ({
    eventId: event.event.id,
    title: event.event.title,
    distanceMetersFromRunStart: Math.round(event.distanceMetersFromRunStart),
    sourceMileageMeters: Math.round(event.event.mileage.distanceMeters),
    stationRef: event.stationRef ?? null,
    edgeRef: event.edgeRef ?? null,
    timestamp: event.timestamp ?? null,
    timestampInference: event.timestampInference,
  }));
}

function isSorted(events: BoundMileageEvent[]): boolean {
  for (let i = 1; i < events.length; i += 1) {
    if (events[i].distanceMetersFromRunStart < events[i - 1].distanceMetersFromRunStart) return false;
  }
  return true;
}

function eventOrder(events: BoundMileageEvent[]): string {
  return events.map((event) => `${event.event.id}@${Math.round(event.distanceMetersFromRunStart)}`).join(", ");
}

function renderSummary(args: {
  aggregate: AggregateState;
  patterns: StoredServicePattern[];
  events: UserEventV2[];
  source: string;
  checks: Array<{ check: string; status: "PASS" | "FAIL"; detail?: string }>;
  failures: Failure[];
}): string {
  const lines: string[] = [];
  lines.push("# Mileage-Centric UserEvent Verify Summary");
  lines.push("");
  lines.push(`- aggregateKey: \`${args.aggregate.aggregateKey}\``);
  lines.push(`- source: \`${args.source}\``);
  lines.push(`- patterns: **${args.patterns.length}**`);
  lines.push(`- mileage events: **${args.events.length}**`);
  lines.push("");
  lines.push("## Checks");
  for (const check of args.checks) {
    lines.push(`- ${check.status === "PASS" ? "✅" : "❌"} ${check.check}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  if (args.failures.length > 0) {
    lines.push("");
    lines.push("## Failure Detail");
    for (const failure of args.failures) {
      lines.push(`### ${failure.check}`);
      lines.push("```");
      lines.push(failure.detail);
      lines.push("```");
    }
  }
  return lines.join("\n");
}

main().catch((error) => {
  console.error("verify-mileage-user-events crashed:", error);
  process.exit(1);
});
