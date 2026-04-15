import { RailwayMap } from '../store';

// Definitions for the formatted output data structure
export interface SelectableLine {
    key: string;            // Original lineKey e.g. "JR東日本:山手線"
    displayName: string;    // Display name without company prefix
    icon: string | null;    // Line-specific icon
    recolor?: boolean;
    color?: string | null;
    companyIcon?: string | null;
}

export interface CompanyGroup {
    name: string;           // e.g. "JR東日本"
    logo: string | null;    // Company logo
    lines: SelectableLine[];
}

export interface RegionGroup {
    name: string;           // e.g. "関東"
    companies: CompanyGroup[];
}

export type CategoryKey = 'JR' | 'Private' | 'City';

export interface CategoryGroup {
    category: CategoryKey;
    regions: RegionGroup[];
}

const normalizeRegion = (region: string) => {
    if (region === '北海道' || region === '東北') return '北海道・東北';
    if (region === '九州' || region === '沖縄' || region === '九州・沖縄') return '九州・沖縄';
    return region || '其他';
};

// Original Abbreviations for prominent JR Lines
const abbrMap: Record<string, Record<string, string>> = {
    "JR東日本": {
        "東海道線": "JT", "横須賀線": "JO", "京浜東北線": "JK", "横浜線": "JH",
        "南武線": "JN", "鶴見線": "JI", "山手線": "JY", "中央線": "JC",
        "五日市線": "JC1", "総武線": "JB", "宇都宮線": "JU", "埼京線": "JA",
        "常磐線": "JJ", "千代田線": "JL", "京葉線": "JE", "武蔵野線": "JM",
        "湘南新宿ライン": "JS", "中央本線": "CO", "篠ノ井線": "SN",
    },
    "JR西日本": {
        "東海道線": "A", "湖西線": "B", "奈良線": "D", "嵯峨野線": "E",
        "おおさか東線": "F", "宝塚線": "G", "東西線": "H", "大阪環状線": "O",
        "桜島線": "P", "大和路線": "Q", "阪和線": "R", "関西空港線": "S",
    },
    "JR東海": {
        "東海道線": "CA", "御殿場線": "CB", "身延線": "CC", "飯田線": "CD",
        "武豊線": "CE", "中央線": "CF", "高山本線": "CG", "太多線": "CI", "関西本線": "CJ"
    },
    "JR九州": {
        "山陽本線": "JA", "鹿児島本線": "JB", "福北ゆたか線": "JC", "香椎線": "JD",
        "若松線": "JE", "日豊本線": "JF", "原田線": "JG", "長崎本線": "JH",
        "日田彦山線": "JI", "後藤寺線": "JJ", "筑肥線": "JK"
    }
};

/**
 * Builds structured, grouped, and sorted line data specifically for the LineSelector component.
 */
export const buildLineSelectorGroups = (
    railwayData: RailwayMap, 
    allowedLines: string[] | null = null,
    priorityRegion?: string
): Record<CategoryKey, RegionGroup[]> => {

    // 1. Initial rough grouping into objects for easy aggregation
    const rawGroups: Record<CategoryKey, Record<string, Record<string, { logo: string | null, lines: SelectableLine[] }>>> = {
        JR: {}, Private: {}, City: {}
    };

    for (const key in railwayData) {
        if (!Object.prototype.hasOwnProperty.call(railwayData, key)) continue;
        if (allowedLines && !allowedLines.includes(key)) continue;

        const line = railwayData[key];
        const { region, type, company, logo, icon } = line.meta;

        let category: CategoryKey = 'City';
        if (type === 'JR') category = 'JR';
        else if (type === '私鉄' || type === '第三セクター') category = 'Private';

        const normRegion = normalizeRegion(region || '未知');
        if (!rawGroups[category][normRegion]) {
            rawGroups[category][normRegion] = {};
        }

        const compKey = company || '其他';
        if (!rawGroups[category][normRegion][compKey]) {
            rawGroups[category][normRegion][compKey] = { logo: logo || null, lines: [] };
        }

        const displayName = key.includes(':') ? key.split(':').slice(1).join(':') : key;

        rawGroups[category][normRegion][compKey].lines.push({
            key,
            displayName,
            icon: icon || null,
            recolor: line.meta.recolor,
            color: line.meta.color,
            companyIcon: line.meta.companyIcon
        });
    }

    // 2. Sorting function for Lines inside a Company
    const sortLines = (lines: SelectableLine[], companyName: string, companyLogo: string | null) => {
        const hasLineLogo = (lineKey: string) => {
            const meta = (railwayData[lineKey] as any)?.meta || {};
            // If it has an icon and it is DIFFERENT from the company logo, it's a specific line logo
            if (meta.icon && companyLogo && meta.icon !== companyLogo) return true;
            return false;
        };

        lines.sort((a, b) => {
            const aName = a.displayName;
            const bName = b.displayName;

            // Rule 1: Shinkansen priority
            const aIsShinkansen = aName.includes('新幹線');
            const bIsShinkansen = bName.includes('新幹線');

            // Rule 2: Line-specific logo priority
            const aHasLineLogo = hasLineLogo(a.key);
            const bHasLineLogo = hasLineLogo(b.key);

            if (aIsShinkansen !== bIsShinkansen) {
                return aIsShinkansen ? -1 : 1;
            }
            else if (aHasLineLogo !== bHasLineLogo) {
                return aHasLineLogo ? -1 : 1;
            }
            else if (aHasLineLogo && bHasLineLogo) {
                // Rule 3: Known JR internal order mapping
                if (abbrMap[companyName] && abbrMap[companyName][aName] && abbrMap[companyName][bName]) {
                    return abbrMap[companyName][aName].localeCompare(abbrMap[companyName][bName]);
                } else {
                    return aName.localeCompare(bName, 'ja');
                }
            }
            else {
                // Rule 4: Fallback prefix parsing and numeric sort
                const getSortKey = (name: string) => {
                    const prefixMatch = name.match(/^[A-Za-z0-9]+/);
                    return prefixMatch ? prefixMatch[0] : name;
                };
                const keyA = getSortKey(aName);
                const keyB = getSortKey(bName);
                return keyA.localeCompare(keyB, 'ja', { numeric: true, sensitivity: 'base' });
            }
        });
    };

    // 3. Format into final arrays and apply sorting
    const formattedResult: Record<CategoryKey, RegionGroup[]> = {
        JR: [], Private: [], City: []
    };

    const REGION_ORDER = ['北海道・東北', '関東', '中部', '近畿', '中国地方', '四国', '九州・沖縄', '其他', '中国大陆'];

    for (const categoryKey in rawGroups) {
        if (!Object.prototype.hasOwnProperty.call(rawGroups, categoryKey)) continue;
        const category = categoryKey as CategoryKey;
        const regionObj = rawGroups[category];
        const regions: RegionGroup[] = [];

        for (const regionName in regionObj) {
            if (!Object.prototype.hasOwnProperty.call(regionObj, regionName)) continue;
            const companyObj = regionObj[regionName];
            const companies: CompanyGroup[] = [];

            for (const companyName in companyObj) {
                if (!Object.prototype.hasOwnProperty.call(companyObj, companyName)) continue;
                const companyData = companyObj[companyName];

                sortLines(companyData.lines, companyName, companyData.logo);

                companies.push({
                    name: companyName,
                    logo: companyData.logo,
                    lines: companyData.lines
                });
            }

            // Sort companies by name, or put major ones first (optional)
            companies.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

            regions.push({
                name: regionName,
                companies
            });
        }

        // Sort Regions according to predefined geographical order
        regions.sort((a, b) => {
            if (priorityRegion) {
                if (a.name === priorityRegion) return -1;
                if (b.name === priorityRegion) return 1;
            }
            const idxA = REGION_ORDER.indexOf(a.name);
            const idxB = REGION_ORDER.indexOf(b.name);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return idxA !== -1 ? -1 : 1;
        });

        formattedResult[category] = regions;
    }

    return formattedResult;
};
