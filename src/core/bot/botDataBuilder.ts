import { parseGeoJsonBatch } from '../parser';

/**
 * A standalone data builder designed specifically for Node.js environments (like bots).
 * It dynamically fetches `changelog.json`, `company.json`, and the required GeoJSON
 * chunks from the deployed RailRound web server, then runs the core parser to build
 * the `railwayData` and `geoData` objects needed for routing and computation.
 *
 * Note: Node 18+ has built-in `fetch`. If using older Node versions, polyfill it
 * or replace with `axios`.
 */
export class BotDataBuilder {
    private baseUrl: string;

    constructor(baseUrl: string) {
        // Ensure no trailing slash
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Downloads and builds the complete Railway Data and Geo Data models.
     */
    async build() {
        try {
            console.log(`[BotDataBuilder] Fetching from ${this.baseUrl}...`);

            // 1. Fetch Changelog to get current version and active files list
            const changelogRes = await fetch(`${this.baseUrl}/changelog.json`);
            if (!changelogRes.ok) throw new Error(`Failed to fetch changelog: ${changelogRes.statusText}`);
            const changelog = await changelogRes.json();

            const activeFiles: string[] = changelog.meta.activeFiles || [];
            const version: string = changelog.meta.currentVersion || Date.now().toString();

            // 2. Fetch Company metadata
            const companyRes = await fetch(`${this.baseUrl}/data/company.json?v=${version}`);
            if (!companyRes.ok) throw new Error(`Failed to fetch company.json: ${companyRes.statusText}`);
            const companyData = await companyRes.json();

            // 3. Download all active GeoJSON chunk files in parallel
            console.log(`[BotDataBuilder] Downloading ${activeFiles.length} geojson files...`);
            const chunkPromises = activeFiles.map(async (fileName) => {
                const url = `${this.baseUrl}/data/${fileName}?v=${version}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch ${fileName}: ${res.statusText}`);

                const json = await res.json();

                // Extract default company name from the filename (e.g., "JR East.json" -> "JR East")
                const defaultCompany = fileName.replace('.json', '');

                return { json, company: defaultCompany };
            });

            const geoJsonChunks = await Promise.all(chunkPromises);

            // 4. Parse the chunks into memory models using the core parser
            console.log(`[BotDataBuilder] Parsing features and building indices...`);
            const parsedData = parseGeoJsonBatch(geoJsonChunks, companyData);

            const geoData = {
                type: "FeatureCollection",
                features: parsedData.newFeatures
            };

            const railwayData = parsedData.railwayUpdates;

            console.log(`[BotDataBuilder] Build complete. Loaded ${Object.keys(railwayData).length} lines and ${geoData.features.length} geographic features.`);

            return {
                railwayData,
                geoData,
                companyData,
                version
            };

        } catch (error) {
            console.error(`[BotDataBuilder] Error building data:`, error);
            throw error;
        }
    }
}
