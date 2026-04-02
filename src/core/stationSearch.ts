import type { RailwayMap, Station } from '../store';

export interface StationSearchResult {
    id: string;
    name: string;
    lineKey: string;
    exactMatch: boolean;
    company: string;
}

/**
 * Searches for stations matching the given query string across all railway data.
 *
 * @param query The station name or keyword to search for.
 * @param railwayData The structured railway data map.
 * @param limit Optional maximum number of results to return (default: 50).
 * @returns An array of matching station IDs (or full objects with context).
 */
export const searchStations = (
    query: string,
    railwayData: RailwayMap,
    limit: number = 50
): StationSearchResult[] => {
    if (!query || !query.trim()) return [];

    const normalizedQuery = query.trim().toLowerCase();
    const exactMatches: StationSearchResult[] = [];
    const partialMatches: StationSearchResult[] = [];

    // Optimize: prevent returning thousands of single-letter matches
    if (normalizedQuery.length < 2) return [];

    for (const [lineKey, line] of Object.entries(railwayData)) {
        if (!line.stations || !Array.isArray(line.stations)) continue;

        const company = line.meta?.company || "未知";

        for (const station of line.stations) {
            const stName = station.name_ja.toLowerCase();

            // Check for match
            if (stName === normalizedQuery) {
                exactMatches.push({
                    id: station.id,
                    name: station.name_ja,
                    lineKey,
                    company,
                    exactMatch: true
                });
            } else if (stName.includes(normalizedQuery)) {
                partialMatches.push({
                    id: station.id,
                    name: station.name_ja,
                    lineKey,
                    company,
                    exactMatch: false
                });
            }
        }
    }

    // Sort exact matches by line/company to group them logically
    exactMatches.sort((a, b) => a.company.localeCompare(b.company));

    // Sort partial matches (shorter names first, as they are likely more relevant)
    partialMatches.sort((a, b) => a.name.length - b.name.length);

    // Combine and limit
    const combined = [...exactMatches, ...partialMatches];
    return combined.slice(0, limit);
};

/**
 * Convenience wrapper that returns only the matching station IDs.
 * Use this if the bot only needs IDs for the routing payload.
 *
 * @param query The station name to search for.
 * @param railwayData The structured railway data map.
 * @returns Array of station IDs.
 */
export const searchStationIds = (query: string, railwayData: RailwayMap): string[] => {
    const results = searchStations(query, railwayData);
    return results.map(r => r.id);
};
