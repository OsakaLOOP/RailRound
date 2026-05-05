// ============================================================
// Rail Graph v1 — Debug Snapshots
// ============================================================

import type { ISODateTime } from "./primitives";

export interface SystemSnapshot {
  graphId: string;
  exportedAt: ISODateTime;
  topoDigest: string;
  nodeCount: number;
  edgeCount: number;
  stationCount: number;
  platformCount: number;
  stoppingPointCount: number;
  patternCount: number;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly graphId: string;
  readonly stageHashes: {
    readonly path: string | null;
    readonly resolvedPath: string | null;
    readonly renderPlan: string | null;
    readonly order: string | null;
    readonly timeline: string | null;
    readonly events: string | null;
  };
  readonly exportedAt: ISODateTime;
}
