import type { EntityRef } from "../../rail-graph-v1/primitives";

export type UserEventAnchor =
  | { kind: "station"; stationRef: EntityRef }
  | { kind: "edge"; edgeRef: EntityRef; measure: number };

export interface UserEvent {
  id: EntityRef;
  kind: "user_defined";
  anchor: UserEventAnchor;
  title: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
