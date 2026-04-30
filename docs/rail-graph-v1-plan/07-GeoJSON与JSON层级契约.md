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
      lineRef?: string;
      trackCode?: string;
      stationRef?: string;
      direction?: "up" | "down" | "both" | "unknown";
      serviceable?: boolean;
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
  infraLayer: {
    nodes: InfraNode[];
    edges: InfraEdge[];
    areas: InfraArea[];
    sections: SpecialSection[];
    adjacency: GraphAdjacency;
  };
  serviceLayer: {
    serviceEdges: ServiceEdge[];
    doubleTrackRelations: DoubleTrackRelation[];
    directionRules: DirectionRule[];
    systemRules: SystemRule[];
  };
  eventLayer: {
    anchors: EventAnchor[];
    policies: EventPolicy[];
  };
  indexes: RailGraphIndexes;
  provenance: ProvenanceRecord[];
  diagnostics: Diagnostic[];
}
```

## 5. 运行 JSON 层级

### 5.1 RunSpec
```ts
interface RunSpec {
  runId?: string;
  startRef: EntityRef;
  endRef: EntityRef;
  viaRefs?: EntityRef[];
  directionHint?: "up" | "down" | "clockwise" | "counterclockwise" | "unknown";
  pathOverride?: ManualPathOverride;
  timetableAnchors?: TimetableAnchor[];
  eventPolicy?: EventPolicyRef[];
  editMode?: "read_only" | "preview_patch" | "apply_patch";
}
```

### 5.2 RunPath / RenderGeometryPlan / RunOrder / Timeline / EventStream
```ts
interface RunPath {
  edgeSequence: EntityRef[];
  nodeSequence: EntityRef[];
  chosenDirection: string;
  resolvedBy: "manual" | "auto" | "mixed";
  candidateScores: PathScore[];
}

interface RenderGeometryPlan {
  geometrySource: "physical_edges" | "dynamic_offset" | "mixed";
  stitchedEdgeRefs: EntityRef[];
  offsetSegments: OffsetGeometrySegment[];
  smoothing: OffsetSmoothingPlan[];
  diagnostics: Diagnostic[];
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
