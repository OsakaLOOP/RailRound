import type { RailwayMap, Station } from '../../store';

// ==========================================
// Part 1: Global Fuzzy Search (Keyword -> Exact IDs)
// ==========================================

export interface StationSearchResult {
    id: string;
    name: string;
    lineKey: string;
    company: string;
}

export interface GlobalSearchResult {
    companies: string[];     // Exact company names matching the keyword
    lines: string[];         // Exact line keys matching the keyword
    stations: StationSearchResult[]; // Station objects matching the keyword
}

/**
 * Performs a global fuzzy search across Companies, Lines, and Stations based on a keyword.
 * This is the entry point when a user inputs a natural language search string.
 *
 * @param keyword The user's input string
 * @param railwayData The structured railway data map
 * @returns A structured result containing lists of exact matching IDs for each category.
 */
export const searchGlobal = (keyword: string, railwayData: RailwayMap): GlobalSearchResult => {
    const result: GlobalSearchResult = {
        companies: [],
        lines: [],
        stations: []
    };

    if (!keyword || !keyword.trim()) return result;
    const normalizedKeyword = keyword.trim().toLowerCase();

    const seenCompanies = new Set<string>();

    for (const lineKey in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
        const line = railwayData[lineKey];
        const company = line.meta?.company || "未知";
        const lineName = lineKey.includes(':') ? lineKey.split(':').slice(1).join(':') : lineKey;

        let companyMatched = false;

        // 1. Check Company Match
        if (company.toLowerCase().includes(normalizedKeyword)) {
            companyMatched = true;
            if (!seenCompanies.has(company)) {
                seenCompanies.add(company);
                result.companies.push(company);
            }
            // Skip checking Line and Stations because the entire Company matched
            continue;
        }

        // Ensure seen companies are still tracked to avoid duplicates if they match later
        if (!seenCompanies.has(company)) {
            seenCompanies.add(company);
        }

        // 2. Check Line Match
        if (lineName.toLowerCase().includes(normalizedKeyword) || lineKey.toLowerCase().includes(normalizedKeyword)) {
            result.lines.push(lineKey);
            // Skip checking Stations because the entire Line matched
            continue;
        }

        // 3. Check Stations ONLY if neither Company nor Line matched
        if (line.stations && Array.isArray(line.stations)) {
            line.stations.forEach(station => {
                if (station.name_ja.toLowerCase().includes(normalizedKeyword)) {
                    result.stations.push({
                        id: station.id,
                        name: station.name_ja,
                        lineKey: lineKey,
                        company: company
                    });
                }
            });
        }
    }

    return result;
};


// ==========================================
// Part 2: Hierarchical Drill-down (Exact ID -> Child IDs)
// ==========================================

/**
 * Given an exact Company name, returns all Line Keys belonging to that company.
 * @param exactCompany The exact company name (e.g., "JR East")
 */
export const getLinesByCompany = (exactCompany: string, railwayData: RailwayMap): string[] => {
    const lines: string[] = [];
    for (const lineKey in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, lineKey)) continue;
        const line = railwayData[lineKey];
        if (line.meta?.company === exactCompany) {
            lines.push(lineKey);
        }
    }
    return lines;
};

/**
 * Given an exact Line Key, returns all Station IDs belonging to that line.
 * @param exactLineKey The exact line key (e.g., "JR East:Yamanote Line")
 * @param returnFullObjects If true, returns full Station objects instead of just IDs
 */
export const getStationsByLine = (
    exactLineKey: string,
    railwayData: RailwayMap,
    returnFullObjects: boolean = false
): string[] | Station[] => {
    const line = railwayData[exactLineKey];
    if (!line || !line.stations) return [];

    if (returnFullObjects) {
        return line.stations;
    }

    return line.stations.map((s: Station) => s.id);
};
