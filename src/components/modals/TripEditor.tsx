import React, { useState, useEffect, useMemo } from 'react';
import { Edit2, Plus, X, ListFilter, AlertTriangle, ArrowRightLeft, ArrowDown, Search, Loader2, CheckCircle2, GitMerge, Route } from 'lucide-react';
import { useStore, EditorMode, type Trip } from '../../store';
import { DropZone } from '../DragContext';
import { StationLineSearchModal, SearchModalMode } from './StationSearchModal';
import { LineLogo } from '../LineLogo';
import { isCompanyCompatible, getTransferableLines, computeLoopVia, getLandmarks } from '../../core/railwayRouting'; // Will need to ensure these are typed
import { calcDist } from '../../core/tripCalculator';
import { useShallow } from 'zustand/react/shallow';
import { useUserData } from '../../hooks/useUserData';
import { useTranslation } from 'react-i18next';
import { showAlert, showConfirm } from '../../utils/alerts';
import { buildNetworkDisplayModel } from '../../utils/networkDisplay';
import { planAppRouteCandidates, type AppRouteCandidate } from '../../utils/appRoutePlanner';
import { tripResultToLegacyTrip } from '../../utils/railGraphTripAdapter';
import { buildTripDetailModel, tripDetailKeyEvents } from '../../utils/railGraphTripDetailModel';
import { RailGraphBadge, RailGraphEventPill } from '../rail-graph/RailGraphBadges';

type AutoPlanStatus =
    | { kind: 'rail_graph'; count?: number }
    | { kind: 'legacy'; reason?: string }
    | { kind: 'error'; source: 'legacy' | 'rail_graph'; reason?: string };

type PlannerBadgeTone = 'ready' | 'loading' | 'fallback' | 'error';
type PlannerBadgeIcon = 'ready' | 'loading' | 'fallback' | 'error';

interface PlannerBadge {
    tone: PlannerBadgeTone;
    icon: PlannerBadgeIcon;
    label: string;
    title?: string;
    spin?: boolean;
}

export const TripEditor: React.FC = () => {
    const {
        isOpen, isEditing, form, editorMode, autoForm, isRouteSearching, railwayData, railGraphRuntime, railGraphLoadState, segmentGeometries, trips, pins, folders, badgeSettings, user, isAprilFool, autoRouteEasterEggType, mileageUserEvents
    } = useStore(useShallow(state => ({
        isOpen: state.isTripEditing,
        isEditing: !!state.editingTripId,
        form: state.tripForm,
        editorMode: state.editorMode,
        autoForm: state.autoForm,
        isRouteSearching: state.isRouteSearching,
        railwayData: state.railwayData,
        railGraphRuntime: state.railGraphRuntime,
        railGraphLoadState: state.railGraphLoadState,
        segmentGeometries: state.segmentGeometries,
        trips: state.trips,
        pins: state.pins,
        folders: state.folders,
        badgeSettings: state.badgeSettings,
        user: state.user,
        isAprilFool: state.isAprilFool,
        autoRouteEasterEggType: state.autoRouteEasterEggType,
        mileageUserEvents: state.mileageUserEvents
    })));

    const setForm = useStore(state => state.setTripForm);
    const setEditorMode = useStore(state => state.setEditorMode);
    const setAutoForm = useStore(state => state.setAutoForm);
    const setIsRouteSearching = useStore(state => state.setIsRouteSearching);
    const closeEditor = useStore(state => state.closeTripEditor);
    const setTrips = useStore(state => state.setTrips);
    const { saveData } = useUserData();

    const { t } = useTranslation();
    const [stationModalOpen, setStationModalOpen] = useState(false);
    const [stationModalMode, setStationModalMode] = useState<SearchModalMode>('line');
    const [selectorTarget, setSelectorTarget] = useState<{ type: string; index?: number } | null>(null);
    const [allowedLines, setAllowedLines] = useState<string[] | null>(null);
    const [autoPlanStatus, setAutoPlanStatus] = useState<AutoPlanStatus | null>(null);
    const [autoPlanCandidates, setAutoPlanCandidates] = useState<AppRouteCandidate[]>([]);
    const [appliedCandidateId, setAppliedCandidateId] = useState<string | null>(null);

    const setManualSegmentsForm = (next: Parameters<typeof setForm>[0]) => {
        setAutoPlanStatus(null);
        setAutoPlanCandidates([]);
        setAppliedCandidateId(null);
        setForm(next);
    };

    useEffect(() => {
        if (!isOpen) {
            setAutoPlanStatus(null);
            setAutoPlanCandidates([]);
            setAppliedCandidateId(null);
        }
    }, [isOpen]);

    useEffect(() => {
        setAutoPlanStatus(null);
        setAutoPlanCandidates([]);
        setAppliedCandidateId(null);
    }, [autoForm.startLine, autoForm.startStation, autoForm.endLine, autoForm.endStation]);

    const currentTripDetail = useMemo(() => {
        if (!form.railGraph?.tripResult) return null;
        const detailTrip: Trip = {
            id: form.id ?? form.railGraph.tripResult.tripId ?? 'trip-editor-draft',
            date: form.date || new Date().toISOString().split('T')[0],
            cost: form.cost || 0,
            memo: form.memo || '',
            segments: form.segments || [],
            railGraph: form.railGraph,
            lineKey: form.lineKey,
            fromId: form.fromId,
            toId: form.toId,
        };
        return buildTripDetailModel({
            trip: detailTrip,
            railwayData,
            userEvents: mileageUserEvents,
        });
    }, [form, railwayData, mileageUserEvents]);

    const onSave = async () => {
        // Validation logic
        const validSegments = form.segments?.filter(s => s.fromId !== s.toId) || [];
        if (validSegments.length === 0) { showAlert(t("tripEdit.atLeastOne", "至少包含一段有效行程")); return; }
        if (validSegments.some(s => !s.lineKey || !s.fromId || !s.toId)) { showAlert(t("tripEdit.fillInfo", "请完善信息")); return; }

        let hasDisconnect = false;
        for (let i = 1; i < validSegments.length; i++) {
            const prev = validSegments[i - 1];
            const curr = validSegments[i];
            const prevSt = railwayData[prev.lineKey]?.stations.find(s => s.id === prev.toId);
            const currSt = railwayData[curr.lineKey]?.stations.find(s => s.id === curr.fromId);
            if (prevSt && currSt) {
                const dist = calcDist(prevSt.lat, prevSt.lng, currSt.lat, currSt.lng);
                if (dist > 0.5 && prevSt.name_ja !== currSt.name_ja) {
                    hasDisconnect = true;
                    break;
                }
            }
        }
        if (hasDisconnect) {
            const confirm = await showConfirm(t('tripEdit.disconnectTitle', '行程断连提示'), t('tripEdit.disconnectMsg', '检测到中间存在不相连的独立行程段，强行保存可能会破坏结构。确定要保存吗？'));
            if (!confirm) return;
        }

        // Resolve 'auto' loops to permanent 'up' or 'down'
        const resolvedSegments = validSegments.map(seg => {
            const line = railwayData[seg.lineKey];
            let realVia = seg.loopVia;
            if (line?.meta?.isLoop && (!realVia || realVia === 'auto')) {
                realVia = computeLoopVia(railwayData, seg.lineKey, seg.fromId, seg.toId);
            }
            return { ...seg, loopVia: realVia };
        });

        const autoCompletedTransferCount = resolvedSegments.reduce((sum, seg) => {
            const displayModel = buildNetworkDisplayModel(seg, railwayData);
            return sum + (displayModel?.autoGeneratedTransferCount || 0);
        }, 0);
        if (autoCompletedTransferCount > 0) {
            showAlert(
                t('tripEdit.autoTransferFilled', '已自动补全换乘事件：{{count}} 处', { count: autoCompletedTransferCount }),
                '',
                'info'
            );
        }

        const hasRailGraphSnapshot = !!form.railGraph?.tripResult;
        const newTripsToAdd = hasRailGraphSnapshot
            ? [{
                id: Date.now(),
                date: form.date || new Date().toISOString().split('T')[0],
                cost: form.cost || 0,
                memo: form.memo || '',
                segments: resolvedSegments,
                railGraph: form.railGraph,
                lineKey: resolvedSegments[0].lineKey,
                fromId: resolvedSegments[0].fromId,
                toId: resolvedSegments[resolvedSegments.length - 1].toId,
            }]
            : (() => {
                const groupedTrips: any[] = [];
                let currentGroup = [resolvedSegments[0]];
                for (let i = 1; i < resolvedSegments.length; i++) {
                    const prev = resolvedSegments[i - 1];
                    const curr = resolvedSegments[i];
                    const meta1 = railwayData[prev.lineKey]?.meta;
                    const meta2 = railwayData[curr.lineKey]?.meta;
                    if (isCompanyCompatible(meta1, meta2)) { currentGroup.push(curr); }
                    else { groupedTrips.push(currentGroup); currentGroup = [curr]; }
                }
                groupedTrips.push(currentGroup);
                return groupedTrips.map((segs, index) => ({
                    id: Date.now() + index,
                    date: form.date || new Date().toISOString().split('T')[0],
                    cost: index === 0 ? (form.cost || 0) : 0,
                    memo: form.memo || '',
                    segments: segs,
                    lineKey: segs[0].lineKey,
                    fromId: segs[0].fromId,
                    toId: segs[segs.length - 1].toId
                }));
            })();

        let nextTrips = [...trips];
        const editingTripId = useStore.getState().editingTripId;
        if (editingTripId) { nextTrips = nextTrips.filter(trip => trip.id !== editingTripId); }
        const finalTrips = [...newTripsToAdd, ...nextTrips].sort((a, b) => b.date.localeCompare(a.date));

        setTrips(finalTrips);
        if (user) {
            saveData(user.token, finalTrips, pins, folders, badgeSettings).catch((e: any) => showAlert(t('tripEdit.saveFail', '云端保存失败: ') + e.message, '', 'error'));
        }
        closeEditor();
    };

    // React to the Easter Egg triggered by the Map Drag
    useEffect(() => {
        if (autoRouteEasterEggType && isOpen) {
            const { startLine, startStation, endLine, endStation } = autoForm;
            const isTree = autoRouteEasterEggType === 'tree';

            const timer = setTimeout(() => {
                // Create a basic walk trip
                const walkType: 'tree' | 'ufo' = isTree ? 'tree' : 'ufo';
                const walkTrip = {
                    date: form.date || new Date().toISOString().split('T')[0],
                    memo: isTree ? '🌲 环保少女教育成果 - 步行旅程' : '🛸 无限非概率驱动 - 步行旅程',
                    cost: 0,
                    isWalk: true,
                    walkType,
                    fromId: startStation,
                    toId: endStation,
                    lineKey: 'WALK',
                    segments: []
                };

                setIsRouteSearching(false);
                closeEditor(); // Close standard editor, which also resets the easter egg type
                useStore.getState().startEditingWalkTrip(walkTrip); // Open Walk Editor
            }, 2000); // 2 second animation delay

            return () => clearTimeout(timer);
        }
    }, [autoRouteEasterEggType, isOpen, autoForm, form.date]);

    const onAutoSearch = (retryWithInfiniteSearch = false) => {
        const isInfinite = retryWithInfiniteSearch === true;
        const { startLine, startStation, endLine, endStation } = autoForm;
        if (!startLine || !startStation || !endLine || !endStation) return;

        // --- April Fool's Map Auto-Plan Hijack ---
        const rand = Math.random();
        if (isAprilFool && !isInfinite && rand < 1 / 3) {
            const type = rand < 1 / 6 ? 'ufo' : 'tree';
            useStore.getState().setAutoRouteEasterEggType(type);
            setIsRouteSearching(true);
            return; // `useEffect` will take over
        }

        setAutoPlanStatus(null);
        setAutoPlanCandidates([]);
        setIsRouteSearching(true);
        setTimeout(() => {
            const result = planAppRouteCandidates({
                startLineKey: startLine,
                startStationId: startStation,
                endLineKey: endLine,
                endStationId: endStation,
                railwayData,
                railGraphRuntime,
                maxTransfersOverride: isInfinite ? -1 : 6
            });
            if (result.status === 'error') {
                setIsRouteSearching(false);
                setAutoPlanCandidates([]);
                setAutoPlanStatus({
                    kind: 'error',
                    source: result.source,
                    reason: result.railGraphFallbackReason || result.error
                });
                if (!isInfinite && result.error.includes("超出最大换乘次数")) {
                    setTimeout(async () => {
                        const wantRetry = await showConfirm(
                            t('tripEdit.autoFailTitle', '换乘超限'),
                            t("tripEdit.autoMaxLimit", "自动规划超出6次换乘限制或无解。\n是否继续无限制深度搜索？(这可能需要较长等待时间)")
                        );
                        if (wantRetry) {
                            onAutoSearch(true);
                        }
                    }, 100);
                } else {
                    setTimeout(() => {
                        showAlert(`${t("tripEdit.autoFail", "无法规划: ")}${result.error}`, '', 'error');
                    }, 100);
                }
            }
            else {
                const resultSegments = result.best.segments ?? [];
                if (resultSegments.length > 20) {
                    setIsRouteSearching(false);
                    setAutoPlanCandidates([]);
                    setAutoPlanStatus({ kind: 'error', source: result.source, reason: t("tripEdit.pathTooLong", "路径过长") });
                    showAlert(t("tripEdit.pathTooLong", "路径过长"), '', 'warning');
                    return;
                }
                setAutoPlanCandidates(result.candidates);
                setAutoPlanStatus(result.source === 'rail_graph'
                    ? { kind: 'rail_graph', count: result.candidates.length }
                    : { kind: 'legacy', reason: result.railGraphFallbackReason });
                setTimeout(() => setIsRouteSearching(false), 200);
            }
        }, 1000);
    };

    useEffect(() => {
        const handleAutoSearchRequest = () => {
            if (!useStore.getState().isTripEditing) return;
            window.setTimeout(() => onAutoSearch(false), 0);
        };
        window.addEventListener('trip-editor:auto-search-request', handleAutoSearchRequest);
        return () => window.removeEventListener('trip-editor:auto-search-request', handleAutoSearchRequest);
    }, [onAutoSearch]);

    const applyRouteCandidate = (candidate: AppRouteCandidate) => {
        if (candidate.source === 'rail_graph') {
            const plannedTrip = tripResultToLegacyTrip(candidate.trip.tripResult, candidate.trip.runtimeArtifacts);
            setForm({
                ...plannedTrip,
                date: form.date || plannedTrip.date,
                memo: form.memo || plannedTrip.memo,
                cost: form.cost ?? plannedTrip.cost,
            });
            setAutoPlanStatus({ kind: 'rail_graph', count: autoPlanCandidates.filter(item => item.source === 'rail_graph').length || 1 });
        } else {
            setForm({ segments: candidate.segments, railGraph: undefined });
            setAutoPlanStatus({ kind: 'legacy', reason: candidate.railGraphFallbackReason });
        }
        setAppliedCandidateId(candidate.candidateId);
        setEditorMode(EditorMode.Manual);
    };

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeEditor();
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                if (editorMode === EditorMode.Manual) onSave();
                else onAutoSearch();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeEditor, onSave, onAutoSearch, editorMode]);

    if (!isOpen) return null;

    const plannerBadgeClasses: Record<PlannerBadgeTone, string> = {
        ready: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        loading: 'bg-sky-50 text-sky-700 border-sky-100',
        fallback: 'bg-amber-50 text-amber-700 border-amber-100',
        error: 'bg-red-50 text-red-700 border-red-100',
    };

    const plannerReasonTitle = (reason?: string) => reason
        ? t('tripEdit.plannerReason', 'Reason: {{reason}}', { reason })
        : undefined;

    const renderPlannerIcon = (badge: PlannerBadge) => {
        if (badge.icon === 'loading') return <Loader2 size={12} className={badge.spin ? 'animate-spin' : undefined} />;
        if (badge.icon === 'ready') return <CheckCircle2 size={12} />;
        if (badge.icon === 'fallback') return <GitMerge size={12} />;
        return <AlertTriangle size={12} />;
    };

    const renderPlannerBadge = (badge: PlannerBadge, compact = false) => (
        <div
            className={`inline-flex items-center gap-1.5 border rounded-full ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'} font-semibold ${plannerBadgeClasses[badge.tone]}`}
            title={badge.title}
            aria-live="polite"
        >
            {renderPlannerIcon(badge)}
            <span>{badge.label}</span>
        </div>
    );

    const autoPlannerBadge: PlannerBadge = (() => {
        if (isRouteSearching) {
            return {
                tone: 'loading',
                icon: 'loading',
                spin: true,
                label: t('tripEdit.plannerSearching', 'Searching route')
            };
        }
        if (autoPlanStatus?.kind === 'rail_graph') {
            return {
                tone: 'ready',
                icon: 'ready',
                label: t('tripEdit.plannerRailGraphCandidates', '{{count}} rail graph candidates', { count: autoPlanStatus.count || autoPlanCandidates.length || 1 })
            };
        }
        if (autoPlanStatus?.kind === 'legacy') {
            return {
                tone: 'fallback',
                icon: 'fallback',
                label: t('tripEdit.plannerLegacyResult', 'Planned by legacy search'),
                title: plannerReasonTitle(autoPlanStatus.reason)
            };
        }
        if (autoPlanStatus?.kind === 'error') {
            return {
                tone: 'error',
                icon: 'error',
                label: t('tripEdit.plannerError', 'Planner error'),
                title: plannerReasonTitle(autoPlanStatus.reason)
            };
        }
        if (railGraphRuntime) {
            return {
                tone: 'ready',
                icon: 'ready',
                label: t('tripEdit.plannerReady', 'Rail graph ready')
            };
        }
        if (railGraphLoadState.status === 'idle' || railGraphLoadState.status === 'loading') {
            return {
                tone: 'loading',
                icon: 'loading',
                spin: railGraphLoadState.status === 'loading',
                label: t('tripEdit.plannerLoading', 'Rail graph loading')
            };
        }
        return {
            tone: 'fallback',
            icon: 'fallback',
            label: t('tripEdit.plannerFallback', 'Legacy planner'),
            title: plannerReasonTitle(railGraphLoadState.fallbackReason || railGraphLoadState.reason)
        };
    })();

    const headerPlannerBadge: PlannerBadge | null = form.railGraph?.tripResult
        ? {
            tone: 'ready',
            icon: 'ready',
            label: t('tripEdit.railGraphSnapshot', 'Rail graph snapshot')
        }
        : autoPlanStatus?.kind === 'legacy'
            ? {
                tone: 'fallback',
                icon: 'fallback',
                label: t('tripEdit.plannerLegacyResult', 'Planned by legacy search'),
                title: plannerReasonTitle(autoPlanStatus.reason)
            }
            : autoPlanStatus?.kind === 'error'
                ? {
                    tone: 'error',
                    icon: 'error',
                    label: t('tripEdit.plannerError', 'Planner error'),
                    title: plannerReasonTitle(autoPlanStatus.reason)
                }
                : null;

    const directionText = (direction?: string) => {
        if (!direction) return t('tripEdit.detailUnknown', 'Unknown');
        if (direction === 'up') return t('tripEdit.direction.up', 'Up');
        if (direction === 'down') return t('tripEdit.direction.down', 'Down');
        if (direction === 'clockwise') return t('tripEdit.direction.clockwise', 'Clockwise');
        if (direction === 'counterclockwise') return t('tripEdit.direction.counterclockwise', 'Counterclockwise');
        return direction;
    };

    const candidateKindLabel = (candidate: AppRouteCandidate) => {
        if (candidate.candidateKind === 'preset') return t('tripEdit.candidatePreset', 'Preset');
        if (candidate.candidateKind === 'pattern') return t('tripEdit.candidatePattern', 'Pattern');
        if (candidate.candidateKind === 'auto') return t('tripEdit.candidateAuto', 'Auto');
        return t('tripEdit.candidateLegacy', 'Legacy');
    };

    const eventTypeLabel = (type: string) => {
        if (type === 'departure') return t('tripEdit.event.departure', 'Departure');
        if (type === 'arrival') return t('tripEdit.event.arrival', 'Arrival');
        if (type === 'transfer') return t('tripEdit.event.transfer', 'Transfer');
        if (type === 'scenic') return t('tripEdit.event.scenic', 'Scenic');
        if (type === 'stop') return t('tripEdit.event.stop', 'Stop');
        if (type === 'pass') return t('tripEdit.event.pass', 'Pass');
        if (type === 'user_event') return t('tripEdit.event.user', 'User event');
        if (type === 'note') return t('tripEdit.event.note', 'Note');
        return type;
    };

    const formatKm = (value?: number) => t('tripEdit.km', '{{value}} km', { value: Math.max(0, value || 0).toFixed(1) });
    const formatMinutes = (value?: number) => t('tripEdit.minutes', '{{count}} min', { count: Math.max(0, value || 0) });
    const compactRailGraphRef = (value?: unknown) => {
        const text = String(value ?? '').trim();
        if (!text) return '';
        const cut = Math.max(text.lastIndexOf(':'), text.lastIndexOf('/'), text.lastIndexOf('#'));
        const label = cut >= 0 ? text.slice(cut + 1) : text;
        return label || text;
    };
    const patternCount = railGraphRuntime ? Object.keys(railGraphRuntime.system.graph.indexes.patternById).length : 0;
    const railGraphCandidateCount = autoPlanCandidates.filter(candidate => candidate.source === 'rail_graph').length;
    const legacyCandidateCount = autoPlanCandidates.filter(candidate => candidate.source === 'legacy').length;

    const renderPlannerSourceStrip = () => {
        const fallbackReason = autoPlanStatus?.kind === 'legacy'
            ? autoPlanStatus.reason
            : autoPlanStatus?.kind === 'error'
                ? autoPlanStatus.reason
                : railGraphLoadState.fallbackReason || railGraphLoadState.reason;
        return (
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-white/80 p-3 text-[11px] text-slate-600 sm:grid-cols-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-bold text-slate-700">
                        <RailGraphBadge
                            icon="snapshot"
                            value={t('tripEdit.railGraphPlannerSource', 'Rail graph runtime')}
                            tone={railGraphRuntime ? 'emerald' : 'slate'}
                            className="rounded"
                        />
                    </div>
                    <div className="mt-1 leading-relaxed text-slate-500">
                        {railGraphRuntime
                            ? t('tripEdit.railGraphPlannerReadyDetail', '{{presets}} presets · {{patterns}} patterns loaded', {
                                presets: railGraphRuntime.deployed.generatedPresets.length,
                                patterns: patternCount,
                            })
                            : t('tripEdit.railGraphPlannerUnavailableDetail', 'Not loaded; auto routing can still use legacy GeoJSON.')}
                    </div>
                    {fallbackReason && (
                        <div className="mt-1 line-clamp-2 text-amber-700">
                            {t('tripEdit.plannerReason', 'Reason: {{reason}}', { reason: fallbackReason })}
                        </div>
                    )}
                </div>
                <div className="min-w-0 border-t border-slate-100 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                    <div className="flex items-center gap-1.5 font-bold text-slate-700">
                        <Route size={13} className="text-blue-600" />
                        {t('tripEdit.currentPlannerOutput', 'Current output')}
                    </div>
                    <div className="mt-1 leading-relaxed text-slate-500">
                        {autoPlanCandidates.length > 0
                            ? t('tripEdit.candidateSourceSummary', '{{railGraph}} rail graph · {{legacy}} legacy', {
                                railGraph: railGraphCandidateCount,
                                legacy: legacyCandidateCount,
                            })
                            : t('tripEdit.candidateSourceEmpty', 'Search to compare rail-graph candidates and legacy fallback.')}
                    </div>
                    <div className="mt-1 text-slate-400">
                        {t('tripEdit.savedSnapshotHint', 'Choosing a rail-graph candidate saves a run snapshot; manual edits return to GeoJSON segments.')}
                    </div>
                </div>
            </div>
        );
    };

    const renderManualSourceStrip = () => {
        if (currentTripDetail?.kind === 'rail_graph') {
            return (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 text-xs text-slate-600">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                                <RailGraphBadge
                                    icon="snapshot"
                                    value={t('tripEdit.manualRailGraphTitle', 'Editing saved rail-graph snapshot')}
                                    tone="emerald"
                                    className="rounded"
                                />
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-emerald-700">
                                {t('tripEdit.manualRailGraphDetail', '{{segments}} segments · {{events}} user events · saved geometry and pattern metadata will be kept on save.', {
                                    segments: currentTripDetail.segments.length,
                                    events: currentTripDetail.overview.userEventCount,
                                })}
                            </div>
                        </div>
                        {renderPlannerBadge({
                            tone: 'ready',
                            icon: 'ready',
                            label: t('tripEdit.railGraphSnapshot', 'Rail graph snapshot'),
                        }, true)}
                    </div>
                    <div className="mt-2 rounded-md bg-white/80 px-2 py-1.5 text-[11px] text-slate-500">
                        {t('tripEdit.manualSnapshotEditWarning', 'Changing line segments below converts this trip back to editable GeoJSON segments. Use auto planning to choose a new rail-graph snapshot.')}
                    </div>
                </div>
            );
        }

        const segmentCount = form.segments?.filter(segment => segment.lineKey || segment.fromId || segment.toId).length ?? 0;
        return (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-bold text-slate-700">
                            <RailGraphBadge
                                icon="legacy"
                                value={t('tripEdit.manualLegacyTitle', 'Editing GeoJSON route segments')}
                                tone="slate"
                                className="rounded"
                            />
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                            {t('tripEdit.manualLegacyDetail', '{{count}} segments · compatible with imported GeoJSON and legacy records.', { count: segmentCount })}
                        </div>
                    </div>
                    {autoPlanStatus?.kind === 'legacy' && renderPlannerBadge({
                        tone: 'fallback',
                        icon: 'fallback',
                        label: t('tripEdit.plannerLegacyResult', 'Planned by legacy search'),
                        title: plannerReasonTitle(autoPlanStatus.reason),
                    }, true)}
                </div>
            </div>
        );
    };

    const renderRouteCandidates = () => {
        if (autoPlanCandidates.length === 0) return null;
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-600">
                        {t('tripEdit.candidatesTitle', 'Route candidates')}
                    </div>
                    <div className="text-[11px] text-slate-400">
                        {t('tripEdit.candidatesCount', '{{count}} options', { count: autoPlanCandidates.length })}
                    </div>
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {autoPlanCandidates.map((candidate) => {
                        const applied = appliedCandidateId === candidate.candidateId;
                        return (
                        <button
                            key={candidate.candidateId}
                            type="button"
                            aria-pressed={applied}
                            className={`w-full rounded-lg border bg-white p-3 text-left shadow-sm transition active:scale-[0.99] ${
                                applied
                                    ? candidate.source === 'rail_graph'
                                        ? 'border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-100'
                                        : 'border-amber-300 bg-amber-50/60 ring-2 ring-amber-100'
                                    : candidate.source === 'rail_graph'
                                        ? 'border-emerald-100 hover:border-emerald-200 hover:bg-emerald-50/40'
                                        : 'border-amber-100 hover:border-amber-200 hover:bg-amber-50/40'
                            }`}
                            onClick={() => applyRouteCandidate(candidate)}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${candidate.source === 'rail_graph' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                            {candidateKindLabel(candidate)}
                                        </span>
                                        <span className="truncate text-sm font-bold text-slate-800">{candidate.label}</span>
                                    </div>
                                        {candidate.description && (
                                            <div className="mt-0.5 truncate text-[11px] text-slate-400">{candidate.description}</div>
                                        )}
                                    </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                    <span className={candidate.source === 'rail_graph'
                                        ? applied
                                            ? 'rounded-md bg-white px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200'
                                            : 'rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white'
                                        : applied
                                            ? 'rounded-md bg-white px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200'
                                            : 'rounded-md bg-amber-600 px-2 py-1 text-xs font-semibold text-white'}
                                    >
                                        {applied ? t('tripEdit.candidateApplied', 'Applied') : t('tripEdit.useCandidate', 'Use')}
                                    </span>
                                    <span className={candidate.source === 'rail_graph'
                                        ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700'
                                        : 'rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700'}
                                    >
                                        {candidate.source === 'rail_graph'
                                            ? t('tripEdit.candidateSavesSnapshot', 'Saves snapshot')
                                            : t('tripEdit.candidateUsesLegacy', 'GeoJSON fallback')}
                                    </span>
                                </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                {candidate.source === 'rail_graph' ? (
                                    <>
                                        <RailGraphBadge
                                            icon="service"
                                            value={candidate.serviceType || t('tripEdit.detailUnknown', 'Unknown')}
                                            tone="sky"
                                            className="rounded"
                                        />
                                        <RailGraphBadge
                                            icon="direction"
                                            value={directionText(candidate.directionLabel || candidate.direction)}
                                            tone="amber"
                                            className="rounded"
                                        />
                                        <RailGraphBadge
                                            icon="via"
                                            value={t('tripEdit.viaStationCount', '{{count}} via', { count: candidate.viaStationCount })}
                                            tone="slate"
                                            className="rounded"
                                        />
                                        <RailGraphBadge icon="duration" value={formatMinutes(candidate.totalTimeMinutes)} tone="slate" className="rounded" />
                                        <RailGraphBadge icon="distance" value={formatKm(candidate.totalDistanceKm)} tone="slate" className="rounded" />
                                        {candidate.patternRef && (
                                            <RailGraphBadge
                                                icon="pattern"
                                                label={t('tripEdit.candidatePatternRef', 'Pattern ref')}
                                                value={compactRailGraphRef(candidate.patternRef)}
                                                tone="indigo"
                                                className="max-w-[12rem] rounded"
                                                title={String(candidate.patternRef)}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <RailGraphBadge
                                            icon="legacy"
                                            value={t('tripEdit.plannerLegacyResult', 'Planned by legacy search')}
                                            tone="slate"
                                            className="rounded"
                                        />
                                        {candidate.estimatedTime !== undefined && (
                                            <RailGraphBadge icon="duration" value={formatMinutes(candidate.estimatedTime)} tone="slate" className="rounded" />
                                        )}
                                    </>
                                )}
                            </div>
                            {candidate.source === 'rail_graph' && candidate.keyEventLabels.length > 0 && (
                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                    <span className="text-[10px] font-bold uppercase text-emerald-700">
                                        {t('tripEdit.keyEvents', 'Events')}
                                    </span>
                                    {candidate.keyEventLabels.map((label) => (
                                        <RailGraphEventPill key={label} type="note" label={label} title={label} className="max-w-[10rem]" />
                                    ))}
                                </div>
                            )}
                            {candidate.source === 'legacy' && candidate.railGraphFallbackReason && (
                                <div className="mt-2 line-clamp-2 text-[11px] text-amber-700">
                                    {t('tripEdit.plannerReason', 'Reason: {{reason}}', { reason: candidate.railGraphFallbackReason })}
                                </div>
                            )}
                        </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderRailGraphSnapshotDetail = () => {
        if (!currentTripDetail || currentTripDetail.kind !== 'rail_graph') return null;
        const keyEvents = tripDetailKeyEvents(currentTripDetail, 4);
        return (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                            <RailGraphBadge
                                icon="snapshot"
                                value={t('tripEdit.snapshotDetailTitle', 'Rail graph run')}
                                tone="emerald"
                                className="rounded"
                            />
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold text-slate-800">
                            {currentTripDetail.overview.title}
                        </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-slate-500">
                        <div>{formatKm(currentTripDetail.overview.totalDistanceKm)}</div>
                        {currentTripDetail.overview.totalTimeMinutes !== undefined && (
                            <div>{formatMinutes(currentTripDetail.overview.totalTimeMinutes)}</div>
                        )}
                    </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                    <RailGraphBadge
                        icon="snapshot"
                        value={t('tripEdit.snapshotPersistence', 'Saved as trip snapshot')}
                        tone="emerald"
                        className="rounded bg-white"
                    />
                    <RailGraphBadge
                        icon="service"
                        label={t('tripEdit.planUsed', 'Plan')}
                        value={currentTripDetail.overview.planUsed || t('tripEdit.detailUnknown', 'Unknown')}
                        tone="sky"
                        className="rounded bg-white"
                    />
                    {currentTripDetail.overview.presetId && (
                        <RailGraphBadge
                            icon="pattern"
                            label={t('tripEdit.presetId', 'Preset')}
                            value={compactRailGraphRef(currentTripDetail.overview.presetId)}
                            tone="indigo"
                            title={currentTripDetail.overview.presetId}
                            className="max-w-[12rem] rounded bg-white"
                        />
                    )}
                    <RailGraphBadge
                        icon="userEvent"
                        value={t('tripEdit.userEventCount', '{{count}} user events', { count: currentTripDetail.overview.userEventCount })}
                        tone="violet"
                        className="rounded bg-white"
                    />
                </div>
                <div className="mt-3 space-y-2">
                    {currentTripDetail.segments.map((segment) => (
                        <div key={segment.id} className="rounded-md border border-emerald-100 bg-white px-2 py-2">
                            <div className="flex min-w-0 items-center gap-2 text-xs">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.displayColor || '#10b981' }} />
                                <span className="truncate font-bold text-slate-800">{segment.lineLabel}</span>
                                <span className="shrink-0 text-slate-400">{directionText(segment.direction)}</span>
                                {segment.serviceType && <span className="shrink-0 text-slate-400">{segment.serviceType}</span>}
                            </div>
                            <div className="mt-1 truncate pl-4 text-[11px] text-slate-600">
                                {segment.fromName} <span className="text-slate-300">→</span> {segment.toName}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1 pl-4 text-[10px] text-slate-500">
                                <RailGraphBadge
                                    icon="stops"
                                    value={t('tripEdit.stopPassSummary', '{{stops}} stops / {{passes}} pass', { stops: segment.stopCount, passes: segment.passCount })}
                                    tone="slate"
                                    className="rounded"
                                />
                                <RailGraphBadge
                                    icon="via"
                                    value={t('tripEdit.viaStationCount', '{{count}} via', { count: segment.viaStationCount })}
                                    tone="slate"
                                    className="rounded"
                                />
                                {segment.userEventCount > 0 && (
                                    <RailGraphBadge
                                        icon="userEvent"
                                        value={t('tripEdit.userEventCount', '{{count}} user events', { count: segment.userEventCount })}
                                        tone="violet"
                                        className="rounded"
                                    />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                {keyEvents.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                        {keyEvents.map((event) => (
                            <RailGraphEventPill
                                key={event.id}
                                type={event.type}
                                label={`${eventTypeLabel(event.type)} · ${event.label}`}
                                title={event.label}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const openSelector = (targetType: string, index: number | null = null, allowed: string[] | null = null) => {
        setSelectorTarget({ type: targetType, index: index !== null ? index : undefined });
        setAllowedLines(allowed);
        setStationModalMode('line');
        setStationModalOpen(true);
    };

    const openSearch = (targetType: string, index: number | null = null) => {
        setSelectorTarget({ type: targetType, index: index !== null ? index : undefined });
        setStationModalMode('search');
        setStationModalOpen(true);
    };

    const handleStationLineSelect = (lineKey: string, stationId?: string) => {
        if (!selectorTarget) return;
        const { type, index } = selectorTarget;

        if (type === 'segment' && index !== undefined && form.segments) {
            const newSegs = [...form.segments];
            const seg = { ...newSegs[index], lineKey, fromId: stationId || '', toId: '' };
            if (index > 0 && !stationId) {
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
            setManualSegmentsForm({ segments: newSegs, railGraph: undefined });
        } else if (type === 'autoStart') {
            setAutoForm({ ...autoForm, startLine: lineKey, startStation: stationId || '' });
        } else if (type === 'autoEnd') {
            setAutoForm({ ...autoForm, endLine: lineKey, endStation: stationId || '' });
        }
        setStationModalOpen(false);
    };

    const addSegment = () => {
        if ((form.segments?.length || 0) >= 10) { showAlert(t("tripEdit.maxSegment", "最多 10 段"), '', 'warning'); return; }
        
        const currentSegments = form.segments || [];
        const prevSegment = currentSegments.length > 0 ? currentSegments[currentSegments.length - 1] : null;
        
        let currentAllowed: string[] | null = null;
        if (prevSegment && prevSegment.lineKey && prevSegment.toId) {
            const prevLineData = railwayData[prevSegment.lineKey];
            const prevEndSt = prevLineData?.stations.find((s: any) => s.id === prevSegment.toId);
            if (prevLineData && prevEndSt) {
                const allKeys = Object.keys(railwayData);
                currentAllowed = allKeys.filter(lineKey => {
                    const currentMeta = railwayData[lineKey]?.meta;
                    if (!currentMeta || !isCompanyCompatible(prevLineData.meta, currentMeta)) return false;
                    const transferable = getTransferableLines(prevEndSt, prevSegment.lineKey, railwayData, true);
                    return transferable.includes(lineKey) || lineKey === prevSegment.lineKey;
                });
            }
        }

        const newSegs = [...currentSegments, { id: Date.now().toString(), lineKey: '', fromId: '', toId: '', loopVia: 'auto' as const }];
        setManualSegmentsForm({ segments: newSegs, railGraph: undefined });

        // Auto open the line selector for the newly added segment
        openSelector('segment', currentSegments.length, currentAllowed);
    };

    const updateSegment = (idx: number, field: string, val: any) => {
        if (!form.segments) return;
        const newSegs = [...form.segments];
        const seg: any = { ...newSegs[idx], [field]: val };
        // 修改 toId 且是环线时，若无方向则默认为 auto
        if (field === 'toId' && val && seg.lineKey && railwayData[seg.lineKey]?.meta?.isLoop) {
            if (!seg.loopVia) {
                seg.loopVia = 'auto';
            }
        }
        if (field === 'toId' && idx < newSegs.length - 1) {
            newSegs[idx + 1] = { ...newSegs[idx + 1], lineKey: '', fromId: '', toId: '' };
        }
        newSegs[idx] = seg;
        setManualSegmentsForm({ segments: newSegs, railGraph: undefined });
    };

    const removeSegment = (idx: number) => {
        if (!form.segments) return;
        setManualSegmentsForm({ segments: form.segments.filter((_, i) => i !== idx), railGraph: undefined });
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4 animate-fade-in">
                <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-slide-up relative overflow-hidden">
                    {isRouteSearching && (
                        <div className="train-animation-layer">
                            {autoRouteEasterEggType === 'ufo' ? (
                                <div className="flex flex-col items-center justify-center h-full pt-10">
                                    <svg viewBox="0 0 100 50" className="ufo-body w-24 h-12 mb-2 animate-bounce" preserveAspectRatio="none">
                                        <ellipse cx="50" cy="20" rx="20" ry="10" fill="#a855f7" opacity="0.8" />
                                        <path d="M 10 30 Q 50 50 90 30 Q 50 40 10 30 Z" fill="#9333ea" />
                                        <circle cx="50" cy="15" r="8" fill="#d8b4fe" opacity="0.6" />
                                        <circle cx="25" cy="30" r="3" fill="#f3e8ff" className="animate-pulse" />
                                        <circle cx="50" cy="33" r="3" fill="#f3e8ff" className="animate-pulse" style={{ animationDelay: '0.2s' }} />
                                        <circle cx="75" cy="30" r="3" fill="#f3e8ff" className="animate-pulse" style={{ animationDelay: '0.4s' }} />
                                    </svg>
                                    <div className="text-purple-600 font-bold tracking-widest text-sm bg-white/80 px-4 py-1 rounded-full shadow-sm animate-pulse">启动无限非概率驱动...</div>
                                </div>
                            ) : autoRouteEasterEggType === 'tree' ? (
                                <div className="flex flex-col items-center justify-center h-full w-full relative">
                                    <style>
                                        {`
                            @keyframes growLine { from { stroke-dasharray: 0, 1000; } to { stroke-dasharray: 1000, 1000; } }
                            @keyframes scaleUp { 0% { transform: scale(0); opacity: 0; } 50% { opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
                            .tree-ground { stroke-dasharray: 0, 1000; animation: growLine 1s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
                            .tree-1 { transform-origin: 20px 40px; transform: scale(0); animation: scaleUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s forwards; }
                            .tree-2 { transform-origin: 50px 40px; transform: scale(0); animation: scaleUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.6s forwards; }
                            .tree-3 { transform-origin: 80px 40px; transform: scale(0); animation: scaleUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.9s forwards; }
                            `}
                                    </style>
                                    <svg viewBox="0 0 100 50" className="w-48 h-24 mb-2 overflow-visible">
                                        {/* Ground Line */}
                                        <path d="M 0 40 L 100 40" stroke="#4ade80" strokeWidth="2" className="tree-ground" fill="none" />

                                        {/* Tree 1: Dark, Tallest */}
                                        <g className="tree-1">
                                            <rect x="18" y="25" width="4" height="15" fill="#78350f" rx="1" />
                                            <circle cx="20" cy="18" r="14" fill="#14532d" />
                                            <circle cx="20" cy="18" r="14" fill="#166534" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)' }} />
                                        </g>

                                        {/* Tree 2: Medium, Mid-height */}
                                        <g className="tree-2">
                                            <rect x="48.5" y="30" width="3" height="10" fill="#92400e" rx="1" />
                                            <circle cx="50" cy="24" r="10" fill="#166534" />
                                            <circle cx="50" cy="24" r="10" fill="#15803d" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)' }} />
                                        </g>

                                        {/* Tree 3: Light, Shortest */}
                                        <g className="tree-3">
                                            <rect x="79" y="33" width="2" height="7" fill="#b45309" rx="0.5" />
                                            <circle cx="80" cy="28" r="7" fill="#15803d" />
                                            <circle cx="80" cy="28" r="7" fill="#22c55e" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)' }} />
                                        </g>
                                    </svg>
                                    <div className="text-green-700 font-bold tracking-widest text-sm bg-white/80 px-4 py-1 rounded-full shadow-sm animate-pulse">接受环保少女教育中...</div>
                                </div>
                            ) : (
                                <>
                                    <svg viewBox="0 0 100 30" className="train-body" preserveAspectRatio="none"><path d="M 5 20 L 15 5 H 95 L 100 20 H 5 Z" fill="#e2e8f0" stroke="#3b82f6" strokeWidth="1" /><path d="M 5 20 Q 0 20 2 10 L 15 5" fill="none" stroke="#3b82f6" strokeWidth="1" /><rect x="20" y="8" width="10" height="5" fill="#3b82f6" rx="1" /><rect x="35" y="8" width="10" height="5" fill="#3b82f6" rx="1" /><rect x="50" y="8" width="10" height="5" fill="#3b82f6" rx="1" /><rect x="65" y="8" width="10" height="5" fill="#3b82f6" rx="1" /><rect x="10" y="16" width="90" height="2" fill="#3b82f6" /></svg>
                                    <div className="speed-line" style={{ top: '40%', left: '10%', width: '50px', animationDelay: '0s' }}></div>
                                    <div className="speed-line" style={{ top: '60%', left: '20%', width: '80px', animationDelay: '0.2s' }}></div>
                                    <div className="speed-line" style={{ top: '30%', left: '50%', width: '40px', animationDelay: '0.1s' }}></div>
                                </>
                            )}
                        </div>
                    )}

                    <div className="p-4 border-b bg-gray-50 relative z-10">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800">
                                {isEditing ? <Edit2 size={18} /> : <Plus size={18} />}
                                {isEditing ? t('tripEdit.editTitle', '编辑行程') : t('tripEdit.newTitle', '新行程')}
                            </h3>
                            <button id="btn-close-editor" onClick={closeEditor}><X className="text-gray-400 hover:text-gray-600" /></button>
                        </div>
                        <div id="trip-editor-toggle-mode" className="grid grid-cols-2 p-1 bg-gray-200 rounded-lg relative isolate overflow-hidden">
                            <div 
                                className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white shadow rounded-md z-0 transition-transform duration-300 ease-out`} 
                                style={{ transform: editorMode === EditorMode.Manual ? 'translateX(0)' : 'translateX(100%)', left: '4px' }} 
                            />
                            <button onClick={() => setEditorMode(EditorMode.Manual)} className={`py-1.5 text-sm font-bold rounded-md z-10 transition-colors duration-300 ${editorMode === EditorMode.Manual ? 'text-gray-800' : 'text-gray-500'}`}>{t('tripEdit.manual', '手动输入')}</button>
                            <button onClick={() => setEditorMode(EditorMode.Auto)} className={`py-1.5 text-sm font-bold rounded-md z-10 transition-colors duration-300 ${editorMode === EditorMode.Auto ? 'text-blue-600' : 'text-slate-500'}`}>{t('tripEdit.auto', '自动规划')}</button>
                        </div>
                        {headerPlannerBadge && (
                            <div className="mt-2 flex justify-end">
                                {renderPlannerBadge(headerPlannerBadge, true)}
                            </div>
                        )}
                    </div>

                    {editorMode === EditorMode.Manual && (
                        <div className="p-6 space-y-6 overflow-y-auto">
                            {renderManualSourceStrip()}
                            <input type="date" className="w-full p-2 border rounded bg-gray-50 font-bold text-gray-800" value={form.date || ''} onChange={e => setForm({ date: e.target.value })} />

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1 flex items-center gap-1"><span className="font-bold text-gray-600">¥</span> {t('tripEdit.money', '金额 (JPY)')}</label>
                                <input type="number" className="w-full p-2 border rounded text-sm" placeholder="0" value={form.cost || ''} onChange={e => setForm({ cost: parseInt(e.target.value) || 0 })} />
                            </div>

                            {renderRailGraphSnapshotDetail()}

                            <div className="space-y-3">
                                {form.segments?.map((segment, idx) => {
                                    const prevSegment = idx > 0 ? form.segments![idx - 1] : null;
                                    const prevLineData = prevSegment ? railwayData[prevSegment.lineKey] : null;
                                    const prevEndSt = prevLineData ? prevLineData.stations.find(s => s.id === prevSegment!.toId) : null;
                                    const prevEndStName = prevEndSt?.name_ja;

                                    let currentAllowed: string[] | null = null;
                                    let warning: string | null = null;
                                    let isDisconnected = false;

                                    if (prevLineData && prevEndStName && prevEndSt) {
                                        const allKeys = Object.keys(railwayData);
                                        currentAllowed = allKeys.filter(lineKey => {
                                            if (lineKey === segment.lineKey) return true;
                                            const currentMeta = railwayData[lineKey]?.meta;
                                            if (!currentMeta || !isCompanyCompatible(prevLineData.meta, currentMeta)) return false;
                                            const transferable = getTransferableLines(prevEndSt, prevSegment!.lineKey, railwayData, true);
                                            return transferable.includes(lineKey);
                                        });
                                        if (currentAllowed.length === 0 && !segment.lineKey) warning = t('tripEdit.noTransferWarning', '无可换乘的同公司/JR线路');
                                        
                                        if (segment.lineKey && segment.fromId) {
                                            const currLineData = railwayData[segment.lineKey];
                                            const currStartSt = currLineData?.stations.find(s => s.id === segment.fromId);
                                            if (currStartSt) {
                                                const dist = calcDist(prevEndSt.lat, prevEndSt.lng, currStartSt.lat, currStartSt.lng);
                                                if (dist > 0.5 && prevEndSt.name_ja !== currStartSt.name_ja) {
                                                    isDisconnected = true;
                                                }
                                            }
                                        }
                                    }

                                    return (
                                        <div key={segment.id} className={`p-3 rounded-lg border relative group transition-colors duration-300 ${isDisconnected ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                                            <div className="absolute -left-3 top-3 w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm border-2 border-white z-10">{idx + 1}</div>
                                            <button onClick={() => removeSegment(idx)} className="absolute -right-2 -top-2 p-1 bg-white text-red-500 rounded-full shadow border border-gray-100 hover:bg-red-50 z-20"><X size={14} /></button>

                                            <div className="mb-2 pl-2">
                                                <div className="flex rounded shadow-sm w-full border bg-white overflow-hidden">
                                                    <button
                                                        onClick={() => openSelector('segment', idx, currentAllowed)}
                                                        className="flex-1 p-2 text-sm font-bold text-gray-700 text-left flex items-center justify-between hover:bg-gray-50 transition-colors border-r"
                                                    >
                                                        <span className={segment.lineKey ? "text-gray-800" : "text-gray-400"}>
                                                            {segment.lineKey ? (
                                                                <span className="flex items-center gap-2">
                                                                    {railwayData[segment.lineKey]?.meta.icon && <LineLogo src={railwayData[segment.lineKey].meta.icon!} companyIcon={railwayData[segment.lineKey].meta.companyIcon} recolor={railwayData[segment.lineKey]?.meta.recolor} color={railwayData[segment.lineKey]?.meta.color} className="h-4 w-auto" />}
                                                                    {segment.lineKey}
                                                                </span>
                                                            ) : (idx === 0 ? t('tripEdit.selLine', '选择路线...') : t('tripEdit.selTransfer', '选择换乘路线...'))}
                                                        </span>
                                                        <ListFilter size={16} className="text-gray-400" />
                                                    </button>
                                                    <button
                                                        onClick={() => openSearch('segment', idx)}
                                                        className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-500 transition-colors flex items-center justify-center w-10 shrink-0"
                                                        title={t('search.placeholder', '搜索线路或车站...')}
                                                    >
                                                        <Search size={16} />
                                                    </button>
                                                </div>
                                                {warning && <div className="text-xs text-orange-500 mt-1"><AlertTriangle size={12} className="inline" /> {warning}</div>}
                                                {isDisconnected && <div className="text-xs text-red-500 mt-1 font-bold animate-pulse"><AlertTriangle size={12} className="inline" /> {t('tripEdit.disconnected', '起始站与上一程终点不相连')}</div>}
                                            </div>

                                            <div className="grid grid-cols-[1fr,auto,1fr] gap-2 pl-2 items-center">
                                                <DropZone onDrop={(item: any) => {
                                                    if (item.type === 'station') {
                                                        const newSegs = [...form.segments!];
                                                        newSegs[idx] = { ...newSegs[idx], lineKey: item.lineKey, fromId: item.id };
                                                        setManualSegmentsForm({ segments: newSegs, railGraph: undefined });
                                                    }
                                                }}>
                                                    <select className="w-full p-2 border rounded text-xs bg-white" value={segment.fromId} onChange={e => updateSegment(idx, 'fromId', e.target.value)}>
                                                        <option value="">{t('tripEdit.board', '乘车...')}</option>
                                                        {segment.lineKey && railwayData[segment.lineKey]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}
                                                    </select>
                                                </DropZone>

                                                <button
                                                    className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                                                    onClick={() => {
                                                        const newSegs = [...form.segments!];
                                                        newSegs[idx] = { ...newSegs[idx], fromId: segment.toId, toId: segment.fromId };
                                                        setManualSegmentsForm({ segments: newSegs, railGraph: undefined });
                                                    }}
                                                >
                                                    <ArrowRightLeft size={12} />
                                                </button>

                                                <DropZone onDrop={(item: any) => {
                                                    if (item.type === 'station') {
                                                        const newSegs = [...form.segments!];
                                                        const update = { ...newSegs[idx], toId: item.id };
                                                        if (!update.lineKey) update.lineKey = item.lineKey;
                                                        if (update.lineKey && update.lineKey !== item.lineKey) {
                                                            update.lineKey = item.lineKey;
                                                            update.fromId = '';
                                                        }
                                                        newSegs[idx] = update;
                                                        setManualSegmentsForm({ segments: newSegs, railGraph: undefined });
                                                    }
                                                }}>
                                                    <select className="w-full p-2 border rounded bg-white text-xs" value={segment.toId} onChange={e => updateSegment(idx, 'toId', e.target.value)}>
                                                        <option value="">{t('tripEdit.alight', '下车...')}</option>
                                                        {segment.lineKey && railwayData[segment.lineKey]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}
                                                    </select>
                                                </DropZone>
                                            </div>

                                            {/* 环线经由选择 + landmark 显示 */}
                                            {segment.lineKey && railwayData[segment.lineKey]?.meta?.isLoop && (
                                                <div className="pl-2 mt-2 space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] text-gray-400">环线经由</span>
                                                        <select
                                                            className="text-[11px] border rounded px-1.5 py-0.5 bg-white text-gray-600 focus:ring-1 focus:ring-blue-500 outline-none"
                                                            value={segment.loopVia || 'auto'}
                                                            onChange={e => updateSegment(idx, 'loopVia', e.target.value)}
                                                        >
                                                            <option value="auto">自动 (Auto)</option>
                                                            <option value="up">内回り (Up)</option>
                                                            <option value="down">外回り (Down)</option>
                                                        </select>
                                                    </div>
                                                    {(() => {
                                                        const line = railwayData[segment.lineKey];
                                                        const isLoop = !!line?.meta?.isLoop;
                                                        if (!isLoop) return null;

                                                        // 优先尝试从 Geometry 缓存取 (如果已经算好了)
                                                        let realVia = segment.loopVia || 'auto';
                                                        if (realVia === 'auto') {
                                                            realVia = computeLoopVia(railwayData, segment.lineKey, segment.fromId, segment.toId);
                                                        }
                                                        const loopKey = `${segment.lineKey}_${segment.fromId}_${segment.toId}_${realVia}`;
                                                        const cachedLm = segmentGeometries.get(loopKey)?.landmarks;

                                                        // 如果缓存没有（因为 Worker 慢），则由主线程实时计算显示
                                                        const lm = cachedLm || getLandmarks(line, segment.fromId, segment.toId, segment.loopVia);

                                                        return lm?.length > 0 ? (
                                                            <div className="text-[11px] text-gray-400">{lm.join('・')} 方面</div>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <button onClick={addSegment} disabled={(form.segments?.length || 0) >= 10} className="w-full py-2 border-2 border-dashed border-gray-300 text-gray-400 rounded-lg hover:bg-gray-50 hover:text-gray-600 hover:border-gray-400 transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 group"><Plus className="group-hover:rotate-180 transition-transform duration-500" size={16} /> {t('tripEdit.addTransfer', '添加换乘 / 下一程')}</button>
                            <textarea className="w-full p-2 border rounded h-20 bg-gray-50 focus:ring-2 focus:ring-emerald-200 outline-none transition-all duration-300" placeholder={t('tripEdit.memoPlaceholder', "备注...")} value={form.memo || ''} onChange={e => setForm({ memo: e.target.value })} />
                        </div>
                    )}

                    {editorMode === EditorMode.Auto && (
                        <div className="p-6 space-y-6 flex-1 overflow-y-auto transition-opacity duration-300">
                            <div id="auto-planning-form" className="space-y-4 bg-blue-50 p-4 rounded-lg border border-blue-100 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-300 via-blue-500 to-blue-300 opacity-50"></div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                                        {t('tripEdit.plannerStatus', 'Planner')}
                                    </span>
                                    {renderPlannerBadge(autoPlannerBadge)}
                                </div>
                                {renderPlannerSourceStrip()}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">{t('tripEdit.start', '出发地')}</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="flex rounded border bg-white overflow-hidden">
                                            <button onClick={() => openSelector('autoStart')} className="flex-1 p-2 text-sm text-left text-gray-700 truncate flex items-center gap-1 hover:bg-gray-50 border-r">{autoForm.startLine ? <span>{autoForm.startLine}</span> : <span className="text-gray-400">{t('tripEdit.selLine', '选择线路...')}</span>}</button>
                                            <button onClick={() => openSearch('autoStart')} className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-500 w-10 shrink-0 flex items-center justify-center"><Search size={16} /></button>
                                        </div>
                                        <select className="p-2 rounded border text-sm" disabled={!autoForm.startLine} value={autoForm.startStation} onChange={e => setAutoForm({ ...autoForm, startStation: e.target.value })}><option value="">{t('tripEdit.station', '车站...')}</option>{autoForm.startLine && railwayData[autoForm.startLine]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                                    </div>
                                </div>
                                <div className="flex justify-center text-blue-300"><ArrowDown className="animate-bounce" size={20} /></div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">{t('tripEdit.end', '目的地')}</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="flex rounded border bg-white overflow-hidden">
                                            <button onClick={() => openSelector('autoEnd')} className="flex-1 p-2 text-sm text-left text-gray-700 truncate flex items-center gap-1 hover:bg-gray-50 border-r">{autoForm.endLine ? <span>{autoForm.endLine}</span> : <span className="text-gray-400">{t('tripEdit.selLine', '选择线路...')}</span>}</button>
                                            <button onClick={() => openSearch('autoEnd')} className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-500 w-10 shrink-0 flex items-center justify-center"><Search size={16} /></button>
                                        </div>
                                        <select className="p-2 rounded border text-sm" disabled={!autoForm.endLine} value={autoForm.endStation} onChange={e => setAutoForm({ ...autoForm, endStation: e.target.value })}><option value="">{t('tripEdit.station', '车站...')}</option>{autoForm.endLine && railwayData[autoForm.endLine]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => onAutoSearch(false)} disabled={isRouteSearching} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] active:translate-y-0 transition-all duration-300 disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:scale-100 disabled:hover:shadow-none group">
                                {isRouteSearching ? <Loader2 className="animate-spin" /> : <Search className="group-hover:scale-110 transition-transform duration-300" size={18} />}
                                {isRouteSearching ? t('tripEdit.planning', '规划中...') : t('tripEdit.searchRoute', '搜索推荐路线')}
                            </button>
                            {renderRouteCandidates()}
                            <div className="text-xs text-center text-slate-400">{t('tripEdit.autoWarning', '仅支持同一公司或JR集团内的换乘搜索')}</div>
                        </div>
                    )}
                    {editorMode === EditorMode.Manual && <div className="p-4 border-t"><button onClick={onSave} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-500 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] active:translate-y-0 transition-all duration-300">{t('tripEdit.save', '保存行程')}</button></div>}
                </div>
            </div>

            <StationLineSearchModal 
                isOpen={stationModalOpen} 
                initialMode={stationModalMode} 
                onClose={() => setStationModalOpen(false)} 
                onSelect={handleStationLineSelect} 
                allowedLines={allowedLines} 
            />
        </>
    );
};

export default TripEditor;
