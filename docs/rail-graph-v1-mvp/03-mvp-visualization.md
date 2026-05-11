# Rail Graph MVP — 可视化窗格

> 本文档说明 `rail-graph-v1-mvp` 在引入 Leaflet 地图 + 列表控件后的
> UI 布局、联动模式、颜色方案与 fallback 路径。
>
> 与 `01-mvp-reference.md` / `02-mvp-pathfinding.md` 的关系: 那两份是
> 模型与算法的事实快照, 本文档是**展示层**的事实快照。

---

## 1. 布局

```
┌────────────┬────────────────────────┬────────────────┐
│ Left 320px │ Map (flex 1)           │ Right 380px    │
│ ────────── │ ────────────────────── │ ────────────── │
│ GeoJSON    │ [Leaflet]              │ Tabs:          │
│ Demo btns  │                        │  Topology      │
│ Create     │ Toolbar: BaseLayer/Fit │  Pathfinding   │
│ Bind/Stop  │                        │  Diagnostics   │
│ Export     │                        │  Raw JSON      │
│ Feature    │                        │                │
│ list       │                        │ Detail panels  │
└────────────┴────────────────────────┴────────────────┘
```

三块由各自模块负责:
- **左**: `app.ts` 直接管理 (GeoJSON 输入 / demo 按钮 / 编辑表单 / feature 列表)
- **中**: `map-view.ts` 接管, Leaflet 地图 + 实体渲染 + hover/click
- **右**: `list-view.ts` 接管, tabs + 列表 + 详情

---

## 2. 模块职责

### 2.1 `map-view.ts`
- 初始化 `L.map(container)`, center 默认 `[35.69, 139.704]`, zoom 16
- 默认 base layer: **CartoDB Positron** (淡灰色, 路网弱). 可切换 "Plain" (无 tile, 白底)
- `update(topo, geoJson)`: 重建图层, 三类 entity:
  - track edges → `L.polyline`, 颜色按 `directionRole`
  - platform_area → `L.polygon` 黄色半透明
  - station_point → `L.circleMarker` 黑色
- `highlightEntities(primary, related)`: primary 加粗描白, related 用橙色描边
- `highlightPath(edgeSequence)`: 把 edges 叠一层鲜亮绿粗 polyline + 起终点 marker
- `clearHighlight()`: 还原所有 style + 清除路径叠层
- `onHover(handler)` / `onClick(handler)`: 暴露事件给外部
- `setBaseLayer(kind)`: positron / plain 切换
- `fitToData()`: 缩放到所有 entity 的 bounds

### 2.2 `list-view.ts`
- 内部 tabs: Topology / Pathfinding / Diagnostics / Raw JSON
- **Topology tab**: 6 个 sections, 每 section 含计数 + list-item 列表
  - Stations / Platforms / Edges / Bindings / StoppingPoints / DoubleTrackPairs
- **Pathfinding tab**: 每个 scenario 一个 expandable card
  - header: PASS/FAIL badge + 标题 + 候选数
  - 展开后显示 candidates (按距离升序), 每个候选含 `[idx] Xm · n edges · phase chips`
  - 点击 candidate → 显示 traceSequence 列表 (stop / pass / turnback entries)
- **Diagnostics tab**: 按 level (fatal/error/warn/info) 分组
- **Raw JSON tab**: 完整 topo + diagnostics + pathfinding 的 JSON 快照, 调试用 fallback

### 2.3 `app.ts` 桥接
- `initViews()` 在首次 render 时创建 mapView / listView 实例
- `refreshViews()` 每次 state 改动后调用, 同步 map + list
- 所有 demo button / form handler 末尾必须调 `refreshViews()`
- `computeRelatedRefs(ref)` helper 根据 ref 类型查 `buildTopologyLookup` 拿到关联实体 (station↔platforms↔edges)

---

## 3. 联动表 (hover/click 触发的高亮)

| 触发 | 主高亮 | 二级高亮 (related) |
|---|---|---|
| hover Station list-item / station marker | station 自身 | 所属 platforms + bindings.edgeRef |
| hover Platform list-item / platform polygon | platform 自身 | 所属 station + bindings.edgeRef |
| hover Edge list-item / polyline | edge 自身 | bindings.platformRef + bindings.stationRef |
| hover Binding / StoppingPoint list-item | edgeRef + platformRef | (依 list-view 内置 dataset.alsoRef) |
| hover Pathfinding candidate | — | **整条路径** (绿色叠层) |
| hover trace entry (stop/pass/turnback) | edgeRef | platformRef |

**单一高亮原则**: 新 hover 触发时上次的 entity 高亮和路径叠层都清空,
避免堆叠。点击 candidate 后, 路径叠层会保留 (不随后续 hover 单 entity 而消失),
直到下一次 candidate hover/click 或 `clearHighlight`。

---

## 4. 颜色方案

| 实体 | 渲染样式 |
|---|---|
| edge `directionRole=up_main` | 蓝色 polyline `#1d4ed8`, weight 4 |
| edge `directionRole=down_main` | 红色 polyline `#b91c1c`, weight 4 |
| edge `directionRole=reversible` / `siding` | 紫色虚线 `#7e22ce`, weight 4, dasharray `6,4` |
| edge `role=connector` / 其他 | 灰色细线 `#94a3b8`, weight 2, opacity 0.6 |
| station_point | 黑色 circle marker, radius 6, 白填充 |
| platform_area | 黄色 polygon `#fde047`, 半透明 (fillOpacity 0.55), 边 `#a16207` |
| **highlight primary** | 原色, weight +4, opacity 1, bringToFront |
| **highlight related** | 橙色描边 `#f59e0b`, weight +2 |
| **highlight path** | 鲜亮绿 polyline `#16a34a`, weight 7, opacity 0.85 |
| **path endpoint** | 深绿 circleMarker `#15803d`, radius 8, 白描边, tooltip Start/End |

### 4.1 列表内的颜色提示
- Phase chip: `up_run` 蓝底 / `down_run` 红底 / `turnback` 紫底
- Diagnostic badge: fatal/error 红 / warn 黄 / info 蓝
- Scenario badge: PASS 绿 / FAIL 红
- Trace entry 左边线: stop 蓝 / turnback 紫 / pass 灰

---

## 5. 路径高亮规则

`listView.onPathHover(edgeSequence)` 与 `onPathClick(edgeSequence)` 触发:

1. `mapView.highlightPath(edgeSequence)` 给 sequence 中每条 edge 叠一层粗绿 polyline
2. 起点 / 终点用深绿 marker 标注 (带 "Start" / "End" tooltip)
3. **不清除** 底层 edge 的本色 — 用户仍能看到方向上色, 只是被绿色压在上面
4. 后续任何 hover entity / 切换 candidate 都会清掉绿色叠层

候选列表的视觉:
```
[0] 1851m · 7 edges
[up_run] [turnback] [down_run]
  ← hover 整条路径变绿
  ← click 在卡内展开 trace 详情
```

Trace 详情 (展开后) 包含:
```
#0 ● stop @ PA · station:A · track:A1 · m=0.5
#1 ● stop @ PD · station:B · track:B2 · m=0.5
#2 ↺ turnback @ PD · station:B · track:B2 · m=0.5
#3 ● stop @ PB · station:A · track:A4 · m=0.5
```

每个 trace entry 可独立 hover, 高亮对应 edge + platform (但不重画路径绿层)。

---

## 6. 不变量与边界

1. **mapView / listView 之间不直接通信**, 必须经过 `app.ts` 的 callback 桥接
2. **list-view 不持有 topology lookup**, 关联高亮的 related 计算由 `computeRelatedRefs` 在 app.ts 完成 (因为 lookup 是 app.ts 的派生)
3. **首次 render 后**, `render()` 不再重建 DOM, 只走 `refreshViews()` + `renderFeatures()`
4. **Raw JSON tab 是 fallback**, 不应作为主要工作入口

---

## 7. 已知限制

- map 上 **没有编辑能力** (画 edge / 加 station). 编辑仍走左栏 textarea + Create Object form
- **一次只高亮一个 entity 或一条 path**, 无多选
- Platform polygon 在某些坐标下可能与 edge polyline 视觉重叠 (例如 PC 与 1番B 之前贴得太近, 已调整 LAT_PC 错开)
- 起终点 marker 仅基于 edgeSequence 几何, 不反映 measure (即不画"列车实际停车点", 留到后续)

---

## 8. 验证步骤

### 8.1 静态
```sh
npx tsc --noEmit -p tsconfig.json
```
预期 `rail-graph-v1*` 与 `rail-graph-v1-mvp/` 0 错误。

### 8.2 视觉 (dev server)
1. `npm run dev`, 打开 `/rail-graph-mvp.html`
2. 见到 3 列布局, 中部 Positron 底图, 右侧 4 个 tabs
3. 点 **"Pathfinding 4 场景"**:
   - map 自动 fit, 显示 2 站台体 + 4 platform + 17 edges (蓝/红/紫/灰按 directionRole)
   - 右栏 Topology tab 显示 6 sections, 各计数与底层一致
   - 右栏 Pathfinding tab 显示 4 个 PASS card
   - 切换 Pathfinding tab → 展开 S3 → click candidate `[0]`:
     - map 上 7 条 edges 变绿色粗线
     - candidate 内展开 traceSequence 4 entries (PA stop / PD stop / PD turnback / PB stop)
4. hover 某 list-item:
   - map 上对应 entity 高亮, related 实体变橙描边
   - 切换 hover 到另一 entity, 上次高亮自动清除
5. 切换 "Base" 下拉 → "Plain": 路网瓦片消失, 白底显示
6. 点 "Fit" 按钮: map 缩放回 data bounds

### 8.3 fallback
- Raw JSON tab 可见完整 JSON 快照
- 任何 demo 按钮 / form 操作出错时弹 `alert`, 同时 console.error
