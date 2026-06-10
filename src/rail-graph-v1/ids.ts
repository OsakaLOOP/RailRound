// ============================================================
// Rail Graph v1 — Stable ID Generation & Validation
// ============================================================

import type { EntityRef } from "./primitives";

// ── ID 格式 ─────────────────────────────────────────────────

/** ID 格式: "{source}:{entityType}:{stablePart}" */
export const ID_SEPARATOR = ":";

export interface StableIdInput {
  source: string;          // "orm" | "openrailwaymap" | "legacy_geojson" | "manual"
  entityType: string;      // "node" | "edge" | "area" | "section" | "pattern" | "anchor"
  /** 稳定字段值列表，拼接后参与 hash */
  stableFields: string[];
}

export interface ParsedStableId {
  source: string;
  entityType: string;
  stablePart: string;
}

// ── 函数签名 ────────────────────────────────────────────────

/**
 * 构建稳定 ID。
 * 优先使用外部源 ID（stableFields[0]），缺失时用 sha256(source + entityType + fields...)
 *
 * 确定性: 同输入 = 同输出（幂等）
 */
export declare function buildStableId(input: StableIdInput): EntityRef;

/** 解析 EntityRef 回结构化组件 */
export declare function parseStableId(id: EntityRef): ParsedStableId;

/** 校验 ID 格式合法性，非法时抛出 */
export declare function assertStableId(id: string): asserts id is EntityRef;

// ── 内容寻址 ────────────────────────────────────────────────

/**
 * 实体内容指纹 = sha256(canonicalJson(entity))
 * 用于缓存键、内容身份比较。
 *
 * OPEN: canonicalJson 的序列化顺序规范——
 *   1. 对象 key 按字母序排列
 *   2. 数组保持原序
 *   3. undefined 字段不序列化
 *   4. 暂不处理 Map——索引层不参与 hash
 */
export declare function hashEntity<T>(entity: T): string;

/**
 * 短 hash 仅用于日志/UI 展示 (前 8 位)。
 * 不参与缓存键比较——缓存键始终用完整 hash。
 */
export declare function shortHash(hash: string, length?: number): string;

// ── 哈希实现 ────────────────────────────────────────────────
//
// 环境适配（实现期决定）:
//   Browser/Worker: crypto.subtle.digest("SHA-256", ...)
//   Node:           require("crypto").createHash("sha256")
//
// 当前项目（v0.52）已有 sha256Hex 实现在:
//   public/functions/api/feedback/_shared.js:89 — 使用 Web Crypto API
//
// 建议: 在 ids.ts 中封装为 sha256(input: string): Promise<string>
//       同步版本 sha256Sync 仅在 Node 环境可用
//
// OPEN: 是否需要一个同步 hash 函数供纯计算路径使用？
//       如果 graph-builder 在 worker 中异步执行，则 async 足够。
//       如果需要主线程同步调用（如实时去重检查），需要同步版本。
