# Rail Graph 主应用数据与交互流程

更新时间: 2026-06-04

本文定义主应用的实现口径。早期 `rail-graph-v1-plan` 文档仍作为设计背景，但当前 UI、数据流和测试以本文与代码为准。

## 1. 术语

| 术语 | 主应用含义 |
|---|---|
| rail-graph deployment | 管理端生成、发布给主应用读取的只读运行数据，包含 `SystemContext`、`DeployedSystem`、`PathPreset`、template、station、relation。 |
| pattern | 已确认的服务运行形态。主应用只消费 pattern 的线路、方向、停靠、事件、geometry，不编辑 pattern。 |
| preset | 管理端发布的推荐运行选择。用户可选 preset，但不会修改 preset。 |
| system event | rail-graph runtime 生成或管理端发布的 stop / pass / transfer / scenic 等事件。主应用只读展示。 |
| user event | 用户在主应用创建的 `UserEventV2` / mileage event，也就是“标注”。用户只能编辑这类事件。 |
| saved trip snapshot | 保存到 `Trip.railGraph.tripResult` 的产品快照。默认不保存 `runtimeArtifacts`。 |
| legacy GeoJSON | 当前主应用直接加载的 `public/geojson/**` 与旧 `railwayData` 路径。它继续可规划、可显示、可导出、可投影用户事件。 |

## 2. 不变量

1. 主应用中的 rail-graph deployment 是只读数据源。
2. 用户不能在主应用中修改 topology、deployment、pattern、preset、template、system event。
3. 用户“标注”只指 `UserEventV2` / mileage event。
4. 自动规划优先使用 rail-graph；rail-graph 不可用或结果不能被当前 app 数据消费时 fallback 到 legacy routing。
5. 用户时间层必须兼容旧 legacy GeoJSON 与 `app-line:*` mileage context。
6. rail-graph saved trip 应优先从 `Trip.railGraph.tripResult` 展示、搜索、统计、导出和投影用户事件。
7. 手动修改 trip segments 会清除旧 rail-graph snapshot，避免 legacy segments 与 rail-graph 产品快照不一致。

## 3. 自动规划流程

```text
用户选择 start/end
  -> appRoutePlanner 解析 app station 到 rail-graph stationRef
  -> 生成候选:
       1. exact PathPreset candidates
       2. direct ServicePattern direction candidates
       3. best auto rail-graph result
       4. legacy fallback result
  -> TripEditor 展示候选
  -> 用户选择候选
  -> AppRailGraphTripResult 转为 legacy-compatible Trip
  -> 保存 Trip.railGraph.tripResult 产品快照
```

候选选择发生在自动规划之后。主应用 UI 不要求用户先理解 pattern 或 preset；用户只需要从候选中比较线路、方向、服务类型、经由站、时间、距离和关键事件。

## 4. 用户标注流程

```text
用户在 trip / station / mileage / map point 创建事件
  -> EventComposer 生成 UserEventV2
  -> mileageUserEvents 按当前 context 写入 mileage ref
  -> saved trip detail model 投影到 rail-graph trip 或 legacy trip
  -> UI 在 trip replay / event center 展示
```

rail-graph trip 的用户事件默认绑定当前 trip，同时保留 `systemRef`、`lineRef`、`patternRef`、`direction`、`distanceMeters`。legacy trip 继续使用旧 `app-system:*` / `app-line:*` context。

## 5. 主应用 UI 面

| 位置 | rail-graph 新内容 | 交互 |
|---|---|---|
| TripEditor 自动规划 | planner 状态、候选列表、pattern/preset/direction、service type、via stations、关键 system events、fallback reason | 搜索后选择候选；选择后写入 trip snapshot；可切回手动编辑并清除 snapshot。 |
| TripEditor 手动/保存前详情 | 当前 rail-graph snapshot 的只读运行摘要、系统事件摘要、用户标注入口提示 | 不编辑 rail-graph 内容，只保存 trip 与用户字段。 |
| TripsPage card | pattern/direction/service type 摘要、经由与关键事件、用户事件数量 | 展开 event center 查看 trip replay、添加用户事件、导出用户事件。 |
| TripsPage event center | departure/arrival/transfer/scenic/user event 默认展示；stop/pass/viaStations 折叠在详情中 | 添加、查看、定位、复制、导出用户事件。 |
| Map / Stats / Search / Export | 通过产品投影读取 saved snapshot 的 geometry、里程、线路、站点、事件 | legacy 与 rail-graph 共存。异常或导出详情才强调 fallback/source。 |

视觉口径：主应用是工作型记录工具。rail-graph 信息应紧凑、可扫描、可比较；不使用大面积装饰性卡片或营销式说明。

## 6. 数据源与 fallback

rail-graph source 在普通状态下以友好摘要出现，例如线路、方向、服务类型、候选名称。只有在异常、导出、详情和调试状态中显示具体 fallback/source reason。

legacy GeoJSON 不是临时兼容层，而是主应用仍需支持的数据源。旧 saved trip、旧 direct GeoJSON line、旧 `app-line:*` 用户事件必须继续通过测试。

## 7. PR 要点

### PR19 · 主应用数据流重构

- 新增主应用 rail-graph 数据与交互流程文档。
- 新增 rich trip detail model，统一输出 rail-graph / legacy trip 的 overview、segments、events、geo source。
- 新增候选 planner API，保留 `planAppRoute()` best-result 兼容。
- 测试覆盖 rail-graph rich model、legacy fallback model、用户事件投影和 candidate planner。

### PR20 · TripEditor 候选选择 UI

- 自动规划从“立即写入唯一结果”改为“展示候选 -> 用户选择 -> 写入 snapshot”。
- 候选卡展示 pattern/preset/direction/service type、via station 数、关键事件、距离和时间。
- 当前 snapshot 展示只读运行详情，用户编辑 segments 时清除 snapshot。
- 所有新增 UI 文案同步四语言 i18next。

### PR21 · TripsPage rail-graph 详情接入

- trip card 从 source badge 升级为运行摘要：pattern/direction/service type、via、关键 system events、用户事件数量。
- event center 使用 detail model 合并 system events 与 projected user events。
- user event composer 默认绑定当前 trip，legacy trip 继续使用旧 context。
- 保持旧 GeoJSON trip 的现有展示与事件投影。

### PR22 · 其他主应用消费面收敛

- Search / Map / Export 按 detail model 或 product projection 读取 saved snapshot。
- geo source/fallback 只在异常、导出和详情中突出。
- 增加浏览器级 UI smoke 前，先用 focused Vitest 和 TypeScript gate 固定数据流。

## 8. 2026-06-04 Implementation Update

本轮把主应用剩余 rail-graph UI 接入面收敛到同一套数据解释：

- Map route layer: saved rail-graph route geometry now carries source metadata, pattern, direction, service type, distance, stop/pass/via summary, user-event count, and a distinct popup. Legacy GeoJSON routes continue through the existing cache/worker path; only missing geometry is marked as fallback.
- Map event layer and global event selection: mileage user events now use a rich display projection. Legacy `app-line:*` events still project from current GeoJSON data, while rail-graph events linked to saved trip snapshots project from `Trip.railGraph.tripResult`.
- Mileage event creation/search/inspection: creating an event from a rail-graph trip position now writes rail-graph mileage context (`systemRef`, `lineRef`, `patternRef`, `direction`) instead of falling back to legacy app-line context. Search, list, and inspector use the same rich projection.
- Stats page: added a compact rail-graph run section focused on saved snapshots, legacy compatibility, user events on snapshots, top patterns, directions, and service types.
- Chest route flow: the chest ticket action now opens TripEditor auto routing and triggers the shared candidate selector instead of silently saving the single best result.
- Product projection: `ProductTripSegment` now exposes rail-graph metadata needed by main-app UI (`systemRef`, `lineRef`, `patternRef`, `direction`, `serviceType`, and stop/pass/via counts) while legacy segments remain compatible.

## 9. 2026-06-04 Main App UI Refinement

本轮按“主应用优先”的口径继续收敛 UI，而不是扩展 MVP 工作台 UI：

- TripEditor auto planning panel now exposes a compact source strip: rail-graph runtime readiness, loaded preset/pattern counts, fallback reason, current candidate mix, and the save semantics.
- Route candidate cards now distinguish `Saves snapshot` from `GeoJSON fallback`, so the user can see whether choosing the route persists a rail-graph run snapshot or legacy segments.
- Saved rail-graph trip details now explicitly label the route as a saved trip snapshot before showing plan, preset, service type, direction, stop/pass/via, and projected user events.
- MileageEventsPanel now shows the current mileage axis, event count on that axis, and the source contract: rail-graph trip events project from saved run snapshots, while legacy events remain on `app-line:*` mileage axes.
- The event panel preserves selected event inspection even when no GeoJSON line axis is currently available; creation is still guarded until a usable line axis exists.

这些改动不改变数据模型，不降低旧 GeoJSON 行程、旧 `app-line:*` 用户事件和 direct GeoJSON 加载的兼容性。
