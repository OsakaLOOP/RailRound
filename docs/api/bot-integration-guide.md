# RailRound Bot Integration Guide

This guide is intended for developers building integrations (such as a QQ Bot using Astrobot) with the RailRound platform. It explains the system architecture, how to properly access large geographical datasets, and how to reuse our core routing logic within a Node.js environment.

---

## 1. Architecture Overview

To ensure performance and scalability, the RailRound ecosystem is split into two main responsibilities:

### A. The Cloudflare Workers API (Lightweight)
Our API endpoints (`/api/qqbot/*`) run on Cloudflare Pages Functions. These functions have strict CPU (often 10ms - 50ms) and Memory (128MB) limits.
* **What it does:** Authenticates users via Keys/Hashes, reads/writes small JSON payloads to the KV store, and updates basic statistics.
* **What it DOES NOT do:** It cannot parse 30MB GeoJSON files, calculate A* shortest paths across thousands of stations, or render PNG images via Canvas/WASM.

### B. The Bot Node.js Environment (Heavyweight)
Your Bot runs in a persistent Node.js process with ample memory and CPU.
* **What it does:** Downloads and caches the large static `railway.json` files, executes the A* routing algorithm, processes coordinates using `@turf/turf`, and generates images (e.g., SVG to PNG using `resvg-js`).
* **What it DOES NOT do:** It does not own the user database; it pushes finished, calculated results back to the Cloudflare API.

---

## 2. Fetching the Foundation Data

We have refactored the data ingestion pipeline into a pure, environment-agnostic module. You can use our official `BotDataBuilder` to automatically pull the current `changelog.json`, parse `company.json`, download all required `GeoJSON` chunks, and stitch them into memory-ready objects—without writing any custom network or parsing logic.

### Using the Builder

Copy the following files into your Bot project:
1. `src/core/parser.ts`
2. `src/core/bot/botDataBuilder.ts`

```typescript
import { BotDataBuilder } from './core/bot/botDataBuilder';

async function initBot() {
    // 1. Point the builder to the live RailRound domain
    const builder = new BotDataBuilder('https://your-domain.com');

    // 2. Automatically fetch, download, and parse all geospatial and metadata
    console.log("Syncing database...");
    const { railwayData, geoData, version } = await builder.build();

    console.log(`Successfully synced v${version}`);

    // Save these globally in your bot's memory for routing and drawing
    global.railwayData = railwayData;
    global.geoData = geoData;
}
```

*(Note: Ensure your Bot has access to the global `fetch` API available in Node 18+)*

---

## 3. Reusing the Core Routing Logic

We have designed our core algorithm files to be **Isomorphic** (framework and environment agnostic). They do not rely on React, Zustand, or Browser APIs (`window`, `localStorage`).

You can directly copy or import the following files into your Bot project alongside the builder:
1. `src/core/railwayRouting.ts` (Contains the Priority-First-Search `findRoute` algorithm).
2. `src/core/tripCalculator.js` (Contains the Haversine `calcDist` formula and GeoJSON path computing tools).

### Example: Calculating a Route in Node.js

Once you have the `railwayData` built into memory using `BotDataBuilder`, you can calculate paths immediately:

```typescript
import { findRoute } from './core/railwayRouting';
import { getRouteVisualData } from './core/tripCalculator';

// Assuming global.railwayData exists from step 2

// 1. Define Start and End
const startLine = 'JR East:Yamanote Line';
const startStId = 'Tokyo'; // Assuming IDs match names in this example
const endLine = 'JR East:Chuo Line';
const endStId = 'Shinjuku';

// 2. Execute the algorithm
const routeResult = findRoute(
    startLine,
    startStId,
    endLine,
    endStId,
    global.railwayData,
    6 // Max transfers
);

if (routeResult.error) {
    console.error("Routing failed:", routeResult.error);
} else {
    console.log("Route calculated in:", routeResult.estimatedTime, "minutes");
    console.log("Segments:", routeResult.segments);

    // 3. (Optional) Get rendering coordinates for drawing a map
    const { totalDist, visualPaths } = getRouteVisualData(
        routeResult.segments,
        {}, // Segment geometries cache (can be empty initially)
        global.railwayData,
        global.geoData
    );

    // 4. Send the result to the Cloudflare API
    // POST /api/qqbot/record
    // { "key": "...", "distance": totalDist, ... }
}
```

---

## 4. Best Practices

1. **Keep Sync Intervals Reasonable:** Don't rebuild the data on every request. Building it once on startup and maybe once every 24 hours is optimal.
2. **Type Imports:** Notice that `railwayRouting.ts` uses `import type` for store definitions. You will need to either copy the type definitions from `src/store/index.ts` or mock them in your Bot's `types.d.ts`.
3. **PNG Rendering:** Use libraries like `satori` or `@resvg/resvg-js` in your Node.js bot to turn the JSON/SVG output into flat PNG images for QQ users.