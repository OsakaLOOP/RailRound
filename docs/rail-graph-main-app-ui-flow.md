# Rail-Graph Main App UI Flow

更新时间: 2026-06-05

本文定义主应用 rail-graph 阶段的 UI、交互和可见状态口径。旧 `docs/rail-graph-v1-plan/` 文档只作为背景；主应用实际实现以本文、`docs/rail-graph-main-app-flow.md` 和当前代码为准。

## 1. Scope

本轮只处理主应用。

MVP / aggregate 只要求导出产物可被真实 loader / smoke 读取，不扩展其 UI。用户时间层必须继续兼容 legacy GeoJSON、旧 saved trip 和 `app-line:*` mileage user event。

## 2. Product Vocabulary

| 词 | 主应用含义 |
| --- | --- |
| User event / 标注 | 用户在主应用创建和编辑的 `UserEventV2` / mileage event。 |
| System event | rail-graph runtime 或 deployment 给出的 stop / pass / transfer / operation 等只读事件。 |
| Saved snapshot | 保存到 `Trip.railGraph.tripResult` 的产品快照。 |
| Legacy GeoJSON | 当前 app 直接加载的 `public/geojson/**` / `railwayData`。 |
| Active route | 地图中当前选中的 trip route segment。 |
| Active axis | 当前事件面板正在查看或编辑的 mileage axis，可来自 saved snapshot 或 legacy GeoJSON。 |

## 3. UI Ownership

| Surface | Role | Must not do |
| --- | --- | --- |
| MapView | 用户事件主编辑面；路线选择；地图点、图钉、里程轴创建入口 | 不把一次路线点击直接等同于保存或创建事件 |
| MileageEventsPanel | 当前 route / axis 的事件查看、创建、编辑、删除 | 不显示无意义 batch/bulk 操作 |
| TripPage | 行程只读概要、运行摘要、里程 replay、跳转地图 | 不提供竞争性的事件编辑、复制、JSON/MDX 导出工具 |
| Search / Inspector | 快速定位 event / trip，并同步地图选择 | 不另建一套 selection 语义 |
| TripEditor | 规划、候选选择、保存 snapshot | 不修改 deployment / pattern / system event |

## 4. Active Selection State

主应用新增非持久化 UI 状态 `activeRailGraphSelection`：

```text
activeRailGraphSelection
  kind: route | event | axis
  source: rail_graph_snapshot | legacy_geojson
  lineKey
  tripId
  tripSegmentIndex
  routeItemId
  eventId
  label / color
  patternRef / direction / serviceType
  geometrySource: saved_snapshot | geojson | fallback
  anchor: lat / lng / tripRatio
```

该状态不进入 IndexedDB，不随用户数据同步。它只表示当前 UI 选择，用来对齐 MapView、MileageEventsPanel、TripPage 跳转和 Search 事件定位。

当前实现状态：

- Map route click 写入 `kind="route"`，打开事件面板但不直接进入创建草稿。
- MileageEventsPanel open handler 会保留同一路线的 `kind="route"` selection，避免覆盖掉 route click 的 `anchor` / run metadata；只有事件选择或不同 axis 才降级/切换 selection。
- Map route highlight 优先使用 `routeItemId`，避免同一 pattern / line 的多个 segment 被误认为同一选中对象。
- Event select 写入 `kind="event"`，地图 marker 与面板 inspector 可以同步。
- Map event marker click 会携带 `tripId`、segment index 和可解析的 `routeItemId`，优先按同一 product segment builder 写入 selection；聚合 marker 更新时会重绑 click handler，避免点击旧事件上下文。
- Panel open / close 写入或清除 active axis。
- `src/utils/railGraphSelection.ts` 统一 bridge projection source、product segment、event projection context 与 `activeRailGraphSelection` 的转换，避免 MapContainer / MileageEventsPanel / TripPage / Search / Inspector 各自手写 rail-graph vs legacy selection payload。
- Create 模式会继承当前 route selection 的 `anchor`，把 rail-graph route 写为 trip-position source，把 legacy route 写为 map source。
- TripPage replay / map editor jump、GlobalSearch event jump、EventInspector map jump 和 Map route click 会写入同一 selection，并尽量带上 `routeItemId`、segment index、label、color、pattern/service/direction metadata。
- PinEditor 从图钉创建用户事件前会写入 legacy GeoJSON active axis，并把 pin 坐标作为 create map source 传给 MileageEventsPanel。
- MileageEventsPanel 在 rail-graph snapshot axis 下直接读取 rich projection 的当前 route events；GeoJSON place/time 查询不会误套到 snapshot route 上。

## 5. Route Click Contract

路线点击的语义顺序是：

```text
click route
  -> select active route
  -> highlight selected route and dim other routes
  -> open MileageEventsPanel on the selected axis
  -> user explicitly chooses Create
  -> composer inherits selected route anchor
```

这样避免“只是查看路线却进入创建”的误触，同时保留从选中线路快速创建标注的效率。

## 6. TripPage Contract

TripPage 的 event center 是只读概要：

- 顶层展示 event count、snapshot / GeoJSON axis badge、运行摘要。
- 展开后展示 line slices 与 mileage replay。
- 主操作只有打开地图编辑器。
- event row 可以跳转地图并选中事件。
- 不提供 copy / JSON / MDX 事件工具；这些应放在地图事件面板或独立导出入口。

## 7. Visual Language

所有 rail-graph / user event 元数据优先使用 React 组件：

- `RailGraphBadge`
- `RailGraphEventPill`
- `RailGraphSymbol`
- `compactRailGraphRef`
- `railGraphDirectionLabel`
- `railGraphRunBadgeItems`
- `RailGraphRunBadges`
- `railGraphBadgeHtml`

当前实现状态：

- pattern / service / direction / source / geometry / user event badge 已在主应用多处复用。
- `compactRailGraphRef` 统一负责把 raw pattern / preset refs 压缩为用户可读短标签，完整 ref 只放 `title` / 详情。
- `RailGraphRunBadges` 统一负责 React UI 中 service / direction / pattern 的顺序、配色、方向翻译和 pattern title。
- `railGraphRunBadgeItems` / `railGraphBadgeHtml` 负责 Leaflet HTML tooltip 的同语义输出。
- Leaflet route metadata 使用 `railGraphBadgeHtml` 生成同一套 SVG + text badge，不再用普通 `<dl>` 表格堆 raw id。
- 当前 axis 的事件列表不再每行重复 source/time；source 由面板 header 承担，time 只在 time 查询等有定位价值的场景显示。
- rail-graph 用户事件行会直接显示 service / direction / pattern badge，legacy 行继续显示 GeoJSON axis context。
- EventInspector、MileageEventsPanel、TripsPage、TripEditor、GlobalSearch、ExportRouteModal 和 route tooltip 的 direction 显示使用同一翻译口径，不再直接展示 raw direction。
- EventComposer 与 EventInspector 的 linked trip 文案使用日期、rail-graph/legacy 来源和线路摘要，不再把 trip id 作为主显示内容。
- EventInspector 的 createdFrom 来源只显示已翻译来源或 Unknown；TripEditor 手动段落按钮和自动规划起终点按钮显示可读 line label，内部 lineKey 只保留为辅助 title。
- GlobalSearch trip result、TripsPage replay / event center 和 EventComposer trip segment summary 对未解析 station 只显示 Unknown，不把 station id 当作站名；trip id 仍可参与搜索但不作为搜索结果主文案。
- Route slice / KML 产品投影使用日期、线路摘要和可读站名；未解析站名显示 Unknown，不再把 trip id 或 station id 写进导出主标题。
- Map route popup 的 rail-graph / legacy subtitle 未解析站名显示 Unknown，不再退回到 fromId/toId；TripsPage 旧段落和 legacy KML fallback 名称使用线路摘要，不再把 lineKey 或 `Trip {id}` 当主文案。

Raw id 只进入 tooltip 或详情，不作为主展示文案。

EventComposer 当前已经把 station / map / mileage / trip 四种创建来源从普通 tabs 改为 source cards。每张 card 必须同时展示：

- 创建来源；
- 投影目标：GeoJSON axis、saved snapshot、legacy trip 或不可用状态；
- 一句短提示，说明这次事件会如何被投影；
- 明确 disabled reason，而不是只让 Create 按钮变灰。
- 当前实现已把不可用原因显示到每张 source card 上，并额外区分“没有 trip”和“选中 trip 没有可投影 segment”；窄视口先单列展示 source card，避免 disabled reason 挤压主要标签。

## 8. Remaining PR Work

### PR UI-1 - Active selection hardening

- `railGraphSelection.ts` 已集中 bridge conversion、ProductTripSegment -> selection、event projection context -> selection、panel projection detail、open-detail route match 和 Map route item source override；MapContainer bridge handler 已减少 active axis 双写，active axis 主要从 store selection 派生。
- Search、Inspector、TripPage 跳转与 Map route click 已直接写同一状态；后续继续把 window event 桥接限制在 Leaflet / DOM 边界。
- Map event marker click 已补齐 trip / segment / route context，不再只传 eventId + lineKey。
- PinEditor 已接入同一 selection，并通过纯 helper 覆盖 pin create -> legacy active axis -> panel map-source create payload。
- PinEditor 的 snap 标题和事件轴提示使用可读 line label，不把 lineKey 作为主显示文本。
- StationMenu 的线路 tooltip 也使用同一 `lineLabel()` 口径，避免菜单、地图和编辑器显示不同版本的线路名。
- 全局拖拽 overlay 的 line fallback 使用 `lineLabel()`，避免无 name 的拖拽项显示 raw lineKey。
- StationSearchModal / GlobalSearchModal 的线路搜索结果使用同一 `lineLabel()` 口径；raw lineKey 仍可参与搜索匹配，但不作为结果主文案。
- `lineSelectorBuilder` 也使用 `lineLabel()` 生成分类线路列表 displayName，LineSelector / StationSearchModal 分类页与搜索页保持一致。
- 已增加 focused tests 覆盖 projection source 映射、event select、axis/open 转换、active axis 派生、panel projection detail、open-detail route match、rail-graph/legacy product segment selection、event projection context、Map route explicit source override 和 pin create bridge payload；EventComposer 已有 jsdom smoke 覆盖 source card 可见 target、disabled reason、map center 请求入口和 linked trip 文案；GlobalSearch 已有 jsdom smoke 覆盖 trip id 可搜索但不作为结果主文案；route serializer 覆盖导出失败时不把内部 line/station id 暴露为错误主文案，ExportRouteModal 会把这些错误映射到四语 i18next 文案。后续补组件级测试验证 route click / TripPage jump 的 DOM/Leaflet 行为。

### PR UI-2 - MileageEventsPanel redesign

- Header 已改成当前 route / source / geometry / event count / pattern / direction / service 的视觉摘要，后续继续做浏览器窄屏视觉 QA。
- 当前 axis event rows 已去掉重复 source/time，并补 rail-graph run context badges；active segment 未解析站名显示 Unknown，不再回退到 station id；后续继续统一 Inspector / Search 的 raw ref 与详情层级。
- EventComposer source cards 的视觉语言已上提到 MileageEventsPanel create area；每张 source card 直接显示投影目标和不可用原因，移动窄屏先单列显示。
- 禁用态显示明确原因：无 GeoJSON line、无 station、无 map point、无 trip 或 trip 没有可投影 segment。
- EventInspector 信息格、操作区和 EventSearchPanel 高级筛选已改为窄视口优先单列/紧凑响应式布局，减少长站名、线路名和操作文案挤压。

### PR UI-3 - Map route metadata polish

- Route metadata 已从 click popup 降级为轻量 hover tooltip；click 只负责选择 route / active axis 并打开事件面板。
- Route click 不抢编辑语义。
- Selected / dimmed / selected event 的视觉层级已有基础，后续继续做 hover 和 mobile QA。

### PR UI-4 - Export modal source/error polish

- ExportRouteModal 已不再把 geoData 缺失作为 saved rail-graph snapshot 导出预览的前置阻断；如果 snapshot 自带 route geometry，可直接生成 route slice preview。
- 导出失败错误按 missing line / missing station / disconnected route / empty trip / unknown failure 映射为 i18next 文案，未知异常不直接透传内部 id 或堆栈式信息到 UI。

### PR UI-5 - Visual QA

- Desktop / mobile 检查 MapView、MileageEventsPanel、TripPage、Search、TripEditor、ExportRouteModal。
- 修复 overflow、重复信息、raw id 直显、颜色一体化和按钮文案过长。
- 继续审计是否还有页面绕过 `RailGraphRunBadges` 或 `railGraphBadgeHtml` 手写 service / direction / pattern。
