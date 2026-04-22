import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Train, Edit2, Trash2, Star, Plus, MapPin, Upload } from 'lucide-react';
import { useStore } from '../store';
import { DropZone } from '../components/DragContext';
import { getRouteVisualData } from '../core/tripCalculator';
import { computeLoopVia, getLandmarks, getStationById } from '../core/railwayRouting';
import { isMobile } from 'react-device-detect';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { LineLogo } from '../components/LineLogo';

const RouteSlice = React.memo(({ segments }: { segments: any[] }) => {
    const { t } = useTranslation();
    const { segmentGeometries, railwayData, geoData } = useStore(useShallow(state => ({
        segmentGeometries: state.segmentGeometries,
        railwayData: state.railwayData,
        geoData: state.geoData
    })));

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const measure = () => {
            if (containerRef.current) {
                const parent = containerRef.current.closest('.bg-white') as HTMLElement;
                if (parent) setContainerWidth(parent.offsetWidth);
            }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    const { visualPaths, totalDist, widthPx, heightPx } = useMemo(
        () => getRouteVisualData(segments, segmentGeometries, railwayData, geoData),
        [segments, segmentGeometries, railwayData, geoData]
    );

    if (visualPaths.length === 0) return <div className="w-28 shrink-0 flex items-center justify-center text-xs text-gray-200 ml-2 border-l border-gray-50">{t('tripsPage.noPreview', '无预览')}</div>;

    const maxWidth = Math.max(0, containerWidth - 300);
    const shouldRotate = isMobile && widthPx > maxWidth && maxWidth > 0;

    return (
        <div ref={containerRef} className="absolute right-2 top-1/2 -translate-y-1/2 z-0 opacity-50 pointer-events-none flex flex-row items-center justify-end gap-2" style={{ minWidth: shouldRotate ? '40px' : '100px' }}>
            <div style={{ width: shouldRotate ? heightPx : widthPx, height: shouldRotate ? widthPx : heightPx, maxWidth: shouldRotate ? 'none' : '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ width: widthPx, height: heightPx, transform: shouldRotate ? 'rotate(90deg)' : 'none', transformOrigin: 'center center' }}>
                    {visualPaths.map((item: any, idx: number) => (
                        <path key={idx} d={item.path} fill="none" stroke={item.color || '#94a3b8'} strokeWidth="4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    ))}
                </svg>
            </div>
            <div className="text-[10px] font-bold text-gray-800 shrink-0 text-right opacity-100">{Math.round(totalDist)}km</div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for segments array to avoid unnecessary re-renders
    if (prevProps.segments === nextProps.segments) return true;
    if (prevProps.segments?.length !== nextProps.segments?.length) return false;

    return prevProps.segments.every((seg, idx) => {
        const nextSeg = nextProps.segments[idx];
        return seg.id === nextSeg.id &&
            seg.lineKey === nextSeg.lineKey &&
            seg.fromId === nextSeg.fromId &&
            seg.toId === nextSeg.toId &&
            seg.loopVia === nextSeg.loopVia;
    });
});

import { useUserData } from '../hooks/useUserData';
import { processSuicaCSV } from '../utils/suicaParser';
import toast from 'react-hot-toast';
import { showConfirm } from '../utils/alerts';

export const TripsPage: React.FC = () => {
    const { trips, railwayData, segmentGeometries, user, pins, folders, badgeSettings } = useStore(useShallow(state => ({
        trips: state.trips,
        railwayData: state.railwayData,
        segmentGeometries: state.segmentGeometries,
        user: state.user,
        pins: state.pins,
        folders: state.folders,
        badgeSettings: state.badgeSettings
    })));
    const setModalState = useStore(state => state.setModalState);
    const startEditingTrip = useStore(state => state.startEditingTrip);
    const removeTrip = useStore(state => state.removeTrip);
    const addTrip = useStore(state => state.addTrip);
    const { saveData } = useUserData();
    const { t } = useTranslation();

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImportSuica = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        const toastId = toast.loading(t('tripsPage.parsingSuica', '解析 Suica CSV 数据...'));

        reader.onload = async (e) => {
            const text = e.target?.result as string;
            if (text) {
                try {
                    console.log("Started parsing Suica CSV...");
                    const { newTrips, skippedCount } = await processSuicaCSV(text, railwayData, trips);
                    console.log(`Successfully mapped ${newTrips.length} trips. Skipped ${skippedCount} duplicates.`);

                    if (newTrips.length > 0) {
                        toast.dismiss(toastId);
                        const skipMsg = skippedCount > 0 ? t('tripsPage.skipMsg', '\n(已跳过 {{count}} 条重复记录)', { count: skippedCount }) : '';
                        const confirmed = await showConfirm(
                            t('tripsPage.parseSuccessTitle', '解析成功'),
                            t('tripsPage.parseSuccess', '成功解析 {{count}} 条新行程。是否导入？{{skipMsg}}\n(按 F12 打开控制台查看详细匹配日志)', { count: newTrips.length, skipMsg: skipMsg })
                        );
                        if (confirmed) {
                            newTrips.forEach(trip => addTrip(trip));
                            const skipMsgShort = skippedCount > 0 ? t('tripsPage.skipMsgShort', ' (跳过 {{count}} 重复)', { count: skippedCount }) : '';
                            toast.success(t('tripsPage.importSuccess', '导入了 {{count}} 条行程！{{skipMsg}}', { count: newTrips.length, skipMsg: skipMsgShort }));
                            if (user) {
                                const updatedTrips = [...newTrips, ...trips].sort((a, b) => b.date.localeCompare(a.date));
                                saveData(user.token, updatedTrips, pins, folders, badgeSettings).catch((err: any) => toast.error(t('common.syncFail', '云端同步失败')));
                            }
                        }
                    } else {
                        if (skippedCount > 0) {
                            toast.success(t('tripsPage.allExist', '解析完成，但所有记录（{{count}}条）已存在，无需重复导入。', { count: skippedCount }), { id: toastId });
                        } else {
                            toast.error(t('tripsPage.noImport', '未找到可导入的行程，或者解析失败。'), { id: toastId });
                        }
                    }
                } catch (error) {
                    console.error("Error parsing Suica CSV:", error);
                    toast.error(t('tripsPage.readError', '读取或解析文件出错。'), { id: toastId });
                }
            }
        };
        reader.onerror = () => {
            toast.error(t('tripsPage.readError', '读取文件失败'), { id: toastId });
        }
        reader.readAsText(file);
        // Reset the input value so the same file can be selected again
        event.target.value = '';
    };

    const handleDeleteTrip = async (id: string | number) => {
        if (await showConfirm(t('common.deleteConfirm', '确认删除?'))) {
            removeTrip(id);
            if (user) {
                const newTrips = trips.filter(trip => trip.id !== id);
                saveData(user.token, newTrips, pins, folders, badgeSettings).catch((e: any) => toast.error(t('common.syncFail', '云端同步失败')));
            }
        }
    };

    return (
        <div className="relative h-full w-full flex flex-col overflow-hidden">
            <div id="trips-scroll-container" className="flex-1 flex flex-col overflow-y-auto p-4 space-y-3 pb-4">
                {trips.length === 0 ? (
                    <div className="text-center text-gray-400 py-10 flex flex-col items-center justify-center flex-1">
                        <Train size={48} className="opacity-20 mb-4" />
                        <p>{t('tripsPage.noTrips', '暂无行程记录')}</p>
                        <p className="text-xs mt-2">{t('tripsPage.addFirstTrip', '点击下方按钮添加你的第一次乗り鉄')}<br />{t('tripsPage.addFirstTripNote', '注意: 自定义线路可以导入 company_data 和 geojson')}</p>
                    </div>
                ) : (
                    trips.map(trip => {
                        const segments = trip.segments || [{ lineKey: trip.lineKey, fromId: trip.fromId, toId: trip.toId }];
                        const isWalk = trip.isWalk;

                        if (isWalk) {
                            let startName = trip.fromId || '';
                            let endName = trip.toId || '';
                            Object.values(railwayData).forEach(line => {
                                const s = line.stations.find(st => st.id === trip.fromId);
                                if (s) startName = s.name_ja;
                                const e = line.stations.find(st => st.id === trip.toId);
                                if (e) endName = e.name_ja;
                            });

                            const isTree = trip.walkType === 'tree';
                            const cls = {
                                bg: isTree ? 'bg-green-50' : 'bg-purple-50',
                                border: isTree ? 'border-green-100' : 'border-purple-100',
                                date: isTree ? 'text-green-400' : 'text-purple-400',
                                tagText: isTree ? 'text-green-600' : 'text-purple-500',
                                tagBg: isTree ? 'bg-green-200/50' : 'bg-purple-200/50',
                                btnEdit: isTree ? 'text-green-400 hover:text-green-600' : 'text-purple-400 hover:text-purple-600',
                                btnDel: isTree ? 'text-green-400 hover:text-red-500' : 'text-purple-400 hover:text-red-500',
                                icon: isTree ? 'text-green-500' : 'text-purple-500',
                                title: isTree ? 'text-green-700' : 'text-purple-700',
                                stations: isTree ? 'text-green-900' : 'text-purple-900',
                                arrow: isTree ? 'text-green-300' : 'text-purple-300',
                                memo: isTree ? 'text-green-600' : 'text-purple-600',
                                label: isTree ? t('tripsPage.walk', '步行') : t('tripsPage.hitchhike', '搭便车')
                            };

                            return (
                                <div key={trip.id} className={`${cls.bg} p-4 rounded-lg border ${cls.border} shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1 cursor-pointer`} onClick={() => useStore.getState().startEditingWalkTrip(trip)}>
                                    <div className={`flex justify-between mb-2 pb-2 border-b ${cls.border}`}>
                                        <span className={`text-xs font-bold ${cls.date}`}>{trip.date}</span>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-mono ${cls.tagText} ${cls.tagBg} px-1.5 py-0.5 rounded`}>{t('tripsPage.walk', '步行')}</span>
                                            <button onClick={(e) => { e.stopPropagation(); useStore.getState().startEditingWalkTrip(trip); }} className={cls.btnEdit}><Edit2 size={14} /></button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteTrip(trip.id); }} className={cls.btnDel}><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                    <div className="relative z-10 flex flex-row">
                                        <div className="flex-1 space-y-2 relative overflow-hidden">
                                            <div className="relative z-10 flex flex-col text-sm">
                                                <div className="flex items-center gap-2">
                                                    <MapPin size={14} className={`${cls.icon} shrink-0`} />
                                                    <span className={`font-bold ${cls.title} text-xs`}>{cls.label}</span>
                                                </div>
                                                <div className={`pl-5 font-medium ${cls.stations}`}>{startName} <span className={`${cls.arrow} mx-1`}>→</span> {endName}</div>
                                            </div>
                                        </div>
                                    </div>
                                    {trip.memo && <div className={`text-xs ${cls.memo} bg-white/60 p-2 rounded mt-3`}>{trip.memo}</div>}
                                </div>
                            );
                        }

                        return (
                            <div key={trip.id} className="bg-white p-4 rounded-lg border shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1">
                                <div className="flex justify-between mb-2 pb-2 border-b border-gray-50">
                                    <span className="text-xs font-bold text-gray-400">{trip.date}</span>
                                    <div className="flex items-center gap-2">
                                        {(trip.cost || 0) > 0 && <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">¥{trip.cost}</span>}
                                        <button onClick={() => setModalState({ addToFolderModalOpen: true, currentTripForFolder: trip })} className="text-gray-400 hover:text-yellow-500"><Star size={14} /></button>
                                        <button onClick={() => startEditingTrip(trip)} className="text-gray-400 hover:text-blue-500"><Edit2 size={14} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteTrip(trip.id); }} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                                    </div>
                                </div>
                                <div className="relative z-10 flex flex-row">
                                    <div className="flex-1 space-y-2 relative overflow-hidden">
                                        {segments.length > 1 && <div className="absolute left-[5px] top-2 bottom-2 w-0.5 bg-gray-200 z-0"></div>}
                                        {segments.map((seg, idx) => {
                                            const line = railwayData[seg.lineKey];
                                            const icon = line?.meta?.icon;
                                            const getSt = (id: string) => line?.stations.find(s => s.id === id)?.name_ja || id;
                                            return (
                                                <div key={idx} className="relative z-10 flex flex-col text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm shrink-0"></div>
                                                        {icon && <LineLogo src={icon} companyIcon={line?.meta?.companyIcon} recolor={line?.meta?.recolor} color={line?.meta?.color} className="line-icon" />}
                                                        <span className="font-bold text-emerald-700 text-xs">{seg.lineKey}</span>
                                                    </div>
                                                    <div className="pl-5 font-medium text-gray-700">{getSt(seg.fromId)} <span className="text-gray-300 mx-1">→</span> {getSt(seg.toId)}</div>
                                                    {(() => {
                                                        const isLoop = !!(line?.meta?.isLoop);
                                                        if (!isLoop) return null;
                                                        let realVia = seg.loopVia || 'auto';
                                                        if (realVia === 'auto') {
                                                            realVia = computeLoopVia(railwayData, seg.lineKey, seg.fromId, seg.toId);
                                                        }
                                                        const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}_${realVia}`;
                                                        const cachedLm = segmentGeometries.get(key)?.landmarks;

                                                        // 回退方案：实时计算地标
                                                        const lm = cachedLm || getLandmarks(line, seg.fromId, seg.toId, seg.loopVia);

                                                        return lm?.length > 0 ? (
                                                            <div className="pl-5 text-[11px] text-gray-400">{t('tripsPage.via', '经由 ')}{lm.join('、')}</div>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <RouteSlice segments={segments} />
                                </div>
                                {trip.memo && <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded mt-3">{trip.memo}</div>}
                            </div>
                        );
                    })
                )}
            </div>
            <FloatingActionButtons
                fileInputRef={fileInputRef}
                handleImportSuica={handleImportSuica}
                startEditingTrip={startEditingTrip}
                alwaysVisible={trips.length === 0}
            />
        </div>
    );
};

import { ArrowUp, ArrowDown } from 'lucide-react';

export const FloatingActionButtons: React.FC<{
    fileInputRef: React.RefObject<HTMLInputElement>,
    handleImportSuica: (event: React.ChangeEvent<HTMLInputElement>) => void,
    startEditingTrip: (data?: any) => void,
    alwaysVisible?: boolean
}> = ({ fileInputRef, handleImportSuica, startEditingTrip, alwaysVisible = false }) => {
    const { t } = useTranslation();
    const [isVisible, setIsVisible] = useState(true);
    const [isTutorialActive, setIsTutorialActive] = useState(false);
    const [scrollPos, setScrollPos] = useState<'top' | 'middle' | 'bottom'>('top');
    const [showScrollBtns, setShowScrollBtns] = useState(false);
    const [isHovering, setIsHovering] = useState(false);

    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollBtnsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastScrollYRef = useRef(0);
    const lastScrollTimeRef = useRef(Date.now());

    useEffect(() => {
        const handleTutorialStep = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail.id === 'add-trip') {
                setIsTutorialActive(true);
                setIsVisible(true);
            } else {
                setIsTutorialActive(false);
            }
        };
        document.addEventListener('tutorial:step-changed', handleTutorialStep);
        return () => document.removeEventListener('tutorial:step-changed', handleTutorialStep);
    }, []);

    useEffect(() => {
        if (alwaysVisible || isTutorialActive || isHovering) {
            setIsVisible(true);
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
            return;
        }

        const handleScroll = (e: Event) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            const currentScrollY = target.scrollTop;
            const currentTime = Date.now();

            const timeDiff = currentTime - lastScrollTimeRef.current;
            const scrollDiff = Math.abs(currentScrollY - lastScrollYRef.current);

            if (timeDiff > 0) {
                const speed = scrollDiff / timeDiff;
                // Show buttons if scroll speed exceeds threshold
                if (speed > 0.5) {
                    setIsVisible(true);

                    if (scrollTimeoutRef.current) {
                        clearTimeout(scrollTimeoutRef.current);
                    }

                    scrollTimeoutRef.current = setTimeout(() => {
                        if (!isHovering && !isTutorialActive && !alwaysVisible) {
                            setIsVisible(false);
                        }
                    }, 2000);
                }
            }

            lastScrollYRef.current = currentScrollY;
            lastScrollTimeRef.current = currentTime;

            // Scroll buttons logic
            setShowScrollBtns(false);
            if (scrollBtnsTimeoutRef.current) clearTimeout(scrollBtnsTimeoutRef.current);
            scrollBtnsTimeoutRef.current = setTimeout(() => {
                setShowScrollBtns(true);
            }, 500);

            // Position detection
            if (currentScrollY === 0) {
                setScrollPos('top');
            } else if (currentScrollY + target.clientHeight >= target.scrollHeight - 10) {
                setScrollPos('bottom');
                // Trigger visibility when reaching bottom
                setIsVisible(true);
                if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                scrollTimeoutRef.current = setTimeout(() => {
                    if (!isHovering && !isTutorialActive && !alwaysVisible) {
                        setIsVisible(false);
                    }
                }, 2000);
            } else {
                setScrollPos('middle');
            }
        };

        const handleWheelOrTouch = () => {
            const container = document.getElementById('trips-scroll-container');
            if (!container) return;
            const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
            if (isAtBottom) {
                setIsVisible(true);
                if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                scrollTimeoutRef.current = setTimeout(() => {
                    if (!isHovering && !isTutorialActive && !alwaysVisible) {
                        setIsVisible(false);
                    }
                }, 2000);
            }
        };

        const container = document.getElementById('trips-scroll-container');

        // Also check if container is actually scrollable. If not scrollable, keep visible.
        const checkScrollable = () => {
            if (container) {
                if (container.scrollHeight <= container.clientHeight) {
                    setIsVisible(true);
                    if (scrollTimeoutRef.current) {
                        clearTimeout(scrollTimeoutRef.current);
                    }
                } else if (isVisible && !scrollTimeoutRef.current) {
                    scrollTimeoutRef.current = setTimeout(() => {
                        setIsVisible(false);
                    }, 3000);
                }
            }
        };

        if (container) {
            container.addEventListener('scroll', handleScroll);
            container.addEventListener('wheel', handleWheelOrTouch);
            container.addEventListener('touchmove', handleWheelOrTouch);
            // Run initial check
            setTimeout(checkScrollable, 100);
            window.addEventListener('resize', checkScrollable);

            // Initial position check
            if (container.scrollTop === 0) setScrollPos('top');
            setShowScrollBtns(true);
        }

        // Initial fade out timer (only if not empty and scrollable)
        if (!alwaysVisible && !isTutorialActive) {
            scrollTimeoutRef.current = setTimeout(() => {
                if (container && container.scrollHeight > container.clientHeight && !isHovering) {
                    setIsVisible(false);
                }
            }, 3000);
        }

        return () => {
            if (container) {
                container.removeEventListener('scroll', handleScroll);
                container.removeEventListener('wheel', handleWheelOrTouch);
                container.removeEventListener('touchmove', handleWheelOrTouch);
            }
            window.removeEventListener('resize', checkScrollable);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            if (scrollBtnsTimeoutRef.current) clearTimeout(scrollBtnsTimeoutRef.current);
        };
    }, [alwaysVisible, isTutorialActive, isHovering]);

    const scrollToTop = (e: React.MouseEvent<HTMLButtonElement>) => {
        document.getElementById('trips-scroll-container')?.scrollTo({ top: 0, behavior: 'smooth' });
        e.currentTarget.blur();
    };

    const scrollToBottom = (e: React.MouseEvent<HTMLButtonElement>) => {
        const container = document.getElementById('trips-scroll-container');
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        e.currentTarget.blur();
    };

    return (
        <div className="absolute bottom-4 left-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none">
            {/* Scroll Buttons */}
            <div className={`flex flex-col gap-2 mr-2 transition-opacity duration-300 pointer-events-auto ${showScrollBtns ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {scrollPos !== 'top' && (
                    <button onClick={scrollToTop} className="bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-md border border-gray-100 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors active:scale-95 touch-manipulation">
                        <ArrowUp size={20} />
                    </button>
                )}
                {scrollPos !== 'bottom' && (
                    <button onClick={scrollToBottom} className="bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-md border border-gray-100 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors active:scale-95 touch-manipulation">
                        <ArrowDown size={20} />
                    </button>
                )}
            </div>

            <div
                className={`w-full transition-opacity duration-500 ease-in-out pointer-events-auto ${isVisible || alwaysVisible || isTutorialActive || isHovering ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                onTouchStart={() => setIsHovering(true)}
                onTouchEnd={() => {
                    setTimeout(() => setIsHovering(false), 2000);
                }}
            >
                <DropZone onDrop={(item: any) => {
                    if (item.type === 'station') {
                        const newSegments = [{ id: Date.now().toString(), lineKey: item.lineKey, fromId: item.id, toId: '' }];
                        startEditingTrip({ date: new Date().toISOString().split('T')[0], memo: '', segments: newSegments, cost: 0 });
                    }
                }}>
                    <div className="flex gap-2 p-2 rounded-2xl">
                        <button id="btn-add-trip" onClick={() => startEditingTrip()} className="flex-1 py-3 border-1 border-gray-300 text-gray-500 backdrop-blur-sm  shadow-lg rounded-xl hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300 font-bold transition-all duration-300 active:scale-[0.98] group flex items-center justify-center gap-2">
                            <Plus className="group-hover:rotate-90 transition-transform duration-300" size={18} /> {t('tripsPage.recordNewTrip', '记录新行程')}
                        </button>
                        <button onClick={() => fileInputRef.current?.click()} className="flex-none px-4 py-3 border-1 border-gray-300 text-gray-500 backdrop-blur-sm  shadow-lg rounded-xl hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 font-bold transition-all duration-300 active:scale-[0.98] group flex items-center justify-center gap-2" title={t('tripsPage.importSuica', '导入 Suica CSV')}>
                            <Upload size={18} />
                        </button>
                        <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleImportSuica} />
                    </div>
                </DropZone>
            </div>
        </div>
    );
};
