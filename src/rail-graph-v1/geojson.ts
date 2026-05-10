// ============================================================
// Rail Graph v1 — Lightweight GeoJSON Types
// ============================================================

export type GeoJSONPosition = [number, number];  // [lng, lat]

export interface GeoJSONPoint {
  type: "Point";
  coordinates: GeoJSONPosition;
}

export interface GeoJSONLineString {
  type: "LineString";
  coordinates: GeoJSONPosition[];
}

export interface GeoJSONMultiLineString {
  type: "MultiLineString";
  coordinates: GeoJSONPosition[][];
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: GeoJSONPosition[][];
}

export interface GeoJSONMultiPolygon {
  type: "MultiPolygon";
  coordinates: GeoJSONPosition[][][];
}

export type GeoJSONGeometry =
  | GeoJSONPoint
  | GeoJSONLineString
  | GeoJSONMultiLineString
  | GeoJSONPolygon
  | GeoJSONMultiPolygon;

export interface GeoJSONFeature<TGeometry = GeoJSONGeometry, TProperties = Record<string, unknown>> {
  type: "Feature";
  geometry: TGeometry;
  properties: TProperties;
}

export interface GeoJSONFeatureCollection<TGeometry = GeoJSONGeometry, TProperties = Record<string, unknown>> {
  type: "FeatureCollection";
  features: GeoJSONFeature<TGeometry, TProperties>[];
}
