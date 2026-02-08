/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api } from "./services/api";
import { db } from "./utils/db";
import { verCalc, isVerSupported, verCmp } from "./utils/verCalc";
import { meta, logs } from '../public/changelog.json';

// --- Context Definitions ---
export const MetaContext = createContext(meta);
export const VersionContext = createContext(null);
export const AuthContext = createContext(null);
export const UserDataContext = createContext(null);
export const GeoContext = createContext(null);

// --- Hooks ---
export const useMeta = () => useContext(MetaContext);
export const useVersion = () => useContext(VersionContext);
export const useAuth = () => useContext(AuthContext);
export const useUserData = () => useContext(UserDataContext);
export const useGeo = () => useContext(GeoContext);

export const GlobalProvider = ({ children }) => {
    // --- Version State ---
    const [versionInfo, setVersionInfo] = useState({
        currentVer: meta["currentVersion"],
        lastModified: meta["lastModified"],
        lastUpdated: meta["lastUpdated"],
        minVer: meta["minVer"] || "0.20",
        rawLogs: logs,
        ver: verCalc(meta["currentVersion"]),
        isSupported: isVerSupported(meta["currentVersion"], meta["minVer"] || "0.20"),
        hasUpdate: null
    });

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


    // --- Auth State ---
    const [user, setUser] = useState(null); // { token, username }
    const [userProfile, setUserProfile] = useState(null); // Full profile

    const login = useCallback(async (token, username) => {
        setUser({ token, username });
        localStorage.setItem('rail_token', token);
        localStorage.setItem('rail_username', username);
        // Data loading is triggered by UserData provider effect
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        setUserProfile(null);
        localStorage.removeItem('rail_token');
        localStorage.removeItem('rail_username');
        window.location.href = '/'; // Hard reset
    }, []);

    // Check Auth on Mount
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
    const [editorMode, setEditorMode] = useState('manual'); // Shared UI state for Tutorial

    // Geo Worker Reference (needed for stats calc during save)
    const workerRef = useRef(null);

    const loadUserData = useCallback(async (authToken) => {
        if (!authToken) return;
        try {
            const data = await api.getData(authToken);
            setUserProfile(data);

            // Logic to merge local storage if needed could go here,
            // but for now we trust cloud + basic overwrite or just load cloud.
            // Simplified: Load Cloud.
            setTrips(data.trips || []);
            setPins(data.pins || []);
            setFolders(data.folders || []);
            setBadgeSettings(data.badge_settings || { enabled: true });
        } catch (e) {
            console.error("Failed to load user data", e);
            if (e.message.includes('Unauthorized')) logout();
        }
    }, [logout]);

    // Load data when user changes
    useEffect(() => {
        if (user?.token) loadUserData(user.token);
    }, [user, loadUserData]);

    const saveData = useCallback(async (newTrips, newPins, newFolders, newBadgeSettings) => {
        if (!user?.token) return;

        // Optimistic Update
        if(newTrips) setTrips(newTrips);
        if(newPins) setPins(newPins);
        if(newFolders) setFolders(newFolders);
        if(newBadgeSettings) setBadgeSettings(newBadgeSettings);

        // Calc Stats via Worker
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
        }
    }, [user, trips, pins, folders, badgeSettings, versionInfo]);


    // --- Geo State ---
    const [railwayData, setRailwayData] = useState({});
    const [geoData, setGeoData] = useState({ type: "FeatureCollection", features: [] });
    const [companyDB, setCompanyDB] = useState({});
    const [isGeoReady, setIsGeoReady] = useState(false);
    const [pinMode, setPinMode] = useState('idle'); // Shared UI state

    // Initialize Worker
    useEffect(() => {
        workerRef.current = new Worker(new URL('./workers/geo.worker.js', import.meta.url), { type: 'module' });
        return () => workerRef.current?.terminate();
    }, []);

    // Helper: Normalize Company Name
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
            // 1. Company Data
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

            // 2. GeoJSON Cache & Fetch
            let cached = [];
            try {
                cached = await db.get(db.STORE_FILES) || []; // This might fail if get returns single item not list? db.js says store.getAll() in open? No, db.js needs getAll helper.
                // Wait, db.js 'get' does `store.get(key)`. We need `getAll`.
                // Let's check db.js content again.
                // It has `open`, `get`, `set`, `delete`, `clear`. NO `getAll`.
                // I need to patch db.js or use manual iteration.
                // But `RailRound.jsx` used `store.getAll()` inside `db.open()` transaction...
                // Wait, `RailRound.jsx` had inline logic: `const req = store.getAll();`.
                // I should probably add `getAll` to `db` utils or just do it here.
                // For now, I'll modify the logic to handle the missing helper or patch it.
                // Actually `RailRound.jsx` code:
                /*
                  const dbInstance = await db.open();
                  const tx = dbInstance.transaction(db.STORE_FILES, 'readonly');
                  const store = tx.objectStore(db.STORE_FILES);
                  const req = store.getAll(); ...
                */
                // I will do the same here.
                const dbInstance = await db.open();
                const tx = dbInstance.transaction(db.STORE_FILES, 'readonly');
                const store = tx.objectStore(db.STORE_FILES);
                const req = store.getAll();
                cached = await new Promise(resolve => {
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => resolve([]);
                });
            } catch (e) { console.warn("Cache read failed", e); }

            // 3. Manifest Check
            const manifestRes = await fetch('/geojson_manifest.json').catch(() => null);
            const geojsonFiles = manifestRes && manifestRes.ok ? (await manifestRes.json()).files || [] : [];

            const cachedNames = new Set(cached.map(f => f.fileName));
            const missing = geojsonFiles.filter(f => !cachedNames.has(f.replace(/\.(geojson|json)$/i, '')));

            // 4. Download Missing
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

            // 5. Process
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
                    const lineName = p.name;

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

            // 6. Send to Worker
            workerRef.current.postMessage({
                type: 'INIT_DATA',
                id: 'init',
                payload: { railwayData: rData, geoData: { type: "FeatureCollection", features: newFeatures } }
            });
            setIsGeoReady(true);
        };

        initData();
    }, []);

    // Async Geometry Getter (Wraps Worker)
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


    // --- Combine ---
    const authVal = { user, userProfile, login, logout };
    const userVal = { trips, pins, folders, badgeSettings, saveData, setTrips, setPins, setFolders, setBadgeSettings, editorMode, setEditorMode };
    const geoVal = { railwayData, geoData, companyDB, isGeoReady, getRouteVisualData, getAllGeometries, workerRef, pinMode, setPinMode };

    return (
        <VersionContext.Provider value={versionInfo}>
            <MetaContext.Provider value={meta}>
                <AuthContext.Provider value={authVal}>
                    <UserDataContext.Provider value={userVal}>
                        <GeoContext.Provider value={geoVal}>
                            {children}
                        </GeoContext.Provider>
                    </UserDataContext.Provider>
                </AuthContext.Provider>
            </MetaContext.Provider>
        </VersionContext.Provider>
    );
};
