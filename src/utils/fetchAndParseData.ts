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
        const dbReq = indexedDB.open('RailRoundDataDB', 1);
        const db = await new Promise((resolve, reject) => {
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
        });

        const tx = (db as IDBDatabase).transaction('files', 'readonly');
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
        console.warn('[fetchAndParseData] IndexedDB cache fetch failed. The embedded component may not render properly if visited purely standalone without initial app visit.', e);
    }

    return { companyData, railwayData, geoData };
};
