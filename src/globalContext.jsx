/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useMemo, useEffectEvent, useCallback, useRef } from "react";
// createContext, 这是让一切好起来的关键!

import { api } from "./services/api";
import { db } from "./utils/db";
import { verCalc, isVerSupported, verCmp } from "./utils/verCalc";
import { meta, logs } from '../public/changelog.json';

export const MetaContext = createContext({
        thememode: 'light',
        area: 'JP', // 用于决定地图显示区域等
        locale: 'zh-CN',
});
export const useMeta = () => useContext(MetaContext);// Hook

export const VersionContext = createContext(null);
export const useVersion = () => useContext(VersionContext);// Hook

export const AuthContext = createContext({
    isLoggedIn: false,
    username: null,
    userProfile: null,
    token: null,

});// 用于用户登录逻辑的迁移. 还要创建其他 Hook. UserDataContext 必须实现 actions 对象，封装所有数据修改逻辑(含乐观更新).


export const UserDataContext = createContext(null);// 用于用户数据存储的迁移. 后面将采用 S3.
export const useAuth = () => useContext(AuthContext);
export const useUserData = () => useContext(UserDataContext)// Hook

export const GeoContext = createContext(null);
export const useGeo = () => useContext(GeoContext);// Hook
// 用于地理数据加载和 Worker 通信


export const GlobalProvider = ({ children }) => {

    const [versionInfo, setVersionInfo] = useState({
        currentVer: meta["currentVersion"],
        lastModified: meta["lastModified"],
        lastUpdated: meta["lastUpdated"],
        minVer: meta["minVer"]||"0.20",
        rawLogs: logs,
        ver: verCalc(meta["currentVersion"]),
        isSupported: isVerSupported(meta["currentVersion"], meta["minVer"]||"0.20"),
        hasUpdate: null
    });// 用于完善版本检查, 提示等. 为了让 Context 有更多用处, 我们考虑支持热更新.

    // Update Logic
    useEffect(() => {
        const checkUpdate = async () => {
            try {
                const res = await fetch(`/changelog.json?t=${Date.now()}`);
                if (!res.ok) return;
                const remoteData = await res.json();
                const remoteMeta = remoteData.meta;
                const cmpRes = verCmp(remoteMeta.currentVersion, versionInfo.currentVer);

                if (cmpRes && cmpRes.diff > 0) {
                    setVersionInfo(prev => ({
                        ...prev,
                        hasUpdate: cmpRes.at,
                        currentVer: remoteMeta.currentVersion,
                        lastModified: remoteMeta.lastModified,
                        lastUpdated: remoteMeta.lastUpdated,
                        rawLogs: remoteData.logs,
                        ver: verCalc(remoteMeta.currentVersion),
                        isSupported: isVerSupported(remoteMeta.currentVersion, remoteMeta.minVer || "0.20")
                    }));
                }
            } catch (e) { console.warn("[RailLOOP] Update Check failed", e); }
        };
        const timer = setInterval(checkUpdate, 600000);
        checkUpdate();
        return () => clearInterval(timer);
    }, []);

    // Meta State (Default)
    const metaState = { thememode: 'light', area: 'JP', locale: 'zh-CN' };

    // --- Auth State ---
    const [user, setUser] = useState(null); // { token, username }
    const [userProfile, setUserProfile] = useState(null); // Full profile

    const login = useCallback(async (token, username) => {
        setUser({ token, username });
        localStorage.setItem('rail_token', token);
        localStorage.setItem('rail_username', username);
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        setUserProfile(null);
        localStorage.removeItem('rail_token');
        localStorage.removeItem('rail_username');
        window.location.href = '/';
    }, []);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('token');
        const usernameFromUrl = urlParams.get('username');
        
        if (tokenFromUrl && usernameFromUrl) {
            login(tokenFromUrl, usernameFromUrl);
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            const t = localStorage.getItem('rail_token');
            const u = localStorage.getItem('rail_username');
            if (t && u) setUser({ token: t, username: u });
        }
    }, [login]);


    // --- User Data State ---
    const [trips, setTrips] = useState([]);
    const [pins, setPins] = useState([]);
    const [folders, setFolders] = useState([]);
    const [badgeSettings, setBadgeSettings] = useState({ enabled: true });
    const [editorMode, setEditorMode] = useState('manual');

    // Geo Worker Reference
    const workerRef = useRef(null);

    const loadUserData = useCallback(async (authToken) => {
        if (!authToken) return;
        try {
            const data = await api.getData(authToken);
            setUserProfile(data);
            setTrips(data.trips || []);
            setPins(data.pins || []);
            setFolders(data.folders || []);
            setBadgeSettings(data.badge_settings || { enabled: true });
        } catch (e) {
            console.error("Failed to load user data", e);
            if (e.message.includes('Unauthorized')) logout();
        }
    }, [logout]);

    useEffect(() => {
        if (user?.token) loadUserData(user.token);
    }, [user, loadUserData]);

    const saveData = useCallback(async (newTrips, newPins, newFolders, newBadgeSettings) => {
        if (!user?.token) return;

        if(newTrips) setTrips(newTrips);
        if(newPins) setPins(newPins);
        if(newFolders) setFolders(newFolders);
        if(newBadgeSettings) setBadgeSettings(newBadgeSettings);

        let latest5 = null;
        if (workerRef.current) {
            try {
                const response = await new Promise((resolve, reject) => {
                    const id = Date.now() + Math.random();
                    const handler = (e) => {
                        if (e.data.id === id) {
                            workerRef.current.removeEventListener('message', handler);
                            if (e.data.success) resolve(e.data.result); else reject(e.data.error);
                        }
                    };
                    workerRef.current.addEventListener('message', handler);
                    workerRef.current.postMessage({ type: 'CALC_STATS', id, payload: { trips: newTrips || trips } });
                });
                latest5 = response;
            } catch (e) {
                console.error("Worker stats calc failed", e);
            }
        }

        try {
            await api.saveData(
                user.token,
                newTrips || trips,
                newPins || pins,
                latest5,
                versionInfo.currentVer,
                newFolders || folders,
                newBadgeSettings || badgeSettings
            );
        } catch (e) {
            console.error("Save failed", e);
            alert("同步失败: " + e.message);
            throw e;
        }
    }, [user, trips, pins, folders, badgeSettings, versionInfo]);


    // --- Geo State ---
    const [railwayData, setRailwayData] = useState({});
    const [geoData, setGeoData] = useState({ type: "FeatureCollection", features: [] });
    const [companyDB, setCompanyDB] = useState({});
    const [isGeoReady, setIsGeoReady] = useState(false);
    const [pinMode, setPinMode] = useState('idle');

    // Initialize Worker
    useEffect(() => {
        workerRef.current = new Worker(new URL('./workers/geo.worker.js', import.meta.url), { type: 'module' });
        return () => workerRef.current?.terminate();
    }, []);

    const normalizeCompanyName = (s) => {
        if (!s && s !== 0) return '';
        try { return String(s).normalize('NFKC').replace(/\s+/g, ' ').trim(); }
        catch (e) { return String(s).replace(/\s+/g, ' ').trim(); }
    };
    const buildCompanyIndex = (cData) => {
        const idx = {};
        if (!cData) return idx;
        Object.keys(cData).forEach(k => { idx[normalizeCompanyName(k)] = k; });
        return idx;
    };
    const findBestCompanyKey = (name, index) => {
        const n = normalizeCompanyName(name);
        if (!n) return name;
        if (index[n]) return index[n];
        for (const key of Object.keys(index)) {
             if (key.includes(n) || n.includes(key) || key.startsWith(n) || n.startsWith(key)) return index[key];
        }
        return name;
    };

    // Auto Load Data
    useEffect(() => {
        const initData = async () => {
            let cData = {};
            try {
                const res = await fetch('/company_data.json');
                if (res.ok) {
                    const txt = await res.text();
                    cData = JSON.parse(txt.replace(/^\uFEFF/, ''));
                    setCompanyDB(cData);
                }
            } catch (e) { console.warn("Failed to load company_data", e); }
            const cIndex = buildCompanyIndex(cData);

            let cached = [];
            try {
                const dbInstance = await db.open();
                const tx = dbInstance.transaction(db.STORE_FILES, 'readonly');
                const store = tx.objectStore(db.STORE_FILES);
                const req = store.getAll();
                cached = await new Promise(resolve => {
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => resolve([]);
                });
            } catch (e) { console.warn("Cache read failed", e); }

            const manifestRes = await fetch('/geojson_manifest.json').catch(() => null);
            const geojsonFiles = manifestRes && manifestRes.ok ? (await manifestRes.json()).files || [] : [];
            const cachedNames = new Set(cached.map(f => f.fileName));
            const missing = geojsonFiles.filter(f => !cachedNames.has(f.replace(/\.(geojson|json)$/i, '')));

            const downloads = await Promise.all(missing.map(async f => {
                try {
                    const res = await fetch(`/geojson/${f}`);
                    if (!res.ok) return null;
                    const json = await res.json();
                    const name = f.replace(/\.(geojson|json)$/i, '');
                    const comp = findBestCompanyKey(name, cIndex);
                    const item = { json, company: comp, fileName: name };
                    await db.set(db.STORE_FILES, name, item);
                    return item;
                } catch(e) { return null; }
            }));

            const allData = [...cached, ...downloads.filter(Boolean)];

            const newFeatures = [];
            const rData = {};

            allData.forEach(({ json, company }) => {
                if (!json.features) return;
                const enriched = json.features.map(f => ({
                    ...f, properties: { ...f.properties, company: f.properties.company || f.properties.operator || company || "上传数据" }
                }));
                newFeatures.push(...enriched);

                enriched.forEach(f => {
                    const p = f.properties;
                    const comp = p.company;

                    const ensureLine = (name, props) => {
                         const key = `${comp}:${name}`;
                         if (!rData[key]) {
                             const info = cData[comp] || {};
                             rData[key] = {
                                 meta: { region: info.region||"未知", type: info.type||"未知", company: comp, logo: info.logo, icon: props.icon||info.logo },
                                 stations: []
                             };
                         } else if (props.icon && !rData[key].meta.icon) {
                             rData[key].meta.icon = props.icon;
                         }
                         return key;
                    };

                    if (p.type === 'line' && p.name) ensureLine(p.name, p);
                    else if (p.type === 'station' && p.line && p.name && f.geometry?.coordinates) {
                        const k = ensureLine(p.line, p);
                        if (!rData[k].stations.find(s => s.name_ja === p.name)) {
                            rData[k].stations.push({
                                id: p.id || `${comp}:${p.line}:${p.name}`,
                                name_ja: p.name,
                                lat: f.geometry.coordinates[1],
                                lng: f.geometry.coordinates[0],
                                transfers: p.transfers || []
                            });
                        }
                    }
                });
            });

            setGeoData({ type: "FeatureCollection", features: newFeatures });
            setRailwayData(rData);

            workerRef.current.postMessage({
                type: 'INIT_DATA',
                id: 'init',
                payload: { railwayData: rData, geoData: { type: "FeatureCollection", features: newFeatures } }
            });
            setIsGeoReady(true);
        };

        initData();
    }, []);

    const getRouteVisualData = useCallback(async (segments) => {
        if (!workerRef.current) return { totalDist: 0, visualPaths: [] };
        return new Promise((resolve) => {
            const id = Date.now() + Math.random();
            const handler = (e) => {
                if (e.data.id === id) {
                    workerRef.current.removeEventListener('message', handler);
                    resolve(e.data.result);
                }
            };
            workerRef.current.addEventListener('message', handler);
            workerRef.current.postMessage({ type: 'GET_ROUTE_VISUAL', id, payload: { segments } });
        });
    }, []);

    const getAllGeometries = useCallback(async (tripsList) => {
        if (!workerRef.current) return [];
        return new Promise((resolve) => {
            const id = Date.now() + Math.random();
            const handler = (e) => {
                if (e.data.id === id) {
                    workerRef.current.removeEventListener('message', handler);
                    resolve(e.data.result);
                }
            };
            workerRef.current.addEventListener('message', handler);
            workerRef.current.postMessage({ type: 'GET_ALL_GEOMETRIES', id, payload: { trips: tripsList } });
        });
    }, []);

    const generateKmlData = useCallback(async (tripsList) => {
        if (!workerRef.current) return [];
        return new Promise((resolve) => {
            const id = Date.now() + Math.random();
            const handler = (e) => {
                if (e.data.id === id) {
                    workerRef.current.removeEventListener('message', handler);
                    resolve(e.data.result);
                }
            };
            workerRef.current.addEventListener('message', handler);
            workerRef.current.postMessage({ type: 'GENERATE_KML_DATA', id, payload: { trips: tripsList } });
        });
    }, []);


    // --- Combine Values ---
    const authVal = { user, userProfile, login, logout };
    const userVal = { trips, pins, folders, badgeSettings, saveData, setTrips, setPins, setFolders, setBadgeSettings, editorMode, setEditorMode };
    const geoVal = { railwayData, setRailwayData, geoData, setGeoData, companyDB, setCompanyDB, isGeoReady, getRouteVisualData, getAllGeometries, generateKmlData, workerRef, pinMode, setPinMode };

    return (
        <VersionContext value={versionInfo}>
            <MetaContext value={metaState}>
                <AuthContext value={authVal}>
                    <GeoContext value={geoVal}>
                        <UserDataContext value={userVal}>
                            {children}
                        </UserDataContext>
                    </GeoContext>
                </AuthContext>
            </MetaContext>
        </VersionContext>
    );// react 19+ 特性可以不要.Provider. Working at 19.2.4
};
