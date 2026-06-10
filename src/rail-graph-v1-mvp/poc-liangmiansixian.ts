// ============================================================
// PoC: 复线国铁型两面四線 (二面四線・上下退避型)
//      — 数据结构与完整操作绑定流程
// ============================================================
//
// 站型示意 (北→南, 沿 from→to 方向 = 经度增加 = 西→东):
//
//   西咽喉                                                    东咽喉
//
//   1番線 (上り本線, 通過/到発)  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
//                                ╲                          ╱
//                                ┃ Platform A 北侧贴车      ┃
//                                ┃   (PlatformA, 岛式)      ┃
//                                ┃ Platform A 南侧贴车      ┃
//                                ╱                          ╲
//   2番線 (上り副本線, 到発)     ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
//                              (无站台间隔)
//   3番線 (下り副本線, 到発)     ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━●  ← 几何方向: 东→西
//                                ╲                          ╱
//                                ┃ Platform B 北侧贴车      ┃
//                                ┃   (PlatformB, 岛式)      ┃
//                                ┃ Platform B 南侧贴车      ┃
//                                ╱                          ╲
//   4番線 (下り本線, 通過/到発)  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━●  ← 几何方向: 东→西
//
// 关键设计点:
// - 上行 (1番/2番) 几何方向 = 西→东 (匹配运行方向)
// - 下行 (3番/4番) 几何方向 = 东→西 (匹配运行方向)
// - PlatformTrackBinding.side 严格按 edge.from→edge.to 方向定义,
//   从而验证 side 与 servingDirection 的正交性。
// - 所有 edge 都显式声明 functionalUse 和 directionRole,
//   不依赖 binding 状态反推。
// - 4 条主线全部靠站, 排除"未绑定 = 越行线"的错误启发。
//
// 列车运用语义:
// - 上行直通快车: 1番 (本線) 通過
// - 上行待避慢车: 2番 (副本) 停車, 让 1番 快车通過
// - 下行直通快车: 4番 (本線) 通過
// - 下行待避慢车: 3番 (副本) 停車, 让 4番 快车通過
//
// ============================================================

import type { GeoJSONPosition } from "../rail-graph-v1/geojson";
import type { AnnotatedFeatureCollection } from "../rail-graph-v1/annotation.types";
import type {
  PlatformTrackBindingInput,
  StoppingPointInput,
} from "../rail-graph-v1/editing.types";

// ---- 坐标常量 ----

const LON_WEST = 139.6980;
const LON_EAST = 139.7020;
const LAT_BASE = 35.6900;
const TRACK_SPACING = 0.0002; // ~22m between adjacent tracks
const ISLAND_GAP = 0.0001; // ~11m, 岛式站台体宽度
const PLATFORM_HALF_WIDTH = ISLAND_GAP / 2;

// 4 条线的中心纬度 (北→南: 1番, 2番, 3番, 4番)
const LAT_TRACK_1 = LAT_BASE + TRACK_SPACING * 1.5;
const LAT_TRACK_2 = LAT_BASE + TRACK_SPACING * 0.5;
const LAT_TRACK_3 = LAT_BASE - TRACK_SPACING * 0.5;
const LAT_TRACK_4 = LAT_BASE - TRACK_SPACING * 1.5;

// Platform A 中心 (1番 与 2番 之间)
const LAT_PLATFORM_A = (LAT_TRACK_1 + LAT_TRACK_2) / 2;
// Platform B 中心 (3番 与 4番 之间)
const LAT_PLATFORM_B = (LAT_TRACK_3 + LAT_TRACK_4) / 2;

// 端点
const node1West: GeoJSONPosition = [LON_WEST, LAT_TRACK_1];
const node1East: GeoJSONPosition = [LON_EAST, LAT_TRACK_1];
const node2West: GeoJSONPosition = [LON_WEST, LAT_TRACK_2];
const node2East: GeoJSONPosition = [LON_EAST, LAT_TRACK_2];
const node3West: GeoJSONPosition = [LON_WEST, LAT_TRACK_3];
const node3East: GeoJSONPosition = [LON_EAST, LAT_TRACK_3];
const node4West: GeoJSONPosition = [LON_WEST, LAT_TRACK_4];
const node4East: GeoJSONPosition = [LON_EAST, LAT_TRACK_4];

// ---- ID 常量 ----

const STATION_ID = "demo:station:liangmiansixian";
const PLATFORM_A_ID = "demo:platform:A";
const PLATFORM_B_ID = "demo:platform:B";
const TRACK_1_ID = "demo:track:1ban";
const TRACK_2_ID = "demo:track:2ban";
const TRACK_3_ID = "demo:track:3ban";
const TRACK_4_ID = "demo:track:4ban";
// edge.id 由 stableId('manual','edge', `${annotation.id}:0`) 生成,
// 因此 BINDING_PLAN 中的 edgeRef 必须用 compileTopology 后的实际 id 重定向。
// 这里给出 annotation.id 作为占位, app.ts 里在调用 BINDING_PLAN 前应解析。
//
// 为简化 PoC, 我们直接复用与 app.ts 中 stableId 一致的算法,
// 在 BINDING_PLAN/STOP_PLAN 中给出最终 edge.id (见 buildEdgeId 函数)。

function slug(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "id"}-${hash.toString(16)}`;
}

function buildEdgeId(annotationId: string, lineIndex = 0): string {
  return `manual:edge:${slug(`${annotationId}:${lineIndex}`)}`;
}

// ---- GeoJSON 构造 ----

export function buildLiangMianSiXianGeoJson(): AnnotatedFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      // ── 车站点 ──
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [(LON_WEST + LON_EAST) / 2, LAT_BASE] },
        properties: {
          name: "示例两面四线站",
          railGraph: {
            kind: "station_point",
            schemaVersion: "rail-graph-v1",
            id: STATION_ID,
            source: "demo",
            station: { name: "示例两面四线站" },
          },
        },
      },

      // ── Platform A (岛式, 1番 与 2番 之间) ──
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [LON_WEST + 0.0005, LAT_PLATFORM_A - PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_PLATFORM_A - PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_PLATFORM_A + PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_PLATFORM_A + PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_PLATFORM_A - PLATFORM_HALF_WIDTH],
          ]],
        },
        properties: {
          name: "A站台",
          railGraph: {
            kind: "platform_area",
            schemaVersion: "rail-graph-v1",
            id: PLATFORM_A_ID,
            source: "demo",
            platform: {
              stationRef: STATION_ID,
              name: "A站台",
              number: 1,
              type: "island",
            },
          },
        },
      },

      // ── Platform B (岛式, 3番 与 4番 之间) ──
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [LON_WEST + 0.0005, LAT_PLATFORM_B - PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_PLATFORM_B - PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_PLATFORM_B + PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_PLATFORM_B + PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_PLATFORM_B - PLATFORM_HALF_WIDTH],
          ]],
        },
        properties: {
          name: "B站台",
          railGraph: {
            kind: "platform_area",
            schemaVersion: "rail-graph-v1",
            id: PLATFORM_B_ID,
            source: "demo",
            platform: {
              stationRef: STATION_ID,
              name: "B站台",
              number: 2,
              type: "island",
            },
          },
        },
      },

      // ── 1番線: 上り本線 (西→东) ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node1West, node1East] },
        properties: {
          name: "1番線",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: TRACK_1_ID,
            source: "demo",
            track: {
              role: "main",
              traversal: "forward",
              name: "1番線",
              trackCode: "1",
              physicalKind: "main",
              functionalUse: ["through", "stopping"],
              directionRole: "up",
            },
          },
        },
      },

      // ── 2番線: 上り副本線 (西→东) ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node2West, node2East] },
        properties: {
          name: "2番線",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: TRACK_2_ID,
            source: "demo",
            track: {
              role: "platform",
              traversal: "forward",
              name: "2番線",
              trackCode: "2",
              physicalKind: "siding",
              functionalUse: ["stopping", "passing"],
              directionRole: "up",
            },
          },
        },
      },

      // ── 3番線: 下り副本線 (东→西, 几何方向匹配运行方向) ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node3East, node3West] },
        properties: {
          name: "3番線",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: TRACK_3_ID,
            source: "demo",
            track: {
              role: "platform",
              traversal: "forward",
              name: "3番線",
              trackCode: "3",
              physicalKind: "siding",
              functionalUse: ["stopping", "passing"],
              directionRole: "down",
            },
          },
        },
      },

      // ── 4番線: 下り本線 (东→西) ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node4East, node4West] },
        properties: {
          name: "4番線",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: TRACK_4_ID,
            source: "demo",
            track: {
              role: "main",
              traversal: "forward",
              name: "4番線",
              trackCode: "4",
              physicalKind: "main",
              functionalUse: ["through", "stopping"],
              directionRole: "down",
            },
          },
        },
      },

      // ── 西咽喉 connector: 1番 ↔ 2番 ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node1West, node2West] },
        properties: {
          name: "西咽-1-2",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:west-1-2",
            source: "demo",
            track: {
              role: "connector",
              traversal: "both",
              name: "西咽-1-2",
              physicalKind: "main",
              functionalUse: ["through"],
            },
          },
        },
      },
      // ── 西咽喉 connector: 3番 ↔ 4番 ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node3West, node4West] },
        properties: {
          name: "西咽-3-4",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:west-3-4",
            source: "demo",
            track: {
              role: "connector",
              traversal: "both",
              name: "西咽-3-4",
              physicalKind: "main",
              functionalUse: ["through"],
            },
          },
        },
      },
      // ── 东咽喉 connector: 1番 ↔ 2番 ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node1East, node2East] },
        properties: {
          name: "东咽-1-2",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:east-1-2",
            source: "demo",
            track: {
              role: "connector",
              traversal: "both",
              name: "东咽-1-2",
              physicalKind: "main",
              functionalUse: ["through"],
            },
          },
        },
      },
      // ── 东咽喉 connector: 3番 ↔ 4番 ──
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [node3East, node4East] },
        properties: {
          name: "东咽-3-4",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:east-3-4",
            source: "demo",
            track: {
              role: "connector",
              traversal: "both",
              name: "东咽-3-4",
              physicalKind: "main",
              functionalUse: ["through"],
            },
          },
        },
      },
    ],
  };
}

// ---- Binding 与 Stopping Point Plan ----
//
// side 参考系: 沿 edge.from → edge.to 方向看, left=左侧, right=右侧。
// 上行 (1番/2番) 几何方向 = 西→东 → 沿东向看, 北=left, 南=right
//   1番 在 PlatformA 北侧 → PlatformA 在 1番 南侧 = right
//   2番 在 PlatformA 南侧 → PlatformA 在 2番 北侧 = left
// 下行 (3番/4番) 几何方向 = 东→西 → 沿西向看, 南=left, 北=right
//   3番 在 PlatformB 北侧 → PlatformB 在 3番 南侧 = left
//   4番 在 PlatformB 南侧 → PlatformB 在 4番 北侧 = right

export const BINDING_PLAN: PlatformTrackBindingInput[] = [
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_A_ID,
    edgeRef: buildEdgeId(TRACK_1_ID),
    side: "right",
    servingDirection: "up",
  },
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_A_ID,
    edgeRef: buildEdgeId(TRACK_2_ID),
    side: "left",
    servingDirection: "up",
  },
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_B_ID,
    edgeRef: buildEdgeId(TRACK_3_ID),
    side: "left",
    servingDirection: "down",
  },
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_B_ID,
    edgeRef: buildEdgeId(TRACK_4_ID),
    side: "right",
    servingDirection: "down",
  },
];

export const STOP_PLAN: StoppingPointInput[] = [
  // 上行直通停车 (1番 本線)
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_A_ID,
    edgeRef: buildEdgeId(TRACK_1_ID),
    direction: "up",
    measure: 0.5,
  },
  // 上行待避停车 (2番 副本)
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_A_ID,
    edgeRef: buildEdgeId(TRACK_2_ID),
    direction: "up",
    measure: 0.5,
  },
  // 下行待避停车 (3番 副本)
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_B_ID,
    edgeRef: buildEdgeId(TRACK_3_ID),
    direction: "down",
    measure: 0.5,
  },
  // 下行直通停车 (4番 本線)
  {
    stationRef: STATION_ID,
    platformRef: PLATFORM_B_ID,
    edgeRef: buildEdgeId(TRACK_4_ID),
    direction: "down",
    measure: 0.5,
  },
];

// ---- 设计观察 ----
//
// 经过 Layer 1 改造后, 以下事项已被转换为编译期 diagnostic, 不再需要事后观察:
// - Platform.type 未声明 → MVP_PLATFORM_TYPE_UNDECLARED
// - Track.functionalUse 未声明 → MVP_TRACK_FUNCTIONAL_USE_UNDECLARED
// - Track.physicalKind 未声明 → MVP_TRACK_PHYSICAL_KIND_UNDECLARED
// - DoubleTrackPair 未自动填 → 由 aggregateDoubleTrackPairs 自动处理
// - StoppingPoint 无匹配 binding → MVP_STOP_NO_MATCHING_BINDING
//
// 仍未解决的设计问题 (留给后续 Layer 处理):
//
// 1. [critical] Route / 径路 概念缺失
//    待避路径 (1番 → 西咽 1-2 → 2番 → 停 PlatformA → 东咽 1-2 → 1番) 无法表达。
//    属于 Layer 2 (服务模板) / Layer 3 (运行时径路) 的范围。
//
// 2. [major] Switch point 物理建模
//    咽喉道岔仍用 connector edge 模拟。switch_point kind 编译期跳过。
//
// 3. [info] Station boundary
//    StoppingPoint.measure=0.5 没验证是否在站界 (进站/出站信号机) 内。
//    需要 Station 上增加 trackScopedBoundaries 字段。

if (typeof window !== "undefined") {
  Object.assign(window, {
    pocLiangMianSiXian: {
      buildGeoJson: buildLiangMianSiXianGeoJson,
      bindingPlan: BINDING_PLAN,
      stopPlan: STOP_PLAN,
    },
  });
}
