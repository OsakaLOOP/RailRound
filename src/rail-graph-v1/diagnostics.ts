// ============================================================
// Rail Graph v1 — Unified Diagnostic Model
// ============================================================

import type { Diagnostic, DiagnosticLevel } from "./diagnostic-types";

// ── 诊断创建 ────────────────────────────────────────────────

/**
 * 创建一条诊断记录。
 * 所有模块统一使用此函数，保证诊断格式一致。
 */
export declare function createDiagnostic(
  level: DiagnosticLevel,
  code: string,
  message: string,
  context?: Record<string, unknown>,
): Diagnostic;

// ── 诊断聚合 ────────────────────────────────────────────────

/**
 * 合并多组诊断，保持原始顺序。
 * 各组可为 undefined（尚未执行到的阶段）。
 */
export declare function collectDiagnostics(
  ...groups: (Diagnostic[] | undefined)[]
): Diagnostic[];

// ── 严重度判断 ──────────────────────────────────────────────

/** 存在 fatal 时阻断当前流程（不继续后续阶段） */
export declare function hasFatalDiagnostics(list: Diagnostic[]): boolean;

/** 诊断按 level 分组，供调试面板使用 */
export declare function groupByLevel(
  list: Diagnostic[],
): Record<DiagnosticLevel, Diagnostic[]>;

/** 诊断按 stage 分组，供阶段审阅 */
export declare function groupByStage(
  list: Diagnostic[],
): Record<string, Diagnostic[]>;

// ── 诊断码规范（建议） ──────────────────────────────────────
//
// 格式: {STAGE}_{ISSUE}
//   NORM_MISSING_FIELD      标准化阶段缺字段
//   NORM_INVALID_GEOMETRY   非法几何类型
//   NORM_UNKNOWN_KIND       无法识别的 GeoJSON kind
//   BUILD_DISCONNECTED      图构建发现孤立分量
//   BUILD_POINT_ATTACH_FAIL 点吸附失败（超过阈值距离）
//   BUILD_MISSING_REF       实体引用缺失
//   ENRICH_INFERRED         字段自动推断（info 级别）
//   PATH_NO_ROUTE           无可行路径
//   PATH_DIRECTION_CONFLICT 方向冲突，已降级
//   TIME_CONFLICT           时刻表锚点冲突
//   EVENT_UNRESOLVED        事件锚点无法解析
//
// OPEN: 是否需要严格枚举诊断码？还是保持开放字符串方便迭代？
//       当前设计倾向开放字符串 + 文档维护列表。
