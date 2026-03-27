import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// basic value
export type ID = string | number;
export type ISO8601Date = string;
export type URLString = string;
export type ColorHex = string;

// geo value
export interface LatLng {
  lat: number;
  lng: number;
}

// mode enum
export enum AppTheme {
  Light = 'light',
  Dark = 'dark',
}

export enum PinType {
  Photo = 'photo',
  Comment = 'comment',
}

export enum PinMode {
  Idle = 'idle',
  Free = 'free', // 自由拖拽
  Snap = 'snap', // 吸附到线路
}

export enum EditorMode {
  Manual = 'manual',
  Auto = 'auto',
}

// railway value
export type LineKey = string;   // e.g., "JR東日本:山手線"
export type StationId = string; // e.g., "JR東日本:山手線:東京"
export type CompanyName = string;
type CompanyCategory = 'JR' | 'CR' | 'Private' | 'City'

// railway meta struc
export interface CompanyMeta {
  region: '北海道' | '東北' | '九州' | '沖縄' | '近畿' | '中部' | '中国地方' | '四国' | '九州・沖縄' | '関東' | '中国大陆' | '未知'; // e.g., "関東"
  type: 'JR' | '私鉄' | '第三セクター' | '地下鉄' | '新交通' | 'その他' | '未知';
  category?: CompanyCategory,
  logo: URLString | null;
}

export interface Station {
  id: StationId;
  name_ja: string;
  lat: number;
  lng: number;
  transfers: LineKey[]; // 可换乘线路列表
}

export interface RailwayLineMeta extends CompanyMeta {
  icon?: URLString | null; // 线路特定图标
}

export interface RailwayLine {
  meta: RailwayLineMeta;
  stations: Station[];
}

export type RailwayMap = Record<LineKey, RailwayLine>;
export type CompanyDB = Record<CompanyName, CompanyMeta>;

// App data
type SuicaData = {
    no: number,
    rawdate: string,
    paid: number,
    charge: number,
    total?: number, // +/-
    balance: number,
    
    rawprocess: string,
    rawinfo: string,
    
    type?: 'charge' | 'payment' | 'ticket',
    fromID?: StationId
    toID?: StationId
}

type TripSegment = {
    id: ID,
    lineKey: LineKey,
    fromID: StationId,
    toID: StationId
}

export interface Trip {
  id: ID;
  date: ISO8601Date;
  cost: number;
  memo: string;
  segments: TripSegment[];
  suicaData: SuicaData; 
}
type segments = [{seg: TripSegment, segIndex:}]
interface tripForm {
    segments:TripSegment[],
    date: string,
    memo: string,
    cost: number,
    suicaBalance: number | null
}
interface TripEditorState {
    isOpen: boolean,
    allowHotkey: boolean,
    
    editorMode: 'manual' | 'auto',
    isRouteSearching: boolean 
}

interface ModalState {
    TripEditorState
}


export interface VersionInfo {
  currentVer: string;
  lastModified?: string;
  lastUpdated?: string;
  minVer: string;
  rawLogs?: any;
  isSupported: boolean;
}

export interface UserProfile {
  token: string;
  username: string;
  bindings?: {
    github?: {
      login: string;
      avatar_url: string;
      id: number;
    };
    // 预留其他绑定
    google?: any;
  };
  badge_settings?: {
    enabled: boolean;
  };
}

export const useStore = create<GlobalStore>()(
  persist(
    (set, get) => ({
      // --- Data Slice Initial State ---
      railwayData: {},
      companyDB: {},
      geoData: { type: 'FeatureCollection', features: [] },
      setRailwayData: (input) => set((state) => ({
        railwayData: typeof input === 'function' ? input(state.railwayData) : input
      })),
      setCompanyDB: (db) => set({ companyDB: db }),
      loadGeoData: (newFeatures) => set((state) => ({
        geoData: {
          ...state.geoData!,
          features: [...(state.geoData?.features || []), ...newFeatures]
        }
      })),

      // --- User Slice Initial State ---
      user: null,
      isLoggedIn: false,
      trips: [],
      pins: [],
      folders: [],
      login: (token, username) => set({ 
        isLoggedIn: true, 
        user: { token, username } 
      }),
      logout: () => set({ 
        isLoggedIn: false, 
        user: null, 
        trips: [], // 可选：登出是否清空本地数据
        pins: [] 
      }),
      setUserProfile: (profile) => set({ user: profile }),
      
      addTrip: (trip) => set((state) => ({ trips: [trip, ...state.trips] })),
      updateTrip: (trip) => set((state) => ({ 
        trips: state.trips.map(t => t.id === trip.id ? trip : t) 
      })),
      removeTrip: (id) => set((state) => ({ 
        trips: state.trips.filter(t => t.id !== id) 
      })),
      setTrips: (trips) => set({ trips }),

      addPin: (pin) => set((state) => ({ pins: [...state.pins, pin] })),
      updatePin: (pin) => set((state) => ({ 
        pins: state.pins.map(p => p.id === pin.id ? pin : p) 
      })),
      removePin: (id) => set((state) => ({ 
        pins: state.pins.filter(p => p.id !== id) 
      })),
      setPins: (pins) => set({ pins }),
      updateFolders: (folders) => set({ folders }),

      // --- UI Slice Initial State ---
      activeTab: 'records',
      setActiveTab: (tab) => set({ activeTab: tab }),
      themeMode: AppTheme.Light,
      locale: 'zh-CN',
      mapZoom: 10,
      setMapZoom: (zoom) => set({ mapZoom: zoom }),
      
      isTripEditing: false,
      editingTripId: null,
      tripForm: {},
      
      pinMode: PinMode.Idle,
      editingPin: null,
      
      modals: {
        isLoginOpen: false,
        isGithubRegOpen: false,
        isCardOpen: false,
        isFolderManagerOpen: false,
        isAddToFolderOpen: false,
        isLineSelectorOpen: false,
      },
      
      setModalOpen: (name, isOpen) => set((state) => ({
        modals: { ...state.modals, [name]: isOpen }
      })),
      
      startEditingTrip: (trip) => set({ 
        isTripEditing: true, 
        editingTripId: trip?.id || null,
        tripForm: trip || { segments: [] } // Reset form
      }),
      closeTripEditor: () => set({ 
        isTripEditing: false, 
        editingTripId: null, 
        tripForm: {} 
      }),
      
      setPinMode: (mode) => set({ pinMode: mode }),
      setEditingPin: (pin) => set({ editingPin: pin }),

      // --- System Slice Initial State ---
      versionInfo: {
        currentVer: '0.0.0',
        minVer: '0.0.0',
        isSupported: true
      },
      hasUpdate: false,
      checkUpdate: async () => {
        // Implement fetch logic here
      },
      setVersionInfo: (info) => set({ versionInfo: info }),
    }),
    {
      name: 'railround-storage', // localStorage key
      partialize: (state) => ({ 
        // 仅持久化这些字段
        user: state.user,
        isLoggedIn: state.isLoggedIn,
        trips: state.trips,
        pins: state.pins,
        folders: state.folders,
        themeMode: state.themeMode,
        railwayData: state.railwayData, // 可选：视数据量而定，是否缓存庞大的铁路数据
        companyDB: state.companyDB
      }),
    }
  )
);