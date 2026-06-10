// ============================================================
// PoC: 复线国铁型两面三线站 — 数据结构与完整操作绑定流程
// ============================================================
//
// 站型示意 (上北下南, 上行=东向/右, 下行=西向/左):
//
//   西咽喉 (west switch area)         站区 (station area)          东咽喉 (east switch area)
//
//   I道(上行正线)  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●  I道
//                  ╲                                                  ╱
//   3道(到发线)     ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●  3道
//                  ╱                                                  ╲
//   II道(下行正线) ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●  II道
//
//   Platform 1 (1号侧式站台): I道 与 3道 之间
//   Platform 2 (2号侧式站台): 3道 与 II道 之间
//
//   上行列车路径: I道 → [西岔] → 3道(停靠Platform 1) → [东岔] → I道
//   下行列车路径: II道 → [东岔] → 3道(停靠Platform 2) → [西岔] → II道
//
// ============================================================

import type { GeoJSONPosition } from "../rail-graph-v1/geojson";
import type {
  BaseTopologyLayer,
  PlatformTrackBinding,
  StoppingPoint,
} from "../rail-graph-v1/base-topology.types";
import type { Diagnostic } from "../rail-graph-v1/diagnostic-types";
import type { DirectionLabel } from "../rail-graph-v1/primitives";

// ---- 辅助类型: 运行此PoC时收集的设计观察 ----

interface DesignObservation {
  /** 严重程度 */
  severity: "critical" | "major" | "minor" | "info";
  /** 涉及的数据结构/API */
  target: string;
  /** 问题描述 */
  problem: string;
  /** 当前workaround */
  workaround?: string;
  /** 建议改进方向 */
  suggestion: string;
}

// ---- 构造两面三线站 GeoJSON 数据集 ----

/**
 * 坐标约定:
 * - 上行方向 = 经度增加 (西→东), 下行方向 = 经度减少 (东→西)
 * - 正线间距约 0.0003 度 (~30m), 与实际复线间距一致
 * - 站台宽度约 0.0001 度 (~10m)
 */

const LON_WEST = 139.6980;
const LON_EAST = 139.7020;
const LAT_BASE = 35.6900;
const TRACK_SPACING = 0.0003; // ~30m between track centers
const PLATFORM_HALF_WIDTH = 0.00005; // ~5m half-width

// 三线中心纬度
const LAT_UP_MAIN = LAT_BASE + TRACK_SPACING; // I道 (上)
const LAT_SIDING = LAT_BASE; // 3道 (中)
const LAT_DOWN_MAIN = LAT_BASE - TRACK_SPACING; // II道 (下)

// 各轨道端点
const nodeWestUp: GeoJSONPosition = [LON_WEST, LAT_UP_MAIN];
const nodeEastUp: GeoJSONPosition = [LON_EAST, LAT_UP_MAIN];
const nodeWestSiding: GeoJSONPosition = [LON_WEST, LAT_SIDING];
const nodeEastSiding: GeoJSONPosition = [LON_EAST, LAT_SIDING];
const nodeWestDown: GeoJSONPosition = [LON_WEST, LAT_DOWN_MAIN];
const nodeEastDown: GeoJSONPosition = [LON_EAST, LAT_DOWN_MAIN];

function buildLiangMianSanXianGeoJson(): { type: "FeatureCollection"; features: unknown[] } {
  return {
    type: "FeatureCollection",
    features: [
      // ── 车站点 ──
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [(LON_WEST + LON_EAST) / 2, LAT_BASE] },
        properties: {
          name: "示例两面三线站",
          railGraph: {
            kind: "station_point",
            schemaVersion: "rail-graph-v1",
            id: "demo:station:liangmiansanxian",
            source: "demo",
            station: { name: "示例两面三线站" },
          },
        },
      },

      // ── 站台1 (I道与3道之间, 侧式) ──
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [LON_WEST + 0.0005, LAT_SIDING + PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_SIDING + PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_UP_MAIN - PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_UP_MAIN - PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_SIDING + PLATFORM_HALF_WIDTH],
          ]],
        },
        properties: {
          name: "1号站台",
          railGraph: {
            kind: "platform_area",
            schemaVersion: "rail-graph-v1",
            id: "demo:platform:1",
            source: "demo",
            platform: { stationRef: "demo:station:liangmiansanxian", name: "1号站台", number: 1 },
          },
        },
      },

      // ── 站台2 (3道与II道之间, 侧式) ──
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [LON_WEST + 0.0005, LAT_DOWN_MAIN + PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_DOWN_MAIN + PLATFORM_HALF_WIDTH],
            [LON_EAST - 0.0005, LAT_SIDING - PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_SIDING - PLATFORM_HALF_WIDTH],
            [LON_WEST + 0.0005, LAT_DOWN_MAIN + PLATFORM_HALF_WIDTH],
          ]],
        },
        properties: {
          name: "2号站台",
          railGraph: {
            kind: "platform_area",
            schemaVersion: "rail-graph-v1",
            id: "demo:platform:2",
            source: "demo",
            platform: { stationRef: "demo:station:liangmiansanxian", name: "2号站台", number: 2 },
          },
        },
      },

      // ── I道: 上行正线 (西→东) ──
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [nodeWestUp, nodeEastUp],
        },
        properties: {
          name: "I道",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:i-up-main",
            source: "demo",
            track: { role: "main", traversal: "forward", name: "I道", trackCode: "I" },
          },
        },
      },

      // ── 3道: 到发线 (双向) ──
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [nodeWestSiding, nodeEastSiding],
        },
        properties: {
          name: "3道",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:3-siding",
            source: "demo",
            track: { role: "platform", traversal: "both", name: "3道", trackCode: "3" },
          },
        },
      },

      // ── II道: 下行正线 (东→西) ──
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [nodeWestDown, nodeEastDown],
        },
        properties: {
          name: "II道",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:ii-down-main",
            source: "demo",
            track: { role: "main", traversal: "forward", name: "II道", trackCode: "II" },
          },
        },
      },

      // ── 道岔连接线 (connector edges for switch areas) ──
      // 西咽喉: I道 ↔ 3道 ↔ II道
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [nodeWestUp, nodeWestSiding],
        },
        properties: {
          name: "西岔-上行",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:west-switch-up",
            source: "demo",
            track: { role: "connector", traversal: "both", name: "西岔-上行" },
          },
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [nodeWestSiding, nodeWestDown],
        },
        properties: {
          name: "西岔-下行",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:west-switch-down",
            source: "demo",
            track: { role: "connector", traversal: "both", name: "西岔-下行" },
          },
        },
      },

      // 东咽喉: I道 ↔ 3道 ↔ II道
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [nodeEastSiding, nodeEastUp],
        },
        properties: {
          name: "东岔-上行",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:east-switch-up",
            source: "demo",
            track: { role: "connector", traversal: "both", name: "东岔-上行" },
          },
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [nodeEastDown, nodeEastSiding],
        },
        properties: {
          name: "东岔-下行",
          railGraph: {
            kind: "track_geometry",
            schemaVersion: "rail-graph-v1",
            id: "demo:track:east-switch-down",
            source: "demo",
            track: { role: "connector", traversal: "both", name: "东岔-下行" },
          },
        },
      },
    ],
  };
}

// ---- 绑定与停车标定义 ----

interface StationBindingPlan {
  stationRef: string;
  platformRef: string;
  edgeRef: string;
  side: PlatformTrackBinding["side"];
  servingDirection?: DirectionLabel;
}

interface StopPlan {
  stationRef: string;
  platformRef: string;
  edgeRef: string;
  direction: StoppingPoint["direction"];
  measure: number;
}

/**
 * 两面三线站的绑定计划:
 *
 * Platform 1 (1号站台, I道与3道之间) = SIDE platform
 *   - 北侧面(right): 服务 I道 (上行列车)
 *   - 南侧面(left):  服务 3道 (上行停站列车)
 *
 * Platform 2 (2号站台, 3道与II道之间) = SIDE platform
 *   - 北侧面(right): 服务 3道 (下行停站列车)
 *   - 南侧面(left):  服务 II道 (下行列车)
 */
const BINDING_PLAN: StationBindingPlan[] = [
  // Platform 1
  { stationRef: "demo:station:liangmiansanxian", platformRef: "demo:platform:1", edgeRef: "demo:track:i-up-main", side: "right", servingDirection: "up" },
  { stationRef: "demo:station:liangmiansanxian", platformRef: "demo:platform:1", edgeRef: "demo:track:3-siding", side: "left", servingDirection: "up" },
  // Platform 2
  { stationRef: "demo:station:liangmiansanxian", platformRef: "demo:platform:2", edgeRef: "demo:track:3-siding", side: "right", servingDirection: "down" },
  { stationRef: "demo:station:liangmiansanxian", platformRef: "demo:platform:2", edgeRef: "demo:track:ii-down-main", side: "left", servingDirection: "down" },
];

/**
 * 停车标计划:
 * - 上行停站列车: 3道, measure 0.5, Platform 1
 * - 下行停站列车: 3道, measure 0.5, Platform 2
 */
const STOP_PLAN: StopPlan[] = [
  { stationRef: "demo:station:liangmiansanxian", platformRef: "demo:platform:1", edgeRef: "demo:track:3-siding", direction: "up", measure: 0.5 },
  { stationRef: "demo:station:liangmiansanxian", platformRef: "demo:platform:2", edgeRef: "demo:track:3-siding", direction: "down", measure: 0.5 },
];

// ---- 完整工作流 ----

export interface PoCResult {
  source: Record<string, unknown>;
  topo: BaseTopologyLayer;
  diagnostics: Diagnostic[];
  observations: DesignObservation[];
}

/**
 * 执行完整的两面三线站 PoC 流程:
 * 1. 导入标注好的 GeoJSON
 * 2. 编译拓扑
 * 3. 创建站台-股道绑定
 * 4. 确认停车标
 * 5. 重新编译, 导出最终拓扑
 * 6. 收集设计观察
 */
export function runPoC(api: {
  loadGeoJson: (raw: string | Record<string, unknown>) => unknown;
  addPlatformTrackBinding: (input: {
    stationRef: string;
    platformRef: string;
    edgeRef: string;
    side: PlatformTrackBinding["side"];
    servingDirection?: string;
  }) => unknown;
  confirmStoppingPoint: (input: {
    stationRef: string;
    platformRef: string;
    edgeRef: string;
    direction: StoppingPoint["direction"];
    measure: number;
  }) => unknown;
  compileTopology: () => BaseTopologyLayer;
  exportTopology: () => BaseTopologyLayer;
  exportDiagnostics: () => Diagnostic[];
  exportAnnotatedGeoJson: () => Record<string, unknown>;
}): PoCResult {
  const observations: DesignObservation[] = [];

  // Step 1: 导入
  const source = buildLiangMianSanXianGeoJson();
  api.loadGeoJson(source);

  // Step 2: 首次编译
  const topo1 = api.compileTopology();

  // Step 3: 创建所有绑定
  for (const binding of BINDING_PLAN) {
    api.addPlatformTrackBinding(binding);
  }

  // Step 4: 确认所有停车标
  for (const stop of STOP_PLAN) {
    api.confirmStoppingPoint(stop);
  }

  // Step 5: 重编译
  const topo = api.compileTopology();

  // Step 6: 收集诊断
  const diagnostics = api.exportDiagnostics();

  // ── 设计观察 ──

  // Observation 1: 道岔编译被延迟, 导致必须用 connector edges 模拟
  const hasDeferredSwitch = diagnostics.some(
    (d) => d.code === "MVP_KIND_DEFERRED"
  );
  if (hasDeferredSwitch) {
    observations.push({
      severity: "major",
      target: "switch_point compilation",
      problem:
        "switch_point 特征在 MVP 中不参与编译 (MVP_KIND_DEFERRED)。" +
        "两面三线站的西/东咽喉道岔区域必须用 role=connector 的 track_geometry 来模拟，" +
        "这导致: (a) 道岔失去了物理语义 (b) 无法表达道岔的方向约束 (c) 无法区分对向/顺向通过。",
      workaround:
        "用短 connector edges 连接三个轨道的端点节点。" +
        "当前 PoC 仅连接了相邻节点对, 未表达 I道↔II道 的直接联通 (实际中需要经过两副道岔)。",
      suggestion:
        "尽早实现 switch_point 的 topo 编译, " +
        "使得 switch 能成为独立的 TopologyNode/Edge, " +
        "并支持禁止某些方向的 hard constraint。",
    });
  }

  // Observation 2: Platform type 未传播
  const platformTypesUnknown = topo.platforms.every(
    (p) => p.type === "unknown"
  );
  if (platformTypesUnknown) {
    observations.push({
      severity: "minor",
      target: "Platform.type",
      problem:
        "Platform.type 在编译后始终为 'unknown'。" +
        "两面三线站的两个站台都是侧式站台(side), " +
        "但 GeoJSON annotation 和 UI 中没有提供设置 type 的入口。",
      workaround: "需要手动在编译后的 topo 中修正。",
      suggestion:
        "在 annotation 模型中增加 platform.type 字段, " +
        "或在 UI 中提供下拉选择 (side/island/bay)。",
    });
  }

  // Observation 3: Binding side 参考系不明确
  // 验证: 两面三线站的 Platform 1 同时绑定 I道和3道, side 分别为 right/left
  const platform1Bindings = topo.platformTrackBindings.filter(
    (b) => b.platformRef === "demo:platform:1"
  );
  if (platform1Bindings.length >= 2) {
    observations.push({
      severity: "major",
      target: "PlatformTrackBinding.side",
      problem:
        "PlatformTrackBinding.side 的 'left'/'right' 没有明确的参考方向。" +
        "在两面三线站中, Platform 1 的 right 侧是 I道, left 侧是 3道。" +
        "但如果观察者面向下行方向, left/right 将完全反转。" +
        "缺少类似 '以里程增加方向为前方/右侧' 的约定。",
      suggestion:
        "在文档中显式定义 side 的参考方向——建议用 '沿 edge 的 from→to 方向, left/right 为行进方向左侧/右侧'。" +
        "或者引入面向(从站台中心看向股道)的相对方向。",
    });
  }

  // Observation 4: 双线上下行链路信息分散
  const hasUpDownTracks =
    topo.edges.some((e) => e.trackCode === "I") &&
    topo.edges.some((e) => e.trackCode === "II");
  const noDoubleTrackPairs = topo.doubleTrackPairs.length === 0;
  if (hasUpDownTracks && noDoubleTrackPairs) {
    observations.push({
      severity: "major",
      target: "DoubleTrackPair / direction semantics",
      problem:
        "存在 I道(上行) 和 II道(下行) 两条正线, 但 doubleTrackPairs 为空。" +
        "上下行的方向约束散布在: (a) TopologyEdge.traversal (b) PlatformTrackBinding.servingDirection (c) StoppingPoint.direction。" +
        "没有一个统一的 '线路方向' 概念能将 I道标记为上/下行线。",
      suggestion:
        "在 MVP 中实现 DoubleTrackPair 的自动/半自动填充。" +
        "在 track annotation 中增加 directionHint 字段, 编译时自动推断并填充 doubleTrackPairs。",
    });
  }

  // Observation 5: 缺少站界概念
  const sidingEdge = topo.edges.find((e) => e.trackCode === "3");
  if (sidingEdge) {
    const stopsOnSiding = topo.stoppingPoints.filter(
      (s) => s.edgeRef === sidingEdge.id
    );
    if (stopsOnSiding.length > 0) {
      observations.push({
        severity: "info",
        target: "Station boundary / track measure",
        problem:
          "StoppingPoint 的 measure 在 3道上定义为 0.5, " +
          "但没有验证该 measure 是否在站界(进站信号机~出站信号机)内。" +
          "在完整系统中, 停车标应在 station boundary 范围内。",
        suggestion:
          "在 Station 或相关结构上增加 stationBoundary 定义 " +
          "(如 trackScopedBoundaries: { edgeRef, startMeasure, endMeasure }[])。",
      });
    }
  }

  // Observation 6: 缺少 route/径路概念
  observations.push({
    severity: "critical",
    target: "Route / path through station",
    problem:
      "当前模型只能表达 '3道上有停车标', 无法表达完整的进出站径路: " +
      "'I道 → 西岔(connector) → 3道 → 停靠Platform1 → 东岔(connector) → I道'。" +
      "这是两面三线站的核心操作语义, 也是后续路径搜索的基础。",
    suggestion:
      "在 Layer 2 (可变拓扑) 或 Layer 3 (服务模板) 中, " +
      "引入 Route 概念: 用有序的 edgeRef + measure 段序列表达完整径路。",
  });

  // Observation 7: 停车标与绑定的一致性未校验
  // 检查: 是否存在 platform/edge 有停车标但无绑定的情况
  const boundPairs = new Set(
    topo.platformTrackBindings.map(
      (b) => `${b.platformRef}:${b.edgeRef}:${b.servingDirection}`
    )
  );
  for (const stop of topo.stoppingPoints) {
    const key = `${stop.platformRef}:${stop.edgeRef}:${stop.direction}`;
    if (!boundPairs.has(key)) {
      observations.push({
        severity: "minor",
        target: "StoppingPoint / PlatformTrackBinding cross-validation",
        problem:
          `停车标 (${stop.id}) 的 platform+edge+direction 组合没有对应的 PlatformTrackBinding。` +
          "可能意味着站台不服务该方向的该股道, 但仍可在该处停车。",
        suggestion:
          "编译时增加交叉校验: 每个 confirmed StoppingPoint 应有匹配的 PlatformTrackBinding。",
      });
    }
  }

  return { source, topo, diagnostics, observations };
}

// ---- 导出供控制台使用 ----

export { buildLiangMianSanXianGeoJson, BINDING_PLAN, STOP_PLAN };

if (typeof window !== "undefined") {
  Object.assign(window, {
    pocLiangMianSanXian: {
      buildGeoJson: buildLiangMianSanXianGeoJson,
      bindingPlan: BINDING_PLAN,
      stopPlan: STOP_PLAN,
      runPoC,
      // 直接可用的便捷函数
      demo() {
        const mvp = (window as any).railGraphMvp;
        if (!mvp) {
          console.error("请先在 MVP 页面中加载 app.ts");
          return;
        }
        const result = runPoC(mvp);
        mvp.compileTopology();
        console.log("=== 两面三线站 PoC 结果 ===");
        console.log("Topology:", result.topo);
        console.log("Diagnostics:", result.diagnostics);
        console.log("Design Observations:", result.observations);
        console.log("\n--- 设计不足分析 ---");
        for (const obs of result.observations) {
          console.log(
            `[${obs.severity.toUpperCase()}] ${obs.target}\n  Problem: ${obs.problem}\n  Suggestion: ${obs.suggestion}\n`
          );
        }
        return result;
      },
    },
  });
}
