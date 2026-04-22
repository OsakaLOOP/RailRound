export type LineKey = string;
export type StationId = string;
export type CompanyName = string;
export type CompanyCategory = 'JR' | 'CR' | 'Private' | 'City';

export interface CompanyMeta {
  company?: string;
  region: string;
  type: string;
  category?: CompanyCategory;
  logo: string | null;
  icon?: string | null;
  color?: string | null;
  recolor?: boolean;
}

export interface Station {
  id: StationId;
  name_ja: string;
  lat: number;
  lng: number;
  transfers: LineKey[];
  distToNext?: number;
  landmark?: boolean;
}

export interface RailwayLineMeta extends CompanyMeta {
  company: string;
  isLoop?: boolean;
}

export interface RailwayLine {
  meta: RailwayLineMeta;
  stations: Station[];
}

export type RailwayMap = Record<LineKey, RailwayLine>;
export type CompanyDB = Record<CompanyName, CompanyMeta>;

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
    [key: string]: any;
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
