import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { db } from '../utils/db';
import changelog from '../../public/changelog.json';
import type { TripResult, TripRuntimeArtifacts } from '../rail-graph-v1/user-facing.types';
import type { UserEventV2 } from '../rail-graph-v1/mileage-event.types';
import type { DeployedSystem } from '../rail-graph-v1/deployment.types';
import type { SystemContext } from '../rail-graph-v1/graph.types';

// --- Custom IndexedDB Storage for Zustand ---
// Because railwayData can easily exceed the 5MB localStorage limit,
// we must back Zustand's persist middleware with IndexedDB.
const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const dbInstance = await db.open();
      const tx = dbInstance.transaction(db.STORE_FILES, 'readonly');
      const store = tx.objectStore(db.STORE_FILES);
      return new Promise((resolve) => {
        const req = store.get(`zustand_${name}`);
        req.onsuccess = () => {
          resolve(req.result ? req.result.value : null);
        };
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      console.warn('IDB storage getItem failed:', e);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const dbInstance = await db.open();
      const tx = dbInstance.transaction(db.STORE_FILES, 'readwrite');
      const store = tx.objectStore(db.STORE_FILES);
      return new Promise((resolve, reject) => {
        const req = store.put({ fileName: `zustand_${name}`, value }, `zustand_${name}`);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('IDB storage setItem failed:', e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const dbInstance = await db.open();
      const tx = dbInstance.transaction(db.STORE_FILES, 'readwrite');
      const store = tx.objectStore(db.STORE_FILES);
      return new Promise((resolve, reject) => {
        const req = store.delete(`zustand_${name}`);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('IDB storage removeItem failed:', e);
    }
  },
};

// basic value
export type ID = string | number;
export type ISO8601Date = string;
export type URLString = string;
export type ColorHex = string;

export enum AppTheme { Light = 'light', Dark = 'dark' }
export enum PinMode { Idle = 'idle', Free = 'free', Snap = 'snap' }
export enum EditorMode { Manual = 'manual', Auto = 'auto' }

// railway value
export type LineKey = string;
export type StationId = string;
export type CompanyName = string;
export type CompanyCategory = 'JR' | 'CR' | 'Private' | 'City';

export interface CompanyMeta {
  company?: string;
  region: string;
  type: string;
  category?: CompanyCategory;
  logo: URLString | null;
  icon?: URLString | null;
  color?: string | null;
  recolor?: boolean; // 譏ｯ蜷ｦ蟇ｹline icon謖瑛ineColor荳願牡
}

export interface Station {
  id: StationId;
  name_ja: string;
  lat: number;
  lng: number;
  transfers: LineKey[];
  distToNext?: number;
  landmark?: boolean; // 邇ｯ郤ｿ蝨ｰ譬・ｫ・
}

export interface RailwayLineMeta extends CompanyMeta {
  company: string;
  icon?: URLString | null;
  companyIcon?: URLString | null; // 譏ｾ蠑丞ｼ慕畑 company 闌・紛逧・ｰ丞崟譬・
  isLoop?: boolean; // 邇ｯ迥ｶ郤ｿ霍ｯ譬・ｮｰ
  networkMeta?: any;
}

export interface RailwayLine {
  meta: RailwayLineMeta;
  stations: Station[];
}

export type RailwayMap = Record<LineKey, RailwayLine>;
export type CompanyDB = Record<CompanyName, CompanyMeta>;

// --- GeoJSON Customizations ---
export interface CustomGeoJSONProperties {
    type?: 'line' | 'station';
    name?: string;
    line?: string;
    company?: string;
    operator?: string;
    icon?: string;
    stroke?: string;
    transfers?: LineKey[];
    id?: string;
    [key: string]: any; // Allow fallback for totally custom properties
}

export interface CustomGeoJSONGeometry {
    type: 'Point' | 'LineString' | 'MultiLineString' | string;
    coordinates: any[];
}

export interface CustomGeoJSONFeature {
    type: 'Feature';
    properties: CustomGeoJSONProperties;
    geometry: CustomGeoJSONGeometry;
}

export interface CustomFeatureCollection {
    type: 'FeatureCollection';
    features: CustomGeoJSONFeature[];
}

// --- App data ---
export interface TripSegment {
    id: ID;
    lineKey: LineKey;
    fromId: StationId;
    toId: StationId;
    line?: string;
    destination?: string;
    direction?: 'up' | 'down';
    loopVia?: 'up' | 'down' | 'auto';
    isAlt?: boolean;
}


export interface Trip {
  id: ID;
  date: ISO8601Date;
  cost?: number;
  memo?: string;
  segments: TripSegment[];
  railGraph?: {
    tripResult: TripResult;
    runtimeArtifacts?: TripRuntimeArtifacts;
  };
  suicaData?: any;
  lineKey?: string;
  fromId?: string;
  toId?: string;
  isWalk?: boolean;
  walkPath?: [number, number][]; // [lat, lng] array for the Bezier curve
  walkType?: 'ufo' | 'tree' | 'normal';
}

export interface RailGraphRuntimeState {
  system: SystemContext;
  deployed: DeployedSystem;
  source: 'static_bundle' | 'manual' | 'test';
  loadedAt: string;
}

export interface RailGraphLoadState {
  status: 'idle' | 'loading' | 'loaded' | 'not_found' | 'invalid' | 'error';
  reason?: string;
  fallbackReason?: string;
  loadedAt?: string;
}

export type RailGraphSelectionSource = 'rail_graph_snapshot' | 'legacy_geojson';
export type RailGraphGeometrySource = 'saved_snapshot' | 'geojson' | 'fallback';

export interface RailGraphSelectionAnchor {
  lat?: number;
  lng?: number;
  tripRatio?: number;
}

export interface RailGraphSelectionBase {
  source: RailGraphSelectionSource;
  lineKey?: string | null;
  tripId?: ID;
  tripSegmentIndex?: number;
  routeItemId?: string;
  label?: string;
  color?: string;
  patternRef?: string;
  direction?: string;
  serviceType?: string;
  geometrySource?: RailGraphGeometrySource;
  anchor?: RailGraphSelectionAnchor;
  updatedAt: number;
}

export type RailGraphActiveSelection =
  | (RailGraphSelectionBase & {
      state: 'routeSelected';
      /** @deprecated Use state === 'routeSelected'. Kept while UI surfaces migrate. */
      kind: 'route';
    })
  | (RailGraphSelectionBase & {
      state: 'axisSelected';
      /** @deprecated Use state === 'axisSelected'. Kept while UI surfaces migrate. */
      kind: 'axis';
    })
  | (RailGraphSelectionBase & {
      state: 'eventSelected';
      /** @deprecated Use state === 'eventSelected'. Kept while UI surfaces migrate. */
      kind: 'event';
      eventId: string;
    })
  | (RailGraphSelectionBase & {
      state: 'creating';
      kind: 'route' | 'axis';
      createSource?: 'station' | 'map' | 'mileage' | 'trip';
    })
  | (RailGraphSelectionBase & {
      state: 'inspecting';
      kind: 'event' | 'route' | 'axis';
      eventId?: string;
    })
  | (Partial<RailGraphSelectionBase> & {
      state: 'unavailable';
      kind: 'axis';
      reason: string;
      updatedAt: number;
    });

export type RailGraphSelectionDraft = Omit<RailGraphActiveSelection, 'updatedAt'>;

export interface Pin {
  id: ID;
  lat: number;
  lng: number;
  type: 'photo' | 'comment';
  color: ColorHex;
  comment?: string;
  imageUrl?: string;
  isTemp?: boolean;
  lineKey?: string;
  percentage?: number;
}

export interface Folder {
  id: string;
  name: string;
  is_public: boolean;
  trip_ids: ID[];
  stats?: any;
  hash?: string | null;
}

export type TierLevel = 'free' | 'premium' | 'permanent';

export interface SubscriptionMonth {
  year: number;
  month: number;
  planName: string;
  amount: number;
  orderId: string;
  lastPayTime: string;
  status: 'active' | 'cancelled';
}

export interface SubscriptionHistory {
  username: string;
  totalMonths: number;
  months: SubscriptionMonth[];
  lastUpdated: string;
}

export interface UserProfile {
  token: string;
  username: string;
  tier?: TierLevel;
  tierVerified?: boolean;
  tierToken?: string;
  tierExpiresAt?: string;
  permanentUpgradedAt?: string;
  subscriptionMonths?: number;
  bindings?: {
    github?: { login: string; avatar_url: string; id: number; };
    afdian?: { user_id: string; bound_at: string; };
  };
  badge_settings?: { enabled: boolean; };
}

export interface BadgeSettings {
  enabled: boolean;
  /** @deprecated User language preference. The actual display language is derived from the URL via useAppRouteState().lang */
  language?: string;
  defaultMapCenter?: {
    mode: 'fixed' | 'latest';
    lat: number;
    lng: number;
  };
}

export interface StationMenuData {
    x: number;
    y: number;
    stationData: { name_ja: string; [key: string]: any };
}

export interface GlobalStore {
  // Data Slice
  railwayData: RailwayMap;
  railGraphRuntime: RailGraphRuntimeState | null;
  railGraphLoadState: RailGraphLoadState;
  companyDB: CompanyDB;
  geoData: CustomFeatureCollection;
  segmentGeometries: Map<string, any>;
  tripSegmentsGeometry: any[];
  visitedStations: Set<string>;
  setRailwayData: (updater: RailwayMap | ((prev: RailwayMap) => RailwayMap)) => void;
  setRailGraphRuntime: (runtime: RailGraphRuntimeState | null) => void;
  setRailGraphLoadState: (loadState: RailGraphLoadState) => void;
  clearRailGraphRuntime: () => void;
  setCompanyDB: (db: CompanyDB | ((prev: CompanyDB) => CompanyDB)) => void;
  setGeoData: (data: CustomFeatureCollection | ((prev: CustomFeatureCollection) => CustomFeatureCollection)) => void;
  setSegmentGeometries: (data: Map<string, any>) => void;
  setTripSegmentsGeometry: (data: any[]) => void;
  setVisitedStations: (stations: Set<string>) => void;

  // User Slice
  user: { token: string; username: string } | null;
  userProfile: UserProfile | null;
  isLoggedIn: boolean;
  trips: Trip[];
  pins: Pin[];
  mileageUserEvents: UserEventV2[];
  folders: Folder[];
  badgeSettings: BadgeSettings;
  appVersion: string;

  isHydrated: boolean;
  setHydrated: (hydrated: boolean) => void;

  login: (token: string, username: string) => void;
  logout: () => void;
  setUserProfile: (profile: UserProfile | null) => void;

  setTrips: (trips: Trip[] | ((prev: Trip[]) => Trip[])) => void;
  addTrip: (trip: Trip) => void;
  updateTrip: (trip: Trip) => void;
  removeTrip: (id: ID) => void;

  setPins: (pins: Pin[] | ((prev: Pin[]) => Pin[])) => void;
  addPin: (pin: Pin) => void;
  updatePin: (pin: Pin) => void;
  removePin: (id: ID) => void;
  setMileageUserEvents: (events: UserEventV2[] | ((prev: UserEventV2[]) => UserEventV2[])) => void;
  addMileageUserEvent: (event: UserEventV2) => void;
  removeMileageUserEvent: (id: string) => void;

  setFolders: (folders: Folder[] | ((prev: Folder[]) => Folder[])) => void;
  setBadgeSettings: (settings: BadgeSettings) => void;

  myFeedbackIds: string[];
  addMyFeedbackId: (id: string) => void;

  // UI Slice
  // @deprecated Use useAppRouteState().tab instead
  activeTab: 'records' | 'map' | 'stats';
  // @deprecated Navigation should use useAppNavigation() instead
  setActiveTab: (tab: 'records' | 'map' | 'stats') => void;

  isAprilFool: boolean;
  setIsAprilFool: (isAprilFool: boolean) => void;
  showFakeProgress: boolean;
  setShowFakeProgress: (show: boolean) => void;

  mapZoom: number;
  setMapZoom: (zoom: number) => void;
  leafletReady: boolean;
  setLeafletReady: (ready: boolean) => void;
  activeRailGraphSelection: RailGraphActiveSelection | null;
  setActiveRailGraphSelection: (selection: RailGraphSelectionDraft | null) => void;
  clearActiveRailGraphSelection: () => void;

  isTripEditing: boolean;
  editingTripId: ID | null;
  tripForm: Partial<Trip>;
  editorMode: 'manual' | 'auto';
  autoForm: { startLine: string; startStation: string; endLine: string; endStation: string; };
  isRouteSearching: boolean;
  autoRouteEasterEggType: 'ufo' | 'tree' | null;

  setTripForm: (form: Partial<Trip> | ((prev: Partial<Trip>) => Partial<Trip>)) => void;
  setAutoForm: (form: any | ((prev: any) => any)) => void;
  setEditorMode: (mode: 'manual' | 'auto') => void;
  setIsRouteSearching: (isSearching: boolean) => void;
  setAutoRouteEasterEggType: (type: 'ufo' | 'tree' | null) => void;
  startEditingTrip: (trip?: Partial<Trip> | null, mode?: 'manual' | 'auto', autoFormData?: any) => void;
  closeTripEditor: () => void;

  isWalkTripEditing: boolean;
  startEditingWalkTrip: (trip?: Partial<Trip>) => void;
  closeWalkTripEditor: () => void;

  pinMode: PinMode;
  editingPin: Pin | null;
  setPinMode: (mode: PinMode) => void;
  setEditingPin: (pin: Pin | null | ((prev: Pin | null) => Pin | null)) => void;

  modals: {
    isLoginOpen: boolean;
    isGithubRegOpen: boolean;
    cardModalUser: any | null;
    folderManagerOpen: boolean;
    feedbackModalOpen: boolean;
    feedbackAdminModalOpen: boolean;
    addToFolderModalOpen: boolean;
    currentTripForFolder: Trip | null;
    exportRouteModalOpen: boolean;
    currentTripForExport: Trip | null;
    githubRegToken: string | null;
    isSubscribeOpen: boolean;
    isGlobalSearchOpen: boolean;
  };
  setModalState: (updates: Partial<GlobalStore['modals']>) => void;
}

export const useStore = create<GlobalStore>()(
  persist(
    (set, get) => ({
      // --- Data Slice ---
      railwayData: {},
      railGraphRuntime: null,
      railGraphLoadState: { status: 'idle' },
      companyDB: {},
      geoData: { type: 'FeatureCollection', features: [] },
      segmentGeometries: new Map(),
      tripSegmentsGeometry: [],
      visitedStations: new Set<string>(),

      setRailwayData: (input) => set((state) => ({ railwayData: typeof input === 'function' ? input(state.railwayData) : input })),
      setRailGraphRuntime: (runtime) => set({
        railGraphRuntime: runtime,
        railGraphLoadState: runtime
          ? { status: 'loaded', loadedAt: runtime.loadedAt }
          : { status: 'idle' },
      }),
      setRailGraphLoadState: (loadState) => set({ railGraphLoadState: loadState }),
      clearRailGraphRuntime: () => set({ railGraphRuntime: null, railGraphLoadState: { status: 'idle' } }),
      setCompanyDB: (input) => set((state) => ({ companyDB: typeof input === 'function' ? input(state.companyDB) : input })),
      setGeoData: (input) => set((state) => ({ geoData: typeof input === 'function' ? input(state.geoData) : input })),
      setSegmentGeometries: (data) => set({ segmentGeometries: data }),
      setTripSegmentsGeometry: (data) => set({ tripSegmentsGeometry: data }),
      setVisitedStations: (stations) => set({ visitedStations: stations }),

      // --- User Slice ---
      user: null,
      userProfile: null,
      isLoggedIn: false,
      trips: [],
      pins: [],
      mileageUserEvents: [],
      folders: [],
      appVersion: changelog.meta.currentVersion || '0.0.0',
      badgeSettings: {
        enabled: true,
        language: (typeof localStorage !== 'undefined' && localStorage.getItem('i18nextLng')) || 'zh-CN',
        defaultMapCenter: { mode: 'fixed', lat: 35.6812, lng: 139.7671 }
      },
      isHydrated: false,
      setHydrated: (hydrated) => set({ isHydrated: hydrated }),

      login: (token, username) => set({ isLoggedIn: true, user: { token, username } }),
      logout: () => set({ isLoggedIn: false, user: null, userProfile: null }),
      setUserProfile: (profile) => set({ userProfile: profile }),

      setTrips: (input) => set((state) => ({ trips: typeof input === 'function' ? input(state.trips) : input })),
      addTrip: (trip) => set((state) => ({ trips: [trip, ...state.trips].sort((a,b) => b.date.localeCompare(a.date)) })),
      updateTrip: (trip) => set((state) => ({ trips: state.trips.map(t => t.id === trip.id ? trip : t).sort((a,b) => b.date.localeCompare(a.date)) })),
      removeTrip: (id) => set((state) => ({ trips: state.trips.filter(t => t.id !== id) })),

      setPins: (input) => set((state) => ({ pins: typeof input === 'function' ? input(state.pins) : input })),
      addPin: (pin) => set((state) => ({ pins: [...state.pins, pin] })),
      updatePin: (pin) => set((state) => ({ pins: state.pins.map(p => p.id === pin.id ? pin : p) })),
      removePin: (id) => set((state) => ({ pins: state.pins.filter(p => p.id !== id) })),
      setMileageUserEvents: (input) => set((state) => ({ mileageUserEvents: typeof input === 'function' ? input(state.mileageUserEvents) : input })),
      addMileageUserEvent: (event) => set((state) => ({ mileageUserEvents: [...state.mileageUserEvents, event] })),
      removeMileageUserEvent: (id) => set((state) => ({ mileageUserEvents: state.mileageUserEvents.filter(event => event.id !== id) })),

      setFolders: (input) => set((state) => ({ folders: typeof input === 'function' ? input(state.folders) : input })),
      setBadgeSettings: (settings) => set({ badgeSettings: settings }),

      myFeedbackIds: [],
      addMyFeedbackId: (id) => set((state) => {
        if (state.myFeedbackIds.includes(id)) return state;
        return { myFeedbackIds: [id, ...state.myFeedbackIds].slice(0, 200) };
      }),

      // --- UI Slice ---
      activeTab: 'records',
      setActiveTab: (tab) => set({ activeTab: tab }),

      isAprilFool: false,
      setIsAprilFool: (isAprilFool) => set({ isAprilFool }),
      showFakeProgress: false,
      setShowFakeProgress: (showFakeProgress) => set({ showFakeProgress }),

      mapZoom: 10,
      setMapZoom: (zoom) => set({ mapZoom: zoom }),
      leafletReady: false,
      setLeafletReady: (ready) => set({ leafletReady: ready }),
      activeRailGraphSelection: null,
      setActiveRailGraphSelection: (selection) => set({
        activeRailGraphSelection: selection ? { ...selection, updatedAt: Date.now() } as RailGraphActiveSelection : null,
      }),
      clearActiveRailGraphSelection: () => set({ activeRailGraphSelection: null }),

      isTripEditing: false,
      editingTripId: null,
      tripForm: { date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0 },
      editorMode: EditorMode.Manual,
      autoForm: { startLine: '', startStation: '', endLine: '', endStation: '' },
      isRouteSearching: false,

      setTripForm: (input) => set((state) => {
        const next = typeof input === 'function' ? input(state.tripForm) : input;
        return { tripForm: { ...state.tripForm, ...next } };
      }),
      setAutoForm: (input) => set((state) => {
        const next = typeof input === 'function' ? input(state.autoForm) : input;
        return { autoForm: { ...state.autoForm, ...next } };
      }),
      setEditorMode: (mode) => set({ editorMode: mode }),
      setIsRouteSearching: (isSearching) => set({ isRouteSearching: isSearching }),
      autoRouteEasterEggType: null,
      setAutoRouteEasterEggType: (type) => set({ autoRouteEasterEggType: type }),

      startEditingTrip: (trip, mode = EditorMode.Manual, autoFormData = null) => {
          let updates: any = { isTripEditing: true, editorMode: mode };
          
          if (trip) {
            const formState = trip.segments ? trip : { ...trip, segments: [{ id: 'legacy', lineKey: trip.lineKey, fromId: trip.fromId, toId: trip.toId }] };
            updates.editingTripId = trip.id;
            updates.tripForm = JSON.parse(JSON.stringify(formState));
          } else {
            updates.editingTripId = null;
            updates.tripForm = { date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0 };
          }

          if (autoFormData) {
              updates.autoForm = { ...get().autoForm, ...autoFormData };
          }
          
          set(updates);
      },
      closeTripEditor: () => set({ isTripEditing: false, editingTripId: null, autoRouteEasterEggType: null, editorMode: EditorMode.Manual, tripForm: { date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0 } }),

      isWalkTripEditing: false,
      startEditingWalkTrip: (trip) => {
        if (trip) {
          set({ isWalkTripEditing: true, editingTripId: trip.id, tripForm: JSON.parse(JSON.stringify(trip)) });
        } else {
          set({ isWalkTripEditing: true, editingTripId: null, tripForm: { date: new Date().toISOString().split('T')[0], memo: '', cost: 0, isWalk: true, segments: [] } });
        }
      },
      closeWalkTripEditor: () => set({ isWalkTripEditing: false, editingTripId: null, tripForm: { date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0 } }),

      pinMode: PinMode.Idle,
      editingPin: null,
      setPinMode: (mode) => set({ pinMode: mode }),
      setEditingPin: (input) => set((state) => {
        const next = typeof input === 'function' ? input(state.editingPin) : input;
        // If next is null, we shouldn't spread it.
        if (next === null) return { editingPin: null };
        return { editingPin: state.editingPin ? { ...state.editingPin, ...next } : next };
      }),

      modals: {
        isLoginOpen: false,
        isGithubRegOpen: false,
        cardModalUser: null,
        folderManagerOpen: false,
        feedbackModalOpen: false,
        feedbackAdminModalOpen: false,
        addToFolderModalOpen: false,
        currentTripForFolder: null,
        exportRouteModalOpen: false,
        currentTripForExport: null,
        githubRegToken: null,
        isSubscribeOpen: false,
        isGlobalSearchOpen: false,
      },
      setModalState: (updates) => set((state) => ({ modals: { ...state.modals, ...updates } })),
    }),
    {
      name: 'railround-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        user: state.user,
        isLoggedIn: state.isLoggedIn,
        trips: state.trips,
        pins: state.pins,
        mileageUserEvents: state.mileageUserEvents,
        folders: state.folders,
        badgeSettings: state.badgeSettings,
        myFeedbackIds: state.myFeedbackIds,
      }),
      onRehydrateStorage: (state) => {
        return () => {
          state.setHydrated(true);
        };
      },
    }
  )
);
