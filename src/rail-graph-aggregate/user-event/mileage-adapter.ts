import type { AggregateState } from "../aggregate-state";
import type { StoredServicePattern } from "../service-pattern/store";
import type { CrossPatternPath } from "../cross-pattern/types";
import type { Diagnostic } from "../../rail-graph-v1/diagnostic-types";
import type { MileageProjectionContext, UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import { buildMileageProjectionContext, convertLegacyUserEvent } from "../../rail-graph-v1/mileage-events";
import type { EntityRef } from "../../rail-graph-v1/primitives";
import type { UserEvent } from "./types";

export interface LegacyConversionResult {
  events: UserEventV2[];
  diagnostics: Diagnostic[];
}

export function aggregateSystemRef(aggregateKey: string): EntityRef {
  return `aggregate:${aggregateKey}` as EntityRef;
}

export function buildAggregateMileageContext(args: {
  aggregate: AggregateState;
  pattern?: StoredServicePattern;
  edgeSequence?: EntityRef[];
  stationSequence?: EntityRef[];
}): MileageProjectionContext {
  const context = buildMileageProjectionContext({
    systemRef: aggregateSystemRef(args.aggregate.aggregateKey),
    lineRef: args.pattern?.lineRef,
    pattern: args.pattern,
    topo: args.aggregate.topo,
    edgeSequence: args.edgeSequence,
    stationSequence: args.stationSequence,
  });
  return {
    ...context,
    linearTimeRange: defaultLinearTimeRange(context),
  };
}

export function buildCrossPatternMileageContext(args: {
  aggregate: AggregateState;
  crossPath: CrossPatternPath;
}): MileageProjectionContext {
  const edgeSequence: EntityRef[] = [];
  const stationSequence: EntityRef[] = [];
  for (const hop of args.crossPath.hops) {
    edgeSequence.push(...hop.edgeSequence);
    for (const stationRef of hop.stationSequence) {
      if (stationSequence[stationSequence.length - 1] !== stationRef) {
        stationSequence.push(stationRef);
      }
    }
  }
  const context = buildAggregateMileageContext({
    aggregate: args.aggregate,
    edgeSequence,
    stationSequence,
  });
  return {
    ...context,
    patternRef: undefined,
  };
}

export function convertLegacyUserEventsToMileage(
  legacyEvents: UserEvent[],
  context: MileageProjectionContext,
): LegacyConversionResult {
  const events: UserEventV2[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const legacy of legacyEvents) {
    try {
      events.push(convertLegacyUserEvent(legacy, context));
    } catch (error) {
      diagnostics.push({
        level: "warn",
        code: "AGGREGATE_LEGACY_EVENT_NOT_PROJECTED",
        stage: "aggregate-mileage-events",
        message: (error as Error).message,
        context: {
          eventId: legacy.id,
          anchor: legacy.anchor,
        },
      });
    }
  }
  return { events, diagnostics };
}

function defaultLinearTimeRange(context: MileageProjectionContext): MileageProjectionContext["linearTimeRange"] {
  const spans = Object.values(context.edgeMileage);
  const endMeters = spans.reduce((max, span) => Math.max(max, span.endMeters), 0);
  return {
    startTime: "2026-01-01T08:00:00.000Z",
    endTime: "2026-01-01T09:00:00.000Z",
    startMeters: 0,
    endMeters: Math.max(1, endMeters),
  };
}
