# Chain 模型 — Pathfinding 意图层 (IntentionChain)

> 本文档说明 Rail Graph v1 在 pathfinding 层新增的 **IntentionChain** 模型:
> 节点 kind 参考、strict/sketch mode 区别、派生关系图、5 个 PoC scenario 的 chain 形态。
>
> 关联实现:
> - `src/rail-graph-v1/chain.types.ts` (类型主体)
> - `src/rail-graph-v1/chain.ts` (validateChain / compileChainToConstraints / resolveChain / inferSketchChain / chainToTraceSequence)
> - `src/rail-graph-v1/phase.types.ts` + `phase.ts` (RunPhase 三原语 / PhaseSequence / CoarseRunPhase)
> - `src/rail-graph-v1/pathfinding.ts` (intentionChain 入口 + fromPathGoalToChain 适配 + filterByChain)

---

## 1. 为何引入 chain

MVP 早期 pathfinding 层把"运行意图"散落在 3 个不同抽象:

| 层 | 字段 | 问题 |
|---|---|---|
| 用户输入 | `PathfindingOptions.pathGoal` (explicit / shorthand / implicit) | stops 是无序集合, 无法表达 "PA → PD(不停) → PB" 这种顺序约束 |
| 派生中间 | `PathfindingResult.traceSequence` | stop/pass/turnback 平铺, "在 platform 上反向" 与 "乘降+反向" 区分不开 |
| 派生粗粒度 | `PathfindingResult.phases` | up_run/down_run/turnback 三态, 同 PD 在路径上出现两次无法区分 |

三层概念互相重叠又彼此缺失. IntentionChain 把它们收敛为一条**有序运行剧本**:

- 用户输入 / admin 编辑: `IntentionChain` (chain.nodes[])
- chain × path 合并: `ResolvedChain` (事件派生真源)
- 机械展开: `PhaseSequence` (running / dwelling / departing 三原语)
- 兼容输出: `ServiceTraceEntry[]` / `PathPhase[]` (退化为 view)

---

## 2. IntentionNode 节点 kind 参考

7 种节点 kind, 通过 discriminated union 表达. 详见 `chain.types.ts`.

| kind | 用途 | 关键字段 | DFS 影响 | 派生产物 |
|---|---|---|---|---|
| `origin` | 起点 | `at: NodeAnchor \| EdgeMeasureAnchor`, `direction: "up"\|"down"` | 决定 DFS 初始方向 | 链端 anchor (不产 phase) |
| `terminus` | 终点 | `at: NodeAnchor \| EdgeMeasureAnchor` | DFS 终止匹配点 | 链端 anchor (不产 phase) |
| `service_stop` | 乘降停站 | `at: platformRef`, `edgeRef?`, `boarding: alight\|board\|both`, `duration?` | strict: required stop 约束 | `DwellingAtPlatform` + `DepartingPhase`(同向) |
| `passage` | 通过站台 (不停) | `through: platformRef\|stationRef`, `throughKind` | strict: 路径必须经过该 binding edge | RunningPhase.passages 切片 |
| `reversal` | 换向 | `at?: reversible edgeRef`, `atPlatform?`, `boarding?: none\|alight\|board\|both` | strict: turnback ceiling = reversals.length; `at` 限定 turnback edge | `DwellingPhase` + `DepartingPhase`(isReversal=true) |
| `technical_stop` | 技术停车 (无乘降) | `at: edgeRef`, `measure: number`, `reason?: wait\|crossing\|signal` | 在指定 edge 上要求停留 | `DwellingNoPlatform` + `DepartingPhase` |
| `operation` | 作业 (编组/换乘务) | `at: edgeRef`, `opKind: OperationType` | 不消耗 path, 与同位置 dwelling 共生 | `EventAnchorOnPhase` (anchor.kind=fixed_operation) |

**约束**:
- chain.nodes[0] 必须是 `origin`
- chain.nodes[length-1] 必须是 `terminus`
- `passage` 不能在链头/尾
- 至多 1 个 origin 和 1 个 terminus
- `validateChain` 会校验这些不变量 (diagnostic codes: `CHAIN_EMPTY` / `CHAIN_MISSING_ORIGIN` / `CHAIN_MISSING_TERMINUS` / `CHAIN_PASSAGE_AT_BOUNDARY` / ...)

---

## 3. ChainMode: strict vs sketch

| 维度 | strict | sketch |
|---|---|---|
| 用户视角 | 完整运行剧本 (admin 仔细编排) | 仅给关键节点 (起终点 + 必停, DFS 自由发挥) |
| DFS turnback 上限 | `reversals.length` | `Infinity` |
| 后过滤 `filterByChain` | 严格校验 requiredStops / requiredPassages / reversal 数量与 `at` 匹配 | 不过滤, 所有 DFS 候选保留 |
| `resolveChain` 行为 | 按 chain 节点顺序对齐 path 切片 | 同左 |
| `inferSketchChain` | 不触发 | 触发 — 把 path 上 turnback 反向补成 `reversal` 节点, binding 反向补成 `passage` 节点, 输出 candidate chain |
| 适用场景 | "我要让列车按这个剧本走" | "找一条合理路径, 让我看看剧本是什么" |

诊断 code 区别:
- strict 下 candidate 没满足约束 → `REQUIRED_STOP_NOT_MET` / `TURNBACK_COUNT_VIOLATION` (filterByChain 阶段)
- sketch 不产 chain 约束 diagnostic, 仅由 `resolveChain` 在对齐失败时产 `CHAIN_RESOLVE_*` 警告

---

## 4. 派生关系

```
admin input          pathfinding (DFS)              consumer view
─────────────        ─────────────────              ─────────────
IntentionChain ─┬──→ validateChain
                │       (errors 中止 findPaths)
                │
                ├──→ compileChainToConstraints ──→ ChainConstraints
                │                                    ↓ DFS turnback ceiling
                │                                    ↓ filterByChain (strict)
                │                                    ↓
                │                                  RawCandidate[]
                │
                └──→ resolveChain(chain, candidate) ──→ ResolvedChain
                       ↑                                  ↓
                       inferSketchChain (sketch mode)     ↓ chainToTraceSequence
                       从 candidate 反推 chain            ↓
                                                       ServiceTraceEntry[] (兼容 view)
                                                          ↓
                                                       buildPhaseSequence(resolved)
                                                          ↓
                                                       PhaseSequence
                                                       (RunPhase[]: running/dwelling/departing
                                                        + EventAnchorOnPhase[])
                                                          ↓ phaseSequenceToCoarsePhases
                                                       PathPhase[] (兼容 view: up_run/down_run/turnback)
```

**真源**: `ResolvedChain` (+ `PhaseSequence`). 现有 `traceSequence` / `phases` 字段保留, 但实际由 chain 派生.

**关键不变量**:
- `ResolvedChain.nodes[i].nodeIndex === i`
- `ResolvedChain.segments.length === nodes.length - 1` (允许 segment.edges 为空, 如 origin 与首个 stop 同位置)
- `ResolvedChain.edgeSequence === flatMap(segments, s => s.edges)`
- `ResolvedChain.turnbackEdgeIndices` 严格对应 reversal 节点位置

---

## 5. PoC 5 个 scenario chain 形态

**前提**: `src/rail-graph-v1-mvp/poc-twostation.ts` 定义的两站拓扑.

### S1: 纯上行 (strict, 最小)
```ts
{
  mode: "strict",
  nodes: [
    { kind: "origin", at: { nodeRef: NODE_A1_WEST_EXT }, direction: "up" },
    { kind: "terminus", at: { nodeRef: NODE_B1_EAST_EXT } },
  ],
}
```
预期: `up_run` 一段; DFS 自由选 PA → PC 这条上行联络.

### S2: 纯下行 (strict, 最小)
```ts
{
  mode: "strict",
  nodes: [
    { kind: "origin", at: { nodeRef: NODE_B3_EAST_EXT }, direction: "down" },
    { kind: "terminus", at: { nodeRef: NODE_A4_WEST_EXT } },
  ],
}
```
预期: `down_run` 一段.

### S3: 上→下换向 (strict, 含 reversal)
```ts
{
  mode: "strict",
  nodes: [
    { kind: "origin", at: { nodeRef: NODE_A1_WEST_EXT }, direction: "up" },
    { kind: "reversal", at: TRACK_B2, boarding: "none" },
    { kind: "terminus", at: { nodeRef: NODE_A4_WEST_EXT } },
  ],
}
```
预期: `up_run` → `turnback` → `down_run`. filterByChain 校验 turnback 必须在 TRACK_B2.

### S4: 下→上换向 (strict, 含 reversal, 方向反)
```ts
{
  mode: "strict",
  nodes: [
    { kind: "origin", at: { nodeRef: NODE_B3_EAST_EXT }, direction: "down" },
    { kind: "reversal", at: TRACK_B2, boarding: "none" },
    { kind: "terminus", at: { nodeRef: NODE_B1_EAST_EXT } },
  ],
}
```
预期: `down_run` → `turnback` → `up_run`.

### S5: 上→下换向 (sketch, 让 DFS 自由发挥)
```ts
{
  mode: "sketch",
  nodes: [
    { kind: "origin", at: { nodeRef: NODE_A1_WEST_EXT }, direction: "up" },
    { kind: "terminus", at: { nodeRef: NODE_A4_WEST_EXT } },
  ],
}
```
DFS 上限放宽为 Infinity, 不过滤 candidate.  
`inferSketchChain` 把 best 候选反向补全为类似 S3 的 chain (含 auto-inserted `reversal` at TRACK_B2 + 多个 `passage` 节点).

预期 ResolvedChain (示意):
```ts
{
  mode: "sketch",
  nodes: [
    { kind: "origin", ... },
    { kind: "passage", through: PLATFORM_A, throughKind: "platform" },
    // ... 其他自动补出的 passage
    { kind: "reversal", at: TRACK_B2, atPlatform: PLATFORM_D, boarding: "none" },
    // ... 反向后的 passage
    { kind: "passage", through: PLATFORM_B, throughKind: "platform" },
    { kind: "terminus", ... },
  ],
  segments: [...],
  turnbackEdgeIndices: [<turnback edge idx>],
}
```

UI 中区分: strict scenario 的 candidate 显示 `strict` badge (红); sketch scenario 显示 `sketch` badge (蓝).

---

## 6. 兼容入口: PathGoal → IntentionChain

`fromPathGoalToChain` (pathfinding.ts) 把旧 `PathGoal` 转 chain, 用于向后兼容:

| PathGoal kind | 转换结果 |
|---|---|
| `implicit` | sketch chain (仅 origin + terminus) |
| `shorthand` "main_in_main_out_no_stop" | strict chain (0 reversal, 0 stop) |
| `shorthand` "main_in_main_out_turnback_once" | strict chain (1 reversal, 不指定 at) |
| `shorthand` "stop_all" / "any" | sketch chain (允许 DFS 自由发挥) |
| `explicit` | strict chain (stops → service_stop 节点; turnback.count → 多个 reversal 节点) |

`PathfindingOptions.intentionChain` 优先级高于 `pathGoal`. 二者皆缺时, 内部用 `createImplicitChain` 产生最小 sketch chain.

---

## 7. UI 集成 (Pathfinding tab)

`src/rail-graph-v1-mvp/list-view.ts` 在 candidate 展开时优先渲染 `c.resolvedChain.nodes`:

- 节点列表: origin → service_stop → passage → reversal → ... → terminus
- 节点间插入 segment 摘要 (`↓ running up · 3 edges · 1240m · passes 1`)
- mode badge (strict 红 / sketch 蓝)
- 节点 hover → 触发 `onEntityHover(resolvedPlatformRef ?? resolvedEdgeRef ?? resolvedStationRef)` → map 高亮
- 节点 click → 触发 `onEntityClick(ref)` (与现有联动通路一致)
- 若 `resolvedChain` 缺失 (退化路径) → fallback 到旧 `renderTraceList(traceSequence)`

CSS 节点配色:
- origin/terminus: 浅青 (#ecfeff)
- service_stop: 浅绿 (#dcfce7)
- reversal: 浅橙 (#fef3c7)
- passage: 浅灰 (#f8fafc)
- technical_stop: 浅紫蓝 (#e0e7ff)
- operation: 浅紫 (#f3e8ff)

---

## 8. 未实现 (后续 plan)

- chain 编辑器: 拖拽节点、增删、实时校验、shorthand pattern 一键生成
- `ServicePattern.intentionChain` 字段: 把 chain 上升到 service-template 层, 与现有 ServiceTraceEntry 完全替换
- `RunSpec` / `RunPath` / `RunContext` 升级: timetable 与 chain 节点对齐 (arrival/departure 时刻 + duration)
- map-view 上 chain 节点单独渲染 (当前仍用 edge polyline + path arrow)
- sketch mode 多 candidate 切换 UI (本轮只输出 `candidates[0]` 的 chain)
- chain 节点 click → fit-to-entity 缩放
