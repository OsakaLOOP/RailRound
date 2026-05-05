// ============================================================
// Rail Graph v1 — Primitive Types
// ============================================================

/** 稳定实体引用。格式约定: "{source}:{entityType}:{stablePart}" */
export type EntityRef = string & { readonly __brand: "EntityRef" };

/** 用于未解析或外部输入的弱引用，不参与核心逻辑 */
export type RawRef = string;

/** ISO 8601 datetime string */
export type ISODateTime = string;

/** 运行方向标签。具体系统可在 ServicePattern.directionConvention 中给出显示名。 */
export type DirectionLabel = "up" | "down" | "clockwise" | "counterclockwise" | "unknown";

/** 0-1 edge measure。0 = fromNode, 1 = toNode。 */
export type EdgeMeasure = number;

export interface MeasureRange {
  startMeasure: EdgeMeasure;
  endMeasure: EdgeMeasure;
}
