// ============================================================
// PoC: 双站布局 — 站 A (2面4線 上下退避型) + 站间联络 + 站 B (2面3線 国铁型可换向)
//
// 用于验证寻径算法的 4 种情形:
//   纯上 PA→PC, 纯下 PD→PB, 上→下换向 PA→PB, 下→上换向 PD→PA
//
// 几何方向约定 (严格关系到 side 字段):
//   - 上行 (up_main): 沿经度增加方向 (西→东), edge.from = 西端, edge.to = 东端
//   - 下行 (down_main): 沿经度减少方向 (东→西), edge.from = 东端, edge.to = 西端
//   - 沿 edge.from → edge.to 方向看, 北 = left, 南 = right
//
// 站 A 布局 (北→南, 经度 139.6980~139.7020):
//   1番A (上り本線, forward, up_main)  西━━━━━━━━━━東
//          PA 北面贴车 (岛式)
//   2番A (上り副本, forward, up_main)  西━━━━━━━━━━東
//          PA 南面贴车
//   (无股道间隔, PA / PB 之间)
//   3番A (下り副本, forward, down_main) 東━━━━━━━━━━西
//          PB 北面贴车 (岛式)
//   4番A (下り本線, forward, down_main) 東━━━━━━━━━━西
//          PB 南面贴车
//
// 站 B 布局 (北→南, 经度 139.7060~139.7100):
//   1番B (上り本線, forward, up_main)  西━━━━━━━━━━東
//          PC 北面贴车 (侧式) → PC 在 1番B 南 = right
//   2番B (中線, BOTH, reversible, ["stopping","turnback"])  几何 西→東 (任选)
//          PD 北面贴车 (岛式)
//   3番B (下り本線, forward, down_main) 東━━━━━━━━━━西
//          PD 南面贴车
//
// 联络段 (经度 139.7020~139.7060):
//   up_link  (forward, up_main):   1番A 东端 → 1番B 西端
//   down_link (forward, down_main): 3番B 西端 → 4番A 东端
//
// 咽喉 connector (traversal=both, 不带 directionRole):
//   站 A 西/东咽喉: 1-2, 3-4
//   站 B 西/东咽喉: 1-2, 2-3
// ============================================================

import type { GeoJSONPosition } from "../rail-graph-v1/geojson";
import type { AnnotatedFeatureCollection } from "../rail-graph-v1/annotation.types";
import type {
  PlatformTrackBindingInput,
  StoppingPointInput,
} from "../rail-graph-v1/editing.types";

// ---- 坐标常量 ----

const LON_A_WEST = 139.6980;
const LON_A_EAST = 139.7020;
const LON_B_WEST = 139.7060;
const LON_B_EAST = 139.7100;
const LON_A_WEST_EXT = 139.6960;   // 站 A 西端外延
const LON_B_EAST_EXT = 139.7120;   // 站 B 东端外延

const LAT_BASE = 35.6900;
const TRACK_SPACING = 0.0002;

// 站 A 四条线纬度 (北→南: 1/2/3/4 番)
const LAT_A1 = LAT_BASE + TRACK_SPACING * 1.5;
const LAT_A2 = LAT_BASE + TRACK_SPACING * 0.5;
const LAT_A3 = LAT_BASE - TRACK_SPACING * 0.5;
const LAT_A4 = LAT_BASE - TRACK_SPACING * 1.5;

// 站 B 三条线纬度 (北→南: 1/2/3 番)
const LAT_B1 = LAT_BASE + TRACK_SPACING * 1.0;
const LAT_B2 = LAT_BASE;
const LAT_B3 = LAT_BASE - TRACK_SPACING * 1.0;

const LAT_PA = (LAT_A1 + LAT_A2) / 2;
const LAT_PB = (LAT_A3 + LAT_A4) / 2;
// PC 是侧式 (单面贴车), 让站台体南移到 1番B 与 2番B 之间偏北侧, 视觉与 1番B 错开,
// 同时保留 "侧式贴 1番B" 的语义 (binding 显式声明).
const LAT_PC = LAT_B1 - TRACK_SPACING * 0.45;
const LAT_PD = (LAT_B2 + LAT_B3) / 2;

const HALF_PW = 0.00005;

// ---- 端点节点 ----

const nodeA1West: GeoJSONPosition = [LON_A_WEST, LAT_A1];
const nodeA1East: GeoJSONPosition = [LON_A_EAST, LAT_A1];
const nodeA2West: GeoJSONPosition = [LON_A_WEST, LAT_A2];
const nodeA2East: GeoJSONPosition = [LON_A_EAST, LAT_A2];
const nodeA3West: GeoJSONPosition = [LON_A_WEST, LAT_A3];
const nodeA3East: GeoJSONPosition = [LON_A_EAST, LAT_A3];
const nodeA4West: GeoJSONPosition = [LON_A_WEST, LAT_A4];
const nodeA4East: GeoJSONPosition = [LON_A_EAST, LAT_A4];

const nodeB1West: GeoJSONPosition = [LON_B_WEST, LAT_B1];
const nodeB1East: GeoJSONPosition = [LON_B_EAST, LAT_B1];
const nodeB2West: GeoJSONPosition = [LON_B_WEST, LAT_B2];
const nodeB2East: GeoJSONPosition = [LON_B_EAST, LAT_B2];
const nodeB3West: GeoJSONPosition = [LON_B_WEST, LAT_B3];
const nodeB3East: GeoJSONPosition = [LON_B_EAST, LAT_B3];

// 延伸段远端 (开放端点)
const nodeA1WestExt: GeoJSONPosition = [LON_A_WEST_EXT, LAT_A1];
const nodeA4WestExt: GeoJSONPosition = [LON_A_WEST_EXT, LAT_A4];
const nodeB1EastExt: GeoJSONPosition = [LON_B_EAST_EXT, LAT_B1];
const nodeB3EastExt: GeoJSONPosition = [LON_B_EAST_EXT, LAT_B3];

// ---- ID 常量 ----

const STATION_A = "demo:station:A";
const STATION_B = "demo:station:B";
const PLATFORM_A = "demo:platform:A";
const PLATFORM_B = "demo:platform:B";
const PLATFORM_C = "demo:platform:C";
const PLATFORM_D = "demo:platform:D";

const TRACK_A1 = "demo:track:A1";
const TRACK_A2 = "demo:track:A2";
const TRACK_A3 = "demo:track:A3";
const TRACK_A4 = "demo:track:A4";
const TRACK_B1 = "demo:track:B1";
const TRACK_B2 = "demo:track:B2";
const TRACK_B3 = "demo:track:B3";
const UP_LINK = "demo:track:up-link";
const DOWN_LINK = "demo:track:down-link";
const A1_WEST_EXT = "demo:track:A1-west-ext";
const A4_WEST_EXT = "demo:track:A4-west-ext";
const B1_EAST_EXT = "demo:track:B1-east-ext";
const B3_EAST_EXT = "demo:track:B3-east-ext";
const SIG_A1_HOME = "demo:signal:A1-west-home";
const SIG_A4_START = "demo:signal:A4-west-start";
const SIG_B1_START = "demo:signal:B1-east-start";
const SIG_B3_HOME = "demo:signal:B3-east-home";

function slug(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `${value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "id"}-${hash.toString(16)}`;
}

function buildEdgeId(annotationId: string, lineIndex = 0): string {
  return `manual:edge:${slug(`${annotationId}:${lineIndex}`)}`;
}

// 与 app.ts 中 ENDPOINT_PRECISION + coordinateKey + nodeIdForCoordinate 保持一致
const ENDPOINT_PRECISION = 6;
function coordinateKey(coord: GeoJSONPosition): string {
  return `${coord[0].toFixed(ENDPOINT_PRECISION)},${coord[1].toFixed(ENDPOINT_PRECISION)}`;
}
function buildNodeId(coord: GeoJSONPosition): string {
  return `manual:node:${slug(coordinateKey(coord))}`;
}

// ---- GeoJSON 构造 ----

export function buildTwoStationGeoJson(): AnnotatedFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      // ── 车站 ──
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [(LON_A_WEST + LON_A_EAST) / 2, LAT_BASE] },
        properties: {
          name: "站 A (2面4線 上下退避型)",
          railGraph: {
            kind: "station_point",
            schemaVersion: "rail-graph-v1",
            id: STATION_A,
            source: "demo",
            station: { name: "站 A" },
          },
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [(LON_B_WEST + LON_B_EAST) / 2, LAT_BASE] },
        properties: {
          name: "站 B (2面3線 国铁型可换向)",
          railGraph: {
            kind: "station_point",
            schemaVersion: "rail-graph-v1",
            id: STATION_B,
            source: "demo",
            station: { name: "站 B" },
          },
        },
      },

      // ── Platform A (站 A 北岛, 1番A 与 2番A 之间) ──
      buildPlatformFeature(PLATFORM_A, STATION_A, "PA", 1, "island", LON_A_WEST, LON_A_EAST, LAT_PA),
      // ── Platform B (站 A 南岛, 3番A 与 4番A 之间) ──
      buildPlatformFeature(PLATFORM_B, STATION_A, "PB", 2, "island", LON_A_WEST, LON_A_EAST, LAT_PB),
      // ── Platform C (站 B 北侧, 1番B 南) ──
      buildPlatformFeature(PLATFORM_C, STATION_B, "PC", 1, "side", LON_B_WEST, LON_B_EAST, LAT_PC),
      // ── Platform D (站 B 中岛, 2番B 与 3番B 之间) ──
      buildPlatformFeature(PLATFORM_D, STATION_B, "PD", 2, "island", LON_B_WEST, LON_B_EAST, LAT_PD),

      // ── 站 A 主轨 ──
      buildMainTrack(TRACK_A1, "1番A", "1A", "up", "forward", nodeA1West, nodeA1East),
      buildMainTrack(TRACK_A2, "2番A", "2A", "up", "forward", nodeA2West, nodeA2East, "siding"),
      buildMainTrack(TRACK_A3, "3番A", "3A", "down", "forward", nodeA3East, nodeA3West, "siding"),
      buildMainTrack(TRACK_A4, "4番A", "4A", "down", "forward", nodeA4East, nodeA4West),

      // ── 站间联络 ──
      buildMainTrack(UP_LINK, "上行联络", "UL", "up", "forward", nodeA1East, nodeB1West),
      buildMainTrack(DOWN_LINK, "下行联络", "DL", "down", "forward", nodeB3West, nodeA4East),

      // ── 站 B 主轨 ──
      buildMainTrack(TRACK_B1, "1番B", "1B", "up", "forward", nodeB1West, nodeB1East),
      // 2番B: 可换向中線, traversal=both, directionRole=reversible, 含 turnback functionalUse
      buildTrackWithFlags(
        TRACK_B2,
        "2番B (中線/可换向)",
        "2B",
        nodeB2West,
        nodeB2East,
        {
          role: "platform",
          traversal: "both",
          physicalKind: "siding",
          functionalUse: ["stopping", "turnback"],
          directionRole: "reversible",
        },
      ),
      buildMainTrack(TRACK_B3, "3番B", "3B", "down", "forward", nodeB3East, nodeB3West),

      // ── 延伸段 (道岔外, 信号机放在这里) ──
      buildMainTrack(A1_WEST_EXT, "1番A西延", "1Ae", "up", "forward", nodeA1WestExt, nodeA1West),
      buildMainTrack(A4_WEST_EXT, "4番A西延", "4Ae", "down", "forward", nodeA4West, nodeA4WestExt),
      buildMainTrack(B1_EAST_EXT, "1番B东延", "1Be", "up", "forward", nodeB1East, nodeB1EastExt),
      buildMainTrack(B3_EAST_EXT, "3番B东延", "3Be", "down", "forward", nodeB3EastExt, nodeB3East),

      // ── 咽喉 connector ──
      buildConnector("demo:track:A-west-1-2", "A西咽-1-2", nodeA1West, nodeA2West),
      buildConnector("demo:track:A-west-3-4", "A西咽-3-4", nodeA3West, nodeA4West),
      buildConnector("demo:track:A-east-1-2", "A东咽-1-2", nodeA1East, nodeA2East),
      buildConnector("demo:track:A-east-3-4", "A东咽-3-4", nodeA3East, nodeA4East),
      buildConnector("demo:track:B-west-1-2", "B西咽-1-2", nodeB1West, nodeB2West),
      buildConnector("demo:track:B-west-2-3", "B西咽-2-3", nodeB2West, nodeB3West),
      buildConnector("demo:track:B-east-1-2", "B东咽-1-2", nodeB1East, nodeB2East),
      buildConnector("demo:track:B-east-2-3", "B东咽-2-3", nodeB2East, nodeB3East),

      // ── 信号机 (signal_point, 不参与寻径, 仅可视) ──
      buildSignalFeature(SIG_A1_HOME, "A1西进站", A1_WEST_EXT, 0.5, "forward"),
      buildSignalFeature(SIG_A4_START, "A4西出站", A4_WEST_EXT, 0.5, "forward"),
      buildSignalFeature(SIG_B1_START, "B1东出站", B1_EAST_EXT, 0.5, "forward"),
      buildSignalFeature(SIG_B3_HOME, "B3东进站", B3_EAST_EXT, 0.5, "forward"),
    ],
  };
}

function buildPlatformFeature(
  id: string,
  stationRef: string,
  name: string,
  number: number,
  type: "island" | "side" | "bay",
  lonWest: number,
  lonEast: number,
  latCenter: number,
): AnnotatedFeatureCollection["features"][number] {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [lonWest + 0.0005, latCenter - HALF_PW],
        [lonEast - 0.0005, latCenter - HALF_PW],
        [lonEast - 0.0005, latCenter + HALF_PW],
        [lonWest + 0.0005, latCenter + HALF_PW],
        [lonWest + 0.0005, latCenter - HALF_PW],
      ]],
    },
    properties: {
      name,
      railGraph: {
        kind: "platform_area",
        schemaVersion: "rail-graph-v1",
        id,
        source: "demo",
        platform: { stationRef, name, number, type },
      },
    },
  };
}

function buildMainTrack(
  id: string,
  name: string,
  trackCode: string,
  directionRole: "up" | "down",
  traversal: "forward" | "both",
  from: GeoJSONPosition,
  to: GeoJSONPosition,
  physicalKind: "main" | "siding" = "main",
): AnnotatedFeatureCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [from, to] },
    properties: {
      name,
      railGraph: {
        kind: "track_geometry",
        schemaVersion: "rail-graph-v1",
        id,
        source: "demo",
        track: {
          role: physicalKind === "siding" ? "platform" : "main",
          traversal,
          name,
          trackCode,
          physicalKind,
          functionalUse: ["through", "stopping"],
          directionRole,
        },
      },
    },
  };
}

function buildTrackWithFlags(
  id: string,
  name: string,
  trackCode: string,
  from: GeoJSONPosition,
  to: GeoJSONPosition,
  flags: {
    role: "main" | "platform" | "passing" | "connector" | "storage" | "yard";
    traversal: "forward" | "both";
    physicalKind: "main" | "siding" | "yard" | "lead" | "safety";
    functionalUse: ("through" | "stopping" | "passing" | "turnback" | "storage")[];
    directionRole?: "up" | "down" | "bidirectional" | "reversible";
  },
): AnnotatedFeatureCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [from, to] },
    properties: {
      name,
      railGraph: {
        kind: "track_geometry",
        schemaVersion: "rail-graph-v1",
        id,
        source: "demo",
        track: { name, trackCode, ...flags },
      },
    },
  };
}

function buildConnector(
  id: string,
  name: string,
  from: GeoJSONPosition,
  to: GeoJSONPosition,
): AnnotatedFeatureCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [from, to] },
    properties: {
      name,
      railGraph: {
        kind: "track_geometry",
        schemaVersion: "rail-graph-v1",
        id,
        source: "demo",
        track: {
          role: "connector",
          traversal: "both",
          name,
          physicalKind: "main",
          functionalUse: ["through"],
          directionRole: "bidirectional",
        },
      },
    },
  };
}

function buildSignalFeature(
  id: string,
  name: string,
  edgeRef: string,
  measure: number,
  facing: "forward" | "reverse" | "both",
): AnnotatedFeatureCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },  // dummy geometry, edgeRef+measure 为准
    properties: {
      name,
      railGraph: {
        kind: "signal_point",
        schemaVersion: "rail-graph-v1",
        id,
        source: "demo",
        signal: { edgeRef, measure, facing, name },
      },
    },
  };
}

// ---- Binding Plan ----
//
// side 按 edge.from → edge.to 方向计算:
//   - 上行 (西→东): 北=left, 南=right
//   - 下行 (东→西): 北=right, 南=left
//   - 2番B 几何 西→东: 北=left, 南=right
//
// PA (岛, 站 A): 北贴 1番A, 南贴 2番A → PA 在 1番A 南 (right), 在 2番A 北 (left)
// PB (岛, 站 A): 北贴 3番A, 南贴 4番A → 3番A 东→西: PB 在 3番A 南 (left), PB 在 4番A 北 (right)
// PC (侧, 站 B): 北贴 1番B → PC 在 1番B 南 (right)
// PD (岛, 站 B): 北贴 2番B, 南贴 3番B → PD 在 2番B 南 (right), PD 在 3番B 北 (right, 因为下行)

export const BINDING_PLAN: PlatformTrackBindingInput[] = [
  { stationRef: STATION_A, platformRef: PLATFORM_A, edgeRef: buildEdgeId(TRACK_A1), side: "right", servingDirection: "up" },
  { stationRef: STATION_A, platformRef: PLATFORM_A, edgeRef: buildEdgeId(TRACK_A2), side: "left", servingDirection: "up" },
  { stationRef: STATION_A, platformRef: PLATFORM_B, edgeRef: buildEdgeId(TRACK_A3), side: "left", servingDirection: "down" },
  { stationRef: STATION_A, platformRef: PLATFORM_B, edgeRef: buildEdgeId(TRACK_A4), side: "right", servingDirection: "down" },
  { stationRef: STATION_B, platformRef: PLATFORM_C, edgeRef: buildEdgeId(TRACK_B1), side: "right", servingDirection: "up" },
  // 2番B 是中线可换向, servingDirection 省略 (上下行都可服务)
  { stationRef: STATION_B, platformRef: PLATFORM_D, edgeRef: buildEdgeId(TRACK_B2), side: "right" },
  { stationRef: STATION_B, platformRef: PLATFORM_D, edgeRef: buildEdgeId(TRACK_B3), side: "right", servingDirection: "down" },
];

// ---- Stop Plan ----
//
// 每个 platform-served edge 中部 (measure=0.5) 一个停车标。
// 2番B 上 PD 的 stop direction=both, 因为该 edge 既可用作上行停车也可下行停车 (换向场景)。

export const STOP_PLAN: StoppingPointInput[] = [
  { stationRef: STATION_A, platformRef: PLATFORM_A, edgeRef: buildEdgeId(TRACK_A1), direction: "up", measure: 0.5 },
  { stationRef: STATION_A, platformRef: PLATFORM_A, edgeRef: buildEdgeId(TRACK_A2), direction: "up", measure: 0.5 },
  { stationRef: STATION_A, platformRef: PLATFORM_B, edgeRef: buildEdgeId(TRACK_A3), direction: "down", measure: 0.5 },
  { stationRef: STATION_A, platformRef: PLATFORM_B, edgeRef: buildEdgeId(TRACK_A4), direction: "down", measure: 0.5 },
  { stationRef: STATION_B, platformRef: PLATFORM_C, edgeRef: buildEdgeId(TRACK_B1), direction: "up", measure: 0.5 },
  { stationRef: STATION_B, platformRef: PLATFORM_D, edgeRef: buildEdgeId(TRACK_B2), direction: "both", measure: 0.5 },
  { stationRef: STATION_B, platformRef: PLATFORM_D, edgeRef: buildEdgeId(TRACK_B3), direction: "down", measure: 0.5 },
];

// ---- Exported IDs for pathfinding scenarios ----

export const TwoStationRefs = {
  STATION_A,
  STATION_B,
  PLATFORM_A,
  PLATFORM_B,
  PLATFORM_C,
  PLATFORM_D,
  TRACK_A1: buildEdgeId(TRACK_A1),
  TRACK_A2: buildEdgeId(TRACK_A2),
  TRACK_A3: buildEdgeId(TRACK_A3),
  TRACK_A4: buildEdgeId(TRACK_A4),
  TRACK_B1: buildEdgeId(TRACK_B1),
  TRACK_B2: buildEdgeId(TRACK_B2),
  TRACK_B3: buildEdgeId(TRACK_B3),
  UP_LINK: buildEdgeId(UP_LINK),
  DOWN_LINK: buildEdgeId(DOWN_LINK),
  A1_WEST_EXT: buildEdgeId(A1_WEST_EXT),
  A4_WEST_EXT: buildEdgeId(A4_WEST_EXT),
  B1_EAST_EXT: buildEdgeId(B1_EAST_EXT),
  B3_EAST_EXT: buildEdgeId(B3_EAST_EXT),
  SIG_A1_HOME,
  SIG_A4_START,
  SIG_B1_START,
  SIG_B3_HOME,
  // 4 个延伸段远端开放节点 (主线尽头) — 寻径的"线路入口/出口"
  NODE_A1_WEST_EXT: buildNodeId(nodeA1WestExt),  // 上行起 (西远)
  NODE_A4_WEST_EXT: buildNodeId(nodeA4WestExt),  // 下行终 (西远)
  NODE_B1_EAST_EXT: buildNodeId(nodeB1EastExt),  // 上行终 (东远)
  NODE_B3_EAST_EXT: buildNodeId(nodeB3EastExt),  // 下行起 (东远)
} as const;

if (typeof window !== "undefined") {
  Object.assign(window, {
    pocTwoStation: {
      buildGeoJson: buildTwoStationGeoJson,
      bindingPlan: BINDING_PLAN,
      stopPlan: STOP_PLAN,
      refs: TwoStationRefs,
    },
  });
}
