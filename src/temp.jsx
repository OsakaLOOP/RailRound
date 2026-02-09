import React, { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Layers, Map as MapIcon, PieChart, Train, LogOut, User, Download, Upload, Building2, FilePlus } from 'lucide-react';
import MapComponent from './components/MapComponent';
import Chest from './components/Chest';
import Tutorial from './components/Tutorial';
import { useAuth, useUserData, useGeo, useVersion } from './globalContext';
import { VersionBadge } from './components/VersionBadge';
import buildKMLString from './buildKml';
import { DragProvider } from './components/DragContext';

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { trips, setTrips, pins, setPins, saveData } = useUserData();
  const {
    geoData, setGeoData,
    railwayData, setRailwayData,
    companyDB, setCompanyDB,
    generateKmlData
  } = useGeo();
  const versionInfo = useVersion();
  const CURRENT_VERSION = versionInfo?.currentVer || "Unknown";

  const isMapMode = location.pathname === '/map' || location.pathname === '/' || location.pathname === '/login' || location.pathname.startsWith('/trips/');
  const showMap = isMapMode;

  const [isExportingKML, setIsExportingKML] = useState(false);

  // --- File Logic ---
  const handleExportKML = async () => {
    if (isExportingKML) return;
    setIsExportingKML(true);

    try {
        if (trips.length === 0) {
            alert("无行程记录。");
            setIsExportingKML(false);
            return;
        }

        const allPaths = await generateKmlData(trips);

        if (!allPaths || allPaths.length === 0) {
             alert("未找到可导出路径 (可能是地图数据未加载)。");
             setIsExportingKML(false);
             return;
        }

        const kmlString = buildKMLString(allPaths);

        const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `RailRound_KML_export_${new Date().toISOString().slice(0, 10)}.kml`;
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            setIsExportingKML(false);
        }, 2000);

    } catch (e) {
        console.error("KML Export Error:", e);
        alert("导出过程中发生错误。");
        setIsExportingKML(false);
    }
  };

  const handleExportUserData = () => {
      const linesUsed = new Set();
      const companiesUsed = new Set();
      trips.forEach(t => { (t.segments || []).forEach(s => { if(s.lineKey) { linesUsed.add(s.lineKey); const meta = railwayData[s.lineKey]?.meta; if(meta && meta.company) companiesUsed.add(meta.company); } }); });
      const backupData = { meta: { version: CURRENT_VERSION, exportedAt: new Date().toISOString(), appName: "RailLOOP" }, dependencies: { lines: Array.from(linesUsed), companies: Array.from(companiesUsed) }, data: { trips: trips, pins: pins } };
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `railround_backup_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleImportUserData = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const backup = JSON.parse(e.target.result);
              if (!backup.meta || (backup.meta.appName !== "RailLOOP" && backup.meta.appName !== "")) { alert("无效的备份文件"); return; }
              const missingLines = [];
              if (backup.dependencies && backup.dependencies.lines) { backup.dependencies.lines.forEach(lineKey => { if (!railwayData[lineKey]) missingLines.push(lineKey); }); }
              if (missingLines.length > 0) { const msg = `检测到缺少以下线路的基础数据，可能会导致显示异常：\n\n${missingLines.slice(0, 5).join(", ")}${missingLines.length > 5 ? '...' : ''}\n\n建议先去地图页面上传对应的 GeoJSON 文件。是否继续导入？`; if (!confirm(msg)) return; }

              const currentTripIds = new Set(trips.map(t => t.id));
              const incomingTrips = backup.data.trips || [];
              const uniqueIncomingTrips = [];
              const tempTripIds = new Set();
              incomingTrips.forEach(t => { if (!tempTripIds.has(t.id)) { tempTripIds.add(t.id); uniqueIncomingTrips.push(t); } });
              const newTrips = uniqueIncomingTrips.filter(t => !currentTripIds.has(t.id));

              const currentPinIds = new Set(pins.map(p => p.id));
              const incomingPins = backup.data.pins || [];
              const uniqueIncomingPins = [];
              const tempPinIds = new Set();
              incomingPins.forEach(p => { if (!tempPinIds.has(p.id)) { tempPinIds.add(p.id); uniqueIncomingPins.push(p); } });
              const newPins = uniqueIncomingPins.filter(p => !currentPinIds.has(p.id));

              const finalTrips = [...trips, ...newTrips].sort((a,b) => b.date.localeCompare(a.date));
              const finalPins = [...pins, ...newPins];

              if (newTrips.length > 0) setTrips(finalTrips);
              if (newPins.length > 0) setPins(finalPins);

              if (user) {
                  saveData(finalTrips, finalPins, null, null);
              }

              alert(`数据导入完成！\n\n行程: 新增 ${newTrips.length} 条 (跳过重复/无效 ${incomingTrips.length - newTrips.length} 条)\n图钉: 新增 ${newPins.length} 个 (跳过重复/无效 ${incomingPins.length - newPins.length} 个)`);
          } catch (err) { console.error(err); alert("文件解析失败"); }
      };
      reader.readAsText(file); event.target.value = '';
  };

  const normalizeCompanyName = (s) => {
    if (!s && s !== 0) return '';
    try { return String(s).normalize('NFKC').replace(/\s+/g, ' ').trim(); } catch (e) { return String(s).replace(/\s+/g, ' ').trim(); }
  };

  const handleCompanyUpload = (event) => {
      const file = event.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const json = JSON.parse(e.target.result);
              setCompanyDB(prev => ({ ...prev, ...json }));
              try { window.__companyData = { ...(window.__companyData || {}), ...json }; } catch (e) {}
              alert('公司数据库已更新');
          } catch(err) { alert("解析失败"); }
      };
      reader.readAsText(file);
      event.target.value = '';
  };

  const handleFileUpload = async(event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const readTasks = Array.from(files).map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const json = JSON.parse(e.target.result);
            const companyName = file.name.replace(/\.(geojson|json)$/i, "");
            resolve({ json, companyName });
          } catch (err) {
            console.error(`解析失败: ${file.name}`);
            alert(`文件 ${file.name} 解析失败，已跳过`);
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      });
    });
    try {
      const results = await Promise.all(readTasks);
      const validResults = results.filter(r => r !== null);
      if (validResults.length === 0) return;

      const newFeatures = [];
      const railwayUpdates = {};

      validResults.forEach(({ json, companyName: defaultCompany }) => {
        if (!json.features) return;
        const enriched = json.features.map(f => ({
          ...f, properties: { ...f.properties, company: f.properties.company || f.properties.operator || defaultCompany || "上传数据" }
        }));
        newFeatures.push(...enriched);

        enriched.forEach(f => {
             const p = f.properties;
             const comp = p.company;
             const ensureLineInTemp = (lineName, props) => {
                 const lineKey = `${comp}:${lineName}`;
                 if (!railwayUpdates[lineKey]) {
                     const info = (window.__companyData && window.__companyData[comp]) || companyDB[comp] || {};
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
                 if (!stations.find(s => s.name_ja === p.name)) {
                     const stationId = p.id || `${comp}:${p.line}:${p.name}`;
                     stations.push({ id: stationId, name_ja: p.name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], transfers: p.transfers || [] });
                 }
             }
        });
      });

      if (newFeatures.length > 0) {
          setGeoData(prev => ({ type: "FeatureCollection", features: [...prev.features, ...newFeatures] }));
      }
      if (Object.keys(railwayUpdates).length > 0) {
          setRailwayData(prev => {
            const next = { ...prev };
            Object.entries(railwayUpdates).forEach(([key, val]) => {
                if (!next[key]) { next[key] = val; }
                else {
                    val.stations.forEach(s => { if (!next[key].stations.find(ex => ex.id === s.id)) next[key].stations.push(s); });
                    if(val.meta.icon && !next[key].meta.icon) next[key].meta.icon = val.meta.icon;
                }
            });
            return next;
          });
      }
      alert(`成功导入 ${validResults.length} 个文件！`);
    } catch (err) { console.error(err); alert("文件处理过程中发生未知错误"); }
    finally { event.target.value = ''; }
  };


  return (
    <DragProvider>
      <div className="relative w-full h-full min-h-screen overflow-hidden bg-slate-100 flex flex-col">
       {/* Header */}
       <header className="bg-slate-900 text-white p-4 shadow-md z-30 flex justify-between shrink-0 pointer-events-auto">
        <div id="header-title" className="flex items-center gap-2">
            <Train className="text-emerald-400"/>
            <span className="font-bold">RailLOOP</span>
            <VersionBadge version={CURRENT_VERSION} />
        </div>
        <div className="flex items-center gap-2">
            {user ? (
               <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-300 hidden sm:inline">欢迎, {user.username}</span>
                  <button id="btn-login-user" onClick={logout} className="bg-slate-700 hover:bg-red-900 p-2 rounded text-xs flex items-center gap-1 transition">
                      <LogOut size={14}/><span className="hidden sm:inline">退出</span>
                  </button>
               </div>
            ) : (
               <button onClick={() => navigate('/login')} className="bg-blue-600 hover:bg-blue-500 p-2 rounded text-xs flex items-center gap-1 transition font-bold">
                   <User size={14}/><span className="hidden sm:inline">登录 / 注册</span>
               </button>
            )}

            {location.pathname !== '/map' ? (
            <div id="header-actions" className="flex gap-2 ml-2 border-l border-slate-700 pl-2">
               <button onClick={handleExportKML} disabled={isExportingKML} className="cursor-pointer bg-emerald-700 hover:bg-emerald-600 p-2 rounded text-xs flex items-center gap-1 transition disabled:opacity-50">
                   <Download size={14}/><span className="hidden sm:inline">{isExportingKML ? '导出中...' : '导出 KML'}</span>
               </button>
                <button onClick={handleExportUserData} className="cursor-pointer bg-emerald-900/50 hover:bg-emerald-800 p-2 rounded text-xs flex items-center gap-1 transition">
                    <Download size={14}/>
                </button>
                <label className="cursor-pointer bg-slate-800/50 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition">
                    <Upload size={14}/>
                    <input type="file" accept=".json" className="hidden" onChange={handleImportUserData}/>
                </label>
            </div>
            ) : (
            <div id="header-actions" className="flex gap-2 ml-2 border-l border-slate-700 pl-2">
                <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition"><Building2 size={14}/><span className="hidden sm:inline">数据</span><input type="file" accept=".json" className="hidden" onChange={handleCompanyUpload}/></label>
                <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition"><FilePlus size={14}/><span className="hidden sm:inline">地图</span><input type="file" multiple accept=".geojson,.json" className="hidden" onChange={handleFileUpload}/></label>
            </div>
            )}
        </div>
      </header>


       {/* Map Layer (z-0) */}
       <div
         className={`absolute inset-0 z-0 transition-opacity duration-300 ${showMap ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
       >
         <MapComponent />
       </div>

       {/* Router Layer (z-10) */}
       <div className="absolute inset-0 z-10 pointer-events-none flex flex-col pt-[72px] pb-[60px]">
          {/* Note: Added padding to account for header and footer */}
          <Outlet />
       </div>

       {/* Global UI */}
       <div className="absolute bottom-24 right-4 z-20 pointer-events-auto">
          <Chest />
       </div>

       <Tutorial />

       {/* Navigation Bar (z-30) */}
       <nav className="absolute bottom-0 left-0 right-0 bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30 pointer-events-auto">
            <NavLink id="tab-btn-records" to="/records" className={({isActive}) => `p-2 rounded-lg ${isActive ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>
                <Layers />
            </NavLink>
            <NavLink id="tab-btn-map" to="/map" className={({isActive}) => `p-2 rounded-lg ${isActive ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>
                <MapIcon />
            </NavLink>
            <NavLink id="tab-btn-stats" to="/stats" className={({isActive}) => `p-2 rounded-lg ${isActive ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>
                <PieChart />
            </NavLink>
       </nav>
      </div>
    </DragProvider>
  );
}