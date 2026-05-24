# Rail Graph MVP — 类型、对象、流程与开放问题

> 本文档固化 Rail Graph v1 MVP 在 2 面 4 線 (双岛上下退避型) PoC 阶段
> 用到的全部类型、对象、操作流程、编译期诊断与未解决的设计问题。
> 与 `00-mvp-design.md` 的关系: 那一份是设计意图与边界, 本文档是
> 当前实现的事实快照。

---

## 1. 概览

MVP 验证 admin 一侧从 "标注后的 GeoJSON FeatureCollection" 到
"固定 `BaseTopologyLayer`" 的编译流程。范围:

- 导入未标注或已标注的 GeoJSON FeatureCollection
- 在 UI 中将 Feature 标注为 `railGraph.kind` 及若干显式角色维度
- 编译为 `BaseTopologyLayer` (nodes / edges / stations / platforms /
  bindings / stoppingPoints / doubleTrackPairs / adjacency)
- 手动创建 `PlatformTrackBinding`、确认 `StoppingPoint`
- 导出标注后的 GeoJSON、topology JSON、诊断列表

MVP 不构建服务模板 (Layer 2)、运行时径路 (Layer 3)、事件、时刻表、
用户可视输出。

入口:
- HTML: `rail-graph-mvp.html`
- 主逻辑: `src/rail-graph-v1-mvp/app.ts`
- 测试用例: `src/rail-graph-v1-mvp/poc-liangmiansixian.ts`

---

## 2. 类型清单

### 2.1 Primitives (`src/rail-graph-v1/primitives.ts`)

| 类型 | 说明 |
|---|---|
| `EntityRef` | 稳定实体引用, 格式 `{source}:{entityType}:{stablePart}` |
| `RawRef` | 未解析的弱引用 |
| `ISODateTime` | ISO 8601 时间串 |
| `DirectionLabel` | `up` / `down` / `clockwise` / `counterclockwise` / `unknown` |
| `EdgeMeasure` | 0-1 的 edge 内归一化里程 |
| `MeasureRange` | `{ startMeasure, endMeasure }` |

### 2.2 GeoJSON 几何 (`src/rail-graph-v1/geojson.ts`)

| 类型 | 说明 |
|---|---|
| `GeoJSONPosition` | `[lng, lat]` |
| `GeoJSONPoint` | Point 几何 |
| `GeoJSONLineString` | LineString 几何 |
| `GeoJSONMultiLineString` | MultiLineString 几何 |
| `GeoJSONPolygon` | Polygon 几何 |
| `GeoJSONMultiPolygon` | MultiPolygon 几何 |
| `GeoJSONGeometry` | 上述五种的 union |
| `GeoJSONFeature<TG, TP>` | 泛型 Feature 容器 |
| `GeoJSONFeatureCollection<TG, TP>` | 泛型 FeatureCollection |

### 2.3 Annotation Schema (`src/rail-graph-v1/annotation.types.ts`)

| 类型 | 说明 |
|---|---|
| `RailGraphFeatureKind` | `track_geometry` / `station_point` / `platform_area` / `switch_point` / `special_section` / `unknown` |
| `RailGraphTrackAnnotation` | 股道 annotation: `role` / `traversal` / `name` / `trackCode` / `physicalKind` / `functionalUse` / `directionRole` |
| `RailGraphStationAnnotation` | 车站 annotation: `name` |
| `RailGraphPlatformAnnotation` | 站台 annotation: `stationRef` / `name` / `number` / `type` |
| `RailGraphAnnotation` | 标注根: `kind` / `schemaVersion` / `id` / `source` / track? / station? / platform? |
| `AnnotatedFeatureProperties` | Feature properties + `railGraph` 字段 |
| `AnnotatedFeature` | 标注后的 Feature 别名 |
| `AnnotatedFeatureCollection` | 标注后的 FeatureCollection 别名 |

### 2.4 Base Topology (`src/rail-graph-v1/base-topology.types.ts`)

#### 2.4.1 节点与边
| 类型 | 说明 |
|---|---|
| `TopologyNodeKind` | `junction` / `line_endpoint` / `split_boundary` / `key_point` |
| `TopologyNode` | `id` / `kind` / `name?` / `geometryRef?` / `properties?` |
| `TopologyEdgeRole` | `main` / `platform` / `passing` / `connector` / `storage` / `yard` (旧一维标签, 过渡保留) |
| `TraversalDirection` | `both` / `forward` |
| `TrackPhysicalKind` | `main` / `siding` / `yard` / `lead` / `safety` — 物理身份 |
| `TrackFunctionalUse` | `through` / `stopping` / `passing` / `turnback` / `storage` — 运用功能 (多值) |
| `TrackDirectionRole` | `up` / `down` / `bidirectional` / `reversible` — 方向角色 (主/副本身份由 physicalKind 管, 不重叠); `reversible` 蕴含 `bidirectional` 的运行能力 + 额外允许换向 |
| `TopologyEdge` | `id` / `fromNodeRef` / `toNodeRef` / `traversal` / `role` / `name?` / `trackCode?` / `geometryRef?` / `lengthMeters` / `sourceSlice?` / **`physicalKind?`** / **`functionalUse?`** / **`directionRole?`** / `properties?` |
| `SourceGeometrySlice` | 几何切片溯源 |
| `GraphAdjacency` | `outEdges` / `inEdges` 索引 |

#### 2.4.2 车站层
| 类型 | 说明 |
|---|---|
| `Station` | `id` / `name` / `nameJa?` / `platformRefs[]` / `stationAreaRef?` / `positionRef?` |
| `PlatformType` | `side` / `island` / `bay` / `unknown` |
| `Platform` | `id` / `stationRef` / `type` / `name?` / `number?` / `areaRef?` |
| `PlatformTrackBinding` | `id` / `stationRef` / `platformRef` / `edgeRef` / `side` / `servingDirection?` |
| `StoppingPoint` | `id` / `stationRef` / `platformRef` / `edgeRef` / `direction` / `measure` / `confirmation` |
| `Signal` | `id` / `edgeRef` / `measure` / `facing: forward\|reverse\|both` / `name?` — **不参与寻径**, 仅可视化与标注。必须设在道岔外 (即站外延伸段或站间联络段上). |

#### 2.4.3 区间与关系
| 类型 | 说明 |
|---|---|
| `SpecialSectionCategory` | `bridge` / `tunnel` / `viaduct` / `cutting` / `other` |
| `DirectionSeparation` | `none` / `up_down_split` / `multi_bore` / `unknown` |
| `SpecialSection` | 桥/隧/路堑等特殊区间 (MVP 阶段不实例化) |
| `DoubleTrackPair` | `id` / `upEdgeRefs[]` / `downEdgeRefs[]` / `sharedGeometryEdgeRefs?` / `confirmation` |
| `BaseTopologyRelationKind` | `station_contains_platform` / `platform_serves_track` / `source_geometry_slice` / `transfer` |
| `BaseTopologyRelation` | `id` / `kind` / `fromRef` / `toRef` / `payload?` |
| `TopologyHardConstraint` | `forbid_traversal` / `forbid_transition` / `require_binding` / `closed_edge` 中的一种 |

#### 2.4.4 顶层容器
| 类型 | 说明 |
|---|---|
| `BaseTopologyLayer` | nodes / edges / adjacency / stations / platforms / platformTrackBindings / stoppingPoints / specialSections / doubleTrackPairs / relations / hardConstraints |

### 2.5 Editing Input (`src/rail-graph-v1/editing.types.ts`)

| 类型 | 说明 |
|---|---|
| `PlatformTrackBindingInput` | `stationRef` / `platformRef` / `edgeRef` / `side` / `servingDirection?` |
| `StoppingPointInput` | `stationRef` / `platformRef` / `edgeRef` / `direction` / `measure` |

### 2.6 Diagnostic (`src/rail-graph-v1/diagnostic-types.ts`)

| 类型 | 说明 |
|---|---|
| `Diagnostic` | `level: info\|warn\|error\|fatal` / `code` / `stage` / `message` / `context?` |

### 2.7 MVP 内部状态 (`src/rail-graph-v1-mvp/app.ts`)

| 类型 | 说明 |
|---|---|
| `RailGraphMvpState` | `source` (AnnotatedFeatureCollection?) / `bindings[]` / `stoppingPoints[]` / `topo` (BaseTopologyLayer?) / `diagnostics[]` |

---

## 3. 2 面 4 線 PoC 实例化对象清单

PoC 数据集: `src/rail-graph-v1-mvp/poc-liangmiansixian.ts`

### 3.1 GeoJSON 源 Feature (10 条)
| # | Kind | Geometry | 名称 |
|---|---|---|---|
| 1 | `station_point` | Point | 示例两面四线站 |
| 2 | `platform_area` | Polygon | A站台 (island) |
| 3 | `platform_area` | Polygon | B站台 (island) |
| 4 | `track_geometry` | LineString | 1番線 (上り本線) |
| 5 | `track_geometry` | LineString | 2番線 (上り副本) |
| 6 | `track_geometry` | LineString | 3番線 (下り副本) |
| 7 | `track_geometry` | LineString | 4番線 (下り本線) |
| 8 | `track_geometry` | LineString | 西咽-1-2 connector |
| 9 | `track_geometry` | LineString | 西咽-3-4 connector |
| 10 | `track_geometry` | LineString | 东咽-1-2 connector |
| 11 | `track_geometry` | LineString | 东咽-3-4 connector |

### 3.2 编译后实体计数

| 实体 | 数量 | 备注 |
|---|---|---|
| `TopologyNode` | 8 | 每条 main 的两端点 (西1/东1/西2/东2/西3/东3/西4/东4), connector 复用既有节点 |
| `TopologyEdge` | 8 | 4 main + 4 connector |
| `Station` | 1 | 示例两面四线站 |
| `Platform` | 2 | PlatformA, PlatformB, 都是 `island` |
| `PlatformTrackBinding` | 4 | A→1番(right/up), A→2番(left/up), B→3番(left/down), B→4番(right/down) |
| `StoppingPoint` | 4 | A 在 1/2 番, B 在 3/4 番, 各 `measure=0.5` |
| `DoubleTrackPair` | 1 | `up=[1番,2番]`, `down=[3番,4番]`, confirmation=`imported_confirmed` (auto-aggregated) |
| `BaseTopologyRelation` (`platform_serves_track`) | 4 | 每条 binding 同步生成一条 |
| `SpecialSection` | 0 | MVP 不实例化 |
| `TopologyHardConstraint` | 0 | MVP 不实例化 |

### 3.3 几何方向与 side 参考系
- 1番 / 2番 (上り) 几何方向 = 西 → 东 (匹配运行方向)
- 3番 / 4番 (下り) 几何方向 = 东 → 西 (匹配运行方向)
- side 沿 `from → to` 方向定义:
  - 1番: PlatformA 位于南侧 = `right`
  - 2番: PlatformA 位于北侧 = `left`
  - 3番: PlatformB 位于南侧 = `left`
  - 4番: PlatformB 位于北侧 = `right`

这个布局刻意演示了: **side 与 servingDirection (up/down) 无关,
仅由 edge 几何方向决定**。

---

## 4. 完整操作绑定流程

### 4.1 高层 pipeline

```
[Step 1] 准备/加载 GeoJSON FeatureCollection
            └─ buildLiangMianSiXianGeoJson()  或  paste/import
            ▼
[Step 2] loadGeoJson(raw)
            └─ 重置 state, 调 importGeoJson
            ▼
[Step 3] importGeoJson
            ├─ normalizeAnnotation: 填补 schemaVersion/id/source
            ├─ dedupeFeatures: 按 geometry+name fingerprint 去重
            └─ state.source ← 标注后的 GeoJSON
            ▼
[Step 4] compileTopology() 第一次
            ├─ Pass 1: stations  (station_point → Station)
            ├─ Pass 2: platforms (platform_area → Platform)
            ├─ Pass 3: tracks    (track_geometry → TopologyNode + TopologyEdge)
            │           └─ ensureNode 按 coordinateKey 自动去重端点
            ├─ buildAdjacency(topo.edges)
            ├─ addBindings        (state.bindings 为空 → noop)
            ├─ addStoppingPoints  (state.stoppingPoints 为空 → noop)
            └─ aggregateDoubleTrackPairs(topo.edges)
            ▼
[Step 5] for binding of BINDING_PLAN:
            addPlatformTrackBinding(b)
            └─ state.bindings.push, state.topo = null (失效)
            ▼
[Step 6] for stop of STOP_PLAN:
            confirmStoppingPoint(s)
            └─ state.stoppingPoints.push (clampMeasure 0-1)
            ▼
[Step 7] compileTopology() 第二次
            ├─ 同上 + addBindings/addStoppingPoints 这次有数据
            ├─ Binding 引用三类: station/platform/edge, 缺失任一发 error
            ├─ StoppingPoint 引用三类 + 与 Binding 交叉校验
            └─ aggregateDoubleTrackPairs 重新计算
            ▼
[Step 8] exportAnnotatedGeoJson()  → 深拷 state.source
[Step 9] exportTopology()           → state.topo
[Step 10] exportDiagnostics()       → state.diagnostics
```

### 4.2 State 失效不变量
任何 mutation 操作 (`annotateFeature` / `addPlatformTrackBinding` /
`confirmStoppingPoint` / `importGeoJson`) 都会把 `state.topo` 置为
`null`, 强制下一次访问通过 `compileTopology` 重建。这保证了
topology 永远反映最新的 annotation + bindings + stops。

---

## 5. 编译期诊断 (Diagnostic Codes)

| Code | Level | 触发条件 |
|---|---|---|
| `MVP_IMPORT_DEDUPED` | info | 导入时被 fingerprint 去重 |
| `MVP_NO_SOURCE` | fatal | compile 时没有加载源 |
| `MVP_UNKNOWN_FEATURE` | warn | Feature 没标注或 kind=`unknown` |
| `MVP_INVALID_TRACK_GEOMETRY` | error | `track_geometry` 不是 LineString/MultiLineString |
| `MVP_SHORT_TRACK_GEOMETRY` | error | LineString 少于 2 个坐标 |
| `MVP_TRACK_FUNCTIONAL_USE_UNDECLARED` | warn | `track.functionalUse` 缺失或为空 |
| `MVP_TRACK_PHYSICAL_KIND_UNDECLARED` | warn | `track.physicalKind` 缺失 |
| `MVP_TRACK_DIRECTION_ROLE_UNDECLARED` | info | `track.directionRole` 缺失 (此 edge 不参与 DoubleTrackPair 聚合) |
| `MVP_INVALID_STATION_GEOMETRY` | error | `station_point` 不是 Point |
| `MVP_INVALID_PLATFORM_GEOMETRY` | error | `platform_area` 不是 Polygon/MultiPolygon/Point |
| `MVP_PLATFORM_WITHOUT_STATION` | warn | Platform 无 stationRef 且 topo 中无可绑定的 station |
| `MVP_PLATFORM_TYPE_UNDECLARED` | warn | `platform.type` 缺失 (fallback `unknown`) |
| `MVP_KIND_DEFERRED` | info | annotation 已设但 MVP 不编译 (例如 `switch_point` / `special_section`) |
| `MVP_BINDING_MISSING_STATION` | error | binding 的 stationRef 不存在 |
| `MVP_BINDING_MISSING_PLATFORM` | error | binding 的 platformRef 不存在 |
| `MVP_BINDING_MISSING_EDGE` | error | binding 的 edgeRef 不存在 |
| `MVP_STOP_MISSING_STATION` | error | stopping point 的 stationRef 不存在 |
| `MVP_STOP_MISSING_PLATFORM` | error | stopping point 的 platformRef 不存在 |
| `MVP_STOP_MISSING_EDGE` | error | stopping point 的 edgeRef 不存在 |
| `MVP_STOP_NO_MATCHING_BINDING` | warn | stopping point 的 (platform, edge, direction) 无匹配 binding |
| `MVP_NO_TRACKS` | error | 编译后无任何 track edge |
| `MVP_SIGNAL_NO_DATA` | warn | `signal_point` Feature 缺 `signal` annotation 字段 |
| `MVP_TRACK_DIRECTION_ROLE_INFERRED_BIDIRECTIONAL` | info | edge 有 `traversal=both` 但无 `directionRole` → 自动填 `bidirectional` |
| `MVP_REVERSIBLE_WITHOUT_TURNBACK_ROLE` | warn | edge `functionalUse` 含 `turnback` 但 `directionRole` 不是 `reversible` (功能与方向身份不匹配) |

---

## 6. 设计不变量

### 6.1 `PlatformTrackBinding.side` 参考系
- 沿 `edge.fromNodeRef → edge.toNodeRef` 方向观察, `left`/`right` 为
  行进方向左/右。
- 与 `servingDirection` (`up`/`down`) 无关。
- 与 annotation 编辑顺序无关。
- edge 几何反向重建时, 所有引用该 edge 的 binding 必须同步翻转
  `left ↔ right`, `servingDirection` 不变。
- 岛式站台 (`Platform.type = "island"`) 由同一 platformRef 上的两条
  binding (一条 `side=left` + 一条 `side=right`) 表达双面靠车,
  MVP 不引入 `PlatformFace` 实体。

### 6.2 角色必须显式声明 (不得反推)
- `TopologyEdge.physicalKind` / `functionalUse` / `directionRole`
  必须从 annotation 显式传入。
- 编译器不得从 edge 位置、binding 状态、graph topology 推断
  `passing` / `siding` / `through`。
- "无 binding 的 edge 不是越行线" 是核心原则:
  无 binding 的 edge 可能是货物通过线、机走线、安全线等, 必须由
  annotation 说明。
- 缺失声明产生 warn diagnostic, 不静默 fallback 到具体值
  (`physicalKind` / `functionalUse` 不 fallback;
  `directionRole` 缺失则该 edge 不参与 `DoubleTrackPair` 聚合)。

### 6.3 Topology 编译的 lazy 失效
任何 mutation 后 `state.topo` 必须为 null, 直到下次显式
`compileTopology` 或 `exportTopology`。`state.diagnostics` 与
`state.topo` 同步更新, 不缓存陈旧诊断。

---

## 7. 已解决 vs 未解决问题

### 7.1 已升级为编译期诊断 (前一轮的 design observations)
- ~~Platform.type 未传播~~ → `MVP_PLATFORM_TYPE_UNDECLARED`
- ~~Binding.side 参考系模糊~~ → 文档 + doc-comment 锁定
- ~~Track 角色被位置反推~~ → 三类 `*_UNDECLARED` warn
- ~~DoubleTrackPair 未自动填~~ → `aggregateDoubleTrackPairs`
- ~~directionRole 命名混淆 (`up_main`/`down_main`/`siding` 把方向与主线身份绑死)~~ → 重命名为 `up`/`down`/`bidirectional`/`reversible`, 主/副本身份完全归 `physicalKind`
- ~~`bidirectional` 与 `reversible` 区分缺失~~ → 4 值 directionRole; `isTurnbackAllowed` 仅认 `reversible`
- ~~Signal 数据结构缺失~~ → 新增 `Signal` interface + `signal_point` annotation kind + `BaseTopologyLayer.signals[]`
- ~~`resolveSeed` filter bug (`servingDirection: "unknown"` 字符串被误排除)~~ → 改为 `!servingDirection || === "unknown" || === seed.direction`
- ~~寻径起点没有主/副线偏好~~ → `PathfindingResult.startKind` + 主线优先排序 + `PathfindingOptions.allowSidingStarts` (默认 true)
- ~~Stop-Binding 一致性未校验~~ → `MVP_STOP_NO_MATCHING_BINDING`

### 7.2 仍未解决 (留给后续 Layer)

| 严重度 | 问题 | 所在 Layer | 建议改进方向 |
|---|---|---|---|
| ~~**critical**~~ → **partial** | Route / 径路 缺失 | Layer 2 服务模板 / Layer 3 运行时径路 | **已部分解决, 见 [02-mvp-pathfinding.md](./02-mvp-pathfinding.md)**: 寻径算法已能输出 `edgeSequence` + `traceSequence` + `phases`, 表达完整径路与换向语义。剩余: Dijkstra/Yen's/评分、edge 中部起点、ServicePattern 上下文 |
| **major** | `switch_point` → `junction` 编译未实现 | Layer 1 后续迭代 | 让 `switch_point` Feature 编译为独立 `TopologyNode { kind: "junction" }`, connector edges 退化为该 junction 的进出枝, 支持 `forbid_traversal` 等硬约束 |
| **major** | 节点 degree 后置升级 | Layer 1 后续迭代 | compile 末尾扫描度数 ≥3 的 `line_endpoint`, 升级为 `junction` |
| **info** | Station boundary (站界) 概念缺失 | Layer 1 后续迭代 | Station 上增加 `trackScopedBoundaries: { edgeRef, startMeasure, endMeasure }[]`, 编译时校验 StoppingPoint.measure 在站界内 |
| **info** | 端点合并精度硬编码 | Layer 1 后续迭代 | `ENDPOINT_PRECISION = 6` 写死, 应接受 `mergeTolerance` 配置 |
| **info** | `cloneTopo` 深拷成本 | 优化 | 用结构化共享或 immutable 库 |

---

## 8. 文件布局

### 8.1 底层 (`src/rail-graph-v1/`)
| 文件 | 职责 |
|---|---|
| `primitives.ts` | 标量/引用 primitives |
| `geojson.ts` | GeoJSON 几何类型集 |
| `annotation.types.ts` | annotation schema (kind / track / station / platform) |
| `base-topology.types.ts` | Layer 1 全部类型 |
| `editing.types.ts` | admin editing input wrapper + draft/patch 类型 |
| `diagnostic-types.ts` | Diagnostic 容器 |
| `topology.ts` | helper: `buildAdjacency` / `buildTopologyLookup` / `aggregateDoubleTrackPairs` 等 |
| `types.ts` | barrel re-export |

### 8.2 MVP (`src/rail-graph-v1-mvp/`)
| 文件 | 职责 |
|---|---|
| `app.ts` | MVP UI + 编译 pipeline + state |
| `poc-liangmiansixian.ts` | 2 面 4 線 PoC 数据集 |
| `poc-liangmiansanxian.ts` | 旧 2 面 3 线 PoC, 留作历史参考, 不再被 import |

### 8.3 文档
| 文件 | 职责 |
|---|---|
| `docs/rail-graph-v1-mvp/00-mvp-design.md` | 设计意图 + 边界 + 不变量声明 |
| `docs/rail-graph-v1-mvp/01-mvp-reference.md` | 本文档: 类型/对象/流程/诊断的事实快照 |

---

## 9. 验证步骤

### 9.1 类型检查
```sh
npx tsc --noEmit -p tsconfig.json
```
预期: `rail-graph-v1*` 目录 0 错误。其它文件的 pre-existing 报错
与本 MVP 无关。

### 9.2 本地 dev server
1. 启动 vite dev server
2. 打开 `/rail-graph-mvp.html`
3. 按 "两面四線 Demo" 按钮
4. 检查右栏输出包含:
   - `summary.compiled.edges = 8`
   - `summary.compiled.stations = 1`
   - `summary.compiled.platforms = 2`
   - `summary.compiled.platformTrackBindings = 4`
   - `summary.compiled.confirmedStoppingPoints = 4`
   - `topologySnapshot.doubleTrackPairs` 内 1 条 pair, `upEdgeRefs` 与 `downEdgeRefs` 各含 2 个 edge id
   - `designObservations` 内仅剩 3 项 (switch_point / Route / Station boundary)
   - `diagnostics` 内 connector edges 触发 `MVP_TRACK_DIRECTION_ROLE_UNDECLARED` (info), 其余 main edges 完整

### 9.3 切到 "Sample" 数据集
应观察到:
- Feature 全部为 `unknown` → 多条 `MVP_UNKNOWN_FEATURE` warn
- 编译后无 tracks → `MVP_NO_TRACKS` error
- 无 platform_type → `MVP_PLATFORM_TYPE_UNDECLARED` warn

---

## 10. 后续可能的迭代方向 (备忘)

按价值 / 工作量排序:
1. **switch_point 编译为 junction** — 让咽喉道岔成为真正的拓扑节点
2. **Route 概念** (Layer 2) — 表达进出站完整径路与停靠顺序
3. **节点 degree 后置升级** + **mergeTolerance 配置** — 几何鲁棒性
4. **Station boundary** — 站界 measure 范围约束
5. **PoC 扩展** — 加 2 面 3 線 (国铁岛+侧组合型) 用例, 验证混合 type 行为
6. **switch 物理身份** — 单开 / 双开 / 复式 / 三开
7. **岔位状态** — 定位 / 反位 等运用态 (这里已超出 Layer 1 范围)
# 2026-05-24 Current MVP Workspace Sync

This note overrides older workflow references in this file when they conflict
with the current worktree. The MVP has expanded from the early two-station PoC
into a local admin/dev workspace.

- Entry: `rail-graph-mvp.html` and `src/rail-graph-v1-mvp/app.ts`.
- Workspace and local pipeline model/client:
  `src/rail-graph-v1-mvp/pipeline.ts`.
- Vite dev task API: `scripts/rail-graph-mvp-server.js`, mounted from
  `vite.config.js`.
- Workflow steps:
  `prepare -> clean -> annotate -> compile -> validate -> export`.
- Pipeline stages:
  `diagnose`, `extract`, `emitFast`, `postFix`, `match`, `manifest`,
  `planBatches`, `mergeOverride`.
- Local API routes:
  `/api/rail-graph-mvp/tasks`, `/api/rail-graph-mvp/tasks/:id`,
  `/api/rail-graph-mvp/tasks/:id/cancel`, `/api/rail-graph-mvp/artifacts`,
  `/api/rail-graph-mvp/artifact/read`.

These routes are Vite-only development glue around external `D:\GIS\scripts`,
PBF/cache, matched-output, batch, decision, and override artifacts. They are not
the final production API and do not replace the final Rail Graph runtime
pipeline. When this note conflicts with older sections in this file, prefer this note
and the current code.
