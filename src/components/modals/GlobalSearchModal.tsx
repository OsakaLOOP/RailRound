import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    CalendarDays,
    Building2,
    ListFilter,
    Map as MapIcon,
    MapPin,
    Route,
    Search,
    Tag,
    Train,
    X,
} from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { LineLogo } from '../LineLogo';
import {
    boundMileageEventsForRichDisplay,
    lineLabel,
    searchMileageEvents,
} from '../../utils/mileageUserEvents';
import {
    eventKindLabel,
    eventLineLabel,
    eventMileageLabel,
    eventStationLabel,
} from '../mileage-events/display';
import { tripLineSummary, tripSearchText, tripToProductSegments } from '../../utils/tripProductProjection';
import { buildTripDetailModel } from '../../utils/railGraphTripDetailModel';
import { RailGraphBadge, RailGraphEventPill, RailGraphRunBadges } from '../rail-graph/RailGraphBadges';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (lineKey: string, stationId?: string) => void;
    onSelectTrip?: (tripId: string | number) => void;
    onSelectEvent?: (eventId: string) => void;
    onSwitchMode?: () => void;
    isEmbedded?: boolean;
}

export const GlobalSearchModal: React.FC<Props> = ({
    isOpen,
    onClose,
    onSelect,
    onSelectTrip,
    onSelectEvent,
    onSwitchMode,
    isEmbedded,
}) => {
    const { railwayData, trips, mileageUserEvents } = useStore(
        useShallow(state => ({
            railwayData: state.railwayData,
            trips: state.trips,
            mileageUserEvents: state.mileageUserEvents,
        }))
    );
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const results = useMemo(() => {
        if (!query.trim()) return { lines: [], stations: [], trips: [], events: [], tags: [] };

        const lowerQuery = query.toLowerCase();
        const matchedLines: any[] = [];
        const matchedStations: any[] = [];
        const normalizedQuery = lowerQuery.replace(/^#/, '');

        Object.entries(railwayData).forEach(([lineKey, lineData]) => {
            const displayName = lineLabel(lineKey);

            // Check line match
            if (lineKey.toLowerCase().includes(lowerQuery) || displayName.toLowerCase().includes(lowerQuery)) {
                matchedLines.push({
                    lineKey,
                    displayName,
                    company: lineData.meta.company || '',
                    logo: lineData.meta.logo || null,
                    icon: lineData.meta.icon || null,
                    companyIcon: lineData.meta.companyIcon || null,
                    recolor: lineData.meta.recolor,
                    color: lineData.meta.color
                });
            }

            // Check station match
            lineData.stations.forEach(station => {
                if (station.name_ja.toLowerCase().includes(lowerQuery)) {
                    matchedStations.push({
                        lineKey,
                        lineDisplayName: displayName,
                        stationId: station.id,
                        stationName: station.name_ja,
                        company: lineData.meta.company || '',
                        logo: lineData.meta.logo || null,
                        icon: lineData.meta.icon || null,
                        companyIcon: lineData.meta.companyIcon || null,
                        recolor: lineData.meta.recolor,
                        color: lineData.meta.color
                    });
                }
            });
        });

        const matchedTrips = trips
            .filter((trip) => {
                return tripSearchText(trip, railwayData)
                    .toLowerCase()
                    .includes(lowerQuery);
            })
            .slice(0, 50);

        const matchedEventEntries = boundMileageEventsForRichDisplay(
            searchMileageEvents(mileageUserEvents, railwayData, { query: normalizedQuery }),
            railwayData,
            trips,
        ).slice(0, 50);

        const tagCounts = new Map<string, number>();
        mileageUserEvents.forEach((event) => {
            (event.tags || []).forEach((tag) => {
                if (!tag.toLowerCase().includes(normalizedQuery)) return;
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            });
        });

        return {
            lines: matchedLines.slice(0, 50), // Limit results for performance
            stations: matchedStations.slice(0, 100),
            trips: matchedTrips,
            events: matchedEventEntries,
            tags: Array.from(tagCounts.entries())
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
                .slice(0, 40),
        };
    }, [mileageUserEvents, query, railwayData, trips]);

    if (!isOpen && !isEmbedded) return null;

    const hasResults =
        results.lines.length > 0 ||
        results.stations.length > 0 ||
        results.trips.length > 0 ||
        results.events.length > 0 ||
        results.tags.length > 0;

    const content = (
        <div className="flex flex-col h-full w-full bg-white">
            {/* Header / Search Input */}
            <div className="p-4 border-b bg-white flex items-center gap-3 shrink-0 sticky top-0 z-20 shadow-sm">
                    <Search className="text-gray-400" size={20} />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder={t('search.placeholder', "搜索线路或车站...")}
                        className="flex-1 bg-transparent border-none outline-none text-lg text-gray-800 placeholder:text-gray-400"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="p-1 hover:bg-gray-100 rounded-full text-gray-400 transition">
                            <X size={16} />
                        </button>
                    )}
                    {onSwitchMode && (
                        <button
                            onClick={onSwitchMode}
                            className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-blue-600 bg-gray-50 border border-gray-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg shadow-sm transition-all whitespace-nowrap"
                            title={t('lineSel.title', '选择线路')}
                        >
                            <ListFilter size={14} />
                            <span className="hidden sm:inline">{t('lineSel.title', '选择线路')}</span>
                        </button>
                    )}
                    <button onClick={onClose} className="p-2 ml-1 hover:bg-gray-100 rounded-full text-gray-500 transition shrink-0 font-bold whitespace-nowrap text-sm">
                        {t('common.close', '关闭')}
                    </button>
                </div>

                {/* Results Area */}
                <div className="flex-1 overflow-y-auto bg-gray-50">
                    {!query.trim() ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <Search size={48} className="text-gray-200" />
                            <p>{t('search.instruction', '输入线路、车站、行程、事件或标签进行搜索')}</p>
                        </div>
                    ) : !hasResults ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                            <p>{t('search.noResult', '没有找到相关结果')}</p>
                        </div>
                    ) : (
                        <div className="p-4 space-y-6">
                            {/* Event Results */}
                            {results.events.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                                        <MapPin size={14} /> {t('search.events', '事件')} ({results.events.length})
                                    </h4>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                                        {results.events.map(({ bound, lineContext }) => (
                                            <button
                                                key={`event-${bound.event.id}`}
                                                onClick={() => {
                                                    if (onSelectEvent) {
                                                        onSelectEvent(bound.event.id);
                                                        onClose();
                                                    }
                                                }}
                                                className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition-colors flex items-start gap-3 text-sm text-gray-700 group"
                                            >
                                                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                                                    <MapPin size={12} className="text-emerald-600" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <RailGraphEventPill type={bound.event.kind} label={eventKindLabel(bound.event.kind, t)} className="max-w-[8rem]" />
                                                        <div className="truncate font-bold text-gray-800">{bound.event.title}</div>
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                                        <RailGraphBadge icon="distance" value={eventMileageLabel(bound)} tone="slate" className="rounded" />
                                                        {eventStationLabel(bound, lineContext) && <span>{eventStationLabel(bound, lineContext)}</span>}
                                                        {eventLineLabel(bound, lineContext) && (
                                                            <span className="inline-flex items-center gap-1">
                                                                <Route size={11} />
                                                                {eventLineLabel(bound, lineContext)}
                                                            </span>
                                                        )}
                                                        <RailGraphBadge
                                                            icon={lineContext.source === 'rail_graph_runtime' ? 'snapshot' : 'legacy'}
                                                            value={lineContext.source === 'rail_graph_runtime'
                                                                ? t('mileageEvents.sourceRailGraph', 'Rail graph snapshot')
                                                                : t('mileageEvents.sourceLegacy', 'GeoJSON axis')}
                                                            tone={lineContext.source === 'rail_graph_runtime' ? 'emerald' : 'slate'}
                                                            className="rounded"
                                                        />
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Trip Results */}
                            {results.trips.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                                        <CalendarDays size={14} /> {t('search.trips', '行程')} ({results.trips.length})
                                    </h4>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                                        {results.trips.map((trip) => {
                                            const segments = tripToProductSegments(trip, railwayData);
                                            const firstSegment = segments[0];
                                            const detail = buildTripDetailModel({ trip, railwayData, userEvents: mileageUserEvents });
                                            const firstDetailSegment = detail.segments[0];
                                            const lineSummary = firstSegment?.lineLabel || (firstSegment?.lineKey ? lineLabel(firstSegment.lineKey) : '');
                                            const from = firstSegment?.fromName || '';
                                            const to = firstSegment?.toName || '';
                                            const fallbackSummary = tripLineSummary(trip, railwayData);
                                            const routeSummary = from && to
                                                ? `${from} → ${to}`
                                                : fallbackSummary === 'Unknown'
                                                    ? t('mileageEvents.unknown', 'Unknown')
                                                    : fallbackSummary;
                                            return (
                                                <button
                                                    key={`trip-${trip.id}`}
                                                    onClick={() => {
                                                        if (onSelectTrip) {
                                                            onSelectTrip(trip.id);
                                                            onClose();
                                                        }
                                                    }}
                                                    className="w-full text-left px-4 py-3 hover:bg-sky-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                                                >
                                                    <div className="w-6 h-6 rounded-full bg-sky-100 flex items-center justify-center shrink-0 group-hover:bg-sky-200 transition-colors">
                                                        <CalendarDays size={12} className="text-sky-600" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <div className="font-bold text-gray-800">{trip.date}</div>
                                                            {detail.kind === 'rail_graph' && (
                                                                <RailGraphBadge
                                                                    icon="snapshot"
                                                                    value={firstDetailSegment?.serviceType || t('search.railGraphTrip', 'Rail graph')}
                                                                    tone="emerald"
                                                                    className="shrink-0 rounded"
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-500 truncate">
                                                            {lineSummary ? `${lineSummary} ${routeSummary}` : routeSummary}
                                                            {segments.length > 1 ? ` +${segments.length - 1}` : ''}
                                                        </div>
                                                        {detail.kind === 'rail_graph' && (
                                                            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                                                                <RailGraphBadge icon="snapshot" value={t('search.railGraphSnapshot', 'Saved snapshot')} tone="emerald" className="rounded" />
                                                                <RailGraphRunBadges
                                                                    meta={{
                                                                        serviceType: firstDetailSegment?.serviceType,
                                                                        direction: firstDetailSegment?.direction,
                                                                        patternRef: firstDetailSegment?.patternRef,
                                                                    }}
                                                                    badgeClassName="rounded"
                                                                />
                                                                <RailGraphBadge icon="distance" value={t('search.km', '{{value}} km', { value: detail.overview.totalDistanceKm.toFixed(1) })} tone="slate" className="rounded" />
                                                                <RailGraphBadge icon="userEvent" value={t('search.userEvents', '{{count}} user events', { count: detail.overview.userEventCount })} tone="violet" className="rounded" />
                                                            </div>
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Tag Results */}
                            {results.tags.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                                        <Tag size={14} /> {t('search.tags', '标签')} ({results.tags.length})
                                    </h4>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                                        {results.tags.map((item) => (
                                            <button
                                                key={`tag-${item.tag}`}
                                                onClick={() => setQuery(item.tag)}
                                                className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                                            >
                                                <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-slate-200 transition-colors">
                                                    <Tag size={12} className="text-slate-600" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-bold text-gray-800">#{item.tag}</div>
                                                    <div className="text-xs text-gray-500">
                                                        {t('search.tagCount', '{{count}} 个事件', { count: item.count })}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Line Results */}
                            {results.lines.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                                        <Train size={14} /> {t('search.lines', '线路')} ({results.lines.length})
                                    </h4>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                                        {results.lines.map((line, idx) => (
                                            <button
                                                key={`line-${idx}`}
                                                onClick={() => { onSelect(line.lineKey); onClose(); }}
                                                className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                                            >
                                                {line.icon ? (
                                                    <LineLogo src={line.icon!} companyIcon={line.companyIcon} recolor={line.recolor} color={line.color} className="line-icon w-5 h-5 object-contain" />
                                                ) : line.logo ? (
                                                    <img src={line.logo} alt="" className="line-icon w-5 h-5 object-contain opacity-70 grayscale" />
                                                ) : (
                                                    <MapIcon size={16} className="text-gray-300 group-hover:text-blue-400" />
                                                )}
                                                <div className="flex-1">
                                                    <div className="font-bold text-gray-800">{line.displayName}</div>
                                                    <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                                                        {line.company && <><Building2 size={10} /> {line.company}</>}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Station Results */}
                            {results.stations.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                                        <MapPin size={14} /> {t('search.stations', '车站')} ({results.stations.length})
                                    </h4>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-50">
                                        {results.stations.map((station, idx) => (
                                            <button
                                                key={`station-${idx}`}
                                                onClick={() => { onSelect(station.lineKey, station.stationId); onClose(); }}
                                                className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition-colors flex items-center gap-3 text-sm text-gray-700 group"
                                            >
                                                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                                                    <MapPin size={12} className="text-emerald-600" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-gray-800 text-base">{station.stationName}</div>
                                                    <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5 truncate">
                                                        {station.icon ? (
                                                            <LineLogo src={station.icon!} companyIcon={station.companyIcon} recolor={station.recolor} color={station.color} className="w-3 h-3 object-contain inline-block" />
                                                        ) : station.logo ? (
                                                            <img src={station.logo} alt="" className="w-3 h-3 object-contain inline-block grayscale opacity-60" />
                                                        ) : (
                                                            <Train size={10} />
                                                        )}
                                                        <span className="truncate">{station.lineDisplayName}</span>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
    );

    if (isEmbedded) return content;

    return (
        <div className="fixed inset-0 z-[700] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div
                className="bg-white w-full max-w-2xl max-h-[85vh] h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up ring-1 ring-black/5"
                onClick={e => e.stopPropagation()}
            >
                {content}
            </div>
        </div>
    );
};
