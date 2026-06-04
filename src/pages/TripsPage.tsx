import React, { useRef, useState, useEffect, useMemo } from "react";
import {
  Train,
  Pencil,
  Trash2,
  Star,
  Code,
  Plus,
  MapPin,
  Upload,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Eye,
  Filter,
  FileJson,
  MapPinned,
  Route,
  Tag,
} from "lucide-react";
import { useStore } from "../store";
import { DropZone } from "../components/DragContext";
import { getRouteVisualData } from "../core/tripCalculator";
import { computeLoopVia, getLandmarks } from "../core/railwayRouting";
import { isMobile } from "react-device-detect";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { LineLogo } from "../components/LineLogo";
import {
  buildNetworkDisplayModel,
  NetworkMetaEvent,
} from "../utils/networkDisplay";
import type { MileageUserEventKind, MileageUserEventVisibility } from "../rail-graph-v1/mileage-event.types";
import {
  appStationRef,
  boundMileageEventForDisplay,
  buildRailGraphMileageLineContext,
  buildAppMileageLineContext,
  formatKm,
  lineLabel,
  projectEventsToTrip,
  searchMileageEvents,
  tagsFromInput,
} from "../utils/mileageUserEvents";
import type { MileageEventListEntry } from "../components/mileage-events/EventList";
import { eventKindLabel, eventLineLabel, eventSourceLabel, eventSourceTone, eventStationLabel, eventVisibilityLabel, mileageEventKinds, mileageEventVisibilities } from "../components/mileage-events/display";
import {
  tripLineSummary as productTripLineSummary,
  tripToProductSegments,
} from "../utils/tripProductProjection";
import {
  buildTripDetailModel,
  tripDetailKeyEvents,
  type TripDetailModel,
} from "../utils/railGraphTripDetailModel";
import { openMileageEventsPanel, selectMileageEventOnMap } from "../utils/mileageEventUiBridge";
import { RailGraphBadge, RailGraphEventPill, RailGraphSymbol, railGraphEventIcon } from "../components/rail-graph/RailGraphBadges";

const RouteSlice = React.memo(
  ({ segments }: { segments: any[] }) => {
    const { t } = useTranslation();
    const { segmentGeometries, railwayData, geoData } = useStore(
      useShallow((state) => ({
        segmentGeometries: state.segmentGeometries,
        railwayData: state.railwayData,
        geoData: state.geoData,
      })),
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
      const measure = () => {
        if (containerRef.current) {
          const parent = containerRef.current.parentElement as HTMLElement;
          if (parent) setContainerWidth(parent.offsetWidth);
        }
      };
      measure();
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }, []);

    const { visualPaths, totalDist, widthPx, heightPx } = useMemo(
      () =>
        getRouteVisualData(segments, segmentGeometries, railwayData, geoData),
      [segments, segmentGeometries, railwayData, geoData],
    );

    if (visualPaths.length === 0)
      return (
        <div className="w-28 shrink-0 flex items-center justify-center text-xs text-gray-200 ml-2 border-l border-gray-50">
          {t("tripsPage.noPreview", "无预览")}
        </div>
      );

    const maxWidth = Math.max(0, containerWidth - 64);
    const shouldRotate = isMobile && widthPx > maxWidth && maxWidth > 0;
    const visualWidth = shouldRotate ? heightPx : widthPx;
    const visualScale =
      visualWidth > 0 && maxWidth > 0 ? Math.min(1, maxWidth / visualWidth) : 1;

    return (
      <div
        ref={containerRef}
        className="absolute left-2 right-2 top-1/2 -translate-y-1/2 z-0 pointer-events-none flex min-w-0 flex-row items-center justify-end gap-2"
      >
        <div
          className="relative z-0 opacity-50"
          style={{
            width: visualWidth * visualScale,
            height: (shouldRotate ? widthPx : heightPx) * visualScale,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            viewBox="0 0 100 50"
            preserveAspectRatio="none"
            style={{
              width: widthPx * visualScale,
              height: heightPx * visualScale,
              transform: shouldRotate ? "rotate(90deg)" : "none",
              transformOrigin: "center center",
            }}
          >
            {visualPaths.map((item: any, idx: number) => (
              <path
                key={idx}
                d={item.path}
                fill="none"
                stroke={item.color || "#94a3b8"}
                strokeWidth="4"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        </div>
        <div className="absolute inset-0 z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.6)_0%,rgba(255,255,255,0)_30%)]" />
        <div className="relative z-20 text-[10px] font-bold text-gray-800 shrink-0 text-right opacity-50">
          {Math.round(totalDist)}km
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison for segments array to avoid unnecessary re-renders
    if (prevProps.segments === nextProps.segments) return true;
    if (prevProps.segments?.length !== nextProps.segments?.length) return false;

    return prevProps.segments.every((seg, idx) => {
      const nextSeg = nextProps.segments[idx];
      return (
        seg.id === nextSeg.id &&
        seg.lineKey === nextSeg.lineKey &&
        seg.fromId === nextSeg.fromId &&
        seg.toId === nextSeg.toId &&
        seg.loopVia === nextSeg.loopVia
      );
    });
  },
);

import { useUserData } from "../hooks/useUserData";
import { processSuicaCSV } from "../utils/suicaParser";
import toast from "react-hot-toast";
import { showConfirm } from "../utils/alerts";

export const TripsPage: React.FC = () => {
  const {
    trips,
    railwayData,
    segmentGeometries,
    user,
    pins,
    folders,
    badgeSettings,
    mileageUserEvents,
  } = useStore(
    useShallow((state) => ({
      trips: state.trips,
      railwayData: state.railwayData,
      segmentGeometries: state.segmentGeometries,
      user: state.user,
      pins: state.pins,
      folders: state.folders,
      badgeSettings: state.badgeSettings,
      mileageUserEvents: state.mileageUserEvents,
    })),
  );
  const setModalState = useStore((state) => state.setModalState);
  const startEditingTrip = useStore((state) => state.startEditingTrip);
  const removeTrip = useStore((state) => state.removeTrip);
  const addTrip = useStore((state) => state.addTrip);
  const { saveData } = useUserData();
  const { t } = useTranslation();
  const { goToTab } = useAppNavigation();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [eventFiltersOpen, setEventFiltersOpen] = useState(false);
  const [eventDateFrom, setEventDateFrom] = useState("");
  const [eventDateTo, setEventDateTo] = useState("");
  const [eventLineKey, setEventLineKey] = useState("");
  const [eventCompany, setEventCompany] = useState("");
  const [eventPresence, setEventPresence] = useState<"all" | "with" | "without">("all");
  const [eventTags, setEventTags] = useState("");
  const [eventVisibility, setEventVisibility] = useState<MileageUserEventVisibility | "all">("all");
  const [eventKind, setEventKind] = useState<MileageUserEventKind | "all">("all");
  const [eventIncompleteOnly, setEventIncompleteOnly] = useState(false);
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const [selectedTripEventId, setSelectedTripEventId] = useState<string | null>(null);

  useEffect(() => {
    const handleRecordEventSelect = (event: Event) => {
      const customEvent = event as CustomEvent<{ eventId?: string; tripId?: string | number }>;
      if (!customEvent.detail?.eventId) return;
      if (customEvent.detail.tripId !== undefined) {
        setExpandedTripId(String(customEvent.detail.tripId));
      }
      setSelectedTripEventId(customEvent.detail.eventId);
    };
    window.addEventListener("records:mileage-event:select", handleRecordEventSelect);
    return () => window.removeEventListener("records:mileage-event:select", handleRecordEventSelect);
  }, []);

  const lineOptions = useMemo(() => Object.keys(railwayData).sort(), [railwayData]);
  const companyOptions = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(railwayData)
            .map((line) => line.meta?.company)
            .filter((company): company is string => Boolean(company)),
        ),
      ).sort(),
    [railwayData],
  );

  const tripEventEntriesMap = useMemo(() => {
    const map = new Map<string, MileageEventListEntry[]>();
    trips.forEach((trip) => {
      const railGraphTrip = trip.railGraph?.tripResult ?? null;
      const entries = projectEventsToTrip(mileageUserEvents, railwayData, trip).map((bound) => ({
        bound,
        lineContext: railGraphTrip
          ? buildRailGraphMileageLineContext(railGraphTrip, bound.orderIndex ?? 0)
          : boundMileageEventForDisplay(bound.event, railwayData)?.lineContext ?? null,
      }));
      map.set(String(trip.id), entries);
    });
    return map;
  }, [mileageUserEvents, railwayData, trips]);

  const filteredEventIds = useMemo(() => {
    const hasEventSpecificFilters =
      eventTags.trim() ||
      eventLineKey ||
      eventVisibility !== "all" ||
      eventKind !== "all";
    if (!hasEventSpecificFilters) return null;
    return new Set(
      searchMileageEvents(mileageUserEvents, railwayData, {
        tags: tagsFromInput(eventTags),
        lineKey: eventLineKey || undefined,
        visibility: eventVisibility,
        kind: eventKind,
      }).map((event) => event.id),
    );
  }, [eventKind, eventLineKey, eventTags, eventVisibility, mileageUserEvents, railwayData]);

  // ── Year-month grouping ──
  const yearMonthGroups = useMemo(() => {
    const groups: Record<string, typeof trips> = {};
    trips.forEach((t) => {
      const tripDate = t.date.slice(0, 10);
      if (eventDateFrom && tripDate < eventDateFrom) return;
      if (eventDateTo && tripDate > eventDateTo) return;

      const segments = tripToProductSegments(t, railwayData);
      if (eventLineKey && !segments.some((seg: any) => seg.lineKey === eventLineKey)) return;
      if (
        eventCompany &&
        !segments.some((seg: any) => seg.company === eventCompany || railwayData[seg.lineKey]?.meta?.company === eventCompany)
      ) return;

      const tripEntries = tripEventEntriesMap.get(String(t.id)) ?? [];
      const matchingEntries = filteredEventIds
        ? tripEntries.filter((entry) => filteredEventIds.has(entry.bound.event.id))
        : tripEntries;
      if (eventPresence === "with" && matchingEntries.length === 0) return;
      if (eventPresence === "without" && tripEntries.length > 0) return;
      if (filteredEventIds && matchingEntries.length === 0) return;
      if (eventIncompleteOnly) {
        const hasIncompleteSegment = segments.some((seg: any) => !seg.lineKey || !seg.fromId || !seg.toId);
        if (!hasIncompleteSegment && tripEntries.length > 0) return;
      }

      const ym = t.date.slice(0, 7);
      if (!groups[ym]) groups[ym] = [];
      groups[ym].push(t);
    });
    return Object.entries(groups)
      .map(([ym, g]) => ({
        yearMonth: ym,
        label: `${ym.slice(0, 4)}年 ${parseInt(ym.slice(5, 7))}月`,
        year: ym.slice(0, 4),
        month: ym.slice(5, 7),
        count: g.length,
        trips: g,
      }))
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  }, [
    eventCompany,
    eventDateFrom,
    eventDateTo,
    eventIncompleteOnly,
    eventLineKey,
    eventPresence,
    filteredEventIds,
    railwayData,
    tripEventEntriesMap,
    trips,
  ]);

  // ── Scroll-spy shared state ──
  const [currentYearMonth, setCurrentYearMonth] = useState<string | null>(null);
  const [frozenVisible, setFrozenVisible] = useState(false);
  const [containerScrollable, setContainerScrollable] = useState(false);
  const [headerOpacities, setHeaderOpacities] = useState<Record<string, number>>(
    {},
  );
  const frozenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevYearMonthRef = useRef<string | null>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  const showTimeline = yearMonthGroups.length > 1 && containerScrollable;

  const jumpToMonth = (yearMonth: string) => {
    const el = document.querySelector(`[data-year-month="${yearMonth}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const currentGroup = yearMonthGroups.find(
    (g) => g.yearMonth === currentYearMonth,
  );

  // Scroll-spy + frozen visibility + header fade + badge animation
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const checkScrollable = () => {
      setContainerScrollable(
        container.scrollHeight > container.clientHeight + 5,
      );
    };

    let rafId: number;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const headers = container.querySelectorAll("[data-year-month-header]");
        const containerRect = container.getBoundingClientRect();
        let current: string | null = yearMonthGroups[0]?.yearMonth || null;
        headers.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.top <= containerRect.top) {
            current = el.getAttribute("data-year-month-header");
          }
        });

        prevYearMonthRef.current = current;
        setCurrentYearMonth(current);

        // Compute opacity for ALL embedded headers near the top
        const FADE_START = 50;
        const FADE_END = 0;
        const ops: Record<string, number> = {};
        headers.forEach((el) => {
          const ym = el.getAttribute("data-year-month-header")!;
          const dist = el.getBoundingClientRect().top - containerRect.top;
          if (dist >= FADE_START) ops[ym] = 1;
          else if (dist <= FADE_END) ops[ym] = 0;
          else ops[ym] = (dist - FADE_END) / (FADE_START - FADE_END);
        });
        setHeaderOpacities(ops);

        // Show frozen header while scrolling
        setFrozenVisible(true);
        if (frozenTimeoutRef.current) clearTimeout(frozenTimeoutRef.current);
        frozenTimeoutRef.current = setTimeout(
          () => setFrozenVisible(false),
          1500,
        );
      });
    };

    checkScrollable();
    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", checkScrollable);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", checkScrollable);
      cancelAnimationFrame(rafId);
      if (frozenTimeoutRef.current) clearTimeout(frozenTimeoutRef.current);
    };
  }, [yearMonthGroups]);

  // Trigger badge snap animation when month changes (no unmount)
  useEffect(() => {
    if (currentYearMonth && badgeRef.current) {
      const el = badgeRef.current;
      el.classList.remove("animate-badge-snap");
      void el.offsetWidth; // force reflow to restart animation
      el.classList.add("animate-badge-snap");
    }
  }, [currentYearMonth]);

  const handleImportSuica = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const toastId = toast.loading(
      t("tripsPage.parsingSuica", "解析 Suica CSV 数据..."),
    );

    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (text) {
        try {
          console.log("Started parsing Suica CSV...");
          const { newTrips, skippedCount } = await processSuicaCSV(
            text,
            railwayData,
            trips,
          );
          console.log(
            `Successfully mapped ${newTrips.length} trips. Skipped ${skippedCount} duplicates.`,
          );

          if (newTrips.length > 0) {
            toast.dismiss(toastId);
            const skipMsg =
              skippedCount > 0
                ? t("tripsPage.skipMsg", "\n(已跳过 {{count}} 条重复记录)", {
                    count: skippedCount,
                  })
                : "";
            const confirmed = await showConfirm(
              t("tripsPage.parseSuccessTitle", "解析成功"),
              t(
                "tripsPage.parseSuccess",
                "成功解析 {{count}} 条新行程。是否导入？{{skipMsg}}\n(按 F12 打开控制台查看详细匹配日志)",
                { count: newTrips.length, skipMsg: skipMsg },
              ),
            );
            if (confirmed) {
              newTrips.forEach((trip) => addTrip(trip));
              const skipMsgShort =
                skippedCount > 0
                  ? t("tripsPage.skipMsgShort", " (跳过 {{count}} 重复)", {
                      count: skippedCount,
                    })
                  : "";
              toast.success(
                t(
                  "tripsPage.importSuccess",
                  "导入了 {{count}} 条行程！{{skipMsg}}",
                  { count: newTrips.length, skipMsg: skipMsgShort },
                ),
              );
              if (user) {
                const updatedTrips = [...newTrips, ...trips].sort((a, b) =>
                  b.date.localeCompare(a.date),
                );
                saveData(
                  user.token,
                  updatedTrips,
                  pins,
                  folders,
                  badgeSettings,
                ).catch((err: any) =>
                  toast.error(t("common.syncFail", "云端同步失败")),
                );
              }
            }
          } else {
            if (skippedCount > 0) {
              toast.success(
                t(
                  "tripsPage.allExist",
                  "解析完成，但所有记录（{{count}}条）已存在，无需重复导入。",
                  { count: skippedCount },
                ),
                { id: toastId },
              );
            } else {
              toast.error(
                t("tripsPage.noImport", "未找到可导入的行程，或者解析失败。"),
                { id: toastId },
              );
            }
          }
        } catch (error) {
          console.error("Error parsing Suica CSV:", error);
          toast.error(t("tripsPage.readError", "读取或解析文件出错。"), {
            id: toastId,
          });
        }
      }
    };
    reader.onerror = () => {
      toast.error(t("tripsPage.readError", "读取文件失败"), { id: toastId });
    };
    reader.readAsText(file);
    // Reset the input value so the same file can be selected again
    event.target.value = "";
  };

  const handleDeleteTrip = async (id: string | number) => {
    if (await showConfirm(t("common.deleteConfirm", "确认删除?"))) {
      removeTrip(id);
      if (user) {
        const newTrips = trips.filter((trip) => trip.id !== id);
        saveData(user.token, newTrips, pins, folders, badgeSettings).catch(
          (e: any) => toast.error(t("common.syncFail", "云端同步失败")),
        );
      }
    }
  };

  const getEventLabel = (event: NetworkMetaEvent) => {
    if (event.displayLabel) return event.displayLabel;
    if (event.type === "transfer") {
      return event.transferMode === "alight_transfer"
        ? t("tripsPage.event.transfer.alight", "下车换乘")
        : t("tripsPage.event.transfer.through", "不下车接续");
    }
    if (event.type === "reverse_operation")
      return t("tripsPage.event.reverse_operation", "换向作业");
    if (event.type === "formation_operation")
      return t("tripsPage.event.formation_operation", "编组作业");
    if (event.type === "service_class_switch")
      return t("tripsPage.event.service_class_switch", "车种行先切换");
    return t("tripsPage.event.other", "运行事件");
  };

  const renderEventIcon = (event: NetworkMetaEvent) => {
    const color =
      event.type === "transfer"
        ? "text-amber-500"
        : event.type === "reverse_operation"
          ? "text-sky-500"
          : event.type === "formation_operation"
            ? "text-violet-500"
            : event.type === "service_class_switch"
              ? "text-cyan-600"
              : "text-gray-400";
    return <RailGraphSymbol name={railGraphEventIcon(event.type)} className={`h-3 w-3 ${color}`} />;
  };

  const tripLineSummary = (trip: (typeof trips)[number]) => {
    const summary = productTripLineSummary(trip, railwayData);
    return summary === "Unknown" ? t("mileageEvents.unknown", "Unknown") : summary;
  };

  const tripEventEntries = (trip: (typeof trips)[number]) => {
    const entries = tripEventEntriesMap.get(String(trip.id)) ?? [];
    return filteredEventIds
      ? entries.filter((entry) => filteredEventIds.has(entry.bound.event.id))
      : entries;
  };

  const copyTripEventSummary = async (trip: (typeof trips)[number], entries: MileageEventListEntry[]) => {
    const lines = [
      `# ${trip.date} ${tripLineSummary(trip)}`,
      "",
      ...entries.map(
        (entry) =>
          `- ${formatKm(entry.bound.distanceMetersFromRunStart)} ${entry.bound.event.title}${
            entry.bound.event.tags?.length ? ` #${entry.bound.event.tags.join(" #")}` : ""
          }`,
      ),
    ];
    await navigator.clipboard?.writeText(lines.join("\n")).catch(() => undefined);
  };

  const exportTripEvents = (trip: (typeof trips)[number], entries: MileageEventListEntry[], format: "json" | "mdx") => {
    const baseName = `railloop_trip_events_${String(trip.id).replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
    const content =
      format === "json"
        ? JSON.stringify({ trip, mileageEvents: entries.map((entry) => entry.bound.event) }, null, 2)
        : [
            `# ${trip.date} ${tripLineSummary(trip)}`,
            "",
            ...entries.map(
              (entry) =>
                `- **${formatKm(entry.bound.distanceMetersFromRunStart)}** ${entry.bound.event.title}${
                  entry.bound.event.body ? `: ${entry.bound.event.body}` : ""
                }`,
            ),
            "",
          ].join("\n");
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.${format === "json" ? "json" : "mdx"}`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 0);
  };

  const eventEntryLineKey = (entry: MileageEventListEntry) => entry.lineContext?.lineKey;

  const selectTripEvent = (eventId: string, entry?: MileageEventListEntry) => {
    setSelectedTripEventId(eventId);
    selectMileageEventOnMap({
      eventId,
      lineKey: entry ? eventEntryLineKey(entry) : undefined,
      source: entry?.lineContext?.source,
    });
  };

  const openTripEventCreateOnMap = (trip: (typeof trips)[number]) => {
    const segments = tripToProductSegments(trip, railwayData);
    const railGraphTrip = trip.railGraph?.tripResult ?? null;
    const firstRailGraphSegment = railGraphTrip?.segments[0];
    const firstLineKey = firstRailGraphSegment
      ? `rail-graph:${firstRailGraphSegment.mileageProfile.patternRef ?? firstRailGraphSegment.segmentId}`
      : segments.find((segment: any) => segment.lineKey)?.lineKey;
    goToTab("map");
    window.setTimeout(() => {
      openMileageEventsPanel({
        mode: "create",
        lineKey: firstLineKey,
        source: firstRailGraphSegment ? "rail_graph_runtime" : "legacy_app",
        create: {
          source: "trip",
          tripId: trip.id,
          tripSegmentIndex: 0,
          tripRatio: 0.5,
          lineKey: firstRailGraphSegment ? undefined : firstLineKey,
          tags: ["trip-event"],
        },
      });
    }, 150);
  };

  const focusTripEventOnMap = (entry: MileageEventListEntry) => {
    selectTripEvent(entry.bound.event.id, entry);
    goToTab("map");
    window.setTimeout(() => {
      selectMileageEventOnMap({
        eventId: entry.bound.event.id,
        lineKey: eventEntryLineKey(entry),
        source: entry.lineContext?.source,
      });
      if (!entry.bound.coordinates) return;
      window.dispatchEvent(
        new CustomEvent("map:fly-to-location", {
          detail: {
            lat: entry.bound.coordinates[1],
            lng: entry.bound.coordinates[0],
            zoom: 15,
          },
        }),
      );
    }, 150);
  };

  const railGraphDirectionLabel = (direction?: string) => {
    if (!direction) return t("tripsPage.railGraph.unknown", "Unknown");
    if (direction === "up") return t("tripsPage.railGraph.direction.up", "Up");
    if (direction === "down") return t("tripsPage.railGraph.direction.down", "Down");
    if (direction === "clockwise") return t("tripsPage.railGraph.direction.clockwise", "Clockwise");
    if (direction === "counterclockwise") return t("tripsPage.railGraph.direction.counterclockwise", "Counterclockwise");
    return direction;
  };

  const railGraphEventTypeLabel = (type: string) => {
    if (type === "departure") return t("tripsPage.railGraph.event.departure", "Departure");
    if (type === "arrival") return t("tripsPage.railGraph.event.arrival", "Arrival");
    if (type === "transfer") return t("tripsPage.railGraph.event.transfer", "Transfer");
    if (type === "scenic") return t("tripsPage.railGraph.event.scenic", "Scenic");
    if (type === "stop") return t("tripsPage.railGraph.event.stop", "Stop");
    if (type === "pass") return t("tripsPage.railGraph.event.pass", "Pass");
    if (type === "user_event") return t("tripsPage.railGraph.event.user", "User event");
    if (type === "note") return t("tripsPage.railGraph.event.note", "Note");
    return type;
  };

  const formatDistanceKm = (km: number) =>
    t("tripsPage.railGraph.km", "{{value}} km", { value: Math.max(0, km).toFixed(1) });

  const formatMinutes = (minutes?: number) =>
    t("tripsPage.railGraph.minutes", "{{count}} min", { count: Math.max(0, minutes || 0) });

  const compactRailGraphRef = (value?: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const cut = Math.max(text.lastIndexOf(":"), text.lastIndexOf("/"), text.lastIndexOf("#"));
    const label = cut >= 0 ? text.slice(cut + 1) : text;
    return label || text;
  };

  const railGraphChipValue = (values: Array<string | undefined>, maxItems = 2) => {
    const unique = Array.from(new Set(values.filter((value): value is string => !!value?.trim())));
    if (unique.length === 0) return "";
    const visible = unique.slice(0, maxItems).join(" / ");
    return unique.length > maxItems ? `${visible} +${unique.length - maxItems}` : visible;
  };

  const renderRailGraphRunSummary = (detail: TripDetailModel, compact = false) => {
    if (detail.kind !== "rail_graph") return null;
    const keyEvents = tripDetailKeyEvents(detail, compact ? 3 : 5);
    const firstSegment = detail.segments[0];
    return (
      <div className="mt-3 border-t border-emerald-100 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <RailGraphBadge
            icon="snapshot"
            value={t("tripsPage.railGraph.run", "Rail graph run")}
            tone="emerald"
            className="rounded"
          />
          {!compact && firstSegment?.serviceType && (
            <RailGraphBadge icon="service" value={firstSegment.serviceType} tone="sky" className="rounded" />
          )}
          {!compact && firstSegment?.direction && (
            <RailGraphBadge icon="direction" value={railGraphDirectionLabel(firstSegment.direction)} tone="amber" className="rounded" />
          )}
          <RailGraphBadge icon="distance" value={formatDistanceKm(detail.overview.totalDistanceKm)} tone="slate" className="rounded" />
          {detail.overview.totalTimeMinutes !== undefined && (
            <RailGraphBadge icon="duration" value={formatMinutes(detail.overview.totalTimeMinutes)} tone="slate" className="rounded" />
          )}
          <RailGraphBadge
            icon="userEvent"
            value={t("tripsPage.railGraph.userEvents", "{{count}} user events", { count: detail.overview.userEventCount })}
            tone="violet"
            className="rounded"
          />
        </div>

        {!compact && (
          <div className="mt-2 space-y-1.5">
            {detail.segments.map((segment) => (
              <div key={segment.id} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2 text-[11px] text-slate-600">
                <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.displayColor || "#10b981" }} />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-semibold text-slate-800">{segment.lineLabel}</span>
                    <span className="text-slate-400">{railGraphDirectionLabel(segment.direction)}</span>
                    {segment.serviceType && <span className="text-slate-400">{segment.serviceType}</span>}
                  </div>
                  <div className="truncate">
                    {segment.fromName} <span className="text-slate-300">→</span> {segment.toName}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                    <RailGraphBadge
                      icon="stops"
                      value={t("tripsPage.railGraph.stopPass", "{{stops}} stops / {{passes}} pass", { stops: segment.stopCount, passes: segment.passCount })}
                      tone="slate"
                      className="rounded"
                    />
                    <RailGraphBadge
                      icon="via"
                      value={t("tripsPage.railGraph.via", "{{count}} via", { count: segment.viaStationCount })}
                      tone="slate"
                      className="rounded"
                    />
                    {segment.patternRef && (
                      <RailGraphBadge
                        icon="pattern"
                        label={t("mileageEvents.inspector.pattern", "Pattern")}
                        value={compactRailGraphRef(segment.patternRef)}
                        tone="indigo"
                        className="max-w-[12rem] rounded"
                        title={String(segment.patternRef)}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {keyEvents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {keyEvents.map((event) => (
              <RailGraphEventPill
                key={event.id}
                type={event.type}
                label={`${railGraphEventTypeLabel(event.type)} · ${event.label}`}
                title={event.label}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const tripReplayItems = (trip: (typeof trips)[number], entries: MileageEventListEntry[]) => {
    const segments = tripToProductSegments(trip, railwayData);
    const items: Array<
      | {
          id: string;
          kind: "boundary";
          role: "departure" | "transfer" | "arrival";
          distanceMeters: number;
          stationName: string;
          lineName: string;
        }
      | {
          id: string;
          kind: "event";
          distanceMeters: number;
          entry: MileageEventListEntry;
        }
    > = [];
    let cursor = 0;

    segments.forEach((segment: any, index: number) => {
      const lineName = segment.lineLabel || (segment.lineKey ? lineLabel(segment.lineKey) : "-");
      const fromName = segment.fromName || segment.fromId || t("mileageEvents.unknown", "Unknown");
      const toName = segment.toName || segment.toId || t("mileageEvents.unknown", "Unknown");
      const lineContext = segment.lineKey ? buildAppMileageLineContext(railwayData, segment.lineKey) : null;
      const fromMileage = lineContext?.context.stationMileage[appStationRef(segment.lineKey, segment.fromId)];
      const toMileage = lineContext?.context.stationMileage[appStationRef(segment.lineKey, segment.toId)];
      const segmentMeters = fromMileage && toMileage
        ? Math.abs(toMileage.distanceMeters - fromMileage.distanceMeters)
        : Math.round((segment.distanceKm || 0) * 1000);

      items.push({
        id: `boundary:${index}:start`,
        kind: "boundary",
        role: index === 0 ? "departure" : "transfer",
        distanceMeters: cursor,
        stationName: fromName,
        lineName,
      });

      cursor += segmentMeters;

      if (index === segments.length - 1) {
        items.push({
          id: `boundary:${index}:end`,
          kind: "boundary",
          role: "arrival",
          distanceMeters: cursor,
          stationName: toName,
          lineName,
        });
      }
    });

    entries.forEach((entry) => {
      items.push({
        id: `event:${entry.bound.event.id}`,
        kind: "event",
        distanceMeters: entry.bound.distanceMetersFromRunStart,
        entry,
      });
    });

    const order = { departure: 0, transfer: 1, event: 2, arrival: 3 };
    return items.sort((left, right) => {
      const leftOrder = left.kind === "boundary" ? order[left.role] : order.event;
      const rightOrder = right.kind === "boundary" ? order[right.role] : order.event;
      return left.distanceMeters - right.distanceMeters || leftOrder - rightOrder || left.id.localeCompare(right.id);
    });
  };

  const boundaryRoleLabel = (role: "departure" | "transfer" | "arrival") => {
    if (role === "departure") return t("tripsPage.eventCenter.departure", "Departure");
    if (role === "arrival") return t("tripsPage.eventCenter.arrival", "Arrival");
    return t("tripsPage.eventCenter.transfer", "Transfer");
  };

  const countEventEntrySources = (entries: MileageEventListEntry[]) => {
    let railGraph = 0;
    let legacy = 0;
    entries.forEach((entry) => {
      if (entry.lineContext?.source === "rail_graph_runtime") {
        railGraph += 1;
      } else {
        legacy += 1;
      }
    });
    return { railGraph, legacy };
  };

  const renderTripEventCenter = (trip: (typeof trips)[number]) => {
    const tripId = String(trip.id);
    const entries = tripEventEntries(trip);
    const allEntries = tripEventEntriesMap.get(tripId) ?? [];
    const sourceCounts = countEventEntrySources(allEntries);
    const replayItems = tripReplayItems(trip, entries);
    const detail = buildTripDetailModel({ trip, railwayData, userEvents: mileageUserEvents });
    const isExpanded = expandedTripId === tripId;

    return (
      <div className="mt-3 border-t border-gray-100 pt-3" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-md bg-slate-50 px-2 py-2 text-left hover:bg-slate-100"
          onClick={() => setExpandedTripId(isExpanded ? null : tripId)}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <MapPinned size={14} className="text-emerald-600" />
              {t("tripsPage.eventCenter.summary", "{{count}} events", { count: allEntries.length })}
              {sourceCounts.railGraph > 0 && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                  {t("tripsPage.eventCenter.railGraphCount", "{{count}} rail graph", { count: sourceCounts.railGraph })}
                </span>
              )}
              {sourceCounts.legacy > 0 && (
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                  {t("tripsPage.eventCenter.geoJsonCount", "{{count}} GeoJSON", { count: sourceCounts.legacy })}
                </span>
              )}
              {filteredEventIds && allEntries.length !== entries.length && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                  {t("tripsPage.eventCenter.filteredCount", "{{count}} shown", { count: entries.length })}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {entries.slice(0, 3).map((entry) => (
                <span
                  key={entry.bound.event.id}
                  className="max-w-[12rem] truncate rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500"
                >
                  {formatKm(entry.bound.distanceMetersFromRunStart)} · {entry.bound.event.title}
                </span>
              ))}
              {entries.length === 0 && (
                <span className="text-[11px] text-slate-400">
                  {t("tripsPage.eventCenter.noEvents", "No mileage events")}
                </span>
              )}
            </div>
          </div>
          {isExpanded ? <ChevronUp size={16} className="shrink-0 text-slate-400" /> : <ChevronDown size={16} className="shrink-0 text-slate-400" />}
        </button>

        {isExpanded && (
          <div className="mt-3 space-y-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-slate-50 p-2">
                <div className="text-[10px] font-semibold uppercase text-slate-400">
                  {t("tripsPage.eventCenter.trip", "Trip")}
                </div>
                <div className="mt-0.5 font-medium text-slate-700">{trip.date}</div>
              </div>
              <div className="rounded bg-slate-50 p-2">
                <div className="text-[10px] font-semibold uppercase text-slate-400">
                  {t("tripsPage.eventCenter.lines", "Lines")}
                </div>
                <div className="mt-0.5 truncate font-medium text-slate-700">{tripLineSummary(trip)}</div>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-700">
                  {t("tripsPage.eventCenter.projectionSource", "Projection source")}
                </span>
                <span className="rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {t("tripsPage.eventCenter.railGraphCount", "{{count}} rail graph", { count: sourceCounts.railGraph })}
                </span>
                <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  {t("tripsPage.eventCenter.geoJsonCount", "{{count}} GeoJSON", { count: sourceCounts.legacy })}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {detail.kind === "rail_graph"
                  ? t("tripsPage.eventCenter.railGraphProjectionHint", "User events are ordered on the saved rail-graph run snapshot for this trip.")
                  : t("tripsPage.eventCenter.geoJsonProjectionHint", "User events are ordered on the current GeoJSON app-line mileage axis.")}
              </div>
            </div>

            {renderRailGraphRunSummary(detail)}

            <div className="space-y-1">
              {tripToProductSegments(trip, railwayData).map((segment: any, index: number) => {
                const from = segment.fromName || segment.fromId;
                const to = segment.toName || segment.toId;
                return (
                  <div key={`${segment.lineKey}_${segment.fromId}_${segment.toId}_${index}`} className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-semibold text-slate-600">{segment.lineLabel || (segment.lineKey ? lineLabel(segment.lineKey) : "-")}</span>
                    <span>{from}</span>
                    <span className="text-slate-300">→</span>
                    <span>{to}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                onClick={() => openTripEventCreateOnMap(trip)}
              >
                <Plus size={13} />
                {t("tripsPage.eventCenter.addOnMap", "Add on map")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => copyTripEventSummary(trip, entries)}
              >
                <Clipboard size={13} />
                {t("tripsPage.eventCenter.copy", "Copy summary")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => exportTripEvents(trip, entries, "json")}
              >
                <FileJson size={13} />
                JSON
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => exportTripEvents(trip, entries, "mdx")}
              >
                <Download size={13} />
                MDX
              </button>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2">
              <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs">
                <div className="font-semibold text-slate-700">
                  {t("tripsPage.eventCenter.replay", "Trip replay")}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t("tripsPage.eventCenter.sortedByMileage", "Sorted by trip mileage")}
                </div>
              </div>
              <div className="space-y-1.5">
                {replayItems.map((item) => {
                  if (item.kind === "boundary") {
                    return (
                      <div key={item.id} className="grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-2 text-xs">
                        <div className="pt-1 text-right font-mono text-[11px] text-slate-400">
                          {formatKm(item.distanceMeters)}
                        </div>
                        <div className="flex justify-center pt-1">
                          <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 shadow-sm" />
                        </div>
                        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              {boundaryRoleLabel(item.role)}
                            </span>
                            <span className="truncate font-semibold text-slate-700">{item.stationName}</span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-400">{item.lineName}</div>
                        </div>
                      </div>
                    );
                  }

                  const event = item.entry.bound.event;
                  const selected = selectedTripEventId === event.id;
                  const eventLine = eventLineLabel(item.entry.bound, item.entry.lineContext);
                  const eventStation = eventStationLabel(item.entry.bound, item.entry.lineContext);
                  return (
                    <div key={item.id} className="grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-2 text-xs">
                      <div className="pt-2 text-right font-mono text-[11px] text-slate-500">
                        {formatKm(item.distanceMeters)}
                      </div>
                      <div className="flex justify-center pt-2">
                        <span className={`h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm ${selected ? "bg-emerald-600" : "bg-slate-400"}`} />
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        className={`min-w-0 rounded-md border px-2 py-1.5 text-left transition ${
                          selected
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                        onClick={() => focusTripEventOnMap(item.entry)}
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                            keyEvent.preventDefault();
                            focusTripEventOnMap(item.entry);
                          }
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {eventKindLabel(event.kind, t)}
                          </span>
                          <span className="truncate font-semibold text-slate-800">{event.title}</span>
                          <button
                            type="button"
                            className="ml-auto shrink-0 rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                              focusTripEventOnMap(item.entry);
                            }}
                            title={t("mileageEvents.action.viewMap", "View map")}
                          >
                            <MapPinned size={13} />
                          </button>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${eventSourceTone(item.entry.lineContext)}`}>
                            {eventSourceLabel(item.entry.lineContext, t)}
                          </span>
                          {eventLine && (
                            <span className="inline-flex max-w-[12rem] items-center gap-1 truncate">
                              <Route size={12} className="shrink-0 text-slate-400" />
                              <span className="truncate">{eventLine}</span>
                            </span>
                          )}
                          {eventStation && <span className="max-w-[10rem] truncate">{eventStation}</span>}
                          {event.tags?.slice(0, 3).map((tag) => (
                            <span key={tag} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                              <Tag size={10} />
                              {tag}
                            </span>
                          ))}
                        </div>
                        {event.body && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-600">{event.body}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}
      </div>
    );
  };

  const renderTripEventFilters = () => (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Filter size={15} className="shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-700">
              {t("tripsPage.eventFilters.title", "Trip event filters")}
            </div>
            <div className="truncate text-[11px] text-slate-400">
              {t("tripsPage.eventFilters.desc", "Filter trips by event, line, date, tag and quality")}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          onClick={() => setEventFiltersOpen((value) => !value)}
        >
          {eventFiltersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {eventFiltersOpen && (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <label className="block text-xs font-medium text-slate-600">
            {t("tripsPage.eventFilters.dateFrom", "Date from")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventDateFrom}
              onChange={(event) => setEventDateFrom(event.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            {t("tripsPage.eventFilters.dateTo", "Date to")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventDateTo}
              onChange={(event) => setEventDateTo(event.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.line", "Line")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventLineKey}
              onChange={(event) => setEventLineKey(event.target.value)}
            >
              <option value="">{t("mileageEvents.filter.allLines", "All lines")}</option>
              {lineOptions.map((key) => (
                <option key={key} value={key}>
                  {lineLabel(key)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            {t("tripsPage.eventFilters.company", "Company")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventCompany}
              onChange={(event) => setEventCompany(event.target.value)}
            >
              <option value="">{t("tripsPage.eventFilters.allCompanies", "All companies")}</option>
              {companyOptions.map((company) => (
                <option key={company} value={company}>
                  {company}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            {t("tripsPage.eventFilters.presence", "Event status")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventPresence}
              onChange={(event) => setEventPresence(event.target.value as typeof eventPresence)}
            >
              <option value="all">{t("tripsPage.eventFilters.allTrips", "All trips")}</option>
              <option value="with">{t("tripsPage.eventFilters.withEvents", "With events")}</option>
              <option value="without">{t("tripsPage.eventFilters.withoutEvents", "Without events")}</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Tag size={12} />
              {t("mileageEvents.tags", "Tags")}
            </span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventTags}
              onChange={(event) => setEventTags(event.target.value)}
              placeholder={t("mileageEvents.tagsPlaceholder", "Tags, separated by comma")}
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            {t("mileageEvents.type", "Type")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventKind}
              onChange={(event) => setEventKind(event.target.value as typeof eventKind)}
            >
              <option value="all">{t("mileageEvents.filter.allTypes", "All types")}</option>
              {mileageEventKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {eventKindLabel(kind, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Eye size={12} />
              {t("mileageEvents.visibilityLabel", "Visibility")}
            </span>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={eventVisibility}
              onChange={(event) => setEventVisibility(event.target.value as typeof eventVisibility)}
            >
              <option value="all">{t("mileageEvents.filter.allVisibility", "All visibility")}</option>
              {mileageEventVisibilities.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {eventVisibilityLabel(visibility, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={eventIncompleteOnly}
              onChange={(event) => setEventIncompleteOnly(event.target.checked)}
            />
            {t("tripsPage.eventFilters.incompleteOnly", "Only incomplete records")}
          </label>
        </div>
      )}
    </div>
  );

  const renderTripCard = (
    trip: (typeof trips)[number],
    isFirstInMonth: boolean,
  ) => {
    const segments = tripToProductSegments(trip, railwayData);
    const detail = buildTripDetailModel({ trip, railwayData, userEvents: mileageUserEvents });
    const isWalk = trip.isWalk;
    const hasRailGraphSnapshot = detail.kind === "rail_graph";
    const railGraphPatternText = hasRailGraphSnapshot
      ? railGraphChipValue(detail.segments.map((segment) => compactRailGraphRef(segment.patternRef)))
      : "";
    const railGraphServiceText = hasRailGraphSnapshot
      ? railGraphChipValue(detail.segments.map((segment) => segment.serviceType))
      : "";
    const railGraphDirectionText = hasRailGraphSnapshot
      ? railGraphChipValue(detail.segments.map((segment) => segment.direction ? railGraphDirectionLabel(segment.direction) : undefined))
      : "";

    if (isWalk) {
      let startName = trip.fromId || "";
      let endName = trip.toId || "";
      Object.values(railwayData).forEach((line) => {
        const s = line.stations.find((st) => st.id === trip.fromId);
        if (s) startName = s.name_ja;
        const e = line.stations.find((st) => st.id === trip.toId);
        if (e) endName = e.name_ja;
      });

      const isTree = trip.walkType === "tree";
      const cls = {
        bg: isTree ? "bg-green-50" : "bg-purple-50",
        border: isTree ? "border-green-100" : "border-purple-100",
        date: isTree ? "text-green-400" : "text-purple-400",
        tagText: isTree ? "text-green-600" : "text-purple-500",
        tagBg: isTree ? "bg-green-200/50" : "bg-purple-200/50",
        btnEdit: isTree
          ? "text-green-400 hover:text-green-600"
          : "text-purple-400 hover:text-purple-600",
        btnDel: isTree
          ? "text-green-400 hover:text-red-500"
          : "text-purple-400 hover:text-red-500",
        icon: isTree ? "text-green-500" : "text-purple-500",
        title: isTree ? "text-green-700" : "text-purple-700",
        stations: isTree ? "text-green-900" : "text-purple-900",
        arrow: isTree ? "text-green-300" : "text-purple-300",
        memo: isTree ? "text-green-600" : "text-purple-600",
        label: isTree
          ? t("tripsPage.walk", "步行")
          : t("tripsPage.hitchhike", "搭便车"),
      };

      return (
        <div
          key={trip.id}
          id={`trip-${String(trip.id)}`}
          data-year-month={isFirstInMonth ? trip.date.slice(0, 7) : undefined}
          className={`${cls.bg} p-4 rounded-lg border ${cls.border} shadow-sm transition-colors duration-200 hover:shadow-md cursor-pointer`}
          onClick={() => useStore.getState().startEditingWalkTrip(trip)}
        >
          <div
            className={`flex justify-between mb-2 pb-2 border-b ${cls.border}`}
          >
            <span className={`text-xs font-bold ${cls.date}`}>{trip.date}</span>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-mono ${cls.tagText} ${cls.tagBg} px-1.5 py-0.5 rounded`}
              >
                {t("tripsPage.walk", "步行")}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().startEditingWalkTrip(trip);
                }}
                className={cls.btnEdit}
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteTrip(trip.id);
                }}
                className={cls.btnDel}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="relative z-10 flex flex-row">
            <div className="flex-1 space-y-2 relative overflow-hidden">
              <div className="relative z-10 flex flex-col text-sm">
                <div className="flex items-center gap-2">
                  <MapPin size={14} className={`${cls.icon} shrink-0`} />
                  <span className={`font-bold ${cls.title} text-xs`}>
                    {cls.label}
                  </span>
                </div>
                <div className={`pl-5 font-medium ${cls.stations}`}>
                  {startName} <span className={`${cls.arrow} mx-1`}>→</span>{" "}
                  {endName}
                </div>
              </div>
            </div>
          </div>
          {trip.memo && (
            <div className={`text-xs ${cls.memo} bg-white/60 p-2 rounded mt-3`}>
              {trip.memo}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={trip.id}
        id={`trip-${String(trip.id)}`}
        data-year-month={isFirstInMonth ? trip.date.slice(0, 7) : undefined}
        className="rl-card p-4 transition-colors duration-200 hover:border-slate-300 hover:shadow-md"
      >
        <div className="mb-2 flex items-start justify-between gap-3 border-b border-gray-50 pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-bold text-gray-400">{trip.date}</span>
            {hasRailGraphSnapshot && (
              <RailGraphBadge
                icon="snapshot"
                value={t("tripsPage.railGraphSource", "Rail graph")}
                tone="emerald"
                title={t("tripsPage.railGraphSourceTitle", "Saved rail-graph route snapshot")}
                className="max-w-[8rem]"
              />
            )}
            {railGraphPatternText && (
              <RailGraphBadge
                icon="pattern"
                label={t("mileageEvents.inspector.pattern", "Pattern")}
                value={railGraphPatternText}
                tone="indigo"
                className="max-w-[11rem]"
              />
            )}
            {railGraphServiceText && (
              <RailGraphBadge
                icon="service"
                label={t("mileageEvents.inspector.service", "Service")}
                value={railGraphServiceText}
                tone="sky"
                className="max-w-[10rem]"
              />
            )}
            {railGraphDirectionText && (
              <RailGraphBadge
                icon="direction"
                label={t("mileageEvents.inspector.direction", "Direction")}
                value={railGraphDirectionText}
                tone="amber"
                className="max-w-[10rem]"
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(trip.cost || 0) > 0 && (
              <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                ¥{trip.cost}
              </span>
            )}
            <button
              onClick={() =>
                setModalState({
                  addToFolderModalOpen: true,
                  currentTripForFolder: trip,
                })
              }
              className="text-gray-400 hover:text-yellow-500"
            >
              <Star size={14} />
            </button>
            <button
              onClick={() =>
                setModalState({
                  exportRouteModalOpen: true,
                  currentTripForExport: trip,
                })
              }
              className="text-gray-400 hover:text-green-500"
            >
              <Code size={14} />
            </button>
            <button
              onClick={() => startEditingTrip(trip)}
              className="text-gray-400 hover:text-blue-500"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteTrip(trip.id);
              }}
              className="text-gray-400 hover:text-red-500"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="relative z-10 flex flex-row">
          <div className="flex-1 space-y-2 relative overflow-hidden">
            {segments.length > 1 && (
              <div className="absolute left-[5px] top-2 bottom-2 w-0.5 bg-gray-200 z-0"></div>
            )}
            {segments.map((seg, idx) => {
              const line = railwayData[seg.lineKey];
              const icon = line?.meta?.icon;
              const getSt = (id: string) =>
                line?.stations.find((s) => s.id === id)?.name_ja || id;
              const displayModel = seg.source === "legacy"
                ? buildNetworkDisplayModel({
                    id: seg.id,
                    lineKey: seg.lineKey,
                    fromId: seg.fromId,
                    toId: seg.toId,
                    loopVia: seg.loopVia,
                  }, railwayData)
                : null;
              const displaySegments = displayModel?.segments || [];
              const boundaries = displayModel?.boundaries || [];

              return (
                <div
                  key={idx}
                  className="relative z-10 flex flex-col text-sm gap-1"
                >
                  {!displaySegments.length ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm shrink-0"></div>
                        {icon && (
                          <LineLogo
                            src={icon}
                            companyIcon={line?.meta?.companyIcon}
                            recolor={line?.meta?.recolor}
                            color={line?.meta?.color}
                            className="line-icon"
                          />
                        )}
                        <span className="font-bold text-emerald-700 text-xs">
                          {seg.lineLabel || seg.lineKey}
                        </span>
                      </div>
                      <div className="pl-5 font-medium text-gray-700">
                        {seg.fromName || getSt(seg.fromId)}{" "}
                        <span className="text-gray-300 mx-1">→</span>{" "}
                        {seg.toName || getSt(seg.toId)}
                      </div>
                    </>
                  ) : (
                    displaySegments.map((displaySeg, displayIdx) => {
                      const boundary = boundaries[displayIdx];
                      return (
                        <React.Fragment key={`${displaySeg.id}_${displayIdx}`}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm shrink-0"></div>
                            {icon && (
                              <LineLogo
                                src={icon}
                                companyIcon={line?.meta?.companyIcon}
                                recolor={line?.meta?.recolor}
                                color={line?.meta?.color}
                                className="line-icon"
                              />
                            )}
                            <span className="font-bold text-emerald-700 text-xs">
                              {displaySeg.title}
                            </span>
                          </div>
                          {!!displaySeg.destination && (
                            <div className="pl-5 text-[11px] text-blue-600">
                              {t("tripsPage.destination", "行先")}{" "}
                              {displaySeg.destination}
                            </div>
                          )}
                          <div className="pl-5 font-medium text-gray-700">
                            {displaySeg.stationNames[0]}{" "}
                            <span className="text-gray-300 mx-1">→</span>{" "}
                            {
                              displaySeg.stationNames[
                                displaySeg.stationNames.length - 1
                              ]
                            }
                          </div>
                          {boundary && (
                            <div className="pl-5 py-1 flex flex-col gap-1">
                              {boundary.events.map((event, eventIdx) => (
                                <div
                                  key={`${boundary.leftSegmentId}_${boundary.rightSegmentId}_${event.id || eventIdx}`}
                                  className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 bg-amber-50 border border-amber-100 rounded px-2 py-1 w-fit"
                                >
                                  {renderEventIcon(event)}
                                  <span>{getEventLabel(event)}</span>
                                  {typeof event.requiresTransfer ===
                                    "boolean" && (
                                    <span
                                      className={`text-[10px] font-semibold ${event.requiresTransfer ? "text-red-500" : "text-emerald-600"}`}
                                    >
                                      {event.requiresTransfer
                                        ? t(
                                            "tripsPage.event.transfer.required",
                                            "需换乘",
                                          )
                                        : t(
                                            "tripsPage.event.transfer.notRequired",
                                            "无需换乘",
                                          )}
                                    </span>
                                  )}
                                  {(event as any).isAutoGenerated && (
                                    <span className="text-[10px] text-orange-600">
                                      {t(
                                        "tripsPage.event.autoCompleted",
                                        "自动补全事件",
                                      )}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                  {(() => {
                    const isLoop = !!line?.meta?.isLoop;
                    if (!isLoop || seg.source !== "legacy") return null;
                    let realVia = seg.loopVia || "auto";
                    if (realVia === "auto") {
                      realVia = computeLoopVia(
                        railwayData,
                        seg.lineKey,
                        seg.fromId,
                        seg.toId,
                      );
                    }
                    const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}_${realVia}`;
                    const cachedLm = segmentGeometries.get(key)?.landmarks;
                    const lm =
                      cachedLm ||
                      getLandmarks(line, seg.fromId, seg.toId, seg.loopVia);
                    return lm?.length > 0 ? (
                      <div className="pl-5 text-[11px] text-gray-400">
                        {t("tripsPage.via", "经由 ")}
                        {lm.join("、")}
                      </div>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
          <RouteSlice segments={segments} />
        </div>
        {renderRailGraphRunSummary(detail, true)}
        {trip.memo && (
          <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded mt-3">
            {trip.memo}
          </div>
        )}
        {renderTripEventCenter(trip)}
      </div>
    );
  };

  return (
    <div className="relative h-full w-full flex flex-col overflow-hidden">
      <div
        id="trips-scroll-container"
        ref={scrollContainerRef}
        className="flex-1 flex flex-col overflow-y-auto pl-4 pr-10 pt-0 pb-4"
      >
        {/* Top spacer — provides initial visual padding; scrolled away when header freezes */}
        <div className="h-4 shrink-0" />
        {trips.length > 0 && renderTripEventFilters()}
        {trips.length === 0 ? (
          <div className="text-center text-gray-400 py-10 flex flex-col items-center justify-center flex-1">
            <Train size={48} className="opacity-20 mb-4" />
            <p>{t("tripsPage.noTrips", "暂无行程记录")}</p>
            <p className="text-xs mt-2">
              {t("tripsPage.addFirstTrip", "点击下方按钮添加你的第一次乗り鉄")}
              <br />
              {t(
                "tripsPage.addFirstTripNote",
                "注意: 自定义线路可以导入 company_data 和 geojson",
              )}
            </p>
          </div>
        ) : (
          yearMonthGroups.map((group) => (
            <React.Fragment key={group.yearMonth}>
              {/* Embedded header — normal flow, fades out when near frozen badge */}
              <div
                data-year-month-header={group.yearMonth}
                className="flex items-center gap-2 px-2 py-1.5 -ml-4 mb-2 transition-opacity duration-100"
                style={{
                  background:
                    "linear-gradient(to right, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.4) 60%, transparent 100%)",
                  borderBottom: "1px solid rgba(243,244,246,0.8)",
                  opacity: headerOpacities[group.yearMonth] ?? 1,
                }}
              >
                <span className="text-xs font-bold text-gray-500">
                  {group.label}
                </span>
                <span className="text-[10px] text-gray-400">
                  {group.count}条
                </span>
              </div>
              {/* Trip cards for this month */}
              <div className="space-y-3 mb-2">
                {group.trips.map((trip, idx) =>
                  renderTripCard(trip, idx === 0),
                )}
              </div>
            </React.Fragment>
          ))
        )}
      </div>

      {/* Frozen header — cross-fades with embedded header */}
      {showTimeline && currentGroup && (
        <div
          ref={badgeRef}
          className="absolute left-2 top-2 z-20 bg-white/65 backdrop-blur-sm rounded-lg px-2 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-opacity duration-300 pointer-events-none select-none"
          style={{
            opacity: frozenVisible
              ? 1 - (headerOpacities[currentGroup.yearMonth] ?? 1)
              : 0,
          }}
        >
          <span className="text-[11px] font-bold text-gray-500">
            {currentGroup.label}
          </span>
        </div>
      )}

      {/* Right-side floating timeline */}
      {showTimeline && (
        <div className="absolute right-1 top-4 bottom-20 z-20 flex flex-col pointer-events-auto">
          <div
            className="flex-1 flex flex-col items-center overflow-y-auto py-1 gap-5"
            style={{ scrollbarWidth: "none" }}
          >
            {yearMonthGroups.map((g, i) => {
              const isCurrent = g.yearMonth === currentYearMonth;
              const showYearLabel =
                i === 0 || g.year !== yearMonthGroups[i - 1].year;
              return (
                <React.Fragment key={g.yearMonth}>
                  {showYearLabel && (
                    <span className="text-[11px] font-bold text-gray-400 leading-none mt-1 mb-0.5 select-none">
                      {g.year.slice(2)}
                    </span>
                  )}
                  <button
                    onClick={() => jumpToMonth(g.yearMonth)}
                    className="flex items-center gap-2 h-6 px-1 rounded transition-all duration-200 hover:bg-gray-100/50"
                    title={g.label}
                  >
                    <span
                      className={`
                                            rounded-full shrink-0 transition-all duration-200
                                            ${
                                              isCurrent
                                                ? "w-2.5 h-2.5 bg-emerald-500 shadow-sm shadow-emerald-200"
                                                : "w-2 h-2 bg-gray-300"
                                            }
                                        `}
                    />
                    <span
                      className={`
                                            text-xs font-mono whitespace-nowrap select-none transition-colors duration-200
                                            ${
                                              isCurrent
                                                ? "text-emerald-600 font-bold"
                                                : "text-gray-400"
                                            }
                                        `}
                    >
                      {parseInt(g.month)}月
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      <FloatingActionButtons
        fileInputRef={fileInputRef}
        handleImportSuica={handleImportSuica}
        startEditingTrip={startEditingTrip}
        alwaysVisible={trips.length === 0}
      />
    </div>
  );
};

import { ArrowUp, ArrowDown } from "lucide-react";

export const FloatingActionButtons: React.FC<{
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleImportSuica: (event: React.ChangeEvent<HTMLInputElement>) => void;
  startEditingTrip: (data?: any) => void;
  alwaysVisible?: boolean;
}> = ({
  fileInputRef,
  handleImportSuica,
  startEditingTrip,
  alwaysVisible = false,
}) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(true);
  const [isTutorialActive, setIsTutorialActive] = useState(false);
  const [scrollPos, setScrollPos] = useState<"top" | "middle" | "bottom">(
    "top",
  );
  const [showScrollBtns, setShowScrollBtns] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollBtnsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastScrollYRef = useRef(0);
  const lastScrollTimeRef = useRef(Date.now());

  useEffect(() => {
    const handleTutorialStep = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail.id === "add-trip") {
        setIsTutorialActive(true);
        setIsVisible(true);
      } else {
        setIsTutorialActive(false);
      }
    };
    document.addEventListener("tutorial:step-changed", handleTutorialStep);
    return () =>
      document.removeEventListener("tutorial:step-changed", handleTutorialStep);
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
      if (scrollBtnsTimeoutRef.current)
        clearTimeout(scrollBtnsTimeoutRef.current);
      scrollBtnsTimeoutRef.current = setTimeout(() => {
        setShowScrollBtns(true);
      }, 500);

      // Position detection
      if (currentScrollY === 0) {
        setScrollPos("top");
      } else if (
        currentScrollY + target.clientHeight >=
        target.scrollHeight - 10
      ) {
        setScrollPos("bottom");
        // Trigger visibility when reaching bottom
        setIsVisible(true);
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          if (!isHovering && !isTutorialActive && !alwaysVisible) {
            setIsVisible(false);
          }
        }, 2000);
      } else {
        setScrollPos("middle");
      }
    };

    const handleWheelOrTouch = () => {
      const container = document.getElementById("trips-scroll-container");
      if (!container) return;
      const isAtBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 10;
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

    const container = document.getElementById("trips-scroll-container");

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
      container.addEventListener("scroll", handleScroll);
      container.addEventListener("wheel", handleWheelOrTouch);
      container.addEventListener("touchmove", handleWheelOrTouch);
      // Run initial check
      setTimeout(checkScrollable, 100);
      window.addEventListener("resize", checkScrollable);

      // Initial position check
      if (container.scrollTop === 0) setScrollPos("top");
      setShowScrollBtns(true);
    }

    // Initial fade out timer (only if not empty and scrollable)
    if (!alwaysVisible && !isTutorialActive) {
      scrollTimeoutRef.current = setTimeout(() => {
        if (
          container &&
          container.scrollHeight > container.clientHeight &&
          !isHovering
        ) {
          setIsVisible(false);
        }
      }, 3000);
    }

    return () => {
      if (container) {
        container.removeEventListener("scroll", handleScroll);
        container.removeEventListener("wheel", handleWheelOrTouch);
        container.removeEventListener("touchmove", handleWheelOrTouch);
      }
      window.removeEventListener("resize", checkScrollable);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (scrollBtnsTimeoutRef.current)
        clearTimeout(scrollBtnsTimeoutRef.current);
    };
  }, [alwaysVisible, isTutorialActive, isHovering]);

  const scrollToTop = (e: React.MouseEvent<HTMLButtonElement>) => {
    document
      .getElementById("trips-scroll-container")
      ?.scrollTo({ top: 0, behavior: "smooth" });
    e.currentTarget.blur();
  };

  const scrollToBottom = (e: React.MouseEvent<HTMLButtonElement>) => {
    const container = document.getElementById("trips-scroll-container");
    if (container)
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    e.currentTarget.blur();
  };

  return (
    <div className="absolute bottom-4 left-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {/* Scroll Buttons */}
      <div
        className={`flex flex-col gap-2 mr-2 transition-opacity duration-300 pointer-events-auto ${showScrollBtns ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        {scrollPos !== "top" && (
          <button
            onClick={scrollToTop}
            className="bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-md border border-gray-100 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors active:scale-95 touch-manipulation"
          >
            <ArrowUp size={20} />
          </button>
        )}
        {scrollPos !== "bottom" && (
          <button
            onClick={scrollToBottom}
            className="bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-md border border-gray-100 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors active:scale-95 touch-manipulation"
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>

      <div
        className={`w-full transition-opacity duration-500 ease-in-out pointer-events-auto ${isVisible || alwaysVisible || isTutorialActive || isHovering ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onTouchStart={() => setIsHovering(true)}
        onTouchEnd={() => {
          setTimeout(() => setIsHovering(false), 2000);
        }}
      >
        <DropZone
          onDrop={(item: any) => {
            if (item.type === "station") {
              const newSegments = [
                {
                  id: Date.now().toString(),
                  lineKey: item.lineKey,
                  fromId: item.id,
                  toId: "",
                },
              ];
              startEditingTrip({
                date: new Date().toISOString().split("T")[0],
                memo: "",
                segments: newSegments,
                cost: 0,
              });
            }
          }}
        >
          <div className="flex gap-2 p-2 pointer-events-none">
            <button
              id="btn-add-trip"
              onClick={() => startEditingTrip()}
              className="rl-primary-action flex flex-1 items-center justify-center gap-2 px-4 py-3 pointer-events-auto shadow-md"
            >
              <Plus
                size={18}
              />{" "}
              {t("tripsPage.recordNewTrip", "记录新行程")}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rl-secondary-action flex flex-none items-center justify-center gap-2 px-4 py-3 pointer-events-auto shadow-md"
              title={t("tripsPage.importSuica", "导入 Suica CSV")}
              aria-label={t("tripsPage.importSuica", "导入 Suica CSV")}
            >
              <Upload size={18} />
            </button>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImportSuica}
            />
          </div>
        </DropZone>
      </div>
    </div>
  );
};
