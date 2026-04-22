import { parseGeoJsonBatch } from './parser';

// 全局内存缓存，确保同一页面内的组件共享数据
let memoryCache: {
    railwayData: Record<string, any>;
    geoData: { type: string; features: any[] };
    companyData: any;
} = {
    railwayData: {},
    geoData: { type: "FeatureCollection", features: [] },
    companyData: null
};

// 并发锁，防止同一个公司数据被重复重复下载/解析
const fetchLocks: Record<string, Promise<void>> = {};

/**
 * 按需获取并解析线路数据
 * @param requestedLineKey 格式为 "公司名:线路名"
 */
export const fetchAndParseData = async (requestedLineKey?: string) => {
    // 1. 加载公司元数据
    if (!memoryCache.companyData) {
        try {
            const companyRes = await fetch(`/company_data.json?v=${Date.now()}`);
            if (companyRes.ok) {
                const txt = await companyRes.text();
                memoryCache.companyData = JSON.parse(txt.replace(/^\uFEFF/, ''));
                console.log('[fetchAndParseData] Loaded company_data.json');
            }
        } catch (e) {
            console.warn('[fetchAndParseData] company_data.json failed', e);
            memoryCache.companyData = {};
        }
    }

    // 如果未指定线路，返回当前缓存
    if (!requestedLineKey) {
        return { companyData: memoryCache.companyData, railwayData: memoryCache.railwayData, geoData: memoryCache.geoData };
    }

    // 归一化请求的 Key
    const normalizedReqKey = requestedLineKey.replace(/（/g, '(').replace(/）/g, ')').trim();

    // 2. 检查内存是否已加载
    if (memoryCache.railwayData[requestedLineKey] || memoryCache.railwayData[normalizedReqKey]) {
        return { companyData: memoryCache.companyData, railwayData: memoryCache.railwayData, geoData: memoryCache.geoData };
    }

    const companyName = requestedLineKey.split(':')[0];
    if (!companyName) return { companyData: memoryCache.companyData, railwayData: memoryCache.railwayData, geoData: memoryCache.geoData };

    // 检查是否有该公司的加载锁
    if (fetchLocks[companyName]) {
        await fetchLocks[companyName];
        return { companyData: memoryCache.companyData, railwayData: memoryCache.railwayData, geoData: memoryCache.geoData };
    }

    // 3. 执行加载流程
    fetchLocks[companyName] = (async () => {
        const db = await openDatabase();
        try {
            // A. 尝试 IDB 缓存
            if (db && db.objectStoreNames.contains('files')) {
                const tx = db.transaction('files', 'readonly');
                const store = tx.objectStore('files');
                const cacheKey = `blog_chunk:${companyName}`;
                const cached = await new Promise<any>((resolve) => {
                    const req = store.get(cacheKey);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                });

                if (cached && cached.railwayUpdates) {
                    console.log(`[fetchAndParseData] Found IDB cache for ${companyName}`);
                    mergeData(cached.railwayUpdates, cached.newFeatures);
                    // 再次检查确认缓存中是否包含该线路
                    if (memoryCache.railwayData[normalizedReqKey]) return;
                    console.log(`[fetchAndParseData] IDB cache for ${companyName} exists but doesn't contain ${normalizedReqKey}. Proceeding to network.`);
                }
            }

            // B. 网络拉取
            console.log(`[fetchAndParseData] Fetching network for company: ${companyName}`);
            const url = `/geojson/${encodeURIComponent(companyName)}.geojson?v=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const json = await res.json();
            // 在解析时强制传入当前 companyName 作为 defaultCompany
            const parsed = parseGeoJsonBatch([{ json, company: companyName }], memoryCache.companyData);

            const parsedKeys = Object.keys(parsed.railwayUpdates);
            console.log(`[fetchAndParseData] Network load complete for ${companyName}. Parsed ${parsedKeys.length} lines.`);

            // 调试打印：如果请求的 Key 依然不在解析结果中，打印出前几个生成的 Key
            if (!parsed.railwayUpdates[requestedLineKey] && !parsed.railwayUpdates[normalizedReqKey]) {
                console.warn(`[fetchAndParseData] MATCH FAIL! Requested: "${normalizedReqKey}". generated keys:`, parsedKeys);
            }

            mergeData(parsed.railwayUpdates, parsed.newFeatures);

            if (db && db.objectStoreNames.contains('files')) {
                const writeTx = db.transaction('files', 'readwrite');
                writeTx.objectStore('files').put({
                    railwayUpdates: parsed.railwayUpdates,
                    newFeatures: parsed.newFeatures
                }, `blog_chunk:${companyName}`);
            }
        } catch (e) {
            console.error(`[fetchAndParseData] Load failed for ${companyName}:`, e);
        } finally {
            if (db) db.close();
            delete fetchLocks[companyName];
        }
    })();

    await fetchLocks[companyName];
    return {
        companyData: memoryCache.companyData,
        railwayData: memoryCache.railwayData,
        geoData: memoryCache.geoData
    };
};

// 辅助函数：合并数据
function mergeData(railwayUpdates: any, newFeatures: any[]) {
    // 关键修复：使用不可变更新（Spread Operator）产生新引用
    // 这将触发 railwayRouting.ts 中的 buildStationIndex 重新构建索引
    memoryCache.railwayData = { ...memoryCache.railwayData, ...railwayUpdates };

    // 同时也归一化存储一份
    Object.keys(railwayUpdates).forEach(k => {
        const normalizedK = k.replace(/（/g, '(').replace(/）/g, ')');
        if (normalizedK !== k) {
            memoryCache.railwayData[normalizedK] = railwayUpdates[k];
        }
    });

    memoryCache.geoData = {
        ...memoryCache.geoData,
        features: [...memoryCache.geoData.features, ...newFeatures]
    };
}

// 辅助函数：打开数据库
async function openDatabase(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        try {
            const dbReq = indexedDB.open('RailLOOPDB', 1);
            dbReq.onupgradeneeded = (e: any) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
            };
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => resolve(null);
        } catch { resolve(null); }
    });
}
