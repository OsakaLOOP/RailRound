import * as L from "leaflet";
import type { ScenicVisibilityStatus } from "../../rail-graph-v1/mileage-event.types";

export type ScenicVisibilityMapItem = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  title: string;
  status: ScenicVisibilityStatus;
  bearingDegrees: number;
  angleToleranceDegrees: number;
  distanceMeters?: number;
  selected: boolean;
  dimmed: boolean;
};

type ScenicLayerCache = L.LayerGroup & {
  _fan?: L.Polygon;
  _ray?: L.Polyline;
  _origin?: L.CircleMarker;
};

const EARTH_RADIUS_METERS = 6371008.8;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function destinationLatLng(lat: number, lng: number, bearingDegrees: number, distanceMeters: number): L.LatLngTuple {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = normalizeDegrees(bearingDegrees) * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
      + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );

  return [
    lat2 * 180 / Math.PI,
    ((lng2 * 180 / Math.PI + 540) % 360) - 180,
  ];
}

function scenicDistanceMeters(item: ScenicVisibilityMapItem): number {
  const fallback = item.selected ? 1500 : 950;
  return clamp(finiteOr(item.distanceMeters, fallback), 250, 5000);
}

function scenicToleranceDegrees(item: ScenicVisibilityMapItem): number {
  return clamp(finiteOr(item.angleToleranceDegrees, 30), 5, 90);
}

function fanLatLngs(item: ScenicVisibilityMapItem): L.LatLngExpression[] {
  const tolerance = scenicToleranceDegrees(item);
  const distance = scenicDistanceMeters(item);
  const steps = Math.max(2, Math.ceil(tolerance / 10));
  const points: L.LatLngExpression[] = [[item.lat, item.lng]];

  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const bearing = item.bearingDegrees - tolerance + tolerance * 2 * ratio;
    points.push(destinationLatLng(item.lat, item.lng, bearing, distance));
  }

  return points;
}

function rayLatLngs(item: ScenicVisibilityMapItem): L.LatLngExpression[] {
  return [
    [item.lat, item.lng],
    destinationLatLng(item.lat, item.lng, item.bearingDegrees, scenicDistanceMeters(item)),
  ];
}

function statusColor(status: ScenicVisibilityStatus): string {
  switch (status) {
    case "visible":
      return "#0f766e";
    case "opposite_side":
      return "#d97706";
    case "angle_mismatch":
      return "#e11d48";
    case "unavailable":
      return "#475569";
    case "unknown":
    default:
      return "#64748b";
  }
}

function scenicLayerStyle(item: ScenicVisibilityMapItem) {
  const color = statusColor(item.status);
  const dimFactor = item.dimmed ? 0.38 : 1;
  const selectedFactor = item.selected ? 1.18 : 1;
  const dashArray = item.status === "visible" ? undefined : item.status === "unknown" ? "3 6" : "6 5";

  return {
    color,
    fillColor: color,
    fillOpacity: 0.12 * dimFactor * selectedFactor,
    opacity: 0.62 * dimFactor,
    weight: item.selected ? 2.5 : 1.5,
    dashArray,
  };
}

function originStyle(item: ScenicVisibilityMapItem): L.CircleMarkerOptions {
  const color = statusColor(item.status);
  return {
    pane: "mileageEventsPane",
    radius: item.selected ? 5 : 3.5,
    color: "#ffffff",
    weight: item.selected ? 2 : 1.5,
    fillColor: color,
    fillOpacity: item.dimmed ? 0.35 : 0.9,
    opacity: item.dimmed ? 0.45 : 0.9,
    interactive: false,
  };
}

export function createScenicVisibilityLayer(item: ScenicVisibilityMapItem): L.Layer {
  const style = scenicLayerStyle(item);
  const fan = L.polygon(fanLatLngs(item), {
    pane: "mileageEventsPane",
    color: style.color,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    opacity: style.opacity,
    weight: Math.max(1, style.weight - 0.5),
    dashArray: style.dashArray,
    interactive: false,
  });
  const ray = L.polyline(rayLatLngs(item), {
    pane: "mileageEventsPane",
    color: style.color,
    opacity: Math.min(0.88, style.opacity + 0.15),
    weight: item.selected ? 3 : 2,
    dashArray: style.dashArray,
    interactive: false,
  });
  const origin = L.circleMarker([item.lat, item.lng], originStyle(item));
  const group = L.layerGroup([fan, ray, origin]) as ScenicLayerCache;
  group._fan = fan;
  group._ray = ray;
  group._origin = origin;
  return group;
}

export function updateScenicVisibilityLayer(layer: L.Layer, item: ScenicVisibilityMapItem): void {
  const group = layer as ScenicLayerCache;
  const style = scenicLayerStyle(item);

  group._fan?.setLatLngs(fanLatLngs(item));
  group._fan?.setStyle({
    color: style.color,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    opacity: style.opacity,
    weight: Math.max(1, style.weight - 0.5),
    dashArray: style.dashArray,
  });

  group._ray?.setLatLngs(rayLatLngs(item));
  group._ray?.setStyle({
    color: style.color,
    opacity: Math.min(0.88, style.opacity + 0.15),
    weight: item.selected ? 3 : 2,
    dashArray: style.dashArray,
  });

  group._origin?.setLatLng([item.lat, item.lng]);
  group._origin?.setStyle(originStyle(item));
}
