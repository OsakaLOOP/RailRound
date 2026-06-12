# Rail Graph 主应用事件交互方向简报

更新时间：2026-06-12

本文整理当前 rail-graph 主应用下一阶段的用户要求与整体方向。本文保持简洁，只固化需求和方向，不作为完整实现规格。

## 原始要求

- 进一步改进 rail-graph 阶段的应用交互和逻辑表现，使其更好满足：
  - `docs/rail-graph-v1-plan/15-main-app-data-and-interaction-flow.md`
  - `docs/rail-graph-main-app-flow.md`
  - `docs/rail-graph-main-app-ui-flow.md`
- 当前体验仍然像开发者随意填空，不像严格分类、严格状态管理、成熟用户友好 UI。
- 事件处理必须从松散分类标签转向严格类别和状态管理。
- 当前 UI 和逻辑存在大量重复、冗余和过度堆砌，需要简化。
- 当前事件数据结构不足以表达设计意图。
- scenic 点不能只是一个分类。它需要 facing、角度/范围限制，以及能在地图上显示方向和可视区域。
- MapView 右上角区域是 Leaflet 控件占位，现有 rail-graph 面板与其冲突。
- rail-graph 面板/控件应减少一次点击，改为智能贴边变形控件：未悬浮/未聚焦时只显示为侧边半透明扁长手柄，hover/focus/tap 后展开。

## 已确认方向

- 用户事件必须使用严格判别联合，这是强制要求。
- 一等事件类型必须驱动数据结构、字段校验、地图渲染、菜单动作和可编辑性。
- 可以保留 `custom` 逃生口，但它不能绕过 anchor、projection、visibility、diagnostics 等基础契约。
- rail event 的 canonical 锚点应为 `routeItemId + mileage projection`；坐标只作为地图显示所需的派生值或缓存值。
- 系统事件和用户事件可以共享 projection / visibility 基础结构，但系统事件必须只读，并带明确 provenance。
- legacy GeoJSON 仍是底层数据源兼容目标。
- 旧 `app-line:*` 用户事件格式不按上线后兼容迁移处理；因为该功能根本未正式上线，可以直接覆写到新契约。
- 低置信度推断或 legacy 修复问题应以 diagnostics 暴露，默认不静默失败，也不无条件阻止用户编辑。

## 第一轮问卷结论

除最后一项外，第一轮问卷均采用默认推荐答案：

1. 第一批一等用户事件采用核心 8 类：`scenic`、`media`、`warning`、`operationHint`、`transferIssue`、`temporaryChange`、`crowdingDelay`、`custom`。
2. 严格判别联合采用公共 envelope + typed payload；每个 `kind` 的 payload 必填且受约束。
3. `custom` 可存 label、color、free fields，但不能绕过 anchor、projection、visibility 契约。
4. rail event 的 canonical 锚点采用 `routeItemId + mileage projection`；坐标只是派生或缓存。
5. 范围型事件采用同一事件内的可选 `start/end mileage range`；点事件无 range 或零长度。
6. scenic 一等化字段包括 facing bearing、角度范围、可见距离或区段、相对侧、可选 target point。
7. scenic 的 facing 采用绝对 bearing degrees + 可选相对 side + 可选 target coordinate。
8. `transferIssue` 以 station 或 transfer edge 为主锚点，可选 route mileage projection 用于地图显示。
9. system event 和 user event 共享 projection/visibility envelope，但 system event 只读且 provenance 必填。
10. legacy `app-line:*` 用户事件不做兼容迁移；直接覆写为新契约，因为该功能尚未上线，不存在需要保护的生产数据兼容面。

## 事件语义方向

- `scenic`：视角/观景事件，应包含 bearing、relative side、角度/范围限制、可见区段或半径、可选 target point，并在地图上以箭头/扇区表达。
- `media` / `photo`：应区分拍摄锚点与可选被拍对象、target、facing；必要时复用 scenic 的 orientation 字段。
- `warning` / `hazard`：应包含 severity、hazard type、affected range、direction scope、effective time、action hint。
- `operationHint`：必须结构化到足以驱动地图、菜单和用户引导，不能只是文本备注。
- `transferIssue`：以 station 或 transfer edge 为语义对象，地图里程只服务显示和跳转。
- `temporaryChange`：需要 effective time window，以及可选 recurrence / service-day 规则。
- `crowdingDelay`：需要支持 range、time、severity 风格的筛选和显示。
- `custom`：用于保留用户灵活性，但受共享 event envelope 约束。

## 交互方向

- MapView 和 MileageEventsPanel 是用户事件创建/编辑主入口。
- TripPage 保持只读，只做概览、回放、跳转到 MapView 编辑。
- 事件拖动必须沿 mileage path 工作。
- 按住 Shift 拖动事件时应吸附到站点。
- 拖动手柄应是紧凑的、与路径平行的左右箭头，放在路径上方或下方。
- 范围型事件后续应支持整体平移和边缘 resize。
- 仅当相关线路/axis 激活时，点击事件对象本身才切换显示/详情。
- 屏蔽 Leaflet / 原生 focus outline 时，不能影响对象命中、点击或拖拽。
- 站点、线路、pin、event 等地图对象必须保持可点击，或按设计支持点击 + 拖拽。

## UI 简化方向

- 用可读 badge、source/status 元信息、明确禁用原因替代 raw ID 和调试式字段。
- 尽量把重复的 source/status/target/hint 卡片合并为紧凑 metadata strip。
- 在事件语义稳定前，不做无意义 batch/bulk UI。
- 整体视觉应偏紧凑工作台，不做装饰性、说明文案过重的 UI。
- Leaflet popup 不承载完整编辑器；地图只提供 quick actions，完整编辑留给 panel / inspector。
- 智能贴边 rail-graph 控件应避开 Leaflet 控件区域，减少地图遮挡。
- 所有可见 UI 文本和交互标签必须同步 i18next locales。

## 建议 PR 方向

1. 事件契约与严格判别联合。
2. Projection、anchor、range、diagnostics helpers。
3. Scenic facing 数据结构与地图渲染。
4. 通用事件地图交互：点击、选择、拖动、Shift 吸附、active-line gating。
5. MapView 智能贴边 rail-graph 控件。
6. MileageEventsPanel 与 EventInspector 简化。
7. scenic、media、warning、transfer issue、temporary change 等类型化编辑器。
8. system/user event 分离，以及未上线旧用户事件格式的直接覆写。
9. TripPage / Search / Export 消费统一事件契约。
10. 视觉 QA、交互 smoke tests、runtime/type tests、locale checks。

