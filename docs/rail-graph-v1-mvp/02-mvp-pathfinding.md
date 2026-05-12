# Rail Graph MVP — 寻径 (Layer 2 初步)

> 本文档固化 MVP 阶段在 `BaseTopologyLayer` 上的初步寻径设计与实现。
> 范围属于 Layer 2 admin editing 的最小集 (路径候选生成),
> 不包含 Layer 2 完整的服务模板确认流程, 不包含 Layer 3 运行时。
>
> 与 `01-mvp-reference.md` 的关系: 那一份是 Layer 1 类型/对象/编译流程的事实快照,
> 本文档在它的基础上加入 "如何从该 topology 跑出带方向语义的路径"。

---

## 1. 概览

寻径模块解决:

- **输入**: 起点 / 终点的人类描述 (例如 "PA 沿上行" / "PC 沿上行"), 加可选 options
- **输出**: 全量简单路径候选列表, 按总距离排序; 每条候选含:
  - `edgeSequence` (Layer 1 edge 顺序)
  - `traceSequence` (`ServiceTraceEntry[]`, 带 "停 X 站 X 站台" / "经过 X 站台" / "在 X edge 上换向" 三类 entry)
  - `pathSegments` (`ServicePathSegment[]`, 每 edge 一段)
  - `phases` (`PathPhase[]`, 按 turnback 切分为 up_run / down_run / turnback 段)
  - `totalDistanceMeters`
  - `ruleTrace` / `diagnostics`

入口:
- 主逻辑: `src/rail-graph-v1/pathfinding.ts`
- 复用 helper: `src/rail-graph-v1/topology.ts` (新增 `isTurnbackAllowed` / `oppositeDirectionRole` / `getPlatformDirectedEdges` / `isDirectionRoleCompatible`)
- PoC 数据: `src/rail-graph-v1-mvp/poc-twostation.ts`
- 场景 runner: `src/rail-graph-v1-mvp/poc-pathfinding.ts`

---

## 2. 类型清单

### 2.1 新增 (`pathfinding.ts`)

| 类型 | 说明 |
|---|---|
| `PathSeed` | 起点 / 终点描述符的 discriminated union (`node` / `platform` / `edgeMeasure`) |
| `PathSeedNode` | `{ kind: "node", nodeRef, alongDirection? }` |
| `PathSeedPlatform` | `{ kind: "platform", platformRef, direction: "up"\|"down" }` ← MVP 主入口 |
| `PathSeedEdgeMeasure` | `{ kind: "edgeMeasure", edgeRef, measure: 0\|1, alongFromTo }` |
| `SeedResolution` | resolveSeed 输出: `entryPoints[]`, `initialDirectionRole?`, `diagnostics` |
| `SeedEntryPoint` | `{ startNodeRef, firstEdge? }` |
| `PathfindingOptions` | `maxCandidates?` / `maxDepth?` / `allowTurnback?` / `requireStoppingPointForTurnback?` |
| `PathPhaseKind` | `"up_run" \| "down_run" \| "turnback"` |
| `PathPhase` | `{ phaseIndex, kind, directionRole?, edgeRange, stationRefs, distanceMeters }` |
| `PathfindingResult` | 完整路径输出, 见上 §1 |
| `PathfindingDiagnosticCode` | 字符串常量集 |

### 2.2 复用 (现有底层类型)

| 类型 | 来自 | 用途 |
|---|---|---|
| `ServiceTraceEntry` | `service-template.types.ts` | traceSequence 元素, 复用 stop/pass 两种 |
| `ServiceStopEntry` | 同上 | 停车 / 换向 entry, `operationType: "turnback"` 标识换向 |
| `ServicePassEntry` | 同上 | 通过 entry |
| `ServicePathSegment` | 同上 | pathSegments 元素 |
| `PathGenerationRuleTrace` | `editing.types.ts` | 寻径决策痕迹 (MVP 暂未填充) |

---

## 3. 换向 (turnback) 规则

### 3.1 硬规则
一条 edge 允许换向当且仅当:
```
edge.directionRole === "reversible"
  AND  edge.functionalUse?.includes("turnback")
```

> 注: `reversible` 蕴含 `bidirectional` 的双向运行能力 + 额外允许换向。
> `bidirectional` 仅允许双向通行 (不同列车不同时刻), **不允许同一列车换向**。
> 这两个区分是寻径正确性的关键。

`isTurnbackAllowed(edge)` 是这条规则的唯一实现, 寻径过程中必须用它判定。
不得从图结构 / 位置 / binding 状态反推。

### 3.2 PoC 中可换向的 track
**仅 2番B (站 B 中線)** 允许换向。其 annotation:
```ts
{
  role: "platform",
  traversal: "both",
  physicalKind: "siding",
  functionalUse: ["stopping", "turnback"],
  directionRole: "reversible",
}
```

其他主 edge:
- 站 A 1番A/2番A: `traversal=forward, directionRole=up, functionalUse=["through","stopping"]`
- 站 A 3番A/4番A: `traversal=forward, directionRole=down, functionalUse=["through","stopping"]`
- 站 B 1番B: 同 1番A
- 站 B 3番B: 同 3番A
- 联络段 up_link / down_link: forward + up/down + ["through","stopping"]
- 所有 connector: `traversal=both, no directionRole, functionalUse=["through"]`

### 3.3 换向语义
当算法决定在 edge `e` 上换向:
1. 列车物理上在 `e` 上停下并反向
2. `currentDirectionRole` 翻转: `up ↔ down`
3. `currentNode` 回到该 edge 的入口节点 (即 列车从相反端离开 `e`)
4. **不消耗距离**, 但生成一个 `ServiceStopEntry { operationType: "turnback", ... }`
5. 同一条 edge 不重复换向 (turnbackAt set 防止)

---

## 4. 算法

### 4.1 总体形式
全量 DFS + visitedEdges set (simple path), 命中 endSeed 后停止该分支, 收集候选。
全部跑完后按 `totalDistanceMeters` 升序输出 top `maxCandidates`。

### 4.2 每步过滤
1. **traversal**: `edge.traversal === "forward"` 时, 入向节点必须 = `edge.fromNodeRef`; `both` 时两端皆可入
2. **directionRole 兼容性** (`isDirectionRoleCompatible`):
   - `undefined ↔ 任意` → 兼容 (向后兼容)
   - `bidirectional` / `reversible` ↔ 任意 → 兼容 (双向可走)
   - `up ↔ up` / `down ↔ down` → 兼容
   - `up ↔ down` → **不兼容** (必须先换向)
3. **simple path**: edge 不重复访问 (visitedEdges set)
4. **maxDepth**: edge 数上限 (默认 32)

### 4.3 换向触发条件
在 DFS frame 入口时尝试 turnback (优先级高于普通 outEdge):
- 已走过至少 1 条 edge
- 上一条 edge `isTurnbackAllowed` 返回 true
- 该 edge 还未发生过换向
- (可选) `requireStoppingPointForTurnback === true` 时, 该 edge 必须有 `StoppingPoint`

### 4.4 终点判定
- 若 `endSeed.kind === "platform"` 或 `"edgeMeasure"`: 终点是 "走完某条目标 edge"
- 若 `endSeed.kind === "node"`: 终点是 "走到某个目标 node"

实现细节: `targetEdges` 和 `targetNodes` 两个 Set 共同表达终点; DFS 在每帧入口检查 lastEdge 或 currentNode 是否命中。

### 4.5 算法边界
- 不做评分 / Dijkstra / Yen's (后续工作)
- 不切分 edge (起点 measure 仅接受 0/1)
- 单次 DFS 调用最多生成 maxCandidates 个候选, 多余时发 `MAX_CANDIDATES_REACHED` info

---

## 5. PoC 双站布局

### 5.1 ASCII 示意

```
[站 A: 2 面 4 線 上下退避型]                   [站 B: 2 面 3 線 国铁型可换向]
LON 139.6980 ~ 139.7020                        LON 139.7060 ~ 139.7100

1番A (up, forward)        ━━━━━━━━━━━ →UL→ ━━━ 1番B (up, forward)
       PA 北贴 (岛式)                                 PC 北贴 (侧式)
2番A (up, forward, siding) ━━━━━━━━━━━           ┃
       PA 南贴                                  2番B (reversible, BOTH,
─────── (无股道间隔) ───────                            ["stopping","turnback"])
       PB 北贴 (岛式)                                 PD 北贴 (岛式)
3番A (down, forward, siding) ━━━━━━━━━━━━━━━━━━━━━━━ PD 南贴
       PB 南贴                                  3番B (down, forward)
4番A (down, forward)      ━━━━━━━━━━━ ←DL← ━━━━━━━━━━━━━━━━━━━

咽喉 connector (traversal=both, 无 directionRole):
  站 A 西/东咽: 1-2, 3-4
  站 B 西/东咽: 1-2, 2-3
```

### 5.2 实体计数

| 实体 | 数量 |
|---|---|
| Station | 2 (A, B) |
| Platform | 4 (PA 岛, PB 岛, PC 侧, PD 岛) |
| TopologyEdge | 17 (4 站A主 + 3 站B主 + 2 联络 + 4 站A connector + 4 站B connector) |
| TopologyNode | 14 (8 站A端点 + 6 站B端点, 联络段端点复用) |
| PlatformTrackBinding | 7 |
| StoppingPoint | 7 |
| DoubleTrackPair | 1 (auto, up=[1番A,2番A,UL,1番B], down=[3番A,4番A,DL,3番B], shared=[2番B]) |

### 5.3 Binding 表 (体现 side 不变量)

| 站台 | edge | edge 几何方向 | platform 在 edge 哪侧 | side |
|---|---|---|---|---|
| PA | 1番A | 西→东 | 南 | **right** |
| PA | 2番A | 西→东 | 北 | **left** |
| PB | 3番A | 东→西 | 南 | **left** (东→西时北=right) |
| PB | 4番A | 东→西 | 北 | **right** |
| PC | 1番B | 西→东 | 南 | **right** |
| PD | 2番B | 西→东 | 南 | **right** |
| PD | 3番B | 东→西 | 北 | **right** |

---

## 6. 四种情形 (PoC 场景)

| # | 场景 | start | end | 期望 phases | 期望 turnback edge |
|---|---|---|---|---|---|
| 1 | 纯上行 | `platform: PA, direction: up` | `platform: PC, direction: up` | `[up_run]` | — |
| 2 | 纯下行 | `platform: PD, direction: down` | `platform: PB, direction: down` | `[down_run]` | — |
| 3 | 上→下换向 (跨站) | `platform: PA, direction: up` | `platform: PB, direction: down` | `[up_run, turnback, down_run]` | 2番B |
| 4 | 下→上换向 (同站) | `platform: PD, direction: down` | `platform: PC, direction: up` | `[down_run, turnback, up_run]` | 2番B |

> **关于跨站下→上 换向**: 在本 PoC 的拓扑 (上行单线 A→B + 下行单线 B→A) 中, PD→PA 这种跨站下→上换向**物理不可行**, 因为没有 站 B 反向回站 A 的上行通路。算法正确返回"无候选"。真实铁路中这种换向只能在终点站 / 折返站 / 三角线 完成。S4 改为同站换向 PD→PC 以验证 turnback phase 形态。

### 6.1 典型路径形态

**Scenario 1 (纯上行 PA→PC)** 最短候选:
```
1番A → up_link → 1番B
```
phase: 单段 up_run, 路径长 ~ (站 A 1番长度) + (联络长度) + (站 B 1番长度)
trace: stop on 1番A (PA up) + stop on 1番B (PC up)

**Scenario 3 (上→下换向 PA→PB)** 典型候选:
```
1番A → up_link → 1番B → B-east-1-2 → 2番B[turnback] → B-west-2-3 → 3番B → ... 
```
但 3番B 是 forward + down, 几何 东→西。从 2番B 西端经 B-west-2-3 到 3番B 西端 = 3番B 的 toNode。这是 traversal=forward 的反向, 不允许!

**实际可行路径**:
- 从 PA 走 1番A (向东) → up_link → 1番B (向东)
- 进 B 东咽 1-2 → 抵达 2番B 东端 (= 2番B toNode)
- 但是要在 2番B 上换向, 需要先"走过"2番B (从某端进入). 现在从东端 (toNode) 进入 2番B, 沿 to→from (东→西) 通过 2番B, 抵达 2番B 西端 (fromNode). 2番B 是 traversal=both 允许。
- 在 2番B 上 turnback: currentNode 翻回 2番B 东端 (= toNode)
- 然后通过 B 东咽 2-3 → 3番B 东端 (= 3番B fromNode), 沿 from→to (东→西) 走完 3番B, 到 3番B 西端
- 经 down_link → 4番A 东端 → 沿 from→to (东→西) 走完 4番A
- 命中 PB 在 4番A 上的 binding

phase: [up_run on (1番A, UL, 1番B, B-east-1-2, 2番B), turnback on 2番B, down_run on (B-east-2-3, 3番B, DL, 4番A)]

trace: 上行段沿途有 stop on 1番A/2番A/1番B → 但 simple path 只走过 1番A 和 1番B 一次。每个 platform-served edge 生成 1 stop entry. 在 2番B 上有 turnback stop entry. 下行段在 3番B 和 4番A 各 1 stop entry。

> 注: 实际 phase 边界要看 buildPhases 实现。
> 我的实现: turnback edge 同时归入"上一段 up_run" (即在切分时, turnback 之前的 edges 含 2番B). turnback phase 单独占位 (startIdx == endIdx == 2番B 的位置)。然后 turnback 之后的 edges 归 down_run。

---

## 7. 暴露的底层不足 (本轮发现)

| 严重度 | 项 | 处理 |
|---|---|---|
| minor | `TopologyLookup.bindingsByPlatform` 缺失 | 已在 Phase B 加 |
| minor | `TopologyLookup.edgesByDirectionRole` 缺失 | 已在 Phase B 加 |
| minor | 缺少 `isDirectionRoleCompatible` / `isTurnbackAllowed` / `oppositeDirectionRole` 三个 helper | 已在 Phase B 加 |
| info | `PlatformTrackBinding.servingDirection` 的 `unknown` 值在 PoC 中用于 2番B (中线), 算法时需把 unknown 视为通配 | 已在 `getPlatformDirectedEdges` 中处理 |
| info | edge 中部起点 (measure ∈ (0, 1)) 未支持; 起点只能在 fromNode / toNode | 现阶段 OK, 后续切分 edge 支持 |

---

## 8. 未来工作 (本轮不做)

| 优先级 | 项 |
|---|---|
| P1 | Dijkstra (按 lengthMeters 加权) 替代全量 DFS, 提升大图效率 |
| P1 | K-最短路径 (Yen's) 提供 top-K 不同形态候选 |
| P2 | 评分 (PathGenerationScore): 方向匹配 / 换乘次数 / 优选主线 |
| P2 | edge 中部起点 (虚拟切分 / measure-based seed) |
| P2 | 多次换向路径的剪枝 (例如禁止 1 条路径上 ≥ 2 次换向) |
| P3 | Switch point 物理建模, 替换 connector edge 简化 |
| P3 | ServicePattern 上下文 — 用 lineRef 提供"上下行约定" |

---

## 9. 验证步骤

### 9.1 类型检查
```sh
npx tsc --noEmit -p tsconfig.json
```
预期 `rail-graph-v1*` 0 错误。

### 9.2 Dev server
1. 启动 vite, 打开 `/rail-graph-mvp.html`
2. 按 **"Pathfinding 4 场景"** 按钮
3. 输出 JSON 应满足:
   - `summary.total === 4` 且 `summary.passed === 4` (理想)
   - `scenarios[0].best.phases.length === 1` 且 `kind === "up_run"`
   - `scenarios[1].best.phases.length === 1` 且 `kind === "down_run"`
   - `scenarios[2].best.phases.map(p => p.kind) === ["up_run", "turnback", "down_run"]`
   - `scenarios[2]` 的 turnback phase 中 `edgeSequence[edgeRange.startIndex] === TRACK_B2 edge id`
   - `scenarios[3].best.phases.map(p => p.kind) === ["down_run", "turnback", "up_run"]`

### 9.3 失败排查
- 若 `scenarios[0]` 或 `[1]` failed: 检查 `getPlatformDirectedEdges` 是否正确返回 binding
- 若 `scenarios[2]` 或 `[3]` 没有 turnback: 检查 2番B 的 `functionalUse` 是否含 "turnback" 且 traversal 是 "both"
- 若有 `NO_PATH_FOUND`: 检查 connector 是否连通 (西/东咽喉应让 1番B↔2番B 与 2番B↔3番B 都可走)
