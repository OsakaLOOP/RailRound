# Export Route Preview Component

The RouteSlicePreview component lets you embed an interactive railway route map into any MDX blog (Astro, Docusaurus, Next.js, etc.).

## How It Works

1. Open [RailLOOP](https://rail.s3xyseia.xyz)
2. Navigate to your trip or open a folder
3. Click the **Code** button (`</>`) on any trip card
4. Configure options in the export modal
5. Copy the generated MDX code or download as `.mdx` file
6. Paste into your blog post

## Installation

### Option 1: npm (recommended for most blogs)

```bash
npm install @railloop/route-slice-preview
```

Peer dependencies (your project should already have these):
- `react` >= 18
- `leaflet` >= 1.9
- `lucide-react` >= 0.500
- `react-dom` >= 18

### Option 2: CDN (no build tool needed)

```html
<script type="module">
import { RouteSlicePreview } from "https://rail.s3xyseia.xyz/bundle/route-slice-preview.js";
</script>
```

Also import Leaflet and Lucide icons separately if not already loaded.

## Usage

### In Astro MDX

```mdx
---
import { RouteSlicePreview } from "@railloop/route-slice-preview";
import "@railloop/route-slice-preview/styles.css";
---

<RouteSlicePreview client:only="react"
  data={{"stations":[{"id":"st1","name_ja":"東京","lat":35.6812,"lng":139.7671}],"routeCoords":[[35.6812,139.7671],[35.6585,139.7014]],"distance":"3.4","time":"5","color":"#f00","meta":{"lineKey":"JR:山手線","lineName":"山手線"}}}
  locale="ja"
  height="400px"
  showPromo={true}
/>
```

### In Docusaurus MDX

```mdx
import { RouteSlicePreview } from "@railloop/route-slice-preview";

<RouteSlicePreview
  data={{"stations":[...],"routeCoords":[...],"distance":"3.4","time":"5","color":"#f00","meta":{"lineKey":"JR:山手線","lineName":"山手線"}}}
  locale="en"
  height="400px"
/>
```

### Required CSS

Import the component styles in your layout or page:

```tsx
import "@railloop/route-slice-preview/styles.css";
```

For CDN usage, add a `<link>` tag:

```html
<link rel="stylesheet" href="https://rail.s3xyseia.xyz/bundle/route-slice-preview.css" />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `RouteSliceData` | (required) | Pre-computed route data (generated from export tool) |
| `locale` | `"en" \| "ja" \| "zh-cn" \| "zh-tw"` | `"en"` | UI language |
| `height` | `string` | `"400px"` | Component height CSS value |
| `theme` | `"light" \| "dark"` | `"light"` | Map and UI theme |
| `labels` | `Partial<Record<string, string>>` | — | Custom translation string overrides |
| `showPromo` | `boolean` | `true` | Show "Powered by RailLOOP" banner |

## RouteSliceData Type

```ts
interface RouteSliceData {
  stations: { id: string; name_ja: string; name_en?: string; lat: number; lng: number }[];
  routeCoords: [number, number][];
  distance: string;
  time: string;
  color: string | null;
  meta: {
    icon?: string | null;
    logo?: string | null;
    companyIcon?: string | null;
    recolor?: boolean;
    color?: string | null;
    lineKey: string;
    lineName: string;
  } | null;
}
```

## Generating Static Data

The easiest way: open [RailLOOP](https://rail.s3xyseia.xyz), find your route, and click the **Code** button (`</>`) on the trip card to generate the `data` JSON automatically.

To generate programmatically, use the `@railloop/route-slice-preview` types:

```ts
import type { RouteSliceData } from "@railloop/route-slice-preview";
```
