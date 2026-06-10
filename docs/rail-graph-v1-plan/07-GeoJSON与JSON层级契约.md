# GeoJSON 与 JSON 层级契约

## 1. 契约定位
本文件把 `06-原始要求固化清单.md` 中的自然语言补充，改写为后续 TypeScript 实现必须承载的数据契约。

设计原则：
- GeoJSON 只作为原始几何与外部标签承载层，不作为图结构唯一真源。
- 标准化 JSON 才是运行图、时间轴、事件流、补全诊断与编辑输出的唯一契约。
- 复线物理几何与动态偏移计划可以同时存在；每个复线语义至少必须具备其一。物理数据缺失但语义明确时，可生成动态偏移或虚拟边，但必须记录诊断与来源。
- 所有可编辑输出都以 JSON patch/snapshot 表达，不直接修改输入源。

## 2. GeoJSON 输入对象契约

### 2.1 FeatureCollection 顶层
```ts
type RailGraphGeoJsonInput = GeoJSON.FeatureCollection<
  GeoJSON.Point | GeoJSON.LineString | GeoJSON.MultiLineString | GeoJSON.Polygon | GeoJSON.MultiPolygon,
  RailGraphFeatureProperties
>;
```

顶层允许混合以下对象，但每个 feature 必须通过 `properties.railGraph.kind` 声明语义：

| kind | GeoJSON geometry | 进入标准化后的实体 |
|---|---|---|
| `platform_area` | `Polygon` / `MultiPolygon` | `InfraArea(kind=platform)` |
| `track_geometry` | `LineString` / `MultiLineString` | `InfraEdge(kind=main_track/platform_track/storage_track/bridge_track/tunnel_track)` |
| `switch_point` | `Point` | `InfraNode(kind=switch)` |
| `special_section` | `LineString` / `MultiLineString` / `Polygon` | `SpecialSection` + edge relation |
| `scenic_anchor` | `Point` / `LineString` | `EventAnchor(kind=scenic_view)` |
| `manual_event_anchor` | `Point` / `LineString` | `EventAnchor(kind=user_defined/fixed_operation)` |

### 2.2 通用 properties
```ts
interface RailGraphFeatureProperties {
  railGraph: {
    kind: RailGraphGeoJsonKind;
    schemaVersion?: "rail-graph-v1";
    id?: string;
    source?: "orm" | "openrailwaymap" | "legacy_geojson" | "manual" | string;
    sourceRefs?: SourceRef[];
    confidence?: "observed" | "derived" | "manual" | "synthetic";
    tags?: Record<string, string | number | boolean | null>;
  };
}
```

规则：
- `id` 缺失时由 `ids.ts` 使用 `source + kind + sourceRefs/tags/geometry hash` 生成稳定 ID。
- `confidence=synthetic` 的 feature 只能作为补全或调试输出，不能覆盖真实源数据。
- 外部标签保留在 `tags`，但运行逻辑只读取标准化后的强类型字段。

## 3. 具体 GeoJSON 类型

### 3.1 站台
站台使用面对象，必须允许与站线语义绑定。

```ts
interface PlatformAreaProperties extends RailGraphFeatureProperties {
  railGraph: RailGraphFeatureProperties["railGraph"] & {
    kind: "platform_area";
    platform: {
      stationRef?: string;
      name?: string;
      code?: string;
      trackRefs?: string[];
      servingDirection?: "up" | "down" | "both" | "unknown";
      boardingRole?: "boarding" | "alighting" | "both" | "pass_through_only";
    };
  };
}
```

标准化要求：
- `Polygon/MultiPolygon` 进入 `InfraArea(kind=platform)`。
- `platform.trackRefs[]` 生成 `platform_serves_track` relation。
- 若站台缺少 `trackRefs`，`enrichment.ts` 可按最近站线、方向、站场范围推断，并输出 `warn` 诊断。

### 3.2 站线 / 股道

站线或股道使用线对象。输入可为整条 `MultiLineString`，标准化时必须允许提取片段并在渲染时拼接。

```ts
interface TrackGeometryProperties extends RailGraphFeatureProperties {
  railGraph: RailGraphFeatureProperties["railGraph"] & {
    kind: "track_geometry";
    track: {
      role: "main" | "platform" | "passing" | "storage" | "yard" | "connector";
      trackCode?: string;          // 物理轨道编号
      name?: string;               // 物理区段名称，如 "新宿-池袋本線"
      serviceable?: boolean;
      properties?: {
        gauge?: number;            // 轨距 (mm)
        electrified?: boolean;
        maxSpeedKmh?: number;
      };
      extraction?: {
        sourceFeatureRef?: string;
        multiLineIndex?: number;
        startMeasure?: number;
        endMeasure?: number;
        stitchGroupRef?: string;
      };
    };
  };
}
```

标准化要求：
- `LineString` 可直接成为一个 edge。
- `MultiLineString` 必须拆成可寻址 edge 片段，并保留 `source_geometry_slice` relation。
- **物理 edge 不携带 `lineRef`、`direction`、`stationRef`**：这些属于服务层语义，由 `ServicePattern` 承载。同一物理 edge 可被多个 ServicePattern 引用。
- 后续渲染若需要合并显示，使用 `stitchGroupRef` 与 edge sequence 拼接，不把拼接结果反写为唯一真源。

### 3.3 道岔
道岔使用点对象，作为图节点，不允许只作为线段标签存在。

```ts
interface SwitchPointProperties extends RailGraphFeatureProperties {
  railGraph: RailGraphFeatureProperties["railGraph"] & {
    kind: "switch_point";
    switch: {
      connectedTrackRefs?: string[];
      turnoutRole?: "normal" | "branch" | "crossover" | "unknown";
      directionHint?: "up" | "down" | "both" | "unknown";
    };
  };
}
```

标准化要求：
- `Point` 进入 `InfraNode(kind=switch)`。
- 与相邻 edge 的连接必须落到 adjacency。
- 缺少 `connectedTrackRefs` 时可按距离吸附到最近线端或线内投影点，但必须记录补全方式。

### 3.4 复线结构
复线必须在服务层显式表达，允许两种几何实现。

```ts
interface DoubleTrackRelation {
  relationType: "double_track_pair";
  geometryModes: ("physical_edges" | "dynamic_offset")[];
  upEdgeRefs?: string[];
  downEdgeRefs?: string[];
  sharedGeometryEdgeRefs?: string[];
  dynamicOffset?: {
    offsetMeters?: number;
    offsetSideRule?: "left_of_run" | "right_of_run" | "by_direction" | "manual";
    smoothing?: {
      enabled: boolean;
      joinStrategy: "bezier" | "arc" | "linear_blend";
      transitionMeters?: number;
    };
  };
}
```

规则：
- `physical_edges`：上下行或复线边具有独立真实几何，路径决策使用真实 edge。
- `dynamic_offset`：只有共享几何或单线几何时，可生成方向性服务边与渲染偏移指令；该虚拟几何不得伪装为真实 ORM/OpenRailwayMap 来源。
- `geometryModes` 至少包含一项；若同时包含 `physical_edges` 与 `dynamic_offset`，物理 edge 是拓扑优先依据，动态偏移用于显示修正、缺口补全或调试对照。
- 动态偏移必须支持平滑连接计划，避免在道岔、桥隧出入口、复线并合处分段突变。
- 路径顺序以服务 edge 为准，渲染几何可由真实线或偏移线派生。

### 3.5 存车线
存车线是可选运行对象，通常不参与普通 run，但必须保留特殊意义。

```ts
interface StorageTrackSemantics {
  role: "storage";
  serviceable: false;
  allowedUsage: "none" | "manual_only" | "operation_event_only";
  operationTags?: ("stabling" | "coupling" | "decoupling" | "turnback" | "maintenance")[];
}
```

规则：
- 默认不进入普通路径候选。
- 显式 override、编组/解挂事件或调试场景可以引用。
- 自动路径选择若使用存车线，必须输出 `warn` 或更高级诊断。

### 3.6 桥隧上下行分离
桥隧分离不再使用含糊命名，统一拆成特殊区间语义与方向分离语义。

```ts
interface SpecialSectionProperties extends RailGraphFeatureProperties {
  railGraph: RailGraphFeatureProperties["railGraph"] & {
    kind: "special_section";
    section: {
      category: "bridge" | "tunnel" | "viaduct" | "cutting" | "other";
      directionSeparation: "none" | "up_down_split" | "multi_bore" | "unknown";
      edgeRefs?: string[];
      name?: string;
    };
  };
}
```

规则：
- `category` 表达桥、隧等物理类型。
- `directionSeparation` 表达上下行是否物理分离。
- 运行事件使用 `special_section_pass`，payload 内保留 `category` 与 `directionSeparation`。

## 4. 标准化 JSON 层级

### 4.1 SourceBatchInput
```ts
interface SourceBatchInput {
  schemaVersion: "rail-graph-v1";
  sources: SourceEnvelope[];
  manualPatches?: PatchSet[];
}

type SourceEnvelope =
  | { sourceType: "geojson"; sourceRef: string; data: RailGraphGeoJsonInput }
  | { sourceType: "orm_records"; sourceRef: string; records: unknown[] }
  | { sourceType: "legacy_network_meta"; sourceRef: string; data: unknown }
  | { sourceType: "manual_json"; sourceRef: string; data: Partial<NormalizedEntityBatch> };
```

### 4.2 NormalizedEntityBatch
```ts
interface NormalizedEntityBatch {
  schemaVersion: "rail-graph-v1";
  nodes: InfraNode[];
  edges: InfraEdge[];
  areas: InfraArea[];
  sections: SpecialSection[];
  relations: GraphRelation[];
  servicePatterns: ServicePattern[];
  eventAnchors: EventAnchor[];
  provenance: ProvenanceRecord[];
  diagnostics: Diagnostic[];
}
```

核心层级：
- `nodes[]`：站、道岔、线端点、拆分边界、事件锚点。
- `edges[]`：股道、主线、站线、存车线、桥隧边、虚拟方向边。
- `areas[]`：站台面、站场范围等面对象。
- `sections[]`：桥、隧、上下行分离、其他特殊区间。
- `relations[]`：站台-股道、edge-区间、复线配对、源几何切片、渲染偏移等关系。
- `eventAnchors[]`：固定事件、车窗绝景、用户事件的空间锚点。

### 4.3 RailGraph
```ts
interface RailGraph {
  schemaVersion: "rail-graph-v1";

  // 拓扑热层：决定 graphId。变更 → graphId 变 → 所有 run 缓存失效
  topo: {
    infraLayer: {
      nodes: InfraNode[];            // 物理节点：站、道岔、线端点
      edges: InfraEdge[];            // 物理边：轨道片段，不含 geometry
      areas: InfraArea[];
      sections: SpecialSection[];
      adjacency: GraphAdjacency;
    };
    serviceLayer: {
      servicePatterns: ServicePattern[];   // edgeSequence, stationSequence, topologyType
      doubleTrackRelations: DoubleTrackRelation[];
    };
  };

  // 温层：不影响寻路，变更不触发 graphId 变化，但触发 renderFingerprint / eventFingerprint 变化
  geometryStore: {
    edgeGeometries: Map<EntityRef, GeoJSON.LineString>;  // edge 坐标，与 topo 分离
    nodePositions: Map<EntityRef, GeoJSON.Position>;     // node 坐标
  };
  displayStore: {
    patternDisplay: Map<EntityRef, { displayName?: string; displayColor?: string; landmark?: boolean }>;
    stationDisplay: Map<EntityRef, StationMeta>;
  };
  eventLayer: {
    anchors: EventAnchor[];
    policies: EventPolicy[];
  };

  indexes: RailGraphIndexes;

  // 冷层：不影响任何缓存键
  provenance: ProvenanceRecord[];
  diagnostics: Diagnostic[];
}
```

`graphId = sha256(canonicalJson(topo))`——仅覆盖拓扑热层。`geometryStore`、`displayStore`、`eventLayer`、`provenance`、`diagnostics` 的变更不触发 graphId 变化，仅触发对应阶段 artifact 的缓存失效。

#### 4.3.0 RailGraphIndexes

```ts
interface RailGraphIndexes {
  // === 正向索引 ===
  nodeById: Map<EntityRef, InfraNode>;
  edgeById: Map<EntityRef, InfraEdge>;
  areaById: Map<EntityRef, InfraArea>;
  sectionById: Map<EntityRef, SpecialSection>;
  patternById: Map<EntityRef, ServicePattern>;
  adjacency: GraphAdjacency;                        // node → 相邻 edge[]

  // === 反向索引（构建时同步填充，O(1) 变更影响面查询） ===
  patternsByEdge: Map<EntityRef, Set<EntityRef>>;   // edge → 引用它的 ServicePattern.id[]
  patternsByNode: Map<EntityRef, Set<EntityRef>>;   // node → 经过它的 ServicePattern.id[]
  edgesBySection: Map<EntityRef, Set<EntityRef>>;   // specialSection → 包含的 edge[]
  tracksByPlatform: Map<EntityRef, Set<EntityRef>>; // platform area → 服务的 track edge[]
  platformsByTrack: Map<EntityRef, Set<EntityRef>>; // track edge → 服务的 platform area[]
}
```

所有反向索引在 `graph-builder.ts` 构建阶段同步填充，内存增量在数百 KB 级别（15MB 图规模下），不做运行时遍历。

#### 4.3.1 InfraEdge（物理边）

```ts
interface InfraEdge {
  id: EntityRef;
  // geometry 存储在 geometryStore.edgeGeometries 中，不在此处——geometry 变更不影响 graphId
  role: "main" | "platform" | "passing" | "storage" | "yard" | "connector";
  name?: string;                   // 物理区段名称
  trackCode?: string;
  properties?: {
    gauge?: number;
    electrified?: boolean;
    maxSpeedKmh?: number;
    lengthMeters: number;
  };
  extraction?: {                   // 源几何切片信息
    sourceFeatureRef?: string;
    multiLineIndex?: number;
    startMeasure?: number;
    endMeasure?: number;
    stitchGroupRef?: string;
  };
}
```

规则：InfraEdge 只表达物理轨道。`lineRef`、`direction`、站点归属、停站模式全部由 `ServicePattern` 承载。

#### 4.3.2 ServicePattern（服务线路）

```ts
interface ServicePattern {
  patternId: EntityRef;
  lineRef: EntityRef;              // 所属线路标识
  systemRef: EntityRef;            // 运行系统 (JR-East, TokyoMetro 等)

  // 核心：该服务线路的有序边序列和站点序列
  edgeSequence: EntityRef[];       // 指向 InfraEdge.id，按运行方向排列
  stationSequence: {               // 指向 InfraNode.id，按运行方向排列
    nodeRef: EntityRef;
    stopType: "mandatory_stop" | "pass_through" | "conditional_stop";
    platformNumber?: number;       // 站台编号（数字 ID），可自动从站序推导或手动覆写
    platformName?: string;         // "1番線" —— platformNumber 的人类可读形式
    landmark?: boolean;            // 渲染时 landmark —— 非事件，仅渲染接口
    operationType?: "coupling" | "decoupling" | "turnback" | "stabling";  // 编组/解挂等作业
  }[];

  // 方向约定（每个 ServicePattern 独立定义）
  directionConvention: {
    forwardLabel: string;          // "内回り" / "up" / "clockwise"
    reverseLabel: string;          // "外回り" / "down" / "counterclockwise"
  };

  // 拓扑类型
  topologyType: "linear" | "cyclic" | "branching";
  cycleCheck?: {                   // topologyType=cyclic 时存在
    isCycle: boolean;
    modularModulo: number;         // 模算术模数 = stationSequence 长度
  };

  // 服务类型
  serviceType: "local" | "rapid" | "express" | "limited_express" | "freight" | "maintenance";

  // 运行时标签
  displayName?: string;            // 渲染用名称
  displayColor?: string;           // 渲染用颜色 (#hex)
}
```

规则：
- **同一 InfraEdge 可被多个 ServicePattern 引用**：一条物理轨道承载多条运行线路。
- **每个 ServicePattern 有独立的站序和方向定义**：JR 山手线的 "up" 和 JR 崎京线的 "up" 可以语义不同。
- **`landmark` 是 station 属性，属渲染时接口**：不参与路径决策，不由 events.ts 消费。渲染层沿 `RunPath.nodeSequence` 收集 `landmark=true` 的站即可生成 "经由 新宿、渋谷" 显示。
- **`stopType` 决定事件生成**：`events.ts` 按 `mandatory_stop` 生成 `platform_stop`，`pass_through` 生成 `platform_pass`，`conditional_stop` 结合 `RunSpec.eventPolicy` 决定。
- **`platformNumber` 为管理员预写入的数字 ID**：严格要求预写入，不自动推导。区别于全局几何 ID，是站内站台序号。渲染时由系统生成显示文本（如 `platformNumber=1` → "1番線"）。用户端通过 `StationStop.platformNumber` 和 `platformName` 获取。
- **`operationType` 触发作业事件**：管理员在 ServicePattern 上标注编组/解挂/折返/停泊后，`events.ts` 的 `projectOperationEvents` 按标注生成对应 RunEvent。
- 路径搜索在 serviceLayer 上运行：`path-resolver.ts` 按 `RunSpec` 匹配 `ServicePattern`，再在其 `edgeSequence` 中选择路径。
- `topologyType` 在 `graph-builder.ts` 中通过 adjacency 遍历判定：若某个 lineRef 下 edge 序列首尾节点 ID 相同，则标记为 `cyclic`。
- `modularModulo` 为环线方向比较提供确定性参照：`computeLoopVia` 模运算使用此值。
- **人工数据的优先性**：若输入源（ORM/GeoJSON）中已明确标注 `topology: "cyclic"`，直接采用，不重新检测。

## 5. 运行 JSON 层级

### 5.1 RunSpec
```ts
interface RunSpec {
  runId?: string;
  startRef: EntityRef;
  endRef: EntityRef;
  viaRefs?: EntityRef[];          // 环线时承载 loopVia 语义：指定环上必须经过的站点
  avoidRefs?: EntityRef[];        // 环线时承载"不经过"的排除语义（可选）
  directionHint?: "up" | "down" | "clockwise" | "counterclockwise" | "unknown";
  pathOverride?: ManualPathOverride;
  timetableAnchors?: TimetableAnchor[];
  eventPolicy?: EventPolicyRef[];
  editMode?: "read_only" | "preview_patch" | "apply_patch";
}
```

规则：
- `directionHint` 的 `clockwise`/`counterclockwise` 以站序索引递增方向为参照：站序索引 0→1→2→...→N→0 为 `clockwise`，反向为 `counterclockwise`。对非环线，这两个值会被降级为 `unknown` 并记录诊断。
- `viaRefs[]` 在环线场景下承载 loopVia 语义：路径求解时必须经过指定的站点；若与 `directionHint` 矛盾（如指定 clockwise 但 viaRef 在 counterclockwise 路径上），`viaRefs` 优先，方向降级为 `unknown` 并输出 `warn`。
- `avoidRefs[]` 用于进一步收窄环线候选（如"不走有施工的站"），可选。

### 5.2 RunPath / RenderGeometryPlan / RunOrder / Timeline / EventStream
```ts
interface RunPath {
  edgeSequence: EntityRef[];
  nodeSequence: EntityRef[];
  chosenDirection: string;
  resolvedBy: "manual" | "auto" | "mixed";
  candidateScores: PathScore[];
  loopDecision?: {                  // 仅当路径涉及环线时存在
    isLoopRun: boolean;
    viaRefUsed?: EntityRef;         // 用户指定的 loopVia 站点
    directionSource: "explicit" | "via_inference" | "distance_based" | "consistency_based";
    fullCycleDistance: number;      // 环全周长 (m)
    chosenDistance: number;         // 所选方向路径长度 (m)
    alternativeDistance: number;    // 另一方向路径长度 (m)
  };
}

interface RenderGeometryPlan {
  geometrySource: "physical_edges" | "dynamic_offset" | "mixed";
  stitchedEdgeRefs: EntityRef[];
  offsetSegments: OffsetGeometrySegment[];
  smoothing: OffsetSmoothingPlan[];
  diagnostics: Diagnostic[];
}

interface OffsetSmoothingPlan {
  startMeasure: number;         // 平滑过渡起点在 edge 上的 measure (0–1)
  endMeasure: number;           // 平滑过渡终点在 edge 上的 measure (0–1)
  joinStrategy: "bezier" | "arc" | "linear_blend";
  transitionMeters: number;     // 过渡段长度（米）
  controlPoints?: [number, number][];  // bezier 模式的手动控制点（可选，自动生成时为 undefined）
}

interface RunOrder {
  orderPoints: OrderPoint[];
  boundaries: RunBoundary[];
}

interface TimelinePoint {
  orderIndex: number;
  timestamp?: string;
  isSynthesized: boolean;
  sourceAnchorRef?: string;
  inference?: "timetable" | "speed_distance" | "dwell_time" | "constant_spacing" | "manual";
}

interface EventStream {
  events: RunEvent[];
  editSnapshot?: EditableEventSnapshot;
}
```

## 6. 事件类型契约

### 6.1 固定事件枚举
```ts
type RunEventType =
  | "platform_stop"
  | "platform_pass"
  | "switch_pass"
  | "special_section_pass"
  | "system_change"
  | "service_type_change"
  | "line_transfer"
  | "through_service"
  | "coupling_operation"
  | "decoupling_operation"
  | "scenic_view"
  | "user_defined";
```

### 6.2 车窗绝景
车窗绝景必须支持两种锚定模式。

```ts
type ScenicViewAnchor =
  | {
      mode: "directional_view";
      orderIndex?: number;
      edgeRef?: EntityRef;
      side: "left" | "right" | "front" | "back" | "unknown";
      mapBearingDegrees?: number;
      bearingDegrees?: number;
      angleRangeDegrees?: [number, number];
      distanceMeters?: number;
      resolvedVehicleView?: {
        side: "left" | "right" | "front" | "back" | "unknown";
        relativeBearingDegrees: number;
        runDirectionBearingDegrees: number;
      };
      title?: string;
      description?: string;
      imageUrls?: string[];
    }
  | {
      mode: "fixed_map_point";
      pointRef?: EntityRef;
      coordinates: GeoJSON.Position;
      radiusMeters?: number;
      title?: string;
      description?: string;
      imageUrls?: string[];
    };
```

规则：
- `directional_view` 绑定运行方向、侧向、角度范围与距离，适合沿途车窗视角。
- 输入可先给地图绝对方向 `mapBearingDegrees`；`event-anchors.ts` 后续按运行 edge 的方向转换为车窗侧与相对方向，写入 `resolvedVehicleView`。
- `fixed_map_point` 绑定固定地图点，适合名胜、设施或拍摄点。
- 图片链接仅作为外部资源引用，不进入核心渲染资产管理。

### 6.3 用户创建事件
```ts
interface UserDefinedEventPayload {
  eventKey: string;
  title?: string;
  description?: string;
  entityRefs?: EntityRef[];
  customData?: Record<string, unknown>;
}
```

规则：
- 基础系统必须能保存、排序、导出与回放用户事件。
- 用户事件是额外事件层级，永不参与寻路；它只在时空语义上与车辆运行相对绑定，可绑定 order/time/entity/geometry anchor。

### 6.4 事件策略类型

```ts
type EventPolicyRef = string;

interface EventPolicy {
  policyId: EventPolicyRef;
  scope: {
    stationRefs?: EntityRef[];
    edgeRefs?: EntityRef[];
    eventTypes?: RunEventType[];
  };
  action: "mandatory_stop" | "pass_through" | "auto" | "skip_event";
  priority?: number;  // 多条策略冲突时数字大者优先
  reason?: string;
}
```

规则：
- `mandatory_stop`: 强制该站/区段生成 `platform_stop` 事件。
- `pass_through`: 强制生成 `platform_pass`（即使线路通常停靠此站）。
- `auto`: 由 `events.ts` 按默认规则决定。
- `skip_event`: 抑制该位置的指定类型事件（如跳过某段 scenic_view）。
- `EventPolicyRef` 作为 `RunSpec.eventPolicy` 的引用 id，也可在 `PatchOp` 中通过 `update_event_policy` 操作。

## 7. 编辑输出契约

### 7.1 PatchSet
```ts
interface PatchSet {
  patchId: string;
  baseSnapshotId?: string;
  source: "manual" | "auto_enrichment" | "debug_tool";
  ops: PatchOp[];
  diagnostics: Diagnostic[];
}

type PatchOp =
  | { op: "add_entity"; entity: NormalizedEntity }
  | { op: "update_entity"; entityRef: EntityRef; set: Record<string, unknown> }
  | { op: "replace_geometry"; entityRef: EntityRef; geometry: GeoJSON.Geometry }
  | { op: "link"; relation: GraphRelation }
  | { op: "unlink"; relationRef: EntityRef }
  | { op: "add_event_anchor"; anchor: EventAnchor }
  | { op: "update_event_policy"; policyRef: EntityRef; set: Record<string, unknown> };
```

### 7.2 Editable Snapshot
```ts
interface EditableRailGraphSnapshot {
  snapshotId: string;
  graph: RailGraph;
  runPlans?: RunPlanSnapshot[];
  pendingPatches: PatchSet[];
  diagnostics: Diagnostic[];
}
```

规则：
- 调试接口必须能导出 `EditableRailGraphSnapshot`。
- 自动补全生成的 patch 必须可预览、可应用、可撤销。
- 编辑输出只表达差异，不污染原始 GeoJSON/ORM 输入。

---

## 8. 对外接口类型

### 8.1 部署与固化

```ts
interface DeployedSystem {
  systemId: string;
  version: string;
  createdAt: string;
  servicePatterns: ServicePattern[];
  stations: StationMeta[];
  relations: GraphRelation[];
  defaultTimetables: TimetableSet[];
  generatedPresets: PathPreset[];
  contributions?: ContributionStore;
  contentHash: string;                    // sha256(canonicalJson(servicePatterns + stations + relations))
  presetHashes: Record<string, string>;  // presetId → runId
}

interface StationMeta {
  stationRef: string;
  name: string;
  nameJa?: string;
  coordinates: [number, number];    // [lat, lng]
  landmark?: boolean;
}
```

### 8.2 路径模板

```ts
interface PathPreset {
  presetId: string;
  label: string;
  shortLabel: string;
  serviceLabel: string;
  displayColor: string;
  startStation: StationRef;
  endStation: StationRef;
  viaStations: StationRef[];
  landmarkLabels: string[];
  directionLabel: string;
  estimatedTimeMinutes: number;
  distanceKm: number;
  runSpec: RunSpec;                // 内部引用，用户不可见
}
```

### 8.3 规划请求与结果

```ts
interface TripPlanRequest {
  presetId?: string;
  systemId: string;
  startStationRef: StationRef;
  endStationRef: StationRef;
  viaRefs?: StationRef[];
  directionPreference?: string;
  date?: string;
}

type PlanTripResult =
  | { status: "ok"; trip: TripResult }
  | { status: "unreachable"; reason: string; suggestions?: PathPreset[] }
  | { status: "invalid_request"; reason: string };
  // 注：失败时内层可附带完整 snapshot 供调试

interface TripResult {
  tripId: string;
  presetId?: string;
  planUsed: "preset" | "auto";
  segments: TripResultSegment[];
  totalDistanceKm: number;
  totalTimeMinutes: number;
  internalRunPaths: RunPath[];       // 内部固化数据，用户不可见
}

interface TripResultSegment {
  lineLabel: string;
  displayColor: string;
  fromStation: StationMeta;
  toStation: StationMeta;
  viaStations: StationStop[];
  landmarkLabel: string;
  distanceKm: number;
  timeMinutes: number;
  geometry: GeoJSON.LineString;      // [lat, lng][] 可直接渲染
  events: TripEvent[];
}

interface StationStop {
  station: StationMeta;
  stopType: "stop" | "pass";
  platformNumber?: number;           // 管理员预写入的站台序号
  platformName?: string;             // 生成文本，如 "1番線"
  arrivalTime?: string;
  departureTime?: string;
}
```

### 8.4 用户可见事件

```ts
type TripEvent =
  | TripStopEvent
  | TripPassEvent
  | TripTransferEvent
  | TripScenicEvent
  | TripNoteEvent;

interface TripStopEvent {
  type: "stop";
  source: "system" | "timetable";
  stationRef: StationRef;
  label: string;
  arrivalTime?: string;
  departureTime?: string;
  durationMinutes?: number;
  platformNumber?: number;
  platformName?: string;
}

interface TripPassEvent {
  type: "pass";
  source: "system" | "timetable";
  stationRef: StationRef;
  label: string;
  passTime?: string;
}

interface TripTransferEvent {
  type: "transfer";
  source: "transfer";
  label: string;
  timestamp?: string;
  fromLine?: string;
  toLine?: string;
  transferMode?: "alight" | "through";
  walkMinutes?: number;
}

interface TripScenicEvent {
  type: "scenic";
  source: "system" | "user";
  label: string;
  timestamp?: string;
  title?: string;
  description?: string;
  imageUrls?: string[];
  viewSide?: "left" | "right" | "front" | "back";
}

interface TripNoteEvent {
  type: "note";
  source: "user";
  label: string;
  timestamp?: string;
  text?: string;
  imageUrls?: string[];
}
```

### 8.5 行程保存

```ts
interface SavedTrip {
  savedId: string;
  name?: string;
  tripResult: TripResult;
  createdAt: string;
  systemId: string;
}
```

### 8.6 用户共建数据

```ts
interface EntityAnnotation {
  annotationId: string;
  targetRef: EntityRef;
  targetType: "service_pattern" | "station" | "edge";
  field: string;                     // "rollingStock", "wheelchairCar", "livery", ...
  value: string | number | boolean;
  confidence: "confirmed" | "reported" | "disputed";
  submittedBy?: string;
  submittedAt: string;
  evidence?: string;
}

interface ContributionStore {
  annotations: EntityAnnotation[];
  moderationQueue: string[];
}
```

规则：
- `EntityAnnotation` 挂在 `DeployedSystem.contributions` 上，与核心类型（ServicePattern/InfraEdge）完全隔离。
- 用户提交 `confidence="reported"` → 管理员审核 → `confirmed` 或删除。
- 字段名不穷举，社区自驱扩展。

### 8.7 内容寻址与快照

```ts
interface SystemContext {
  readonly graphId: string;            // sha256(canonicalJson(topo))——仅覆盖拓扑热层
  readonly graph: RailGraph;
  readonly diagnostics: readonly Diagnostic[];
  readonly createdAt: string;
}

interface RunContext {
  readonly runId: string;              // sha256(graphId + canonicalJson(spec))
  readonly graphId: string;            // 指向 SystemContext
  readonly spec: RunSpec;
  readonly path: RunPath | null;
  readonly renderPlan: RenderGeometryPlan | null;
  readonly order: RunOrder | null;
  readonly timeline: readonly TimelinePoint[] | null;
  readonly events: readonly RunEvent[] | null;
  readonly diagnostics: readonly Diagnostic[];
}

interface RunSnapshot {
  readonly runId: string;
  readonly graphId: string;
  readonly stageHashes: {
    readonly path: string | null;
    readonly renderPlan: string | null;
    readonly order: string | null;
    readonly timeline: string | null;
    readonly events: string | null;
  };
  readonly exportedAt: string;
}
```

规则：
- **两层模型**：`SystemContext` 是 graph 级（构建一次，多 run 共享）；`RunContext` 是 run 级（每个 RunSpec 一个，链式填充）。
- **内容寻址**：`graphId = sha256(topo)`（仅覆盖拓扑热层：nodes, edges, adjacency, edgeSequence, stationSequence, topologyType）。`runId = sha256(graphId + spec)`。同一 graph + spec 必然同 runId，可缓存。
- **graphId 不变语义**：修改 geometry、displayColor、displayName、landmark、eventAnchor、eventPolicy、provenance、diagnostics 等非拓扑字段不触发 graphId 变化——RunPath 缓存仍然有效，仅 renderPlan/events 缓存失效。
- **分层接口策略**：编排层函数使用 `(ctx) => ctx`（保证链路一致性与可复现）；内部算法函数可保持 `(topo, path, timeline)` 等显式参数纯函数风格——内部算法只接收 topo 而非整个 graph。
- **快照边界**：`RunSnapshot` 用于 debug 导出和缓存边界，不替代核心运行数据本身。
- **graph 拓扑变更** → graphId 变 → 所有 runId 失效。符合语义：共享根变了，下游全部重算。
- **反向索引**：`graph-builder.ts` 构建时同步填充 `patternsByEdge`、`patternsByNode`、`edgesBySection`、`tracksByPlatform`、`platformsByTrack`，支持 O(1) 的变更影响面查询。
- **hashes 列表**：`DeployedSystem.contentHash` 和 `presetHashes` 供部署校验完整性。
