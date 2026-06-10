# Rail-Graph Main App Data and Interaction Flow

本文是主应用 rail-graph 接入的当前口径。早期
`docs/rail-graph-v1-plan/` 仍可作为背景资料，但主应用 UI、状态和交互实现以本文和当前代码为准。

## 1. Scope

本轮只关注主应用。

不重做 `rail-graph-v1-mvp` 或 aggregate UI。它们只需要满足导出产物可被真实 loader / smoke 读取，不要求完整覆盖全部数据质量。

主应用必须同时支持：

- rail-graph saved trip snapshot：`Trip.railGraph.tripResult`
- legacy GeoJSON trip：当前直接加载的 `public/geojson/**` / `railwayData`
- 用户标注：`UserEventV2` / mileage event

本文中的“标注”只指用户事件，不指 MVP/admin 中的 GeoJSON feature annotation。

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| Rail-graph deployment | App 启动时读取的只读运行数据。用于规划、候选、pattern/source metadata。 |
| Saved run snapshot | 用户选择 rail-graph route 后保存在 trip 上的 `TripResult`。主应用展示、搜索、地图、导出都优先读它。 |
| Legacy GeoJSON axis | 旧 app 直接加载的线路里程轴。旧 trip、旧标注和自由图钉仍必须可用。 |
| User event / 标注 | 用户在主应用创建和编辑的 mileage event。地图页是主编辑面。 |
| System event | rail-graph 运行中生成的 stop / pass / transfer / operation 等只读事件。 |
| Active axis | 当前地图和面板正在编辑或检查的 mileage axis，可以是 rail-graph snapshot segment，也可以是 legacy GeoJSON line。 |
| Active route | 当前地图被选中的 trip route segment。它应驱动 active axis，而不是另建一套状态。 |

## 3. Invariants

1. 地图页是标注编辑主入口；Trip 页只做概要、只读回看、里程轴预览和跳转。
2. Trip 页和地图页不得各自维护一套标注语义。所有选择、创建、查看地图都走同一组 bridge event。
3. 用户标注可以挂在 rail-graph snapshot，也可以挂在 legacy GeoJSON axis。不能强制迁移旧数据。
4. rail-graph 信息应优先展示用户能理解的 service / direction / pattern / source summary，而不是 raw id 堆叠。
5. 时间、名称、source 等信息只在有定位或判断价值时出现；避免同一条目上下重复。
6. 不提供无意义 batch/bulk UI。列表可以多选用于导航或过滤，但不能包装成用户并不需要的批量操作。
7. 非方向 / 强制方向 workflow 的导出语义属于 MVP / aggregate 产物加载约束；主应用只消费可加载结果。
8. legacy GeoJSON 与旧 `app-line:*` 用户事件是一等兼容路径；时间层、scenic 等常规事件可以推断，不因 legacy source 默认禁用。
9. 只有只读 system event、缺失必要锚点、权限/同步冲突、或无法定位任何 axis 时禁用编辑；低置信度推断显示 diagnostics，不阻断编辑。

## 4. Data Flow

### 4.1 App Runtime

```text
AppLayout
  -> loadDefaultRailGraphDeployment()
  -> railGraphRuntime / railGraphLoadState in store
  -> planAppRoute()
       -> rail-graph first when runtime and app station mapping are usable
       -> legacy routing fallback when unavailable
```

### 4.2 Saved Trip

```text
TripEditor / route planner candidate
  -> choose rail-graph candidate
  -> save Trip.railGraph.tripResult
  -> product projection and rich detail model
       -> TripsPage summary
       -> Map route geometry
       -> GlobalSearch
       -> Event projection
       -> ExportRouteModal / KML
```

Manual segment editing clears stale rail-graph snapshot and returns the trip to legacy GeoJSON segments.

### 4.3 Active Selection

`activeRailGraphSelection` 是主应用唯一非持久 UI selection 真源。window bridge 只保留 Leaflet / DOM 边界，不保存业务状态。

该状态使用 discriminated union：

- `routeSelected`: 地图 route 被选中，并派生 active axis。
- `axisSelected`: 当前查看或编辑的 rail-graph snapshot segment / legacy GeoJSON axis。
- `eventSelected`: 当前选中用户事件或可定位事件，必须绑定 route / axis 上下文。
- `creating`: 正在创建用户标注，继承当前 route / axis anchor。
- `inspecting`: 正在检查对象，不自动进入创建。
- `unavailable`: 缺失必要上下文或权限时的显式不可用状态，必须带 reason。

旧 `kind: route | axis | event` 只作为迁移期兼容别名；新逻辑必须以 `state` 为准。

### 4.4 User Event / 标注

```text
Map route click / pin / map point / TripPage jump
  -> openMileageEventsPanel(detail)
  -> MileageEventsPanel derives active axis
  -> EventComposer writes UserEventV2
       rail-graph trip source: systemRef / lineRef / patternRef / direction / tripId / segmentIndex
       legacy source: app-system / app-line / lineKey
  -> selectMileageEventOnMap(detail)
  -> MapContainer highlights marker and dims non-active routes
```

TripPage event rows should call map selection/opening APIs; they should not become a competing editor.

### 4.5 Scenic / Viewpoint

Scenic 不再只是 event kind。系统 scenic 与用户 scenic 共享 `ScenicViewpointPayload`：

- 必须有 mileage / anchor 与 `facing: left | right | front | back`。
- `targetBearingDegrees`、`visibleBearingRangeDegrees`、角度容差可由 projection 推断。
- projection 必须输出 confidence、diagnostics 和 visibility status。
- visibility status 固定为 `visible | opposite_side | angle_mismatch | unknown | unavailable`。

Rail-graph snapshot 使用 run geometry / direction 推断 scenic visibility。Legacy GeoJSON 使用线路局部几何和地图点推断 bearing / side，并标记 `inferred_from_geojson`；用户可用地图方向控件修正。

## 5. UI Responsibilities

| Surface | Role | Required state |
| --- | --- | --- |
| Map route layer | Primary route selection and route-to-event creation | active route, active axis, rail-graph vs legacy source, selected/dimmed route styling |
| MileageEventsPanel | Primary标注 editor and inspector | current axis, source, event count, projection status, create source, selected event |
| EventComposer | Create/edit one标注 | source mode, projection target, fallback/disabled state, linked trip |
| EventInspector | Inspect/edit one标注 | event type, projection context, map/records jump, source metadata |
| TripsPage | Read-only trip and标注 overview | saved snapshot summary, mileage event preview, map jump, no duplicate editing workflow |
| GlobalSearch | Fast navigation | source badges, event/trip metadata, map jump for标注 |
| TripEditor | Route planning and saved snapshot review | candidate source, pattern/service/direction, save semantics, no direct rail-graph mutation |
| ExportRouteModal | Export truth | saved snapshot vs legacy route, exportable key events, geometry source |

Map route click 的语义顺序固定为：

```text
click route
  -> state = routeSelected
  -> derive active axis
  -> highlight route and dim non-active routes
  -> expand compact MileageEventsPanel handle
  -> user explicitly chooses Create
```

点击 route 不直接创建草稿。

## 6. Visual Language

Use `src/components/rail-graph/RailGraphBadges.tsx` for rail-graph and event symbols.

Required badge families:

- source: saved snapshot, legacy GeoJSON
- run pattern: pattern, service, direction
- geometry: distance, duration, stops, via
- system events: departure, arrival, transfer, reverse, formation, service switch, scenic, stop, pass
- user标注: note, scenic, warning, operation hint, custom

Badges should carry metadata, not repeat surrounding title/time text. Raw refs can appear in tooltip or detail rows, not as the primary label.

Map chrome 使用统一安全区：Leaflet layer / zoom 控件不占 rail-graph 面板右上区域；RailGraph handle 默认是右侧半透明扁长手柄，hover / focus / route select 时展开为摘要入口。移动端使用底部或右侧自适应手柄，并支持 tap / drag 展开和收起。

Current shared entry points:

- `RailGraphRunBadges` for React service / direction / pattern metadata.
- `railGraphRunBadgeItems` for converting the same metadata to badge records.
- `railGraphBadgeHtml` for Leaflet route tooltip HTML with the same icon/tone semantics.
- `railGraphDirectionLabel` for direction translation across React and Leaflet surfaces.

## 7. Current Progress

Current implementation is approximately 75-78 percent complete for the main-app UI goal.

Done:

- rail-graph runtime loading and route planning fallback path exist.
- saved rail-graph trip snapshots are consumed by Trips, Map, Search, Export, Event projection.
- `RailGraphBadges` centralizes SVG badge symbols for route, source, system events, and user标注 types.
- GlobalSearch, EventInspector, MileageEventsPanel, TripEditor, ExportRouteModal now use the shared badge language.
- Map route click and pin create can open the标注 panel with a usable mileage axis.
- Active mileage line / route dimming infrastructure exists in `MapContainer`.
- `activeRailGraphSelection` is the shared non-persistent UI selection across Map route click, TripPage jump, GlobalSearch event jump, EventInspector map jump, and MileageEventsPanel.
- Map event marker clicks preserve trip id, segment index, and route context when projection data is available.
- `railGraphSelection.ts` centralizes bridge source conversion plus ProductTripSegment / event projection context / Map route item selection payloads, including legacy GeoJSON compatibility and explicit rail-graph source overrides.
- `mileage-events:active-line` bridge state has been removed; active axes now derive from `activeRailGraphSelection`, while window events remain for Leaflet/DOM selection, open, fly-to, and map-point boundaries.
- Scenic payload now flows through system events, user events, projection, and MapView rendering as a shared viewpoint/visibility contract instead of a plain event category.
- MapView renders scenic visibility as a first-class Leaflet layer with status-colored fan/ray/origin geometry, plus distinct scenic marker styling.
- Selected scenic user events expose explicit viewpoint controls in EventComposer/EventInspector and draggable MapView handles for bearing, angle tolerance, and range.
- MileageEventsPanel closed state is a right-edge translucent handle that opens on pointer hover for mouse/pen, tap/click for touch, and drag-to-open/drag-to-close on touch/pen.
- MileageEventsPanel header import/export controls are grouped under a compact action menu instead of two permanent header buttons.
- TripPage event center has moved toward read-only overview and map jump instead of competing event editing/export tooling.
- Route metadata uses the shared badge visual language in React surfaces and Leaflet HTML.

Still incomplete:

- Map selected route, selected event marker, dimmed routes, hover metadata, and touch metadata still need visual QA.
- EventComposer and MileageEventsPanel need more narrow-screen visual QA and disabled-reason QA.
- TripPage still needs replay/route visualization simplification and more top-level run summary polish.
- Visual QA for mobile/desktop has not been completed.

## 8. PR Plan

### PR1 - Main-app flow document

Add this document as the authoritative main-app flow.

### PR2 - TripPage read-only overview

- Replace event-center editing affordances with read-only trip event previews.
- Keep map jump, selected event jump, export, and mileage-axis preview.
- Move any creation/edit action to MapView.

### PR3 - MapView active route/axis state model

- Introduce one active route/axis descriptor shared by route click, event select, TripPage jump, and pin create.
- Ensure rail-graph snapshot segment and legacy line both use the same bridge API.
- Make selected route / selected event / active axis visually distinct and reversible.

### PR4 - MileageEventsPanel as primary editor

- Redesign header around active axis, source, projection status, and selected route.
- Make create modes clearer: station, map point, mileage, trip position.
- Remove any remaining batch/bulk wording from mileage event UI.

### PR5 - EventComposer source clarity

- Replace plain source tabs with compact icon controls and source cards.
- Show whether the new标注 will be written to saved rail-graph snapshot or legacy GeoJSON axis.
- Disable impossible creation states with explicit reason.

### PR6 - Route popup and map metadata polish

- Rework popup hierarchy: source, service/direction/pattern, geometry source, event count.
- Avoid duplicate line/title/time text.
- Keep legacy/fallback readable without making fallback look like the normal path.

### PR7 - Load/export smoke

- Verify legacy GeoJSON time/event projection still works.
- Verify default deployment, MVP export, and aggregate export can be loaded by real loader/smoke.
- Do not expand MVP UI scope.

### PR8 - Visual QA and cleanup

- Run desktop/mobile visual checks for MapView, TripsPage, GlobalSearch, TripEditor, ExportRouteModal.
- Fix overflow, repeated text, unclear disabled states, one-off colors, and stale wording.
