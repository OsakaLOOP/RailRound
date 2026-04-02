import { Trip, TripSegment, RailwayMap } from '../store';
import { findRoute } from './../core/railwayRouting';

export interface SuicaRow {
    no: string;
    date: string;
    amount: string;
    charge: string;
    action: string;
    details: string;
    balance: string;
}

export const parseCSV = (csvStr: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < csvStr.length; i++) {
        const char = csvStr[i];

        if (char === '"' && csvStr[i+1] === '"') {
            currentCell += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else if (char === '\r' && !inQuotes) {
            // ignore
        } else {
            currentCell += char;
        }
    }

    if (currentRow.length > 0 || currentCell !== '') {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }

    return rows;
};

export const parseSuicaDate = (dateStr: string): string => {
    // "8月 22, 2025" -> 2025-08-22
    const match = dateStr.match(/(\d+)月 (\d+), (\d+)/);
    if (match) {
        const month = match[1].padStart(2, '0');
        const day = match[2].padStart(2, '0');
        const year = match[3];
        return `${year}-${month}-${day}`;
    }
    return dateStr;
};

export interface ParsedDetails {
    inStation: string;
    inLine: string;
    inCompany: string;
    outStation: string;
    outLine: string;
    outCompany: string;
}

const findStation = (stationName: string, lineName: string, companyName: string, railwayData: RailwayMap) => {
    // 1. Try exact match on line and station
    for (const [lineKey, line] of Object.entries(railwayData)) {
        if (line.meta.company === companyName || companyName.includes(line.meta.company) || line.meta.company.includes(companyName)) {
             if (lineKey.includes(lineName) || lineName.includes(lineKey)) {
                 const station = line.stations.find(s => s.name_ja === stationName || s.name_ja.includes(stationName) || stationName.includes(s.name_ja));
                 if (station) {
                     return { lineKey, stationId: station.id };
                 }
             }
        }
    }

    // 2. Try match on station and company (ignoring line)
    for (const [lineKey, line] of Object.entries(railwayData)) {
        if (line.meta.company === companyName || companyName.includes(line.meta.company) || line.meta.company.includes(companyName)) {
             const station = line.stations.find(s => s.name_ja === stationName || s.name_ja.includes(stationName) || stationName.includes(s.name_ja));
             if (station) {
                 return { lineKey, stationId: station.id };
             }
        }
    }

    // 3. Try match just on station name across all
    for (const [lineKey, line] of Object.entries(railwayData)) {
        const station = line.stations.find(s => s.name_ja === stationName || s.name_ja.includes(stationName) || stationName.includes(s.name_ja));
        if (station) {
            return { lineKey, stationId: station.id };
        }
    }

    console.warn(`[SuicaParser] Could not map station: ${stationName} (${lineName} ${companyName})`);
    return null;
}

export const processSuicaCSV = async (csvStr: string, railwayData: RailwayMap): Promise<Trip[]> => {
    const rows = parseCSV(csvStr);
    const trips: Trip[] = [];

    // Header should be the first row, we skip it
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 7) continue;

        const dateStr = row[1];
        const amountStr = row[2];
        const action = row[4];
        const detailsStr = row[5];

        if (!action.includes('運賃支払') || !action.includes('改札出場')) {
            continue;
        }

        const details = parseSuicaDetails(detailsStr);
        if (!details) continue;

        const date = parseSuicaDate(dateStr);
        const cost = parseInt(amountStr, 10) || 0;

        const inMatch = findStation(details.inStation, details.inLine, details.inCompany, railwayData);
        const outMatch = findStation(details.outStation, details.outLine, details.outCompany, railwayData);

        if (inMatch && outMatch) {
            let segments: TripSegment[] = [];
            const routeResult = findRoute(inMatch.lineKey, inMatch.stationId, outMatch.lineKey, outMatch.stationId, railwayData, 6);

            if (routeResult) {
                segments = routeResult.path.map((p: any) => ({
                    id: Date.now().toString() + Math.random().toString(),
                    lineKey: p.lineKey,
                    fromId: p.fromId,
                    toId: p.toId
                }));
                console.log(`[SuicaParser] Found route for: ${details.inStation} -> ${details.outStation} (${segments.length} segments)`);
            } else {
                console.warn(`[SuicaParser] Could not find route for: ${details.inStation} -> ${details.outStation}. Falling back to single segment.`);
                segments = [{
                    id: Date.now().toString() + Math.random().toString(),
                    lineKey: inMatch.lineKey,
                    fromId: inMatch.stationId,
                    toId: outMatch.stationId // Note: this might be across lines, so it's a fallback segment
                }];
            }

            trips.push({
                id: Date.now().toString() + Math.random().toString(),
                date,
                cost,
                memo: `Suica Import: ${details.inStation} -> ${details.outStation}`,
                segments
            });
        } else {
            console.warn(`[SuicaParser] Skipping trip due to missing station map: ${details.inStation} -> ${details.outStation}`);
        }
    }

    return trips;
};

export const parseSuicaDetails = (detailsStr: string): ParsedDetails | null => {
    // 入: モノレール浜松町（東京モノレール羽田空港線 東京モノレール）
    // 出: 羽田空港第2ターミナル（東京モノレール羽田空港線 東京モノレール）
    const regex = /入:\s*(.+?)（(.+?)\s+(.+?)）\n?出:\s*(.+?)（(.+?)\s+(.+?)）/;
    const match = detailsStr.match(regex);
    if (match) {
        return {
            inStation: match[1].trim(),
            inLine: match[2].trim(),
            inCompany: match[3].trim(),
            outStation: match[4].trim(),
            outLine: match[5].trim(),
            outCompany: match[6].trim()
        };
    }
    return null;
};
