import type { Station, RailwayLineMeta } from '../store';

const mergeBucket = (current: any, incoming: any) => {
    const base = (current && typeof current === 'object') ? current : {};
    const next = (incoming && typeof incoming === 'object') ? incoming : {};
    return {
        ...base,
        ...next,
        ...(Array.isArray(next.subSegments) ? { subSegments: next.subSegments } : {}),
        ...(Array.isArray(next.events) ? { events: next.events } : {}),
        ...(Array.isArray(next.systems) ? { systems: next.systems } : {})
    };
};

const mergeNetworkMeta = (existingMeta: any, incomingMeta: any, direction?: string) => {
    if (!incomingMeta || typeof incomingMeta !== 'object') return existingMeta;
    const existing = (existingMeta && typeof existingMeta === 'object') ? existingMeta : {};
    const normalizedDirection = direction === 'up' || direction === 'down' ? direction : undefined;
    const hasStructuredMeta = !!incomingMeta.byDirection || !!incomingMeta.common;

    if (normalizedDirection && !hasStructuredMeta) {
        return {
            ...existing,
            byDirection: {
                ...(existing.byDirection || {}),
                [normalizedDirection]: mergeBucket(existing.byDirection?.[normalizedDirection], incomingMeta)
            }
        };
    }

    return {
        ...existing,
        ...incomingMeta,
        ...(incomingMeta.common ? { common: mergeBucket(existing.common, incomingMeta.common) } : {}),
        ...(incomingMeta.byDirection
            ? {
                byDirection: {
                    ...(existing.byDirection || {}),
                    ...(incomingMeta.byDirection.up
                        ? { up: mergeBucket(existing.byDirection?.up, incomingMeta.byDirection.up) }
                        : {}),
                    ...(incomingMeta.byDirection.down
                        ? { down: mergeBucket(existing.byDirection?.down, incomingMeta.byDirection.down) }
                        : {})
                }
            }
            : {})
    };
};

/**
 * Parse GeoJSON features and build railwayData + flattened geoData features.
 */
export const parseGeoJsonBatch = (items: { json: any; company?: string }[], companyData: any = {}) => {
    const newFeatures: any[] = [];
    const railwayUpdates: Record<string, { meta: RailwayLineMeta; stations: Station[] }> = {};

    items.forEach(({ json, company: defaultCompany }) => {
        if (!json || !json.features || !Array.isArray(json.features)) return;

        const enriched = json.features.map((f: any) => ({
            ...f,
            properties: {
                ...f.properties,
                company: f.properties.company || f.properties.operator || defaultCompany || '未知公司'
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
                    const color = props.stroke || props.color || props.lineColor || null;
                    railwayUpdates[lineKey] = {
                        meta: {
                            region: info.region || '未知',
                            type: info.type || '未知',
                            company: comp,
                            logo: info.logo,
                            icon,
                            companyIcon: info.icon || null,
                            color,
                            recolor: info.recolor === true,
                            isLoop: props.isLoop === true || props.isLoop === 'true',
                            ...(props.networkMeta
                                ? { networkMeta: mergeNetworkMeta(undefined, props.networkMeta, props.direction) }
                                : {})
                        },
                        stations: []
                    };
                } else {
                    if (props.icon && !railwayUpdates[lineKey].meta.icon) {
                        railwayUpdates[lineKey].meta.icon = props.icon;
                    }
                    if ((props.stroke || props.color || props.lineColor) && !railwayUpdates[lineKey].meta.color) {
                        railwayUpdates[lineKey].meta.color = props.stroke || props.color || props.lineColor;
                    }
                    if (props.isLoop === true || props.isLoop === 'true') {
                        railwayUpdates[lineKey].meta.isLoop = true;
                    }
                    if (props.networkMeta) {
                        railwayUpdates[lineKey].meta.networkMeta = mergeNetworkMeta(
                            railwayUpdates[lineKey].meta.networkMeta,
                            props.networkMeta,
                            props.direction
                        );
                    }
                }
                return lineKey;
            };

            if (p.type === 'line' && p.name) {
                ensureLineInTemp(p.name, p);
            } else if (p.type === 'station' && p.line && p.name && f.geometry?.coordinates) {
                const lineKey = ensureLineInTemp(p.line, p);
                const stations = railwayUpdates[lineKey].stations;

                if (!stations.find((s: any) => s.name_ja === p.name)) {
                    const stationId = p.id || `${comp}:${p.line}:${p.name}`;
                    stations.push({
                        id: stationId,
                        name_ja: p.name,
                        lat: f.geometry.coordinates[1],
                        lng: f.geometry.coordinates[0],
                        transfers: p.transfers || [],
                        landmark: p.landmark === true || p.landmark === 'true'
                    });
                }
            }
        });
    });

    for (const lineKey in railwayUpdates) {
        const entry = railwayUpdates[lineKey];
        if (entry.meta.isLoop && entry.stations.length > 2) {
            const [first, ...rest] = entry.stations;
            rest.reverse();
            entry.stations = [first, ...rest];
        }
    }

    return {
        newFeatures,
        railwayUpdates
    };
};
