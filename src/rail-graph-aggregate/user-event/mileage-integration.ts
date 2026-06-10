import type { AggregateState } from "../aggregate-state";
import type { MileageProjectionContext, UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import type { Diagnostic } from "../../rail-graph-v1/diagnostic-types";
import type { StoredServicePattern } from "../service-pattern/store";
import { loadUserEvents } from "./store";
import { buildAggregateMileageContext, convertLegacyUserEventsToMileage } from "./mileage-adapter";
import { loadMileageUserEvents } from "./mileage-store";

export interface LoadAggregateMileageUserEventsArgs {
  aggregate: AggregateState;
  pattern?: StoredServicePattern;
  v2Path?: string;
  legacyPath?: string;
}

export interface LoadAggregateMileageUserEventsResult {
  events: UserEventV2[];
  source: "v2" | "legacy-projected" | "empty";
  context: MileageProjectionContext;
  diagnostics: Diagnostic[];
}

export async function loadAggregateMileageUserEvents(
  args: LoadAggregateMileageUserEventsArgs,
): Promise<LoadAggregateMileageUserEventsResult> {
  const context = buildAggregateMileageContext({
    aggregate: args.aggregate,
    pattern: args.pattern,
  });

  try {
    const events = await loadMileageUserEvents({
      aggregateKey: args.aggregate.aggregateKey,
      path: args.v2Path,
    });
    return {
      events,
      source: events.length > 0 ? "v2" : "empty",
      context,
      diagnostics: [],
    };
  } catch {
    // V2 is intentionally optional during rollout. Fall back to old PR3
    // station/edge anchors and project them into the mileage layer.
  }

  try {
    const legacyEvents = await loadUserEvents({
      aggregateKey: args.aggregate.aggregateKey,
      path: args.legacyPath,
    });
    const converted = convertLegacyUserEventsToMileage(legacyEvents, context);
    return {
      events: converted.events,
      source: converted.events.length > 0 ? "legacy-projected" : "empty",
      context,
      diagnostics: converted.diagnostics,
    };
  } catch (error) {
    return {
      events: [],
      source: "empty",
      context,
      diagnostics: [{
        level: "warn",
        code: "AGGREGATE_MILEAGE_EVENTS_NOT_LOADED",
        stage: "aggregate-mileage-events",
        message: (error as Error).message,
      }],
    };
  }
}
