// ============================================================
// Path Animation Speed — 预计算速度分布（站台附近放慢）
//
// 核心思路:
//   沿 leg 的每个坐标点预计算 speedMultiplier:
//     - 在站台/停靠点 500m 范围内: speedMultiplier = 1/3（放慢到三分之一）
//     - 在 500m 外: speedMultiplier = 1.0（全速）
//     - 在 500m ± sweepMargin 处平滑过渡（线性插值，避免跳变）
//
// 输入: leg 坐标数组 + 站台/里程碑坐标列表
// 输出: totalDuration + speedProfile（距离→倍率→时间片），供 moveAlongLeg 使用
//
// 修改映射:
//   speedProfile: 每个段的 [segStartDist, segEndDist, segTime] 三元组
//   totalDuration: 整个 leg 的总时长 (ms)
//   每帧: 根据 totalElapsed / totalDuration 在 segTime 表中二分查找当前 dist
// ============================================================

import * as L from "leaflet";

// ── 1. Types ─────────────────────────────────────────────────

/** 速度分布参数 */
export interface SpeedProfileOptions {
  /** 基准速度（米/秒），默认 60 */
  baseSpeed?: number;
  /** 站台影响半径（米），默认 500 */
  platformRangeMeters?: number;
  /** 平滑过渡边距（米），默认 100。在 range ± 此值内线性插值 */
  sweepMargin?: number;
  /** 站台范围内的目标速度倍率，默认 1/3 */
  slowMultiplier?: number;
  /** 基础时长倍数（整体缩放），默认 1.0 */
  durationScale?: number;
}

/** 速度分布计算结果 */
export interface SpeedProfile {
  /** 预计算总时长 (ms) */
  totalDuration: number;
  /** 总距离 (米) */
  totalDistance: number;
  /**
   * 预计算段表: 每个坐标段 (coords[i-1] → coords[i]) 的累积数据
   *   - cumDist: 到该段结束位置的累积距离
   *   - cumTime: 到该段结束位置的累积时间 (ms)
   *   - segDist: 该段长度 (米)
   *   - segTime: 该段时间 (ms)
   *   - avgMultiplier: 该段平均速度倍率
   */
  segments: ProfileSegment[];
}

export interface ProfileSegment {
  cumDist: number;
  cumTime: number;
  segDist: number;
  segTime: number;
  avgMultiplier: number;
}

// ── 2. Core: 预计算速度分布 ──────────────────────────────────

/**
 * 为一条 leg 预计算速度分布。
 *
 * @param legCoords - leg 的坐标序列 (LatLng[])
 * @param slowCenters - 放慢中心的坐标列表（站台位置、停靠点位置等）
 * @param opts - 可调参数
 */
export function computeSpeedProfile(
  legCoords: L.LatLng[],
  slowCenters: L.LatLng[],
  opts: SpeedProfileOptions = {},
): SpeedProfile {
  const baseSpeed = opts.baseSpeed ?? 60;
  const range = opts.platformRangeMeters ?? 500;
  const sweep = opts.sweepMargin ?? 100;
  const slowMult = opts.slowMultiplier ?? 1 / 3;

  if (legCoords.length < 2) {
    return {
      totalDuration: 0,
      totalDistance: 0,
      segments: [],
    };
  }

  // Step 1: 对每个坐标点, 计算到最近放慢中心的距离 → 计算 speedMultiplier
  const pointMultipliers: number[] = [];
  for (const pt of legCoords) {
    let minDist = Infinity;
    for (const sc of slowCenters) {
      const d = pt.distanceTo(sc);
      if (d < minDist) minDist = d;
    }
    const mult = smoothMultiplier(minDist, range, sweep, slowMult);
    pointMultipliers.push(mult);
  }

  // Step 2: 逐段累加距离和时间
  const segments: ProfileSegment[] = [];
  let cumDist = 0;
  let cumTime = 0;

  for (let i = 1; i < legCoords.length; i++) {
    const segDist = legCoords[i - 1].distanceTo(legCoords[i]);
    // 段平均倍率 = 两端点的平均
    const avgMult = (pointMultipliers[i - 1] + pointMultipliers[i]) / 2;
    const effectiveSpeed = baseSpeed * avgMult;
    const segTime = effectiveSpeed > 0 ? (segDist / effectiveSpeed) * 1000 : 0; // ms

    cumDist += segDist;
    cumTime += segTime;

    segments.push({
      cumDist,
      cumTime,
      segDist,
      segTime,
      avgMultiplier: avgMult,
    });
  }

  // Normalize: 总时长限制与 constantSpeedDuration 一致 [800, 7000]ms,
  // 但保留内部段的相对速度差异.
  let normalizedDuration = constantSpeedDuration(cumDist, baseSpeed);
  if (normalizedDuration < cumTime) {
    // Profile 算出的时间比恒定速度长 → 等比压缩
    const scale = normalizedDuration / cumTime;
    cumTime = 0;
    for (const seg of segments) {
      seg.segTime *= scale;
      cumTime += seg.segTime;
      seg.cumTime = cumTime;
    }
  } else {
    // Profile 算出的时间比恒定速度短 → 等比拉伸
    if (cumTime > 0) {
      const scale = normalizedDuration / cumTime;
      cumTime = 0;
      for (const seg of segments) {
        seg.segTime *= scale;
        cumTime += seg.segTime;
        seg.cumTime = cumTime;
      }
    } else {
      normalizedDuration = 800;
    }
  }

  return {
    totalDuration: normalizedDuration,
    totalDistance: cumDist,
    segments,
  };
}

// ── 3. 动画帮助函数 ──────────────────────────────────────────

/**
 * 根据累积时间 elapsedMs 在预计算速度分布中查找当前位置距离 (cumDist).
 *
 * @returns { currentDist, currentLatLng, currentTraveledCoords }
 */
export function sampleSpeedProfile(
  elapsedMs: number,
  profile: SpeedProfile,
  legCoords: L.LatLng[],
): {
  currentDist: number;
  currentLatLng: L.LatLng;
  traveledCoords: L.LatLng[];
} {
  const { segments, totalDuration, totalDistance } = profile;

  // edge case: 还没开始
  if (elapsedMs <= 0 || segments.length === 0) {
    return {
      currentDist: 0,
      currentLatLng: legCoords[0],
      traveledCoords: [legCoords[0]],
    };
  }

  // edge case: 已经走完
  if (elapsedMs >= totalDuration) {
    return {
      currentDist: totalDistance,
      currentLatLng: legCoords[legCoords.length - 1],
      traveledCoords: [...legCoords],
    };
  }

  // Step 1: 在 segments 中二分查找 elapsedMs 对应的段
  let segIdx = 0;
  // 线性查找（段数通常很少，< 1000，二分不必要）
  for (let i = 0; i < segments.length; i++) {
    if (elapsedMs <= segments[i].cumTime) {
      segIdx = i;
      break;
    }
  }

  const seg = segments[segIdx];
  const segStartTime = segIdx === 0 ? 0 : segments[segIdx - 1].cumTime;
  const segStartDist = segIdx === 0 ? 0 : segments[segIdx - 1].cumDist;

  // Step 2: 在段内插值
  const segElapsed = elapsedMs - segStartTime;
  const segT = seg.segTime > 0 ? Math.min(1, segElapsed / seg.segTime) : 0;
  const currentDist = segStartDist + segT * seg.segDist;

  // Step 3: 计算当前 LatLng
  const currentLatLng = latLngAtDistance(legCoords, currentDist);

  // Step 4: 计算已走过的坐标
  const traveled: L.LatLng[] = [legCoords[0]];
  let distAcc = 0;
  for (let i = 1; i < legCoords.length; i++) {
    const segLen = legCoords[i - 1].distanceTo(legCoords[i]);
    if (distAcc + segLen < currentDist) {
      traveled.push(legCoords[i]);
      distAcc += segLen;
    } else {
      traveled.push(currentLatLng);
      break;
    }
  }

  return { currentDist, currentLatLng, traveledCoords: traveled };
}

// ── 4. 工具函数 ─────────────────────────────────────────────

/**
 * 计算平滑过渡的速度倍率
 *
 * 当 dist ≤ range - sweep: mult = slowMult
 * 当 dist ≥ range + sweep: mult = 1.0
 * 中间: 线性插值 smoothstep
 */
function smoothMultiplier(
  dist: number,
  range: number,
  sweep: number,
  slowMult: number,
): number {
  const inner = range - sweep;
  const outer = range + sweep;

  if (dist <= inner) return slowMult;
  if (dist >= outer) return 1.0;

  // 线性插值
  const t = (dist - inner) / (2 * sweep);
  return slowMult + (1.0 - slowMult) * t;
}

/**
 * 在坐标数组中按累积距离查找 LatLng.
 * 与 map-view.ts:getLatLngAtDistance 一致。
 */
export function latLngAtDistance(coords: L.LatLng[], d: number): L.LatLng {
  if (d <= 0) return coords[0];
  let cumDist = 0;
  for (let i = 1; i < coords.length; i++) {
    const segLen = coords[i - 1].distanceTo(coords[i]);
    if (cumDist + segLen >= d) {
      const segT = segLen > 0 ? (d - cumDist) / segLen : 0;
      return L.latLng(
        coords[i - 1].lat + (coords[i].lat - coords[i - 1].lat) * segT,
        coords[i - 1].lng + (coords[i].lng - coords[i - 1].lng) * segT,
      );
    }
    cumDist += segLen;
  }
  return coords[coords.length - 1];
}

// ── 5. Legacy 兼容: 无速度分布时的恒定速度计算 ───────────────

/**
 * 计算恒定速度下的 duration（无站台放慢，向后兼容）。
 */
export function constantSpeedDuration(
  totalDist: number,
  baseSpeed?: number,
): number {
  const s = baseSpeed ?? 60;
  return Math.max(800, Math.min(7000, (totalDist / s) * 1000));
}
