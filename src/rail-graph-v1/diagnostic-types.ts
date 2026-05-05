// ============================================================
// Rail Graph v1 — Diagnostics & Provenance Types
// ============================================================

import type { EntityRef, ISODateTime } from "./primitives";

export type DiagnosticLevel = "info" | "warn" | "error" | "fatal";

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  stage: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ProvenanceRecord {
  entityRef: EntityRef;
  sourceRef: string;
  sourceType: "orm" | "openrailwaymap" | "legacy_geojson" | "manual" | string;
  importedAt: ISODateTime;
  confidence: "observed" | "derived" | "manual" | "synthetic";
}
