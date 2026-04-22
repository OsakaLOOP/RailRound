import { parseGeoJsonBatch } from '../core/parser';

export const fetchAndParseData = async () => {
    let companyData = {};
    let railwayData = null;
    let geoData = null;

    try {
        const companyRes = await fetch(`/company_data.json?v=${Date.now()}`);
        if (companyRes.ok) {
            const txt = await companyRes.text();
            companyData = JSON.parse(txt.replace(/^\uFEFF/, ''));
        }
    } catch (e) {
        console.warn('[fetchAndParseData] company_data.json failed', e);
    }

    try {
        const dbReq = indexedDB.open('RailLOOPDB', 1);
        const db = await new Promise((resolve, reject) => {
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
        });

        const tx = db.transaction('files', 'readonly');
        const store = tx.objectStore('files');

        const reqRail = store.get('__precompiled_railwaydata');
        railwayData = await new Promise((resolve) => {
            reqRail.onsuccess = () => resolve(reqRail.result);
            reqRail.onerror = () => resolve(null);
        });

        const reqGeo = store.get('__precompiled_geodata');
        geoData = await new Promise((resolve) => {
            reqGeo.onsuccess = () => resolve(reqGeo.result);
            reqGeo.onerror = () => resolve(null);
        });
    } catch (e) {
        console.warn('[fetchAndParseData] IndexedDB cache fetch failed.', e);
    }

    // Fallback: If IndexedDB is empty (e.g. first pure visit to blog), fetch via network
    if (!railwayData || !geoData) {
        console.log('[fetchAndParseData] No IndexedDB cache. Initiating network fallback...');
        try {
            const changelogRes = await fetch(`/changelog.json?v=${Date.now()}`);
            if (changelogRes.ok) {
                const changelog = await changelogRes.json();
                const version = changelog.meta.currentVersion || Date.now().toString();
                // We use geojson_manifest.json if available, or just fetch directly if we know what we need.
                // But changelog.json doesn't contain activeFiles anymore? Wait, botDataBuilder says changelog.meta.activeFiles.
                const activeFiles = changelog.meta.activeFiles || [];

                if (activeFiles.length > 0) {
                    const chunkPromises = activeFiles.map(async (fileName) => {
                        // In browser, geojson are under /geojson or /data? Main app uses /geojson
                        const url = `/geojson/${fileName.includes('.geojson') ? fileName : `${fileName}.geojson`}?v=${version}`;
                        const res = await fetch(url);
                        if (!res.ok) throw new Error(`Failed to fetch ${fileName}`);
                        const json = await res.json();
                        const rawCompanyName = fileName.replace(/\.(geojson|json)$/i, '');
                        return { json, company: rawCompanyName };
                    });

                    const geoJsonChunks = await Promise.all(chunkPromises);
                    const parsedData = parseGeoJsonBatch(geoJsonChunks, companyData);

                    railwayData = parsedData.railwayUpdates;
                    geoData = {
                        type: "FeatureCollection",
                        features: parsedData.newFeatures
                    };
                    console.log('[fetchAndParseData] Network fallback complete.');
                } else {
                    // Try to fetch via manifest if changelog activeFiles is empty
                    const manifestRes = await fetch(`/geojson_manifest.json?v=${Date.now()}`).catch(() => null);
                    if (manifestRes && manifestRes.ok) {
                        const manifest = await manifestRes.json();
                        const fileNames = Array.isArray(manifest.files) ? manifest.files : Object.keys(manifest.files || {});
                        const chunkPromises = fileNames.map(async (fileName) => {
                            const url = `/geojson/${fileName.includes('.geojson') ? fileName : `${fileName}.geojson`}?v=${version}`;
                            const res = await fetch(url);
                            if (!res.ok) throw new Error(`Failed to fetch ${fileName}`);
                            const json = await res.json();
                            const rawCompanyName = fileName.replace(/\.(geojson|json)$/i, '');
                            return { json, company: rawCompanyName };
                        });
                        const geoJsonChunks = await Promise.all(chunkPromises);
                        const parsedData = parseGeoJsonBatch(geoJsonChunks, companyData);
                        railwayData = parsedData.railwayUpdates;
                        geoData = {
                            type: "FeatureCollection",
                            features: parsedData.newFeatures
                        };
                        console.log('[fetchAndParseData] Network fallback complete via manifest.');
                    }
                }
            }
        } catch (e) {
            console.error('[fetchAndParseData] Network fallback failed:', e);
        }
    }

    return { companyData, railwayData, geoData };
};
