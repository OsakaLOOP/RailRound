import { computeLoopVia, findRoute } from "../core/railwayRouting";
import { calcDist, sliceGeoJsonPath } from "../core/tripCalculator";
import type { RailwayMap, CustomFeatureCollection } from "../store";
import type {
  RouteSliceData,
  RouteSlicePathData,
  RouteSlicePathSegment,
} from "./routeExportTypes";

interface BaseComputeParams {
  railwayData: RailwayMap;
  geoData: CustomFeatureCollection | null;
}

interface ComputeManualRouteParams extends BaseComputeParams {
  mode: "manual";
  segments: ManualSegmentInput[];
}

interface ComputeAutoRouteParamsByName extends BaseComputeParams {
  mode?: "auto";
  lineKey: string;
  startStation: string;
  endStation: string;
}

interface ComputeAutoRouteParamsById extends BaseComputeParams {
  mode?: "auto";
  startLineKey: string;
  startStationId: string;
  endLineKey: string;
  endStationId: string;
}

type ComputeRouteParams =
  | ComputeManualRouteParams
  | ComputeAutoRouteParamsByName
  | ComputeAutoRouteParamsById;

export interface ManualSegmentInput {
  lineKey: string;
  fromId?: string;
  toId?: string;
  fromStation?: string;
  toStation?: string;
  loopVia?: "up" | "down" | "auto";
}

interface NormalizedStation {
  id: string;
  name_ja: string;
  name_en?: string;
  lat: number;
  lng: number;
}

const MAX_LOGO_SIZE_BYTES = 64 * 1024;

async function imageUrlToDataUri(url: string): Promise<string | null> {
  try {
    const absoluteUrl = url.startsWith("http")
      ? url
      : window.location.origin + "/" + url.replace(/^\//, "");
    const res = await fetch(absoluteUrl, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_LOGO_SIZE_BYTES) return null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function inlineMetaLogos(meta: RouteSliceData["meta"]) {
  if (!meta) return;
  for (const field of ["icon", "logo", "companyIcon"] as const) {
    const val = meta[field];
    if (!val || val.startsWith("data:")) continue;
    const dataUri = await imageUrlToDataUri(val);
    if (dataUri) meta[field] = dataUri;
  }
}

function resolveLoopVia(
  railwayData: RailwayMap,
  lineKey: string,
  fromId: string,
  toId: string,
  loopVia?: "up" | "down" | "auto",
): "up" | "down" | undefined {
  const line = railwayData[lineKey];
  if (!line?.meta?.isLoop) return undefined;
  if (loopVia === "up" || loopVia === "down") {
    return loopVia;
  }
  return computeLoopVia(railwayData, lineKey, fromId, toId);
}

function buildSegmentStations(
  lineStations: NormalizedStation[],
  startIdx: number,
  endIdx: number,
  loopVia?: "up" | "down",
): NormalizedStation[] {
  if (startIdx === -1 || endIdx === -1) return [];

  const path: NormalizedStation[] = [];
  if (loopVia) {
    const len = lineStations.length;
    let curr = startIdx;
    const dir = loopVia === "up" ? 1 : -1;
    while (true) {
      path.push(lineStations[curr]);
      if (curr === endIdx) break;
      curr = (curr + dir + len) % len;
    }
    return path;
  }

  const step = startIdx <= endIdx ? 1 : -1;
  for (
    let i = startIdx;
    step === 1 ? i <= endIdx : i >= endIdx;
    i += step
  ) {
    path.push(lineStations[i]);
  }
  return path;
}

function findLineFeature(
  geoData: CustomFeatureCollection | null,
  lineKey: string,
  loopVia?: "up" | "down",
) {
  if (!geoData?.features) return null;
  const parts = lineKey.split(":");
  const company = parts[0];
  const lineName = parts.slice(1).join(":");

  const candidates = geoData.features.filter(
    (f: any) =>
      f.properties?.type === "line" &&
      f.properties?.name === lineName &&
      f.properties?.company === company,
  );
  if (candidates.length === 0) return null;

  if (loopVia) {
    const directional = candidates.find(
      (f: any) => f.properties?.direction === loopVia,
    );
    if (directional) return directional;
  }
  return candidates[0];
}

function collectSegmentCoords(
  geoData: CustomFeatureCollection | null,
  lineKey: string,
  fromStation: NormalizedStation,
  toStation: NormalizedStation,
  loopVia?: "up" | "down",
): [number, number][] {
  const coords: [number, number][] = [];
  const feature = findLineFeature(geoData, lineKey, loopVia);
  if (feature) {
    const sliced = sliceGeoJsonPath(
      feature,
      fromStation.lat,
      fromStation.lng,
      toStation.lat,
      toStation.lng,
    );
    if (sliced && sliced.length > 0) {
      if (typeof sliced[0][0] === "number") {
        return sliced as [number, number][];
      }
      for (const part of sliced as [number, number][][]) {
        coords.push(...part);
      }
      if (coords.length > 0) return coords;
    }
  }

  return [
    [fromStation.lat, fromStation.lng],
    [toStation.lat, toStation.lng],
  ];
}

function normalizeStation(station: any): NormalizedStation {
  return {
    id: station.id,
    name_ja: station.name_ja,
    ...(station.name_en ? { name_en: station.name_en } : {}),
    lat: station.lat,
    lng: station.lng,
  };
}

function findStationByName(stations: NormalizedStation[], name?: string) {
  if (!name) return undefined;
  return stations.find((st) => st.name_ja === name || st.name_en === name);
}

function buildDeterministicRouteData(
  segments: ManualSegmentInput[],
  railwayData: RailwayMap,
  geoData: CustomFeatureCollection | null,
) {
  const stationSequence: NormalizedStation[] = [];
  const allTrackCoords: [number, number][] = [];
  const normalizedSegments: RouteSlicePathSegment[] = [];
  const paths: RouteSlicePathData[] = [];

  for (const segment of segments) {
    const line = railwayData[segment.lineKey];
    if (!line) {
      throw new Error(`Line not found: ${segment.lineKey}`);
    }

    const stations = line.stations.map(normalizeStation);
    const fromStation =
      (segment.fromId
        ? stations.find((s) => s.id === segment.fromId)
        : undefined) || findStationByName(stations, segment.fromStation);
    const toStation =
      (segment.toId
        ? stations.find((s) => s.id === segment.toId)
        : undefined) || findStationByName(stations, segment.toStation);

    if (!fromStation || !toStation) {
      throw new Error(
        `Station not found on ${segment.lineKey}: ${segment.fromId || segment.fromStation} -> ${segment.toId || segment.toStation}`,
      );
    }

    const startIdx = stations.findIndex((s) => s.id === fromStation.id);
    const endIdx = stations.findIndex((s) => s.id === toStation.id);
    if (startIdx === -1 || endIdx === -1) {
      throw new Error(
        `Station not found on ${segment.lineKey}: ${fromStation.id} -> ${toStation.id}`,
      );
    }

    const loopVia = resolveLoopVia(
      railwayData,
      segment.lineKey,
      fromStation.id,
      toStation.id,
      segment.loopVia,
    );
    const segmentStations = buildSegmentStations(stations, startIdx, endIdx, loopVia);
    if (segmentStations.length === 0) continue;

    if (
      stationSequence.length > 0 &&
      stationSequence[stationSequence.length - 1].id === segmentStations[0].id
    ) {
      stationSequence.push(...segmentStations.slice(1));
    } else {
      stationSequence.push(...segmentStations);
    }

    const segmentCoords = collectSegmentCoords(
      geoData,
      segment.lineKey,
      fromStation,
      toStation,
      loopVia,
    );
    allTrackCoords.push(
      ...segmentCoords,
    );

    const pathColor = line.meta?.color || null;
    const pathMeta: RouteSliceData["meta"] = {
      icon: line.meta?.icon ?? null,
      logo: line.meta?.logo ?? null,
      companyIcon: line.meta?.companyIcon ?? null,
      recolor: line.meta?.recolor ?? false,
      color: pathColor,
      lineKey: segment.lineKey,
      lineName:
        segment.lineKey.split(":").slice(1).join(":") || segment.lineKey,
    };
    paths.push({
      stations: segmentStations,
      routeCoords: segmentCoords,
      color: pathColor,
      meta: pathMeta,
    });

    normalizedSegments.push({
      lineKey: segment.lineKey,
      fromId: fromStation.id,
      toId: toStation.id,
      ...(loopVia ? { loopVia } : {}),
      fromName: fromStation.name_ja,
      toName: toStation.name_ja,
    });
  }

  const uniqueSequence = stationSequence.filter(
    (st, i, arr) => i === 0 || st.id !== arr[i - 1].id,
  );
  if (uniqueSequence.length < 2) {
    throw new Error("Route is too short to render");
  }

  return {
    stations: uniqueSequence,
    routeCoords: allTrackCoords,
    paths,
    pathSegments: normalizedSegments,
  };
}

export async function computeAndSerializeRoute(
  params: ComputeRouteParams,
  options: { inlineLogos?: boolean; coordPrecision?: number } = {},
): Promise<RouteSliceData> {
  const { inlineLogos = true, coordPrecision = 4 } = options;
  const { railwayData, geoData } = params;

  let routeMode: "auto" | "manual" = "auto";
  let routeData: {
    stations: NormalizedStation[];
    routeCoords: [number, number][];
    paths: RouteSlicePathData[];
    pathSegments: RouteSlicePathSegment[];
  };
  let metaLineKey: string | null = null;

  if (params.mode === "manual") {
    if (!params.segments || params.segments.length === 0) {
      throw new Error("No deterministic segments provided");
    }
    routeMode = "manual";
    routeData = buildDeterministicRouteData(params.segments, railwayData, geoData);
    metaLineKey = routeData.pathSegments[0]?.lineKey ?? null;
  } else {
    let startLineKey: string;
    let startStationId: string;
    let endLineKey: string;
    let endStationId: string;

    if (
      "startLineKey" in params &&
      "startStationId" in params &&
      "endLineKey" in params &&
      "endStationId" in params
    ) {
      startLineKey = params.startLineKey;
      startStationId = params.startStationId;
      endLineKey = params.endLineKey;
      endStationId = params.endStationId;
    } else {
      const line = railwayData[params.lineKey];
      if (!line) throw new Error(`Line not found: ${params.lineKey}`);

      const startNode = line.stations.find(
        (s: any) => s.name_ja === params.startStation || s.name_en === params.startStation,
      );
      const endNode = line.stations.find(
        (s: any) => s.name_ja === params.endStation || s.name_en === params.endStation,
      );
      if (!startNode || !endNode) {
        throw new Error(`Station not found: ${params.startStation} or ${params.endStation}`);
      }

      startLineKey = params.lineKey;
      startStationId = startNode.id;
      endLineKey = params.lineKey;
      endStationId = endNode.id;
    }

    const result = findRoute(
      startLineKey,
      startStationId,
      endLineKey,
      endStationId,
      railwayData,
      6,
    );
    if (!result || result.error || !result.segments) {
      throw new Error(result?.error || "Route not found");
    }
    if (result.segments.length === 0) {
      throw new Error("Auto route has no segments");
    }

    const autoSegments: ManualSegmentInput[] = result.segments.map((seg: any) => ({
      lineKey: seg.lineKey,
      fromId: seg.fromId,
      toId: seg.toId,
      ...(seg.loopVia ? { loopVia: seg.loopVia } : {}),
    }));

    routeData = buildDeterministicRouteData(autoSegments, railwayData, geoData);
    metaLineKey = routeData.pathSegments[0]?.lineKey ?? startLineKey;
  }

  let totalDist = 0;
  for (let i = 0; i < routeData.stations.length - 1; i++) {
    const st1 = routeData.stations[i];
    const st2 = routeData.stations[i + 1];
    totalDist += calcDist(st1.lat, st1.lng, st2.lat, st2.lng);
  }
  const estimatedTime = (totalDist / 80) * 60 + routeData.stations.length * 1.5;

  const lineForMeta = metaLineKey ? railwayData[metaLineKey] : null;
  const routeColor = lineForMeta?.meta?.color || null;
  const routeCoords: [number, number][] = routeData.routeCoords.map(([lat, lng]) => [
    parseFloat(lat.toFixed(coordPrecision)),
    parseFloat(lng.toFixed(coordPrecision)),
  ]);
  const paths: RouteSlicePathData[] = routeData.paths.map((path) => ({
    stations: path.stations,
    routeCoords: path.routeCoords.map(([lat, lng]) => [
      parseFloat(lat.toFixed(coordPrecision)),
      parseFloat(lng.toFixed(coordPrecision)),
    ]),
    color: path.color ?? null,
    meta: path.meta ? { ...path.meta } : null,
  }));

  const meta: RouteSliceData["meta"] = lineForMeta
    ? {
        icon: lineForMeta.meta?.icon ?? null,
        logo: lineForMeta.meta?.logo ?? null,
        companyIcon: lineForMeta.meta?.companyIcon ?? null,
        recolor: lineForMeta.meta?.recolor ?? false,
        color: routeColor,
        lineKey: metaLineKey!,
        lineName: metaLineKey!.split(":").slice(1).join(":") || metaLineKey!,
      }
    : null;

  if (inlineLogos) {
    await inlineMetaLogos(meta);
    for (const path of paths) {
      await inlineMetaLogos(path.meta);
    }
  }

  const resultData: RouteSliceData = {
    stations: routeData.stations,
    routeCoords,
    distance: totalDist.toFixed(1),
    time: estimatedTime.toFixed(0),
    color: routeColor,
    meta,
    paths,
    routeMode,
    pathSegments: routeData.pathSegments,
  };

  return JSON.parse(JSON.stringify(resultData));
}
