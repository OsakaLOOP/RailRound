# Goal 02 · Aggregate × ServicePattern × UserEvent

> Codex follow-goals 模式专用 goal 文档。
> 顶部"Agent 提示词"为直接交给 agent 的入口指令; 其余章节供 agent 按需检索, 不必一次全读。

---

## Agent 提示词 (直接发给 codex)

```
你是 RailRound 项目的 Codex 自治 agent。
本 goal 路径: D:\PROJ\GIT\PyDesign\RailRound\src\rail-graph-v1-mvp\goal02-aggregate-service-pattern.md

任务: 实现 Aggregate (跨 workspace) × ServicePattern (含 IntentionChain 编辑器) × UserEvent (含 L4 联动) 三层架构, 共 3 个 PR, 按顺序完成。

硬性约束:
1. 每个 PR 完成前必须先读 goal 对应章节 (§4 / §5 / §6) 确认范围与文件清单
2. 不要去碰 §8 "Out of Scope" 里列出的模块
3. 每个 PR 写完必须跑对应 verify 脚本得到 "AGGREGATE VERIFY: PASS" 才能进入下一个 PR
4. tsc --noEmit -p tsconfig.json 必须 0 错误 (允许 warning)
5. 现有 src/rail-graph-v1-mvp/ MVP shell 不动 (只复用其类型/pipeline server); 新 Aggregate UI 走新入口 rail-graph-aggregate.html
6. 不修改 docs/rail-graph-v1/* (设计文档不动); 可以新建 docs/rail-graph-aggregate/notes.md 记录决策

Verify 命令 (三选一对应当前 PR):
  npm run rail:aggregate:verify:patterns      (PR1)
  npm run rail:aggregate:verify:cross-pf      (PR2)
  npm run rail:aggregate:verify:events        (PR3)

工作流程 (每个 PR):
  read §章节  →  规划文件改动  →  实现  →  tsc 自检  →  verify PASS  →  写 PR 描述  →  停下等待 review
  失败时: 读 src/rail-graph-aggregate/.verify/*.json 报告, 修, 再跑 verify

数据准备: 仙石线 + 东北本线 + 仙石东北联络线 由用户在 senseki-data.ts 或同目录 fixture 中提供; 你的 aggregate adapter 必须能读到至少 2 个 workspace 的 source.features。如果数据缺失, 在 verify 脚本输出明确 "DATA NOT READY" 提示, 不要伪造数据继续。

下面进入 §1 开始阅读。
```

---

## 1. 背景与已有资源

### 1.1 项目现状
RailRound 现有 `src/rail-graph-v1-mvp/` 是面向单条线路 (workspace) 的 admin 工作流:
prepare → clean → annotate → compile → validate → export。每个 workspace 输出一份 `BaseTopologyLayer`。

不在 scope 内但相关: pathfinding v2 (Edge Line Graph + Yen-A* + IntentionChain) 已落地, 是本 goal 直接复用的核心算法。

### 1.2 本 goal 要做什么
在 MVP 之上引入 **Aggregate** 层 — 多个 workspace 的 topology 在内存中拼接, 之上承载:
- **ServicePattern**: 通过交互式 IntentionChain 编辑器构造, 路径导出后命名/着色/持久化
- **跨 ServicePattern 换乘寻路**: 在已保存的 ServicePattern 集合上做 two-tier 寻路, 共同 station 自动构成 transfer 点
- **UserEvent**: 可锚到 station / edge+measure 的用户事件, 与已选 RunPath 联动产生 orderIndex 流

### 1.3 已有可直接复用的资源

| 模块 | 文件 | 用途 |
|---|---|---|
| ServicePattern 类型 | `src/rail-graph-v1/service-template.types.ts` | `ServicePattern`, `ServiceTraceEntry`, `DirectionConvention` 等已定义, 直接 import 使用 |
| IntentionChain 类型 | `src/rail-graph-v1/chain.types.ts` | `IntentionChain`, `IntentionNode` (origin/service_stop/passage/reversal/via_edge/terminus) |
| Chain 算法 | `src/rail-graph-v1/chain.ts` | `validateChain`, `mergeChainWithPath`, `expandShorthandToChain` |
| Pathfinding v2 | `src/rail-graph-v1/pathfinding-v2.ts` | `findPathsV2({ topo, lookup, chain, ... })` 主入口 |
| Workspace pipeline | `src/rail-graph-v1-mvp/pipeline.ts` | `loadWorkspaceState`, `workspaceKey`, `readPipelineArtifact`, `saveOverrides` |
| Pipeline server | `scripts/rail-graph-mvp-server.js` | 提供 fs API; 可以扩展加 aggregate 文件读写 endpoint |
| Map view | `src/rail-graph-v1-mvp/map-view.ts` | `createMapView`; 渲染层可以**复用其 createMapView**, 但新 aggregate app 自己组织顶层 shell |

### 1.4 用户准备的数据
用户晚上在 `src/rail-graph-v1-mvp/senseki-data.ts` (或同目录下新 fixture 文件) 准备:
- 仙石线 (senseki) workspace 的 source.features (已 annotated)
- 东北本线 (tohoku-main) workspace 的 source.features (已 annotated)
- 仙石东北联络线 (senseki-tohoku-connector) 的 way 对象 (作为第三个 workspace, 或合并到上述之一)

agent 不要预设数据形态, **从 senseki-data.ts 实际 export 名读起**; 若读不到, verify 脚本输出 "DATA NOT READY" 即终止当前 PR, 等用户补数据。

---

## 2. 架构骨架

```
rail-graph-aggregate.html                       (新 HTML 入口)
└── src/rail-graph-aggregate/app.ts             (新 app 入口)
    ├── aggregate-state.ts                      (state + load member workspaces + 拼 topology)
    ├── service-pattern/
    │   ├── store.ts                            (ServicePattern CRUD + JSON 持久化)
    │   ├── chain-editor.ts                     (IntentionChain UI 编辑器)
    │   ├── render-plan.ts                      (纯函数: pattern → color/edges/stations 渲染计划)
    │   └── adapter.ts                          (从 chain + findPathsV2 结果 → ServicePattern)
    ├── cross-pattern/                          (PR2)
    │   ├── transfer-graph.ts
    │   └── resolver.ts                         (two-tier dijkstra)
    └── user-event/                             (PR3)
        ├── types.ts
        ├── store.ts
        └── aggregation.ts                      (沿 RunPath 收集 events)

scripts/rail-graph-mvp-server.js                (扩展加 aggregate fs endpoint)
vite.config.js                                  (rollupOptions.input 加 railGraphAggregate)
src/rail-graph-v1-mvp/                          (不动, 只复用)
```

---

## 3. PR 全景

| PR | 目标 | 主要新文件数 | Verify |
|---|---|---|---|
| **PR1** | Aggregate + ServicePattern 编辑器全栈 (含交互式 chain 编辑 + 多色渲染 + JSON 持久化) | ~7-9 | `npm run rail:aggregate:verify:patterns` |
| **PR2** | 跨 ServicePattern 换乘寻路 (transfer graph + two-tier dijkstra + UI 触发) | ~4-5 | `npm run rail:aggregate:verify:cross-pf` |
| **PR3** | UserEvent + L4 联动 (锚定 schema + 创建 UI + 持久化 + 沿 RunPath 聚合) | ~4-6 | `npm run rail:aggregate:verify:events` |

PR 之间是**线性依赖** (PR2 用 PR1 的 ServicePattern store; PR3 用 PR2 的 cross-pattern path)。PR2 完成时, PR1 的 verify 脚本必须仍 PASS (不破坏向后)。

---

## 4. PR 1 · Aggregate + ServicePattern 编辑器全栈

### 4.1 目标
- 新 HTML 入口 `rail-graph-aggregate.html` 可以独立打开, 渲染一份 aggregate (跨多 workspace 合并)
- 用户能在底图上构造 IntentionChain (起点/经停/通过/反向/终点), 调用 `findPathsV2` 返回候选, 选一条
- 选定路径 + 用户填写的 name/color/lineRef/serviceType → 保存为 `ServicePattern`, 写入 JSON 文件
- 已保存的 patterns 在底图上多色叠加渲染 (用 `displayColor`); 同一物理 edge 被多 pattern 覆盖时, 颜色按 pattern 顺序"分股"或"虚线偏移", agent 自定 — **唯一硬约束: 必须能从渲染纯函数输出里看到所有 pattern 都被绘制**

### 4.2 文件清单 (建议, agent 可微调)

| 文件 | 状态 | 内容 |
|---|---|---|
| `rail-graph-aggregate.html` | 新建 | 复制 rail-graph-mvp.html 模板, 改 `<div id>` 和 script src |
| `vite.config.js` | 修改 | rollupOptions.input 加 `railGraphAggregate` |
| `src/rail-graph-aggregate/app.ts` | 新建 | 顶层 shell + 状态机 + UI 绑定 |
| `src/rail-graph-aggregate/aggregate-state.ts` | 新建 | 加载 N 个 workspace 的 source/topo, 拼为 unified, 暴露 `loadAggregate({memberWorkspaceKeys})` |
| `src/rail-graph-aggregate/service-pattern/store.ts` | 新建 | CRUD + JSON 读写 (via pipeline server) |
| `src/rail-graph-aggregate/service-pattern/chain-editor.ts` | 新建 | IntentionChain UI 状态机 (add origin / passage / reversal / terminus) |
| `src/rail-graph-aggregate/service-pattern/adapter.ts` | 新建 | chain + path → ServicePattern (含 traceSequence/pathSegments) |
| `src/rail-graph-aggregate/service-pattern/render-plan.ts` | 新建 | **纯函数**, 输入: aggregate.topology + patterns[]; 输出: `PatternRenderPlan` (per-pattern 颜色 + edge 子序列 + offset/stripe 策略) |
| `scripts/rail-graph-mvp-server.js` | 修改 | 增加 `POST /api/rail-graph-aggregate/{read,write}` endpoint (复用 readPipelineArtifact 模式) |
| `src/rail-graph-v1-mvp/verify-aggregate-patterns.ts` | **本 goal 已创建骨架** | 实现填空 (见 §7) |
| `package.json` | 修改 | scripts 加 `rail:aggregate:verify:patterns` |

### 4.3 实现要点

- **aggregate-state.ts**: `loadAggregate({memberWorkspaceKeys: string[]})` 应当: 对每个 ws 跑 `loadWorkspaceState(ws).source` → 合并 features (按 _fid 去重) → 重跑 `compileTopology` 等价逻辑 (复用 mvp app.ts 的 compileTopology) 得到 unified `BaseTopologyLayer`。注意 _fid / nodeId 重复, 必须以 `${ws}:${original_fid}` 命名空间化避免冲突, 且要让 agent 在脚本能复现这个映射
- **chain-editor.ts**: 状态机三态 `{idle, picking-origin, picking-via, picking-terminus}`; map 点击 station_point feature → addNode; 旁边一个 chain preview 面板 (kind+at); "Compute" 按钮 → 调 `findPathsV2({chain, topo: aggregate.topo, lookup: aggregate.lookup, startEntryPoints, endEntryPoints})`
- **adapter.ts**: 路径 `RawCandidateV2` → `ServicePattern`: `edgeSequence` 直接拷; `traceSequence` 沿 edgeSequence 扫描 platform binding 生成 ServiceStopEntry/ServicePassEntry; `pathSegments` 按 edgeRef 分块
- **render-plan.ts**: 必须是**无副作用纯函数**, 不导入 leaflet。输出形如 `{ patternId, displayColor, polylineSegments: [{edgeRef, coords: [[lng,lat],...], strokeStyle: {color, weight, dashArray?, offset?}}], stationMarkers: [...] }`
- **持久化路径**: `<workspaceRoot>/aggregates/{aggregateKey}/service-patterns.json`, schema:
  ```json
  {
    "aggregateKey": "senseki-tohoku-2026",
    "memberWorkspaceKeys": ["senseki", "tohoku-main"],
    "patterns": [{ "patternId": "...", ...ServicePattern shape... , "intentionChain": {...} }]
  }
  ```
  注意 ServicePattern 不含 chain (旧 v1 类型), 但本 store 把 chain 挂在 pattern 上以便编辑回放

### 4.4 验收

**Verify 命令**: `npm run rail:aggregate:verify:patterns`

**PASS 必备 (verify 脚本自动断言)**:
1. `aggregate-state.loadAggregate(["senseki","tohoku-main"])` 成功返回, `topo.edges.length > 0` 且 ≥ 各 ws 之和的 80% (允许去重)
2. 至少能加载 1 份 ServicePattern JSON, 解析为 ServicePattern[]
3. 每个 ServicePattern.edgeSequence 全部 edge 都能在 aggregate.topo.edges 里找到
4. `render-plan.buildPatternRenderPlan(aggregate, patterns)` 输出: 每个 pattern 至少 1 个 polylineSegments, 颜色非空, 坐标合法
5. 至少 1 条 pattern 的 IntentionChain 用 `findPathsV2` 可重新解析, 候选 edgeSequence === 保存时的 edgeSequence (round-trip 一致)
6. `tsc --noEmit` 0 error in `src/rail-graph-aggregate/**`

**报告位置**: `src/rail-graph-aggregate/.verify/patterns-*.json` (脚本自动写)

---

## 5. PR 2 · 跨 ServicePattern 换乘寻路

### 5.1 目标
- 给定 (fromStation, toStation), 系统在已保存的 ServicePattern 集合上自动找跨线路径, 含换乘
- 算法: two-tier dijkstra
  - **Tier 1**: pattern-level graph, 节点 = ServicePattern, 边 = 共享 station (transfer relation)
  - **Tier 2**: within-pattern, 用 ServicePattern.edgeSequence 直接取子段 (不重新跑 v2 搜索)
- 输出: 跨 pattern 路径 = `[{ patternRef, edgeSequence, stationSequence, transferStation? }]`
- UI: aggregate app.ts 加 "Cross-Pattern Search" 表单 (from / to station picker); 选定后高亮地图

### 5.2 文件清单

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/rail-graph-aggregate/cross-pattern/transfer-graph.ts` | 新建 | 从 patterns[] 构造 transfer relation: `{ patternA, patternB, sharedStations[] }` |
| `src/rail-graph-aggregate/cross-pattern/resolver.ts` | 新建 | `resolveCrossPattern({patterns, from, to}) → CrossPatternPath` |
| `src/rail-graph-aggregate/cross-pattern/types.ts` | 新建 | `CrossPatternPath`, `PatternHop`, `TransferHop` |
| `src/rail-graph-aggregate/app.ts` | 修改 | 加 cross-pattern UI 面板 + 调用 resolver + 高亮 |
| `src/rail-graph-aggregate/service-pattern/render-plan.ts` | 修改 | 增加 `buildCrossPatternRenderPlan(crossPath)` 输出, 沿用纯函数风格 |
| `src/rail-graph-v1-mvp/verify-cross-pattern-pathfinding.ts` | **本 goal 已创建骨架** | 实现填空 |
| `package.json` | 修改 | scripts 加 `rail:aggregate:verify:cross-pf` |

### 5.3 实现要点

- **Transfer 规则 (硬约束)**: 两个 ServicePattern 各自 `traceSequence` 都含同一 `stationRef` → 视为 transfer point; 不需要显式声明
- **Transfer cost**: 固定 `300m` 等价距离 (相当于 5 分钟步行); 不参与时刻表; 可作为 const 暴露便于调
- **同 pattern 内寻路**: 不重新跑 v2, 直接用 `ServicePattern.edgeSequence + traceSequence`, 给定 (fromStation, toStation), slice 子段
- **方向**: ServicePattern 默认双向; tier-2 内需根据 from/to 在 traceSequence 中的索引决定 forward/reverse, 反向时 edgeSequence 反转
- **PR1 不破坏**: 跑完 PR2 后, PR1 verify 必须仍 PASS

### 5.4 验收

**Verify 命令**: `npm run rail:aggregate:verify:cross-pf`

**PASS 必备**:
1. `transfer-graph.buildTransferGraph(patterns)` 输出至少 1 条 transfer relation (即仙石线 ↔ 东北本线 通过共享 station 联通)
2. `resolver.resolveCrossPattern({patterns, from: <仙石线某站>, to: <东北本线某站>})` 返回路径含 ≥ 2 `PatternHop` (说明确实换乘)
3. Transfer station 在两个 PatternHop 的 traceSequence 中都能找到
4. 总 edgeCount = Σ hop.edgeSequence.length, 且与单 pattern 寻路相比合理 (sanity: 跨线路径 edgeCount ≤ aggregate.edges.length)
5. 反向场景: from/to 互换, 输出对称路径 (edgeCount 一致, pattern 序列反转)
6. PR1 verify 仍 PASS

---

## 6. PR 3 · UserEvent + L4 联动

### 6.1 目标
- UserEvent schema: `{ id, kind: "user_defined", anchor: { kind: "station", stationRef } | { kind: "edge", edgeRef, measure }, title, payload? }`
- 创建 UI: 在 aggregate map 上 right-click station / edge → 上下文菜单 "Add UserEvent" → 表单 (title + anchor confirm) → save
- 持久化: `<workspaceRoot>/aggregates/{aggregateKey}/user-events.json` (同 patterns store 机制)
- **L4 联动**: 给定一条 ServicePattern (或一条跨 pattern 路径), 沿 traceSequence (或多 pattern 拼接的 stationSequence) 收集匹配的 UserEvent, 按 orderIndex 排序输出
- 在 aggregate UI 加 "Events on selected path" 子面板, 显示按 orderIndex 排序的 events

### 6.2 文件清单

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/rail-graph-aggregate/user-event/types.ts` | 新建 | `UserEvent`, `UserEventAnchor` |
| `src/rail-graph-aggregate/user-event/store.ts` | 新建 | CRUD + JSON 持久化 |
| `src/rail-graph-aggregate/user-event/aggregation.ts` | 新建 | 纯函数: `aggregateEventsAlongPath(events, path) → OrderedEvent[]` |
| `src/rail-graph-aggregate/app.ts` | 修改 | 加 right-click menu + "Events on path" 面板 |
| `src/rail-graph-v1-mvp/verify-event-aggregation.ts` | **本 goal 已创建骨架** | 实现填空 |
| `package.json` | 修改 | scripts 加 `rail:aggregate:verify:events` |

### 6.3 实现要点

- **Anchor 解析**: station anchor 直接查 `stationRef` 是否在 path 的 stationSequence 内 → orderIndex = 该 station 在 sequence 中的位置; edge anchor 查 edgeRef 是否在 edgeSequence 内 → orderIndex = edgeIndex (用 measure 作为 sub-index 做 tiebreak)
- **跨 pattern path**: aggregation 接受统一 `RunPath`-like 对象 `{ edgeSequence, stationSequence }`; PR2 输出的 cross-path 由调用方拼为这个形式后传入
- **顺序不变量**: 多个 event 锚到同一 station, orderIndex 相同, 二级排序按 event.id 字典序
- **不破坏 PR1/PR2**: 验证依次跑 patterns + cross-pf + events, 全部 PASS

### 6.4 验收

**Verify 命令**: `npm run rail:aggregate:verify:events`

**PASS 必备**:
1. `store.loadUserEvents(aggregateKey)` 解析非空; fixture 至少含 3 个 event, 至少 1 个 anchor=station 1 个 anchor=edge
2. `aggregation.aggregateEventsAlongPath(events, samplePath)` 输出 orderIndex 单调非降 (允许同位)
3. 每个输出 event 的 anchor 必须在 path 中能定位 (无幽灵 event)
4. 至少 1 个 event 同时出现在 cross-pattern path 的 2 个 hop 中, 且其 orderIndex 正确 (按全局 sequence 位置)
5. PR1 + PR2 verify 仍 PASS (脚本会触发跑)

---

## 7. 验证机制

### 7.1 三脚本的共同模式
模仿 `src/rail-graph-v1-mvp/verify-senseki-clean.ts`:
- `tsx` 入口, Node 跑, **不开浏览器**
- 加载真实 senseki-data + workspace state (复用 readPipelineArtifact)
- 跑被测纯函数 → 写报告 `src/rail-graph-aggregate/.verify/{phase}-*.json` + `.verify/{phase}-summary.md`
- 末尾打印 `AGGREGATE VERIFY: PASS` 或 `AGGREGATE VERIFY: FAIL` + 红色失败明细
- exit code: 0 = PASS, 1 = FAIL

### 7.2 失败时调试路径
```
.verify/{phase}-summary.md         (人类可读总结)
.verify/{phase}-aggregate-shape.json     (aggregate.topo 形状)
.verify/{phase}-patterns-shape.json      (pattern 列表 + chain round-trip)
.verify/{phase}-cross-pf-trace.json      (PR2 only)
.verify/{phase}-events-aggregation.json  (PR3 only)
```
agent 失败时**先读 summary.md**, 再按需进 *.json。

### 7.3 不可绕过的检查
- 任一 PR 的 verify 失败 → 不准 commit、不准进下一个 PR
- tsc --noEmit 错误 → 同上
- ServicePattern JSON schema 不合法 (store.ts 自带 validator) → 同上
- "shortcut" 修改 verify 脚本断言常数让它 PASS → **明令禁止**; 必须改实现, 不准改测试 (除非用户明示)

---

## 8. Out of Scope (本 goal 完全不动)

- `src/rail-graph-v1-mvp/app.ts`, `map-view.ts`, `list-view.ts` 等 MVP shell 代码 (只读, 不改)
- `docs/rail-graph-v1/*.md` 原始设计文档
- 信号机相关 (VIS2-C~G 系列)
- 清洗规则系统 (rule-handlers.ts, verify-senseki-clean.ts)
- 路径动画 / 速度曲线 (path-animation-speed.ts)
- 时刻表 (Timeline.interpolate*)
- 多 ServicePattern 之间的 transferable 显式声明 (本期固定共 station 即 transfer)
- 跨线寻路的高级策略 (最短换乘 / 最短时间 / 优先级); 本期单纯按 edgeCount + 固定 transfer cost 做 dijkstra
- Patch/EditableSnapshot, RunEvent (event.types.ts 现有), TripNote, DeployedSystem 共建数据
- i18n; aggregate UI 全部硬编码 zh-cn

---

## 9. Self-Check Guide (每 PR 完成时 agent 必跑)

```
□ tsc --noEmit -p tsconfig.json     (0 error)
□ npm run rail:aggregate:verify:patterns  (PR1; PR2/PR3 也要回归跑)
□ npm run rail:aggregate:verify:cross-pf  (PR2/PR3)
□ npm run rail:aggregate:verify:events    (PR3)
□ git status: 只动 §X.2 文件清单内的文件, 未碰 §8 out-of-scope 列表
□ commit message 含: "Goal02 PR{N} · ${summary}", 列出 verify PASS 输出
□ 写一条 PR 描述: 改了什么 + verify 结果 + 已知遗留
```

PR 描述模板:
```
Goal02 PR{N} · {ServicePattern/CrossPF/UserEvent}

新增:
- {file}: {one-line purpose}
...

修改:
- {file}: {what changed}

Verify:
$ npm run rail:aggregate:verify:{phase}
... (paste tail)
AGGREGATE VERIFY: PASS

已知遗留 / TODO (留给下个 PR 或人工):
- {item}
```

---

## 10. 关键决策记录 (grill 已固化)

| # | 决策 | 备注 |
|---|---|---|
| D1 | Aggregate 独立 UI/流程, 新 HTML 入口 + 独立 app.ts | 不挤 MVP shell |
| D2 | ServicePattern 通过交互式 IntentionChain 编辑器构造, 不用 fixture | 直接复用 v1 pathfinding-v2 |
| D3 | 持久化用 JSON 文件 (同 workspace overrides 机制), 走 pipeline server fs API | 不用 localStorage |
| D4 | 跨 ServicePattern transfer = 共同 station 自动构成 | 不要求显式声明 |
| D5 | UserEvent 第一版做 L4 (含创建/删除/持久化 + 沿 path 聚合 orderIndex) | 非 fixture-only |
| D6 | 渲染验证: 纯函数抽出 + dump 脚本; agent 不验 leaflet DOM | leaflet 渲染由人眼最终核 |
| D7 | 信号机 / 清洗规则 / Timeline 全部不做 | 见 §8 |
| D8 | scope cut 优先: 跨线寻路用固定 transfer cost + edgeCount dijkstra | 不做时间最短 / 最短换乘 |
