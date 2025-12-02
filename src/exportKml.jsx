import React, { useState } from 'react';
import buildKMLString from './buildKml';
import { sliceGeoJsonPath } from './utils/geoUtils';

const handleExportKML = async () => {
    if (isExportingKML) return;
    setIsExportingKML(true);
    
    // 异步执行 KML 生成，防止阻塞主线程
    setTimeout(async () => {
        try {
            if (trips.length === 0 || !geoData || !window.turf) {
                alert("无行程数据或地图数据未加载。");
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
            link.download = `RailLog_KML_export_${new Date().toISOString().slice(0, 10)}.kml`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            console.error("KML Export Error:", e);
            alert("导出过程中发生错误。");
        } finally {
            setIsExportingKML(false);
        }
    }, 10); // 10ms 延迟，确保 UI 线程更新 Loading 状态
};
