/**
 * Unit tests for _shared.js: crypto, utilities, KV index operations, debug dump.
 * Tests actual source — no duplicated logic.
 */
import { describe, it, expect, beforeEach } from "vitest";

// Import actual source (public/functions/**/*.js are ESM)
import {
  sha256Hex,
  hmacHex,
  secureCompareHex,
  clipText,
  getMimeExtension,
  getReporterLabel,
  getIssueCategoryLabel,
  appendToFeedbackIndex,
  getFeedbackIndexPage,
  getAllFeedbackIds,
  getAllFeedbackDebugDump,
} from "../../../public/functions/api/feedback/_shared.js";

// --- KV mock helper ---
function makeMockKV(initial = new Map<string, string>()) {
  const store = initial;
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    store,
  };
}

const FEEDBACK_INDEX_KEY = "feedback:ids";
const FEEDBACK_KEY_PREFIX = "feedback:";

// ============================================================
// Crypto
// ============================================================
describe("sha256Hex", () => {
  it("produces 64-char hex string", async () => {
    const result = await sha256Hex("hello");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    const a = await sha256Hex("test");
    const b = await sha256Hex("test");
    expect(a).toBe(b);
  });

  it("different inputs produce different hashes", async () => {
    const a = await sha256Hex("a");
    const b = await sha256Hex("b");
    expect(a).not.toBe(b);
  });

  it("handles empty input", async () => {
    const result = await sha256Hex("");
    expect(result).toHaveLength(64);
  });

  it("handles binary Uint8Array", async () => {
    const result = await sha256Hex(new Uint8Array([1, 2, 3]));
    expect(result).toHaveLength(64);
  });
});

describe("hmacHex", () => {
  it("produces 64-char hex string", async () => {
    const result = await hmacHex("secret", "message");
    expect(result).toHaveLength(64);
  });

  it("is deterministic", async () => {
    const a = await hmacHex("key", "msg");
    const b = await hmacHex("key", "msg");
    expect(a).toBe(b);
  });

  it("different keys produce different output", async () => {
    const a = await hmacHex("key1", "msg");
    const b = await hmacHex("key2", "msg");
    expect(a).not.toBe(b);
  });
});

describe("secureCompareHex", () => {
  it("true for identical", () => expect(secureCompareHex("abc123", "abc123")).toBe(true));
  it("false for different", () => expect(secureCompareHex("abc123", "abc124")).toBe(false));
  it("false for different length", () => expect(secureCompareHex("abc", "abcd")).toBe(false));
  it("false for null a", () => expect(secureCompareHex(null as any, "abc")).toBe(false));
  it("false for null b", () => expect(secureCompareHex("abc", null as any)).toBe(false));
  it("false for both empty", () => expect(secureCompareHex("", "")).toBe(false));
  it("handles long identical strings", () => {
    const s = "a".repeat(1000);
    expect(secureCompareHex(s, s)).toBe(true);
  });
});

// ============================================================
// Utilities
// ============================================================
describe("clipText", () => {
  it("clips long", () => expect(clipText("hello world", 5)).toBe("hello"));
  it("passes short", () => expect(clipText("hi", 10)).toBe("hi"));
  it("empty string stays empty", () => expect(clipText("", 10)).toBe(""));
  it("non-string returns empty", () => {
    expect(clipText(null as any, 10)).toBe("");
    expect(clipText(undefined as any, 10)).toBe("");
    expect(clipText(123 as any, 10)).toBe("");
  });
  it("at exact limit", () => expect(clipText("abcde", 5)).toBe("abcde"));
});

describe("getMimeExtension", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ])("%s → %s", (mime, ext) => expect(getMimeExtension(mime)).toBe(ext));
  it("unknown → bin", () => expect(getMimeExtension("image/bmp")).toBe("bin"));
});

describe("getReporterLabel", () => {
  it("guest", () => expect(getReporterLabel({ type: "guest" })).toBe("guest"));
  it("anonymous_user", () => expect(getReporterLabel({ type: "anonymous_user" })).toBe("anonymous_user"));
  it("named_user with name", () => expect(getReporterLabel({ type: "named_user", username: "osaka" })).toBe("osaka"));
  it("named_user without name", () => expect(getReporterLabel({ type: "named_user" })).toBe("named_user"));
  it("null reporter", () => expect(getReporterLabel(null)).toBe("unknown"));
  it("unknown type", () => expect(getReporterLabel({ type: "bot" })).toBe("bot"));
});

describe("getIssueCategoryLabel", () => {
  it("error", () => expect(getIssueCategoryLabel("error")).toBe("Error Report"));
  it("suggestion", () => expect(getIssueCategoryLabel("suggestion")).toBe("Suggestion"));
});

// ============================================================
// KV index operations
// ============================================================
describe("KV index operations", () => {
  let kv: ReturnType<typeof makeMockKV>;

  beforeEach(() => { kv = makeMockKV(); });

  describe("appendToFeedbackIndex", () => {
    it("creates index on first append", async () => {
      await appendToFeedbackIndex(kv, "fb_001");
      const raw = kv.store.get(FEEDBACK_INDEX_KEY)!;
      expect(JSON.parse(raw)).toEqual(["fb_001"]);
    });

    it("prepends to existing index", async () => {
      await appendToFeedbackIndex(kv, "fb_001");
      await appendToFeedbackIndex(kv, "fb_002");
      const ids = JSON.parse(kv.store.get(FEEDBACK_INDEX_KEY)!);
      expect(ids).toEqual(["fb_002", "fb_001"]);
    });

    it("caps at 2000 entries", async () => {
      for (let i = 0; i < 2005; i++) {
        await appendToFeedbackIndex(kv, `fb_${String(i).padStart(4, "0")}`);
      }
      const ids = JSON.parse(kv.store.get(FEEDBACK_INDEX_KEY)!);
      expect(ids.length).toBe(2000);
      // first appended (index 2004) should be first in array
      expect(ids[0]).toBe("fb_2004");
    });
  });

  describe("getFeedbackIndexPage", () => {
    it("empty → empty page", async () => {
      const page = await getFeedbackIndexPage(kv, {});
      expect(page.items).toEqual([]);
      expect(page.hasMore).toBe(false);
    });

    it("returns page with records", async () => {
      await kv.put("feedback:fb_a", JSON.stringify({ id: "fb_a", content: "A" }));
      await kv.put("feedback:fb_b", JSON.stringify({ id: "fb_b", content: "B" }));
      await kv.put(FEEDBACK_INDEX_KEY, JSON.stringify(["fb_a", "fb_b"]));

      const page = await getFeedbackIndexPage(kv, { limit: 20 });
      expect(page.items).toHaveLength(2);
      expect(page.items[0].id).toBe("fb_a");
    });

    it("skips missing records gracefully", async () => {
      // only fb_a exists, fb_b is missing
      await kv.put("feedback:fb_a", JSON.stringify({ id: "fb_a", content: "A" }));
      await kv.put(FEEDBACK_INDEX_KEY, JSON.stringify(["fb_a", "fb_b"]));

      const page = await getFeedbackIndexPage(kv, { limit: 20 });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe("fb_a");
    });

    it("paginates correctly", async () => {
      for (let i = 0; i < 10; i++) {
        await kv.put(`feedback:fb_${i}`, JSON.stringify({ id: `fb_${i}` }));
      }
      await kv.put(FEEDBACK_INDEX_KEY, JSON.stringify(
        Array.from({ length: 10 }, (_, i) => `fb_${i}`)
      ));

      const page1 = await getFeedbackIndexPage(kv, { cursor: 0, limit: 3 });
      expect(page1.items).toHaveLength(3);
      expect(page1.hasMore).toBe(true);

      const page2 = await getFeedbackIndexPage(kv, { cursor: page1.nextCursor, limit: 3 });
      expect(page2.items).toHaveLength(3);

      const last = await getFeedbackIndexPage(kv, { cursor: 9, limit: 5 });
      expect(last.items).toHaveLength(1);
      expect(last.hasMore).toBe(false);
    });

    it("respects max limit of 50", async () => {
      for (let i = 0; i < 60; i++) {
        await kv.put(`feedback:fb_${i}`, JSON.stringify({ id: `fb_${i}` }));
      }
      await kv.put(FEEDBACK_INDEX_KEY, JSON.stringify(
        Array.from({ length: 60 }, (_, i) => `fb_${i}`)
      ));
      const page = await getFeedbackIndexPage(kv, { limit: 100 });
      expect(page.items.length).toBeLessThanOrEqual(50);
    });
  });

  describe("getAllFeedbackIds", () => {
    it("empty → []", async () => {
      expect(await getAllFeedbackIds(kv)).toEqual([]);
    });
    it("returns all ids", async () => {
      await kv.put(FEEDBACK_INDEX_KEY, JSON.stringify(["fb_1", "fb_2", "fb_3"]));
      expect(await getAllFeedbackIds(kv)).toEqual(["fb_1", "fb_2", "fb_3"]);
    });
    it("handles corrupted data → []", async () => {
      await kv.put(FEEDBACK_INDEX_KEY, "not-json{{}");
      expect(await getAllFeedbackIds(kv)).toEqual([]);
    });
  });
});

// ============================================================
// Debug dump
// ============================================================
describe("getAllFeedbackDebugDump", () => {
  let kv: ReturnType<typeof makeMockKV>;

  beforeEach(() => { kv = makeMockKV(); });

  it("empty KV → empty dump", async () => {
    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexRaw).toBeNull();
    expect(dump.indexCount).toBe(0);
    expect(dump.foundCount).toBe(0);
    expect(dump.missingIds).toEqual([]);
  });

  it("full KV → complete dump", async () => {
    await kv.put(FEEDBACK_INDEX_KEY, JSON.stringify(["fb_a", "fb_b"]));
    await kv.put("feedback:fb_a", JSON.stringify({ id: "fb_a", content: "A" }));
    await kv.put("feedback:fb_b", JSON.stringify({ id: "fb_b", content: "B" }));

    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexCount).toBe(2);
    expect(dump.foundCount).toBe(2);
    expect(dump.missingIds).toEqual([]);
    expect(dump.records).toHaveLength(2);
    expect(dump.records.map((r: any) => r.id).sort()).toEqual(["fb_a", "fb_b"]);
  });

  it("tracks missing records", async () => {
    await kv.put(FEEDBACK_INDEX_KEY, JSON.stringify(["fb_a", "fb_missing", "fb_b"]));
    await kv.put("feedback:fb_a", JSON.stringify({ id: "fb_a" }));
    // fb_missing intentionally absent
    await kv.put("feedback:fb_b", JSON.stringify({ id: "fb_b" }));

    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexCount).toBe(3);
    expect(dump.foundCount).toBe(2);
    expect(dump.missingIds).toEqual(["fb_missing"]);
  });

  it("catches parse errors gracefully", async () => {
    await kv.put(FEEDBACK_INDEX_KEY, "not-valid-json{{{");
    // corrupted index
    await kv.put("feedback:fb_a", JSON.stringify({ id: "fb_a" }));

    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.error).toBeTruthy();
  });
});
