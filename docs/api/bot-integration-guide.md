# RailRound Bot Integration Guide

This guide is intended for developers building integrations (such as a QQ Bot using Astrobot) with the RailRound platform. It explains the system architecture, how to properly access large geographical datasets, and how to reuse our core routing logic within a Node.js environment.

---

## 1. Architecture Overview

To ensure performance and scalability, the RailRound ecosystem is split into two main responsibilities:

### A. The Cloudflare Workers API (Lightweight)
Our API endpoints (\`/api/qqbot/*\`) run on Cloudflare Pages Functions. These functions have strict CPU (often 10ms - 50ms) and Memory (128MB) limits.
* **What it does:** Authenticates users via Keys/Hashes, reads/writes small JSON payloads to the KV store, and updates basic statistics.
* **What it DOES NOT do:** It cannot parse 30MB GeoJSON files, calculate A* shortest paths across thousands of stations, or render PNG images via Canvas/WASM.

### B. The Bot Node.js Environment (Heavyweight)
Your Bot runs in a persistent Node.js process with ample memory and CPU.
* **What it does:** Downloads and caches the large static \`railway.json\` files, executes the A* routing algorithm, processes coordinates using \`@turf/turf\`, and generates images (e.g., SVG to PNG using \`resvg-js\`).
* **What it DOES NOT do:** It does not own the user database; it pushes finished, calculated results back to the Cloudflare API.

---

## 2. Fetching the Foundation Data

Since the API does not provide geographic paths directly, your Bot must download the latest static datasets from the RailRound public directory.

You should periodically (e.g., on bot startup or once a day) fetch these files:

* **Railway Data (Stations & Lines metadata):**
  \`GET https://<your-domain>/data/railway.json\`

* **Geo Data (GeoJSON paths for drawing maps):**
  \`GET https://<your-domain>/data/geoData.json\`

### Data Caching Strategy (Example)

\`\`\`typescript
import axios from 'axios';
import fs from 'fs/promises';

const RAILWAY_URL = 'https://your-domain.com/data/railway.json';

async function syncRailwayData() {
    try {
        const response = await axios.get(RAILWAY_URL);
        await fs.writeFile('./local_cache/railway.json', JSON.stringify(response.data));
        console.log("Railway data synced successfully.");
    } catch (e) {
        console.error("Failed to sync railway data", e);
    }
}
\`\`\`

---

## 3. Reusing the Core Routing Logic

We have designed our core algorithm files to be **Isomorphic** (framework and environment agnostic). They do not rely on React, Zustand, or Browser APIs (\`window\`, \`localStorage\`).

You can directly copy or import the following files into your Bot project:
1. \`src/utils/railwayRouting.ts\` (Contains the Priority-First-Search \`findRoute\` algorithm).
2. \`src/utils/stats.js\` (Contains the Haversine \`calcDist\` formula and GeoJSON slicing logic).

### Example: Calculating a Route in Node.js

Once you have the \`railway.json\` downloaded, you can load it into memory and pass it to the \`findRoute\` function:

\`\`\`typescript
import fs from 'fs';
import { findRoute } from './railwayRouting'; // Your local copy of our routing file

// 1. Load the pre-downloaded data
const railwayDataRaw = fs.readFileSync('./local_cache/railway.json', 'utf-8');
const railwayData = JSON.parse(railwayDataRaw);

// 2. Define Start and End
const startLine = 'JR East:Yamanote Line';
const startStId = 'Tokyo'; // Assuming IDs match names in this example
const endLine = 'JR East:Chuo Line';
const endStId = 'Shinjuku';

// 3. Execute the algorithm
const routeResult = findRoute(
    startLine,
    startStId,
    endLine,
    endStId,
    railwayData,
    6 // Max transfers
);

if (routeResult.error) {
    console.error("Routing failed:", routeResult.error);
} else {
    console.log("Route calculated in:", routeResult.estimatedTime, "minutes");
    console.log("Segments:", routeResult.segments);

    // 4. Send the result to the Cloudflare API
    // POST /api/qqbot/record
    // { "key": "...", "distance": routeResult.estimatedTime * speed_factor, ... }
}
\`\`\`

---

## 4. Best Practices

1. **Keep Sync Intervals Reasonable:** \`railway.json\` does not change every minute. Fetching it once every 24 hours (or hooking into a webhook from our GitHub repo) is optimal.
2. **Type Imports:** Notice that \`railwayRouting.ts\` uses \`import type\` for store definitions. You will need to either copy the type definitions from \`src/store/index.ts\` or mock them in your Bot's \`types.d.ts\`.
3. **PNG Rendering:** Use libraries like \`satori\` or \`@resvg/resvg-js\` in your Node.js bot to turn the JSON/SVG output into flat PNG images for QQ users.
