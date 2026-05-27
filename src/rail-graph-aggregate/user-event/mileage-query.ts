import type { AggregateState } from "../aggregate-state";
import type { StoredServicePattern } from "../service-pattern/store";
import type { CrossPatternPath } from "../cross-pattern/types";
import type { BoundMileageEvent, UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import {
  compareBoundMileageEvents,
  projectEventToRunPath,
  queryEventsByMileage,
  queryEventsByTime,
  queryEventsNearPlace,
} from "../../rail-graph-v1/mileage-events";
import type { EntityRef, ISODateTime } from "../../rail-graph-v1/primitives";
import { aggregateSystemRef, buildAggregateMileageContext, buildCrossPatternMileageContext } from "./mileage-adapter";

export function eventsAlongServicePattern(args: {
  aggregate: AggregateState;
  pattern: StoredServicePattern;
  events: UserEventV2[];
}): BoundMileageEvent[] {
  const context = buildAggregateMileageContext({ aggregate: args.aggregate, pattern: args.pattern });
  const path = {
    systemRef: context.systemRef,
    lineRef: context.lineRef,
    patternRef: context.patternRef,
    edgeSequence: args.pattern.edgeSequence,
    stationSequence: args.pattern.traceSequence.map((entry) => entry.stationRef),
  };
  return args.events
    .map((event) => projectEventToRunPath(event, path, context))
    .filter((event): event is BoundMileageEvent => event !== null)
    .sort(compareBoundMileageEvents);
}

export function eventsAlongCrossPatternPath(args: {
  aggregate: AggregateState;
  crossPath: CrossPatternPath;
  events: UserEventV2[];
}): BoundMileageEvent[] {
  const context = buildCrossPatternMileageContext({ aggregate: args.aggregate, crossPath: args.crossPath });
  const edgeSequence: EntityRef[] = [];
  const stationSequence: EntityRef[] = [];
  for (const hop of args.crossPath.hops) {
    edgeSequence.push(...hop.edgeSequence);
    for (const stationRef of hop.stationSequence) {
      if (stationSequence[stationSequence.length - 1] !== stationRef) stationSequence.push(stationRef);
    }
  }
  return args.events
    .map((event) => projectEventToRunPath(event, {
      systemRef: context.systemRef,
      edgeSequence,
      stationSequence,
    }, context))
    .filter((event): event is BoundMileageEvent => event !== null)
    .sort(compareBoundMileageEvents);
}

export function queryAggregateEventsByMileage(args: {
  aggregate: AggregateState;
  events: UserEventV2[];
  fromMeters: number;
  toMeters: number;
}) {
  return queryEventsByMileage(args.events, {
    systemRef: aggregateSystemRef(args.aggregate.aggregateKey),
    fromMeters: args.fromMeters,
    toMeters: args.toMeters,
  });
}

export function queryAggregateEventsNearPlace(args: {
  aggregate: AggregateState;
  pattern?: StoredServicePattern;
  events: UserEventV2[];
  stationRef?: EntityRef;
  edgeRef?: EntityRef;
  coordinates?: [number, number];
  radiusMeters: number;
}) {
  const context = buildAggregateMileageContext({ aggregate: args.aggregate, pattern: args.pattern });
  return queryEventsNearPlace(args.events, {
    stationRef: args.stationRef,
    edgeRef: args.edgeRef,
    coordinates: args.coordinates,
  }, context, args.radiusMeters);
}

export function queryAggregateEventsByTime(args: {
  aggregate: AggregateState;
  pattern?: StoredServicePattern;
  events: UserEventV2[];
  fromTime: ISODateTime;
  toTime: ISODateTime;
}) {
  const context = buildAggregateMileageContext({ aggregate: args.aggregate, pattern: args.pattern });
  return queryEventsByTime(args.events, context.timeline, context, {
    fromTime: args.fromTime,
    toTime: args.toTime,
  });
}
