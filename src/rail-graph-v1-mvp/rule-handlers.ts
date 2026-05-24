// ============================================================
// MVP rule handler 注册表
//
// 设计:
//   - 每种 rule 类型对应一个 handler 函数 (feature, params, refPool) => boolean
//     return true  = 通过 (保留)
//     return false = 剔除
//   - dispatchRule 负责把 rule (新 schema rule.handler 或旧 schema rule.exclude_if/dynamic/post_filter)
//     映射到对应 handler + params
//   - 外部可通过 registerRuleHandler 注册新类型, 不必改引擎源码 — 给未来高度自定义 handler 留插拔点
// ============================================================

import type { AnnotatedFeature } from "../rail-graph-v1/annotation.types";
import type { GeoJSONPosition } from "../rail-graph-v1/geojson";
import {
  lineDirectionVector,
  platformDirectionVector,
  pointToPolylineMeters,
  polylineLengthMeters,
  unorientedAngleDiffDeg,
} from "./spatial-helpers";

type GeoJsonFeature = AnnotatedFeature;

export type RuleHandlerFn = (
  feature: GeoJsonFeature,
  params: any,
  refPool: ReadonlyArray<GeoJsonFeature>,
) => boolean;

/** 单条 rule 在 pipeline 内一次执行的统计。 */
export interface RuleReport {
  ruleId: string;
  ruleLabel?: string;
  phase: number;
  inSize: number;
  outSize: number;
  eliminated: number;
  refSize: number;
  ms: number;
}

/** runFilterPipeline 一次执行的全量报告 — 调试 / UI 展示用。 */
export interface PipelineReport {
  totalIn: number;
  totalOut: number;
  totalMs: number;
  phaseReports: Array<{
    phase: number;
    inSize: number;
    outSize: number;
    rules: RuleReport[];
  }>;
}

export const RULE_HANDLERS: Record<string, RuleHandlerFn> = {
  exclude_if: handleExcludeIf,
  dynamic_match: handleDynamicMatch,
  isolated_or_blank: handleIsolatedOrBlank,
  orphan_railway_node: handleOrphanRailwayNode,
  platform_direction_match: handlePlatformDirectionMatch,
};

export function registerRuleHandler(type: string, fn: RuleHandlerFn): void {
  RULE_HANDLERS[type] = fn;
}

/** dispatchRule: 取出 rule 的 handler type + params, 找 handler 跑。
 *  新 schema:   rule.handler = { type, params }
 *  旧 schema:   rule.exclude_if / rule.dynamic / rule.post_filter (后者用 post_filter.type 作 handler type)
 *  无识别字段:  默认通过 (避免噪音, 后续可换成 throw)。
 */
export function dispatchRule(
  rule: any,
  feature: GeoJsonFeature,
  refPool: ReadonlyArray<GeoJsonFeature>,
): boolean {
  let type: string | undefined;
  let params: any;
  if (rule.handler && typeof rule.handler.type === "string") {
    type = rule.handler.type;
    params = rule.handler.params ?? {};
  } else if (Array.isArray(rule.exclude_if)) {
    type = "exclude_if";
    params = { conditions: rule.exclude_if };
  } else if (rule.dynamic) {
    type = "dynamic_match";
    params = rule.dynamic;
  } else if (rule.post_filter && typeof rule.post_filter.type === "string") {
    type = rule.post_filter.type;
    params = rule.post_filter;
  }
  if (!type) return true;
  const fn = RULE_HANDLERS[type];
  if (!fn) {
    console.warn(`[rule-handlers] unknown handler type "${type}" (rule ${rule.id ?? "?"})`);
    return true;
  }
  return fn(feature, params, refPool);
}

// ── Handlers ───────────────────────────────────────────────────

/** exclude_if: 任一 condition 命中则剔除。conditions 是 OR 关系 (任一命中即剔除)。
 *  支持: value_is / value_not / value_is_in / value_not_in。
 *  field 不存在或空值时跳过该 condition (与旧实现一致, 保持兼容)。 */
export function handleExcludeIf(feature: GeoJsonFeature, params: any): boolean {
  const conditions = params?.conditions || [];
  const props = (feature.properties || {}) as any;
  for (const ex of conditions) {
    const val = props[ex.field];
    if (val === undefined || val === null || val === "") continue;
    if (ex.value_is !== undefined && String(val) === String(ex.value_is)) return false;
    if (ex.value_not !== undefined && String(val) !== String(ex.value_not)) return false;
    if (ex.value_is_in !== undefined && ex.value_is_in.map(String).includes(String(val))) return false;
    if (ex.value_not_in !== undefined && !ex.value_not_in.map(String).includes(String(val))) return false;
  }
  return true;
}

/** dynamic_match: 只对 rail/way 起作用。检查 match_fields 任一字段值与 against_field 互相 contains。
 *  没有 name 类字段的 way 默认通过 (保留)。 */
export function handleDynamicMatch(feature: GeoJsonFeature, params: any): boolean {
  const props = (feature.properties || {}) as any;
  if (props.class_main !== "rail" || props.osm_type !== "way") return true;
  const fields: string[] = params?.match_fields || [];
  const against = props[params?.against_field] || "";
  const hasName = fields.some((f) => props[f]);
  if (!hasName) return true;
  const matches = fields.some((f) => {
    const v = props[f];
    if (!v) return false;
    return String(v).includes(String(against)) || String(against).includes(String(v));
  });
  return matches;
}

/** isolated_or_blank: 适用于 way (LineString/MultiLineString)。
 *  当 (require_unnamed 且确实无 name) + 长度 < max_length_m + 端点不连 refPool 任一 way → 剔除。 */
export function handleIsolatedOrBlank(
  feature: GeoJsonFeature,
  params: any,
  refPool: ReadonlyArray<GeoJsonFeature>,
): boolean {
  const g: any = (feature as any).geometry;
  if (!g || (g.type !== "LineString" && g.type !== "MultiLineString")) return true;
  const props = (feature.properties || {}) as any;
  const maxLen = params?.max_length_m || 200;

  if (params?.require_unnamed) {
    if (props.name || props["name:ja"] || props["name:en"] || props["KSJ2:LIN"]) return true;
  }

  const coords: any = g.coordinates;
  if (!coords || coords.length < 2) return true;
  const len = g.type === "LineString"
    ? polylineLengthMeters(coords)
    : Math.max(...(coords as GeoJSONPosition[][]).map((c) => polylineLengthMeters(c)));
  if (len >= maxLen) return true;

  const threshold = params?.endpoint_threshold ?? 0.0001;
  if (refPool.length === 0) return true;
  const myEpsList = endpointsOf(g);
  const fidSelf = `${props.osm_type || ""}:${props.osm_id || ""}:${props.class_main || ""}:${props.source_line_name || ""}`;
  for (const vf of refPool) {
    const vp: any = vf.properties || {};
    const vfFid = `${vp.osm_type || ""}:${vp.osm_id || ""}:${vp.class_main || ""}:${vp.source_line_name || ""}`;
    if (vfFid === fidSelf) continue;
    const vg: any = (vf as any).geometry;
    if (!vg) continue;
    const vEps = endpointsOf(vg);
    for (const ep of myEpsList) {
      for (const vEp of vEps) {
        const dx = ep[0] - vEp[0];
        const dy = ep[1] - vEp[1];
        if (Math.sqrt(dx * dx + dy * dy) < threshold) return true;
      }
    }
  }
  return false;
}

/** orphan_railway_node: Point 节点 (railway in target_set) 与 refPool 内所有 way 的最短距离都 > tolerance_m → 剔除。
 *  refPool 应是 caller 通过 rule.input.{source, geometry_types} 准备好的 LineString/MultiLineString 集合。 */
export function handleOrphanRailwayNode(
  feature: GeoJsonFeature,
  params: any,
  refPool: ReadonlyArray<GeoJsonFeature>,
): boolean {
  const g: any = (feature as any).geometry;
  if (!g || g.type !== "Point") return true;
  const props = (feature.properties || {}) as any;
  const railwayVal = String(props.railway || "");
  const targetVals: string[] = params?.railway_values || ["switch", "level_crossing", "stop"];
  if (!targetVals.includes(railwayVal)) return true;
  if (refPool.length === 0) return true;

  const tolerance = params?.tolerance_m ?? 3;
  const pt = g.coordinates as GeoJSONPosition;
  if (!Array.isArray(pt) || pt.length < 2) return true;

  for (const vf of refPool) {
    const vg: any = (vf as any).geometry;
    if (!vg) continue;
    if (vg.type === "LineString") {
      if (pointToPolylineMeters(pt, vg.coordinates as GeoJSONPosition[]) <= tolerance) return true;
    } else if (vg.type === "MultiLineString") {
      for (const line of vg.coordinates as GeoJSONPosition[][]) {
        if (line.length < 2) continue;
        if (pointToPolylineMeters(pt, line) <= tolerance) return true;
      }
    }
  }
  return false;
}

/** platform_direction_match: 多边形站台主方向应与附近保留轨道大致平行。
 *  平台向量 origin 放在站台重心; 轨道参考集应由 caller 传入最终保留的 LineString/MultiLineString。 */
export function handlePlatformDirectionMatch(
  feature: GeoJsonFeature,
  params: any,
  refPool: ReadonlyArray<GeoJsonFeature>,
): boolean {
  const g: any = (feature as any).geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return true;
  if (!isPlatformFeature(feature)) return true;

  const platformVector = platformDirectionVector(feature);
  if (!platformVector) return true;
  const minPlatformConfidence = params?.min_platform_confidence ?? 0.55;
  const minPlatformLongEdgeM = params?.min_platform_long_edge_m ?? 8;
  if (platformVector.confidence < minPlatformConfidence || platformVector.lengthMeters < minPlatformLongEdgeM) return true;

  const maxDistanceM = params?.max_distance_m ?? 80;
  const maxAngleDiffDeg = params?.max_angle_diff_deg ?? 25;
  const sameStationBonusM = params?.same_station_bonus_m ?? 40;
  const minTrackConfidence = params?.min_track_confidence ?? 0.25;
  const requireSameStation = !!params?.require_same_nearest_station;
  const platformStation = propString(feature, "nearest_station");

  let sawNearbyTrack = false;
  let sawStationCompatibleTrack = false;
  let bestCompatibleAngle = Infinity;

  for (const ref of refPool) {
    if (!isRailLineFeature(ref)) continue;
    const rg: any = (ref as any).geometry;
    const distanceM = pointToGeometryMeters(platformVector.origin, rg);
    if (!Number.isFinite(distanceM)) continue;
    const refStation = propString(ref, "nearest_station");
    const sameStation = !!platformStation && !!refStation && platformStation === refStation;
    const effectiveMaxDistance = maxDistanceM + (sameStation ? sameStationBonusM : 0);
    if (distanceM > effectiveMaxDistance) continue;
    sawNearbyTrack = true;
    if (requireSameStation && platformStation && refStation && platformStation !== refStation) continue;
    sawStationCompatibleTrack = true;

    const trackVector = lineDirectionVector(ref);
    if (!trackVector || trackVector.confidence < minTrackConfidence) continue;
    const angleDiff = unorientedAngleDiffDeg(platformVector, trackVector);
    if (angleDiff < bestCompatibleAngle) bestCompatibleAngle = angleDiff;
    if (angleDiff <= maxAngleDiffDeg) return true;
  }

  if (!sawNearbyTrack) return params?.remove_if_no_nearby_track === true ? false : true;
  if (requireSameStation && platformStation && !sawStationCompatibleTrack) {
    return params?.remove_if_station_mismatch === true ? false : true;
  }
  if (!Number.isFinite(bestCompatibleAngle)) return true;
  return false;
}

// ── Helpers ────────────────────────────────────────────────────

function propString(feature: GeoJsonFeature, key: string): string {
  const props = (feature.properties || {}) as any;
  const value = props[key] ?? props.sourceTags?.[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

function isPlatformFeature(feature: GeoJsonFeature): boolean {
  const props = (feature.properties || {}) as any;
  const kind = props.railGraph?.kind;
  const classMain = propString(feature, "class_main");
  const railway = propString(feature, "railway");
  const publicTransport = propString(feature, "public_transport");
  return kind === "platform_area"
    || classMain === "platform"
    || classMain === "platform_edge"
    || railway === "platform"
    || publicTransport === "platform";
}

function isRailLineFeature(feature: GeoJsonFeature): boolean {
  const g: any = (feature as any).geometry;
  if (!g || (g.type !== "LineString" && g.type !== "MultiLineString")) return false;
  const props = (feature.properties || {}) as any;
  const kind = props.railGraph?.kind;
  const classMain = propString(feature, "class_main");
  const railway = propString(feature, "railway");
  return kind === "track_geometry" || classMain === "rail" || railway === "rail";
}

function pointToGeometryMeters(point: GeoJSONPosition, g: any): number {
  if (!g) return Infinity;
  if (g.type === "LineString") {
    return pointToPolylineMeters(point, g.coordinates as GeoJSONPosition[]);
  }
  if (g.type === "MultiLineString") {
    let best = Infinity;
    for (const line of g.coordinates as GeoJSONPosition[][]) {
      if (!line || line.length < 2) continue;
      const d = pointToPolylineMeters(point, line);
      if (d < best) best = d;
    }
    return best;
  }
  return Infinity;
}

function endpointsOf(g: any): GeoJSONPosition[] {
  if (g.type === "LineString") {
    const c = g.coordinates;
    if (!c || c.length < 1) return [];
    return [c[0], c[c.length - 1]];
  }
  if (g.type === "MultiLineString") {
    const out: GeoJSONPosition[] = [];
    for (const line of g.coordinates as GeoJSONPosition[][]) {
      if (!line || line.length < 1) continue;
      out.push(line[0], line[line.length - 1]);
    }
    return out;
  }
  if (g.type === "Point") return [g.coordinates];
  return [];
}
