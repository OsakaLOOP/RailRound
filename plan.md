# Plan: RouteSlicePreview 跨博客复用

## 目标

让 `RouteSlicePreview` 成为任何 MDX 博客（Astro / Docusaurus / Next.js 等）可引用的组件。npm 包 + 静态文件 CDN 双通道分发，零代码复制粘贴。

## 核心思路

**计算前置到导出时，而非渲染时。** 用户在主应用完成旅程后，所有中间结果（路线坐标、距离、线路 meta）已确定，直接序列化进 MDX。外部博客只需一个"纯渲染"的轻量组件。

```
用户旅程（主应用 RailleRound）
        │
        ▼
  [点击"导出为 MDX 组件"]（两处入口：FolderManagerModal / 单条 Trip 操作菜单）
        │
        ▼
  ExportRouteModal ── 选择 locale / height / theme
        │
        ▼
  routeSerializer  ── 序列化已计算的路由数据 + logo→data URI 内联
        │
        ▼
  codeGenerator    ── 生成 MDX 代码片
        │
   ┌────┴────┐
   ▼         ▼
 复制到     下载
 剪贴板     .mdx 文件
```

外部博客使用时：

```mdx
import { RouteSlicePreview } from "@railloop/route-slice-preview";
// 或 CDN: import { ... } from 'https://rail.s3xyseia.xyz/bundle/route-slice-preview.js'

<RouteSlicePreview
  data={{"stations":[...],"routeCoords":[...],...}}
  locale="ja"
  height="400px"
/>
```

---

## 一、组件拆分策略

### 1.1 两个组件，各司其职

**现有组件 `RouteSlicePreview.tsx` — 不动它。** 主应用专用，保持现有的完整数据加载流程（fetchAndParseData → findRoute → sliceGeoJsonPath → calcDist → render），静态 import，react-i18next，不做任何修改。零风险。

**新建组件 `RouteSlicePreviewStatic.tsx` — 供分发。** 纯静态渲染组件，无数据加载逻辑。接受预计算的 `data` prop 直接渲染 Leaflet 地图。仅依赖 react / leaflet / lucide-react，不触碰任何 `../../../../src/` 路径。

```
RouteSlicePreview.tsx（主应用，不动）     RouteSlicePreviewStatic.tsx（分发用，新建）
─────────────────────────────────────    ─────────────────────────────────────────
Props: lineKey, startStation, endStation  Props: data (required), locale?, height?,
                                              theme?, labels?, showPromo?
逻辑: fetch → route → slice → render     逻辑: data → render（纯渲染，无 fetch）
依赖: ../../../../src/*, react-i18next    依赖: ./types.ts, ./i18n.ts, ./useLeafletMap,
                                              ./LineLogo, ./ErrorBoundary, ./PromoBanner
分发: 不参与                               分发: npm + CDN
```

### 1.2 RouteSlicePreviewStatic.tsx 设计

```tsx
import * as React from "react";
const { useEffect, useState, useRef } = React;

import { MapPin, ArrowRight, RotateCcw } from "lucide-react";
import { ErrorBoundary } from "./ErrorBoundary";
import { LineLogo } from "./LineLogo";
import { PromoBanner } from "./PromoBanner";
import { useT } from "./i18n";
import type { RouteSliceData } from "./types";

import "./leaflet-map.css";
import { useLeafletMap } from "./useLeafletMap";

interface Props {
  /** 预计算的路由数据（必填） */
  data: RouteSliceData;
  /** UI 语言，默认 "en" */
  locale?: "en" | "ja" | "zh-cn" | "zh-tw";
  /** 组件高度 CSS 值，默认 "400px" */
  height?: string;
  /** 地图主题，默认 "light" */
  theme?: "light" | "dark";
  /** 自定义翻译覆盖 */
  labels?: Partial<Record<string, string>>;
  /** 是否显示宣传条，默认 true */
  showPromo?: boolean;
}

export const RouteSlicePreview: React.FC<Props> = ({
  data,
  locale = "en",
  height = "400px",
  theme = "light",
  labels,
  showPromo = true,
}) => {
  const t = useT(locale, labels);

  const mapRef = useRef<HTMLDivElement>(null);
  const {
    mapInstanceRef,
    routeLayerRef,
    mapReady,
    fitBounds,
    resetView,
    getL,
  } = useLeafletMap({ containerRef: mapRef });

  // 纯渲染：data 一到就画，不等任何 fetch
  useEffect(() => {
    const L = getL();
    if (!data || !mapReady || !L) return;

    const map = mapInstanceRef.current;
    const routeLayer = routeLayerRef.current;
    if (!routeLayer || !map) return;

    routeLayer.clearLayers();
    let bounds = L.latLngBounds([]);

    const polyline = L.polyline(data.routeCoords, {
      color: data.color || "#39C5BB",
      weight: 4,
      opacity: 0.8,
    }).addTo(routeLayer);
    bounds.extend(polyline.getBounds());

    data.stations.forEach((st, idx) => {
      const isStartEnd = idx === 0 || idx === data.stations.length - 1;
      const marker = L.circleMarker([st.lat, st.lng], {
        radius: isStartEnd ? 6 : 4,
        color: "#ffffff",
        fillColor: data.color || "#39C5BB",
        weight: 2,
        fillOpacity: isStartEnd ? 1 : 0.6,
      });
      marker.bindTooltip(st.name_ja, {
        permanent: true,
        direction: "top",
        offset: [0, -4],
        className:
          "text-[10px] font-bold bg-white/80 backdrop-blur border border-slate-200/50 text-slate-700 shadow-sm px-1.5 py-0.5 rounded-md",
        opacity: 0.9,
      });
      marker.addTo(routeLayer);
    });

    if (bounds.isValid()) fitBounds(bounds);
  }, [data, mapReady, getL, mapInstanceRef, routeLayerRef, fitBounds]);

  const headerColor = data.color || "#39C5BB";

  return (
    <ErrorBoundary>
      <div
        className="my-8 border border-slate-200/60 rounded-2xl overflow-hidden bg-white shadow-lg shadow-slate-200/20 font-sans text-slate-800 not-prose transition-all hover:shadow-xl flex flex-col"
        style={{ height }}
      >
        {/* Header bar — 与现有组件结构一致 */}
        <div className="bg-slate-50/90 backdrop-blur-md px-4 py-3 border-b border-slate-200/80 flex justify-between items-center z-[1001] relative">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1.5 flex items-center gap-1">
              <MapPin size={10} style={{ color: headerColor }} />
              {t("routeSlicePreview")}
            </span>
            <div className="flex items-center gap-2">
              {data.meta?.icon ? (
                <LineLogo
                  src={data.meta.icon}
                  companyIcon={data.meta.companyIcon}
                  recolor={data.meta.recolor}
                  color={data.meta.color}
                  className="max-h-[50px] w-auto"
                />
              ) : data.meta?.logo ? (
                <img
                  src={data.meta.logo}
                  alt=""
                  className="max-h-[50px] w-auto object-contain opacity-70 grayscale"
                  draggable={false}
                />
              ) : null}
              <span className="text-sm font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-md border border-slate-200 shadow-sm">
                {data.meta?.lineName || ""}
              </span>
              <span className="text-xs text-slate-500 font-medium bg-slate-100/80 px-2.5 py-0.5 rounded-md border border-slate-200/80 flex items-center">
                {data.stations[0]?.name_ja || ""}
                <ArrowRight size={12} className="mx-1 text-slate-400" />
                {data.stations[data.stations.length - 1]?.name_ja || ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-1.5">
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-md shadow-sm"
                style={{
                  color: headerColor,
                  backgroundColor: headerColor + "1A",
                  borderColor: headerColor + "33",
                }}
              >
                {data.distance} km
              </span>
              <span className="text-[9px] font-bold text-slate-400 tracking-wide uppercase">
                Est. {data.time} min
              </span>
            </div>
            <button
              onClick={resetView}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              title={t("resetView")}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        {/* Map area */}
        <div className="flex-1 relative bg-slate-50" style={{ minHeight: 200 }}>
          <div ref={mapRef} className="absolute inset-0 z-0" />
        </div>

        {/* Promo banner */}
        {showPromo && (
          <PromoBanner locale={locale} color={headerColor} labels={labels} />
        )}
      </div>
    </ErrorBoundary>
  );
};
```

### 1.3 关键决策

| 项                         | 决策                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 现有 RouteSlicePreview.tsx | **不动。** 静态 import 保留，react-i18next 保留，所有现有逻辑保留                                                                 |
| 新静态组件命名             | `RouteSlicePreviewStatic.tsx`，导出名仍为 `RouteSlicePreview`（对外暴露名不变）                                                   |
| 为什么不用动态 import 技巧 | 动态 import 路径仍指向主应用 `../../../../src/*`，外部项目即使不执行也无法完成 TypeScript 类型检查。拆成独立文件完全规避          |
| 组件间代码复用             | 共享 `useLeafletMap`、`LineLogo`、`ErrorBoundary`、`leaflet-map.css`、`types.ts`。渲染 JSX 有重复但两个组件各自独立演进，互不拖累 |
| data prop                  | 在静态组件中为 `required`（非 optional），不用判断 data 是否存在                                                                  |

### 1.4 PromoBanner（宣传入口）

组件上方的非leaflet区域, 一个badge风格绿色按钮以及配套文本，点击跳转主应用：

- 链接：`https://rail.s3xyseia.xyz/?utm_source=route-preview&utm_medium=embed`
  由 RailLOOP 用户创建. 想要试试?
- Props：`locale`, `color`, `labels?`
- 通过 `i18n.ts` 获取翻译文案

---

## 二、类型定义（blog/src/components/mdx/types.ts）

组件同级新建，之后打包进 npm 包：

```ts
export interface StationData {
  id: string;
  name_ja: string;
  name_en?: string;
  lat: number;
  lng: number;
}

export interface RouteSliceMeta {
  icon?: string | null; // data URI (base64 PNG/SVG)，非 URL
  logo?: string | null; // data URI (base64 PNG/SVG)，非 URL
  companyIcon?: string | null; // data URI (base64 PNG/SVG)，非 URL
  recolor?: boolean;
  color?: string | null;
  lineKey: string; // 如 "JR:山手線"
  lineName: string; // 如 "山手線"
}

export interface RouteSliceData {
  stations: StationData[];
  routeCoords: [number, number][];
  distance: string; // "12.3"
  time: string; // "15"
  color: string | null;
  meta: RouteSliceMeta | null;
}
```

---

## 三、logo 内联策略（routeSerializer 内实现）

为避免跨域问题，导出时将 logo PNG 转换为 **data URI** 嵌入 RouteSliceData：

```
导出流程：
  1. 读取当前 route 的 meta.icon / meta.logo / meta.companyIcon
  2. 如果是相对路径（如 "assets/company_logos/001.png"）：
     a. 在浏览器中 fetch(绝对URL) 获取图片
     b. 创建 Image 元素，draw 到 canvas
     c. canvas.toDataURL("image/png") → "data:image/png;base64,..."
  3. 写入 RouteSliceData.meta.icon / logo / companyIcon
  4. 外部博客组件直接用 data URI 渲染 <img src="data:...">
```

注意：

- 如果图片本身跨域（CORS 未配置），fetch 会失败 → 降级：将原始 URL 作为字符串保留，标记 `_failedToInline: true`
- 图片最大尺寸限制：超过 64KB（base64 后 ~85KB）时跳过内联，保留 URL

> 后续优化：构建时将 logo 预转为 SVG（webp 转 svg trace），体积更小。本期先做 base64。

---

## 四、新增/修改文件清单

### 4.1 主应用 — blog/src/ 下（新建）

| #   | 文件                                         | 类型     | 说明                                                                                    |
| --- | -------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| 1   | `components/mdx/types.ts`                    | **新增** | `RouteSliceData`、`StationData`、`RouteSliceMeta` 类型                                  |
| 2   | `components/mdx/RouteSlicePreviewStatic.tsx` | **新增** | **纯静态渲染组件**（供分发），只接受 `data` prop，无数据加载。这是 npm/CDN 包的入口组件 |
| 3   | `components/mdx/PromoBanner.tsx`             | **新增** | 宣传条组件："由 RailleRound 生成 · 想在你的博客中嵌入路线图？"                          |
| 4   | `components/mdx/i18n.ts`                     | **新增** | 轻量翻译表（en/ja/zh-cn/zh-tw），`useT(locale, labels?)` 函数，替代 react-i18next       |
| 5   | `components/mdx/LineLogo.tsx`                | **新增** | 从 `src/components/LineLogo.tsx` 复制，已支持 data URI 作为 src                         |
| 6   | `components/mdx/ExportRouteModal.tsx`        | **新增** | 导出弹窗：参数选择 + 实时预览 + 复制/下载                                               |
| 7   | `utils/routeSerializer.ts`                   | **新增** | 运行时路由数据 → `RouteSliceData`（含 logo→data URI 转换）                              |
| 8   | `utils/codeGenerator.ts`                     | **新增** | `RouteSliceData` + 选项 → MDX 代码字符串                                                |

### 4.2 主应用 — blog/src/ 下（现有文件，不动）

| #   | 文件                                   | 类型     | 说明                                                     |
| --- | -------------------------------------- | -------- | -------------------------------------------------------- |
| —   | `components/mdx/RouteSlicePreview.tsx` | **不动** | 主应用专用组件，维持现有所有逻辑不变                     |
| —   | `components/mdx/useLeafletMap.ts`      | **不动** | 同时被 RouteSlicePreview 和 RouteSlicePreviewStatic 使用 |
| —   | `components/mdx/ErrorBoundary.tsx`     | **不动** | 已被两个组件使用                                         |
| —   | `components/mdx/leaflet-map.css`       | **不动** | CSS 重置，两个组件共用                                   |

### 4.3 主应用（src/ 下 — 导出入口）

| #   | 文件                                       | 类型     | 说明                                                                    |
| --- | ------------------------------------------ | -------- | ----------------------------------------------------------------------- |
| 8   | `components/modals/FolderManagerModal.tsx` | **修改** | Folder 内增加"导出为 MDX"按钮（批量导出 folder 内所有 trip 的路线预览） |
| 9   | `components/modals/TripEditor.tsx`         | **修改** | 单条 Trip 操作菜单增加"导出 Route Preview"选项                          |
| 10  | `pages/TripsPage.tsx`                      | **修改** | 单条 Trip 卡片操作区增加导出图标按钮                                    |

### 4.4 npm 包（packages/route-slice-preview/）

| #   | 文件                              | 说明                                                                                             |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| 13  | `package.json`                    | name: `@railloop/route-slice-preview`, peerDeps: react/leaflet/lucide-react                      |
| 14  | `src/index.ts`                    | 导出组件（从 `RouteSlicePreviewStatic` re-export 为 `RouteSlicePreview`）+ `RouteSliceData` 类型 |
| 15  | `src/RouteSlicePreviewStatic.tsx` | **构建时自动从 blog/src 复制**（这是分发的组件，不是原始的 RouteSlicePreview）                   |
| 16  | `src/useLeafletMap.ts`            | 构建时自动复制                                                                                   |
| 17  | `src/leaflet-map.css`             | 构建时自动复制                                                                                   |
| 18  | `src/types.ts`                    | 构建时自动复制                                                                                   |
| 19  | `src/ErrorBoundary.tsx`           | 构建时自动复制                                                                                   |
| 20  | `src/PromoBanner.tsx`             | 构建时自动复制                                                                                   |
| 21  | `src/i18n.ts`                     | 构建时自动复制                                                                                   |
| 22  | `src/LineLogo.tsx`                | 构建时自动复制                                                                                   |
| 23  | `tsconfig.json`                   | 构建配置                                                                                         |
| 24  | `vite.config.ts`                  | 打包：leaflet/lucide-react→external, react→external                                              |
| 25  | `scripts/build.ts`                | 构建脚本：复制源文件 → vite build → 输出 dist/                                                   |

### 4.5 静态 CDN（主应用 public/ 下）

| #   | 文件                                       | 说明                                                   |
| --- | ------------------------------------------ | ------------------------------------------------------ |
| 26  | `public/bundle/route-slice-preview.js`     | ESM bundle（构建产物，直接作为静态文件部署到 EdgeOne） |
| 27  | `public/bundle/route-slice-preview.css`    | CSS bundle                                             |
| 28  | `public/bundle/route-slice-preview.umd.js` | UMD bundle（`<script>` 标签用法）                      |

### 4.6 构建脚本

| #   | 文件                       | 说明                                                             |
| --- | -------------------------- | ---------------------------------------------------------------- |
| 29  | `scripts/build-package.ts` | 完整构建流程：复制源文件→打包→输出到 packages/ 和 public/bundle/ |

### 4.7 教程

| #   | 文件                          | 说明                                                                     |
| --- | ----------------------------- | ------------------------------------------------------------------------ |
| 30  | `src/components/Tutorial.jsx` | **修改**：新增 tutorial step "导出 MDX 组件"，在 import-export step 之后 |

---

## 五、ExportRouteModal 详细设计

### 5.1 触发入口（两处）

**入口 A — FolderManagerModal（收藏夹）：**

- 在 FolderManagerModal 中已有 folder 的 trip 列表
- 每个 folder 顶部增加 `[导出全部为 MDX 组件]` 按钮
- 点击后弹出 ExportRouteModal，生成包含多个 `<RouteSlicePreview>` 的 MDX

**入口 B — 单条 Trip：**

- TripEditor 底部操作区增加导出按钮（`FileDown` / `Code` 图标）
- TripsPage 每条 trip 卡片右上角 ⋮ 菜单增加"导出 Route Preview"选项
- 点击后弹出 ExportRouteModal，生成单个 `<RouteSlicePreview>` 的 MDX

### 5.2 Modal UI

````
┌─────────────────────────────────────────────────────────┐
│  导出 Route Preview 组件                           [X]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [实时预览: RouteSlicePreview 在当前参数下的渲染]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  选项                                                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 语言：[跟随当前 ▼]  高度：[400px ▼]              │   │
│  │ 主题：● Light  ○ Dark    显示宣传条：[是 ▼]     │   │
│  │ 包来源：[npm (@railloop) ▼]                      │   │
│  │          ├ npm (@railloop/route-slice-preview)    │   │
│  │          └ CDN (rail.s3xyseia.xyz/bundle/...)    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  生成的代码                                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ```mdx                                            │   │
│  │ import { RouteSlicePreview } from                │   │
│  │   '@railloop/route-slice-preview'                │   │
│  │                                                   │   │
│  │ <RouteSlicePreview                                │   │
│  │   data={{"stations":[...],"routeCoords":[...]}}   │   │
│  │   locale="ja" height="400px" theme="light"        │   │
│  │ />                                                │   │
│  │ ```                                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [复制到剪贴板]  [下载 .mdx]                            │
└─────────────────────────────────────────────────────────┘
````

### 5.2 参数选项

| 参数            | 可选值                                     | 默认值来源                |
| --------------- | ------------------------------------------ | ------------------------- |
| `locale`        | `"跟随当前"`, `en`, `ja`, `zh-cn`, `zh-tw` | `navigator.language` 映射 |
| `height`        | `"300px"`, `"400px"`, `"500px"`, `"600px"` | `"400px"`                 |
| `theme`         | `light`, `dark`                            | `"light"`                 |
| `showPromo`     | `true`, `false`                            | `true`                    |
| `packageSource` | `npm`, `cdn`                               | `npm`                     |

### 5.3 代码生成规则

```
如果 packageSource === "npm":
  生成 import 语句: import { RouteSlicePreview } from '@railloop/route-slice-preview'

如果 packageSource === "cdn":
  生成 import 语句:
  <script type="module">
  import { RouteSlicePreview } from 'https://rail.s3xyseia.xyz/bundle/route-slice-preview.js';
  </script>

多组件（从 Folder 导出时）: 每个 route 一个 <RouteSlicePreview> 块，用 --- 分隔
```

---

## 六、routeSerializer 详细规范

```ts
// blog/src/utils/routeSerializer.ts

interface SerializeInput {
  stations: Station[]; // findRoute 后的 uniqueSequence
  routeCoords: [number, number][]; // GeoJSON 切片后的坐标
  distance: string;
  time: string;
  color: string | null;
  meta: {
    icon?: string | null;
    logo?: string | null;
    companyIcon?: string | null;
    recolor?: boolean;
    color?: string | null;
    lineKey: string; // 从当前 line 获取
    lineName: string; // lineKey.split(':')[1] 或直接
  };
}

async function serializeRouteData(
  input: SerializeInput,
  options: {
    inlineLogos: boolean; // 默认 true
    coordPrecision: number; // 默认 4（小数位）
  },
): Promise<RouteSliceData>;
```

### 处理步骤

1. **坐标压缩**：`routeCoords` 每个坐标保留 4 位小数（`toFixed(4)` → `Number()`）
2. **Station 精简**：只保留 `id`, `name_ja`, `name_en`(如有), `lat`, `lng`
3. **Logo 内联**：
   ```
   for each of [meta.icon, meta.logo, meta.companyIcon]:
     if 值为空 → 跳过
     if 值以 "data:" 开头 → 已是 data URI，跳过
     if 值以 "http" 开头 → fetch → canvas → toDataURL("image/png")
       成功 → 替换为 data URI
       失败(CORS/网络) → 保留原始 URL，在 meta 附加 _logoFetchFailed: true
     if 值是相对路径 → 用 window.location.origin + "/" + value 构造 URL → 同上流程
   ```
4. **体积检查**：最终序列化的 JSON 字符串若 > 500KB，弹出警告"数据较大，建议精简"
5. **去除 undefined 值**：`JSON.parse(JSON.stringify(data))` 或手动过滤

---

## 七、npm 包 & CDN 去重策略

### 7.1 源码唯一性

```
blog/src/components/mdx/
  ├── RouteSlicePreview.tsx          ← 主应用专用（不动）
  ├── RouteSlicePreviewStatic.tsx    ← 分发用（新建）★ npm/CDN 入口
  ├── useLeafletMap.ts               ← 两个组件共享
  ├── types.ts                       ← 两个组件共享
  ├── leaflet-map.css                ← 两个组件共享
  ├── ErrorBoundary.tsx              ← 两个组件共享
  ├── PromoBanner.tsx                ← 仅静态组件使用
  ├── LineLogo.tsx                   ← 两个组件共享（从 src/components/ 复制）
  └── i18n.ts                        ← 仅静态组件使用

                    │
                    │  npm run build:package 时
                    │  复制 RouteSlicePreviewStatic + 所有共享依赖
                    ▼

packages/route-slice-preview/src/   ← 构建中间目录（gitignore）
  ├── RouteSlicePreviewStatic.tsx   ← 构建脚本自动复制
  ├── useLeafletMap.ts              ← 自动复制
  ├── types.ts                      ← 自动复制
  ├── leaflet-map.css               ← 自动复制
  ├── ErrorBoundary.tsx             ← 自动复制
  ├── PromoBanner.tsx               ← 自动复制
  ├── LineLogo.tsx                  ← 自动复制
  ├── i18n.ts                       ← 自动复制
  └── index.ts                      ← 手写，re-export 组件 + 类型

packages/route-slice-preview/dist/  ← 构建产物：
  ├── index.mjs       (ESM)
  ├── index.cjs       (CJS)
  ├── index.d.ts      (类型声明)
  └── index.css

                    │
                    │  同一份 ESM 产物
                    ▼

public/bundle/                      ← 静态 CDN
  ├── route-slice-preview.js    (复制自 dist/index.mjs)
  ├── route-slice-preview.css   (复制自 dist/index.css)
  └── route-slice-preview.umd.js
```

> `RouteSlicePreview.tsx` **不被复制**到 packages/，因为它引用了 `../../../../src/*` 和 `react-i18next`，外部项目无法解析。

### 7.2 i18n.ts 设计（替代 react-i18next）

组件不再依赖 `react-i18next`，改为内置翻译表 + props 覆盖：

```ts
// packages/route-slice-preview/src/i18n.ts
const translations: Record<string, Record<string, string>> = {
  en: {
    routeSlicePreview: "Route Slice Preview",
    loadingRoute: "Loading route...",
    parseFail: "Failed to load",
    resetView: "Reset view",
    promoText: "Powered by RailleRound",
    promoCTA: "Embed this in your blog →",
    // ...
  },
  ja: {
    /* ... */
  },
  "zh-cn": {
    /* ... */
  },
  "zh-tw": {
    /* ... */
  },
};

export function useT(locale: string, labels?: Record<string, string>) {
  return (key: string, vars?: Record<string, string>) => {
    if (labels?.[key]) return labels[key];
    return translations[locale]?.[key] ?? translations.en[key] ?? key;
  };
}
```

组件内：

```tsx
const t = useT(locale || "en", labels);
// t('routeSlicePreview') → 根据locale返回翻译
```

### 7.3 构建产物处理

- `react` → **external**（博客项目自带 React）
- `leaflet` → **external**（博客项目安装或 CDN 加载）
- `lucide-react` → **external**（仅用 MapPin/ArrowRight/RotateCcw，可考虑内联为简单 SVG 以减依赖）
- CSS → **单独文件**（`leaflet-map.css` + 组件 Tailwind → 编译为纯 CSS）

> 优化项：lucide-react 只用 3 个图标，可替换为 3 个内联 SVG 组件，减少一个 peer dependency。在 Phase 3 评估。

### 7.4 包大小目标

| 项目                             | 大小                       |
| -------------------------------- | -------------------------- |
| JS bundle (gzip)                 | < 12 KB                    |
| CSS (gzip)                       | < 3 KB                     |
| peer deps 总计（由用户项目提供） | react + leaflet ~45KB gzip |

---

## 八、EdgeOne CDN 静态分发

不使用 PageFunction 动态返回（避免函数体限制 + 冷启动延迟）。改为：

**构建时**将 ESM bundle 写入主应用 `public/bundle/` 目录。EdgeOne Pages 部署时自动作为静态资源上传。

```
public/bundle/
  route-slice-preview.js       ← ESM，供 <script type="module"> 引用
  route-slice-preview.css
  route-slice-preview.umd.js   ← UMD，供 <script> 标签引用
```

### 跨域配置

EdgeOne Pages 默认支持静态文件跨域。若需要显式 CORS 头，在 `public/edgeone.json` 或部署配置中添加：

```json
{
  "headers": [
    {
      "source": "/bundle/*",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Cache-Control", "value": "public, max-age=86400, immutable" }
      ]
    }
  ]
}
```

### 外部博客 CDN 用法

```html
<!-- 方式1: ESM -->
<script type="module">
  import { RouteSlicePreview } from "https://rail.s3xyseia.xyz/bundle/route-slice-preview.js";
</script>

<!-- 方式2: UMD (不依赖构建工具) -->
<script src="https://rail.s3xyseia.xyz/bundle/route-slice-preview.umd.js"></script>
<script>
  // RailRound.RouteSlicePreview 可用
</script>
```

---

## 九、教程更新（Tutorial.jsx）

在"导入导出"(import-export) step 之后，新增 step：

```js
{
  id: 'export-mdx-component',
  target: '#btn-export-mdx',    // 或 center modal
  title: t('tutorial.exportMdx.title', '嵌入你的博客'),
  content: t('tutorial.exportMdx.content',
    '你可以将任意旅程导出为一个独立的 MDX 组件，直接嵌入 Astro/Docusaurus 等博客。点击行程旁的导出按钮或收藏夹内的批量导出即可。'),
  position: 'center',
  action: 'next'
}
```

同时，博客 docs 目录下新增教程文档 `docs/export-route-preview.md`，说明外部博客如何安装和使用。

---

## 十、实施步骤

### Phase 1: 静态组件 + 共享依赖

| Step     | 任务                                                                           | 产出文件                                              | 验证方式                                                                                                      |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1.1      | 新建 `types.ts`                                                                | `blog/src/components/mdx/types.ts`                    | TypeScript 编译通过                                                                                           |
| 1.2      | 新建 `i18n.ts`                                                                 | `blog/src/components/mdx/i18n.ts`                     | 导出 `useT` 函数，4 语言翻译表完整，含 PromoBanner 所需 key                                                   |
| 1.3      | 从 `src/components/LineLogo.tsx` 复制到 `blog/src/components/mdx/LineLogo.tsx` | `blog/src/components/mdx/LineLogo.tsx`                | 确认支持 data URI 作为 `src`（当前已支持：`<img src={iconSrc}>` 和 `maskImage: url(...)`，data URI 天然兼容） |
| 1.4      | 新建 `PromoBanner.tsx`                                                         | `blog/src/components/mdx/PromoBanner.tsx`             | 组件独立可渲染，props: `locale`, `color`, `labels?`                                                           |
| 1.5      | **新建 `RouteSlicePreviewStatic.tsx`**                                         | `blog/src/components/mdx/RouteSlicePreviewStatic.tsx` | 详见 Step 1.5 验证清单                                                                                        |
|          | - 仅 import 同级文件（无 `../../../../src/*` 依赖）                            |                                                       |                                                                                                               |
|          | - 仅 import react, leaflet, lucide-react                                       |                                                       |                                                                                                               |
|          | - `data` prop 为 required                                                      |                                                       |                                                                                                               |
|          | - `locale`/`height`/`theme`/`labels`/`showPromo` 为 optional                   |                                                       |                                                                                                               |
|          | - 使用 `useT(locale, labels)` 替代 `useTranslation()`                          |                                                       |                                                                                                               |
|          | - 使用 `height` prop 替代硬编码 `h-[400px]`                                    |                                                       |                                                                                                               |
|          | - 底部渲染 `<PromoBanner>`（`showPromo === true` 时）                          |                                                       |                                                                                                               |
|          | - 无 loading/error 状态管理（data 已预计算，渲染即成功）                       |                                                       |                                                                                                               |
|          | - 无 fetch/route/slice 逻辑                                                    |                                                       |                                                                                                               |
| 1.6 验证 | 在主应用中临时渲染 `<RouteSlicePreviewStatic data={...} />` 确认地图正常       | —                                                     | 与现有 RouteSlicePreview 视觉效果一致                                                                         |

### Phase 2: 导出序列化

| Step | 任务                                                   | 产出文件                            | 验证方式                                                   |
| ---- | ------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------- |
| 2.1  | 实现 `routeSerializer.ts`                              | `blog/src/utils/routeSerializer.ts` | 单元测试：输入 mock 数据 → 输出正确格式的 RouteSliceData   |
|      | - `serializeRouteData(input, options)`                 |                                     |                                                            |
|      | - `imageUrlToDataUri(url): Promise<string>` 辅助函数   |                                     |                                                            |
|      | - 坐标精度压缩（toFixed(4)）                           |                                     |                                                            |
|      | - 去除 undefined                                       |                                     |                                                            |
| 2.2  | 实现 `codeGenerator.ts`                                | `blog/src/utils/codeGenerator.ts`   | 单元测试：输入 RouteSliceData + 选项 → 输出预期 MDX 字符串 |
|      | - `generateSinglePreview(data, options)` → MDX 字符串  |                                     |                                                            |
|      | - `generateMultiPreview(data[], options)` → MDX 字符串 |                                     |                                                            |
|      | - 支持 npm / CDN 两种 import 语句                      |                                     |                                                            |

### Phase 3: 导出 Modal 与入口

| Step | 任务                                              | 产出文件                                       | 验证方式                                                  |
| ---- | ------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| 3.1  | 实现 `ExportRouteModal.tsx`                       | `blog/src/components/mdx/ExportRouteModal.tsx` | Modal 能打开、参数可切换、预览实时更新、复制/下载功能正常 |
|      | - Live preview（内嵌 RouteSlicePreview）          |                                                |                                                           |
|      | - 参数选择器                                      |                                                |                                                           |
|      | - 代码展示区（语法高亮用 `<pre><code>` 即可）     |                                                |                                                           |
|      | - 复制到剪贴板（`navigator.clipboard.writeText`） |                                                |                                                           |
|      | - 下载 .mdx（`Blob` + `<a download>`）            |                                                |                                                           |
| 3.2  | 在 `TripEditor.tsx` 增加导出按钮                  | `src/components/modals/TripEditor.tsx`         | 单条 Trip 编辑时可触发导出                                |
| 3.3  | 在 `TripsPage.tsx` 增加导出入口                   | `src/pages/TripsPage.tsx`                      | Trip 卡片操作区增加导出图标                               |
| 3.4  | 在 `FolderManagerModal.tsx` 增加批量导出按钮      | `src/components/modals/FolderManagerModal.tsx` | Folder 顶部"导出全部为 MDX 组件"按钮                      |

### Phase 4: npm 包构建

| Step | 任务                                                                                                                                                          | 产出文件                                      | 验证方式                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| 4.1  | 创建 `packages/route-slice-preview/` 目录结构                                                                                                                 | package.json, tsconfig.json, vite.config.ts   | —                                                 |
|      | - `package.json`: name=`@railloop/route-slice-preview`, version=`0.1.0`                                                                                       |                                               |                                                   |
|      | - `peerDependencies`: react>=18, leaflet>=1.9, lucide-react>=0.500                                                                                            |                                               |                                                   |
|      | - `"module"`: `"./dist/index.mjs"`, `"main"`: `"./dist/index.cjs"`                                                                                            |                                               |                                                   |
|      | - `"types"`: `"./dist/index.d.ts"`                                                                                                                            |                                               |                                                   |
| 4.2  | 创建 `src/index.ts` 入口                                                                                                                                      | `packages/route-slice-preview/src/index.ts`   | 导出 RouteSlicePreview 组件和 RouteSliceData 类型 |
| 4.3  | 配置 vite.config.ts                                                                                                                                           | `packages/route-slice-preview/vite.config.ts` | `npm run build:package` 成功                      |
|      | - `build.lib.entry` → `src/index.ts`                                                                                                                          |                                               |                                                   |
|      | - `build.rollupOptions.external` → react, leaflet, lucide-react                                                                                               |                                               |                                                   |
|      | - 输出 ESM + CJS + CSS                                                                                                                                        |                                               |                                                   |
| 4.4  | 创建 `scripts/build-package.ts`                                                                                                                               | `scripts/build-package.ts`                    | 一键构建                                          |
|      | - 步骤1：从 `blog/src/components/mdx/` **选择性复制**到 `packages/route-slice-preview/src/`                                                                   |                                               |                                                   |
|      | - ✓ 复制：`RouteSlicePreviewStatic.tsx`, `types.ts`, `i18n.ts`, `useLeafletMap.ts`, `leaflet-map.css`, `ErrorBoundary.tsx`, `PromoBanner.tsx`, `LineLogo.tsx` |                                               |                                                   |
|      | - ✗ 不复制：`RouteSlicePreview.tsx`（含 `../../../../src/*` 依赖）                                                                                            |                                               |                                                   |
|      | - 步骤2：`cd packages/route-slice-preview && vite build`                                                                                                      |                                               |                                                   |
|      | - 步骤3：复制 `dist/index.mjs` → `public/bundle/route-slice-preview.js`                                                                                       |                                               |                                                   |
|      | - 步骤4：复制 `dist/index.css` → `public/bundle/route-slice-preview.css`                                                                                      |                                               |                                                   |
|      | - 步骤5：构建 UMD bundle → `public/bundle/route-slice-preview.umd.js`                                                                                         |                                               |                                                   |
| 4.5  | 添加 `package.json` scripts                                                                                                                                   | 根 `package.json`                             | `npm run build:package` 可用                      |
|      | - `"build:package": "tsx scripts/build-package.ts"`                                                                                                           |                                               |                                                   |
|      | - `"publish:package": "cd packages/route-slice-preview && npm publish"`                                                                                       |                                               |                                                   |

### Phase 5: EdgeOne CDN 静态分发

| Step | 任务                                   | 产出文件                                | 验证方式                                                                     |
| ---- | -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| 5.1  | 确认 `public/bundle/` 被部署为静态资源 | —                                       | 部署后访问 `https://rail.s3xyseia.xyz/bundle/route-slice-preview.js` 返回 JS |
| 5.2  | 配置 CORS（如需要）                    | `public/edgeone.json` 或 EdgeOne 控制台 | `curl -H "Origin: xxx" -I` 返回 `Access-Control-Allow-Origin: *`             |
| 5.3  | 部署并测试 CDN 引用                    | —                                       | 本地 HTML 文件 `<script type="module" src="...">` 可正确加载组件             |

### Phase 6: 教程与文档

| Step | 任务                                              | 产出文件                       | 验证方式                 |
| ---- | ------------------------------------------------- | ------------------------------ | ------------------------ |
| 6.1  | 更新 `Tutorial.jsx`，新增导出 MDX 组件的引导 step | `src/components/Tutorial.jsx`  | 教程中新增步骤可见       |
| 6.2  | 创建 `docs/export-route-preview.md`               | `docs/export-route-preview.md` | 外部用户可按文档完成集成 |
|      | - 安装方式（npm / CDN）                           |                                |                          |
|      | - Props 说明                                      |                                |                          |
|      | - Astro 示例                                      |                                |                          |
|      | - Docusaurus 示例                                 |                                |                          |
|      | - 常见问题                                        |                                |                          |
| 6.3  | 创建 `packages/route-slice-preview/README.md`     | README.md                      | npm 包页面展示完整文档   |

### Phase 7: 验证与发布

| Step | 任务                                                            | 验证方式                      |
| ---- | --------------------------------------------------------------- | ----------------------------- |
| 7.1  | 在空白 Astro 项目中 `npm install @railloop/route-slice-preview` | 组件可 import 且渲染正确      |
| 7.2  | 在空白 Docusaurus 项目中同样测试                                | 同上                          |
| 7.3  | 用 CDN import 方式在纯 HTML 页面测试                            | `<script type="module">` 可用 |
| 7.4  | 首次 `npm publish`                                              | 发布成功，npm 页面可访问      |
| 7.5  | 在 RailRound 博客中写一篇介绍文章                               | 演示组件嵌入效果              |

---

## 十一、风险与对策

| 风险                                                         | 对策                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| logo 图片 CORS 导致 data URI 转换失败                        | 保留原始 URL，标记 `_logoFetchFailed`，组件降级显示占位图标                       |
| routeCoords 数据过大导致 MDX 臃肿（长线路可能 2000+ 坐标对） | 坐标精度 4 位 + Douglas-Peucker 抽稀（可选），目标 < 100KB 原始 JSON              |
| 外部博客的 CSS 与组件冲突                                    | `leaflet-map.css` 已用 `!important` 处理关键冲突；组件外层容器使用 `not-prose` 类 |
| EdgeOne PageFunction 10MB 限制                               | 已改为静态文件分发，不经过函数体                                                  |
| navigator.language 映射不准确                                | 提供显式 locale prop，用户可在导出时手动选择                                      |

---

## 十二、不作为本期范围

- ~~版本号检查与过期提示~~（依赖跨域 fetch version，本期不做）
- ~~logo 预转 SVG trace~~（后续优化项）
- ~~坐标 Douglas-Peucker 抽稀~~（数据量可接受时不做，后续按需）
- ~~组件内加载动画定制~~（沿用现有 animate-pulse）
- ~~多语言社区贡献流程~~

---

## 附录 A: 文件依赖关系图

```
主应用组件（不动）:
RouteSlicePreview.tsx ──── 依赖 ──→ ../../../../src/utils/fetchAndParseData
    │                               ../../../../src/core/railwayRouting
    │                               ../../../../src/core/tripCalculator
    │                               react-i18next
    │                               useLeafletMap.ts, ErrorBoundary.tsx, LineLogo.tsx
    │                               leaflet-map.css
    └─ 主应用内的 blog MDX 页面直接引用

分发组件（新建）:
RouteSlicePreviewStatic.tsx ── 依赖 ──→ useLeafletMap.ts
    │                                   types.ts
    │                                   i18n.ts
    │                                   leaflet-map.css
    │                                   ErrorBoundary.tsx
    │                                   PromoBanner.tsx
    │                                   LineLogo.tsx
    │                                   react, leaflet, lucide-react (peer)
    └─ 无其他依赖（零 ../../../../src/* 引用）

导出流程:
ExportRouteModal.tsx ───── 依赖 ──→ routeSerializer.ts
    │                                codeGenerator.ts
    │                                RouteSlicePreviewStatic.tsx（预览用）
    │
    ├─ TripEditor.tsx ─────→ 触发 ExportRouteModal（单条 trip）
    ├─ TripsPage.tsx ──────→ 触发 ExportRouteModal（单条 trip）
    └─ FolderManagerModal.tsx → 触发 ExportRouteModal（批量）

build-package.ts:
    1. 复制 RouteSlicePreviewStatic.tsx → packages/.../src/
    2. 复制 types.ts, i18n.ts, useLeafletMap.ts, ErrorBoundary.tsx, PromoBanner.tsx, LineLogo.tsx → packages/.../src/
    3. 复制 leaflet-map.css → packages/.../src/
    4. ✗ 不复制 RouteSlicePreview.tsx
    5. vite build → dist/
    6. cp dist/* → public/bundle/
```

## 附录 B: 组件 Props 完整参考

### RouteSlicePreviewStatic（npm/CDN 分发的组件）

```ts
interface RouteSlicePreviewProps {
  /** 预计算的路由数据（必填） */
  data: RouteSliceData;
  /** UI 语言，默认 "en" */
  locale?: "en" | "ja" | "zh-cn" | "zh-tw";
  /** 组件高度 CSS 值，默认 "400px" */
  height?: string;
  /** 地图主题，默认 "light" */
  theme?: "light" | "dark";
  /** 自定义翻译字符串覆盖 */
  labels?: Partial<Record<string, string>>;
  /** 是否显示宣传条，默认 true */
  showPromo?: boolean;
}
```

### RouteSlicePreview（主应用，不动）

```ts
// 现有 Props 不变
interface Props {
  lineKey: string;
  startStation: string;
  endStation: string;
}
```
