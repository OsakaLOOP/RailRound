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
import { db } from './utils/db';
import buildKMLString from './buildKml';
import { sliceGeoJsonPath, calculateLatestStats } from './utils/stats';
import * as turf from '@turf/turf';
import { meta } from '../public/changelog.json';
import { api } from './services/api';

const CURRENT_VERSION = meta["currentVersion"];

export const AppLayout: React.FC = () => {
    const {
        activeTab, user, setModalState, setCompanyDB, setRailwayData, setGeoData,
        trips, pins, railwayData, geoData, companyDB, setTrips, setPins, folders, badgeSettings,
        setSegmentGeometries, setTripSegmentsGeometry, segmentGeometries
    } = useStore(state => ({
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
        segmentGeometries: state.segmentGeometries
    }));

    const [stationMenu, setStationMenu] = useState<any>(null);
    const [isExportingKML, setIsExportingKML] = useState(false);
    const isDraggingRef = useRef(false);

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
            try {
                const dbInstance = await db.open();
                const tx = dbInstance.transaction(db.STORE_FILES, 'readonly');
                const store = tx.objectStore(db.STORE_FILES);
                const req = store.getAll();
                cachedFiles = await new Promise((resolve) => {
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => resolve([]);
                });
                if (cachedFiles.length > 0) processGeoJsonBatch(cachedFiles, currentCompanyData);
            } catch (e) { console.warn('Cache read failed', e); }

            const manifestRes = await fetch('/geojson_manifest.json').catch(() => null);
            if (!manifestRes || !manifestRes.ok) return;
            const manifest = await manifestRes.json();
            const geojsonFiles = manifest.files || [];

            const cachedFileNames = new Set(cachedFiles.map(f => f.fileName));
            const missingFiles = geojsonFiles.filter((f: string) => !cachedFileNames.has(f.replace(/\.(geojson|json)$/i, '')));

            if (missingFiles.length === 0) return;

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
            if (validResults.length > 0) processGeoJsonBatch(validResults, currentCompanyData);

        } catch (err) { console.error('[Autoload] 致命错误:', err); }
    };

    // --- 3. Geo Calculation Effects (Moved from RailRound) ---
    useEffect(() => {
        const allSegments = trips.flatMap(t => t.segments || []);
        const needed = allSegments.filter(seg => {
            if (!seg.lineKey || !seg.fromId || !seg.toId) return false;
            return !segmentGeometries.has(`${seg.lineKey}_${seg.fromId}_${seg.toId}`);
        });

        if (needed.length === 0) {
            const geometryList = allSegments.map(seg => {
                const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                const cached = segmentGeometries.get(key);
                const line = railwayData[seg.lineKey];
                const s1 = line?.stations.find(s => s.id === seg.fromId);
                const s2 = line?.stations.find(s => s.id === seg.toId);
                if (cached) return { id: seg.id || key, popup: `${seg.lineKey}: ${s1?.name_ja || seg.fromId} → ${s2?.name_ja || seg.toId}`, ...cached };
                return null;
            }).filter(Boolean);
            setTripSegmentsGeometry(geometryList);
            return;
        }

        const fetchMissing = async () => {
            const newCache = new Map(segmentGeometries);
            let updated = false;

            for (const seg of needed) {
                const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                let data = await db.get(db.STORE_SEGMENTS, key).catch(() => null);

                if (!data) {
                    if (!geoData || !geoData.features) continue;
                    const line = railwayData[seg.lineKey];
                    if (!line) continue;
                    const s1 = line.stations.find(s => s.id === seg.fromId);
                    const s2 = line.stations.find(s => s.id === seg.toId);
                    if (!s1 || !s2) continue;

                    const parts = seg.lineKey.split(':');
                    const company = parts[0];
                    const lineName = parts.slice(1).join(':');

                    const feature = geoData.features.find((f: any) => f.properties.type === 'line' && f.properties.name === lineName && f.properties.company === company);

                    let coords = null; let color = '#38bdf8'; let isMulti = false; let fallback = false;

                    if (feature) {
                        color = feature.properties.stroke || '#38bdf8';
                        const latLngs = sliceGeoJsonPath(feature, s1.lat, s1.lng, s2.lat, s2.lng);
                        if (latLngs) {
                            coords = latLngs;
                            if (Array.isArray(latLngs[0]) && Array.isArray(latLngs[0][0])) isMulti = true;
                        }
                    }

                    if (!coords) {
                         fallback = true;
                         const routeCoords = [];
                         const startIdx = line.stations.findIndex(st => st.id === seg.fromId);
                         const endIdx = line.stations.findIndex(st => st.id === seg.toId);
                         if (startIdx !== -1 && endIdx !== -1) {
                             const step = startIdx <= endIdx ? 1 : -1;
                             for (let i = startIdx; i !== endIdx + step; i += step) {
                                if (i >= 0 && i < line.stations.length) routeCoords.push([line.stations[i].lat, line.stations[i].lng]);
                             }
                             if (routeCoords.length > 1) { coords = routeCoords; fallback = false; }
                         }
                    }
                    if (!coords) { coords = [[s1.lat, s1.lng], [s2.lat, s2.lng]]; fallback = true; }

                    data = { coords, color, isMulti, fallback };
                    await db.set(db.STORE_SEGMENTS, key, data);
                }

                if (data) { newCache.set(key, data); updated = true; }
            }

            if (updated) setSegmentGeometries(newCache);
        };

        fetchMissing();
    }, [trips, geoData, railwayData, segmentGeometries]);

    useEffect(() => { autoLoadData(); }, []);

    // --- 4. File Handlers ---
    const handleExportKML = async () => {
        if (isExportingKML) return;
        setIsExportingKML(true);
        setTimeout(async () => {
            try {
                if (trips.length === 0 || !geoData || !turf) { alert("无行程记录或地图数据未加载。"); setIsExportingKML(false); return; }
                const allPaths: any[] = [];
                trips.forEach(t => {
                    const tripName = `${t.date} - Trip ${t.id}`;
                    t.segments.forEach((seg: any, segIndex: number) => {
                        const line = railwayData[seg.lineKey];
                        if (!line) return;
                        const s1 = line.stations.find(s => s.id === seg.fromId);
                        const s2 = line.stations.find(s => s.id === seg.toId);
                        if (!s1 || !s2) return;
                        const parts = seg.lineKey.split(':');
                        const company = parts[0];
                        const lineName = parts.slice(1).join(':');
                        const feature = geoData.features.find((f: any) => f.properties.type === 'line' && f.properties.name === lineName && f.properties.company === company);
                        if (feature) {
                            const coords = sliceGeoJsonPath(feature, s1.lat, s1.lng, s2.lat, s2.lng);
                            if (coords) {
                                const kmlCoords = Array.isArray(coords[0]) && Array.isArray(coords[0][0]) ? coords.flat().map((p: any) => `${p[1]},${p[0]},0`).join(' ') : coords.map((p: any) => `${p[1]},${p[0]},0`).join(' ');
                                allPaths.push({ name: `${tripName} Segment ${segIndex + 1}`, coordinates: kmlCoords, lineKey: seg.lineKey });
                            }
                        }
                    });
                });
                if (allPaths.length === 0) { alert("未找到可导出路径。"); setIsExportingKML(false); return; }
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
                <LoginModal isOpen={useStore.getState().modals.isLoginOpen} onClose={() => setModalState({ isLoginOpen: false })} onLoginSuccess={(data: any) => { useStore.getState().login(data.token, data.username); }} />
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
