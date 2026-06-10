# Rail Graph v1 70% 推进与用户端 90% 执行计划

更新时间: 2026-06-04

本文承接 `11-完全集成实施计划.md`、`12-原始设计偏离审计与产品接入修正.md`、`13-阶段变更验收与最终成品总结.md`，并参考外部进度追踪笔记 `D:\DCMT\dev notes\未命名 3.md`。旧设计文档只作为目标背景，执行判断以当前代码、测试和静态产物为准。

## 1. 本轮探索结论

探索确认：PR9-PR11 的主要成果已经进入基线，不再是待提交工作树；本轮在此基础上补齐默认 deployment、loader smoke、legacy GeoJSON 用户事件回归、transfer scorer 与 load status。

- app 启动已尝试加载 `/rail-graph/deployed-system.json`：`src/AppLayout.tsx` -> `loadDefaultRailGraphDeployment()`。
- 默认 bundle loader、bundle shape 校验、export/build 脚本已经存在：`src/services/railGraphDeploymentLoader.ts`、`scripts/build-rail-graph-deployment-bundle.ts`、`scripts/export-rail-graph-deployment.mjs`。
- 自动规划入口已接入 rail-graph facade：`src/utils/appRoutePlanner.ts`、`TripEditor.tsx`、`Chest.jsx`。
- saved trip 产品快照已存在：`Trip.railGraph.tripResult`，默认不保存 `runtimeArtifacts`。
- search/stats/latest/export/KML 的产品投影入口已存在：`src/utils/tripProductProjection.ts`、`src/core/tripCalculator.js`、`StatsPage.tsx`、`GlobalSearchModal.tsx`。
- mileage UserEvent 已优先从 rail-graph `TripResult.mileageProfile` 投影：`src/utils/mileageUserEvents.ts`。
- `npm run rail:integration:verify` 已覆盖 runtime、deployment verify build、app route planner、saved trip round-trip、product projection、TypeScript 和根 build。

本轮已闭合的关键事实：

- `public/rail-graph/deployed-system.json` 已存在，且是 minimal direction-aware bundle，不是 no-direction verify substitute。
- `npm run rail:deployment:assert` 会阻止 no-direction verify 产物进入默认产品 deployment。
- MVP snapshot 和 aggregate deployment verify bundle 已有真实 load smoke；MVP workflow 明确声明 `workflow.exportMode="forced_direction"`，并允许 no-direction pathfinding result 作为工作台导出。
- transfer 已从固定共享站 300m 升级为 runtime scorer，支持显式 relation、forbidden、walk/wait/penalty 和产品事件成本输出。
- legacy 直接 GeoJSON / `app-line:*` 用户事件已进入回归测试，rail-graph 优先投影不会破坏旧线路数据。
- app runtime load 状态已有 `railGraphLoadState`，可记录 loaded / not_found / invalid / error 与 fallback reason。

仍待闭合的关键事实：

- 没有 Playwright 或真实浏览器级 smoke；现有新增测试证明 loader / facade / store / projection / planner，不证明实际 DOM 点击流和地图像素。
- rail-graph 与 legacy 仍双轨并存，最终默认切换后的 UI smoke 和清理门禁仍需后续 PR。
- 默认数据覆盖是 minimal，数据端尚未达到全量 compiled aggregate 覆盖。

新增硬约束：

- 用户事件/时间投影层必须兼容旧的非 rail-graph 数据，也就是当前 app 直接加载的 `public/geojson/**` 与 legacy `railwayData` / `app-line:*` context。rail-graph runtime 可以成为优先来源，但不能让既有 GeoJSON 线路、旧 saved trips、旧 mileage events 失效。
- `rail-graph-v1-mvp` 与 `rail-graph-aggregate` 的导出必须可被真实加载。这里的“真实加载”指 app/deployment loader 或明确的 import/load smoke 能读入导出产物并形成可消费 runtime / workspace state；不要求覆盖全量线路或完整数据质量。
- MVP 导出必须显式声明 workflow export mode：`no_direction` 或 `forced_direction`。导出时按声明选择处理方式；`no_direction` 的寻路结果也视为可导出工作台产物。这个许可不等于允许 no-direction bundle 进入默认产品 deployment。

## 2. 进度口径

当前不是外部笔记中的 42% 状态；PR9-PR11 已进入基线，本轮又完成默认 deployment、真实加载 smoke、legacy GeoJSON 用户事件回归、runtime transfer scorer 与 load status 后，建议重估为：

| 维度 | 当前 | 目标 | 判断 |
|---|---:|---:|---|
| runtime / deployment 契约 | 85% | 85% | 默认 bundle、真实 loader smoke、MVP/aggregate export load smoke 与 transfer scorer 已闭合。 |
| app 接入骨架 | 90% | 90% | TripEditor/Chest 共享的 `planAppRoute()` 已用默认 bundle + 当前 GeoJSON smoke 证明可走 rail_graph；浏览器级 UI smoke 属于发布级后续验证。 |
| 用户端功能可用面 | 90% | 90% | saved/search/stats/latest/export/mileage 的产品投影已在 gate 中覆盖；视觉渲染级 Playwright 不计入本轮功能接入口径。 |
| 数据端 | 50% | 50%-60% | 默认数据为 minimal direction-aware bundle，允许不完整但可真实加载、可被 app 消费。 |
| gate / 发布可信度 | 85% | 85% | integration gate 已包含默认 bundle assert、export/load smoke、legacy GeoJSON UserEvent regression、transfer scorer tests。 |

综合当前约 **70%-72%**。其中“用户端 90%”按功能接入面、数据流和 gate 口径成立；真正浏览器 UI smoke、视觉非空截图和跨视口验证仍作为发布前余项保留。

达到总体 70% 的最低定义：

1. app 默认可加载一个非 no-direction 的 rail-graph deployment bundle。
2. TripEditor 和 Chest 的自动规划在 smoke 中实际走 `source: "rail_graph"`。
3. 保存后的 rail-graph trip 可在 Trips、Map/latest card、Stats、GlobalSearch、mileage event、route export/KML 中消费。
4. runtime 缺失、bundle invalid、rail-graph result 不可被 legacy UI 消费时仍安全 fallback。
5. transfer scoring 至少支持显式关系、禁止换乘和 walk/wait 成本。
6. gate 能阻止 no-direction bundle 进入默认 `public/rail-graph/deployed-system.json`。
7. 旧 GeoJSON / legacy `app-line:*` 用户事件、旧 saved trips、旧 route export 不回归。
8. MVP 与 aggregate 导出的最小样例能被真实 loader smoke 读入。

## 3. 全接入面验收矩阵

| 接入面 | 当前状态 | 发布级后续补强 |
|---|---|---|
| 默认 runtime 加载 | loader + 默认 bundle + load state 已存在 | Playwright 验证真实页面启动后 runtime loaded；invalid/not_found 继续 fallback。 |
| TripEditor 自动规划 | 已走 `planAppRoute()`，facade smoke 证明默认 bundle 返回 rail_graph | 浏览器点击流 smoke 证明保存含 `railGraph.tripResult`。 |
| Chest 自动规划 | 已走同一 `planAppRoute()` facade | 浏览器拖入/出票流程 smoke 证明保存 rail-graph trip，不丢产品快照。 |
| SavedTrip / cloud round-trip | 已有 API/load round-trip 测试，默认不保存 runtime artifacts | Playwright 保存/重新载入真实点击流。 |
| Trips records | 已用 `tripToProductSegments()`，stale legacy segments 已有回归 | 浏览器记录页视觉 smoke。 |
| Map/latest cards | latest stats 已读 rail-graph geometry，product projection 已覆盖 | 地图像素/路径非空截图 smoke。 |
| Stats | 已优先产品投影，latest stats 已有 rail-graph snapshot 测试 | 浏览器 stats 页 smoke。 |
| GlobalSearch | 已优先产品投影，搜索文本已有 projection 回归 | 浏览器搜索弹窗 smoke。 |
| Mileage UserEvent | 已从 mileageProfile 投影，真实 GeoJSON legacy 回归已覆盖 | 浏览器记录页事件展示 smoke。 |
| Legacy GeoJSON / app-line UserEvent | 已有真实 `WILLER TRAINS.geojson` parser 回归 | Playwright 记录页 smoke 证明用户可见投影不回归。 |
| Route export / KML | `tripProductProjection` 已覆盖 rail-graph route slice/KML 坐标与 metadata | 浏览器导出按钮 smoke。 |
| MVP / aggregate export | 已有真实 loader smoke；MVP snapshot 已声明 `workflow.exportMode` | 后续数据覆盖率审计。 |
| Legacy fallback | facade 已 fallback，store 已记录 fallback reason | 浏览器 smoke 覆盖 invalid bundle 时仍可 legacy 规划。 |

## 4. PR 执行计划

### PR14 · 默认 deployment bundle 与发布校验

目标：

- 让 app 默认路径能加载 rail-graph runtime，而不是永远 fallback。
- 数据允许不全，但默认 bundle 必须是 direction-aware / non no-direction，不能用 verify substitute 冒充产品数据。

主要修改：

- 新增或生成 `public/rail-graph/deployed-system.json`。
- 可选新增 `public/rail-graph/deployed-system.meta.json`，记录 source aggregate、mode、generatedAt、contentHash、coverage note。
- 新增 `scripts/assert-rail-graph-deployment.mjs`，校验默认 bundle 存在、`system.graphId === deployed.sourceGraphId`、`sourceMode !== "no-direction-graph"`、至少 1 个 preset、至少 1 条可被 app `railwayData` 消费的线路。
- 修改 `scripts/verify-rail-graph-integration.mjs`，把默认 bundle assert 加入 gate；verify-only bundle 仍输出到 `.verify`。
- 如果真实 compiled aggregate 尚不足，先导入一个最小 direction-aware compiled topology 子集，覆盖 1-2 条线和 2-4 个 ServicePattern。
- 新增 MVP / aggregate export load smoke：从导出文件到 `parseRailGraphDeploymentBundle()` 或 aggregate import/load API 完整走一遍，证明导出不是只能给 verify 脚本消费。
- MVP snapshot export/load smoke 检查 `workflow.exportMode`；`no_direction` pathfinding result 作为工作台导出允许通过，只有发布到默认产品 deployment 时才被 assert 拦截。

验收：

- `npm run rail:deployment:build -- --aggregate-key <compiled-key>` 能生成默认 bundle。
- `npm run rail:deployment:export -- --input <bundle.json>` 能写入 `public/rail-graph/deployed-system.json`。
- `node scripts/assert-rail-graph-deployment.mjs` PASS。
- 不允许 `--allow-no-direction-verify` 的产物进入 `public/rail-graph/deployed-system.json`。
- MVP 导出和 aggregate 导出的最小样例均能被真实 loader smoke 读入；覆盖不足只记录 diagnostics，不作为加载失败。
- MVP snapshot 明确记录 `workflow.exportMode`，且 no-direction 寻路结果不因“非方向”本身被判为不可导出。

执行状态（2026-06-04）：

- 已新增 `scripts/build-minimal-rail-graph-deployment.ts`，从当前 `public/geojson/WILLER TRAINS.geojson` 构建最小 direction-aware deployment bundle。
- 已生成默认 bundle：`public/rail-graph/deployed-system.json`，元数据：`public/rail-graph/deployed-system.meta.json`。当前覆盖为 minimal，线路 `WILLER TRAINS:宮津線`，4 站，1 preset。
- 已新增 `scripts/assert-rail-graph-deployment.mjs`，默认 bundle 必须存在、可被 app legacy GeoJSON 消费、且不是 no-direction verify 产物。
- 已新增 `scripts/smoke-rail-graph-export-load.ts`，验证默认 deployment 与 aggregate verify deployment 均可被真实 loader 读取。
- 已新增 `src/__tests__/rail-graph-export-load-smoke.test.ts`，验证 MVP Senseki snapshot 可 export/import round-trip，并断言 `workflow.exportMode="forced_direction"`、`noDirectionPathfindingExportable=true`。
- 已更新 `npm run rail:integration:verify`，加入默认 bundle assert、export/load smoke 和 MVP snapshot smoke。
- 已修复 `ExportRouteModal.tsx` 中 route export auto 参数的 station id 类型收窄，解除 TypeScript gate 阻断。
- 最新 `npm run rail:integration:verify`：PASS，包含 `tsc --noEmit`、root src build 与 blog build。

### PR15 · 用户端 workflow smoke

目标：

- 证明用户真实路径可用，而不是只证明 adapter 函数可用。

主要修改：

- 新增浏览器 smoke。优先选择 Playwright；若暂不引入新依赖，先用 Vite + jsdom/component smoke，但最终用户端 90% 需要 Playwright。
- 新增测试入口，例如 `tests/rail-graph-app-smoke.spec.ts` 或 `src/__tests__/integration/rail-graph-app-smoke.test.ts`。
- 增加可测试 hook：在 dev/test 下暴露 rail-graph runtime loaded 状态和 last route source，避免靠脆弱 DOM 文案判断。
- 覆盖 TripEditor 自动规划、Chest 自动规划、保存后 records/stats/search/latest 的消费链。
- 覆盖 legacy GeoJSON / app-line 用户事件链：从当前 `railwayData` 构建 mileage context、创建事件、保存、查询、投影到旧 trip。

验收：

- app 加载默认 bundle 后 store 中 `railGraphRuntime` 非空。
- TripEditor 从 A 到 B 自动规划得到 `source="rail_graph"`。
- 保存 trip 后 JSON 含 `railGraph.tripResult`，不含默认 `runtimeArtifacts`。
- records/search/stats/latest card 均能从 rail-graph snapshot 读到线路、站点、里程、geometry。
- runtime 缺失时同一 smoke 仍可 fallback legacy。
- 旧 GeoJSON 线路仍可创建 legacy `app-line:*` mileage event，并能在旧 saved trip 上投影。

执行状态（2026-06-04）：

- 已在 `src/__tests__/rail-graph-app-route-planner.test.ts` 增加默认 bundle smoke：通过 `loadDefaultRailGraphDeployment()` 读取 `public/rail-graph/deployed-system.json`，再用 `parseGeoJsonBatch()` 解析当前 `public/geojson/WILLER TRAINS.geojson`，调用 `planAppRoute()` 断言返回 `source="rail_graph"`。
- 同一 smoke 验证规划结果可转为 app saved trip，`railGraph.tripResult` 保留、`runtimeArtifacts` 默认不保存。
- 已在 store 增加 `railGraphLoadState`，记录 loaded / not_found / invalid / error 与 fallback reason；失败不改变 legacy fallback 行为，也不新增 UI 文案。
- 已在 `src/__tests__/mileage-events-runtime-adapter.test.ts` 增加真实 GeoJSON legacy 回归：直接解析 `WILLER TRAINS.geojson` 得到旧 `railwayData`，创建 `app-line:*` mileage event，覆盖 display/query/status/trip projection。
- 尚未引入 Playwright；浏览器级 TripEditor/Chest 点击流、地图像素非空和跨视口截图留到发布前 UI smoke。

### PR16 · 产品消费面补齐与去重

目标：

- 把所有用户消费面统一到 `tripProductProjection`，减少 `trip.segments` 与 `trip.railGraph.tripResult` 的分叉判断。

主要修改：

- 审计并收敛 `TripsPage.tsx`、`StatsPage.tsx`、`GlobalSearchModal.tsx`、`AppLayout.tsx`、`tripCalculator.js`、route export/KML 调用点。
- 对仍直接读 `trip.segments` 的展示/导出路径，改为 `tripToProductSegments()` 或更窄的产品投影函数。
- 补充 `trip-product-projection.test.ts`，覆盖 route slice、KML、records display model、legacy stale segments。
- 保持 UI 文案不变；如新增用户可见 fallback/status 文案，必须同步四语言 i18next key。
- 保持 legacy GeoJSON path slicing 与 `railwayData` station lookup 作为产品投影 fallback，不把所有用户数据强制转换为 rail-graph schema。

验收：

- stale legacy segments 不影响 rail-graph trip 在 records/search/stats/export 中展示。
- legacy trip 行为不回归。
- 直接加载 GeoJSON 的 legacy trip 仍能计算 visual path、里程、导出 KML/route slice。
- `npm run rail:integration:verify` 的 product projection 段覆盖新增测试。

### PR17 · Transfer scoring 与显式换乘关系

目标：

- 从“共享站可换乘”升级为可解释、可排序、可禁止的 transfer planner。

主要修改：

- 新增 `src/rail-graph-v1/transfer-scorer.ts`。
- 扩展 deployment/runtime 可消费的 transfer relation：shared station、walkMinutes、waitMinutes、penalty、forbidden、samePlatform 等。
- 修改 `src/rail-graph-v1/trip-planner.ts`，把固定 `TRANSFER_COST_METERS` 替换为 scorer。
- 复用或对齐 `src/rail-graph-aggregate/cross-pattern/*` 的 relation 模型，避免 aggregate 与 runtime 两套语义。
- 扩展 `TripEvent` transfer 字段：walkMinutes、waitMinutes、transferMode、reason/diagnostics。

验收：

- 多个共享站时选择总成本最低的 transfer。
- forbidden relation 会被避开。
- wait/walk/penalty 能改变排序，但不反写 fixed topo。
- transfer event 显示 walk/wait 成本。
- 旧共享站最小 transfer fixture 仍 PASS。

执行状态（2026-06-04）：

- 已新增 `src/rail-graph-v1/transfer-scorer.ts`，提供 `TransferScoringPolicy`、显式 relation、默认 300m 成本、walk/wait minute cost、penalty、forbidden、samePlatform、through/alight mode。
- `DeployedSystem` 与 `TripPlanRequest` 均可携带 `transferPolicy`；`trip-planner.ts` 会合并 deployed policy、topology `kind="transfer"` relation 和 request policy。
- `resolveCrossPatternPlan()` 已由固定 `TRANSFER_COST_METERS` 改为 `scoreTransfer()`；`forbidden` relation 会跳过，walk/wait/penalty 会参与排序。
- `TripTransferEvent` 已增加 `waitMinutes`、`costMeters`、`reason`，产品事件能解释换乘排序原因。
- `src/__tests__/rail-graph-trip-planner.test.ts` 新增 scorer 回归：默认共享站行为保持、penalty 可改排序、forbidden 会避开，transfer event 输出 walk/wait/cost/reason。

### PR18 · 默认路径切换、失败态与 gate 收敛

目标：

- 把 rail-graph 作为用户端目标默认路径固化，同时保留 legacy fallback。

主要修改：

- store 增加 rail-graph load status：not_found / invalid / loaded / error，以及 last fallback reason。
- `planAppRoute()` 保持 rail-graph first；对不可消费结果输出结构化 reason，供 smoke 和 debug 使用。
- `verify-rail-graph-integration.mjs` 加入默认 bundle assert、workflow smoke、transfer scorer tests。
- `verify-rail-graph-integration.mjs` 加入 MVP / aggregate export load smoke 与 legacy GeoJSON / app-line UserEvent regression。
- 更新 `docs/rail-graph-v1-plan/13` 与本文件执行结果。
- 更新 `repo_map_and_entrypoints_2026-04-26.md`。

验收：

- 默认 bundle 存在时 smoke 中 route source 必须是 `rail_graph`。
- 默认 bundle 缺失/invalid 时 smoke 中 route source 必须是 `legacy`，并保留 fallback reason。
- legacy GeoJSON 用户事件与旧 saved trip smoke PASS。
- MVP / aggregate export load smoke PASS。
- `npm run rail:integration:verify` 覆盖 PR14-PR17 的新增 gate。
- 根 `npm run build` 与 blog build 通过。

执行状态（2026-06-04）：

- 默认 bundle assert、export/load smoke、MVP workflow mode smoke 已加入 `npm run rail:integration:verify`。
- `railGraphLoadState` 已进入 store，可用于 smoke/debug 判断 loaded/fallback reason。
- legacy GeoJSON / `app-line:*` UserEvent regression 已进入 gate 覆盖文件。
- 尚未完成 Playwright UI smoke；当前 PR18 只完成状态与 gate 可观测性收敛。

## 5. 到 70% 的最小执行顺序

1. 先做 PR14。没有默认 bundle，用户端 90% 无法成立。
2. 再做 PR15。没有真实 workflow smoke，只能说 adapter 可用，不能说用户端接入面可用。
3. 接着做 PR16。把 records/search/stats/latest/export 的分叉消费收敛，降低后续默认切换风险。
4. 再做 PR17。Transfer scoring 是运行质量缺口，但不应阻塞默认 bundle 和用户面 smoke。
5. 最后做 PR18。把 gate 和默认路径切换收口。

按此顺序完成后，建议重新估算：

| 维度 | 完成后 |
|---|---:|
| runtime / deployment 契约 | 85% |
| app 接入骨架 | 90% |
| 用户端可用面 | 90% |
| 数据端 | 50%-60% |
| gate / 发布可信度 | 85% |
| 综合 | 70%-72% |

本轮已经完成 PR14、PR15 的 Vitest/loader 级 smoke、PR17 的 runtime scorer、PR18 的 load status 与 gate 可观测性部分。因此当前可按 70% 口径验收；后续若要把“用户端 90%”提升到浏览器发布口径，下一步必须补 Playwright UI smoke。

## 6. Grill-me 决策点

当前只有一个真正需要拍板的问题，其余问题都已经能从代码探索回答。

问题：用户端 90% 是否接受“最小非 no-direction compiled deployment bundle + 完整 workflow smoke”作为验收，而不是等待全量真实数据覆盖？

推荐答案：接受。原因是目标明确允许数据端不完善，而用户端 90% 的关键是所有产品接入面可用、可保存、可搜索、可统计、可回退、可被 gate 阻止回归。全量数据覆盖应作为后续数据 PR，而不是阻塞 app 接入闭环。

如果不接受，PR14 必须改为先完成真实 compiled aggregate 数据导入和覆盖率审计，整体 70% 目标会被数据工程拖住，用户端 smoke 也会延后。

## 7. 本轮不做的事

- 不把 no-direction verify bundle 发布为默认产品数据。
- 不把 MVP/aggregate 工作台中的 no-direction pathfinding export 误判为不可导出；它们必须带模式声明并保持 verify/workbench 边界。
- 不把 aggregate/admin UI 直接暴露成普通用户端 rail-graph UI。
- 不把 `runtimeArtifacts` 变成普通 SavedTrip 必填字段。
- 不把旧 GeoJSON / legacy app-line 用户事件强制迁移成 rail-graph 才能使用。
- 不为了 transfer scoring 大改 topo；换乘成本属于 runtime/planner 层。
- 不在计划未确认前改 UI 文案，避免四语言 i18n 扩散。
