import type { RailwayMap, CompanyMeta, Station } from '../store';

/**
 * A standalone, environment-agnostic pure function to parse GeoJSON features
 * and build the `railwayData` mapping and flattened `geoData`.
 *
 * @param items Array of objects { json: { features: [...] }, company: string }
 * @param companyData The loaded company metadata mapping
 * @returns { newFeatures: any[], railwayUpdates: any }
 */
export const parseGeoJsonBatch = (items: { json: any; company?: string }[], companyData: any = {}) => {
    const newFeatures: any[] = [];
    const railwayUpdates: Record<string, { meta: CompanyMeta, stations: Station[] }> = {};

    items.forEach(({ json, company: defaultCompany }) => {
        if (!json || !json.features || !Array.isArray(json.features)) return;

        const enriched = json.features.map((f: any) => ({
            ...f,
            properties: {
                ...f.properties,
                company: f.properties.company || f.properties.operator || defaultCompany || "上传数据"
            }
        }));

        newFeatures.push(...enriched);

        enriched.forEach((f: any) => {
            const p = f.properties;
            const comp = p.company;

            const ensureLineInTemp = (lineName: string, props: any) => {
                const lineKey = `${comp}:${lineName}`;
                if (!railwayUpdates[lineKey]) {
                    const info: any = companyData[comp] || {};
                    const icon = props.icon || info.logo || null;
                    railwayUpdates[lineKey] = {
                        meta: {
                            region: info.region || "未知",
                            type: info.type || "未知",
                            company: comp,
                            logo: info.logo,
                            icon
                        },
                        stations: []
                    };
                } else if (props.icon && !railwayUpdates[lineKey].meta.icon) {
                    railwayUpdates[lineKey].meta.icon = props.icon;
                }
                return lineKey;
            };

            if (p.type === 'line' && p.name) {
                ensureLineInTemp(p.name, p);
            } else if (p.type === 'station' && p.line && p.name && f.geometry?.coordinates) {
                const lineKey = ensureLineInTemp(p.line, p);
                const stations = railwayUpdates[lineKey].stations;

                // Add station if it doesn't already exist in this temp batch
                if (!stations.find((s: any) => s.name_ja === p.name)) {
                    const stationId = p.id || `${comp}:${p.line}:${p.name}`;
                    stations.push({
                        id: stationId,
                        name_ja: p.name,
                        lat: f.geometry.coordinates[1],
                        lng: f.geometry.coordinates[0],
                        transfers: p.transfers || []
                    });
                }
            }
        });
    });

    return {
        newFeatures,
        railwayUpdates
    };
};
