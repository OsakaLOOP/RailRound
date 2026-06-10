// geometry-math.ts — 地理与几何计算辅助函数

export type Position = [number, number]; // [lng, lat]

const R_EARTH = 6371000; // 地球半径 (米)

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * 将经纬度转换为以 refLat 为基准的本地平面直角坐标系 (单位: 米)
 */
export function toLocalMeters(lng: number, lat: number, refLat: number): { x: number; y: number } {
  const radLat = toRad(refLat);
  const x = lng * (Math.PI / 180) * R_EARTH * Math.cos(radLat);
  const y = lat * (Math.PI / 180) * R_EARTH;
  return { x, y };
}

/**
 * 计算两点之间的球面距离 (米)
 */
export function haversineDistance(a: Position, b: Position): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aH =
    sinDLat * sinDLat +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinDLng * sinDLng;
  return 2 * R_EARTH * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH));
}

/**
 * 计算点 P 到线段 AB 的最近距离和投影比例 t
 */
export function projectPointToSegment(
  p: Position,
  a: Position,
  b: Position,
): { distance: number; t: number; snapped: Position } {
  const refLat = a[1];
  const pM = toLocalMeters(p[0], p[1], refLat);
  const aM = toLocalMeters(a[0], a[1], refLat);
  const bM = toLocalMeters(b[0], b[1], refLat);

  const abX = bM.x - aM.x;
  const abY = bM.y - aM.y;
  const abLen2 = abX * abX + abY * abY;

  if (abLen2 === 0) {
    return { distance: haversineDistance(p, a), t: 0, snapped: a };
  }

  const apX = pM.x - aM.x;
  const apY = pM.y - aM.y;

  let t = (apX * abX + apY * abY) / abLen2;
  t = Math.max(0, Math.min(1, t));

  const snappedLng = a[0] + (b[0] - a[0]) * t;
  const snappedLat = a[1] + (b[1] - a[1]) * t;
  const snapped: Position = [snappedLng, snappedLat];

  return {
    distance: haversineDistance(p, snapped),
    t,
    snapped,
  };
}

/**
 * 计算点 P 到折线 (Polyline) 的最近距离和对应的全局投影比例 (0 ~ 1)
 */
export function projectPointToPolyline(
  p: Position,
  polyline: Position[],
): { distance: number; measure: number; snapped: Position; segmentIndex: number } {
  if (polyline.length < 2) {
    return { distance: haversineDistance(p, polyline[0]), measure: 0, snapped: polyline[0], segmentIndex: 0 };
  }

  // 1. 计算折线各段长度和总长度
  const segLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = haversineDistance(polyline[i], polyline[i + 1]);
    segLengths.push(d);
    totalLength += d;
  }

  let minDistance = Infinity;
  let bestMeasure = 0;
  let bestSnapped = polyline[0];
  let bestSegIndex = 0;

  let lengthBeforeSeg = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segLen = segLengths[i];
    const { distance, t, snapped } = projectPointToSegment(p, a, b);

    if (distance < minDistance) {
      minDistance = distance;
      bestSnapped = snapped;
      bestSegIndex = i;
      const progressInSeg = t * segLen;
      bestMeasure = totalLength > 0 ? (lengthBeforeSeg + progressInSeg) / totalLength : 0;
    }
    lengthBeforeSeg += segLen;
  }

  return {
    distance: minDistance,
    measure: bestMeasure,
    snapped: bestSnapped,
    segmentIndex: bestSegIndex,
  };
}

/**
 * 计算两条边在交点处的夹角 (偏转角 0 ~ 180)
 * 提取边靠近交点处的朝向向量
 */
export function calculateTurnAngle(
  coordsA: Position[],
  coordsB: Position[],
  sharedNodeCoord: Position,
): number {
  if (coordsA.length < 2 || coordsB.length < 2) return 180;

  // 寻找 A 中靠近交点的向量 (指向交点)
  // Find the vector in A close to the intersection (pointing to it)
  const isAStartShared = haversineDistance(coordsA[0], sharedNodeCoord) < 0.1;
  let vecAStart = isAStartShared ? coordsA[1] : coordsA[coordsA.length - 2];
  if (isAStartShared) {
    for (let i = 1; i < coordsA.length; i++) {
      if (haversineDistance(coordsA[i], sharedNodeCoord) > 0.1) {
        vecAStart = coordsA[i];
        break;
      }
    }
  } else {
    for (let i = coordsA.length - 2; i >= 0; i--) {
      if (haversineDistance(coordsA[i], sharedNodeCoord) > 0.1) {
        vecAStart = coordsA[i];
        break;
      }
    }
  }
  const vecAEnd = sharedNodeCoord;

  // 寻找 B 中靠近交点的向量 (离开交点)
  // Find the vector in B close to the intersection (pointing away from it)
  const isBStartShared = haversineDistance(coordsB[0], sharedNodeCoord) < 0.1;
  const vecBStart = sharedNodeCoord;
  let vecBEnd = isBStartShared ? coordsB[1] : coordsB[coordsB.length - 2];
  if (isBStartShared) {
    for (let i = 1; i < coordsB.length; i++) {
      if (haversineDistance(coordsB[i], sharedNodeCoord) > 0.1) {
        vecBEnd = coordsB[i];
        break;
      }
    }
  } else {
    for (let i = coordsB.length - 2; i >= 0; i--) {
      if (haversineDistance(coordsB[i], sharedNodeCoord) > 0.1) {
        vecBEnd = coordsB[i];
        break;
      }
    }
  }

  const refLat = sharedNodeCoord[1];
  const a1 = toLocalMeters(vecAStart[0], vecAStart[1], refLat);
  const a2 = toLocalMeters(vecAEnd[0], vecAEnd[1], refLat);
  const b1 = toLocalMeters(vecBStart[0], vecBStart[1], refLat);
  const b2 = toLocalMeters(vecBEnd[0], vecBEnd[1], refLat);

  // 向量 A (指向交点): a2 - a1
  const dxA = a2.x - a1.x;
  const dyA = a2.y - a1.y;

  // 向量 B (离开交点): b2 - b1
  const dxB = b2.x - b1.x;
  const dyB = b2.y - b1.y;

  const lenA = Math.sqrt(dxA * dxA + dyA * dyA);
  const lenB = Math.sqrt(dxB * dxB + dyB * dyB);

  if (lenA === 0 || lenB === 0) return 180;

  const dot = dxA * dxB + dyA * dyB;
  const cosTheta = dot / (lenA * lenB);
  const clamped = Math.max(-1, Math.min(1, cosTheta));
  return toDeg(Math.acos(clamped));
}
