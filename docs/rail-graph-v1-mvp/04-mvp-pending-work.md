# MVP 待完成工作 — 方向语义 + 寻径 + 信号机 + 方向箭头

> 本文档记录 Rail Graph v1 MVP 当前轮次改造中**已完成 / 未完成**的任务、
> 详细 context、按文件分组的修改需求、与验证步骤。
> 可独立于其他人的 chat 上下文重启实施。
>
> 关联设计 plan: `C:\Users\WRH\.claude\plans\1-track-xx-indexed-pillow.md`

---

## 1. Context (本轮要解决的问题)

测试中暴露的 4 个交叉问题:

### 1.1 directionRole 命名混淆
现有 `TrackDirectionRole = "up_main" | "down_main" | "siding" | "reversible"` 把
"方向"和"主线身份"两个正交维度绑死。结果: 1番A (本线) 与 2番A (副本) 在
`directionRole` 上完全无区分 (都是 `up_main`); 主/副本身份应由 `physicalKind`
表达, 但寻径算法没用上。

### 1.2 寻径起点偏好缺失 + filter bug
- PoC 中 PD 同时绑定 3番B (main) 与 2番B (中线)。`resolveSeed` 的 filter
  `!b.servingDirection || b.servingDirection === seed.direction` 把
  `servingDirection: "unknown"` (字符串) 错误排除 — 因为 `!"unknown" === false`。
- 用户期望 PD seed=down 时 应产生 2 个候选: 主线起步 (3番B...) + 越行线起步 (2番B...),
  主线优先排序。
- 用户原则: **寻径起点终点必须从主线开始**, 越行线起步作为备选 (列车停留在副线时)。

### 1.3 双向运行 vs 允许换向 没区分
现模型用 `traversal: "both"` + `functionalUse: ["turnback"]` 间接表达 reversible,
不直接。connector edges 也是 `traversal=both` 但不允许换向, 两者语义混在一起。
**reversible 蕴含 bidirectional 的运行能力, 是 bidirectional 的特化**。

### 1.4 可视化缺方向 + 信号机缺失
polyline 只有颜色没有方向箭头; 选中 path 没法看出每段实际运行方向;
换向 edge 没有专门视觉标识。信号机数据结构完全没有。
信号机**必须设在道岔外**, 而原 main edge 端点就是道岔位置 — 因此需要新增"站外延伸段"。

---

## 2. 已完成 (任务 27-28)

### ✅ VIS2-A: 底层类型重构 (task 27)

**`src/rail-graph-v1/base-topology.types.ts`**:
- `TrackDirectionRole` 重定义为 `"up" | "down" | "bidirectional" | "reversible"`
- 新增 `Signal` interface (`{ id, edgeRef, measure, facing, name? }`)
- `BaseTopologyLayer` 增加 `signals: Signal[]` 字段

**`src/rail-graph-v1/annotation.types.ts`**:
- `RailGraphFeatureKind` 加入 `"signal_point"`
- 新增 `RailGraphSignalAnnotation` (`{ edgeRef, measure, facing, name? }`)
- `RailGraphAnnotation` 加 `signal?: RailGraphSignalAnnotation`

**`src/rail-graph-v1/topology.ts`**:
- `isTurnbackAllowed`: 改判 `directionRole === "reversible" && functionalUse 含 "turnback"`
- `isDirectionRoleCompatible`: bidirectional / reversible 与任意兼容; up↔up, down↔down 兼容; up↔down 不兼容
- `oppositeDirectionRole`: up↔down, 其他返回 undefined
- `getPlatformDirectedEdges`: filter 视 `"unknown"` 字符串为通配
- `aggregateDoubleTrackPairs`: up→upEdgeRefs, down→downEdgeRefs, bidirectional/reversible→sharedGeometryEdgeRefs
- `TopologyLookup` 加 `signalsByEdge: Record<string, Signal[]>`; `edgesByDirectionRole` 改用新 4 值
- `buildTopologyLookup` 填充 `signalsByEdge`

### ✅ VIS2-B: 寻径起点修复 (task 28)

**`src/rail-graph-v1/pathfinding.ts`**:
- `SeedEntryPoint` 加 `startKind?: "main" | "siding"`
- `resolveSeed`: filter 视 `"unknown"` 为通配; platform seed 中每个 binding 推 entryPoint 时根据 `edge.physicalKind` 设 `startKind`; 末尾按 main 在前排序
- `PathfindingOptions` 加 `allowSidingStarts?: boolean` (默认 true)
- `PathfindingResult` 加 `startKind: "main" | "siding"` 与 `turnbackEdgeIndices: number[]`
- `RawCandidate` 加 `startKind`; `DfsState` 加 `startKind`
- `createInitialState` 设置 `startKind`
- `findPaths` 过滤 siding 起步 (若 `allowSidingStarts === false`)
- `buildResultFromCandidate` 把 `startKind` 和 `[...raw.turnbackAt]` 写入 result
- pathfinding.ts 内部全部 `up_main`/`down_main` 字面量改为 `"up"` / `"down"` (10+ 处)

---

## 3. 未完成 (任务 29-36)

### 🟡 VIS2-C: 编译器加 signal + directionRole fallback (task 29)

文件: `src/rail-graph-v1-mvp/app.ts`

改动:
1. 新增 `addSignalFeature(topo, diagnostics, feature, annotation, featureIndex)`:
   - 取 `annotation.signal` (RailGraphSignalAnnotation)
   - 直接拷字段到 `Signal { id: annotation.id, edgeRef, measure: clampMeasure(...), facing, name }`
   - push 到 `topo.signals`
   - 校验: 若 `annotation.signal === undefined`, 发 error `MVP_SIGNAL_MISSING_FIELDS`
   - 校验: 若 `topo.edges` 不含该 edgeRef, 发 error `MVP_SIGNAL_MISSING_EDGE`
2. `compileTopology` 的 4 pass 中加: 当 `annotation.kind === "signal_point"` 时调 `addSignalFeature`
3. 初始化 topo 时, `signals: []` 加入 `EMPTY_TOPO` 常量
4. `compileTopology` 末尾扫描 edges: 若 `edge.traversal === "both"` 且 `edge.directionRole === undefined`, 自动填 `"bidirectional"` 并发 info 诊断 `MVP_TRACK_DIRECTION_ROLE_INFERRED_BIDIRECTIONAL`
5. `addTrackFeature` 加额外校验: 若 `functionalUse 含 "turnback"` 但 `directionRole !== "reversible"`, 发 warn `MVP_REVERSIBLE_WITHOUT_TURNBACK_ROLE`

诊断 code 全部加入 `01-mvp-reference.md` 的诊断表 (见 task J)。

### ⏳ VIS2-D: PoC 数据更新 (task 30)

#### 文件: `src/rail-graph-v1-mvp/poc-twostation.ts`

A. **directionRole 重命名**:
   - 1番A / 2番A: `directionRole: "up_main"` → `"up"`
   - 3番A / 4番A: `directionRole: "down_main"` → `"down"`
   - 1番B: `directionRole: "up_main"` → `"up"`
   - 3番B: `directionRole: "down_main"` → `"down"`
   - 2番B: 保持 `directionRole: "reversible"`
   - UP_LINK: `directionRole: "up_main"` → `"up"`
   - DOWN_LINK: `directionRole: "down_main"` → `"down"`
   - 所有 8 个 connector edges: 显式声明 `directionRole: "bidirectional"` (现在没声明)

B. **PD→2番B binding** `servingDirection: "unknown"` 改为**省略字段**。

C. **新增 4 条站外延伸段 main edge** (因信号机必须在道岔外):

```ts
const LON_A_FAR_WEST = 139.6960;  // 站 A 西端外延
const LON_B_FAR_EAST = 139.7120;  // 站 B 东端外延

const nodeA1WestExt: GeoJSONPosition = [LON_A_FAR_WEST, LAT_A1];
const nodeA4WestExt: GeoJSONPosition = [LON_A_FAR_WEST, LAT_A4];
const nodeB1EastExt: GeoJSONPosition = [LON_B_FAR_EAST, LAT_B1];
const nodeB3EastExt: GeoJSONPosition = [LON_B_FAR_EAST, LAT_B3];

const TRACK_A1_WEST_EXT = "demo:track:A1_west_ext";  // 上行: 西远→站 A 西端 (匹配 up)
const TRACK_A4_WEST_EXT = "demo:track:A4_west_ext";  // 下行: 站 A 西端→西远 (匹配 down)
const TRACK_B1_EAST_EXT = "demo:track:B1_east_ext";  // 上行: 站 B 东端→东远
const TRACK_B3_EAST_EXT = "demo:track:B3_east_ext";  // 下行: 东远→站 B 东端
```

加 4 个 `buildMainTrack` 调用 (Feature 数组中):
- `buildMainTrack(TRACK_A1_WEST_EXT, "A1 西延伸", "A1ext", "up",   "forward", nodeA1WestExt, nodeA1West)`
- `buildMainTrack(TRACK_A4_WEST_EXT, "A4 西延伸", "A4ext", "down", "forward", nodeA4West,    nodeA4WestExt)` ← 注意几何 east→west
- `buildMainTrack(TRACK_B1_EAST_EXT, "B1 东延伸", "B1ext", "up",   "forward", nodeB1East,    nodeB1EastExt)`
- `buildMainTrack(TRACK_B3_EAST_EXT, "B3 东延伸", "B3ext", "down", "forward", nodeB3EastExt, nodeB3East)`

`physicalKind` 默认 "main" (`buildMainTrack` 第 8 参数省略)。
延伸段远端 (LON_A_FAR_WEST / LON_B_FAR_EAST) 是 dangling 端点 — 不接任何其它 edge。

D. **新增 4 个 signal_point feature**:

```ts
// 站 A 西进站信号机 (控制东向, 即上行进站 A)
{
  type: "Feature",
  geometry: { type: "Point", coordinates: [LON_A_FAR_WEST + (LON_A_WEST - LON_A_FAR_WEST) * 0.5, LAT_A1] },
  properties: {
    name: "A1 西进站",
    railGraph: {
      kind: "signal_point",
      schemaVersion: "rail-graph-v1",
      id: "demo:signal:A_west_in_up",
      source: "demo",
      signal: {
        edgeRef: buildEdgeId(TRACK_A1_WEST_EXT),
        measure: 0.5,
        facing: "forward",
        name: "A1 西进站",
      },
    },
  },
},
// 站 A 西出站信号机 (控制西向, 即下行出站 A)
// → edgeRef: buildEdgeId(TRACK_A4_WEST_EXT), measure: 0.5, facing: "forward", name: "A4 西出站"
// 站 B 东出站信号机 (控制东向, 即上行出站 B)
// → edgeRef: buildEdgeId(TRACK_B1_EAST_EXT), measure: 0.5, facing: "forward", name: "B1 东出站"
// 站 B 东进站信号机 (控制西向, 即下行进站 B)
// → edgeRef: buildEdgeId(TRACK_B3_EAST_EXT), measure: 0.5, facing: "forward", name: "B3 东进站"
```

E. **TwoStationRefs export 新增**:
```ts
TRACK_A1_WEST_EXT: buildEdgeId(TRACK_A1_WEST_EXT),
TRACK_A4_WEST_EXT: buildEdgeId(TRACK_A4_WEST_EXT),
TRACK_B1_EAST_EXT: buildEdgeId(TRACK_B1_EAST_EXT),
TRACK_B3_EAST_EXT: buildEdgeId(TRACK_B3_EAST_EXT),
SIGNAL_A1_WEST: "demo:signal:A_west_in_up",
SIGNAL_A4_WEST: "demo:signal:A_west_out_down",
SIGNAL_B1_EAST: "demo:signal:B_east_out_up",
SIGNAL_B3_EAST: "demo:signal:B_east_in_down",
```

#### 文件: `src/rail-graph-v1-mvp/poc-liangmiansixian.ts`

- 所有 directionRole `"up_main"` → `"up"`, `"down_main"` → `"down"`
- connector edges 加 `directionRole: "bidirectional"` (它们当前可能未显式声明)
- 不加 signal (仅作回归测试)

#### 文件: `src/rail-graph-v1-mvp/app.ts`

- 顶部 `EMPTY_TOPO` 常量加 `signals: []` 字段 (与 base-topology.types 同步)

### ⏳ VIS2-E: Map 方向箭头 (task 31)

文件: `src/rail-graph-v1-mvp/map-view.ts`

A. **加 `arrowLayer: L.LayerGroup`** 到 `InternalState`:
```ts
arrowLayer: L.LayerGroup;
```
初始化: `arrowLayer: L.layerGroup().addTo(map)`. 位置在 `featureGroup` 之上。

B. **在 `rebuildLayers` 中, 渲染 edge polyline 后, 计算每条 edge 的中点 + bearing, 加方向箭头 marker**:

```ts
function buildEdgeArrow(edge: TopologyEdge, polyline: L.Polyline): L.Marker {
  const latLngs = polyline.getLatLngs() as L.LatLng[];
  const midIdx = Math.floor(latLngs.length / 2);
  // 中点: 单 LineString 取中间; 多点取 latLngs[mid] (或 lerp 整段累计长度的 0.5 位置)
  const mid = midpointLatLng(latLngs);
  const bearing = bearingDegrees(latLngs[0], latLngs[latLngs.length - 1]);
  const icon = arrowIcon(edge.directionRole, bearing);
  return L.marker(mid, { icon, interactive: false });
}

function midpointLatLng(latLngs: L.LatLng[]): L.LatLng {
  // 简单实现: 沿路径累计长度找 0.5 处
  if (latLngs.length === 2) {
    return L.latLng((latLngs[0].lat + latLngs[1].lat) / 2, (latLngs[0].lng + latLngs[1].lng) / 2);
  }
  // 长 LineString: lerp 总长度的 0.5
  // ...
}

function bearingDegrees(a: L.LatLng, b: L.LatLng): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180)
    - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
```

C. **arrowIcon 4 种形态** (SVG 通过 L.divIcon):

```ts
function arrowIcon(directionRole: TrackDirectionRole | undefined, bearing: number): L.DivIcon {
  const color = directionRole === "up" ? "#1d4ed8"
    : directionRole === "down" ? "#b91c1c"
    : directionRole === "reversible" ? "#7e22ce"
    : "#94a3b8";  // bidirectional / undefined
  
  let svg: string;
  if (directionRole === "reversible") {
    // ⟲ 圆弧箭头
    svg = `<svg width="24" height="24" viewBox="0 0 24 24">
      <path d="M 6 12 A 6 6 0 1 1 12 18" stroke="${color}" stroke-width="2.5" fill="none"/>
      <polygon points="9,16 13,18 10,21" fill="${color}"/>
    </svg>`;
  } else if (directionRole === "bidirectional") {
    // ⇄ 双向三角并列
    svg = `<svg width="28" height="14" viewBox="0 0 28 14">
      <polygon points="0,3 8,7 0,11" fill="${color}"/>
      <polygon points="28,3 20,7 28,11" fill="${color}"/>
    </svg>`;
  } else {
    // ▶ 单向三角, 朝 bearing 旋转
    svg = `<svg width="18" height="18" viewBox="0 0 18 18" style="transform:rotate(${bearing - 90}deg)">
      <polygon points="3,3 15,9 3,15" fill="${color}"/>
    </svg>`;
  }
  return L.divIcon({
    html: svg,
    className: "mvp-arrow-icon",
    iconSize: directionRole === "reversible" ? [24, 24] : directionRole === "bidirectional" ? [28, 14] : [18, 18],
    iconAnchor: directionRole === "reversible" ? [12, 12] : directionRole === "bidirectional" ? [14, 7] : [9, 9],
  });
}
```

注意 SVG `rotate(bearing - 90)`: SVG ▶ 默认朝东 (右), bearing 0 = 北, 90 = 东, 所以 rotate(bearing - 90)。

D. **`arrowLayer` 在 update 时被 `clearLayers()` 然后填满**:
```ts
state.arrowLayer.clearLayers();
// ... 渲染每条 edge 时:
const arrow = buildEdgeArrow(edge, polyline);
arrow.addTo(state.arrowLayer);
// 记录 edge.id → marker, 用于路径高亮时 opacity 操作
state.arrowsByEdge.set(edge.id, arrow);
```

`InternalState` 加 `arrowsByEdge: Map<string, L.Marker>`。

E. **不要让箭头响应 interactive 事件**, 否则会"偷"hover (`interactive: false`).

### ⏳ VIS2-F: 路径高亮方向叠加 + turnback ⟲ (task 32)

文件: `src/rail-graph-v1-mvp/map-view.ts`

A. **加 `pathArrowLayer: L.LayerGroup`** 在 `InternalState`:
```ts
pathArrowLayer: L.LayerGroup;
dimmedArrowKeys: Set<string>;  // 当前被路径暗淡的原 arrow edge.id
```

B. **`highlightPath(edgeSequence, turnbackEdgeIndices?)` 重写**:

```ts
function applyPathHighlight(state: InternalState, edgeSequence: EntityRef[], turnbackEdgeIndices: number[] = []): void {
  clearPathHighlight(state);
  if (edgeSequence.length === 0) return;

  const turnbackSet = new Set(turnbackEdgeIndices);
  let entryNode: L.LatLng | null = null;  // 追踪 path 的实际行进方向, 从首条 edge 任一端推算

  for (let i = 0; i < edgeSequence.length; i++) {
    const edgeRef = edgeSequence[i];
    const entry = state.entityLayers.get(edgeRef);
    if (!entry || entry.kind !== "edge") continue;
    const polyline = entry.layer as L.Polyline;
    const latLngs = polyline.getLatLngs() as L.LatLng[];
    if (latLngs.length < 2) continue;

    // 1) 主线绿色叠层 (现已实现, 保留)
    const overlay = L.polyline(latLngs, { color: "#16a34a", weight: 7, opacity: 0.85, lineCap: "round" });
    overlay.addTo(state.pathHighlightGroup);

    // 2) 暗淡或隐藏原 arrow
    const originalArrow = state.arrowsByEdge.get(edgeRef);
    if (originalArrow) {
      const edgeObj = state.topo?.edges.find(e => e.id === edgeRef);  // 或从 state.edgesById
      // 单向 edge: opacity 0; bidirectional: opacity 0.15 (反向暗淡); reversible: 0 (会被绿色 ⟲ 取代)
      const dimOpacity = (edgeObj?.directionRole === "bidirectional") ? 0.15 : 0;
      originalArrow.setOpacity(dimOpacity);
      state.dimmedArrowKeys.add(edgeRef);
    }

    // 3) path 实际行进方向箭头 (绿色)
    // 推算行进 bearing: 第一条 edge 用 polyline 几何 from→to 或 to→from? 
    // 由 path 顺序 + 节点匹配推算: 若上条 edge.toNode === 此 edge.fromNode → 从 from 进; 反之 to 进.
    // 第一条 edge: 无前条 → 取 PoC 假设 (from→to 方向)? 用 path 第二条来反推首条出口节点
    const pathBearing = computePathBearing(state, edgeSequence, i, latLngs);
    const mid = midpointLatLng(latLngs);

    let pathArrowIcon: L.DivIcon;
    if (turnbackSet.has(i)) {
      // ⟲ 绿色加粗换向标记
      pathArrowIcon = L.divIcon({
        html: `<svg width="32" height="32" viewBox="0 0 32 32">
          <path d="M 8 16 A 8 8 0 1 1 16 24" stroke="#15803d" stroke-width="4" fill="none"/>
          <polygon points="12,21 17,24 13,28" fill="#15803d"/>
        </svg>`,
        className: "mvp-path-arrow-turnback",
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
    } else {
      pathArrowIcon = L.divIcon({
        html: `<svg width="22" height="22" viewBox="0 0 22 22" style="transform:rotate(${pathBearing - 90}deg)">
          <polygon points="3,3 19,11 3,19" fill="#16a34a" stroke="#15803d" stroke-width="1"/>
        </svg>`,
        className: "mvp-path-arrow",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
    }
    L.marker(mid, { icon: pathArrowIcon, interactive: false }).addTo(state.pathArrowLayer);

    entryNode = latLngs[latLngs.length - 1];  // ...
  }

  // 4) 起终点 marker (沿用现有 logic)
  // ...
}
```

C. **`computePathBearing(state, edgeSequence, i, latLngs)`**:
- 通过 `state.edgesById[edgeSequence[i]]` 得到 edge.fromNode / toNode (L.LatLng 形式)
- 上一条 edge (i-1) 的出口节点 = 此条 edge 的入口
- 第一条 edge: 从 path 第二条反推入口; 若无第二条, 用 from→to 方向

(实现细节: `path edge` 的"入口节点"由 path 连接关系唯一确定 — 即上一条 edge 的"出口节点"必然等于本条 edge 的 from 或 to 端之一。)

D. **`clearPathHighlight` 还原 arrows opacity**:
```ts
function clearPathHighlight(state: InternalState): void {
  state.pathHighlightGroup.clearLayers();
  state.pathArrowLayer.clearLayers();
  state.pathEndpointGroup.clearLayers();
  for (const edgeRef of state.dimmedArrowKeys) {
    const arrow = state.arrowsByEdge.get(edgeRef);
    if (arrow) arrow.setOpacity(1);
  }
  state.dimmedArrowKeys.clear();
}
```

E. **`MapView.highlightPath` 签名改**:
```ts
highlightPath(edgeSequence: EntityRef[], turnbackEdgeIndices?: number[]): void;
```

F. **`app.ts` 调用方** 改:
```ts
listView.onPathHover((path) => {
  if (path) {
    // path 现在是 { edgeSequence, turnbackEdgeIndices } 对象, 不只是 array
    mapView?.highlightPath(path.edgeSequence, path.turnbackEdgeIndices);
  } else {
    mapView?.clearHighlight();
  }
});
```

`ListView.onPathHover` / `onPathClick` 签名需要相应改 (handler 接受对象而不是 array). `list-view.ts` 中触发处带上 `result.turnbackEdgeIndices`。

### ⏳ VIS2-G: Map 信号机渲染 (task 33)

文件: `src/rail-graph-v1-mvp/map-view.ts`

A. **加 `signalLayer: L.LayerGroup`** 到 `InternalState`:
```ts
signalLayer: L.LayerGroup;
```

B. **`rebuildLayers` 中, 渲染 signals**:
```ts
state.signalLayer.clearLayers();
for (const signal of topo.signals) {
  const edge = lookup.edgesById[signal.edgeRef];
  if (!edge) continue;
  const edgeFeature = annotationIdToFeature.get(edge.sourceSlice?.sourceFeatureRef ?? "");
  if (!edgeFeature) continue;
  const coords = extractEdgeCoordinates(edgeFeature, edge.sourceSlice?.multiLineIndex);
  if (!coords || coords.length < 2) continue;
  const latLngs = coords.map(c => L.latLng(c[1], c[0]));
  const point = interpolateAlong(latLngs, signal.measure);  // measure 0-1
  
  const icon = signalIcon(signal.facing);
  const marker = L.marker(point, { icon });
  marker.bindTooltip(`<b>${escapeHtml(signal.name ?? signal.id)}</b><br/>facing: ${signal.facing}<br/>m=${signal.measure}`,
    { sticky: true, direction: "top" });
  bindLayerEvents(state, marker, signal.id);
  marker.addTo(state.signalLayer);
  state.entityLayers.set(signal.id, { layer: marker as unknown as L.Path, baseStyle: {}, kind: "station" });
  // ↑ entityLayers 里把 signal 算作 station-like, 以便联动 highlight (或单独加 "signal" kind)
}
```

C. **`signalIcon(facing)`**:
```ts
function signalIcon(facing: "forward" | "reverse" | "both"): L.DivIcon {
  // 小红圆点 + facing 方向短线指示 (forward=右, reverse=左, both=两侧)
  const fwdLine = facing !== "reverse" ? `<line x1="10" y1="10" x2="16" y2="10" stroke="#dc2626" stroke-width="2"/>` : "";
  const revLine = facing !== "forward" ? `<line x1="4" y1="10" x2="10" y2="10" stroke="#dc2626" stroke-width="2"/>` : "";
  const svg = `<svg width="20" height="20" viewBox="0 0 20 20">
    ${fwdLine}${revLine}
    <circle cx="10" cy="10" r="4" fill="#dc2626" stroke="#7f1d1d" stroke-width="1"/>
  </svg>`;
  return L.divIcon({ html: svg, className: "mvp-signal-icon", iconSize: [20, 20], iconAnchor: [10, 10] });
}
```

D. **`interpolateAlong(latLngs, measure)`**:
- 计算 latLngs 累计长度
- 找 measure (0-1) 对应的累计长度位置
- lerp 出 LatLng

E. **LayerEntry 类型 加 `"signal" kind`** (避免把 signal 当 station):
```ts
interface LayerEntry {
  layer: L.Path | L.Marker;
  baseStyle: L.PathOptions;
  kind: "station" | "platform" | "edge" | "signal";
}
```
(注意 L.Marker 不是 L.Path, style 不一样。可能需要 union 类型。)

### ⏳ VIS2-H: list-view 适配 (task 34)

文件: `src/rail-graph-v1-mvp/list-view.ts`

A. **候选 candidateItem 加 siding-start badge**:
```ts
function candidateItem(c: PathfindingResult, sIdx, cIdx, state): string {
  const sidingBadge = c.startKind === "siding"
    ? `<span class="lv-badge" style="background:#f59e0b;color:#fff;margin-left:6px">siding-start</span>` : "";
  return `<div class="lv-candidate ${isSelected ? "selected" : ""}" data-scenario-idx="${sIdx}" data-candidate-idx="${cIdx}">
    <div>[${cIdx}] ${Math.round(c.totalDistanceMeters)}m · ${c.edgeSequence.length} edges${sidingBadge}</div>
    ...
  </div>`;
}
```

B. **Edge list-item 用新 directionRole 值**: (无需改, 已通过 `e.directionRole` 显示)

C. **新增 Signals section** 在 Topology tab:
```ts
${section("Signals", topo.signals, (s) => signalItem(s))}

function signalItem(s: Signal): string {
  return `<div class="lv-item" data-ref="${escapeAttr(s.id)}" data-also-ref="${escapeAttr(s.edgeRef)}">
    <strong>${escapeHtml(s.name ?? s.id)}</strong>
    <div class="meta">facing: ${s.facing} · m=${s.measure} · edge: ${shortId(s.edgeRef)}</div>
  </div>`;
}
```

D. **path hover 传 turnbackEdgeIndices**:
```ts
cand.addEventListener("mouseenter", () => {
  state.pathHoverHandlers.forEach((h) => h({
    edgeSequence: candidate.edgeSequence,
    turnbackEdgeIndices: candidate.turnbackEdgeIndices,
  }));
});
// click 同理
```

E. **`ListView` 接口签名** 改:
```ts
onPathHover(handler: (path: { edgeSequence: EntityRef[]; turnbackEdgeIndices: number[] } | null) => void): void;
onPathClick(handler: (path: { edgeSequence: EntityRef[]; turnbackEdgeIndices: number[] }) => void): void;
```

### ⏳ VIS2-I: poc-pathfinding S4 多候选期望 (task 35)

文件: `src/rail-graph-v1-mvp/poc-pathfinding.ts`

A. `PathfindingScenario` 加期望字段:
```ts
expectedStartKind?: "main" | "siding";  // 默认 "main"
expectedMinCandidates?: number;  // 默认 1
```

B. S4 加:
```ts
{
  name: "Scenario 4: 下→上换向 (PD → PC, 同站)",
  ...
  expectedMinCandidates: 2,  // 主线起步 + 越行线起步
  expectedStartKind: "main",  // 最优 (排在前) 应是 main
},
```

C. `runScenarios` 中判定:
```ts
const passedShape = ...;
const passedTurnback = ...;
const passedStartKind = !scenario.expectedStartKind
  || (best.startKind === scenario.expectedStartKind);
const passedMinCandidates = candidates.length >= (scenario.expectedMinCandidates ?? 1);
const passed = passedShape && passedTurnback && passedStartKind && passedMinCandidates;
```

D. `summarizeScenarios` 输出加 `startKind` 与 `turnbackEdgeIndices`:
```ts
best: r.best ? {
  ...,
  startKind: r.best.startKind,
  turnbackEdgeIndices: r.best.turnbackEdgeIndices,
  ...
}
```

### ⏳ VIS2-J: 3 份文档同步 (task 36)

文件: `docs/rail-graph-v1-mvp/`

#### `01-mvp-reference.md` 改:
- §2.4 `TrackDirectionRole` 值列表更新为 `up / down / bidirectional / reversible`
- §2.4 加 `Signal` interface 行 (`id / edgeRef / measure / facing / name`)
- §2.4.4 `BaseTopologyLayer` 加 `signals: Signal[]`
- §3.2 实体计数加 `Signal: 4` (PoC twostation)
- §5 编译期诊断表新增 3 行: `MVP_SIGNAL_MISSING_FIELDS` (error), `MVP_SIGNAL_MISSING_EDGE` (error), `MVP_TRACK_DIRECTION_ROLE_INFERRED_BIDIRECTIONAL` (info), `MVP_REVERSIBLE_WITHOUT_TURNBACK_ROLE` (warn)
- §7.1 已解决项加: directionRole 重命名; signal 数据结构

#### `02-mvp-pathfinding.md` 改:
- §3 换向规则: 改用 `directionRole === "reversible"` 替代 `traversal === "both"`. 解释 reversible ⊃ bidirectional
- §3 加 `bidirectional` 与 `reversible` 区别说明
- §2.1 `PathfindingOptions` 加 `allowSidingStarts?: boolean` 行
- §2.1 `PathfindingResult` 加 `startKind` 与 `turnbackEdgeIndices` 行
- §4.1 算法总体: filter bug 修复说明; 主线优先排序; siding 起步候选
- §6 4 场景表: S4 改为 "PD → PC 同站换向", 期望 candidates ≥ 2, best.startKind=main
- §7 暴露的底层不足: 划掉 "filter bug"; 加 "信号机不参与寻径"

#### `03-mvp-visualization.md` 改:
- §1 ASCII 布局图: 标注 "[延伸段]" 在左右两端
- §4 颜色方案表 加 directionRole=bidirectional 灰色; reversible 紫色
- §4 加 "方向箭头" 表 (4 种形态 ▶ / ⇄ / ⟲ 及颜色)
- §4 加 "Signals" 行 (红色圆点 + facing 短线)
- §5 路径高亮规则改: 加 turnback 用 ⟲ 绿色加粗; bidirectional 反向暗淡; 单向隐藏
- §3 联动表: 加 "hover signal" 行 (高亮 signal 自身 + 其 edge)
- §7 已知限制: 加 "信号机必须在道岔外, 需要额外延伸段轨道"

---

## 4. 按文件汇总待改清单

| 文件 | 涉及 task | 改动 |
|---|---|---|
| `src/rail-graph-v1-mvp/app.ts` | C, D | `addSignalFeature` + compile pass 调用; `EMPTY_TOPO.signals=[]`; directionRole bidirectional fallback; functionalUse-turnback 校验 warn |
| `src/rail-graph-v1-mvp/poc-twostation.ts` | D | directionRole 改名; 4 延伸段 edges; 4 signal features; PD-2番B 去 unknown; TwoStationRefs exports |
| `src/rail-graph-v1-mvp/poc-liangmiansixian.ts` | D | directionRole 改名; connector 显式 bidirectional |
| `src/rail-graph-v1-mvp/poc-pathfinding.ts` | I | scenario 加 expectedStartKind/expectedMinCandidates; S4 期望; runScenarios 判定; summarize 输出新字段 |
| `src/rail-graph-v1-mvp/map-view.ts` | E, F, G | arrowLayer + arrowsByEdge; pathArrowLayer + dimmedArrowKeys; signalLayer; SVG divIcon 4 种箭头形态; signalIcon; highlightPath 新签名; interpolateAlong / bearingDegrees / midpointLatLng utils |
| `src/rail-graph-v1-mvp/list-view.ts` | H | candidate siding-start badge; Signals section + signalItem; onPathHover/Click 接口签名改; 触发处带 turnbackEdgeIndices |
| `docs/rail-graph-v1-mvp/01-mvp-reference.md` | J | directionRole 4 值; Signal 类型; 诊断 code 4 条; 已解决项 |
| `docs/rail-graph-v1-mvp/02-mvp-pathfinding.md` | J | 换向规则; allowSidingStarts; startKind; turnbackEdgeIndices; 4 场景 S4 修改 |
| `docs/rail-graph-v1-mvp/03-mvp-visualization.md` | J | 延伸段标注; 方向箭头表; 信号机视觉; 路径高亮叠加规则 |

---

## 5. 验证步骤 (全部完成后)

### 5.1 静态
```sh
npx tsc --noEmit -p tsconfig.json
```
预期: `rail-graph-v1*` 与 `rail-graph-v1-mvp` 0 错误。

### 5.2 Dev server
1. `npm run dev`, 打开 `/rail-graph-mvp.html`
2. 按 "Pathfinding 4 场景" 按钮
3. 检查地图视觉:
   - 每条 main edge 中点有方向箭头 (上行▶蓝, 下行▶红)
   - connector edges 中点有灰 ⇄
   - 2番B 中点有紫色 ⟲
   - 4 个延伸段两端各有一对开放节点 (140°7'12 / 139°41'42 附近)
   - 4 个 signal 红圆点位于延伸段中部
4. 右栏 Topology tab 出现 Signals section, 4 项
5. 右栏 Pathfinding tab → 展开 S4:
   - 候选数 ≥ 2
   - `[0]` 距离短, 带橙色 `siding-start` badge (= 2番B 起步)
   - `[1]` 距离长, 无 badge (= 3番B 起步)
6. 点 S4 `[1]` (主线起步):
   - map 上 5 条 edges 加绿色 ▶ 朝实际行进方向
   - 2番B 上是**绿色 ⟲** 换向符号 (非单向箭头)
   - 通过的 connector edges (⇄) 原箭头的反向那一半暗淡 (opacity 0.15)
   - 单向 edges 的箭头被绿色覆盖 (opacity 0)
7. 切到 `[0]`: 3 条 edges 加绿色, 2番B 仍 ⟲
8. hover 任一 signal → tooltip 显示 name / facing / measure; map 上该 signal + 所在 edge 高亮
9. Diagnostics tab: 不应有 `MVP_REVERSIBLE_WITHOUT_TURNBACK_ROLE` (2番B 同时有 reversible + functionalUse turnback); 应有 `MVP_TRACK_DIRECTION_ROLE_INFERRED_BIDIRECTIONAL` 若 connector 没显式声明 (但我们要求显式, 应无)

### 5.3 断言式 (poc-pathfinding 内部)
- S1/S2/S3 each: passed=true, best.startKind=main
- S4: passed=true (即 candidates.length >= 2 且 best.startKind=main 且 phase 形态匹配)

---

## 6. Scope cuts (本轮不做)

- 信号机不参与寻径硬约束
- 信号机不做空间投影 (annotation 必须显式 edgeRef + measure)
- directionRole 旧值不向后兼容 (breaking)
- 不引入 leaflet-polylinedecorator 依赖
- 起点 measure 仅允许 0 或 1 (不切分 edge)
- 不做 multi-select / 拖拽编辑 / 地图导出
# 2026-05-24 Current MVP Progress Sync

This note updates the status of the older pending-work list in this file. The current
MVP workspace has already implemented the local workflow/pipeline foundation:

- `src/rail-graph-v1-mvp/pipeline.ts` defines project presets, workflow steps,
  pipeline stages, task/artifact types, and localStorage workspace state.
- `scripts/rail-graph-mvp-server.js` exposes the Vite dev task/artifact API.
- `vite.config.js` mounts the MVP server plugin.
- The UI now drives:
  `prepare -> clean -> annotate -> compile -> validate -> export`.
- The local stages are:
  `diagnose`, `extract`, `emitFast`, `postFix`, `match`, `manifest`,
  `planBatches`, `mergeOverride`.
- Artifact refresh, selected artifact loading, task logs, task cancellation,
  Senseki validation, and workflow snapshot export are part of the current
  workspace shell.

Treat this as completed workspace/pipeline foundation work. Remaining pending
items should focus on domain behavior that is not yet implemented, such as
signal compilation/rendering, direction arrows, path highlight refinements, and
list/map detail parity.
