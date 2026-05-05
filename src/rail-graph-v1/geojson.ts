// ============================================================
// Rail Graph v1 — Lightweight GeoJSON Types
// ============================================================

export type GeoJSONPosition = [number, number];  // [lng, lat]

export interface GeoJSONLineString {
  type: "LineString";
  coordinates: GeoJSONPosition[];
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: GeoJSONPosition[][];
}

export interface GeoJSONFeature<TGeometry, TProperties = Record<string, unknown>> {
  type: "Feature";
  geometry: TGeometry;
  properties: TProperties;
}
