// ============================================================
// Rail Graph v1 — Source Input / Normalized Batch
// ============================================================

import type { BaseTopologyLayer } from "./base-topology.types";
import type { Diagnostic, ProvenanceRecord } from "./diagnostic-types";
import type { PatchSet } from "./editing.types";
import type { EventAnchor } from "./event.types";
import type { UserEventV2 } from "./mileage-event.types";
import type { ServicePattern } from "./service-template.types";

export interface SourceEnvelope {
  sourceType: "geojson" | "orm_records" | "legacy_network_meta" | "manual_json";
  sourceRef: string;
  data: unknown;
}

export interface SourceBatchInput {
  schemaVersion: "rail-graph-v1";
  sources: SourceEnvelope[];
  manualPatches?: PatchSet[];
}

export interface NormalizedEntityBatch {
  schemaVersion: "rail-graph-v1";
  baseTopology: BaseTopologyLayer;
  servicePatterns: ServicePattern[];
  eventAnchors: EventAnchor[];
  mileageUserEvents?: UserEventV2[];
  provenance: ProvenanceRecord[];
  diagnostics: Diagnostic[];
}
