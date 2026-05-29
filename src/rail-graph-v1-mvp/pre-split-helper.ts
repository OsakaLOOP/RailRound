import type { AnnotatedFeature, RailGraphAnnotation } from "../rail-graph-v1/annotation.types";
import type { GeoJSONPosition } from "../rail-graph-v1/geojson";
import { projectPointToPolyline, haversineDistance } from "../rail-graph-v1/geometry-math";

type GeoJsonFeature = AnnotatedFeature;

function isTrackFeature(f: GeoJsonFeature): boolean {
  const g = f.geometry;
  if (!g || (g.type !== "LineString" && g.type !== "MultiLineString")) return false;
  const props = (f.properties || {}) as any;
  const kind = props.railGraph?.kind;
  const classMain = props.class_main || props.sourceTags?.class_main;
  const railway = props.railway || props.sourceTags?.railway;
  return kind === "track_geometry" || classMain === "rail" || railway === "rail";
}

function lineStringsFromGeometry(geometry: any): GeoJSONPosition[][] {
  if (geometry.type === "LineString") {
    return [geometry.coordinates];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates;
  }
  return [];
}

export function preSplitSourceFeatures(features: GeoJsonFeature[]): GeoJsonFeature[] {
  const nonTracks: GeoJsonFeature[] = [];
  let tracks: GeoJsonFeature[] = [];

  // 1. Separate tracks and non-tracks, and flatten MultiLineString tracks into LineString features
  for (const f of features) {
    if (!isTrackFeature(f)) {
      nonTracks.push(f);
      continue;
    }

    const lines = lineStringsFromGeometry(f.geometry);
    const annotation = f.properties?.railGraph as RailGraphAnnotation | undefined;
    const baseId = annotation?.id || `manual:feature:${Math.random().toString(36).slice(2, 9)}`;

    for (const [lineIndex, coordinates] of lines.entries()) {
      const partId = lines.length > 1 ? `${baseId}:line_${lineIndex}` : baseId;
      const copy: GeoJsonFeature = {
        ...f,
        geometry: {
          type: "LineString",
          coordinates: JSON.parse(JSON.stringify(coordinates)),
        },
        properties: {
          ...f.properties,
          railGraph: {
            ...annotation,
            id: partId,
            preSplitOriginalId: baseId,
            preSplitStartMeasure: 0,
            preSplitEndMeasure: 1,
          } as any,
        },
      };
      tracks.push(copy);
    }
  }

  const SNAP_TOLERANCE = 0.5; // 0.5m
  let snappedAny = true;
  let iterations = 0;
  const maxIterations = 100;

  while (snappedAny && iterations < maxIterations) {
    snappedAny = false;
    iterations++;

    // Build endpoint degree map
    const endpointDegrees: Record<string, number> = {};
    for (const f of tracks) {
      const coords = f.geometry.coordinates as GeoJSONPosition[];
      if (coords.length < 2) continue;
      const startKey = `${coords[0][0].toFixed(6)},${coords[0][1].toFixed(6)}`;
      const endKey = `${coords[coords.length - 1][0].toFixed(6)},${coords[coords.length - 1][1].toFixed(6)}`;
      endpointDegrees[startKey] = (endpointDegrees[startKey] ?? 0) + 1;
      endpointDegrees[endKey] = (endpointDegrees[endKey] ?? 0) + 1;
    }

    for (let i = 0; i < tracks.length; i++) {
      const f = tracks[i];
      const coords = f.geometry.coordinates as GeoJSONPosition[];
      if (coords.length < 2) continue;

      const pStart = coords[0];
      const startKey = `${pStart[0].toFixed(6)},${pStart[1].toFixed(6)}`;

      const pEnd = coords[coords.length - 1];
      const endKey = `${pEnd[0].toFixed(6)},${pEnd[1].toFixed(6)}`;

      // Check start node degree
      if (endpointDegrees[startKey] === 1) {
        if (trySnapNode(pStart, i, 0)) {
          snappedAny = true;
          break;
        }
      }

      // Check end node degree
      if (endpointDegrees[endKey] === 1) {
        if (trySnapNode(pEnd, i, coords.length - 1)) {
          snappedAny = true;
          break;
        }
      }
    }
  }

  function trySnapNode(nodeCoord: GeoJSONPosition, featureIdx: number, coordIdx: number): boolean {
    const edge = tracks[featureIdx];
    const edgeId = edge.properties?.railGraph?.id;

    for (let j = 0; j < tracks.length; j++) {
      if (j === featureIdx) continue;
      const targetEdge = tracks[j];
      const targetCoords = targetEdge.geometry.coordinates as GeoJSONPosition[];
      if (targetCoords.length < 2) continue;

      const proj = projectPointToPolyline(nodeCoord, targetCoords);
      if (proj.distance < SNAP_TOLERANCE) {
        const distToStart = haversineDistance(proj.snapped, targetCoords[0]);
        const distToEnd = haversineDistance(proj.snapped, targetCoords[targetCoords.length - 1]);

        if (distToStart < 0.1) {
          // Merge node into target's start node
          edge.geometry.coordinates[coordIdx] = targetCoords[0];
          return true;
        } else if (distToEnd < 0.1) {
          // Merge node into target's end node
          edge.geometry.coordinates[coordIdx] = targetCoords[targetCoords.length - 1];
          return true;
        } else {
          // Split targetEdge at the projection point
          const targetCoords = targetEdge.geometry.coordinates as GeoJSONPosition[];
          const projResult = projectPointToPolyline(proj.snapped, targetCoords);
          const segIdx = projResult.segmentIndex;

          const coordsA = targetCoords.slice(0, segIdx + 1);
          coordsA.push(proj.snapped);
          const coordsB = [proj.snapped, ...targetCoords.slice(segIdx + 1)];

          const originalAnn = targetEdge.properties?.railGraph || {};
          const originalStart = originalAnn.preSplitStartMeasure ?? 0;
          const originalEnd = originalAnn.preSplitEndMeasure ?? 1;
          const splitMeasure = originalStart + projResult.measure * (originalEnd - originalStart);

          const partA: GeoJsonFeature = {
            ...targetEdge,
            geometry: {
              type: "LineString",
              coordinates: coordsA,
            },
            properties: {
              ...targetEdge.properties,
              railGraph: {
                ...originalAnn,
                id: `${originalAnn.id}:part_A`,
                preSplitOriginalId: originalAnn.preSplitOriginalId || originalAnn.id,
                preSplitStartMeasure: originalStart,
                preSplitEndMeasure: splitMeasure,
              } as any,
            },
          };

          const partB: GeoJsonFeature = {
            ...targetEdge,
            geometry: {
              type: "LineString",
              coordinates: coordsB,
            },
            properties: {
              ...targetEdge.properties,
              railGraph: {
                ...originalAnn,
                id: `${originalAnn.id}:part_B`,
                preSplitOriginalId: originalAnn.preSplitOriginalId || originalAnn.id,
                preSplitStartMeasure: splitMeasure,
                preSplitEndMeasure: originalEnd,
              } as any,
            },
          };

          // Update degree-1 endpoint coordinate to snap exactly
          edge.geometry.coordinates[coordIdx] = proj.snapped;

          // Replace targetEdge with partA and partB
          tracks = tracks.filter((_, idx) => idx !== j);
          tracks.push(partA, partB);
          return true;
        }
      }
    }
    return false;
  }

  return [...nonTracks, ...tracks];
}
