// ============================================================
// Rail Graph v1 — Type Barrel
//
// 这里仅做统一 re-export。实现文件优先从具体 *.types.ts 分层导入；
// 外部调用方可继续从 "./types" 获取完整公共类型集合。
// ============================================================

export type * from "./primitives";
export type * from "./geojson";
export type * from "./diagnostic-types";
export type * from "./annotation.types";
export type * from "./base-topology.types";
export type * from "./service-template.types";
export type * from "./editing.types";
export type * from "./event.types";
export type * from "./mileage-event.types";
export type * from "./runtime.types";
export type * from "./graph.types";
export type * from "./user-facing.types";
export type * from "./deployment.types";
export type * from "./community.types";
export type * from "./source.types";
export type * from "./snapshot.types";
export type * from "./service-template-validation";

export {
  assertServicePatternValidForTopology,
  hasBlockingServicePatternDiagnostics,
  validateServicePatternAgainstTopology,
  validateServicePatternShape,
} from "./service-template-validation";
export { canonicalJson, fingerprint, sha256Hex } from "./fingerprint";
export {
  buildRailGraph,
  buildRailGraphFingerprints,
  buildRailGraphIndexes,
  buildSystemContext,
  toGraphIdInput,
} from "./graph-builder";
