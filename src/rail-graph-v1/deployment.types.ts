// ============================================================
// Rail Graph v1 — Deployment, Presets & Saved Trips
// ============================================================

import type { ContributionStore } from "./community.types";
import type { BaseTopologyRelation } from "./base-topology.types";
import type { EventPolicyRef } from "./event.types";
import type { DirectionLabel, EntityRef, ISODateTime } from "./primitives";
import type { ResolvedGeoJsonPath, RunSpec } from "./runtime.types";
import type { ServiceType } from "./service-template.types";
import type { RouteFingerprint, StationMeta, TripResult, TripRuntimeArtifacts } from "./user-facing.types";

export interface SavedTrip {
  savedId: string;
  userId: string;
  name?: string;
  tripResult: TripResult;
  runtimeArtifacts?: TripRuntimeArtifacts;
  routeFingerprint: RouteFingerprint;
  createdAt: ISODateTime;
  tripDate?: string;
  systemId: string;
  folderRef?: string;
  tags: string[];
  isPublic: boolean;
}

/**
 * 发布到服务器/终端用户流程的 service 模板。
 * 它携带已拼接 GeoJSON 与上抛语义，不携带底层 topo 编辑空间。
 */
export interface PublishedServiceTemplate {
  templateId: EntityRef;
  sourceGraphId: string;
  patternRef: EntityRef;
  lineRef: EntityRef;
  systemRef: EntityRef;
  companyRef?: EntityRef;
  serviceType: ServiceType;
  direction: DirectionLabel;
  resolvedPath: ResolvedGeoJsonPath;
  displayName?: string;
  displayColor?: string;
  mutableSemantics?: PublishedTemplateMutableSemantics;
}

export interface PublishedTemplateMutableSemantics {
  displayName?: string;
  displayColor?: string;
  serviceLabel?: string;
  timetableSetRefs?: EntityRef[];
  eventPolicyRefs?: EventPolicyRef[];
}

export interface DeployedSystem {
  systemId: string;
  version: string;
  createdAt: ISODateTime;
  sourceGraphId: string;
  templates: PublishedServiceTemplate[];
  stations: StationMeta[];
  relations: BaseTopologyRelation[];
  defaultTimetables: TimetableSet[];
  generatedPresets: PathPreset[];
  contributions?: ContributionStore;
  contentHash: string;  // sha256(canonicalJson(templates + stations + relations + timetables + presets))
  presetHashes: Record<string, string>;
}

export interface TimetableSet {
  setId: string;
  label: string;
  patternRef: EntityRef;
  entries: TimetableEntry[];
}

export interface TimetableEntry {
  stationRef: EntityRef;
  arrivalTime?: string;
  departureTime?: string;
  dwellSeconds?: number;
}

export interface PathPreset {
  presetId: string;
  label: string;
  shortLabel: string;
  serviceLabel: string;
  displayColor: string;
  patternRef: EntityRef;
  startStation: EntityRef;
  endStation: EntityRef;
  viaStations: EntityRef[];
  landmarkLabels: string[];
  directionLabel: string;
  estimatedTimeMinutes: number;
  distanceKm: number;
  runSpec: RunSpec;
}

export interface TripPlanRequest {
  presetId?: string;
  systemId: string;
  startStationRef: EntityRef;
  endStationRef: EntityRef;
  viaRefs?: EntityRef[];
  directionPreference?: string;
  date?: string;
}

export type PlanTripResult =
  | { status: "ok"; trip: TripResult; runtimeArtifacts: TripRuntimeArtifacts }
  | { status: "unreachable"; reason: string; suggestions?: PathPreset[] }
  | { status: "invalid_request"; reason: string };
