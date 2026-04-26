# @railloop/route-slice-preview

A lightweight Leaflet-based route preview component for MDX blogs. Powered by [RailleRound / RailLOOP](https://rail.s3xyseia.xyz).

```bash
npm install @railloop/route-slice-preview
```

```mdx
import { RouteSlicePreview } from "@railloop/route-slice-preview";
import "@railloop/route-slice-preview/styles.css";

<RouteSlicePreview
  data={{"stations":[...],"routeCoords":[...],"distance":"3.4","time":"5","color":"#f00","meta":{"lineKey":"JR:山手線","lineName":"山手線"}}}
  locale="ja"
  height="400px"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `RouteSliceData` | (required) | Pre-computed route data |
| `locale` | `"en" \| "ja" \| "zh-cn" \| "zh-tw"` | `"en"` | UI language |
| `height` | `string` | `"400px"` | Component height |
| `theme` | `"light" \| "dark"` | `"light"` | Map theme |
| `labels` | `Partial<Record<string, string>>` | — | Translation overrides |
| `showPromo` | `boolean` | `true` | Show branding link |

## Generating Route Data

Visit [RailleRound](https://rail.s3xyseia.xyz), create a trip, and use the **Export** button to get pre-computed MDX code with embedded route data.

## Peer Dependencies

- `react` >= 18
- `react-dom` >= 18
- `leaflet` >= 1.9
- `lucide-react` >= 0.500

## CDN

```html
<script type="module">
import { RouteSlicePreview } from "https://rail.s3xyseia.xyz/bundle/route-slice-preview.js";
</script>
<link rel="stylesheet" href="https://rail.s3xyseia.xyz/bundle/route-slice-preview.css" />
```

## License

MIT
