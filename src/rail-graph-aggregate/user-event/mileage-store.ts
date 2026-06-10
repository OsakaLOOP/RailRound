import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";
import { validateUserEventV2 } from "../../rail-graph-v1/mileage-events";
import { readAggregateJson, writeAggregateJson } from "../storage";

export interface LoadMileageUserEventsArgs {
  aggregateKey: string;
  path?: string;
}

const FILE = "user-events-v2.json";

export async function loadMileageUserEvents(args: LoadMileageUserEventsArgs): Promise<UserEventV2[]> {
  const raw = await readAggregateJson<unknown>({
    aggregateKey: args.aggregateKey,
    file: FILE,
    path: args.path,
  });
  const events = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown[] }).events)
      ? (raw as { events: unknown[] }).events
      : [];
  return events.map(validateMileageUserEvent);
}

export async function saveMileageUserEvents(args: {
  aggregateKey: string;
  events: UserEventV2[];
  path?: string;
}): Promise<void> {
  await writeAggregateJson({
    aggregateKey: args.aggregateKey,
    file: FILE,
    path: args.path,
  }, args.events.map(validateMileageUserEvent));
}

export async function upsertMileageUserEvent(args: {
  aggregateKey: string;
  event: UserEventV2;
}): Promise<UserEventV2[]> {
  let existing: UserEventV2[] = [];
  try {
    existing = await loadMileageUserEvents({ aggregateKey: args.aggregateKey });
  } catch {
    existing = [];
  }
  const now = new Date().toISOString();
  const event = validateMileageUserEvent({
    ...args.event,
    updatedAt: now,
    createdAt: args.event.createdAt ?? now,
  });
  const idx = existing.findIndex((item) => item.id === event.id);
  const next = idx >= 0
    ? existing.map((item, index) => index === idx ? event : item)
    : [...existing, event];
  await saveMileageUserEvents({ aggregateKey: args.aggregateKey, events: next });
  return next;
}

export function validateMileageUserEvent(value: unknown): UserEventV2 {
  return validateUserEventV2(value);
}
