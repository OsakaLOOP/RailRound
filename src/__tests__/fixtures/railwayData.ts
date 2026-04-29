import type { RailwayMap, RailwayLine, Station } from "../../store";

// Minimal test fixture: 2 companies, 3 lines forming a simple network
// JR-East: Yamanote (loop line) with 3 stations
// Tokyo Metro: Marunouchi line with 2 stations (shares "Tokyo" station)

const stationTokyo: Station = {
  id: "JR-East:Yamanote:Tokyo",
  name_ja: "東京",
  lat: 35.6812,
  lng: 139.7671,
  transfers: ["TokyoMetro:丸ノ内線"],
  distToNext: 2.0,
};

const stationUeno: Station = {
  id: "JR-East:Yamanote:Ueno",
  name_ja: "上野",
  lat: 35.7138,
  lng: 139.7771,
  transfers: [],
  distToNext: 1.5,
};

const stationShinjuku: Station = {
  id: "JR-East:Yamanote:Shinjuku",
  name_ja: "新宿",
  lat: 35.6896,
  lng: 139.7006,
  transfers: [],
  landmark: true,
};

const stationTokyoMetro: Station = {
  id: "TokyoMetro:丸ノ内線:Tokyo",
  name_ja: "東京",
  lat: 35.6812,
  lng: 139.7671,
  transfers: ["JR-East:Yamanote"],
  distToNext: 1.8,
};

const stationOtemachi: Station = {
  id: "TokyoMetro:丸ノ内線:Otemachi",
  name_ja: "大手町",
  lat: 35.6850,
  lng: 139.7650,
  transfers: [],
};

export const YAMANOTE_LINE: RailwayLine = {
  meta: {
    company: "JR-East",
    region: "関東",
    type: "JR",
    category: "JR",
    logo: null,
    isLoop: true,
  },
  stations: [stationTokyo, stationUeno, stationShinjuku],
};

export const MARUNOUCHI_LINE: RailwayLine = {
  meta: {
    company: "TokyoMetro",
    region: "関東",
    type: "地下鉄",
    category: "Private",
    logo: null,
  },
  stations: [stationTokyoMetro, stationOtemachi],
};

export const TEST_RAILWAY_MAP: RailwayMap = {
  "JR-East:Yamanote": YAMANOTE_LINE,
  "TokyoMetro:丸ノ内線": MARUNOUCHI_LINE,
};

// GeoJSON-like features array for parser tests
export const TEST_GEOJSON_CHUNKS = [
  {
    json: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            type: "line",
            name: "Yamanote",
            company: "JR-East",
            stroke: "#80C241",
            isLoop: true,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [139.7671, 35.6812],
              [139.7771, 35.7138],
              [139.7006, 35.6896],
            ],
          },
        },
        {
          type: "Feature",
          properties: {
            type: "station",
            name: "東京",
            line: "Yamanote",
            company: "JR-East",
            id: "JR-East:Yamanote:Tokyo",
            transfers: ["TokyoMetro:丸ノ内線"],
          },
          geometry: { type: "Point", coordinates: [139.7671, 35.6812] },
        },
        {
          type: "Feature",
          properties: {
            type: "station",
            name: "上野",
            line: "Yamanote",
            company: "JR-East",
            id: "JR-East:Yamanote:Ueno",
          },
          geometry: { type: "Point", coordinates: [139.7771, 35.7138] },
        },
        {
          type: "Feature",
          properties: {
            type: "station",
            name: "新宿",
            line: "Yamanote",
            company: "JR-East",
            id: "JR-East:Yamanote:Shinjuku",
            landmark: true,
          },
          geometry: { type: "Point", coordinates: [139.7006, 35.6896] },
        },
      ],
    },
    company: "JR-East",
  },
  {
    json: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            type: "line",
            name: "丸ノ内線",
            company: "TokyoMetro",
            stroke: "#E60012",
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [139.7671, 35.6812],
              [139.765, 35.685],
            ],
          },
        },
        {
          type: "Feature",
          properties: {
            type: "station",
            name: "東京",
            line: "丸ノ内線",
            company: "TokyoMetro",
            id: "TokyoMetro:丸ノ内線:Tokyo",
            transfers: ["JR-East:Yamanote"],
          },
          geometry: { type: "Point", coordinates: [139.7671, 35.6812] },
        },
        {
          type: "Feature",
          properties: {
            type: "station",
            name: "大手町",
            line: "丸ノ内線",
            company: "TokyoMetro",
            id: "TokyoMetro:丸ノ内線:Otemachi",
          },
          geometry: { type: "Point", coordinates: [139.765, 35.685] },
        },
      ],
    },
    company: "TokyoMetro",
  },
];

export const TEST_COMPANY_DATA = {
  "JR-East": {
    company: "JR-East",
    region: "関東",
    type: "JR",
    category: "JR",
    logo: null,
  },
  TokyoMetro: {
    company: "TokyoMetro",
    region: "関東",
    type: "地下鉄",
    category: "Private",
    logo: null,
  },
};
