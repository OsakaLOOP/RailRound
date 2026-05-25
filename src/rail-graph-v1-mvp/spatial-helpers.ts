// ============================================================
// MVP 几何工具集中 — 供 rule-handlers / list-view / app 复用
//
// 设计原则:
//   - 平面投影近似 (lat0 cos 修正), 小范围误差 << 1m, 不引入 turf/jsts/rbush 依赖
//   - 输入容忍 [lng, lat] / [lng, lat, alt] (GeoJSONPosition), 内部只取前两位
//   - bbox 形式: [minX, minY, maxX, maxY] (即 [minLng, minLat, maxLng, maxLat])
// ============================================================

import type { GeoJSONPosition } from "../rail-graph-v1/geojson";
import type { AnnotatedFeature } from "../rail-graph-v1/annotation.types";

type Pt = [number, number];

function as2d(p: GeoJSONPosition | Pt): Pt {
  return [Number(p[0]), Number(p[1])];
}

export interface DirectionVector {
  /** Vector placement point in GeoJSON lon/lat coordinates. */
  origin: GeoJSONPosition;
  /** Unit vector in local projected meters: +x east, +y north. */
  x: number;
  y: number;
  /** Bearing-like azimuth in degrees, measured clockwise from north. */
  angleDeg: number;
  /** 0..1 concentration of segment directions after treating 0deg and 180deg as equivalent. */
  confidence: number;
  /** Longest contributing segment in meters. */
  lengthMeters: number;
  segmentCount: number;
}

export interface ConnectedLineComponentOptions {
  /** Coordinate precision used by MVP endpoint topology. Defaults to 6. */
  endpointPrecision?: number;
  /** Endpoint-to-polyline snapping tolerance in meters. Defaults to 0.5m. */
  snapToleranceM?: number;
}

export interface ConnectedLineComponentIndex {
  componentLengthByFeatureKey: Map<string, number>;
  componentIdByFeatureKey: Map<string, number>;
}

// ── 距离 ───────────────────────────────────────────────────────

/** 点到线段最短距离 (米)。平面投影近似, 自动用中点纬度修正 cos 因子。 */
export function pointToSegmentMeters(
  p: GeoJSONPosition | Pt,
  a: GeoJSONPosition | Pt,
  b: GeoJSONPosition | Pt,
): number {
  const [px, py] = as2d(p);
  const [ax, ay] = as2d(a);
  const [bx, by] = as2d(b);
  const lat0 = ((ay + by) / 2) * Math.PI / 180;
  const kx = 111320 * Math.cos(lat0);
  const ky = 111320;
  const Ax = ax * kx, Ay = ay * ky;
  const Bx = bx * kx, By = by * ky;
  const Px = px * kx, Py = py * ky;
  const dx = Bx - Ax, dy = By - Ay;
  const len2 = dx * dx + dy * dy;
  let cx: number, cy: number;
  if (len2 === 0) {
    cx = Ax; cy = Ay;
  } else {
    let t = ((Px - Ax) * dx + (Py - Ay) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    cx = Ax + t * dx; cy = Ay + t * dy;
  }
  const ex = Px - cx, ey = Py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

/** 点到 polyline 最短距离 (米)。逐段比对取最小。 */
export function pointToPolylineMeters(
  p: GeoJSONPosition | Pt,
  line: ReadonlyArray<GeoJSONPosition | Pt>,
): number {
  if (line.length < 2) {
    if (line.length === 1) return pointToSegmentMeters(p, line[0], line[0]);
    return Infinity;
  }
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointToSegmentMeters(p, line[i - 1], line[i]);
    if (d < best) best = d;
  }
  return best;
}

/** polyline 总长 (米)。 */
export function polylineLengthMeters(coords: ReadonlyArray<GeoJSONPosition | Pt>): number {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = as2d(coords[i - 1]);
    const b = as2d(coords[i]);
    const lat0 = ((a[1] + b[1]) / 2) * Math.PI / 180;
    const dx = (b[0] - a[0]) * 111320 * Math.cos(lat0);
    const dy = (b[1] - a[1]) * 111320;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/** Build connected LineString/MultiLineString components using MVP endpoint topology semantics.
 *  Direct endpoint equality uses coordinate.toFixed(precision); optional endpoint-to-line snapping
 *  mirrors MVP pathfinding crossover snapping tolerance. */
export function buildConnectedLineComponentIndex<T extends { geometry?: any }>(
  features: ReadonlyArray<T>,
  featureKey: (feature: T, index: number) => string,
  options: ConnectedLineComponentOptions = {},
): ConnectedLineComponentIndex {
  const endpointPrecision = options.endpointPrecision ?? 6;
  const snapToleranceM = options.snapToleranceM ?? 0.5;
  const entries = features
    .map((feature, sourceIndex) => ({
      feature,
      sourceIndex,
      key: featureKey(feature, sourceIndex),
      lines: geometryLineStrings(feature.geometry),
      lengthM: geometryLineStrings(feature.geometry).reduce((sum, line) => sum + polylineLengthMeters(line), 0),
    }))
    .filter((entry) => entry.lines.length > 0);

  const dsu = new DisjointSet(entries.length);
  const byEndpointKey = new Map<string, number>();

  for (let i = 0; i < entries.length; i++) {
    for (const endpoint of geometryLineEndpoints(entries[i].feature.geometry)) {
      const key = fixedCoordinateKey(endpoint, endpointPrecision);
      const other = byEndpointKey.get(key);
      if (other === undefined) byEndpointKey.set(key, i);
      else dsu.union(i, other);
    }
  }

  if (snapToleranceM > 0) {
    for (let i = 0; i < entries.length; i++) {
      const endpointsI = geometryLineEndpoints(entries[i].feature.geometry);
      for (let j = i + 1; j < entries.length; j++) {
        if (
          endpointsSnapToLines(endpointsI, entries[j].lines, snapToleranceM)
          || endpointsSnapToLines(geometryLineEndpoints(entries[j].feature.geometry), entries[i].lines, snapToleranceM)
        ) {
          dsu.union(i, j);
        }
      }
    }
  }

  const lengthByRoot = new Map<number, number>();
  for (let i = 0; i < entries.length; i++) {
    const root = dsu.find(i);
    lengthByRoot.set(root, (lengthByRoot.get(root) ?? 0) + entries[i].lengthM);
  }

  const componentLengthByFeatureKey = new Map<string, number>();
  const componentIdByFeatureKey = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const root = dsu.find(i);
    componentLengthByFeatureKey.set(entries[i].key, lengthByRoot.get(root) ?? entries[i].lengthM);
    componentIdByFeatureKey.set(entries[i].key, root);
  }

  return { componentLengthByFeatureKey, componentIdByFeatureKey };
}

function geometryLineStrings(g: any): GeoJSONPosition[][] {
  if (!g) return [];
  if (g.type === "LineString") return (g.coordinates?.length ?? 0) >= 2 ? [g.coordinates as GeoJSONPosition[]] : [];
  if (g.type === "MultiLineString") {
    return (g.coordinates as GeoJSONPosition[][]).filter((line) => line && line.length >= 2);
  }
  return [];
}

function geometryLineEndpoints(g: any): GeoJSONPosition[] {
  const out: GeoJSONPosition[] = [];
  for (const line of geometryLineStrings(g)) {
    out.push(line[0], line[line.length - 1]);
  }
  return out;
}

function fixedCoordinateKey(point: GeoJSONPosition, precision: number): string {
  return `${Number(point[0]).toFixed(precision)},${Number(point[1]).toFixed(precision)}`;
}

function endpointsSnapToLines(
  endpoints: ReadonlyArray<GeoJSONPosition>,
  lines: ReadonlyArray<ReadonlyArray<GeoJSONPosition>>,
  toleranceM: number,
): boolean {
  for (const endpoint of endpoints) {
    for (const line of lines) {
      if (pointToPolylineMeters(endpoint, line) <= toleranceM) return true;
    }
  }
  return false;
}

class DisjointSet {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_v, i) => i);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(value: number): number {
    const parent = this.parent[value];
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent[value] = root;
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }
  }
}

// ── Direction vectors ────────────────────────────────────────

/** Long-axis direction for a platform-like polygon, derived from its exterior-ring segments. */
export function platformDirectionVector(feature: AnnotatedFeature | { geometry?: any }): DirectionVector | null {
  const g = (feature as any).geometry;
  if (!g) return null;
  if (g.type === "Polygon") {
    const rings = g.coordinates as GeoJSONPosition[][];
    return withOrigin(directionFromRings(rings), polygonCentroid(rings));
  }
  if (g.type === "MultiPolygon") {
    const rings: GeoJSONPosition[][] = [];
    for (const poly of g.coordinates as GeoJSONPosition[][][]) {
      if (poly?.[0]) rings.push(poly[0]);
    }
    return withOrigin(directionFromRings(rings), multiPolygonCentroid(g.coordinates as GeoJSONPosition[][][]));
  }
  return null;
}

/** Dominant direction of a LineString/MultiLineString, treating opposite orientation as equivalent. */
export function lineDirectionVector(feature: AnnotatedFeature | { geometry?: any }): DirectionVector | null {
  const g = (feature as any).geometry;
  if (!g) return null;
  if (g.type === "LineString") {
    const lines = [g.coordinates as GeoJSONPosition[]];
    return withOrigin(directionFromLines(lines), lineCentroid(lines));
  }
  if (g.type === "MultiLineString") {
    const lines = g.coordinates as GeoJSONPosition[][];
    return withOrigin(directionFromLines(lines), lineCentroid(lines));
  }
  return null;
}

/** Acute angle between two unoriented direction vectors. */
export function unorientedAngleDiffDeg(a: DirectionVector, b: DirectionVector): number {
  const dot = Math.abs((a.x * b.x) + (a.y * b.y));
  const clamped = Math.max(-1, Math.min(1, dot));
  return Math.acos(clamped) * 180 / Math.PI;
}

function withOrigin(vector: Omit<DirectionVector, "origin"> | null, origin: GeoJSONPosition | null): DirectionVector | null {
  if (!vector || !origin) return null;
  return { origin, ...vector };
}

function directionFromRings(rings: ReadonlyArray<ReadonlyArray<GeoJSONPosition>>): Omit<DirectionVector, "origin"> | null {
  return directionFromLines(rings);
}

function directionFromLines(lines: ReadonlyArray<ReadonlyArray<GeoJSONPosition>>): Omit<DirectionVector, "origin"> | null {
  const lat0 = meanLat(lines);
  if (lat0 === null) return null;
  const kx = 111320 * Math.max(Math.cos(lat0 * Math.PI / 180), 1e-6);
  const ky = 111320;
  let sumCos2 = 0;
  let sumSin2 = 0;
  let totalWeight = 0;
  let maxLen = 0;
  let segmentCount = 0;

  for (const line of lines) {
    if (!line || line.length < 2) continue;
    for (let i = 1; i < line.length; i++) {
      const a = as2d(line[i - 1]);
      const b = as2d(line[i]);
      const dx = (b[0] - a[0]) * kx;
      const dy = (b[1] - a[1]) * ky;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!Number.isFinite(len) || len <= 0.05) continue;
      const theta = Math.atan2(dy, dx);
      const weight = len * len;
      sumCos2 += weight * Math.cos(theta * 2);
      sumSin2 += weight * Math.sin(theta * 2);
      totalWeight += weight;
      maxLen = Math.max(maxLen, len);
      segmentCount += 1;
    }
  }

  if (totalWeight <= 0 || segmentCount === 0) return null;
  let theta = Math.atan2(sumSin2, sumCos2) / 2;
  let x = Math.cos(theta);
  let y = Math.sin(theta);
  if (x < -1e-12 || (Math.abs(x) <= 1e-12 && y < 0)) {
    x = -x;
    y = -y;
    theta += Math.PI;
  }
  const angleDeg = ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360;
  return {
    x,
    y,
    angleDeg,
    confidence: Math.min(1, Math.sqrt((sumCos2 * sumCos2) + (sumSin2 * sumSin2)) / totalWeight),
    lengthMeters: maxLen,
    segmentCount,
  };
}

function polygonCentroid(rings: ReadonlyArray<ReadonlyArray<GeoJSONPosition>>): GeoJSONPosition | null {
  const outer = rings[0];
  if (!outer || outer.length < 3) return meanPoint(rings);
  const lat0 = meanLat([outer]);
  if (lat0 === null) return null;
  const kx = 111320 * Math.max(Math.cos(lat0 * Math.PI / 180), 1e-6);
  const ky = 111320;
  const origin = as2d(outer[0]);
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < outer.length; i++) {
    const a = as2d(outer[i]);
    const b = as2d(outer[(i + 1) % outer.length]);
    const ax = (a[0] - origin[0]) * kx;
    const ay = (a[1] - origin[1]) * ky;
    const bx = (b[0] - origin[0]) * kx;
    const by = (b[1] - origin[1]) * ky;
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(twiceArea) <= 1e-9) return meanPoint([outer]);
  const scale = 1 / (3 * twiceArea);
  return [origin[0] + (cx * scale / kx), origin[1] + (cy * scale / ky)];
}

function multiPolygonCentroid(polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<GeoJSONPosition>>>): GeoJSONPosition | null {
  let sx = 0;
  let sy = 0;
  let weight = 0;
  const fallbackRings: ReadonlyArray<GeoJSONPosition>[] = [];
  for (const poly of polygons) {
    const outer = poly?.[0];
    if (!outer) continue;
    fallbackRings.push(outer);
    const centroid = polygonCentroid(poly);
    const area = Math.abs(ringSignedAreaMeters(outer));
    if (!centroid || area <= 0) continue;
    sx += Number(centroid[0]) * area;
    sy += Number(centroid[1]) * area;
    weight += area;
  }
  if (weight > 0) return [sx / weight, sy / weight];
  return meanPoint(fallbackRings);
}

function ringSignedAreaMeters(ring: ReadonlyArray<GeoJSONPosition>): number {
  const lat0 = meanLat([ring]);
  if (lat0 === null || ring.length < 3) return 0;
  const kx = 111320 * Math.max(Math.cos(lat0 * Math.PI / 180), 1e-6);
  const ky = 111320;
  const origin = as2d(ring[0]);
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = as2d(ring[i]);
    const b = as2d(ring[(i + 1) % ring.length]);
    area2 += ((a[0] - origin[0]) * kx) * ((b[1] - origin[1]) * ky)
      - ((b[0] - origin[0]) * kx) * ((a[1] - origin[1]) * ky);
  }
  return area2 / 2;
}

function lineCentroid(lines: ReadonlyArray<ReadonlyArray<GeoJSONPosition>>): GeoJSONPosition | null {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    for (let i = 1; i < line.length; i++) {
      const a = as2d(line[i - 1]);
      const b = as2d(line[i]);
      const lat0 = ((a[1] + b[1]) / 2) * Math.PI / 180;
      const dx = (b[0] - a[0]) * 111320 * Math.cos(lat0);
      const dy = (b[1] - a[1]) * 111320;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!Number.isFinite(len) || len <= 0) continue;
      sx += ((a[0] + b[0]) / 2) * len;
      sy += ((a[1] + b[1]) / 2) * len;
      total += len;
    }
  }
  if (total > 0) return [sx / total, sy / total];
  return meanPoint(lines);
}

function meanPoint(lines: ReadonlyArray<ReadonlyArray<GeoJSONPosition>>): GeoJSONPosition | null {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const line of lines) {
    for (const p of line) {
      if (!p || p.length < 2) continue;
      sx += Number(p[0]);
      sy += Number(p[1]);
      count += 1;
    }
  }
  return count > 0 ? [sx / count, sy / count] : null;
}

function meanLat(lines: ReadonlyArray<ReadonlyArray<GeoJSONPosition>>): number | null {
  let total = 0;
  let count = 0;
  for (const line of lines) {
    for (const p of line) {
      if (!p || p.length < 2) continue;
      const lat = Number(p[1]);
      if (!Number.isFinite(lat)) continue;
      total += lat;
      count += 1;
    }
  }
  return count > 0 ? total / count : null;
}

// ── Bbox ───────────────────────────────────────────────────────

export type Bbox = [number, number, number, number]; // [minX, minY, maxX, maxY]

const EMPTY_BBOX: Bbox = [Infinity, Infinity, -Infinity, -Infinity];

function extendBbox(box: Bbox, p: GeoJSONPosition | Pt): void {
  const x = Number(p[0]), y = Number(p[1]);
  if (x < box[0]) box[0] = x;
  if (y < box[1]) box[1] = y;
  if (x > box[2]) box[2] = x;
  if (y > box[3]) box[3] = y;
}

function bboxFromRing(ring: ReadonlyArray<GeoJSONPosition>, box: Bbox): void {
  for (const p of ring) extendBbox(box, p);
}

/** 任意 GeoJSON geometry 的 bbox。空 geometry 返回 null。 */
export function featureBbox(feature: AnnotatedFeature | { geometry?: any }): Bbox | null {
  const g = (feature as any).geometry;
  if (!g) return null;
  const box: Bbox = [...EMPTY_BBOX] as Bbox;
  switch (g.type) {
    case "Point":
      extendBbox(box, g.coordinates);
      break;
    case "MultiPoint":
    case "LineString":
      for (const p of g.coordinates as GeoJSONPosition[]) extendBbox(box, p);
      break;
    case "MultiLineString":
      for (const line of g.coordinates as GeoJSONPosition[][]) {
        for (const p of line) extendBbox(box, p);
      }
      break;
    case "Polygon":
      for (const ring of g.coordinates as GeoJSONPosition[][]) bboxFromRing(ring, box);
      break;
    case "MultiPolygon":
      for (const poly of g.coordinates as GeoJSONPosition[][][]) {
        for (const ring of poly) bboxFromRing(ring, box);
      }
      break;
    default:
      return null;
  }
  if (box[0] === Infinity) return null;
  return box;
}

/** 两个 bbox 是否相交 (含边界相切)。 */
export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** 点是否在 bbox 内 (含边界)。 */
export function bboxContains(box: Bbox, p: GeoJSONPosition | Pt): boolean {
  const x = Number(p[0]), y = Number(p[1]);
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
}

/** 把 bbox 向外膨胀 padding 米 (按经度纬度近似换算)。 */
export function bboxExpandMeters(box: Bbox, meters: number): Bbox {
  const lat0 = ((box[1] + box[3]) / 2) * Math.PI / 180;
  const dy = meters / 111320;
  const dx = meters / (111320 * Math.max(Math.cos(lat0), 1e-6));
  return [box[0] - dx, box[1] - dy, box[2] + dx, box[3] + dy];
}

// ── 多边形包含 ────────────────────────────────────────────────

/** Ray casting: 点是否在简单多边形内 (含边界判定为内)。ring 首尾点可不闭合。 */
export function pointInPolygon(
  p: GeoJSONPosition | Pt,
  ring: ReadonlyArray<GeoJSONPosition | Pt>,
): boolean {
  if (!ring || ring.length < 3) return false;
  const [px, py] = as2d(p);
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = as2d(ring[i]);
    const [xj, yj] = as2d(ring[j]);
    const intersect = ((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / (yj - yi + Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
