import { RailwayMap } from '../store';
import { getLineSystems } from './networkDisplay';

export interface SelectableLine {
    key: string;
    displayName: string;
    icon: string | null;
    recolor?: boolean;
    color?: string | null;
    companyIcon?: string | null;
}

export interface CompanyGroup {
    name: string;
    logo: string | null;
    lines: SelectableLine[];
    systems?: string[];
}

export interface RegionGroup {
    name: string;
    companies: CompanyGroup[];
}

export type CategoryKey = 'JR' | 'Private' | 'City';

const normalizeRegion = (region: string) => {
    if (!region || !region.trim()) return 'Unknown';
    return region.trim();
};

const getCategory = (type?: string): CategoryKey => {
    if (type === 'JR') return 'JR';
    if (type === 'Private' || type === '私铁' || type === '第三セクター') return 'Private';
    return 'City';
};

const sortLines = (lines: SelectableLine[]) => {
    lines.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja', { numeric: true, sensitivity: 'base' }));
};

export const buildLineSelectorGroups = (
    railwayData: RailwayMap,
    allowedLines: string[] | null = null,
    priorityRegion?: string
): Record<CategoryKey, RegionGroup[]> => {
    const rawGroups: Record<CategoryKey, Record<string, Record<string, { logo: string | null; lines: SelectableLine[]; systems: Set<string> }>>> = {
        JR: {},
        Private: {},
        City: {}
    };

    for (const key in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, key)) continue;
        if (allowedLines && !allowedLines.includes(key)) continue;

        const line = railwayData[key];
        const { region, type, company, logo, icon } = line.meta;
        const category = getCategory(type);
        const normRegion = normalizeRegion(region || 'Unknown');

        if (!rawGroups[category][normRegion]) rawGroups[category][normRegion] = {};

        const companyName = company || 'Unknown';
        if (!rawGroups[category][normRegion][companyName]) {
            rawGroups[category][normRegion][companyName] = {
                logo: logo || null,
                lines: [],
                systems: new Set<string>()
            };
        }

        const displayName = key.includes(':') ? key.split(':').slice(1).join(':') : key;
        rawGroups[category][normRegion][companyName].lines.push({
            key,
            displayName,
            icon: icon || null,
            recolor: line.meta.recolor,
            color: line.meta.color,
            companyIcon: line.meta.companyIcon
        });

        const systems = getLineSystems(line);
        systems.forEach((system) => rawGroups[category][normRegion][companyName].systems.add(system));
    }

    const result: Record<CategoryKey, RegionGroup[]> = { JR: [], Private: [], City: [] };

    (Object.keys(rawGroups) as CategoryKey[]).forEach((category) => {
        const regions: RegionGroup[] = [];
        Object.keys(rawGroups[category]).forEach((regionName) => {
            const companiesRaw = rawGroups[category][regionName];
            const companies: CompanyGroup[] = Object.keys(companiesRaw)
                .map((companyName) => {
                    const data = companiesRaw[companyName];
                    sortLines(data.lines);
                    return {
                        name: companyName,
                        logo: data.logo,
                        lines: data.lines,
                        systems: [...data.systems]
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

            regions.push({ name: regionName, companies });
        });

        regions.sort((a, b) => {
            if (priorityRegion) {
                if (a.name === priorityRegion) return -1;
                if (b.name === priorityRegion) return 1;
            }
            return a.name.localeCompare(b.name, 'ja');
        });

        result[category] = regions;
    });

    return result;
};
