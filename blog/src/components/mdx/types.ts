export interface StationData {
  id: string;
  name_ja: string;
  name_en?: string;
  lat: number;
  lng: number;
}

export type RouteSliceMode = "auto" | "manual";

export interface RouteSlicePathSegment {
  lineKey: string;
  fromId: string;
  toId: string;
  loopVia?: "up" | "down";
  fromName?: string;
  toName?: string;
}

export interface RouteSliceMeta {
  icon?: string | null;
  logo?: string | null;
  companyIcon?: string | null;
  recolor?: boolean;
  color?: string | null;
  lineKey: string;
  lineName: string;
}

export interface RouteSlicePathData {
  stations: StationData[];
  routeCoords: [number, number][];
  color: string | null;
  meta: RouteSliceMeta | null;
}

export interface RouteSliceData {
  stations: StationData[];
  routeCoords: [number, number][];
  distance: string;
  time: string;
  color: string | null;
  meta: RouteSliceMeta | null;
  paths?: RouteSlicePathData[];
  routeMode?: RouteSliceMode;
  pathSegments?: RouteSlicePathSegment[];
}
