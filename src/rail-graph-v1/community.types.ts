// ============================================================
// Rail Graph v1 — Community Contributions
// ============================================================

import type { EntityRef, ISODateTime } from "./primitives";

export interface EntityAnnotation {
  annotationId: string;
  targetRef: EntityRef;
  targetType: "service_pattern" | "station" | "edge" | "platform" | "stopping_point";
  field: string;
  value: string | number | boolean;
  confidence: "confirmed" | "reported" | "disputed";
  submittedBy?: string;
  submittedAt: ISODateTime;
  evidence?: string;
}

export interface ContributionStore {
  annotations: EntityAnnotation[];
  moderationQueue: string[];
}
