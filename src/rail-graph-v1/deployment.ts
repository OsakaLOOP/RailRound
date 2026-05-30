// ============================================================
// Rail Graph v1 - DeployedSystem builder
// ============================================================

import type { BaseTopologyRelation } from "./base-topology.types";
import type { ContributionStore } from "./community.types";
import type {
  DeployedSystem,
  PublishedServiceTemplate,
  TimetableSet,
} from "./deployment.types";
import type { Diagnostic } from "./diagnostic-types";
import type { SystemContext } from "./graph.types";
import type { EntityRef, ISODateTime } from "./primitives";
import type { ServicePattern } from "./service-template.types";
import type { StationMeta } from "./user-facing.types";
import { fingerprint } from "./fingerprint";
import { resolveServicePatternGeometry } from "./render-geometry";
import {
  buildPathPresets,
  buildPresetRunIdMap,
  pathPresetContentInput,
} from "./presets";

export interface BuildDeployedSystemArgs {
  system: SystemContext;
  systemId: string;
  version: string;
  createdAt?: ISODateTime;
  defaultTimetables?: TimetableSet[];
  contributions?: ContributionStore;
}

export interface BuildDeployedSystemResult {
  deployed: DeployedSystem;
  diagnostics: Diagnostic[];
}

export function buildDeployedSystem(args: BuildDeployedSystemArgs): BuildDeployedSystemResult {
  const diagnostics: Diagnostic[] = [];
  const templates = publishServiceTemplates(args.system);
  for (const template of templates) diagnostics.push(...template.resolvedPath.diagnostics);

  const stations = publishStations(args.system);
  const relations = publishRelations(args.system);
  const defaultTimetables = (args.defaultTimetables ?? []).map(cloneTimetableSet);
  const presetResult = buildPathPresets({
    system: args.system,
    templates,
    timetables: defaultTimetables,
    systemId: args.systemId,
  });
  diagnostics.push(...presetResult.diagnostics);
  const presetHashes = buildPresetRunIdMap({
    system: args.system,
    presets: presetResult.presets,
  });

  const deployed: DeployedSystem = {
    systemId: args.systemId,
    version: args.version,
    createdAt: args.createdAt ?? new Date().toISOString(),
    sourceGraphId: args.system.graphId,
    templates,
    stations,
    relations,
    defaultTimetables,
    generatedPresets: presetResult.presets,
    contributions: args.contributions,
    contentHash: fingerprint(deployedContentInput({
      sourceGraphId: args.system.graphId,
      templates,
      stations,
      relations,
      defaultTimetables,
      presets: presetResult.presets,
    })),
    presetHashes,
  };

  return { deployed, diagnostics };
}

export function publishServiceTemplates(system: SystemContext): PublishedServiceTemplate[] {
  return [...system.graph.topo.serviceTemplates.servicePatterns]
    .sort((left, right) => left.patternId.localeCompare(right.patternId))
    .map((pattern) => publishServiceTemplate(system, pattern));
}

export function deployedContentInput(args: {
  sourceGraphId: string;
  templates: readonly PublishedServiceTemplate[];
  stations: readonly StationMeta[];
  relations: readonly BaseTopologyRelation[];
  defaultTimetables: readonly TimetableSet[];
  presets: Readonly<DeployedSystem["generatedPresets"]>;
}): unknown {
  return {
    sourceGraphId: args.sourceGraphId,
    templates: args.templates.map(publishedTemplateContentInput),
    stations: args.stations,
    relations: args.relations,
    defaultTimetables: args.defaultTimetables,
    presets: args.presets.map(pathPresetContentInput),
  };
}

function publishServiceTemplate(
  system: SystemContext,
  pattern: ServicePattern,
): PublishedServiceTemplate {
  const display = system.graph.displayStore.patternDisplay[pattern.patternId] ?? {};
  const direction = pattern.directionConvention.forwardDirection ?? "unknown";
  const resolvedPath = resolveServicePatternGeometry({
    graph: system.graph,
    patternRef: pattern.patternId,
    sourceGraphId: system.graphId,
    direction,
  });
  const displayName = display.displayName ?? pattern.displayName;
  const displayColor = display.displayColor ?? pattern.displayColor;
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
    resolvedPath,
    displayName,
    displayColor,
    mutableSemantics: {
      displayName,
      displayColor,
      serviceLabel: displayName ?? pattern.serviceType,
    },
  };
}

function publishedTemplateContentInput(template: PublishedServiceTemplate): unknown {
  return {
    templateId: template.templateId,
    sourceGraphId: template.sourceGraphId,
    patternRef: template.patternRef,
    lineRef: template.lineRef,
    systemRef: template.systemRef,
    companyRef: template.companyRef,
    serviceType: template.serviceType,
    direction: template.direction,
    resolvedPath: {
      pathId: template.resolvedPath.pathId,
      sourceGraphId: template.resolvedPath.sourceGraphId,
      patternRef: template.resolvedPath.patternRef,
      direction: template.resolvedPath.direction,
      geometry: template.resolvedPath.geometry,
      segments: template.resolvedPath.segments,
      stationPassages: template.resolvedPath.stationPassages,
      semanticRefs: template.resolvedPath.semanticRefs,
      totalDistanceMeters: template.resolvedPath.totalDistanceMeters,
    },
    displayName: template.displayName,
    displayColor: template.displayColor,
    mutableSemantics: template.mutableSemantics,
  };
}

function publishStations(system: SystemContext): StationMeta[] {
  return [...system.graph.topo.base.stations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((station) => {
      const display = system.graph.displayStore.stationDisplay[station.id];
      return {
        stationRef: station.id,
        name: display?.name ?? station.name,
        nameJa: display?.nameJa ?? station.nameJa,
        coordinates: display?.coordinates ?? stationCoordinates(system, station.positionRef) ?? [0, 0],
        landmark: display?.landmark,
      };
    });
}

function stationCoordinates(
  system: SystemContext,
  positionRef: EntityRef | undefined,
): [number, number] | undefined {
  if (!positionRef) return undefined;
  return system.graph.geometryStore.nodePositions[positionRef] as [number, number] | undefined;
}

function publishRelations(system: SystemContext): BaseTopologyRelation[] {
  return [...system.graph.topo.base.relations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((relation) => ({
      id: relation.id,
      kind: relation.kind,
      fromRef: relation.fromRef,
      toRef: relation.toRef,
      payload: relation.payload ? { ...relation.payload } : undefined,
    }));
}

function cloneTimetableSet(set: TimetableSet): TimetableSet {
  return {
    setId: set.setId,
    label: set.label,
    patternRef: set.patternRef,
    entries: set.entries.map((entry) => ({ ...entry })),
  };
}
