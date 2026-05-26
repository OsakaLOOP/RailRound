export interface ParamFieldSchema {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "string[]";
  description?: string;
  defaultValue: any;
}

export interface RuleParamSchema {
  handlerType: string;
  fields: ParamFieldSchema[];
}

/* 仅对规则参数白名单定义模块添加简短中英注释 / Whitelist schema for rule parameter inline editors. */
export const RULE_PARAM_SCHEMAS: Record<string, RuleParamSchema> = {
  platform_direction_match: {
    handlerType: "platform_direction_match",
    fields: [
      {
        key: "target_line_field",
        label: "Target Line Field",
        type: "string",
        defaultValue: "source_line_name",
        description: "Feature property containing line name"
      },
      {
        key: "target_line_match_fields",
        label: "Target Line Match Fields",
        type: "string[]",
        defaultValue: ["name", "name:ja", "name:en", "KSJ2:LIN"],
        description: "Feature properties to match against target line name"
      },
      {
        key: "require_same_nearest_station",
        label: "Require Same Station",
        type: "boolean",
        defaultValue: false,
        description: "Force platform and track nearest_station to match"
      },
      {
        key: "remove_if_target_line_angle_mismatch",
        label: "Remove Target Line Angle Mismatch",
        type: "boolean",
        defaultValue: true,
        description: "Remove platform if target line angle mismatches"
      },
      {
        key: "max_angle_diff_deg",
        label: "Max Angle Diff (deg)",
        type: "number",
        defaultValue: 25,
        description: "Maximum allowable angle difference in degrees"
      },
      {
        key: "min_platform_confidence",
        label: "Min Platform Confidence",
        type: "number",
        defaultValue: 0.55,
        description: "Minimum platform direction calculation confidence"
      },
      {
        key: "min_platform_long_edge_m",
        label: "Min Platform Long Edge (m)",
        type: "number",
        defaultValue: 8,
        description: "Minimum length in meters of the platform long edge"
      },
      {
        key: "max_distance_m",
        label: "Max Distance (m)",
        type: "number",
        defaultValue: 80,
        description: "Maximum search distance from platform to track"
      },
      {
        key: "same_station_bonus_m",
        label: "Same Station Bonus (m)",
        type: "number",
        defaultValue: 40,
        description: "Extra search distance bonus if nearest_station matches"
      },
      {
        key: "min_track_confidence",
        label: "Min Track Confidence",
        type: "number",
        defaultValue: 0.25,
        description: "Minimum confidence required to trust track direction"
      },
      {
        key: "remove_if_no_target_line_track",
        label: "Remove If No Target Line Track",
        type: "boolean",
        defaultValue: false,
        description: "Remove if no track of the target line is nearby"
      },
      {
        key: "remove_if_nearest_track_station_mismatch",
        label: "Remove Nearest Station Mismatch",
        type: "boolean",
        defaultValue: false,
        description: "Remove platform if closest track belongs to a different station"
      },
      {
        key: "nearest_station_mismatch_max_distance_m",
        label: "Nearest Mismatch Max Dist (m)",
        type: "number",
        defaultValue: 25,
        description: "Max distance to check for station mismatch"
      },
      {
        key: "nearest_station_mismatch_margin_m",
        label: "Nearest Mismatch Margin (m)",
        type: "number",
        defaultValue: 20,
        description: "Safety margin when comparing closest mismatched track to same station track"
      },
      {
        key: "remove_if_no_nearby_track",
        label: "Remove If No Nearby Track",
        type: "boolean",
        defaultValue: false,
        description: "Remove platform if no railway track is within reach"
      },
      {
        key: "remove_if_station_mismatch",
        label: "Remove If Station Mismatch",
        type: "boolean",
        defaultValue: false,
        description: "Remove platform if station mismatches all candidate tracks"
      }
    ]
  },
  dynamic_match: {
    handlerType: "dynamic_match",
    fields: [
      {
        key: "against_field",
        label: "Against Field",
        type: "string",
        defaultValue: "source_line_name",
        description: "Field containing line name to match against"
      },
      {
        key: "match_fields",
        label: "Match Fields",
        type: "string[]",
        defaultValue: [],
        description: "Properties to search within"
      }
    ]
  },
  isolated_or_blank: {
    handlerType: "isolated_or_blank",
    fields: [
      {
        key: "max_length_m",
        label: "Max Length (m)",
        type: "number",
        defaultValue: 200,
        description: "Remove components shorter than this length"
      },
      {
        key: "require_unnamed",
        label: "Require Unnamed",
        type: "boolean",
        defaultValue: false,
        description: "Only target features with no name properties"
      },
      {
        key: "endpoint_threshold",
        label: "Endpoint Distance Threshold",
        type: "number",
        defaultValue: 0.0001,
        description: "Coordinate distance threshold to define connectivity"
      }
    ]
  },
  orphan_railway_node: {
    handlerType: "orphan_railway_node",
    fields: [
      {
        key: "railway_values",
        label: "Railway Node Values",
        type: "string[]",
        defaultValue: ["switch", "level_crossing", "stop"],
        description: "OSM railway node types to target"
      },
      {
        key: "tolerance_m",
        label: "Distance Tolerance (m)",
        type: "number",
        defaultValue: 3,
        description: "Max distance from node to nearest valid track"
      }
    ]
  },
  single_connection_switch: {
    handlerType: "single_connection_switch",
    fields: [
      {
        key: "tolerance_m",
        label: "Connection Tolerance (m)",
        type: "number",
        defaultValue: 0.5,
        description: "Max distance from switch point to track"
      },
      {
        key: "min_connections",
        label: "Min Connections Required",
        type: "number",
        defaultValue: 2,
        description: "Minimum number of connected tracks required"
      }
    ]
  },
  short_connected_line_component: {
    handlerType: "short_connected_line_component",
    fields: [
      {
        key: "min_component_length_m",
        label: "Min Component Length (m)",
        type: "number",
        defaultValue: 80,
        description: "Remove connected components shorter than this total length"
      },
      {
        key: "endpoint_precision",
        label: "Endpoint Decimal Precision",
        type: "number",
        defaultValue: 6,
        description: "Precision for grouping endpoints together"
      },
      {
        key: "snap_tolerance_m",
        label: "Snap Tolerance (m)",
        type: "number",
        defaultValue: 0.5,
        description: "Distance snap tolerance for linking disconnected ends"
      }
    ]
  }
};
