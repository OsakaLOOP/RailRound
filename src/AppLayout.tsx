import React, { useState, useRef, useEffect } from "react";
import { DragProvider } from "./components/DragContext";
import Chest from "./components/Chest";
import StationMenu from "./components/StationMenu";
import Tutorial from "./components/Tutorial";
import { LoginModal } from "./components/LoginModal";
import { GithubRegisterModal } from "./components/modals/GithubRegisterModal";
import { GithubCardModal } from "./components/modals/GithubCardModal";
import { FolderManagerModal } from "./components/modals/FolderManagerModal";
import { AddToFolderModal } from "./components/modals/AddToFolderModal";
import { ExportRouteModal } from "./components/modals/ExportRouteModal";
import { FeedbackModal } from "./components/modals/FeedbackModal";
import { SubscribeModal } from "./components/modals/SubscribeModal";
import { FeedbackAdminModal } from "./components/modals/FeedbackAdminModal";
import { GlobalSearchModal } from "./components/modals/GlobalSearchModal";
import { TripEditor } from "./components/modals/TripEditor";
import { WalkTripEditor } from "./components/modals/WalkTripEditor";
import { MapContainer } from "./components/map/MapContainer";
import { PinEditor } from "./components/map/PinEditor";
import { FabButton } from "./components/map/FabButton";
import { LocateButton } from "./components/map/LocateButton";
import { MileageEventsPanel } from "./components/map/MileageEventsPanel";
import { Header } from "./components/layout/Header";
import { BottomNav } from "./components/layout/BottomNav";
import { TripsPage } from "./pages/TripsPage";
import { StatsPage } from "./pages/StatsPage";
import { useStore } from "./store";
import { useUserData } from "./hooks/useUserData";
import { db } from "./utils/db";
import buildKMLString from "./buildKml";
import {
  isCompanyCompatible,
  getTransferableLines,
  computeLoopVia,
  getSegmentKey,
} from "./core/railwayRouting";
import { calculateLatestStats } from "./core/tripCalculator";
import { parseGeoJsonBatch } from "./core/parser";
import GeoWorker from "./workers/geo.worker.js?worker";
// Use dynamic fetch or absolute URL instead of import from public, or ignore since this was an existing error
import changelog from "../public/changelog.json";
const { meta } = changelog;
import { api } from "./services/api";
import { useShallow } from "zustand/react/shallow";
import { Toaster, toast } from "react-hot-toast";
import DistanceWorker from "./workers/distance.worker.js?worker";
import { useMeta } from "./contexts";
import { useTranslation } from "react-i18next";
import { showAlert, showConfirm } from "./utils/alerts";
import { boundMileageEventForRichDisplay } from "./utils/mileageUserEvents";
import { selectMileageEventOnMap } from "./utils/mileageEventUiBridge";
import { tripToKmlPathItems, tripToProductSegments } from "./utils/tripProductProjection";
import { buildTripDetailModel } from "./utils/railGraphTripDetailModel";
import { useLocation } from "react-router-dom";
import { useAppRouteState } from "./hooks/useAppRouteState";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { AppSEO } from "./components/layout/AppSEO";
import { getRouteInfoFromPath, toI18nLang } from "./utils/routes";
import { loadDefaultRailGraphDeployment } from "./services/railGraphDeploymentLoader";

const CURRENT_VERSION = meta["currentVersion"];

function escapePopupHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildRoutePopupHtml(args: {
  sourceLabel: string;
  sourceKind: "rail_graph" | "legacy" | "fallback" | "transfer";
  title: string;
  subtitle: string;
  rows?: Array<[string, string | number | undefined | null]>;
  chips?: string[];
}): string {
  const rows = (args.rows ?? []).filter(([, value]) => value !== undefined && value !== null && value !== "");
  const chips = (args.chips ?? []).filter(Boolean);
  return [
    `<div class="rail-route-popup rail-route-popup-${escapePopupHtml(args.sourceKind)}">`,
    `<div class="rail-route-popup-source">${escapePopupHtml(args.sourceLabel)}</div>`,
    `<div class="rail-route-popup-title">${escapePopupHtml(args.title)}</div>`,
    `<div class="rail-route-popup-subtitle">${escapePopupHtml(args.subtitle)}</div>`,
    rows.length
      ? `<dl class="rail-route-popup-rows">${rows
          .map(([label, value]) => `<div><dt>${escapePopupHtml(label)}</dt><dd>${escapePopupHtml(value)}</dd></div>`)
          .join("")}</dl>`
      : "",
    chips.length
      ? `<div class="rail-route-popup-chips">${chips
          .map((chip) => `<span>${escapePopupHtml(chip)}</span>`)
          .join("")}</div>`
      : "",
    `</div>`,
  ].join("");
}

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const routeState = useAppRouteState();
  const { goToPathCanonicalIfNeeded, goToTab } = useAppNavigation();

  const {
    user,
    setModalState,
    setCompanyDB,
    setRailwayData,
    setRailGraphRuntime,
    setRailGraphLoadState,
    setGeoData,
    trips,
    pins,
    mileageUserEvents,
    railwayData,
    geoData,
    companyDB,
    setTrips,
    setPins,
    setMileageUserEvents,
    folders,
    badgeSettings,
    setSegmentGeometries,
    setTripSegmentsGeometry,
    segmentGeometries,
    setVisitedStations,
    isLoginOpen,
    isHydrated,
    isTripEditing,
    isGlobalSearchOpen,
    pinMode,
    editorMode,
  } = useStore(
    useShallow((state) => ({
      user: state.user,
      setModalState: state.setModalState,
      setCompanyDB: state.setCompanyDB,
      setRailwayData: state.setRailwayData,
      setRailGraphRuntime: state.setRailGraphRuntime,
      setRailGraphLoadState: state.setRailGraphLoadState,
      setGeoData: state.setGeoData,
      trips: state.trips,
      pins: state.pins,
      mileageUserEvents: state.mileageUserEvents,
      railwayData: state.railwayData,
      geoData: state.geoData,
      companyDB: state.companyDB,
      setTrips: state.setTrips,
      setPins: state.setPins,
      setMileageUserEvents: state.setMileageUserEvents,
      folders: state.folders,
      badgeSettings: state.badgeSettings,
      setSegmentGeometries: state.setSegmentGeometries,
      setTripSegmentsGeometry: state.setTripSegmentsGeometry,
      setVisitedStations: state.setVisitedStations,
      segmentGeometries: state.segmentGeometries,
      isLoginOpen: state.modals.isLoginOpen,
      isHydrated: state.isHydrated,
      isTripEditing: state.isTripEditing,
      isGlobalSearchOpen: state.modals.isGlobalSearchOpen,
      pinMode: state.pinMode,
      editorMode: state.editorMode,
    })),
  );

  const { loadUserData, saveData } = useUserData();
  const [stationMenu, setStationMenu] = useState<any>(null);
  const [isExportingKML, setIsExportingKML] = useState(false);
  const { i18n, t } = useTranslation();

  // --- Route state & i18n Sync ---
  useEffect(() => {
    if (!isHydrated || location.pathname.startsWith("/blog")) return;
    goToPathCanonicalIfNeeded();
  }, [
    isHydrated,
    location.pathname,
    location.search,
    location.hash,
    routeState.canonicalPath,
    routeState.isCanonical,
  ]);

  useEffect(() => {
    if (location.pathname.startsWith("/blog")) return;
    const targetLang = toI18nLang(routeState.lang);
    if (i18n.language !== targetLang) {
      void i18n.changeLanguage(targetLang);
    }
  }, [routeState.lang, i18n, location.pathname]);

  const { devMode } = useMeta() as any;
  const isDraggingRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const distanceWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRailGraphLoadState({ status: "loading", reason: "Loading default rail graph deployment bundle." });
    loadDefaultRailGraphDeployment().then((result) => {
      if (cancelled) return;
      if (result.status !== "loaded") {
        setRailGraphLoadState({
          status: result.status,
          reason: result.reason,
          fallbackReason: result.reason,
        });
        return;
      }
      const runtime = result.runtime;
      if (!runtime) return;
      setRailGraphRuntime(runtime);
      console.log("[RailGraph] Loaded deployed runtime bundle", {
        systemId: runtime.deployed.systemId,
        graphId: runtime.system.graphId,
      });
    }).catch((error) => {
      if (!cancelled) {
        const reason = error instanceof Error ? error.message : "Rail graph deployment bundle could not be loaded.";
        setRailGraphLoadState({
          status: "error",
          reason,
          fallbackReason: reason,
        });
      }
      console.warn("[RailGraph] Failed to load deployed runtime bundle", error);
    });
    return () => {
      cancelled = true;
    };
  }, [setRailGraphLoadState, setRailGraphRuntime]);

  // --- April Fool's initialization ---
  useEffect(() => {
    const today = new Date();
    if (
      today.getMonth() === 3 &&
      (today.getDate() === 1 || today.getDate() === 2)
    ) {
      // 0-indexed month (3 = April)
      useStore.getState().setIsAprilFool(true);
      if (Math.random() < 0.5) {
        useStore.getState().setShowFakeProgress(true);
      }
    }
  }, []);

  // --- Close StationMenu on Tab Change ---
  useEffect(() => {
    if (routeState.tab !== "map" && stationMenu) {
      setStationMenu(null);
    }
  }, [routeState.tab, stationMenu]);

  // --- Standalone April Fool's Fake Loading Effect ---
  useEffect(() => {
    const storeState = useStore.getState();
    if (storeState.isAprilFool && storeState.showFakeProgress) {
      const fakeToastId = "april-fools-loading";

      // Start fake loading sequence
      setTimeout(() => {
        toast.loading(
          () => (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                {t("app.fetchRemote", "正在获取远端数据... (10%)")}
              </span>
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: "10%" }}
                ></div>
              </div>
            </div>
          ),
          { id: fakeToastId, duration: Infinity },
        );

        setTimeout(() => {
          toast.loading(
            () => (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                  {t("app.calcDist", "预计算全图站距... (50%)")}
                </span>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: "50%" }}
                  ></div>
                </div>
              </div>
            ),
            { id: fakeToastId, duration: Infinity },
          );

          setTimeout(() => {
            toast.loading(
              () => (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                    {t("app.calcHard", "发现计算太难了，正在放弃... (30%)")}
                  </span>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-red-400 h-1.5 rounded-full transition-all duration-[2000ms] ease-in-out"
                      style={{ width: "30%" }}
                    ></div>
                  </div>
                </div>
              ),
              { id: fakeToastId, duration: Infinity },
            );

            setTimeout(() => {
              toast.loading(
                () => (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                      {t("app.dlAll", "正在下载全宇宙铁路线... (114514%)")}
                    </span>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-visible relative">
                      <div
                        className="bg-purple-500 h-1.5 rounded-full transition-all duration-700 ease-in absolute left-0"
                        style={{ width: "500%" }}
                      ></div>
                    </div>
                  </div>
                ),
                { id: fakeToastId, duration: Infinity },
              );

              setTimeout(() => {
                toast.error(
                  t("app.initFailOk", "初始化失败，但应用已就绪，凑合用吧"),
                  { id: fakeToastId, duration: 4000, position: "top-center" },
                );
              }, 1500);
            }, 2500);
          }, 1000);
        }, 1000);
      }, 500); // Wait for initial app mount
    }
  }, []);

  // --- Auth & URL Parsing ---
  useEffect(() => {
    const getCookie = (name: string) => {
      const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : null;
    };

    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get("token");
    const usernameFromUrl = urlParams.get("username");
    const regTokenFromUrl = urlParams.get("reg_token");
    const status = urlParams.get("status");

    // Token from URL param (legacy) or cookie (OAuth)
    const token = tokenFromUrl || getCookie("rl_token");

    if (token && usernameFromUrl) {
      // Handle OAuth Login
      useStore.getState().login(token, usernameFromUrl);
      loadUserData(token, true);
      // Clean URL & cookie
      window.history.replaceState({}, document.title, window.location.pathname);
      if (!tokenFromUrl) {
        document.cookie = "rl_token=; Path=/; Max-Age=0; SameSite=Lax";
      }
    } else if (regTokenFromUrl) {
      // Handle GitHub Registration
      setModalState({ githubRegToken: regTokenFromUrl, isGithubRegOpen: true });
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (user?.token) {
      // Handle persistent login state recovery
      loadUserData(user.token, false);
    }

    if (status === "bound_success") {
      toast.success(t("app.githubBindSuccess", "GitHub 绑定成功！"));
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
          workerRef.current?.removeEventListener("message", handleMessage);
          if (e.data.type === `${type}_SUCCESS`) {
            resolve(e.data.payload);
          } else if (e.data.type === "ERROR") {
            reject(new Error(e.data.payload));
          }
        }
      };

      workerRef.current.addEventListener("message", handleMessage);
      workerRef.current.postMessage({ id, type, payload });
    });
  };

  // --- Sync Data to Worker ---
  useEffect(() => {
    if (workerRef.current) {
      callWorker("SYNC_DATA", { railwayData, geoData }).catch(console.error);
    }
  }, [railwayData, geoData]);

  // --- 1. Utilities for Parsing and Matching ---
  const normalizeCompanyName = (s: any) => {
    if (!s && s !== 0) return "";
    try {
      return String(s).normalize("NFKC").replace(/\s+/g, " ").trim();
    } catch (e) {
      return String(s).replace(/\s+/g, " ").trim();
    }
  };

  const buildCompanyIndex = (companyData: any) => {
    const idx: any = {};
    if (!companyData) return idx;
    Object.keys(companyData).forEach((k) => {
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
      if (
        keyNorm.includes(n) ||
        n.includes(keyNorm) ||
        keyNorm.startsWith(n) ||
        n.startsWith(keyNorm)
      )
        return companyIndex[keyNorm];
    }
    return name;
  };

  const resolveAssetUrl = (value: any) => {
    if (!value || typeof value !== "string") return value;
    if (value.startsWith("/assets/")) {
      const base = ((import.meta as any).env?.BASE_URL || "/") as string;
      return `${base.replace(/\/$/, "")}${value}`;
    }
    if (value.startsWith("assets/")) {
      const base = ((import.meta as any).env?.BASE_URL || "/") as string;
      return `${base.replace(/\/$/, "")}/${value}`;
    }
    return value;
  };

  const normalizeCompanyDataLogos = (companyData: any) => {
    if (!companyData || typeof companyData !== "object") return companyData;
    return Object.fromEntries(
      Object.entries(companyData).map(([company, item]) => {
        if (!item || typeof item !== "object") return [company, item];
        return [
          company,
          { ...item, logo: resolveAssetUrl((item as any).logo) },
        ];
      }),
    );
  };

  // --- 2. AutoLoad Logic (Moved from RailRound) ---
  const autoLoadData = async () => {
    const showFakeProgress = useStore.getState().showFakeProgress;
    let toastId: string | null = null;
    try {
      console.log("[Autoload] 正在初始化...");
      if (!showFakeProgress) {
        toastId = toast.loading(
          () => (
            <div className="flex flex-col gap-2 w-48">
              <span className="text-sm font-bold text-gray-700">
                {t("app.init0", "正在初始化... (0%)")}
              </span>
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: "0%" }}
                ></div>
              </div>
            </div>
          ),
          { duration: Infinity },
        );
      }
      let currentCompanyData = {};
      if (toastId) {
        toast.loading(
          () => (
            <div className="flex flex-col gap-2 w-48">
              <span className="text-sm font-bold text-gray-700">
                {t("app.loadCompany", "加载公司数据... (5%)")}
              </span>
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: "5%" }}
                ></div>
              </div>
            </div>
          ),
          { id: toastId, duration: Infinity },
        );
      }
      let manifest: any = null;
      try {
        const [companyRes, manifestRes] = await Promise.all([
          fetch(`/company_data.json?v=${Date.now()}`),
          fetch(`/geojson_manifest.json?v=${Date.now()}`).catch(() => null),
        ]);
        if (companyRes.ok) {
          const txt = await companyRes.text();
          currentCompanyData = normalizeCompanyDataLogos(
            JSON.parse(txt.replace(/^\uFEFF/, "")),
          );
          setCompanyDB((prev: any) => ({ ...prev, ...currentCompanyData }));
          (window as any).__companyData = currentCompanyData;
        }
        if (manifestRes && manifestRes.ok) {
          manifest = await manifestRes.json();
        }
      } catch (e) {
        console.warn("[Autoload] company_data.json 加载失败", e);
      }

      const companyIndex = buildCompanyIndex(currentCompanyData);

      const processGeoJsonBatch = (
        items: any[],
        companyData = currentCompanyData,
      ) => {
        const { newFeatures, railwayUpdates } = parseGeoJsonBatch(
          items,
          companyData,
        );

        if (newFeatures.length > 0) {
          setGeoData((prev: any) => ({
            type: "FeatureCollection",
            features: [...prev.features, ...newFeatures],
          }));
        }
        if (Object.keys(railwayUpdates).length > 0) {
          setRailwayData((prev: any) => {
            const next = { ...prev };
            Object.entries(railwayUpdates).forEach(
              ([key, val]: [string, any]) => {
                if (!next[key]) next[key] = val;
                else {
                  val.stations.forEach((s: any) => {
                    if (!next[key].stations.find((ex: any) => ex.id === s.id))
                      next[key].stations.push(s);
                  });
                  if (val.meta.icon && !next[key].meta.icon)
                    next[key].meta.icon = val.meta.icon;
                }
              },
            );
            return next;
          });
        }
      };

      let cachedFiles: any[] = [];
      let realFiles: any[] = [];
      let storedVersions: Record<string, number> = {};
      if (toastId) {
        toast.loading(
          () => (
            <div className="flex flex-col gap-2 w-48">
              <span className="text-sm font-bold text-gray-700">
                {t("app.readCache", "读取本地缓存... (10%)")}
              </span>
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: "10%" }}
                ></div>
              </div>
            </div>
          ),
          { id: toastId, duration: Infinity },
        );
      }
      try {
        const dbInstance: any = await db.open();
        if (!dbInstance) throw new Error("[Autoload] Failed to open IndexedDB");

        // 1. Load GeoJSON files
        const txFiles = dbInstance.transaction(db.STORE_FILES, "readonly");
        const storeFiles = txFiles.objectStore(db.STORE_FILES);
        const reqFiles = storeFiles.getAll();
        cachedFiles = await new Promise((resolve) => {
          reqFiles.onsuccess = () => resolve(reqFiles.result || []);
          reqFiles.onerror = () => resolve([]);
        });
        // Attempt to read fully precompiled geoData & railwayData structures directly (FAST PATH)
        let precompiledGeoData: any = null;
        let precompiledRailwayData: any = null;
        if (!devMode) {
          try {
            const txGeo = dbInstance.transaction(db.STORE_FILES, "readonly");
            const storeGeo = txGeo.objectStore(db.STORE_FILES);

            const reqGeo = storeGeo.get("__precompiled_geodata");
            precompiledGeoData = await new Promise((resolve) => {
              reqGeo.onsuccess = () => resolve(reqGeo.result || null);
              reqGeo.onerror = () => resolve(null);
            });

            const reqRail = storeGeo.get("__precompiled_railwaydata");
            precompiledRailwayData = await new Promise((resolve) => {
              reqRail.onsuccess = () => resolve(reqRail.result || null);
              reqRail.onerror = () => resolve(null);
            });
            const reqVer = storeGeo.get("__precompiled_geoversion");
            storedVersions = await new Promise((resolve) => {
              reqVer.onsuccess = () => resolve(reqVer.result || {});
              reqVer.onerror = () => resolve({});
            });
          } catch (e) {}
        } else {
          console.log(
            "[Autoload] Dev mode enabled: skipping __precompiled_geodata cache.",
          );
        }

        // Exclude caches from cachedFiles list used for manifest comparison
        realFiles = cachedFiles.filter(
          (f) =>
            f.fileName &&
            !f.fileName.startsWith("__precompiled_") &&
            !f.fileName.startsWith("zustand_"),
        );

        let geoUpToDate =
          precompiledGeoData &&
          precompiledRailwayData &&
          realFiles.length > 0;
        if (geoUpToDate && manifest) {
          const remoteVersions: Record<string, number> =
            manifest.versions || {};
          const forceReload = manifest.forceReload === true;
          if (forceReload) {
            geoUpToDate = false;
            console.log(
              "[Autoload] manifest.forceReload 触发，预编译缓存已废弃",
            );
          } else if (Object.keys(remoteVersions).length > 0) {
            for (const [company, remoteVer] of Object.entries(
              remoteVersions,
            )) {
              const storedVer = Number(storedVersions[company]) || 0;
              if (remoteVer > storedVer) {
                geoUpToDate = false;
                console.log(
                  `[Autoload] Geo 版本变更: ${company} 本地=${storedVer} 远程=${remoteVer}`,
                );
                break;
              }
            }
          }
        }

        if (geoUpToDate) {
          if (toastId) {
            toast.loading(
              () => (
                <div className="flex flex-col gap-2 w-48">
                  <span className="text-sm font-bold text-gray-700">
                    {t("app.fastCache", "极速命中缓存... (20%)")}
                  </span>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: "20%" }}
                    ></div>
                  </div>
                </div>
              ),
              { id: toastId, duration: Infinity },
            );
          }
          // Fast path hit! Skip heavy processing.
          setGeoData(precompiledGeoData);
          setRailwayData(precompiledRailwayData);
          console.log(`[Autoload] 命中预编译 GeoData 和 RailwayData 缓存`);
        } else if (realFiles.length > 0) {
          if (toastId) {
            toast.loading(
              () => (
                <div className="flex flex-col gap-2 w-48">
                  <span className="text-sm font-bold text-gray-700">
                    {t("app.parseLocal", "解析本地数据... (20%)")}
                  </span>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: "20%" }}
                    ></div>
                  </div>
                </div>
              ),
              { id: toastId, duration: Infinity },
            );
          }
          // Fallback to heavy processing and then cache the result
          processGeoJsonBatch(realFiles, currentCompanyData);
          // Use setTimeout to allow state to settle before caching
          setTimeout(async () => {
            const currentGeo = useStore.getState().geoData;
            const currentRail = useStore.getState().railwayData;
            if (currentGeo && currentGeo.features.length > 0) {
              try {
                await db.set(
                  db.STORE_FILES,
                  "__precompiled_geodata",
                  currentGeo,
                );
                await db.set(
                  db.STORE_FILES,
                  "__precompiled_railwaydata",
                  currentRail,
                );
                if (manifest?.versions) {
                  await db.set(
                    db.STORE_FILES,
                    "__precompiled_geoversion",
                    manifest.versions,
                  );
                }
              } catch (e) {}
            }
          }, 100);
        }

        if (toastId) {
          toast.loading(
            () => (
              <div className="flex flex-col gap-2 w-48">
                <span className="text-sm font-bold text-gray-700">
                  {t("app.loadThumb", "加载行程缩略图... (25%)")}
                </span>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: "25%" }}
                  ></div>
                </div>
              </div>
            ),
            { id: toastId, duration: Infinity },
          );
        }
        // 2. Pre-load all segment geometries into memory at once to eliminate massive I/O lag
        const txSegments = dbInstance.transaction(
          db.STORE_SEGMENTS,
          "readonly",
        );
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
          console.log(
            `[Autoload] 预加载了 ${preloadedGeometries.size} 条行程缩略图缓存`,
          );
        }
      } catch (e) {
        console.warn("Cache read failed", e);
      }

      if (toastId) {
        toast.loading(
          () => (
            <div className="flex flex-col gap-2 w-48">
              <span className="text-sm font-bold text-gray-700">
                {t("app.checkUpdate", "检查云端更新... (30%)")}
              </span>
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: "30%" }}
                ></div>
              </div>
            </div>
          ),
          { id: toastId, duration: Infinity },
        );
      }
      if (manifest) {
        let missingFiles: { fileName: string; hash?: string }[] = [];

        if (Array.isArray(manifest.files)) {
          // Legacy array format: fallback to checking existence only
          const cachedFileNames = new Set(realFiles.map((f) => f.fileName));
          missingFiles = manifest.files
            .filter(
              (f: string) =>
                !cachedFileNames.has(f.replace(/\.(geojson|json)$/i, "")),
            )
            .map((f: string) => ({ fileName: f }));
        } else if (manifest.files && typeof manifest.files === "object") {
          // New hash-based format: { "JR-East.geojson": "hash123", ... }
          const cachedFilesMap = new Map(
            realFiles.map((f) => [f.fileName, f.hash]),
          );
          missingFiles = Object.entries(manifest.files)
            .filter(([fileName, hash]) => {
              const localFileName = fileName.replace(/\.(geojson|json)$/i, "");
              const localHash = cachedFilesMap.get(localFileName);
              return localHash !== hash; // Also covers missing files (localHash is undefined)
            })
            .map(([fileName, hash]) => ({ fileName, hash: hash as string }));
        }

        if (missingFiles.length > 0) {
          let downloadedCount = 0;
          const totalToDownload = missingFiles.length;
          const downloadTasks = missingFiles.map(
            async (fileInfo: { fileName: string; hash?: string }) => {
              const { fileName, hash } = fileInfo;
              try {
                const res = await fetch(
                  `/geojson/${fileName.includes(".geojson") ? fileName : `${fileName}.geojson`}?v=${Date.now()}`,
                );
                downloadedCount++;
                const progress =
                  30 + Math.round((downloadedCount / totalToDownload) * 20); // Scale up to 50%
                if (toastId) {
                  toast.loading(
                    () => (
                      <div className="flex flex-col gap-2 w-48">
                        <span className="text-sm font-bold text-gray-700">
                          {t(
                            "app.dlUpdate",
                            "下载更新 {{dl}}/{{total}}... ({{prog}}%)",
                            {
                              dl: downloadedCount,
                              total: totalToDownload,
                              prog: progress,
                            },
                          )}
                        </span>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                      </div>
                    ),
                    { id: toastId, duration: Infinity },
                  );
                }
                if (!res.ok) throw new Error(`Status ${res.status}`);
                const json = await res.json();
                const rawCompanyName = fileName.replace(
                  /\.(geojson|json)$/i,
                  "",
                );
                const matchedCompany = findBestCompanyKey(
                  rawCompanyName,
                  companyIndex,
                );
                const dataItem = {
                  json,
                  company: matchedCompany,
                  fileName: rawCompanyName,
                  hash,
                };
                db.set(db.STORE_FILES, rawCompanyName, dataItem).catch((e: unknown) =>
                  console.warn("Cache write failed", e),
                );
                return dataItem;
              } catch (e: any) {
                return null;
              }
            },
          );

          const results = await Promise.all(downloadTasks);
          const validResults = results.filter((r) => r !== null);
          if (validResults.length > 0) {
            processGeoJsonBatch(validResults, currentCompanyData);

            // Overwrite precompiled geodata cache after updating with new downloaded files.
            // State updates are async, wait a moment to capture the latest.
            setTimeout(async () => {
              const updatedGeo = useStore.getState().geoData;
              const updatedRail = useStore.getState().railwayData;
              if (updatedGeo && updatedGeo.features.length > 0) {
                try {
                  await db.set(
                    db.STORE_FILES,
                    "__precompiled_geodata",
                    updatedGeo,
                  );
                  await db.set(
                    db.STORE_FILES,
                    "__precompiled_railwaydata",
                    updatedRail,
                  );
                  if (manifest?.versions) {
                    await db.set(
                      db.STORE_FILES,
                      "__precompiled_geoversion",
                      manifest.versions,
                    );
                  }
                } catch (e) {}
              }
            }, 500);
          }
        }
      }
    } catch (err: any) {
      console.error("[Autoload] 致命网络错误, 跳过检查:", err);
      if (toastId) {
        toast.error(
          t("app.initErr", "初始化发生错误 - {{msg}}", { msg: err.message }),
          { id: toastId, duration: 3000 },
        );
      } else {
        toast.error(
          t("app.initErr", "初始化发生错误 - {{msg}}", { msg: err.message }),
          { duration: 3000 },
        );
      }
    }

    console.log("[Autoload] 初始化全部完成，应用就绪。");

    // Trigger distance calculation after data load regardless of whether network loaded new files
    if (distanceWorkerRef.current) {
      const currentRailwayData = useStore.getState().railwayData;

      // Only trigger if we have data and missing distances
      const needsCalc = Object.values(currentRailwayData).some(
        (line) =>
          line.stations.length > 1 && line.stations[0].distToNext === undefined,
      );

      if (needsCalc) {
        const showFakeProgress = useStore.getState().showFakeProgress;

        if (!showFakeProgress) {
          // Using a custom dynamic progress bar toast instead of plain text updates
          toast.loading(
            () => (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                  {t("app.calcDist", "预计算全图站距... (50%)")}
                </span>
                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: "50%" }}
                  ></div>
                </div>
              </div>
            ),
            { id: toastId ?? undefined, duration: Infinity },
          );
        }

        const handleDistanceWorkerMsg = (e: MessageEvent) => {
          const { type, payload } = e.data;

          if (type === "PROGRESS" && toastId && !showFakeProgress) {
            const scaledProgress = 50 + Math.round(payload.progress * 0.5); // Map 0-100 to 50-100
            toast.loading(
              () => (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-gray-700 whitespace-nowrap">
                    {t("app.calcDistProg", "预计算全图站距... ({{prog}}%)", {
                      prog: scaledProgress,
                    })}
                  </span>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all duration-200 ease-out"
                      style={{ width: `${scaledProgress}%` }}
                    ></div>
                  </div>
                </div>
              ),
              { id: toastId, duration: Infinity },
            );
          } else if (type === "COMPLETE") {
            if (toastId && !showFakeProgress)
              toast.success(t("app.initDone", "初始化完成"), {
                id: toastId,
                duration: 3000,
              });
            distanceWorkerRef.current?.removeEventListener(
              "message",
              handleDistanceWorkerMsg,
            );

            // Merge updated distances into CURRENT railway data instead of overwriting,
            // to prevent losing data fetched concurrently while the worker was running.
            const currentRail = useStore.getState().railwayData;
            const next = { ...currentRail };
            const updatedData = payload.updatedRailwayData;
            for (const [lineKey, line] of Object.entries(next)) {
              if (updatedData[lineKey]) {
                next[lineKey] = {
                  ...line,
                  stations: line.stations.map((st, idx) => {
                    const updatedSt = updatedData[lineKey].stations.find(
                      (us: any) => us.id === st.id,
                    );
                    return updatedSt
                      ? { ...st, distToNext: updatedSt.distToNext }
                      : st;
                  }),
                };
              }
            }

            setRailwayData(next);

            // Immediately persist the computed distances into our precompiled cache
            // so they survive the next refresh/fast-path boot.
            db.set(db.STORE_FILES, "__precompiled_railwaydata", next).catch(
              (e: unknown) =>
                console.warn("Failed to persist precompiled distances:", e),
            );
          }
        };

        distanceWorkerRef.current.addEventListener(
          "message",
          handleDistanceWorkerMsg,
        );
        distanceWorkerRef.current.postMessage({
          type: "CALC_DISTANCES",
          payload: { railwayData: currentRailwayData },
        });
      } else {
        if (toastId)
          toast.success(t("app.initDone", "初始化完成"), {
            id: toastId,
            duration: 3000,
          });
      }
    } else {
      console.log(
        "Distance Worker not initialized, skipping distance calculations",
      );
      if (toastId)
        toast.success(t("app.initDone", "初始化完成"), {
          id: toastId,
          duration: 3000,
        });
    }
  };

  const hasInitializedRef = useRef(false);

  // --- 3. Geo Calculation Effects ---
  useEffect(() => {
    // 使用 setTimeout 加上简单的防抖，防止编辑/添加行程时高频触发导致卡顿
    const timerId = setTimeout(() => {
      const productTrips = trips.map((trip) => ({
        trip,
        segments: tripToProductSegments(trip, railwayData),
      }));
      const allSegments = productTrips.flatMap((item) => item.segments);
      const detailByTripId = new Map(
        productTrips.map(({ trip }) => [
          String(trip.id),
          buildTripDetailModel({ trip, railwayData, userEvents: mileageUserEvents }),
        ]),
      );
      const directionLabel = (direction?: string) => {
        if (!direction) return t("map.route.unknown", "Unknown");
        if (direction === "up") return t("map.route.direction.up", "Up");
        if (direction === "down") return t("map.route.direction.down", "Down");
        if (direction === "clockwise") return t("map.route.direction.clockwise", "Clockwise");
        if (direction === "counterclockwise") return t("map.route.direction.counterclockwise", "Counterclockwise");
        return direction;
      };

      // Extract visited stations logic
      const visited = new Set<string>();
      allSegments.forEach((seg) => {
        const line = railwayData[seg.lineKey];
        if (!line) return;

        const fromIdx = line.stations.findIndex((s) => s.id === seg.fromId);
        const toIdx = line.stations.findIndex((s) => s.id === seg.toId);

        if (fromIdx !== -1 && toIdx !== -1) {
          const isLoop = !!line.meta?.isLoop;
          let realVia = seg.loopVia;
          if (isLoop && (!realVia || realVia === "auto")) {
            realVia = computeLoopVia(
              railwayData,
              seg.lineKey,
              seg.fromId,
              seg.toId,
            );
          }

          if (isLoop && (realVia === "up" || realVia === "down")) {
            let currIdx = fromIdx;
            const n = line.stations.length;
            visited.add(line.stations[currIdx].id);

            let safeCounter = 0;
            while (currIdx !== toIdx && safeCounter <= n) {
              if (realVia === "up") {
                currIdx = (currIdx + 1) % n;
              } else {
                currIdx = (currIdx - 1 + n) % n;
              }
              visited.add(line.stations[currIdx].id);
              safeCounter++;
            }
          } else {
            // Linear line or unhandled loop edge cases
            const start = Math.min(fromIdx, toIdx);
            const end = Math.max(fromIdx, toIdx);
            for (let i = start; i <= end; i++) {
              visited.add(line.stations[i].id);
            }
          }
        }
      });
      setVisitedStations(visited);

      // 1. 优先使用已有的缓存进行渲染，保证部分路线立即显示，防止整张地图因为几段缺失而瘫痪。
      const buildRenderList = (cache: Map<string, any>) => {
        const list: any[] = [];
        productTrips.forEach(({ trip, segments: segs }) => {
          const detail = detailByTripId.get(String(trip.id));
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const detailSegment = detail?.segments[i];
            if (seg.source === "rail_graph" && seg.geometry?.length) {
              list.push({
                id: seg.id || `rail-graph_${trip.id}_${i}`,
                coords: seg.geometry,
                color: seg.displayColor || "#94a3b8",
                isMulti: false,
                fallback: false,
                source: "rail_graph",
                popup: buildRoutePopupHtml({
                  sourceLabel: t("map.route.sourceRailGraph", "Rail graph snapshot"),
                  sourceKind: "rail_graph",
                  title: seg.lineLabel || seg.lineKey,
                  subtitle: `${seg.fromName || seg.fromId} -> ${seg.toName || seg.toId}`,
                  rows: [
                    [t("map.route.service", "Service"), seg.serviceType],
                    [t("map.route.directionLabel", "Direction"), directionLabel(seg.direction)],
                    [t("map.route.pattern", "Pattern"), seg.patternRef ? String(seg.patternRef) : undefined],
                    [t("map.route.distance", "Distance"), t("map.route.km", "{{value}} km", { value: Math.max(0, seg.distanceKm).toFixed(1) })],
                    [t("map.route.userEvents", "User events"), detailSegment?.userEventCount ?? 0],
                    [t("map.route.geoSource", "Geometry"), t("map.route.geoRailGraph", "Saved rail-graph geometry")],
                  ],
                  chips: [
                    t("map.route.stopPass", "{{stops}} stops / {{passes}} pass", {
                      stops: detailSegment?.stopCount ?? seg.stopCount ?? 0,
                      passes: detailSegment?.passCount ?? seg.passCount ?? 0,
                    }),
                    t("map.route.via", "{{count}} via", { count: detailSegment?.viaStationCount ?? seg.viaStationCount ?? 0 }),
                  ],
                }),
              });
              continue;
            }

            const key = getSegmentKey(railwayData, seg.lineKey, seg.fromId, seg.toId, seg.loopVia);
            const cached = cache.get(key);
            const line = railwayData[seg.lineKey];
            const s1 = line?.stations.find((s: any) => s.id === seg.fromId);
            const s2 = line?.stations.find((s: any) => s.id === seg.toId);

            if (cached) {
              list.push({
                id: seg.id || key,
                ...cached,
                source: "legacy",
                popup: buildRoutePopupHtml({
                  sourceLabel: cached.fallback
                    ? t("map.route.sourceFallback", "Geometry fallback")
                    : t("map.route.sourceLegacy", "Legacy GeoJSON"),
                  sourceKind: cached.fallback ? "fallback" : "legacy",
                  title: seg.lineLabel || seg.lineKey,
                  subtitle: `${s1?.name_ja || seg.fromId} -> ${s2?.name_ja || seg.toId}`,
                  rows: [
                    [t("map.route.geoSource", "Geometry"), cached.fallback
                      ? t("map.route.geoFallback", "Station-to-station fallback")
                      : t("map.route.geoJson", "Loaded GeoJSON path")],
                    [t("map.route.userEvents", "User events"), detailSegment?.userEventCount ?? 0],
                  ],
                }),
              });
            }

            // Check for transfer to the next segment
            if (i < segs.length - 1) {
              const nextSeg = segs[i + 1];
              const nextLine = railwayData[nextSeg.lineKey];
              const nextS1 = nextLine?.stations.find(
                (s: any) => s.id === nextSeg.fromId,
              );

              // If they are different stations (by id) but part of a continuous trip, we draw a transfer line
              if (s2 && nextS1 && s2.id !== nextS1.id) {
                list.push({
                  id: `transfer_${trip.id}_${i}`,
                  coords: [
                    [s2.lat, s2.lng],
                    [nextS1.lat, nextS1.lng],
                  ],
                  color: "#9ca3af", // default gray for transfer
                  isMulti: false,
                  fallback: false,
                  isTransfer: true,
                  source: "legacy",
                  popup: buildRoutePopupHtml({
                    sourceLabel: t("map.route.sourceTransfer", "Transfer"),
                    sourceKind: "transfer",
                    title: t("map.route.transfer", "Transfer"),
                    subtitle: `${s2.name_ja} -> ${nextS1.name_ja}`,
                  }),
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
      const needed = allSegments.filter((seg) => {
        if (seg.source === "rail_graph") return false;
        if (!seg.lineKey || !seg.fromId || !seg.toId) return false;
        const key = getSegmentKey(railwayData, seg.lineKey, seg.fromId, seg.toId, seg.loopVia);
        return !segmentGeometries.has(key);
      });

      if (needed.length === 0) return;

      const fetchMissing = async () => {
        const newCache = new Map(segmentGeometries);
        let updated = false;
        const toCalculateInWorker: any[] = [];

        // 先尝试从 IndexedDB 加载
        for (const seg of needed) {
          const key = getSegmentKey(railwayData, seg.lineKey, seg.fromId, seg.toId, seg.loopVia);
          let data = await db.get(db.STORE_SEGMENTS, key).catch(() => null);

          // 如果缓存是 fallback，但此时可能 geoData 已经加载好了，
          // 我们允许它重新进入 Worker 计算队列，而不是永远被锁死在 [0,0] 的直线。
          if (data && !data.fallback) {
            newCache.set(key, data);
            updated = true;
          } else {
            const line = railwayData[seg.lineKey];
            const isLoop = !!line?.meta?.isLoop;
            const resolvedVia = isLoop
              ? !seg.loopVia || seg.loopVia === "auto"
                ? computeLoopVia(railwayData, seg.lineKey, seg.fromId, seg.toId)
                : seg.loopVia
              : undefined;
            toCalculateInWorker.push({
              ...seg,
              loopVia: resolvedVia,
            });
          }
        }

        // 如果有需要计算的，且 geoData 已经初步加载，再交给 Worker 计算
        // (如果 geoData 为空，我们先不派发任务，免得算出大量 fallback 写入缓存)
        if (
          toCalculateInWorker.length > 0 &&
          workerRef.current &&
          geoData &&
          geoData.features.length > 0
        ) {
          try {
            const results = await callWorker("GET_ALL_GEOMETRIES", {
              segments: toCalculateInWorker,
            });
            for (const res of results) {
              const { key, data } = res;
              if (data && !data.fallback) {
                newCache.set(key, data);
                await db.set(db.STORE_SEGMENTS, key, data);
                updated = true;
              } else {
                // 对于确实无法匹配的数据，生成一个基于车站经纬度的 fallback，而不是 [0,0]
                const seg = toCalculateInWorker.find((s: any) => {
                  const k = getSegmentKey(railwayData, s.lineKey, s.fromId, s.toId, s.loopVia);
                  return k === key;
                });
                let fallbackCoords = [
                  [0, 0],
                  [0, 0],
                ];
                if (seg && railwayData[seg.lineKey]) {
                  const line = railwayData[seg.lineKey];
                  const s1 = line.stations.find(
                    (s: any) => s.id === seg.fromId,
                  );
                  const s2 = line.stations.find((s: any) => s.id === seg.toId);
                  if (s1 && s2) {
                    fallbackCoords = [
                      [s1.lat, s1.lng],
                      [s2.lat, s2.lng],
                    ];
                  }
                }
                const fallbackData = {
                  coords: fallbackCoords,
                  color: "#ff0000",
                  isMulti: false,
                  fallback: true,
                };
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
    }, 100); // 100ms 延时/防抖

    return () => clearTimeout(timerId);
  }, [trips, geoData, railwayData, segmentGeometries, mileageUserEvents, t]);

  useEffect(() => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      autoLoadData();
    }
  }, []);

  useEffect(() => {
    if (!companyDB || Object.keys(companyDB).length === 0) return;
    setRailwayData((prev: any) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((lineKey) => {
        const line = next[lineKey];
        if (!line || !line.meta) return;
        const compName = line.meta.company;
        if (companyDB[compName]) {
          const info = companyDB[compName] as any;
          const unknownLabel = t("app.unknown", "未知");
          if (
            !line.meta.region ||
            !line.meta.type ||
            line.meta.region === "未知" ||
            line.meta.region === unknownLabel ||
            line.meta.type === "未知" ||
            line.meta.type === unknownLabel
          ) {
            next[lineKey] = {
              ...line,
              meta: {
                ...line.meta,
                region: info.region,
                type: info.type,
                logo: info.logo,
              },
            };
            changed = true;
          }
        }
      });
      return changed ? next : prev;
    });
  }, [companyDB, setRailwayData]);

  // --- 4. File Handlers ---
  const handleExportKML = async () => {
    if (isExportingKML) return;
    setIsExportingKML(true);
    setTimeout(async () => {
      try {
        if (trips.length === 0 || !geoData) {
          showAlert(t("app.noRecord", "无行程记录或地图数据未加载。"));
          setIsExportingKML(false);
          return;
        }
        const allPaths: any[] = [];

        // 由于 sliceGeoJsonPath 已移至 Worker，我们需要用另一种方式处理 KML 导出。
        // 最简单的方法是重用现有的 segmentGeometries 缓存！
        trips.forEach((trip) => {
          if (trip.isWalk) return; // Exclude walk trips
          const tripName = `${trip.date} - Trip ${trip.id}`;
          const productPaths = tripToKmlPathItems(trip, railwayData);
          if (productPaths.length > 0) {
            allPaths.push(...productPaths);
            return;
          }
          trip.segments.forEach((seg: any, segIndex: number) => {
            const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
            const cached = segmentGeometries.get(key);
            if (cached && cached.coords) {
              const coords = cached.coords;
              const kmlCoords = cached.isMulti
                ? coords
                    .flat()
                    .map((p: any) => `${p[1]},${p[0]},0`)
                    .join(" ")
                : coords.map((p: any) => `${p[1]},${p[0]},0`).join(" ");
              allPaths.push({
                name: `${tripName} Segment ${segIndex + 1}`,
                coordinates: kmlCoords,
                lineKey: seg.lineKey,
              });
            }
          });
        });

        if (allPaths.length === 0) {
          showAlert(
            t(
              "app.noExportPath",
              "未找到可导出路径（请确保路线在地图上已显示）。",
            ),
          );
          setIsExportingKML(false);
          return;
        }
        const kmlString = buildKMLString(allPaths);
        const blob = new Blob([kmlString], {
          type: "application/vnd.google-earth.kml+xml",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        if (useStore.getState().isAprilFool) {
          link.download = `双击打开行程备份.kml.exe`;
          toast.success(
            t("app.backupGen", "已生成 kml 备份文件，请注意查收！"),
            { duration: 3000 },
          );
        } else {
          link.download = `RailLOOP_KML_export_${new Date().toISOString().slice(0, 10)}.kml`;
        }
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
          setIsExportingKML(false);
        }, 2000);
      } catch (e) {
        console.error("KML Export Error:", e);
        showAlert(t("app.exportErr", "导出过程中发生错误。"), "", "error");
        setIsExportingKML(false);
      }
    }, 100);
  };

  const handleExportUserData = () => {
    const linesUsed = new Set();
    const companiesUsed = new Set();
    trips.forEach((trip) => {
      tripToProductSegments(trip, railwayData).forEach((s: any) => {
        if (s.lineKey) {
          linesUsed.add(s.lineKey);
          const meta = railwayData[s.lineKey]?.meta;
          if (s.company) companiesUsed.add(s.company);
          if (meta && meta.company) companiesUsed.add(meta.company);
        }
      });
    });
    const backupData = {
      meta: {
        version: CURRENT_VERSION,
        exportedAt: new Date().toISOString(),
        appName: "RailLOOP",
      },
      dependencies: {
        lines: Array.from(linesUsed),
        companies: Array.from(companiesUsed),
      },
      data: { trips: trips, pins: pins, mileageUserEvents },
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `railround_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportUserData = (event: any) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (
          !backup.meta ||
          (backup.meta.appName !== "RailLOOP" && backup.meta.appName !== "")
        ) {
          showAlert(t("app.invalidBackup", "无效的备份文件"), "", "error");
          return;
        }
        const missingLines: string[] = [];
        if (backup.dependencies && backup.dependencies.lines) {
          backup.dependencies.lines.forEach((lineKey: string) => {
            if (!railwayData[lineKey]) missingLines.push(lineKey);
          });
        }
        if (missingLines.length > 0) {
          const msg = t(
            "app.missLine",
            "检测到缺少以下线路的基础数据，可能会导致显示异常：\n\n{{lines}}\n\n建议先去地图页面上传对应的 GeoJSON 文件。是否继续导入？",
            {
              lines:
                missingLines.slice(0, 5).join(", ") +
                (missingLines.length > 5 ? "..." : ""),
            },
          );
          if (!(await showConfirm(t("app.missLineTitle", "缺少数据"), msg)))
            return;
        }
        const currentTripIds = new Set(trips.map((trip) => trip.id));
        const incomingTrips = backup.data.trips || [];
        const uniqueIncomingTrips: any[] = [];
        const tempTripIds = new Set();
        incomingTrips.forEach((trip: any) => {
          if (!tempTripIds.has(trip.id)) {
            tempTripIds.add(trip.id);
            uniqueIncomingTrips.push(trip);
          }
        });
        const newTrips = uniqueIncomingTrips.filter(
          (trip) => !currentTripIds.has(trip.id),
        );
        const currentPinIds = new Set(pins.map((p) => p.id));
        const incomingPins = backup.data.pins || [];
        const uniqueIncomingPins: any[] = [];
        const tempPinIds = new Set();
        incomingPins.forEach((p: any) => {
          if (!tempPinIds.has(p.id)) {
            tempPinIds.add(p.id);
            uniqueIncomingPins.push(p);
          }
        });
        const newPins = uniqueIncomingPins.filter(
          (p) => !currentPinIds.has(p.id),
        );
        const currentEventIds = new Set(mileageUserEvents.map((event) => event.id));
        const incomingEvents = backup.data.mileageUserEvents || backup.data.mileage_user_events || [];
        const uniqueIncomingEvents: typeof mileageUserEvents = [];
        const tempEventIds = new Set();
        incomingEvents.forEach((event: any) => {
          if (event?.id && !tempEventIds.has(event.id)) {
            tempEventIds.add(event.id);
            uniqueIncomingEvents.push(event);
          }
        });
        const newEvents = uniqueIncomingEvents.filter(
          (event) => !currentEventIds.has(event.id),
        );
        if (newTrips.length > 0) {
          setTrips((prev) =>
            [...prev, ...newTrips].sort((a, b) => b.date.localeCompare(a.date)),
          );
        }
        if (newPins.length > 0) {
          setPins((prev) => [...prev, ...newPins]);
        }
        if (newEvents.length > 0) {
          setMileageUserEvents((prev) => [...prev, ...newEvents]);
        }
        showAlert(
          t(
            "app.importSuccess",
            "数据导入完成！\n\n行程: 新增 {{newT}} 条 (跳过重复/无效 {{skipT}} 条)\n图钉: 新增 {{newP}} 个 (跳过重复/无效 {{skipP}} 个)",
            {
              newT: newTrips.length,
              skipT: incomingTrips.length - newTrips.length,
              newP: newPins.length,
              skipP: incomingPins.length - newPins.length,
            },
          ),
          "",
          "success",
        );
      } catch (err) {
        showAlert(t("app.fileParseErr", "文件解析失败"), "", "error");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const applyCompanyData = (data: any, { silent = true } = {}) => {
    if (!data || typeof data !== "object") return;
    setCompanyDB((prev: any) => ({ ...prev, ...data }));
    try {
      (window as any).__companyData = {
        ...((window as any).__companyData || {}),
        ...data,
      };
    } catch (e) {}
    if (!silent)
      showAlert(t("app.companyUpdated", "公司数据库已更新"), "", "success");
  };

  const handleCompanyUpload = (event: any) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const json = JSON.parse(e.target.result);
        applyCompanyData(json, { silent: false });
      } catch (err) {
        showAlert(t("app.parseFail", "解析失败"), "", "error");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const handleFileUpload = async (event: any) => {
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
          } catch (err) {
            showAlert(
              t("app.fileSkip", "文件 {{name}} 解析失败，已跳过", {
                name: file.name,
              }),
              "",
              "warning",
            );
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      });
    });
    try {
      const results = await Promise.all(readTasks);
      const validResults = results.filter((r) => r !== null) as any[];
      if (validResults.length === 0) return;

      const newFeatures: any[] = [];
      const railwayUpdates: any = {};
      validResults.forEach(({ json, companyName: defaultCompany }) => {
        if (!json.features) return;
        const uploadedLabel = t("app.uploadedData", "上传数据");
        const enriched = json.features.map((f: any) => ({
          ...f,
          properties: {
            ...f.properties,
            company:
              f.properties.company ||
              f.properties.operator ||
              defaultCompany ||
              uploadedLabel,
          },
        }));
        newFeatures.push(...enriched);
        enriched.forEach((f: any) => {
          const p = f.properties;
          const comp = p.company;
          const ensureLineInTemp = (lineName: string, props: any) => {
            const lineKey = `${comp}:${lineName}`;
            if (!railwayUpdates[lineKey]) {
              const info =
                ((window as any).__companyData &&
                  (window as any).__companyData[comp]) ||
                companyDB[comp] ||
                {};
              const icon = props.icon || info.logo || null;
              const unknownLabel = t("app.unknown", "未知");
              railwayUpdates[lineKey] = {
                meta: {
                  region: info.region || unknownLabel,
                  type: info.type || unknownLabel,
                  company: comp,
                  logo: info.logo,
                  icon,
                },
                stations: [],
              };
            } else if (props.icon && !railwayUpdates[lineKey].meta.icon) {
              railwayUpdates[lineKey].meta.icon = props.icon;
            }
            return lineKey;
          };
          if (p.type === "line" && p.name) {
            ensureLineInTemp(p.name, p);
          } else if (
            p.type === "station" &&
            p.line &&
            p.name &&
            f.geometry?.coordinates
          ) {
            const lineKey = ensureLineInTemp(p.line, p);
            const stations = railwayUpdates[lineKey].stations;
            if (!stations.find((s: any) => s.name_ja === p.name)) {
              const stationId = p.id || `${comp}:${p.line}:${p.name}`;
              stations.push({
                id: stationId,
                name_ja: p.name,
                lat: f.geometry.coordinates[1],
                lng: f.geometry.coordinates[0],
                transfers: p.transfers || [],
              });
            }
          }
        });
      });
      if (newFeatures.length > 0)
        setGeoData((prev: any) => ({
          type: "FeatureCollection",
          features: [...prev.features, ...newFeatures],
        }));
      if (Object.keys(railwayUpdates).length > 0) {
        setRailwayData((prev: any) => {
          const next = { ...prev };
          Object.entries(railwayUpdates).forEach(
            ([key, val]: [string, any]) => {
              if (!next[key]) {
                next[key] = val;
              } else {
                val.stations.forEach((s: any) => {
                  if (!next[key].stations.find((ex: any) => ex.id === s.id))
                    next[key].stations.push(s);
                });
                if (val.meta.icon && !next[key].meta.icon)
                  next[key].meta.icon = val.meta.icon;
              }
            },
          );
          return next;
        });
      }
      showAlert(
        t("app.importCount", "成功导入 {{count}} 个文件！", {
          count: validResults.length,
        }),
        "",
        "success",
      );
    } catch (err) {
      showAlert(
        t("app.fileProcErr", "文件处理过程中发生未知错误"),
        "",
        "error",
      );
    } finally {
      event.target.value = "";
    }
  };

  const handleGlobalSearchSelect = (lineKey: string, stationId?: string) => {
    setModalState({ isGlobalSearchOpen: false });
    goToTab("map");
    const station = stationId
      ? railwayData[lineKey]?.stations.find((candidate: any) => candidate.id === stationId)
      : railwayData[lineKey]?.stations[0];
    if (!station) return;
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("map:fly-to-location", {
          detail: { lat: station.lat, lng: station.lng, zoom: stationId ? 14 : 11 },
        }),
      );
    }, 150);
  };

  const handleGlobalSearchTripSelect = (tripId: string | number) => {
    setModalState({ isGlobalSearchOpen: false });
    goToTab("records");
    window.setTimeout(() => {
      document.getElementById(`trip-${String(tripId)}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);
  };

  const handleGlobalSearchEventSelect = (eventId: string) => {
    setModalState({ isGlobalSearchOpen: false });
    const event = mileageUserEvents.find((candidate) => candidate.id === eventId);
    const projected = event ? boundMileageEventForRichDisplay(event, railwayData, trips) : null;
    goToTab("map");
    window.setTimeout(() => {
      if (projected?.bound.coordinates) {
        window.dispatchEvent(
          new CustomEvent("map:fly-to-location", {
            detail: {
              lat: projected.bound.coordinates[1],
              lng: projected.bound.coordinates[0],
              zoom: 14,
            },
          }),
        );
      }
      selectMileageEventOnMap({
        eventId,
        lineKey: projected?.lineContext.lineKey,
        source: projected?.lineContext.source,
      });
    }, 150);
  };

  return (
    <DragProvider>
      <AppSEO routeState={routeState} />

      <div className="rl-shell flex flex-col h-[100dvh] font-sans text-slate-800 overflow-visible">
        <Toaster position="top-center" />
        <Header
          handleExportKML={handleExportKML}
          handleExportUserData={handleExportUserData}
          handleImportUserData={handleImportUserData}
          handleCompanyUpload={handleCompanyUpload}
          handleFileUpload={handleFileUpload}
        />

        <div className="flex-1 relative overflow-hidden flex flex-col">
          {/* Tab-driven page layer (records / stats) */}
          <div
            className={`flex-1 overflow-hidden flex flex-col ${routeState.tab !== "map" ? "block" : "hidden"}`}
          >
            {routeState.tab === "records" && <TripsPage />}
            {routeState.tab === "stats" && <StatsPage />}
          </div>

          {/* MapContainer 永不卸载，仅通过 CSS 控制显隐 */}
          <div
            className={`flex-1 relative ${routeState.tab === "map" ? "block" : "hidden"}`}
          >
            <MapContainer
              setStationMenu={setStationMenu}
              isDraggingRef={isDraggingRef}
              showDebugZoom={true}
            />
            <FabButton />
            <LocateButton />
            <MileageEventsPanel />
            <PinEditor />
          </div>
        </div>

        <TripEditor />
        <WalkTripEditor />

        {/* Global Modals & Components */}
        <LoginModal
          isOpen={isLoginOpen}
          onClose={() => setModalState({ isLoginOpen: false })}
          onLoginSuccess={(data: any) => {
            useStore.getState().login(data.token, data.username);
            loadUserData(data.token, true);
          }}
          user={user}
        />
        <GithubRegisterModal />
        <GithubCardModal />
        <FolderManagerModal />
        <FeedbackModal />
        <FeedbackAdminModal />
        <AddToFolderModal />
        <SubscribeModal />
        <ExportRouteModal />
        <GlobalSearchModal
          isOpen={isGlobalSearchOpen}
          onClose={() => setModalState({ isGlobalSearchOpen: false })}
          onSelect={handleGlobalSearchSelect}
          onSelectTrip={handleGlobalSearchTripSelect}
          onSelectEvent={handleGlobalSearchEventSelect}
        />

        <Tutorial
          activeTab={routeState.tab}
          setActiveTab={(tab: any) => goToTab(tab)}
          isTripEditing={isTripEditing}
          setIsTripEditing={(b: boolean) =>
            b
              ? useStore.getState().startEditingTrip()
              : useStore.getState().closeTripEditor()
          }
          isLoginOpen={isLoginOpen}
          setIsLoginOpen={(b: boolean) => setModalState({ isLoginOpen: b })}
          user={user}
          pinMode={pinMode}
          editorMode={editorMode}
        />

        {stationMenu && (
          <StationMenu
            position={stationMenu}
            stationData={stationMenu.stationData}
            railwayData={railwayData}
            onClose={() => setStationMenu(null)}
          />
        )}

        <Chest />
        <BottomNav />
      </div>
    </DragProvider>
  );
};
