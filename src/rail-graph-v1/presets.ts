// ============================================================
// Rail Graph v1 - User-facing path presets
// ============================================================

import type { Diagnostic } from "./diagnostic-types";
import type { PathPreset, PublishedServiceTemplate, TimetableSet } from "./deployment.types";
import type { SystemContext } from "./graph.types";
import type { EntityRef } from "./primitives";
import type { ResolvedGeoJsonPath, RunSpec, TimetableAnchor } from "./runtime.types";
import type { ServicePattern, ServiceTraceEntry } from "./service-template.types";
import { fingerprint } from "./fingerprint";
import { resolveServicePatternGeometry } from "./render-geometry";
import { resolveRunContext } from "./run-resolver";

export interface BuildPathPresetsArgs {
  system: SystemContext;
  templates?: readonly PublishedServiceTemplate[];
  timetables?: readonly TimetableSet[];
  systemId?: string;
}

export interface BuildPathPresetsResult {
  presets: PathPreset[];
  diagnostics: Diagnostic[];
}

export function buildPathPresets(args: BuildPathPresetsArgs): BuildPathPresetsResult {
  const diagnostics: Diagnostic[] = [];
  const templatesByPattern = new Map((args.templates ?? []).map((template) => [template.patternRef, template]));
  const presets = sortedPatterns(args.system).map((pattern) => {
    const template = templatesByPattern.get(pattern.patternId) ?? fallbackTemplate(args.system, pattern);
    diagnostics.push(...template.resolvedPath.diagnostics);
    return buildPathPreset({
      system: args.system,
      pattern,
      template,
      timetable: (args.timetables ?? []).find((set) => set.patternRef === pattern.patternId),
      systemId: args.systemId,
    });
  });
  return { presets, diagnostics };
}

export function buildPresetRunIdMap(args: {
  system: SystemContext;
  presets: readonly PathPreset[];
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const preset of args.presets) {
    out[preset.presetId] = resolveRunContext({
      system: args.system,
      spec: preset.runSpec,
    }).runId;
  }
  return out;
}

export function pathPresetContentInput(preset: PathPreset): unknown {
  return {
    presetId: preset.presetId,
    label: preset.label,
    shortLabel: preset.shortLabel,
    serviceLabel: preset.serviceLabel,
    displayColor: preset.displayColor,
    patternRef: preset.patternRef,
    startStation: preset.startStation,
    endStation: preset.endStation,
    viaStations: preset.viaStations,
    landmarkLabels: preset.landmarkLabels,
    directionLabel: preset.directionLabel,
    estimatedTimeMinutes: preset.estimatedTimeMinutes,
    distanceKm: preset.distanceKm,
    runSpec: preset.runSpec,
  };
}

function buildPathPreset(args: {
  system: SystemContext;
  pattern: ServicePattern;
  template: PublishedServiceTemplate;
  timetable?: TimetableSet;
  systemId?: string;
}): PathPreset {
  const trace = sortedTrace(args.pattern.traceSequence);
  const first = trace[0];
  const last = trace[trace.length - 1] ?? first;
  const direction = args.pattern.directionConvention.forwardDirection ?? args.template.direction;
  const timetableAnchors = args.timetable ? timetableSetToAnchors(args.timetable) : undefined;
  const runSpec: RunSpec = {
    systemId: args.systemId ?? args.pattern.systemRef,
    patternRef: args.pattern.patternId,
    startStationRef: first.stationRef,
    endStationRef: last.stationRef,
    viaRefs: middleStationRefs(trace),
    directionHint: direction,
    timetableAnchors,
  };
  const label = `${stationLabel(args.system, first.stationRef)} - ${stationLabel(args.system, last.stationRef)}`;
  const serviceLabel = args.template.displayName
    ?? args.pattern.displayName
    ?? args.pattern.serviceType;
  const presetId = `preset:${fingerprint({
    sourceGraphId: args.system.graphId,
    patternRef: args.pattern.patternId,
    startStationRef: runSpec.startStationRef,
    endStationRef: runSpec.endStationRef,
    viaRefs: runSpec.viaRefs,
    directionHint: runSpec.directionHint,
    timetableSetId: args.timetable?.setId,
  }).slice(0, 16)}`;

  return {
    presetId,
    label,
    shortLabel: `${stationLabel(args.system, first.stationRef)}-${stationLabel(args.system, last.stationRef)}`,
    serviceLabel,
    displayColor: args.template.displayColor ?? args.pattern.displayColor ?? "#64748b",
    patternRef: args.pattern.patternId,
    startStation: first.stationRef,
    endStation: last.stationRef,
    viaStations: middleStationRefs(trace),
    landmarkLabels: landmarkLabels(args.system, trace),
    directionLabel: args.pattern.directionConvention.forwardLabel,
    estimatedTimeMinutes: estimatedTimeMinutes(args.template.resolvedPath, args.timetable),
    distanceKm: roundDistanceKm(args.template.resolvedPath.totalDistanceMeters),
    runSpec,
  };
}

function fallbackTemplate(system: SystemContext, pattern: ServicePattern): PublishedServiceTemplate {
  const display = system.graph.displayStore.patternDisplay[pattern.patternId] ?? {};
  const direction = pattern.directionConvention.forwardDirection ?? "unknown";
  return {
    templateId: `published:template:${fingerprint({
      sourceGraphId: system.graphId,
      patternRef: pattern.patternId,
      direction,
    }).slice(0, 16)}` as EntityRef,
    sourceGraphId: system.graphId,
    patternRef: pattern.patternId,
    lineRef: pattern.lineRef,
    systemRef: pattern.systemRef,
    companyRef: pattern.companyRef,
    serviceType: pattern.serviceType,
    direction,
    resolvedPath: resolveServicePatternGeometry({
      graph: system.graph,
      patternRef: pattern.patternId,
      sourceGraphId: system.graphId,
      direction,
    }),
    displayName: display.displayName ?? pattern.displayName,
    displayColor: display.displayColor ?? pattern.displayColor,
    mutableSemantics: {
      displayName: display.displayName ?? pattern.displayName,
      displayColor: display.displayColor ?? pattern.displayColor,
      serviceLabel: display.displayName ?? pattern.displayName ?? pattern.serviceType,
    },
  };
}

function sortedPatterns(system: SystemContext): ServicePattern[] {
  return [...system.graph.topo.serviceTemplates.servicePatterns]
    .sort((left, right) => left.patternId.localeCompare(right.patternId));
}

function sortedTrace(trace: readonly ServiceTraceEntry[]): ServiceTraceEntry[] {
  return [...trace].sort((left, right) => left.orderIndex - right.orderIndex);
}

function middleStationRefs(trace: readonly ServiceTraceEntry[]): EntityRef[] {
  const unique = trace.slice(1, -1).map((entry) => entry.stationRef);
  return [...new Set(unique)];
}

function landmarkLabels(system: SystemContext, trace: readonly ServiceTraceEntry[]): string[] {
  const labels: string[] = [];
  for (const entry of trace) {
    const stationMeta = system.graph.displayStore.stationDisplay[entry.stationRef];
    if (entry.landmark || stationMeta?.landmark) {
      labels.push(stationMeta?.name ?? system.graph.indexes.stationById[entry.stationRef]?.name ?? entry.stationRef);
    }
  }
  return [...new Set(labels)];
}

function stationLabel(system: SystemContext, stationRef: EntityRef): string {
  return system.graph.displayStore.stationDisplay[stationRef]?.name
    ?? system.graph.indexes.stationById[stationRef]?.name
    ?? stationRef;
}

function timetableSetToAnchors(set: TimetableSet): TimetableAnchor[] {
  return set.entries.map((entry) => ({
    stationRef: entry.stationRef,
    arrivalTime: entry.arrivalTime,
    departureTime: entry.departureTime,
    dwellSeconds: entry.dwellSeconds,
  }));
}

function estimatedTimeMinutes(path: ResolvedGeoJsonPath, timetable: TimetableSet | undefined): number {
  const timetableMinutes = timetableDurationMinutes(timetable);
  if (timetableMinutes !== undefined) return timetableMinutes;
  return Math.max(1, Math.round(path.totalDistanceMeters / 1000));
}

function timetableDurationMinutes(timetable: TimetableSet | undefined): number | undefined {
  if (!timetable || timetable.entries.length < 2) return undefined;
  const first = timetable.entries[0];
  const last = timetable.entries[timetable.entries.length - 1];
  const firstTime = Date.parse(first.departureTime ?? first.arrivalTime ?? "");
  const lastTime = Date.parse(last.arrivalTime ?? last.departureTime ?? "");
  if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime) || lastTime < firstTime) return undefined;
  return Math.round((lastTime - firstTime) / 60000);
}

function roundDistanceKm(distanceMeters: number): number {
  return Number((distanceMeters / 1000).toFixed(3));
}
