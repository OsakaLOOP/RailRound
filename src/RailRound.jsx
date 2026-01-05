import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import  buildKMLString  from './buildKml';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
// Quick import-time log to ensure the module loads when Vite imports it.
try { console.log('[iconfixed] module loaded'); } catch (e) {}
import { 
  Train, Calendar, Navigation, Map as MapIcon, Layers, Upload, Plus, Edit2, Trash2, 
  PieChart, TrendingUp, MapPin, Save, X, Camera, MessageSquare, Move, Magnet, CheckCircle2, FilePlus, ArrowDown, Search, Building2, AlertTriangle, Loader2, Download, ListFilter,
  LogOut, User, Github
} from 'lucide-react';
import { LoginModal } from './components/LoginModal';
import { api } from './services/api';
import { db } from './utils/db';

// --- 1. 样式与配置 ---
const LEAFLET_CSS = `
  .leaflet-container { width: 100%; height: 100%; z-index: 0; background: #222; }
  .leaflet-popup-content-wrapper { border-radius: 8px; font-family: sans-serif; }
  .station-marker { background: white; border: 2px solid #6b7280; border-radius: 50%; width: 8px; height: 8px; }
  .station-marker-visited { background: #10b981; border-color: #065f46; width: 10px; height: 10px; }
  .pin-marker-icon { background: transparent; border: none; }
  .pin-content {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border: 2px solid white; border-radius: 50% 50% 0 50%;
    transform: rotate(45deg); box-shadow: 2px 2px 4px rgba(0,0,0,0.3); transition: transform 0.2s;
  }
  .pin-content:hover { transform: rotate(45deg) scale(1.1); }
  .pin-content.dragging { transform: rotate(45deg) scale(1.2); box-shadow: 4px 4px 12px rgba(0,0,0,0.5); cursor: grabbing; }
  .pin-icon { transform: rotate(-45deg); color: white; }
  
  .line-icon { height: 1.2em; width: auto; vertical-align: text-bottom; margin-right: 4px; display: inline-block; object-fit: contain; }
  .company-logo-sm { height: 1.5em; width: auto; object-fit: contain; margin-right: 6px; }
  
  @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .animate-slide-up { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-fade-in { animation: fadeIn 0.2s ease-out forwards; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  /* 新干线过场动画 - 极速通过版 */
  @keyframes trainFlyBy {
    0% { transform: translateX(120%) skewX(-20deg); }
    100% { transform: translateX(-150%) skewX(-20deg); }
  }
  
  .train-animation-layer {
    position: absolute; inset: 0; 
    background: rgba(255,255,255,0.8); 
    backdrop-filter: blur(4px);
    z-index: 60; 
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  
  .train-body {
    width: 600px; height: auto;
    animation: trainFlyBy 0.8s cubic-bezier(0.45, 0, 0.55, 1) forwards; 
    filter: drop-shadow(20px 10px 15px rgba(0,0,0,0.15));
  }
  
  .speed-line {
    position: absolute; height: 4px; background: linear-gradient(90deg, transparent, #3b82f6, transparent); border-radius: 2px;
    animation: speedLineAnim 0.4s linear infinite;
    opacity: 0.6;
  }
  @keyframes speedLineAnim {
    0% { transform: translateX(100px); width: 0; opacity: 0; }
    50% { opacity: 1; width: 200px; }
    100% { transform: translateX(-500px); width: 0; opacity: 0; }
  }
`;

const COLOR_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#64748b'];

// --- 2. 核心算法 (Integrated) ---
// 辅助：计算两点间直线距离 (Haversine Formula)
const calcDist = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // 地球半径 km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const distSq = (x1, y1, x2, y2) => (x1-x2)**2 + (y1-y2)**2;

// 辅助：计算点到线段的最近投影点
const getProjectedPointOnSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return { x: ax, y: ay, t: 0 };

  // 投影系数 t
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  // 限制在线段两端 [0, 1]
  t = Math.max(0, Math.min(1, t));

  return {
    x: ax + t * dx, // lng
    y: ay + t * dy, // lat
    t: t
  };
};

const getCoordinates = (geometry) => {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return geometry.coordinates;
    if (geometry.type === 'MultiLineString') return geometry.coordinates.flat(); 
    return [];
};

// [New] 路径缝合算法: 将乱序的 MultiLineString 缝合成连续的 LineString
const stitchRoutes = (turf, multiCoords, startPt) => {
  let pool = multiCoords.map((coords, i) => {
    if (!coords || coords.length < 2) return null;
    return {
      id: i,
      coords: coords,
      head: turf.point(coords[0]),
      tail: turf.point(coords[coords.length - 1])
    };
  }).filter(Boolean);

  if (pool.length === 0) return [];
  if (pool.length === 1) return pool[0].coords;

  let seedIdx = -1;
  let minSeedDist = Infinity;
    
  pool.forEach((seg, i) => {
    const line = turf.lineString(seg.coords);
    const dist = turf.pointToLineDistance(startPt, line);
    if (dist < minSeedDist) { minSeedDist = dist; seedIdx = i; }
  });

  if (seedIdx === -1) seedIdx = 0; 

  let pathSegments = [pool[seedIdx]];
  pool.splice(seedIdx, 1);

  while (pool.length > 0) {
    const currentHeadCoords = pathSegments[0].coords;
    const currentTailCoords = pathSegments[pathSegments.length - 1].coords;
        
    const pathHeadPt = turf.point(currentHeadCoords[0]);
    const pathTailPt = turf.point(currentTailCoords[currentTailCoords.length - 1]);

    let bestMatchIdx = -1;
    let minDist = Infinity;
    let matchType = ''; 

    for (let i = 0; i < pool.length; i++) {
      const seg = pool[i];
      const d_Tail_Start = turf.distance(pathTailPt, seg.head); 
      const d_Tail_End   = turf.distance(pathTailPt, seg.tail); 
      const d_Head_End   = turf.distance(pathHeadPt, seg.tail); 
      const d_Head_Start = turf.distance(pathHeadPt, seg.head); 

      if (d_Tail_Start < minDist) { minDist = d_Tail_Start; bestMatchIdx = i; matchType = 'tail-start'; }
      if (d_Tail_End < minDist)   { minDist = d_Tail_End;   bestMatchIdx = i; matchType = 'tail-end'; }
      if (d_Head_End < minDist)   { minDist = d_Head_End;   bestMatchIdx = i; matchType = 'head-end'; }
      if (d_Head_Start < minDist) { minDist = d_Head_Start; bestMatchIdx = i; matchType = 'head-start'; }
    }

    if (bestMatchIdx !== -1) {
      const seg = pool[bestMatchIdx];
      if (matchType === 'tail-start') {
        pathSegments.push(seg);
      } else if (matchType === 'tail-end') {
        seg.coords.reverse();
        const temp = seg.head; seg.head = seg.tail; seg.tail = temp;
        pathSegments.push(seg);
      } else if (matchType === 'head-end') {
        pathSegments.unshift(seg);
      } else if (matchType === 'head-start') {
        seg.coords.reverse();
        const temp = seg.head; seg.head = seg.tail; seg.tail = temp;
        pathSegments.unshift(seg);
      }
      pool.splice(bestMatchIdx, 1);
    } else {
      break; 
    }
  }

  let flatCoords = [];
  pathSegments.forEach(seg => {
    flatCoords.push(...seg.coords);
  });
  return flatCoords;
};

// [Turf.js] 轨迹切分算法
const sliceGeoJsonPath = (feature, startLat, startLng, endLat, endLng) => {
    if (!turf || !feature || !feature.geometry) return null;

    try {
      let line = feature;
      const startPt = turf.point([startLng, startLat]);
      const endPt = turf.point([endLng, endLat]);

      // If MultiLineString, attempt to stitch segments into a sensible continuous path
      if (feature.geometry.type === 'MultiLineString') {
         const multiCoords = feature.geometry.coordinates;
         const stitchedCoords = stitchRoutes(turf, multiCoords, startPt);
         if (stitchedCoords && stitchedCoords.length > 0) {
           line = turf.lineString(stitchedCoords);
         } else {
           const flatCoords = feature.geometry.coordinates.flat();
           line = turf.lineString(flatCoords);
         }
      }

      // 1. 吸附 (Snap)
      const snappedStart = turf.nearestPointOnLine(line, startPt);
      const snappedEnd = turf.nearestPointOnLine(line, endPt);

        const startIdx = snappedStart.properties.index;
        const endIdx = snappedEnd.properties.index;
        
        // 2. 环线检测
        const coords = line.geometry.coordinates;
        const firstPt = coords[0];
        const lastPt = coords[coords.length - 1];
        const isLoop = turf.distance(turf.point(firstPt), turf.point(lastPt)) < 0.5;

        // 3. 切分
        let resultCoords = [];

        if (!isLoop) {
            const sliced = turf.lineSlice(snappedStart, snappedEnd, line);
            resultCoords = sliced.geometry.coordinates;
        } else {
            const sliceDirect = turf.lineSlice(snappedStart, snappedEnd, line);
            const lenDirect = turf.length(sliceDirect);
            
            const sliceToTail = turf.lineSlice(snappedStart, turf.point(lastPt), line);
            const sliceFromHead = turf.lineSlice(turf.point(firstPt), snappedEnd, line);
            const lenWrap = turf.length(sliceToTail) + turf.length(sliceFromHead);

            if (lenDirect <= lenWrap) {
                resultCoords = sliceDirect.geometry.coordinates;
            } else {
                const c1 = sliceToTail.geometry.coordinates.map(p => [p[1], p[0]]);
                const c2 = sliceFromHead.geometry.coordinates.map(p => [p[1], p[0]]);
                return [c1, c2]; // MultiPolyline
            }
        }
        return resultCoords.map(p => [p[1], p[0]]); // Leaflet [lat, lng]
    } catch (e) {
        console.warn("Turf slice failed:", e);
        return null;
    }
};

// [Custom] 高精度吸附算法 (无需 Turf, 纯几何计算投影)
const findNearestPointOnLine = (railwayData, targetLat, targetLng) => {
  let minDistSq = Infinity;
  let bestPoint = { lat: targetLat, lng: targetLng, lineKey: '', percentage: 0 };
  
  Object.entries(railwayData).forEach(([lineKey, line]) => {
    const stations = line.stations;
    if (!stations || stations.length < 2) return;
    
    // 遍历所有相邻站点构成的线段
    for (let i = 0; i < stations.length - 1; i++) {
      const A = stations[i];
      const B = stations[i+1];

      // 计算投影点
      const proj = getProjectedPointOnSegment(targetLng, targetLat, A.lng, A.lat, B.lng, B.lat);

      // 计算距离平方 (用于比较)
      const dSq = (targetLat - proj.y) ** 2 + (targetLng - proj.x) ** 2;

      if (dSq < minDistSq) {
        minDistSq = dSq;
        bestPoint = { 
            lat: proj.y, 
            lng: proj.x, 
            lineKey: lineKey, 
            // 简单估算百分比
            percentage: Math.round((i / stations.length) * 100) 
        };
      }
    }
  });
  
  // 阈值检查 (约 10km)
  if (minDistSq > 0.01) {
      return { lat: targetLat, lng: targetLng, lineKey: '', percentage: 0 };
  }

  return bestPoint;
};

const isCompanyCompatible = (meta1, meta2) => {
  if (!meta1 || !meta2) return false;
  if (meta1.company === meta2.company && meta1.company !== "上传数据" && meta1.company !== "未知") return true;
  if (meta1.type === 'JR' && meta2.type === 'JR') return true;
  return false;
};

const getTransferableLines = (station, currentLineKey, railwayData, strictMode = true) => {
    if (!station) return [];
    const currentMeta = railwayData[currentLineKey]?.meta;
    if (!currentMeta) return [];
    const validLines = new Set();
    
    if (station.transfers && Array.isArray(station.transfers)) {
        station.transfers.forEach(lineKey => {
            if (railwayData[lineKey]) {
                const nextMeta = railwayData[lineKey].meta;
                if (!strictMode || isCompanyCompatible(currentMeta, nextMeta)) {
                    validLines.add(lineKey);
                }
            }
        });
    }

    Object.keys(railwayData).forEach(lineKey => {
        if (lineKey === currentLineKey) return;
        if (validLines.has(lineKey)) return;
        const nextMeta = railwayData[lineKey].meta;
        if (strictMode && !isCompanyCompatible(currentMeta, nextMeta)) return;
        const sameNameStation = railwayData[lineKey].stations.find(s => s.name_ja === station.name_ja);
        if (sameNameStation) {
            const dist = calcDist(station.lat, station.lng, sameNameStation.lat, sameNameStation.lng);
            if (dist < 2.0) validLines.add(lineKey);
        }
    });
    return Array.from(validLines);
};


const findRoute = (startLineKey, startStId, endLineKey, endStId, railwayData) => {
    if (!startLineKey || !endLineKey) return { error: "无效的起点或终点" };
    const getStName = (line, id) => railwayData[line]?.stations.find(s => s.id === id)?.name_ja;
    const startName = getStName(startLineKey, startStId);
    const endName = getStName(endLineKey, endStId);
    if (!startName || !endName) return { error: "找不到车站信息" };

    // 判断是否为新干线
    const isShinkansen = (lineKey) => {
        const lineName = lineKey.includes(':') ? lineKey.split(':').slice(1).join(':') : lineKey;
        return lineName.includes('新幹線');
    };

    // 优先级评分：新干线优先，然后按路径长度
    const getPriority = (path, isEnd = false) => {
        let score = path.length; // 基础分：路径越短优先级越高（越小越优）
        const shinkansenCount = path.filter(l => isShinkansen(l)).length;
        score -= shinkansenCount * 10; // 新干线加权：每条新干线减10，优先级更高
        if (isEnd) score -= 100; // 到达目标时最高优先级
        return score;
    };

    const queue = [{ line: startLineKey, path: [startLineKey] }];
    const visitedLines = new Set([startLineKey]);
    let foundLinePath = null;
    const MAX_DEPTH = 15; 

    while (queue.length > 0) {
        // 从队列中找出优先级最高的（分数最低）
        let minIdx = 0;
        for (let i = 1; i < queue.length; i++) {
            const currentPriority = getPriority(queue[i].path);
            const minPriority = getPriority(queue[minIdx].path);
            if (currentPriority < minPriority) minIdx = i;
        }
        const { line, path } = queue.splice(minIdx, 1)[0];

        if (path.length > MAX_DEPTH) continue;
        if (line === endLineKey) { foundLinePath = path; break; }
        
        const currentStations = railwayData[line].stations;
        const potentialNextLines = new Set();
        currentStations.forEach(st => {
            const transferLines = getTransferableLines(st, line, railwayData, false);
            transferLines.forEach(l => potentialNextLines.add(l));
        });

        potentialNextLines.forEach(nextLine => {
            if (!visitedLines.has(nextLine)) {
                visitedLines.add(nextLine);
                queue.push({ line: nextLine, path: [...path, nextLine] });
            }
        });
    }

    if (!foundLinePath) return { error: "未找到连通路径。" };

    const segments = [];
    let currentStName = startName;
    for (let i = 0; i < foundLinePath.length; i++) {
        const currentLineKey = foundLinePath[i];
        const nextLineKey = foundLinePath[i+1];
        let nextStName = endName;
        if (nextLineKey) {
            const currSts = railwayData[currentLineKey].stations;
            const nextLineData = railwayData[nextLineKey];
            let transferSt = currSts.find(s => {
                if (s.transfers && s.transfers.includes(nextLineKey)) return true;
                const match = nextLineData.stations.find(ns => ns.name_ja === s.name_ja);
                if (match) return calcDist(s.lat, s.lng, match.lat, match.lng) < 2.0;
                return false;
            });
            if (!transferSt) return { error: "换乘站计算错误" };
            nextStName = transferSt.name_ja;
        }
        const lineObj = railwayData[currentLineKey];
        const fromSt = lineObj.stations.find(s => s.name_ja === currentStName);
        const toSt = lineObj.stations.find(s => s.name_ja === nextStName);
        if (fromSt && toSt && fromSt.id !== toSt.id) {
            segments.push({ id: Date.now() + i, lineKey: currentLineKey, fromId: fromSt.id, toId: toSt.id });
        }
        currentStName = nextStName;
    }
    return { segments };
};

// --- 3. 提取子组件 ---
const LineSelector = ({ isOpen, onClose, onSelect, railwayData, allowedLines }) => {
    const [activeTab, setActiveTab] = useState('JR'); 
    const [selectedRegion, setSelectedRegion] = useState('all');
    
    const normalizeRegion = (region) => {
        if (region === '北海道' || region === '東北') return '北海道・東北';
        if (region === '九州' || region === '沖縄' || region === '九州・沖縄') return '九州・沖縄';
        return region || '其他';
    };

    const { groups } = useMemo(() => {
        const groups = { JR: {}, Private: {}, City: {} };
        Object.keys(railwayData).forEach(key => {
            if (allowedLines && !allowedLines.includes(key)) return;
            const line = railwayData[key];
            const { region, type, company, logo, icon } = line.meta;
            let category = 'City';
            if (type === 'JR') category = 'JR';
            else if (type === '私鉄'||type === '第三セクター') category = 'Private';
            const normRegion = normalizeRegion(region);
            if (!groups[category][normRegion]) groups[category][normRegion] = {};
            const compKey = company || '其他';
            if (!groups[category][normRegion][compKey]) groups[category][normRegion][compKey] = { logo, lines: [] };
            groups[category][normRegion][compKey].lines.push({ key, icon });
        });
        
        Object.values(groups).forEach(regionGroup => {
            Object.values(regionGroup).forEach(companyGroup => {
                Object.values(companyGroup).forEach(companyData => {
                   // 辅助：判断线路是否有自身的线路 logo（而非仅为公司 logo）
                   const hasLineLogo = (lineKey) => {
                     const meta = railwayData[lineKey]?.meta || {};
                     // 只有在明确为线路级别的字段存在且与公司 logo 不相同时，才认为是线路 logo
                     // 优先判断常用的线路图标字段
                     if (meta.icon && companyData && meta.icon !== companyData.logo) return true;
                     return false;
                   };
                    const company = companyData.lines.length > 0 ? (railwayData[companyData.lines[0].key]?.meta.company || '') : '';
                   companyData.lines.sort((a, b) => {
                     // 从 "company:line" 格式提取线路名称用于排序
                     const getLineName = (key) => key.includes(':') ? key.split(':').slice(1).join(':') : key;
                     const aName = getLineName(a.key);
                     const bName = getLineName(b.key);
                     const jrEastLines = {
                        // JR East (首都圈主要线路)
                        "東海道線": "JT",
                        "横須賀線": "JO",
                        "京浜東北線": "JK",
                        "横浜線": "JH",
                        "南武線": "JN",
                        "鶴見線": "JI",
                        "山手線": "JY",
                        "中央線": "JC",
                        "五日市線": "JC1",
                        "総武線": "JB",
                        "宇都宮線": "JU",
                        "埼京線": "JA",
                        "常磐線": "JJ",
                        "千代田線": "JL",
                        "京葉線": "JE",
                        "武蔵野線": "JM",
                        "湘南新宿ライン": "JS",
                        "中央本線": "CO",
                        "篠ノ井線": "SN",
                     };
                     const jrWestLines = {
                          // JR West (近畿圈, JR-前缀已移除)
                          "東海道線": "A",
                          "湖西線": "B",
                          "奈良線": "D",
                          "嵯峨野線": "E",
                          "おおさか東線": "F",
                          "宝塚線": "G",
                          "東西線": "H",
                          "大阪環状線": "O",
                          "桜島線": "P",
                          "大和路線": "Q",
                          "阪和線": "R",
                          "関西空港線": "S",
                     };
                    const jrCentralLines = {
                        "東海道線": "CA",
                        "御殿場線": "CB",
                        "身延線": "CC",
                        "飯田線": "CD",
                        "武豊線": "CE",
                        "中央線": "CF",
                        "高山本線": "CG",
                        "太多線": "CI",
                        "関西本線": "CJ"
                    };
                    const jrKyushuLines = {
                        "山陽本線": "JA",
                        "鹿児島本線": "JB",
                        "福北ゆたか線": "JC",
                        "香椎線": "JD",
                        "若松線": "JE",
                        "日豊本線": "JF",
                        "原田線": "JG",
                        "長崎本線": "JH",
                        "日田彦山線": "JI",
                        "後藤寺線": "JJ",
                        "筑肥線": "JK"
                    };
                    const abbrMap = {
                      "JR東日本": jrEastLines,
                      "JR西日本": jrWestLines,
                      "JR東海": jrCentralLines,
                      "JR九州": jrKyushuLines
                    };
                    // 1) 新干线优先
                    const aIsShinkansen = aName.includes('新幹線');
                    const bIsShinkansen = bName.includes('新幹線');

                    // 2) 有线路级 logo 的线路靠前
                    const aHasLineLogo = hasLineLogo(a.key);
                    const bHasLineLogo = hasLineLogo(b.key);

                    // final decision
                    let result = 0;
                    if (aIsShinkansen !== bIsShinkansen) {
                      result = aIsShinkansen ? -1 : 1;
                    } else if (aHasLineLogo !== bHasLineLogo) {
                      result = aHasLineLogo ? -1 : 1;
                    } else if (aHasLineLogo && bHasLineLogo) {
                      //compare in currrent company's lines order
                      if (abbrMap[company] && abbrMap[company][aName] && abbrMap[company][bName]){
                        result = abbrMap[company][aName] .localeCompare(abbrMap[company][bName]);
                        console.log(`Comparing ${aName} and ${bName} in company ${company}: ${abbrMap[company][aName]} vs ${abbrMap[company][bName]} =>  ${result}`);
                      } else {
                        result = aName.localeCompare(bName, 'ja');             
                      }
                    }
                    else {
                      result = aName.localeCompare(bName, 'ja');
                    }
                    
                    return result;
                   });
                });
            });
        });

        return { groups };
    }, [railwayData, allowedLines]);

    const regionsForActiveTab = useMemo(() => {
        if (!groups[activeTab]) return ['all'];
        const regs = Object.keys(groups[activeTab]);
        const order = ['北海道・東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄', '其他'];
        regs.sort((a, b) => {
            const idxA = order.indexOf(a);
            const idxB = order.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return idxA !== -1 ? -1 : 1;
        });
        return ['all', ...regs];
    }, [groups, activeTab]);

    useEffect(() => {
        if (!regionsForActiveTab.includes(selectedRegion)) setSelectedRegion('all');
    }, [activeTab, regionsForActiveTab]);

    if (!isOpen) return null;
    const currentRegionData = groups[activeTab];

    return (
        <div className="fixed inset-0 z-[600] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-2xl max-h-[85vh] h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up ring-1 ring-black/5" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800"><MapIcon size={20}/> 选择线路</h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                <div className="flex border-b bg-white shrink-0">
                    {['JR', 'Private', 'City'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}>{tab === 'JR' ? 'JR 集団' : tab === 'Private' ? '私鉄・第三セクター' : '地下鉄・新交通'}</button>
                    ))}
                </div>
                <div className="p-2 border-b bg-white overflow-x-auto flex gap-2 shrink-0 no-scrollbar">
                    {regionsForActiveTab.length > 1 ? (regionsForActiveTab.map(r => (<button key={r} onClick={() => setSelectedRegion(r)} className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${selectedRegion === r ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{r === 'all' ? '全部地域' : r}</button>))) : (<span className="text-xs text-gray-400 px-2 py-1">无地域分类</span>)}
                </div>
                <div className="flex-1 overflow-y-auto bg-gray-50">
                    {(!currentRegionData || Object.keys(currentRegionData).length === 0) ? (
                        <div className="text-center text-gray-400 py-10">无符合条件的线路</div>
                    ) : (
                        Object.keys(currentRegionData).map(region => {
                            if (selectedRegion !== 'all' && selectedRegion !== region) return null;
                            return (
                                <div key={region} className="relative">
                                    <div className="sticky top-0 z-10 bg-gray-100/95 backdrop-blur border-y border-gray-200 px-4 py-1.5">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{region}</h4>
                                    </div>
                                    <div className="p-4 grid gap-4">
                                        {Object.entries(currentRegionData[region]).map(([company, data]) => (
                                            <div key={company} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                                                    {data.logo ? (<img src={data.logo} alt="" className="company-logo-sm h-5 w-auto" />) : (<Building2 size={16} className="text-gray-400"/>)}
                                                    <span className="font-bold text-sm text-gray-700">{company}</span>
                                                </div>
                                                <div className="divide-y divide-gray-50">
                                                    {data.lines.map(line => {
                                                        // 从 "company:line" 格式提取线路名称用于显示
                                                        const displayName = line.key.includes(':') ? line.key.split(':').slice(1).join(':') : line.key;
                                                        return (
                                                        <button key={line.key} onClick={() => { onSelect(line.key); onClose(); }} className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group">
                                                            {line.icon ? (<img src={line.icon} alt="" className="line-icon" />) : (
                                                                data.logo ? <img src={data.logo} alt="" className="line-icon opacity-50 grayscale" /> : <Train size={14} className="text-gray-300 group-hover:text-blue-400"/>
                                                            )}
                                                            {displayName}
                                                        </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

const TripEditor = ({ 
  isOpen, onClose, isEditing, form, setForm, onSave, 
  railwayData, editorMode, setEditorMode, 
  autoForm, setAutoForm, onAutoSearch, isRouteSearching 
}) => {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorTarget, setSelectorTarget] = useState(null); 
  const [allowedLines, setAllowedLines] = useState(null); 

  if (!isOpen) return null;

  const openSelector = (targetType, index = null, allowed = null) => {
      setSelectorTarget({ type: targetType, index });
      setAllowedLines(allowed);
      setSelectorOpen(true);
  };

  const handleLineSelect = (lineKey) => {
      if (!selectorTarget) return;
      const { type, index } = selectorTarget;
      
      if (type === 'segment') {
          setForm(prev => {
              const newSegs = [...prev.segments];
              const seg = { ...newSegs[index], lineKey, fromId: '', toId: '' };
              if (index > 0) {
                  const prevSeg = newSegs[index - 1];
                  const prevLineData = railwayData[prevSeg.lineKey];
                  const prevEndSt = prevLineData?.stations.find(s => s.id === prevSeg.toId);
                  if (prevEndSt) {
                      const newLineData = railwayData[lineKey];
                      const startSt = newLineData.stations.find(s => s.name_ja === prevEndSt.name_ja);
                      if (startSt) seg.fromId = startSt.id;
                  }
              }
              newSegs[index] = seg;
              return { ...prev, segments: newSegs };
          });
      } else if (type === 'autoStart') {
          setAutoForm(prev => ({ ...prev, startLine: lineKey, startStation: '' }));
      } else if (type === 'autoEnd') {
          setAutoForm(prev => ({ ...prev, endLine: lineKey, endStation: '' }));
      }
  };

  const addSegment = () => {
    if (form.segments.length >= 10) { alert("最多 10 段"); return; }
    setForm(prev => ({ ...prev, segments: [...prev.segments, { id: Date.now().toString(), lineKey: '', fromId: '', toId: '' }] }));
  };

  const updateSegment = (idx, field, val) => {
    setForm(prev => {
      const newSegs = [...prev.segments];
      const seg = { ...newSegs[idx], [field]: val };
      if (field === 'toId' && idx < newSegs.length - 1) {
          newSegs[idx + 1] = { ...newSegs[idx + 1], lineKey: '', fromId: '', toId: '' };
      }
      newSegs[idx] = seg;
      return { ...prev, segments: newSegs };
    });
  };

  const removeSegment = (idx) => {
    setForm(prev => ({ ...prev, segments: prev.segments.filter((_, i) => i !== idx) }));
  };

  return (
    <>
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-slide-up relative overflow-hidden">
        {isRouteSearching && (
          <div className="train-animation-layer">
            <svg viewBox="0 0 100 30" className="train-body" preserveAspectRatio="none"><path d="M 5 20 L 15 5 H 95 L 100 20 H 5 Z" fill="#e2e8f0" stroke="#3b82f6" strokeWidth="1"/><path d="M 5 20 Q 0 20 2 10 L 15 5" fill="none" stroke="#3b82f6" strokeWidth="1"/><rect x="20" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="35" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="50" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="65" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="10" y="16" width="90" height="2" fill="#3b82f6"/></svg>
            <div className="speed-line" style={{top:'40%', left:'10%', width:'50px', animationDelay:'0s'}}></div>
            <div className="speed-line" style={{top:'60%', left:'20%', width:'80px', animationDelay:'0.2s'}}></div>
            <div className="speed-line" style={{top:'30%', left:'50%', width:'40px', animationDelay:'0.1s'}}></div>
          </div>
        )}

        <div className="p-4 border-b bg-gray-50 relative z-10">
          <div className="flex justify-between items-center mb-4">
             <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800">
                {isEditing ? <Edit2 size={18} /> : <Plus size={18} />}
                {isEditing ? '编辑行程' : '新行程'}
             </h3>
             <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
          </div>
          <div className="grid grid-cols-2 p-1 bg-gray-200 rounded-lg relative isolate overflow-hidden">
             <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white shadow rounded-md transition-all duration-100 ease-out z-0`} style={{ left: editorMode === 'manual' ? '4px' : 'calc(50% + 0px)' }} />
             <button onClick={() => setEditorMode('manual')} className={`py-1.5 text-sm font-bold rounded-md z-10 transition-colors duration-300 ${editorMode === 'manual' ? 'text-gray-800' : 'text-gray-500'}`}>手动输入</button>
             <button onClick={() => setEditorMode('auto')} className={`py-1.5 text-sm font-bold rounded-md z-10 transition-colors duration-300 ${editorMode === 'auto' ? 'text-blue-600' : 'text-slate-500'}`}>自动规划</button>
          </div>
        </div>

        {editorMode === 'manual' && (
          <div className="p-6 space-y-6 overflow-y-auto">
              <input type="date" className="w-full p-2 border rounded bg-gray-50 font-bold text-gray-800" value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
              
              <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1 flex items-center gap-1"><span className="font-bold text-gray-600">¥</span> 金额 (JPY)</label>
                  <input type="number" className="w-full p-2 border rounded text-sm" placeholder="0" value={form.cost || ''} onChange={e => setForm({...form, cost: parseInt(e.target.value) || 0})}/>
              </div>

              <div className="space-y-3">
              {form.segments.map((segment, idx) => {
                  const prevSegment = idx > 0 ? form.segments[idx - 1] : null;
                  const prevLineData = prevSegment ? railwayData[prevSegment.lineKey] : null;
                  const prevEndStName = prevSegment ? railwayData[prevSegment.lineKey]?.stations.find(s => s.id === prevSegment.toId)?.name_ja : null;

                  let currentAllowed = null;
                  let warning = null;
                  
                  if (prevLineData && prevEndStName) {
                      const allKeys = Object.keys(railwayData);
                      currentAllowed = allKeys.filter(lineKey => {
                          // FIX: 必须包含已选
                          if (lineKey === segment.lineKey) return true;
                          const currentMeta = railwayData[lineKey].meta;
                          if (!isCompanyCompatible(prevLineData.meta, currentMeta)) return false;
                          const prevEndSt = prevLineData.stations.find(s => s.id === prevSegment.toId);
                          const transferable = getTransferableLines(prevEndSt, prevSegment.lineKey, railwayData, true);
                          return transferable.includes(lineKey);
                      });
                      if (currentAllowed.length === 0 && !segment.lineKey) warning = "无可换乘的同公司/JR线路";
                  }

                  return (
                  <div key={segment.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 relative group">
                      <div className="absolute -left-3 top-3 w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm border-2 border-white">{idx + 1}</div>
                      {idx > 0 && <button onClick={() => removeSegment(idx)} className="absolute -right-2 -top-2 p-1 bg-white text-red-500 rounded-full shadow border border-gray-100 hover:bg-red-50"><X size={14} /></button>}
                      
                      <div className="mb-2 pl-2">
                         <button 
                            onClick={() => openSelector('segment', idx, currentAllowed)}
                            className="w-full p-2 border rounded bg-white text-sm font-bold text-gray-700 text-left flex items-center justify-between shadow-sm hover:bg-gray-50 transition-colors"
                         >
                            <span className={segment.lineKey ? "text-gray-800" : "text-gray-400"}>
                                {segment.lineKey ? (
                                    <span className="flex items-center gap-2">
                                        {railwayData[segment.lineKey]?.meta.icon && <img src={railwayData[segment.lineKey].meta.icon} className="h-4 w-auto"/>}
                                        {segment.lineKey}
                                    </span>
                                ) : (idx === 0 ? "选择路线..." : "选择换乘路线...")}
                            </span>
                            <ListFilter size={16} className="text-gray-400" />
                         </button>
                         {warning && <div className="text-xs text-red-500 mt-1"><AlertTriangle size={12} className="inline"/> {warning}</div>}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 pl-2">
                        <select className={`w-full p-2 border rounded text-xs ${idx > 0 ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'}`} disabled={!segment.lineKey || idx > 0} value={segment.fromId} onChange={e => updateSegment(idx, 'fromId', e.target.value)}><option value="">乘车...</option>{segment.lineKey && railwayData[segment.lineKey].stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">→</div>
                        <select className="w-full p-2 border rounded bg-white text-xs" disabled={!segment.lineKey || !segment.fromId} value={segment.toId} onChange={e => updateSegment(idx, 'toId', e.target.value)}><option value="">下车...</option>{segment.lineKey && railwayData[segment.lineKey].stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                      </div>
                  </div>
                  );
              })}
              </div>
              <button onClick={addSegment} disabled={form.segments.length >= 10} className="w-full py-2 border-2 border-dashed border-gray-300 text-gray-400 rounded-lg hover:bg-gray-50 hover:text-gray-600 transition flex items-center justify-center gap-2 disabled:opacity-50"><Plus size={16} /> 添加换乘 / 下一程</button>
              <textarea className="w-full p-2 border rounded h-20 bg-gray-50" placeholder="备注..." value={form.memo} onChange={e => setForm({...form, memo: e.target.value})} />
          </div>
        )}

        {/* Auto Mode */}
        <div className={`p-6 space-y-6 flex-1 transition-opacity duration-300 ${editorMode === 'auto' ? 'opacity-100' : 'hidden opacity-0'}`}>
            <div className="space-y-4 bg-blue-50 p-4 rounded-lg border border-blue-100">
                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">出发地</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => openSelector('autoStart')} className="p-2 rounded border text-sm text-left bg-white text-gray-700 truncate flex items-center gap-1">{autoForm.startLine ? <span>{autoForm.startLine}</span> : <span className="text-gray-400">选择线路...</span>}</button>
                        <select className="p-2 rounded border text-sm" disabled={!autoForm.startLine} value={autoForm.startStation} onChange={e => setAutoForm({...autoForm, startStation: e.target.value})}><option value="">车站...</option>{autoForm.startLine && railwayData[autoForm.startLine].stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                    </div>
                </div>
                <div className="flex justify-center text-blue-300"><ArrowDown size={20}/></div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">目的地</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => openSelector('autoEnd')} className="p-2 rounded border text-sm text-left bg-white text-gray-700 truncate flex items-center gap-1">{autoForm.endLine ? <span>{autoForm.endLine}</span> : <span className="text-gray-400">选择线路...</span>}</button>
                        <select className="p-2 rounded border text-sm" disabled={!autoForm.endLine} value={autoForm.endStation} onChange={e => setAutoForm({...autoForm, endStation: e.target.value})}><option value="">车站...</option>{autoForm.endLine && railwayData[autoForm.endLine].stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                    </div>
                </div>
            </div>
            <button onClick={onAutoSearch} disabled={isRouteSearching} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition shadow-lg disabled:opacity-70">
                {isRouteSearching ? <Loader2 className="animate-spin"/> : <Search size={18}/>}
                {isRouteSearching ? '规划中...' : '搜索推荐路线'}
            </button>
            <div className="text-xs text-center text-slate-400">仅支持同一公司或JR集团内的换乘搜索</div>
        </div>

        {editorMode === 'manual' && <div className="p-4 border-t"><button onClick={onSave} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold">保存行程</button></div>}
      </div>
    </div>
    <LineSelector isOpen={selectorOpen} onClose={() => setSelectorOpen(false)} onSelect={handleLineSelect} railwayData={railwayData} allowedLines={allowedLines} />
    </>
  );
};

const PinEditor = ({ editingPin, setEditingPin, pinMode, setPinMode, deletePin, savePin }) => {
  if (!editingPin) return null;
  return (
    <div className="absolute bottom-6 left-4 right-4 z-[400] bg-white rounded-xl shadow-2xl p-4 animate-slide-up max-w-md mx-auto border border-gray-200">
      <div className="flex justify-between items-center mb-3 border-b pb-2"><span className="font-bold text-gray-700 flex items-center gap-2">{pinMode === 'snap' ? <Magnet size={16} className="text-indigo-600"/> : <Move size={16} />}{pinMode === 'snap' ? `吸附: ${editingPin.lineKey || '未知'}` : '自由位置'}</span><button onClick={() => {setEditingPin(null); setPinMode('idle');}} className="absolute right-0"><X size={18} className="text-gray-400"/></button></div>
      <div className="flex gap-3 mb-3"><div className="flex bg-gray-100 rounded-lg p-1 gap-1">{['photo', 'comment'].map(t => (<button key={t} onClick={() => setEditingPin({...editingPin, type: t})} className={`p-2 rounded-md ${editingPin.type===t ? 'bg-white shadow text-blue-600' : 'text-gray-400'}`}>{t==='photo'?<Camera size={18}/>:<MessageSquare size={18}/>}</button>))}</div><div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">{COLOR_PALETTE.map(c => <button key={c} onClick={() => setEditingPin({...editingPin, color: c})} className={`w-6 h-6 rounded-full border-2 ${editingPin.color===c?'border-gray-600 scale-110':'border-transparent'}`} style={{background: c}} />)}</div></div>
      <input className="w-full p-2 border rounded text-sm mb-2" placeholder="备注..." value={editingPin.comment||''} onChange={e => setEditingPin({...editingPin, comment: e.target.value})} />
      {editingPin.type==='photo' && <input className="w-full p-2 border rounded text-sm mb-3" placeholder="图片URL..." value={editingPin.imageUrl||''} onChange={e => setEditingPin({...editingPin, imageUrl: e.target.value})} />}
      <div className="flex gap-2">{!editingPin.isTemp && <button onClick={() => deletePin(editingPin.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={20}/></button>}<button onClick={savePin} className="flex-1 bg-slate-800 text-white py-2 rounded-lg font-bold text-sm hover:bg-slate-700">{editingPin.isTemp ? '添加' : '更新'}</button></div>
    </div>
  );
};
const FabButton = ({ activeTab, pinMode, togglePinMode }) => (
  <div className="absolute bottom-4 left-4 z-[400] flex flex-col gap-3">{activeTab === 'map' && (<button onClick={togglePinMode} className={`p-3 rounded-full shadow-lg transition-all transform hover:scale-105 ${pinMode==='idle'?'bg-white text-gray-700':pinMode==='free'?'bg-blue-500 text-white':'bg-indigo-600 text-white ring-4 ring-indigo-200'}`}>{pinMode === 'snap' ? <Magnet size={24} /> : <MapPin size={24} />}</button>)}</div>
);

const RouteSlice = ({ segments, segmentGeometries }) => {
  const allCoords = [];
  if (!segmentGeometries) return null;

  let totalDist = 0;

  segments.forEach(seg => {
      const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
      const geom = segmentGeometries.get(key);
      if (geom && geom.coords) {
          if (geom.isMulti) {
              geom.coords.forEach(c => {
                  allCoords.push({ coords: c, color: geom.color });
                  if (turf) totalDist += turf.length(turf.lineString(c.map(p => [p[1], p[0]])));
              });
          } else {
              allCoords.push({ coords: geom.coords, color: geom.color });
              if (turf) totalDist += turf.length(turf.lineString(geom.coords.map(p => [p[1], p[0]])));
          }
      }
  });

  if (allCoords.length === 0) return <div className="w-28 shrink-0 flex items-center justify-center text-xs text-gray-200 ml-2 border-l border-gray-50">无预览</div>;

  // Flattening Logic using PCA (Principal Component Analysis) approximation
  // 1. Calculate Centroid
  let sumLat = 0, sumLng = 0, count = 0;
  allCoords.forEach(item => {
      item.coords.forEach(pt => {
          sumLat += pt[0];
          sumLng += pt[1];
          count++;
      });
  });
  if (count === 0) return null;
  const cenLat = sumLat / count;
  const cenLng = sumLng / count;

  // 2. Calculate Covariance Matrix terms
  let u20 = 0, u02 = 0, u11 = 0;
  allCoords.forEach(item => {
      item.coords.forEach(pt => {
          const x = pt[1] - cenLng; // lng is x
          const y = pt[0] - cenLat; // lat is y
          u20 += x * x;
          u02 += y * y;
          u11 += x * y;
      });
  });

  // 3. Principal Axis Angle
  // theta is the angle of the main axis relative to X-axis
  const theta = 0.5 * Math.atan2(2 * u11, u20 - u02);

  // We want to rotate by -theta to align with X axis
  const cosT = Math.cos(-theta);
  const sinT = Math.sin(-theta);

  // 4. Rotate and BBox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const rotatedCoords = allCoords.map(item => ({
      ...item,
      coords: item.coords.map(pt => {
          const x = pt[1] - cenLng;
          const y = pt[0] - cenLat;
          const rx = x * cosT - y * sinT;
          const ry = x * sinT + y * cosT;
          if (rx < minX) minX = rx;
          if (rx > maxX) maxX = rx;
          if (ry < minY) minY = ry;
          if (ry > maxY) maxY = ry;
          return [ry, rx]; // Keep as [y, x] format for consistency if needed, but projected is purely Cartesian
      })
  }));

  const w = maxX - minX || 0.001;
  const h = maxY - minY || 0.001;

  // Padding
  const padX = w * 0.1;
  const padY = h * 0.1;

  const vMinX = minX - padX;
  const vMinY = minY - padY;
  const vW = w + padX * 2;
  const vH = h + padY * 2;

  // Determine Aspect Ratio strategy
  // 1. Normalize data to fill 100x50 (2:1) coordinate space
  // 2. Calculate target visual ratio = max(2, actualRatio)
  // 3. Size container to target ratio
  // 4. Use preserveAspectRatio="none" to stretch the normalized 2:1 coords to the target ratio

  const contentRatio = vW / vH;
  const visualRatio = Math.min(8, Math.max(2, contentRatio)); // Min 2:1, Max 8:1
  const heightPx = 40;
  const widthPx = heightPx * visualRatio;

  const project = (lat, lng) => {
      const px = ((lng - vMinX) / vW) * 100; // Map to 0-100
      const py = 50 - ((lat - vMinY) / vH) * 50; // Map to 0-50
      return `${px},${py}`;
  };

  return (
      <div className="shrink-0 ml-2 border-l border-gray-50 flex flex-row items-center justify-end pl-2 gap-2" style={{ minWidth: '100px' }}>
          <div style={{ width: widthPx, height: heightPx }}>
            <svg
                viewBox="0 0 100 50"
                preserveAspectRatio="none"
                className="w-full h-full opacity-80"
            >
                {rotatedCoords.map((item, idx) => (
                    <polyline
                        key={idx}
                        points={item.coords.map(pt => project(pt[0], pt[1])).join(' ')}
                        fill="none"
                        stroke={item.color || '#94a3b8'}
                        strokeWidth="4"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                ))}
            </svg>
          </div>
          <div className="text-[10px] font-bold text-gray-400 shrink-0 text-right">{Math.round(totalDist)}km</div>
      </div>
  );
};

const RecordsView = ({ trips, railwayData, setTrips, onEdit, onDelete, onAdd, segmentGeometries }) => (
  <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-3 pb-4">
    {trips.length === 0 ? (
        <div className="text-center text-gray-400 py-10 flex flex-col items-center justify-center flex-1">
            <Train size={48} className="opacity-20 mb-4"/>
            <p>暂无行程记录</p>
            <p className="text-xs mt-2">点击下方按钮添加你的第一次乗り鉄<br/>注意: 自定义线路可以导入 company_data 和 geojson</p>
        </div>
    ) : (
    trips.map(t => {
      const segments = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
      return (
        <div key={t.id} className="bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex justify-between mb-2 pb-2 border-b border-gray-50">
            <span className="text-xs font-bold text-gray-400">{t.date}</span>
            <div className="flex items-center gap-2">
                {t.cost > 0 && <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">¥{t.cost}</span>}
                <button onClick={()=>onEdit(t)} className="text-gray-400 hover:text-blue-500"><Edit2 size={14}/></button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(t.id); }} className="text-gray-400 hover:text-red-500"><Trash2 size={14}/></button>
            </div>
          </div>
          <div className="flex flex-row">
            <div className="flex-1 space-y-2 relative">{segments.length > 1 && <div className="absolute left-[5px] top-2 bottom-2 w-0.5 bg-gray-200 z-0"></div>}
                {segments.map((seg, idx) => {
                    const line = railwayData[seg.lineKey];
                    const icon = line?.meta?.icon;
                    const getSt = (id) => line?.stations.find(s=>s.id===id)?.name_ja || id;
                    return (
                    <div key={idx} className="relative z-10 flex flex-col text-sm"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm shrink-0"></div>{icon && <img src={icon} alt="" className="line-icon" />}<span className="font-bold text-emerald-700 text-xs">{seg.lineKey}</span></div><div className="pl-5 font-medium text-gray-700">{getSt(seg.fromId)} <span className="text-gray-300 mx-1">→</span> {getSt(seg.toId)}</div></div>
                )})}
            </div>
            <RouteSlice segments={segments} segmentGeometries={segmentGeometries} />
          </div>
          {t.memo && <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded mt-3">{t.memo}</div>}
        </div>
      );
    }))}
    <button onClick={onAdd} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-400 rounded-xl hover:bg-gray-50 font-bold transition">+ 记录新行程</button>
  </div>
);
const StatsView = ({ trips, railwayData ,geoData, user, userProfile, segmentGeometries }) => {
    const totalTrips = trips.length;
    const allSegments = trips.flatMap(t => t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }]);
    const uniqueLines = new Set(allSegments.map(s => s.lineKey)).size;
    let totalDist = 0;
    let totalCost = 0;
    trips.forEach(t => totalCost += (t.cost || 0));

    if (segmentGeometries && turf) {
      allSegments.forEach(seg => {
        const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
        const geom = segmentGeometries.get(key);
        if (geom && geom.coords) {
            if (geom.isMulti) {
                geom.coords.forEach(c => totalDist += turf.length(turf.lineString(c.map(p => [p[1], p[0]]))));
            } else {
                totalDist += turf.length(turf.lineString(geom.coords.map(p => [p[1], p[0]])));
            }
        } else {
            // Fallback (Approx)
            const line = railwayData[seg.lineKey];
            if (line) {
                const s1 = line.stations.find(st => st.id === seg.fromId);
                const s2 = line.stations.find(st => st.id === seg.toId);
                if (s1 && s2) totalDist += calcDist(s1.lat, s1.lng, s2.lat, s2.lng);
            }
        }
      });
    }
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {user && (
            <div className="bg-white p-4 rounded-xl shadow-sm border">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center text-xl font-bold text-gray-500 overflow-hidden">
                        {userProfile?.bindings?.github?.avatar_url ? (
                            <img src={userProfile.bindings.github.avatar_url} alt="Avatar" className="w-full h-full object-cover"/>
                        ) : (
                            user.username.charAt(0).toUpperCase()
                        )}
                    </div>
                    <div>
                        <div className="font-bold text-lg">{user.username}</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                            {userProfile?.bindings?.github ? (
                                <span className="flex items-center gap-1 text-emerald-600"><Github size={12}/> GitHub 已绑定 ({userProfile.bindings.github.login})</span>
                            ) : (
                                <button onClick={() => api.initiateOAuth('github')} className="flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded text-xs font-bold hover:bg-black transition-colors"><Github size={12}/> 绑定 GitHub</button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}

        <div className="grid grid-cols-2 gap-4"><div className="bg-white p-4 rounded-xl shadow-sm border text-center"><div className="text-xs text-gray-400 mb-1">记录数</div><div className="text-3xl font-bold text-gray-800">{totalTrips}</div></div><div className="bg-white p-4 rounded-xl shadow-sm border text-center"><div className="text-xs text-gray-400 mb-1">制霸路线</div><div className="text-3xl font-bold text-indigo-600">{uniqueLines}</div></div></div>
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-6 rounded-xl shadow-lg text-white">
            <div className="flex items-center justify-between mb-2"><h3 className="font-bold flex items-center gap-2"><TrendingUp size={18}/> 里程统计</h3><span className="text-xs bg-white/20 px-2 py-1 rounded">总距离</span></div>
            <div className="text-4xl font-bold mb-2">{Math.round(totalDist)} <span className="text-lg font-normal opacity-80">km</span></div>
            <div className="border-t border-white/20 pt-2 flex items-center gap-2 text-sm opacity-90"><span className="font-bold">¥</span> 总开销: {totalCost.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border overflow-hidden"><div className="p-3 border-b bg-slate-50 font-bold text-sm text-slate-600">常乘路线排行</div>
          {Object.entries(allSegments.reduce((acc, s) => { acc[s.lineKey] = (acc[s.lineKey]||0)+1; return acc; }, {})).sort((a,b) => b[1]-a[1]).slice(0, 3).map(([line, count], idx) => { const icon = railwayData[line]?.meta?.icon; return ( <div key={line} className="p-3 border-b last:border-0 flex justify-between items-center"><div className="flex items-center gap-3"><span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${idx===0?'bg-yellow-100 text-yellow-700':'bg-slate-100 text-slate-600'}`}>{idx+1}</span>{icon && <img src={icon} alt="" className="line-icon" />}<span>{line}</span></div><span className="font-bold text-slate-400 text-sm">{count}</span></div> )})}
        </div>
      </div>
    );
  };
const MOCK_RAILWAY_DATA = {};
const MOCK_INITIAL_TRIPS = [];
const MOCK_INITIAL_PINS = [];

// --- 5. 主组件 ---
export default function RailRoundApp() {
  const [activeTab, setActiveTab] = useState('records');
  const [railwayData, setRailwayData] = useState({}); 
  const [trips, setTrips] = useState([]); 
  const [pins, setPins] = useState([]); 
  const [user, setUser] = useState(null); // { token, username }
  const [userProfile, setUserProfile] = useState(null); // Full user object (bindings etc)
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [companyDB, setCompanyDB] = useState({});
  const [leafletReady, setLeafletReady] = useState(false);
  const [geoData, setGeoData] = useState({ type: "FeatureCollection", features: [] });
  const [pinMode, setPinMode] = useState('idle'); 
  const [editingPin, setEditingPin] = useState(null);
  const isDraggingRef = useRef(false); 
  const [isTripEditing, setIsTripEditing] = useState(false);
  const [editingTripId, setEditingTripId] = useState(null);
  const [tripForm, setTripForm] = useState({ date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0, suicaBalance: null });
  const [editorMode, setEditorMode] = useState('manual'); 
  const [autoForm, setAutoForm] = useState({ startLine: '', startStation: '', endLine: '', endStation: '' });
  const [isRouteSearching, setIsRouteSearching] = useState(false);
  const [mapZoom, setMapZoom] = useState(10);
  const [isExportingKML, setIsExportingKML] = useState(false);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const pinsLayer = useRef(null);
  const baseLinesLayer = useRef(null);
  const baseStationsLayer = useRef(null);
  const routeLayer = useRef(null);

  
  const readJsonFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        // 返回文件名(去后缀)和数据
        resolve({ 
            data: json, 
            fileName: file.name.replace(/\.(json|geojson)$/i, "") 
        });
      } catch (err) {
        reject(new Error(`文件 ${file.name} 解析失败`));
      }
    };
    reader.onerror = () => reject(new Error(`读取文件 ${file.name} 错误`));
    reader.readAsText(file);
  });
};

  const normalizeCompanyName = (s) => {
    if (!s && s !== 0) return '';
    try {
      return String(s).normalize('NFKC').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return String(s).replace(/\s+/g, ' ').trim();
    }
  };

  const buildCompanyIndex = (companyData) => {
    const idx = {};
    if (!companyData) return idx;
    Object.keys(companyData).forEach(k => {
      idx[normalizeCompanyName(k)] = k;
    });
    return idx;
  };

  const findBestCompanyKey = (name, companyIndex) => {
    const n = normalizeCompanyName(name);
    if (!n) return name;
    if (companyIndex[n]) return companyIndex[n];
    // 尝试前缀/包含匹配（宽松匹配）
    for (const keyNorm of Object.keys(companyIndex)) {
      if (!keyNorm) continue;
      if (keyNorm.includes(n) || n.includes(keyNorm)) return companyIndex[keyNorm];
      if (keyNorm.startsWith(n) || n.startsWith(keyNorm)) return companyIndex[keyNorm];
    }
    return name; // fallback to original
  };

  // 检查登录状态 (包含处理 OAuth 回调)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    const usernameFromUrl = urlParams.get('username');

    if (tokenFromUrl && usernameFromUrl) {
        // Handle OAuth Login
        setUser({ token: tokenFromUrl, username: usernameFromUrl });
        localStorage.setItem('rail_token', tokenFromUrl);
        localStorage.setItem('rail_username', usernameFromUrl);
        loadUserData(tokenFromUrl, true);

        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        // Handle Local Storage Login
        const token = localStorage.getItem('rail_token');
        const username = localStorage.getItem('rail_username');
        if (token && username) {
          setUser({ token, username });
          loadUserData(token);
        }
    }
  }, []);

  const loadUserData = async (token, isInteractive = false) => {
    try {
      const cloudData = await api.getData(token);
      setUserProfile(cloudData); // Store full profile including bindings

      let newTrips = cloudData.trips || [];
      let newPins = cloudData.pins || [];

      if (isInteractive && (trips.length > 0 || pins.length > 0)) {
         // Merge Strategy
         if (confirm("检测到本地有数据，是否保留并与云端数据合并？\n\n点击【确定】合并 (Keep Local)\n点击【取消】仅使用云端数据 (Overwrite Local)")) {
             // Merge
             // Use Map to deduplicate by ID
             const tripMap = new Map();
             newTrips.forEach(t => tripMap.set(t.id, t));
             trips.forEach(t => tripMap.set(t.id, t)); // Local overwrites cloud if conflict? Or vice versa. Usually local is fresher if just edited.
             newTrips = Array.from(tripMap.values());

             const pinMap = new Map();
             newPins.forEach(p => pinMap.set(p.id, p));
             pins.forEach(p => pinMap.set(p.id, p));
             newPins = Array.from(pinMap.values());

             // Sync back the merged result to cloud immediately
             if (token) {
                api.saveData(token, newTrips, newPins).catch(e => console.error("Merge sync failed", e));
             }
         }
      }

      setTrips(newTrips.sort((a,b) => b.date.localeCompare(a.date)));
      setPins(newPins);
      console.log('User data loaded');
    } catch (e) {
      console.error('Failed to load user data:', e);
      if (e.message.includes('Unauthorized')) {
        handleLogout();
      }
    }
  };

  const handleLoginSuccess = (data) => {
    setUser({ token: data.token, username: data.username });
    localStorage.setItem('rail_token', data.token);
    localStorage.setItem('rail_username', data.username);
    // 加载数据
    loadUserData(data.token, true);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('rail_token');
    localStorage.removeItem('rail_username');
    // 可选：清空本地数据
    // setTrips([]);
    // setPins([]);
  };

  // 自动加载 company_data.json 和所有 GeoJSON 文件（更稳健的解析与匹配）
  const autoLoadData = async () => {
    try {
      console.log('[Autoload] 正在初始化...');
      
      // 1. 先加载基础元数据 (Company DB)
      let currentCompanyData = {};
      try {
        const companyRes = await fetch('/company_data.json');
        if (companyRes.ok) {
          const txt = await companyRes.text();
          // 处理 BOM 头并解析
          currentCompanyData = JSON.parse(txt.replace(/^\uFEFF/, ''));
          
          // 立即更新 State 和 Ref/Window，确保后续逻辑能立马读到
          setCompanyDB(prev => ({ ...prev, ...currentCompanyData }));
          window.__companyData = currentCompanyData; // 供后续同步逻辑使用
          console.log(`[Autoload] 公司数据库加载完成: ${Object.keys(currentCompanyData).length} 条`);
        }
      } catch (e) {
        console.warn('[Autoload] company_data.json 加载失败或格式错误', e);
      }
      const companyIndex = buildCompanyIndex(currentCompanyData);

      // --- SWR Caching Logic for GeoJSON ---

      // Helper to process a list of {json, company} objects into features/railwayData
      // Added companyData explicitly to avoid closure staleness issues with currentCompanyData
      const processGeoJsonBatch = (items, companyData = currentCompanyData) => {
          const newFeatures = [];
          const railwayUpdates = {};

          items.forEach(({ json, company: defaultCompany }) => {
            if (!json.features) return;
            // A. 增强 Feature 属性
            const enriched = json.features.map(f => ({
              ...f,
              properties: {
                ...f.properties,
                company: f.properties.company || f.properties.operator || defaultCompany || "上传数据"
              }
            }));
            newFeatures.push(...enriched);

            // B. 构建 Railway 数据结构
            enriched.forEach(f => {
               const p = f.properties;
               const comp = p.company;

               const ensureLineInTemp = (lineName, props) => {
                   const lineKey = `${comp}:${lineName}`;
                   if (!railwayUpdates[lineKey]) {
                       const info = (companyData && companyData[comp]) || {};
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

          // Update State
          if (newFeatures.length > 0) {
              setGeoData(prev => ({ type: "FeatureCollection", features: [...prev.features, ...newFeatures] }));
          }
          if (Object.keys(railwayUpdates).length > 0) {
              setRailwayData(prev => {
                  const next = { ...prev };
                  Object.entries(railwayUpdates).forEach(([key, val]) => {
                      if (!next[key]) next[key] = val;
                      else {
                          val.stations.forEach(s => { if (!next[key].stations.find(ex => ex.id === s.id)) next[key].stations.push(s); });
                          if(val.meta.icon && !next[key].meta.icon) next[key].meta.icon = val.meta.icon;
                      }
                  });
                  return next;
              });
          }
      };

      // 2. Load from IndexedDB First (Fast Path)
      let cachedFiles = [];
      try {
          const dbInstance = await db.open();
          const tx = dbInstance.transaction(db.STORE_FILES, 'readonly');
          const store = tx.objectStore(db.STORE_FILES);
          const req = store.getAll(); // Get all values
          cachedFiles = await new Promise((resolve) => {
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => resolve([]);
          });

          if (cachedFiles.length > 0) {
              console.log(`[Autoload] 从缓存加载了 ${cachedFiles.length} 个文件`);
              processGeoJsonBatch(cachedFiles);
          }
      } catch (e) {
          console.warn('[Autoload] Cache read failed', e);
      }

      // 3. Network Fetch (Background Update)
      const manifestRes = await fetch('/geojson_manifest.json').catch(() => null);
      if (!manifestRes || !manifestRes.ok) {
          console.warn('[Autoload] 无法获取 manifest, 跳过更新检查');
          return;
      }
      const manifest = await manifestRes.json();
      const geojsonFiles = manifest.files || [];

      if (geojsonFiles.length === 0) {
          console.log('[Autoload] manifest 为空');
          return;
      }
      
      console.log(`[Autoload] 检查更新...`);

      const cachedFileNames = new Set(cachedFiles.map(f => f.fileName));
      const missingFiles = geojsonFiles.filter(f => {
          const name = f.replace(/\.(geojson|json)$/i, '');
          return !cachedFileNames.has(name);
      });

      if (missingFiles.length === 0) {
          console.log('[Autoload] 所有文件已缓存，无需下载。');
          return;
      }

      console.log(`[Autoload] 发现 ${missingFiles.length} 个新文件，开始下载...`);

      const downloadTasks = missingFiles.map(async (fileName) => {
        try {
          const fileNameWithExt = fileName.includes('.geojson') ? fileName : `${fileName}.geojson`;
          const res = await fetch(`/geojson/${fileNameWithExt}`);
          if (!res.ok) throw new Error(`Status ${res.status}`);
          const json = await res.json();
          const rawCompanyName = fileName.replace(/\.(geojson|json)$/i, '');
          const matchedCompany = findBestCompanyKey(rawCompanyName, companyIndex);
          
          const dataItem = { json, company: matchedCompany, fileName: rawCompanyName };

          // Save to Cache
          db.set(db.STORE_FILES, rawCompanyName, dataItem).catch(e => console.warn('Cache write failed', e));

          return dataItem;
        } catch (e) {
          console.warn(`[Autoload] 跳过文件 ${fileName}:`, e.message);
          return null;
        }
      });

      const results = await Promise.all(downloadTasks);
      const validResults = results.filter(r => r !== null);

      if (validResults.length > 0) {
          processGeoJsonBatch(validResults);
          console.log(`[Autoload] 新增数据已应用。`);
      }
      console.log('[Autoload] 初始化全部完成，应用就绪。');
      return;

    } catch (err) {
      console.error('[Autoload] 致命错误:', err);
    }
  };

  useEffect(() => {
    setLeafletReady(true);
    autoLoadData();
  }, []);

  useEffect(() => { if (activeTab === 'map' && leafletReady) setTimeout(initMap, 100); }, [activeTab, leafletReady]);
  useEffect(() => { if (mapInstance.current && leafletReady && geoData) renderBaseMap(geoData); }, [geoData, leafletReady]);
  const [segmentGeometries, setSegmentGeometries] = useState(new Map()); // Key -> { coords, color, isMulti, fallback }
  const [tripSegmentsGeometry, setTripSegmentsGeometry] = useState([]);

  // Async Logic to load/calc geometries
  useEffect(() => {
    // 1. Identify segments needed
    const allSegments = trips.flatMap(t => t.segments || []);
    const uniqueKeys = new Set();
    const needed = allSegments.filter(seg => {
        if (!seg.lineKey || !seg.fromId || !seg.toId) return false;
        const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
        uniqueKeys.add(key);
        // Only fetch if not already in memory cache
        return !segmentGeometries.has(key);
    });

    if (needed.length === 0) {
        // Just rebuild the list for rendering using cache
        const geometryList = allSegments.map(seg => {
            const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
            const cached = segmentGeometries.get(key);
            const line = railwayData[seg.lineKey];
            const s1 = line?.stations.find(s => s.id === seg.fromId);
            const s2 = line?.stations.find(s => s.id === seg.toId);
            const name1 = s1?.name_ja || seg.fromId;
            const name2 = s2?.name_ja || seg.toId;

            if (cached) {
                return {
                    id: seg.id || key,
                    popup: `${seg.lineKey}: ${name1} → ${name2}`,
                    ...cached
                };
            }
            return null;
        }).filter(Boolean);
        setTripSegmentsGeometry(geometryList);
        return;
    }

    // 2. Fetch/Calc missing segments
    const fetchMissing = async () => {
        const newCache = new Map(segmentGeometries);
        let updated = false;

        for (const seg of needed) {
            const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;

            // Check IDB
            let data = await db.get(db.STORE_SEGMENTS, key).catch(() => null);

            if (!data) {
                // Not in IDB, try calculate
                if (!geoData || !geoData.features) continue; // Wait for GeoData

                const line = railwayData[seg.lineKey];
                if (!line) continue;
                const s1 = line.stations.find(s => s.id === seg.fromId);
                const s2 = line.stations.find(s => s.id === seg.toId);
                if (!s1 || !s2) continue;

                const parts = seg.lineKey.split(':');
                const company = parts[0];
                const lineName = parts.slice(1).join(':');

                const feature = geoData.features.find(f =>
                    f.properties.type === 'line' &&
                    f.properties.name === lineName &&
                    f.properties.company === company
                );

                let coords = null;
                let color = '#38bdf8';
                let isMulti = false;
                let fallback = false;

                if (feature) {
                    color = feature.properties.stroke || '#38bdf8';
                    const latLngs = sliceGeoJsonPath(feature, s1.lat, s1.lng, s2.lat, s2.lng);
                    if (latLngs) {
                        coords = latLngs;
                        if (Array.isArray(latLngs[0]) && Array.isArray(latLngs[0][0])) isMulti = true;
                    }
                }

                // Fallback Logic (same as before)
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
                // Save to IDB
                await db.set(db.STORE_SEGMENTS, key, data);
            }

            if (data) {
                newCache.set(key, data);
                updated = true;
            }
        }

        if (updated) {
            setSegmentGeometries(newCache);
        }
    };

    fetchMissing();

  }, [trips, geoData, railwayData, segmentGeometries]);

  useEffect(() => {
      if (mapInstance.current && leafletReady && tripSegmentsGeometry) {
          renderTripRoutes();
      }
  }, [tripSegmentsGeometry, leafletReady, mapZoom]);

  useEffect(() => { if (mapInstance.current && leafletReady && !isDraggingRef.current) renderPins(); }, [pins, editingPin, pinMode, leafletReady]);

  useEffect(() => {
     if (Object.keys(companyDB).length === 0) return;
     setRailwayData(prev => {
         const next = { ...prev };
         let changed = false;
         Object.keys(next).forEach(lineKey => {
             const line = next[lineKey];
             const compName = line.meta.company;
             if (companyDB[compName]) {
                 const info = companyDB[compName];
                 if(!line.meta.region ||!line.meta.type ||line.meta.region === "未知" || line.meta.type === "未知") {
                     next[lineKey] = { ...line, meta: { ...line.meta, region: info.region, type: info.type, logo: info.logo } };
                     changed = true;
                 }
             }
         });
         return changed ? next : prev;
     });
  }, [companyDB]);

  const handleCompanyUpload = (event) => {
      const file = event.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = (e) => { try { const json = JSON.parse(e.target.result); applyCompanyData(json, { silent: false }); } catch(err) { alert("解析失败"); } };
      reader.readAsText(file);
      event.target.value = '';
  };

  // 将 company 数据应用到 state（复用手动上传的逻辑）
  const applyCompanyData = (companyData, { silent = true } = {}) => {
    if (!companyData || typeof companyData !== 'object') return;
    setCompanyDB(prev => ({ ...prev, ...companyData }));
    try { window.__companyData = { ...(window.__companyData || {}), ...companyData }; } catch (e) {}
    if (!silent) alert('公司数据库已更新');
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
            resolve(null); // 失败也 resolve null，不阻断其他文件
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

      console.log(`[Upload] 读取完成，开始合并 ${validResults.length} 个文件的数据...`);

      // 2. 内存预处理
      const newFeatures = [];
      const railwayUpdates = {};

      validResults.forEach(({ json, companyName: defaultCompany }) => {
        if (!json.features) return;

        // A. 处理 Features
        const enriched = json.features.map(f => ({
          ...f,
          properties: {
            ...f.properties,
            company: f.properties.company || f.properties.operator || defaultCompany || "上传数据"
          }
        }));
        newFeatures.push(...enriched);

        // B. 提取 RailwayData (构建站点和线路元数据)
        enriched.forEach(f => {
             const p = f.properties;
             const comp = p.company; 
             
             const ensureLineInTemp = (lineName, props) => {
                 const lineKey = `${comp}:${lineName}`;
                 if (!railwayUpdates[lineKey]) {
                     const info = (window.__companyData && window.__companyData[comp]) || companyDB[comp] || {};
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
                 
                 if (!stations.find(s => s.name_ja === p.name)) {
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

      if (newFeatures.length > 0) {
          setGeoData(prev => ({ 
            type: "FeatureCollection", 
            features: [...prev.features, ...newFeatures] 
          }));
      }

      if (Object.keys(railwayUpdates).length > 0) {
          setRailwayData(prev => {
            const next = { ...prev };
            Object.entries(railwayUpdates).forEach(([key, val]) => {
                if (!next[key]) {
                    next[key] = val;
                } else {
                    // 合并站点
                    val.stations.forEach(s => {
                        if (!next[key].stations.find(ex => ex.id === s.id)) {
                            next[key].stations.push(s);
                        }
                    });
                    // 合并 Icon
                    if(val.meta.icon && !next[key].meta.icon) next[key].meta.icon = val.meta.icon;
                }
            });
            return next;
          });
      }
      
      alert(`成功导入 ${validResults.length} 个文件！`);

    } catch (err) {
      console.error(err);
      alert("文件处理过程中发生未知错误");
    } finally {
      // 清空 input 允许再次上传同名文件
      event.target.value = '';
    }
  };
  
  const stationNameIndex = useMemo(() => {
    if (!railwayData) return {};
    
    const index = {};
    const lineKeys = Object.keys(railwayData);

    // 遍历线路
    for (let i = 0, len = lineKeys.length; i < len; i++) {
      const lineKey = lineKeys[i];
      const line = railwayData[lineKey];
      const stations = line.stations;
      
      const company = line.meta?.company;

      // 遍历站点
      for (let j = 0, sLen = stations.length; j < sLen; j++) {
        const s = stations[j];
        const name = s.name_ja;

        if (index[name] === undefined) {
          index[name] = [];
        }

        index[name].push({
          lineKey: lineKey,
          id: s.id,
          lat: s.lat,
          lng: s.lng,
          company: company // 预存公司
        });
      }
    }
    
    // console.timeEnd('buildStationIndex');
    return index;
  }, [railwayData]);


  const handleExportUserData = () => {
      const linesUsed = new Set();
      const companiesUsed = new Set();
      trips.forEach(t => { (t.segments || []).forEach(s => { if(s.lineKey) { linesUsed.add(s.lineKey); const meta = railwayData[s.lineKey]?.meta; if(meta && meta.company) companiesUsed.add(meta.company); } }); });
      const backupData = { meta: { version: 1, exportedAt: new Date().toISOString(), appName: "RailRound" }, dependencies: { lines: Array.from(linesUsed), companies: Array.from(companiesUsed) }, data: { trips: trips, pins: pins } };
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
              if (!backup.meta || (backup.meta.appName !== "RailRound" && backup.meta.appName !== "")) { alert("无效的备份文件"); return; }
              const missingLines = [];
              if (backup.dependencies && backup.dependencies.lines) { backup.dependencies.lines.forEach(lineKey => { if (!railwayData[lineKey]) missingLines.push(lineKey); }); }
              if (missingLines.length > 0) { const msg = `检测到缺少以下线路的基础数据，可能会导致显示异常：\n\n${missingLines.slice(0, 5).join(", ")}${missingLines.length > 5 ? '...' : ''}\n\n建议先去地图页面上传对应的 GeoJSON 文件。是否继续导入？`; if (!confirm(msg)) return; }
              const currentTripIds = new Set(trips.map(t => t.id)); const incomingTrips = backup.data.trips || []; const uniqueIncomingTrips = []; const tempTripIds = new Set(); incomingTrips.forEach(t => { if (!tempTripIds.has(t.id)) { tempTripIds.add(t.id); uniqueIncomingTrips.push(t); } }); const newTrips = uniqueIncomingTrips.filter(t => !currentTripIds.has(t.id));
              const currentPinIds = new Set(pins.map(p => p.id)); const incomingPins = backup.data.pins || []; const uniqueIncomingPins = []; const tempPinIds = new Set(); incomingPins.forEach(p => { if (!tempPinIds.has(p.id)) { tempPinIds.add(p.id); uniqueIncomingPins.push(p); } }); const newPins = uniqueIncomingPins.filter(p => !currentPinIds.has(p.id));
              if (newTrips.length > 0) { setTrips(prev => [...prev, ...newTrips].sort((a,b) => b.date.localeCompare(a.date))); }
              if (newPins.length > 0) { setPins(prev => [...prev, ...newPins]); }
              alert(`数据导入完成！\n\n行程: 新增 ${newTrips.length} 条 (跳过重复/无效 ${incomingTrips.length - newTrips.length} 条)\n图钉: 新增 ${newPins.length} 个 (跳过重复/无效 ${incomingPins.length - newPins.length} 个)`);
          } catch (err) { console.error(err); alert("文件解析失败"); }
      };
      reader.readAsText(file); event.target.value = '';
  };

  const handleExportKML = async () => {
    if (isExportingKML) return;
    setIsExportingKML(true);
    
    // 异步执行 KML 生成，防止阻塞主线程
    setTimeout(async () => {
        try {
            if (trips.length === 0 || !geoData || !turf) {
                alert("无行程记录或地图数据未加载。");
                setIsExportingKML(false);
                return;
            }

            const allPaths = [];
            
            // 循环所有行程，切割 GeoJSON 以获取准确坐标
            trips.forEach(t => {
                const tripName = `${t.date} - Trip ${t.id}`;
                t.segments.forEach((seg, segIndex) => {
                    const line = railwayData[seg.lineKey];
                    if (!line) return;
                    const s1 = line.stations.find(s => s.id === seg.fromId);
                    const s2 = line.stations.find(s => s.id === seg.toId);
                    if (!s1 || !s2) return;

                    const parts = seg.lineKey.split(':');
                    const company = parts[0];
                    const lineName = parts.slice(1).join(':');

                    const feature = geoData.features.find(f => 
                        f.properties.type === 'line' && 
                        f.properties.name === lineName && 
                        f.properties.company === company
                    );
                    
                    if (feature) {
                        // 使用 Turf 切割路径
                        const coords = sliceGeoJsonPath(feature, s1.lat, s1.lng, s2.lat, s2.lng);
                        if (coords) {
                            // KML 要求 [LNG, LAT, 0] 格式
                            const kmlCoords = Array.isArray(coords[0]) && Array.isArray(coords[0][0])
                                ? coords.flat().map(p => `${p[1]},${p[0]},0`).join(' ')
                                : coords.map(p => `${p[1]},${p[0]},0`).join(' ');
                            
                            allPaths.push({
                                name: `${tripName} Segment ${segIndex + 1}`,
                                coordinates: kmlCoords,
                                lineKey: seg.lineKey
                            });
                        }
                    }
                });
            });

            if (allPaths.length === 0) {
                 alert("未找到可导出路径。");
                 setIsExportingKML(false);
                 return;
            }

            // 2. 构造 KML XML 字符串
            const kmlString = buildKMLString(allPaths);
            
            // 3. 触发下载
            const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `RailRound_KML_export_${new Date().toISOString().slice(0, 10)}.kml`;
            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url); // 释放内存
                setIsExportingKML(false);        // 关闭 Loading 状态
            }, 2000); 

        } catch (e) {
            console.error("KML Export Error:", e);
            alert("导出过程中发生错误。");
            setIsExportingKML(false); // 发生错误也要关闭 Loading
        }
    }, 100); 
  };

  const handleSaveTrip = () => {
    const validSegments = tripForm.segments.filter(s => s.fromId !== s.toId);
    if (validSegments.length === 0) { alert("至少包含一段有效行程"); return; }
    if (validSegments.some(s => !s.lineKey || !s.fromId || !s.toId)) { alert("请完善信息"); return; }
    const groupedTrips = [];
    let currentGroup = [validSegments[0]];
    for (let i = 1; i < validSegments.length; i++) {
       const prev = validSegments[i-1];
       const curr = validSegments[i];
       const meta1 = railwayData[prev.lineKey]?.meta;
       const meta2 = railwayData[curr.lineKey]?.meta;
       if (isCompanyCompatible(meta1, meta2)) { currentGroup.push(curr); } 
       else { groupedTrips.push(currentGroup); currentGroup = [curr]; }
    }
    groupedTrips.push(currentGroup);
    const newTripsToAdd = groupedTrips.map((segs, index) => ({ id: Date.now() + index, date: tripForm.date, cost: index === 0 ? (tripForm.cost || 0) : 0, suicaBalance: null, memo: tripForm.memo, segments: segs, lineKey: segs[0].lineKey, fromId: segs[0].fromId, toId: segs[segs.length-1].toId }));
    let nextTrips = [...trips];
    if (editingTripId) { nextTrips = nextTrips.filter(t => t.id !== editingTripId); }
    const finalTrips = [...newTripsToAdd, ...nextTrips].sort((a,b) => b.date.localeCompare(a.date));
    setTrips(finalTrips);

    // Sync to Cloud
    if (user) {
       api.saveData(user.token, finalTrips, pins).catch(e => alert('云端保存失败: ' + e.message));
    }

    setIsTripEditing(false); setEditingTripId(null); 
    setTripForm({ date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0 });
  };

  const handleEditTrip = (trip) => {
    const formState = trip.segments ? trip : { ...trip, segments: [{ id: 'legacy', lineKey: trip.lineKey, fromId: trip.fromId, toId: trip.toId }] };
    setTripForm(JSON.parse(JSON.stringify(formState))); setEditingTripId(trip.id); setIsTripEditing(true);
  };
  
  const handleDeleteTrip = (id) => {
      if (confirm('确认删除?')) {
          const newTrips = trips.filter(t => t.id !== id);
          setTrips(newTrips);
          if (user) {
             api.saveData(user.token, newTrips, pins).catch(e => alert('云端同步失败'));
          }
      }
  };
  
  const handleAutoRouteSearch = () => {
    const { startLine, startStation, endLine, endStation } = autoForm;
    if(!startLine || !startStation || !endLine || !endStation) return;
    setIsRouteSearching(true);
    setTimeout(() => {
        const result = findRoute(startLine, startStation, endLine, endStation, railwayData);
        if (result.error) { setIsRouteSearching(false); alert(`无法规划: ${result.error}`); } 
        else { 
            if(result.segments.length > 20) { setIsRouteSearching(false); alert("路径过长"); return; } 
            setTripForm(prev => ({ ...prev, segments: result.segments })); setEditorMode('manual'); 
            setTimeout(() => setIsRouteSearching(false), 200);
        }
    }, 1000); 
  };

  const togglePinMode = () => {
    if (pinMode === 'idle') { setPinMode('free'); createTempPin(); }
    else if (pinMode === 'free') { setPinMode('snap'); if(editingPin) { const snap = findNearestPointOnLine(railwayData, editingPin.lat, editingPin.lng); setEditingPin({...editingPin, ...snap}); } }
    else { setPinMode('idle'); setEditingPin(null); }
  };
  const createTempPin = () => { if (!mapInstance.current) return; const c = mapInstance.current.getCenter(); setEditingPin({ id: 'temp', lat: c.lat, lng: c.lng, type: 'photo', color: COLOR_PALETTE[0], isTemp: true }); mapInstance.current.panBy([0, 150]); };
  const savePin = () => {
      if (!editingPin) return;
      const newPin = { ...editingPin, id: editingPin.isTemp ? Date.now() : editingPin.id };
      delete newPin.isTemp;

      const newPins = editingPin.isTemp ? [...pins, newPin] : pins.map(p => p.id === newPin.id ? newPin : p);
      setPins(newPins);

      if (user) {
         api.saveData(user.token, trips, newPins).catch(e => console.error('Pin sync failed', e));
      }

      setEditingPin(null);
      setPinMode('idle');
  };
  const deletePin = (id) => {
      if(confirm('删除?')) {
          const newPins = pins.filter(p => p.id !== id);
          setPins(newPins);
          if (editingPin?.id === id) setEditingPin(null);

          if (user) {
            api.saveData(user.token, trips, newPins).catch(e => console.error('Pin sync failed', e));
          }
      }
  };
 
  const railLayerRef = useRef(null); 
  const initMap = () => {
    if (!mapRef.current || mapInstance.current ) return;
    const map = L.map(mapRef.current, { zoomControl: true, preferCanvas: true }).setView([35.68, 139.76], 10);
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 20 });
    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 20 });
    const rail = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { maxZoom: 20, opacity: 0, attribution: '© OpenRailwayMap' });
    railLayerRef.current = rail;
    
    dark.addTo(map); rail.addTo(map);
    L.control.layers({ "标准 (OSM)": osm, "暗色 (Dark)": dark }, { "铁道网 (OpenRailwayMap)": rail }, { position: 'topright' }).addTo(map);
    mapInstance.current = map;

    // 初始化图层（注意顺序影响 z-index）
    baseLinesLayer.current = L.layerGroup(); // 初始不 addTo(map)，由 updateLayerVisibility 控制
    baseStationsLayer.current = L.layerGroup().addTo(map); // 站点始终显示
    routeLayer.current = L.layerGroup().addTo(map);
    pinsLayer.current = L.layerGroup().addTo(map);

    const updateLayerVisibility = () => {
        const z = map.getZoom();

        // 1. OpenRailwayMap Tiles Logic
        if (railLayerRef.current) {
            railLayerRef.current.setOpacity(z >= 15 ? 0.7 : (z>=12 ? 0.4 : 0) );
        }

        // 2. Base Lines Logic
        // Low (<10): Hidden
        // Mid (10 <= z < 12): Visible
        // High (>=12): Hidden (ORM takes over)
        const showBaseLines = z >= 10 && z < 12;
        if (baseLinesLayer.current) {
            if (showBaseLines) {
                 if (!map.hasLayer(baseLinesLayer.current)) {
                     // Insert at bottom to not cover stations/routes if possible,
                     // though L.layerGroup order relies on insertion.
                     // addTo puts it in overlay pane.
                     // Leaflet vector layers don't strictly support z-index moving without logic,
                     // but usually adding it last puts it on top.
                     // We want lines BELOW stations.
                     // Since stations are already added, adding lines now might put them ON TOP of stations in SVG order.
                     // To fix this, we can use `bringToBack()` on the layer group if it supports it,
                     // or rely on `map.addLayer`.
                     // However, standard L.LayerGroup doesn't have bringToBack invoked on the group itself easily for all children?
                     // Actually, we can just add it. The stations are transparent dots anyway.
                     map.addLayer(baseLinesLayer.current);
                     // Try to push lines to back if possible so they don't cover dots
                     baseLinesLayer.current.invoke('bringToBack');
                 }
            } else {
                 if (map.hasLayer(baseLinesLayer.current)) map.removeLayer(baseLinesLayer.current);
            }
        }

        setMapZoom(z);
    };

    map.on('zoomend', updateLayerVisibility);
    updateLayerVisibility(); // Init

    map.on('click', (e) => { if (pinMode !== 'idle' && editingPin) { let newPos = { lat: e.latlng.lat, lng: e.latlng.lng }; if (pinMode === 'snap') newPos = findNearestPointOnLine(railwayData, newPos.lat, newPos.lng); setEditingPin(prev => ({ ...prev, ...newPos })); } });
    if (geoData && geoData.features.length > 0) { renderBaseMap(geoData); renderTripRoutes(); }
    renderPins();
  };

  const renderBaseMap = (data) => {
    if (!baseLinesLayer.current || !baseStationsLayer.current) return;
    baseLinesLayer.current.clearLayers();
    baseStationsLayer.current.clearLayers();

    // Render Lines
    L.geoJSON(data, {
      filter: (f) => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString',
      style: { color: '#475569', weight: 1, opacity: 0.3 },
      onEachFeature: (f, l) => f.properties.name && l.bindTooltip(f.properties.name)
    }).addTo(baseLinesLayer.current);

    // Render Stations
    L.geoJSON(data, {
      filter: (f) => f.properties.type === 'station',
      pointToLayer: (f, ll) => {
          return L.circleMarker(ll, { radius: 2, color: 'transparent', fillColor: '#64748b', fillOpacity: 0.5, weight: 0, className: 'station-dot' });
      },
      onEachFeature: (f, l) => f.properties.name && l.bindTooltip(f.properties.name)
    }).addTo(baseStationsLayer.current);

    // Refresh visibility state (in case data loaded at a zoom level where lines should be visible)
    if (mapInstance.current) {
        // Trigger the logic to ensure lines are added/removed correctly with new data content
        // We can manually call fire 'zoomend' or just replicate the logic check.
        // Re-firing zoomend is safest.
        mapInstance.current.fire('zoomend');
    }
  };


  const renderTripRoutes = () => {
    if (!routeLayer.current || !tripSegmentsGeometry) return;
    routeLayer.current.clearLayers();

    // Dynamic weight based on zoom
    const zoomWeight = mapZoom < 8 ? 2 : mapZoom < 12 ? 4 : mapZoom < 15 ? 6 : 9;

    tripSegmentsGeometry.forEach(seg => {
        const { coords, color, popup, isMulti, fallback } = seg;
        const options = {
            color,
            weight: zoomWeight,
            opacity: 0.9,
            lineCap: 'round',
            smoothFactor: 0.2,
            dashArray: fallback ? '5, 10' : null
        };

        if (isMulti) {
            coords.forEach(part => {
                L.polyline(part, options).bindPopup(popup).addTo(routeLayer.current);
            });
        } else {
             L.polyline(coords, options).bindPopup(popup).addTo(routeLayer.current);
        }
    });
  };

  const renderPins = () => {
    if (!pinsLayer.current) return;
    pinsLayer.current.clearLayers();
    const list = editingPin ? [...pins.filter(p => p.id !== editingPin.id), editingPin] : pins;
    list.forEach(pin => {
      const isEditing = editingPin?.id === pin.id;
      const icon = L.divIcon({ className: 'pin-marker-icon', html: `<div class="pin-content ${isEditing ? 'dragging' : ''}" style="background:${pin.color}; border-color:${isEditing?'#ffff00':'white'}; transform:${isEditing?'scale(1.2) rotate(45deg)':''}"> ${pin.type==='photo'?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>':'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'} </div>`, iconSize: [32, 32], iconAnchor: [16, 32] });
      const marker = L.marker([pin.lat, pin.lng], { icon, draggable: true, zIndexOffset: isEditing ? 1000 : 0 });
      marker.on('dragstart', () => { isDraggingRef.current = true; setEditingPin({ ...pin }); if (pinMode === 'idle') setPinMode('free'); });
      marker.on('dragend', (e) => { 
          isDraggingRef.current = false;
          const { lat, lng } = e.target.getLatLng(); 
          let newPos = { lat, lng }; 
          if (pinMode === 'snap') { const snap = findNearestPointOnLine(railwayData, lat, lng); newPos = { lat: snap.lat, lng: snap.lng, lineKey: snap.lineKey, percentage: snap.percentage }; e.target.setLatLng(newPos); } 
          setEditingPin(prev => prev && prev.id === pin.id ? { ...prev, ...newPos } : { ...pin, ...newPos }); 
          if (pinMode === 'idle') setPinMode('free'); 
      });
      marker.on('click', () => { setEditingPin(pin); if (pinMode === 'idle') setPinMode('free'); });
      marker.addTo(pinsLayer.current);
    });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-100 font-sans text-slate-800 overflow-hidden">
      <style>{LEAFLET_CSS}</style>
      <header className="bg-slate-900 text-white p-4 shadow-md z-30 flex justify-between shrink-0">
        <div className="flex items-center gap-2"><Train className="text-emerald-400"/> <span className="font-bold">RailRound</span></div>
        <div className="flex items-center gap-2">
            {user ? (
               <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-300 hidden sm:inline">欢迎, {user.username}</span>
                  <button onClick={handleLogout} className="bg-slate-700 hover:bg-red-900 p-2 rounded text-xs flex items-center gap-1 transition">
                      <LogOut size={14}/><span className="hidden sm:inline">退出</span>
                  </button>
               </div>
            ) : (
               <button onClick={() => setIsLoginOpen(true)} className="bg-blue-600 hover:bg-blue-500 p-2 rounded text-xs flex items-center gap-1 transition font-bold">
                   <User size={14}/><span className="hidden sm:inline">登录 / 注册</span>
               </button>
            )}

            {activeTab !== 'map' ? (
            <div className="flex gap-2 ml-2 border-l border-slate-700 pl-2">
               <button onClick={handleExportKML} className="cursor-pointer bg-emerald-700 hover:bg-emerald-600 p-2 rounded text-xs flex items-center gap-1 transition">
                   <Download size={14}/><span className="hidden sm:inline">导出 KML</span>
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
            <div className="flex gap-2 ml-2 border-l border-slate-700 pl-2">
                <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition"><Building2 size={14}/><span className="hidden sm:inline">数据</span><input type="file" accept=".json" className="hidden" onChange={handleCompanyUpload}/></label>
                <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition"><FilePlus size={14}/><span className="hidden sm:inline">地图</span><input type="file" multiple accept=".geojson,.json" className="hidden" onChange={handleFileUpload}/></label>
            </div>
            )}
        </div>
      </header>

      <div className="flex-1 relative overflow-hidden flex flex-col">
        {activeTab === 'records' && <RecordsView trips={trips} railwayData={railwayData} setTrips={setTrips} onEdit={handleEditTrip} onDelete={handleDeleteTrip} segmentGeometries={segmentGeometries} onAdd={() => { setTripForm({ date: new Date().toISOString().split('T')[0], memo: '', segments: [{ id: Date.now().toString(), lineKey: '', fromId: '', toId: '' }] }); setIsTripEditing(true); }} />}
        {activeTab === 'stats' && <StatsView trips={trips} railwayData={railwayData} geoData={geoData} user={user} userProfile={userProfile} segmentGeometries={segmentGeometries} />}
        <div className={`flex-1 relative ${activeTab === 'map' ? 'block' : 'hidden'}`}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          <FabButton activeTab={activeTab} pinMode={pinMode} togglePinMode={togglePinMode} />
          <PinEditor editingPin={editingPin} setEditingPin={setEditingPin} pinMode={pinMode} setPinMode={setPinMode} deletePin={deletePin} savePin={savePin} />
        </div>
      </div>
      <TripEditor isOpen={isTripEditing} onClose={() => setIsTripEditing(false)} isEditing={!!editingTripId} form={tripForm} setForm={setTripForm} onSave={handleSaveTrip} railwayData={railwayData} editorMode={editorMode} setEditorMode={setEditorMode} autoForm={autoForm} setAutoForm={setAutoForm} onAutoSearch={handleAutoRouteSearch} isRouteSearching={isRouteSearching} />

      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} onLoginSuccess={handleLoginSuccess} />

      {/* Line Selector */}
      <LineSelector isOpen={false} onClose={() => {}} onSelect={() => {}} railwayData={railwayData} /> 
      <nav className="bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30">
        {['records', 'map', 'stats'].map(t => <button key={t} onClick={()=>setActiveTab(t)} className={`p-2 rounded-lg ${activeTab===t ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>{t==='records' ? <Layers/> : t==='map' ? <MapIcon/> : <PieChart/>}</button>)}
      </nav>
    </div>
  );
}
