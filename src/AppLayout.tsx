import React, { useState, useRef, useEffect } from 'react';
import { DragProvider } from './components/DragContext';
import Chest from './components/Chest';
import StationMenu from './components/StationMenu';
import Tutorial from './components/Tutorial';
import { LoginModal } from './components/LoginModal';
import { GithubRegisterModal } from './components/modals/GithubRegisterModal';
import { GithubCardModal } from './components/modals/GithubCardModal';
import { FolderManagerModal } from './components/modals/FolderManagerModal';
import { AddToFolderModal } from './components/modals/AddToFolderModal';
import { TripEditor } from './components/modals/TripEditor';
import { MapContainer } from './components/map/MapContainer';
import { PinEditor } from './components/map/PinEditor';
import { FabButton } from './components/map/FabButton';
import { Header } from './components/layout/Header';
import { BottomNav } from './components/layout/BottomNav';
import { TripsPage } from './pages/TripsPage';
import { StatsPage } from './pages/StatsPage';
import { useStore } from './store';
import { useUserData } from './hooks/useUserData';
import { db } from './utils/db';
import buildKMLString from './buildKml';
import { calculateLatestStats } from './utils/stats';
import GeoWorker from './workers/geo.worker.js?worker';
import { meta } from '../public/changelog.json';
import { api } from './services/api';
import { useShallow } from 'zustand/react/shallow';
import { Toaster, toast } from 'react-hot-toast';
import DistanceWorker from './workers/distance.worker.js?worker';

const CURRENT_VERSION = meta["currentVersion"];

export const AppLayout: React.FC = () => {
    const {
        activeTab, user, setModalState, setCompanyDB, setRailwayData, setGeoData,
        trips, pins, railwayData, geoData, companyDB, setTrips, setPins, folders, badgeSettings,
        setSegmentGeometries, setTripSegmentsGeometry, segmentGeometries, setVisitedStations,
        isLoginOpen
    } = useStore(useShallow(state => ({
        activeTab: state.activeTab,
        user: state.user,
        setModalState: state.setModalState,
        setCompanyDB: state.setCompanyDB,
        setRailwayData: state.setRailwayData,
        setGeoData: state.setGeoData,
        trips: state.trips,
        pins: state.pins,
        railwayData: state.railwayData,
        geoData: state.geoData,
        companyDB: state.companyDB,
        setTrips: state.setTrips,
        setPins: state.setPins,
        folders: state.folders,
        badgeSettings: state.badgeSettings,
        setSegmentGeometries: state.setSegmentGeometries,
        setTripSegmentsGeometry: state.setTripSegmentsGeometry,
        setVisitedStations: state.setVisitedStations,
        segmentGeometries: state.segmentGeometries,
        isLoginOpen: state.modals.isLoginOpen
    })));

    const { loadUserData, saveData } = useUserData();
    const [stationMenu, setStationMenu] = useState<any>(null);
    const [isExportingKML, setIsExportingKML] = useState(false);
    const isDraggingRef = useRef(false);
    const workerRef = useRef<Worker | null>(null);
    const distanceWorkerRef = useRef<Worker | null>(null);

    // --- Auth & URL Parsing ---
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('token');
        const usernameFromUrl = urlParams.get('username');
        const regTokenFromUrl = urlParams.get('reg_token');
        const status = urlParams.get('status');

        if (tokenFromUrl && usernameFromUrl) {
            // Handle OAuth Login
            useStore.getState().login(tokenFromUrl, usernameFromUrl);
            loadUserData(tokenFromUrl, true);
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (regTokenFromUrl) {
            // Handle GitHub Registration
            setModalState({ githubRegToken: regTokenFromUrl, isGithubRegOpen: true });
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (user?.token) {
            // Handle persistent login state recovery
            loadUserData(user.token, false);
        }

        if (status === 'bound_success') {
            alert("GitHub 绑定成功！");
            window.history.replaceState({}, document.title, window.location.pathname);
            if (user?.token) {
                loadUserData(user.token, false);
            }
        }
    }, []); // Run only on mount

    // --- Worker Setup ---
    useEffect(() => {
        workerRef.current = new GeoWorker();
        distanceWorkerRef.current = new DistanceWorker();

        return () => {
            if (workerRef.current) workerRef.current.terminate();
            if (distanceWorkerRef.current) distanceWorkerRef.current.terminate();
        };
    }, []);

    const callWorker = (type: string, payload: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) return reject("Worker not initialized");
            const id = Date.now() + Math.random().toString();

            const handleMessage = (e: MessageEvent) => {
                if (e.data.id === id) {
                    workerRef.current?.removeEventListener('message', handleMessage);
                    if (e.data.type === `${type}_SUCCESS`) {
                        resolve(e.data.payload);
                    } else if (e.data.type === 'ERROR') {
                        reject(new Error(e.data.payload));
                    }
                }
            };

            workerRef.current.addEventListener('message', handleMessage);
            workerRef.current.postMessage({ id, type, payload });
        });
    };

    // --- Sync Data to Worker ---
    useEffect(() => {
        if (workerRef.current) {
            callWorker('SYNC_DATA', { railwayData, geoData }).catch(console.error);
        }
    }, [railwayData, geoData]);

    // --- 1. Utilities for Parsing and Matching ---
    const normalizeCompanyName = (s: any) => {
        if (!s && s !== 0) return '';
        try {
            return String(s).normalize('NFKC').replace(/\s+/g, ' ').trim();
        } catch (e) {
            return String(s).replace(/\s+/g, ' ').trim();
        }
    };

    const buildCompanyIndex = (companyData: any) => {
        const idx: any = {};
        if (!companyData) return idx;
        Object.keys(companyData).forEach(k => {
            idx[normalizeCompanyName(k)] = k;
        });
        return idx;
    };

    const findBestCompanyKey = (name: string, companyIndex: any) => {
        const n = normalizeCompanyName(name);
        if (!n) return name;
        if (companyIndex[n]) return companyIndex[n];
        for (const keyNorm of Object.keys(companyIndex)) {
            if (!keyNorm) continue;
            if (keyNorm.includes(n) || n.includes(keyNorm) || keyNorm.startsWith(n) || n.startsWith(keyNorm)) return companyIndex[keyNorm];
        }
        return name;
    };

    // --- 2. AutoLoad Logic (Moved from RailRound) ---
    const autoLoadData = async () => {
        try {
            console.log('[Autoload] 正在初始化...');
            let currentCompanyData = {};
            try {
                const companyRes = await fetch('/company_data.json');
                if (companyRes.ok) {
                    const txt = await companyRes.text();
                    currentCompanyData = JSON.parse(txt.replace(/^\uFEFF/, ''));
                    setCompanyDB((prev: any) => ({ ...prev, ...currentCompanyData }));
                    (window as any).__companyData = currentCompanyData;
                }
            } catch (e) { console.warn('[Autoload] company_data.json 加载失败', e); }

            const companyIndex = buildCompanyIndex(currentCompanyData);

            const processGeoJsonBatch = (items: any[], companyData = currentCompanyData) => {
                const newFeatures: any[] = [];
                const railwayUpdates: any = {};

                items.forEach(({ json, company: defaultCompany }) => {
                    if (!json.features) return;
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
                                const info: any = (companyData && (companyData as any)[comp]) || {};
                                const icon = props.icon || info.logo || null;
                                railwayUpdates[lineKey] = {
                                    meta: { region: info.region || "未知", type: info.type || "未知", company: comp, logo: info.logo, icon },
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
                            if (!stations.find((s: any) => s.name_ja === p.name)) {
                                const stationId = p.id || `${comp}:${p.line}:${p.name}`;
                                stations.push({ id: stationId, name_ja: p.name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], transfers: p.transfers || [] });
                            }
                        }
                    });
                });

                if (newFeatures.length > 0) {
                    setGeoData((prev: any) => ({ type: "FeatureCollection", features: [...prev.features, ...newFeatures] }));
                }
                if (Object.keys(railwayUpdates).length > 0) {
                    setRailwayData((prev: any) => {
                        const next = { ...prev };
                        Object.entries(railwayUpdates).forEach(([key, val]: [string, any]) => {
                            if (!next[key]) next[key] = val;
                            else {
                                val.stations.forEach((s: any) => { if (!next[key].stations.find((ex: any) => ex.id === s.id)) next[key].stations.push(s); });
                                if(val.meta.icon && !next[key].meta.icon) next[key].meta.icon = val.meta.icon;
                            }
                        });
                        return next;
                    });
                }
            };

            let cachedFiles: any[] = [];
            let realFiles: any[] = [];
            try {
                const dbInstance = await db.open();

                // 1. Load GeoJSON files
                const txFiles = dbInstance.transaction(db.STORE_FILES, 'readonly');
                const storeFiles = txFiles.objectStore(db.STORE_FILES);
                const reqFiles = storeFiles.getAll();
                cachedFiles = await new Promise((resolve) => {
                    reqFiles.onsuccess = () => resolve(reqFiles.result || []);
                    reqFiles.onerror = () => resolve([]);
                });
                // Attempt to read fully precompiled geoData structure directly (FAST PATH)
                let precompiledGeoData = null;
                try {
                    const txGeo = dbInstance.transaction(db.STORE_FILES, 'readonly');
                    const storeGeo = txGeo.objectStore(db.STORE_FILES);
                    const reqGeo = storeGeo.get('__precompiled_geodata');
                    precompiledGeoData = await new Promise((resolve) => {
                        reqGeo.onsuccess = () => resolve(reqGeo.result || null);
                        reqGeo.onerror = () => resolve(null);
                    });
                } catch(e) {}

                // Exclude '__precompiled_geodata' and 'zustand_railround-storage' from cachedFiles list used for manifest comparison
                realFiles = cachedFiles.filter(f => f.fileName && f.fileName !== '__precompiled_geodata' && !f.fileName.startsWith('zustand_'));

                if (precompiledGeoData && realFiles.length > 0) {
                    // Fast path hit! Skip heavy processing. We assume railwayData is correctly persisted in Zustand.
                    setGeoData(precompiledGeoData);
                    console.log(`[Autoload] 极速命中预编译 GeoData 缓存，跳过繁重的解析步骤`);
                } else if (realFiles.length > 0) {
                    // Fallback to heavy processing and then cache the result
                    processGeoJsonBatch(realFiles, currentCompanyData);
                    // Use setTimeout to allow state to settle before reading it back
                    setTimeout(async () => {
                        const currentGeo = useStore.getState().geoData;
                        if (currentGeo && currentGeo.features.length > 0) {
                            try {
                                 await db.set(db.STORE_FILES, '__precompiled_geodata', currentGeo);
                            } catch(e) {}
                        }
                    }, 100);
                }

                // 2. Pre-load all segment geometries into memory at once to eliminate massive I/O lag
                const txSegments = dbInstance.transaction(db.STORE_SEGMENTS, 'readonly');
                const storeSegments = txSegments.objectStore(db.STORE_SEGMENTS);

                // Using a cursor or getAllKeys/getAll is required.
                // Since STORE_SEGMENTS might use out-of-line keys or we need keys to build the Map.
                // Assuming keys are what we need, let's use a cursor to build the map directly.
                const preloadedGeometries = new Map();
                await new Promise((resolve) => {
                    const reqCursor = storeSegments.openCursor();
                    reqCursor.onsuccess = (e: any) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            preloadedGeometries.set(cursor.key, cursor.value);
                            cursor.continue();
                        } else {
                            resolve(null);
                        }
                    };
                    reqCursor.onerror = () => resolve(null);
                });

                if (preloadedGeometries.size > 0) {
                    setSegmentGeometries(preloadedGeometries);
                    console.log(`[Autoload] 预加载了 ${preloadedGeometries.size} 条行程缩略图缓存`);
                }

            } catch (e) { console.warn('Cache read failed', e); }

            const manifestRes = await fetch('/geojson_manifest.json').catch(() => null);
            if (manifestRes && manifestRes.ok) {
                const manifest = await manifestRes.json();
                const geojsonFiles = manifest.files || [];

                const cachedFileNames = new Set(realFiles.map(f => f.fileName));
                const missingFiles = geojsonFiles.filter((f: string) => !cachedFileNames.has(f.replace(/\.(geojson|json)$/i, '')));

                if (missingFiles.length > 0) {
                    const downloadTasks = missingFiles.map(async (fileName: string) => {
                        try {
                            const res = await fetch(`/geojson/${fileName.includes('.geojson') ? fileName : `${fileName}.geojson`}`);
                            if (!res.ok) throw new Error(`Status ${res.status}`);
                            const json = await res.json();
                            const rawCompanyName = fileName.replace(/\.(geojson|json)$/i, '');
                            const matchedCompany = findBestCompanyKey(rawCompanyName, companyIndex);
                            const dataItem = { json, company: matchedCompany, fileName: rawCompanyName };
                            db.set(db.STORE_FILES, rawCompanyName, dataItem).catch(e => console.warn('Cache write failed', e));
                            return dataItem;
                        } catch (e: any) { return null; }
                    });

                    const results = await Promise.all(downloadTasks);
                    const validResults = results.filter(r => r !== null);
                    if (validResults.length > 0) {
                        processGeoJsonBatch(validResults, currentCompanyData);

                        // Overwrite precompiled geodata cache after updating with new downloaded files.
                        // State updates are async, wait a moment to capture the latest.
                        setTimeout(async () => {
                            const updatedGeo = useStore.getState().geoData;
                            if (updatedGeo && updatedGeo.features.length > 0) {
                                try {
                                    await db.set(db.STORE_FILES, '__precompiled_geodata', updatedGeo);
                                } catch(e) {}
                            }
                        }, 500);
                    }
                }
            }
        } catch (err) { console.error('[Autoload] 致命网络错误, 跳过检查:', err); }

        console.log('[Autoload] 初始化全部完成，应用就绪。');

        // Trigger distance calculation after data load regardless of whether network loaded new files
        if (distanceWorkerRef.current) {
            let toastId: string | null = null;
            const currentRailwayData = useStore.getState().railwayData;

            // Only trigger if we have data and missing distances
            const needsCalc = Object.values(currentRailwayData).some(line =>
               line.stations.length > 1 && line.stations[0].distToNext === undefined
            );

            if (needsCalc) {
                // Using a custom dynamic progress bar toast instead of plain text updates
                toastId = toast.loading(
                    (t: any) => (
                        <div className="flex flex-col gap-2 w-48">
                            <span className="text-sm font-bold text-gray-700">预计算全图站间距... (0%)</span>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: '0%' }}></div>
                            </div>
                        </div>
                    ),
                    { duration: Infinity }
                );

                const handleDistanceWorkerMsg = (e: MessageEvent) => {
                    const { type, payload } = e.data;
                    if (type === 'PROGRESS' && toastId) {
                        toast.loading(
                            (t: any) => (
                                <div className="flex flex-col gap-2 w-48">
                                    <span className="text-sm font-bold text-gray-700">预计算全图站距... ({payload.progress}%)</span>
                                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-200 ease-out" style={{ width: `${payload.progress}%` }}></div>
                                    </div>
                                </div>
                            ),
                            { id: toastId }
                        );
                    } else if (type === 'COMPLETE') {
                        if (toastId) toast.success('站距预计算已缓存', { id: toastId, duration: 3000 });
                        distanceWorkerRef.current?.removeEventListener('message', handleDistanceWorkerMsg);

                        // Merge updated distances into CURRENT railway data instead of overwriting,
                        // to prevent losing data fetched concurrently while the worker was running.
                        setRailwayData(prev => {
                            const next = { ...prev };
                            const updatedData = payload.updatedRailwayData;
                            for (const [lineKey, line] of Object.entries(next)) {
                                if (updatedData[lineKey]) {
                                    next[lineKey] = {
                                        ...line,
                                        stations: line.stations.map((st, idx) => {
                                            const updatedSt = updatedData[lineKey].stations.find((us: any) => us.id === st.id);
                                            return updatedSt ? { ...st, distToNext: updatedSt.distToNext } : st;
                                        })
                                    };
                                }
                            }
                            return next;
                        });
                    }
                };

                distanceWorkerRef.current.addEventListener('message', handleDistanceWorkerMsg);
                distanceWorkerRef.current.postMessage({ type: 'CALC_DISTANCES', payload: { railwayData: currentRailwayData } });
            }
        } else {
            console.warn('Distance Worker not initialized, skipping distance calculations');
        }
    };

    const hasInitializedRef = useRef(false);

    // --- 3. Geo Calculation Effects ---
    useEffect(() => {
        // 使用 setTimeout 加上简单的防抖，防止编辑/添加行程时高频触发导致卡顿
        const timerId = setTimeout(() => {
            const allSegments = trips.flatMap(t => t.segments || []);


            // Extract visited stations logic
            const visited = new Set<string>();
            allSegments.forEach(seg => {
                const line = railwayData[seg.lineKey];
                if (!line) return;

                const fromIdx = line.stations.findIndex(s => s.id === seg.fromId);
                const toIdx = line.stations.findIndex(s => s.id === seg.toId);

                if (fromIdx !== -1 && toIdx !== -1) {
                    const start = Math.min(fromIdx, toIdx);
                    const end = Math.max(fromIdx, toIdx);
                    for (let i = start; i <= end; i++) {
                        visited.add(line.stations[i].id);
                    }
                }
            });
            setVisitedStations(visited);

            // 1. 优先使用已有的缓存进行渲染，保证部分路线立即显示，防止整张地图因为几段缺失而瘫痪。
            const buildRenderList = (cache: Map<string, any>) => {
                const list: any[] = [];
                trips.forEach(trip => {
                    const segs = trip.segments || [];
                    for (let i = 0; i < segs.length; i++) {
                        const seg = segs[i];
                        const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                        const cached = cache.get(key);
                        const line = railwayData[seg.lineKey];
                        const s1 = line?.stations.find((s: any) => s.id === seg.fromId);
                        const s2 = line?.stations.find((s: any) => s.id === seg.toId);

                        if (cached) {
                            list.push({ id: seg.id || key, popup: `${seg.lineKey}: ${s1?.name_ja || seg.fromId} → ${s2?.name_ja || seg.toId}`, ...cached });
                        }

                        // Check for transfer to the next segment
                        if (i < segs.length - 1) {
                            const nextSeg = segs[i + 1];
                            const nextLine = railwayData[nextSeg.lineKey];
                            const nextS1 = nextLine?.stations.find((s: any) => s.id === nextSeg.fromId);

                            // If they are different stations (by id) but part of a continuous trip, we draw a transfer line
                            if (s2 && nextS1 && s2.id !== nextS1.id) {
                                list.push({
                                    id: `transfer_${trip.id}_${i}`,
                                    coords: [[s2.lat, s2.lng], [nextS1.lat, nextS1.lng]],
                                    color: '#9ca3af', // default gray for transfer
                                    isMulti: false,
                                    fallback: false,
                                    isTransfer: true,
                                    popup: `换乘: ${s2.name_ja} → ${nextS1.name_ja}`
                                });
                            }
                        }
                    }
                });
                return list;
            };

            const renderList = buildRenderList(segmentGeometries);
            setTripSegmentsGeometry(renderList);

            // 2. 筛选缺失的数据发送给 Worker
            const needed = allSegments.filter(seg => {
                if (!seg.lineKey || !seg.fromId || !seg.toId) return false;
                return !segmentGeometries.has(`${seg.lineKey}_${seg.fromId}_${seg.toId}`);
            });

            if (needed.length === 0) return;

            const fetchMissing = async () => {
                const newCache = new Map(segmentGeometries);
                let updated = false;
                const toCalculateInWorker: any[] = [];

                // 先尝试从 IndexedDB 加载
                for (const seg of needed) {
                    const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                    let data = await db.get(db.STORE_SEGMENTS, key).catch(() => null);

                // 如果缓存是 fallback，但此时可能 geoData 已经加载好了，
                // 我们允许它重新进入 Worker 计算队列，而不是永远被锁死在 [0,0] 的直线。
                if (data && !data.fallback) {
                        newCache.set(key, data);
                        updated = true;
                    } else {
                        toCalculateInWorker.push(seg);
                    }
                }

            // 如果有需要计算的，且 geoData 已经初步加载，再交给 Worker 计算
            // (如果 geoData 为空，我们先不派发任务，免得算出大量 fallback 写入缓存)
            if (toCalculateInWorker.length > 0 && workerRef.current && geoData && geoData.features.length > 0) {
                    try {
                        const results = await callWorker('GET_ALL_GEOMETRIES', { segments: toCalculateInWorker });
                        for (const res of results) {
                            const { key, data } = res;
                        if (data && !data.fallback) {
                                newCache.set(key, data);
                                await db.set(db.STORE_SEGMENTS, key, data);
                                updated = true;
                            } else {
                            // 对于确实无法匹配的数据，生成一个基于车站经纬度的 fallback，而不是 [0,0]
                            const seg = toCalculateInWorker.find(s => `${s.lineKey}_${s.fromId}_${s.toId}` === key);
                            let fallbackCoords = [[0, 0], [0, 0]];
                            if (seg && railwayData[seg.lineKey]) {
                                const line = railwayData[seg.lineKey];
                                const s1 = line.stations.find((s: any) => s.id === seg.fromId);
                                const s2 = line.stations.find((s: any) => s.id === seg.toId);
                                if (s1 && s2) {
                                    fallbackCoords = [[s1.lat, s1.lng], [s2.lat, s2.lng]];
                                }
                            }
                            const fallbackData = { coords: fallbackCoords, color: '#ff0000', isMulti: false, fallback: true };
                                newCache.set(key, fallbackData);
                            // 将真实的车站连线 fallback 存入 IDB
                                await db.set(db.STORE_SEGMENTS, key, fallbackData);
                                updated = true;
                            }
                        }
                    } catch (e) {
                        console.error("Worker Geo Calc failed:", e);
                    }
                }

                if (updated) {
                    setSegmentGeometries(newCache);

                // 必须在这里同步生成并调用 setTripSegmentsGeometry，
                // 否则首次加载从 IndexedDB 读出的数据将因为 setTimeout/useShallow 导致的依赖丢失而无法触发重新渲染。
                const newRenderList = buildRenderList(newCache);
                setTripSegmentsGeometry(newRenderList);
                }
            };

            fetchMissing();
        }, 300); // 300ms 延时/防抖

        return () => clearTimeout(timerId);
    }, [trips, geoData, railwayData, segmentGeometries]);

    useEffect(() => {
        if (!hasInitializedRef.current) {
            hasInitializedRef.current = true;
            autoLoadData();
        }
    }, []);

    // --- 4. File Handlers ---
    const handleExportKML = async () => {
        if (isExportingKML) return;
        setIsExportingKML(true);
        setTimeout(async () => {
            try {
                if (trips.length === 0 || !geoData) { alert("无行程记录或地图数据未加载。"); setIsExportingKML(false); return; }
                const allPaths: any[] = [];

                // 由于 sliceGeoJsonPath 已移至 Worker，我们需要用另一种方式处理 KML 导出。
                // 最简单的方法是重用现有的 segmentGeometries 缓存！
                trips.forEach(t => {
                    const tripName = `${t.date} - Trip ${t.id}`;
                    t.segments.forEach((seg: any, segIndex: number) => {
                        const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                        const cached = segmentGeometries.get(key);
                        if (cached && cached.coords) {
                            const coords = cached.coords;
                            const kmlCoords = cached.isMulti
                                ? coords.flat().map((p: any) => `${p[1]},${p[0]},0`).join(' ')
                                : coords.map((p: any) => `${p[1]},${p[0]},0`).join(' ');
                            allPaths.push({ name: `${tripName} Segment ${segIndex + 1}`, coordinates: kmlCoords, lineKey: seg.lineKey });
                        }
                    });
                });

                if (allPaths.length === 0) { alert("未找到可导出路径（请确保路线在地图上已显示）。"); setIsExportingKML(false); return; }
                const kmlString = buildKMLString(allPaths);
                const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url; link.download = `RailLOOP_KML_export_${new Date().toISOString().slice(0, 10)}.kml`;
                document.body.appendChild(link); link.click();
                setTimeout(() => { document.body.removeChild(link); window.URL.revokeObjectURL(url); setIsExportingKML(false); }, 2000);
            } catch (e) { console.error("KML Export Error:", e); alert("导出过程中发生错误。"); setIsExportingKML(false); }
        }, 100);
    };

    const handleExportUserData = () => {
        const linesUsed = new Set();
        const companiesUsed = new Set();
        trips.forEach(t => { (t.segments || []).forEach((s: any) => { if(s.lineKey) { linesUsed.add(s.lineKey); const meta = railwayData[s.lineKey]?.meta; if(meta && meta.company) companiesUsed.add(meta.company); } }); });
        const backupData = { meta: { version: CURRENT_VERSION, exportedAt: new Date().toISOString(), appName: "RailLOOP" }, dependencies: { lines: Array.from(linesUsed), companies: Array.from(companiesUsed) }, data: { trips: trips, pins: pins } };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `railround_backup_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    const handleImportUserData = (event: any) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e: any) => {
            try {
                const backup = JSON.parse(e.target.result);
                if (!backup.meta || (backup.meta.appName !== "RailLOOP" && backup.meta.appName !== "")) { alert("无效的备份文件"); return; }
                const missingLines: string[] = [];
                if (backup.dependencies && backup.dependencies.lines) { backup.dependencies.lines.forEach((lineKey: string) => { if (!railwayData[lineKey]) missingLines.push(lineKey); }); }
                if (missingLines.length > 0) { const msg = `检测到缺少以下线路的基础数据，可能会导致显示异常：\n\n${missingLines.slice(0, 5).join(", ")}${missingLines.length > 5 ? '...' : ''}\n\n建议先去地图页面上传对应的 GeoJSON 文件。是否继续导入？`; if (!confirm(msg)) return; }
                const currentTripIds = new Set(trips.map(t => t.id));
                const incomingTrips = backup.data.trips || [];
                const uniqueIncomingTrips: any[] = [];
                const tempTripIds = new Set();
                incomingTrips.forEach((t: any) => { if (!tempTripIds.has(t.id)) { tempTripIds.add(t.id); uniqueIncomingTrips.push(t); } });
                const newTrips = uniqueIncomingTrips.filter(t => !currentTripIds.has(t.id));
                const currentPinIds = new Set(pins.map(p => p.id));
                const incomingPins = backup.data.pins || [];
                const uniqueIncomingPins: any[] = [];
                const tempPinIds = new Set();
                incomingPins.forEach((p: any) => { if (!tempPinIds.has(p.id)) { tempPinIds.add(p.id); uniqueIncomingPins.push(p); } });
                const newPins = uniqueIncomingPins.filter(p => !currentPinIds.has(p.id));
                if (newTrips.length > 0) { setTrips(prev => [...prev, ...newTrips].sort((a,b) => b.date.localeCompare(a.date))); }
                if (newPins.length > 0) { setPins(prev => [...prev, ...newPins]); }
                alert(`数据导入完成！\n\n行程: 新增 ${newTrips.length} 条 (跳过重复/无效 ${incomingTrips.length - newTrips.length} 条)\n图钉: 新增 ${newPins.length} 个 (跳过重复/无效 ${incomingPins.length - newPins.length} 个)`);
            } catch (err) { alert("文件解析失败"); }
        };
        reader.readAsText(file); event.target.value = '';
    };

    const applyCompanyData = (data: any, { silent = true } = {}) => {
        if (!data || typeof data !== 'object') return;
        setCompanyDB((prev: any) => ({ ...prev, ...data }));
        try { (window as any).__companyData = { ...((window as any).__companyData || {}), ...data }; } catch (e) {}
        if (!silent) alert('公司数据库已更新');
    };

    const handleCompanyUpload = (event: any) => {
        const file = event.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (e: any) => { try { const json = JSON.parse(e.target.result); applyCompanyData(json, { silent: false }); } catch(err) { alert("解析失败"); } };
        reader.readAsText(file);
        event.target.value = '';
    };

    const handleFileUpload = async(event: any) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        const readTasks = Array.from(files).map((file: any) => {
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e: any) => {
              try {
                const json = JSON.parse(e.target.result);
                const companyName = file.name.replace(/\.(geojson|json)$/i, "");
                resolve({ json, companyName });
              } catch (err) { alert(`文件 ${file.name} 解析失败，已跳过`); resolve(null); }
            };
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
          });
        });
        try {
          const results = await Promise.all(readTasks);
          const validResults = results.filter(r => r !== null) as any[];
          if (validResults.length === 0) return;

          const newFeatures: any[] = [];
          const railwayUpdates: any = {};
          validResults.forEach(({ json, companyName: defaultCompany }) => {
            if (!json.features) return;
            const enriched = json.features.map((f: any) => ({ ...f, properties: { ...f.properties, company: f.properties.company || f.properties.operator || defaultCompany || "上传数据" } }));
            newFeatures.push(...enriched);
            enriched.forEach((f: any) => {
                 const p = f.properties;
                 const comp = p.company;
                 const ensureLineInTemp = (lineName: string, props: any) => {
                     const lineKey = `${comp}:${lineName}`;
                     if (!railwayUpdates[lineKey]) {
                         const info = ((window as any).__companyData && (window as any).__companyData[comp]) || companyDB[comp] || {};
                         const icon = props.icon || info.logo || null;
                         railwayUpdates[lineKey] = { meta: { region: info.region || "未知", type: info.type || "未知", company: comp, logo: info.logo, icon }, stations: [] };
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
                     if (!stations.find((s: any) => s.name_ja === p.name)) {
                         const stationId = p.id || `${comp}:${p.line}:${p.name}`;
                         stations.push({ id: stationId, name_ja: p.name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], transfers: p.transfers || [] });
                     }
                 }
            });
          });
          if (newFeatures.length > 0) setGeoData((prev: any) => ({ type: "FeatureCollection", features: [...prev.features, ...newFeatures] }));
          if (Object.keys(railwayUpdates).length > 0) {
              setRailwayData((prev: any) => {
                const next = { ...prev };
                Object.entries(railwayUpdates).forEach(([key, val]: [string, any]) => {
                    if (!next[key]) { next[key] = val; }
                    else {
                        val.stations.forEach((s: any) => { if (!next[key].stations.find((ex: any) => ex.id === s.id)) next[key].stations.push(s); });
                        if(val.meta.icon && !next[key].meta.icon) next[key].meta.icon = val.meta.icon;
                    }
                });
                return next;
              });
          }
          alert(`成功导入 ${validResults.length} 个文件！`);
        } catch (err) { alert("文件处理过程中发生未知错误"); }
        finally { event.target.value = ''; }
    };

    return (
        <DragProvider>
            <div className="flex flex-col h-screen bg-slate-100 font-sans text-slate-800 overflow-visible">
                <Toaster position="top-center" />
                <Header
                    handleExportKML={handleExportKML}
                    handleExportUserData={handleExportUserData}
                    handleImportUserData={handleImportUserData}
                    handleCompanyUpload={handleCompanyUpload}
                    handleFileUpload={handleFileUpload}
                />

                <div className="flex-1 relative overflow-hidden flex flex-col">
                    {activeTab === 'records' && <TripsPage />}
                    {activeTab === 'stats' && <StatsPage />}

                    <div className={`flex-1 relative ${activeTab === 'map' ? 'block' : 'hidden'}`}>
                        <MapContainer setStationMenu={setStationMenu} isDraggingRef={isDraggingRef} />
                        <FabButton />
                        <PinEditor />
                    </div>
                </div>

                <TripEditor />

                {/* Global Modals & Components */}
                <LoginModal isOpen={isLoginOpen} onClose={() => setModalState({ isLoginOpen: false })} onLoginSuccess={(data: any) => { useStore.getState().login(data.token, data.username); loadUserData(data.token, true); }} user={user} />
                <GithubRegisterModal />
                <GithubCardModal />
                <FolderManagerModal />
                <AddToFolderModal />

                {stationMenu && (
                    <StationMenu
                        position={stationMenu}
                        stationData={stationMenu.stationData}
                        railwayData={useStore.getState().railwayData}
                        onClose={() => setStationMenu(null)}
                    />
                )}

                <Chest />
                <BottomNav />
            </div>
        </DragProvider>
    );
};
