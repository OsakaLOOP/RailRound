import type { EntityRef } from "../../rail-graph-v1/primitives";
import { readAggregateJson, writeAggregateJson } from "../storage";
import type { UserEvent } from "./types";

export type { UserEvent } from "./types";

export interface LoadUserEventsArgs {
  aggregateKey: string;
  path?: string;
}

export async function loadUserEvents(args: LoadUserEventsArgs): Promise<UserEvent[]> {
  const raw = await readAggregateJson<unknown>({
    aggregateKey: args.aggregateKey,
    file: "user-events.json",
    path: args.path,
  });
  const events = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown[] }).events)
      ? (raw as { events: unknown[] }).events
      : [];
  return events.map(validateUserEvent);
}

export async function saveUserEvents(args: {
  aggregateKey: string;
  events: UserEvent[];
  path?: string;
}): Promise<void> {
  await writeAggregateJson({
    aggregateKey: args.aggregateKey,
    file: "user-events.json",
    path: args.path,
  }, args.events.map(validateUserEvent));
}

export async function upsertUserEvent(args: {
  aggregateKey: string;
  event: UserEvent;
}): Promise<UserEvent[]> {
  let existing: UserEvent[] = [];
  try {
    existing = await loadUserEvents({ aggregateKey: args.aggregateKey });
  } catch {
    existing = [];
  }
  const now = new Date().toISOString();
  const event = validateUserEvent({
    ...args.event,
    createdAt: args.event.createdAt ?? now,
    updatedAt: now,
  });
  const idx = existing.findIndex((item) => item.id === event.id);
  const next = idx >= 0
    ? existing.map((item, index) => index === idx ? event : item)
    : [...existing, event];
  await saveUserEvents({ aggregateKey: args.aggregateKey, events: next });
  return next;
}

export async function deleteUserEvent(args: {
  aggregateKey: string;
  eventId: EntityRef;
}): Promise<UserEvent[]> {
  const existing = await loadUserEvents({ aggregateKey: args.aggregateKey });
  const next = existing.filter((event) => event.id !== args.eventId);
  await saveUserEvents({ aggregateKey: args.aggregateKey, events: next });
  return next;
}

function validateUserEvent(value: unknown): UserEvent {
  if (!value || typeof value !== "object") throw new Error("UserEvent must be an object.");
  const event = value as UserEvent;
  if (!event.id) throw new Error("UserEvent.id is required.");
  if (event.kind !== "user_defined") throw new Error(`UserEvent[${event.id}].kind must be user_defined.`);
  if (!event.title) throw new Error(`UserEvent[${event.id}].title is required.`);
  if (!event.anchor || typeof event.anchor !== "object") throw new Error(`UserEvent[${event.id}].anchor is required.`);
  if (event.anchor.kind === "station" && !event.anchor.stationRef) throw new Error(`UserEvent[${event.id}] stationRef is required.`);
  if (event.anchor.kind === "edge" && !event.anchor.edgeRef) throw new Error(`UserEvent[${event.id}] edgeRef is required.`);
  return event;
}
