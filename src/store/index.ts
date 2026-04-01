import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { db } from '../utils/db';

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
  region: string;
  type: string;
  category?: CompanyCategory;
  logo: URLString | null;
}

export interface Station {
  id: StationId;
  name_ja: string;
  lat: number;
  lng: number;
  transfers: LineKey[];
  distToNext?: number;
}

export interface RailwayLineMeta extends CompanyMeta {
  company: string;
  icon?: URLString | null;
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
}

export interface Trip {
  id: ID;
  date: ISO8601Date;
  cost?: number;
  memo?: string;
  segments: TripSegment[];
  suicaData?: any;
  lineKey?: string;
  fromId?: string;
  toId?: string;
}

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

export interface UserProfile {
  token: string;
  username: string;
  bindings?: {
    github?: { login: string; avatar_url: string; id: number; };
  };
  badge_settings?: { enabled: boolean; };
}

export interface BadgeSettings {
  enabled: boolean;
}

export interface StationMenuData {
    x: number;
    y: number;
    stationData: { name_ja: string; [key: string]: any };
}

export interface GlobalStore {
  // Data Slice
  railwayData: RailwayMap;
  companyDB: CompanyDB;
  geoData: CustomFeatureCollection;
  segmentGeometries: Map<string, any>;
  tripSegmentsGeometry: any[];
  visitedStations: Set<string>;
  setRailwayData: (updater: RailwayMap | ((prev: RailwayMap) => RailwayMap)) => void;
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
  folders: Folder[];
  badgeSettings: BadgeSettings;

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

  setFolders: (folders: Folder[] | ((prev: Folder[]) => Folder[])) => void;
  setBadgeSettings: (settings: BadgeSettings) => void;

  // UI Slice
  activeTab: 'records' | 'map' | 'stats';
  setActiveTab: (tab: 'records' | 'map' | 'stats') => void;

  mapZoom: number;
  setMapZoom: (zoom: number) => void;
  leafletReady: boolean;
  setLeafletReady: (ready: boolean) => void;

  isTripEditing: boolean;
  editingTripId: ID | null;
  tripForm: Partial<Trip>;
  editorMode: 'manual' | 'auto';
  autoForm: { startLine: string; startStation: string; endLine: string; endStation: string; };
  isRouteSearching: boolean;

  setTripForm: (form: Partial<Trip> | ((prev: Partial<Trip>) => Partial<Trip>)) => void;
  setAutoForm: (form: any | ((prev: any) => any)) => void;
  setEditorMode: (mode: 'manual' | 'auto') => void;
  setIsRouteSearching: (isSearching: boolean) => void;
  startEditingTrip: (trip?: Partial<Trip>) => void;
  closeTripEditor: () => void;

  pinMode: PinMode;
  editingPin: Pin | null;
  setPinMode: (mode: PinMode) => void;
  setEditingPin: (pin: Pin | null | ((prev: Pin | null) => Pin | null)) => void;

  modals: {
    isLoginOpen: boolean;
    isGithubRegOpen: boolean;
    cardModalUser: any | null;
    folderManagerOpen: boolean;
    addToFolderModalOpen: boolean;
    currentTripForFolder: Trip | null;
    githubRegToken: string | null;
  };
  setModalState: (updates: Partial<GlobalStore['modals']>) => void;
}

export const useStore = create<GlobalStore>()(
  persist(
    (set, get) => ({
      // --- Data Slice ---
      railwayData: {},
      companyDB: {},
      geoData: { type: 'FeatureCollection', features: [] },
      segmentGeometries: new Map(),
      tripSegmentsGeometry: [],
      visitedStations: new Set<string>(),

      setRailwayData: (input) => set((state) => ({ railwayData: typeof input === 'function' ? input(state.railwayData) : input })),
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
      folders: [],
      badgeSettings: { enabled: true },

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

      setFolders: (input) => set((state) => ({ folders: typeof input === 'function' ? input(state.folders) : input })),
      setBadgeSettings: (settings) => set({ badgeSettings: settings }),

      // --- UI Slice ---
      activeTab: 'records',
      setActiveTab: (tab) => set({ activeTab: tab }),

      mapZoom: 10,
      setMapZoom: (zoom) => set({ mapZoom: zoom }),
      leafletReady: false,
      setLeafletReady: (ready) => set({ leafletReady: ready }),

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

      startEditingTrip: (trip) => {
          if (trip) {
            const formState = trip.segments ? trip : { ...trip, segments: [{ id: 'legacy', lineKey: trip.lineKey, fromId: trip.fromId, toId: trip.toId }] };
            set({ isTripEditing: true, editingTripId: trip.id, tripForm: JSON.parse(JSON.stringify(formState)) });
          } else {
            set({ isTripEditing: true, editingTripId: null, tripForm: { date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0 } });
          }
      },
      closeTripEditor: () => set({ isTripEditing: false, editingTripId: null, tripForm: { date: new Date().toISOString().split('T')[0], memo: '', segments: [], cost: 0 } }),

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
        addToFolderModalOpen: false,
        currentTripForFolder: null,
        githubRegToken: null,
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
        folders: state.folders,
        badgeSettings: state.badgeSettings
      }),
    }
  )
);
