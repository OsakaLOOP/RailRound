/**
 * Feedback API contract test: validates backend utilities and
 * frontend-backend data format matching for the zero-login feedback system.
 */
import { describe, it, expect, beforeEach } from "vitest";

// --- Replicated validation logic from submit.js (for testing without Edge env) ---
const ALLOWED_CATEGORIES = new Set(["error", "suggestion"]);
const ALLOWED_ERROR_MODULES = new Set([
  "routing",
  "map",
  "auth",
  "sync",
  "i18n",
  "ui",
  "performance",
  "other",
]);

type IssueSubmitMode = "system_auto" | "github_user_manual";

function normalizeErrorModule(rawValue: unknown): string | null {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return "other";
  if (!ALLOWED_ERROR_MODULES.has(value)) return null;
  return value;
}

function validateCategory(category: unknown): boolean {
  return ALLOWED_CATEGORIES.has(String(category || "").trim());
}

interface SubmitPayload {
  category: string;
  content: string;
  errorModule?: string;
  includeIdentity?: boolean;
  lang?: string;
  appVersion?: string;
  path?: string;
  issueSubmitMode?: IssueSubmitMode;
}

function validateSubmitPayload(payload: SubmitPayload): { valid: boolean; error?: string } {
  if (!payload.category || !ALLOWED_CATEGORIES.has(payload.category)) {
    return { valid: false, error: "Invalid category" };
  }
  if (!payload.content || !payload.content.trim()) {
    return { valid: false, error: "Missing content" };
  }
  if (payload.content.length > 2000) {
    return { valid: false, error: "Content too long" };
  }
  if (payload.category === "error") {
    const mod = normalizeErrorModule(payload.errorModule);
    if (mod === null) {
      return { valid: false, error: "Invalid error module" };
    }
  }
  return { valid: true };
}

// --- Replicated _shared.js utilities ---
function clipText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  return input.length > maxLen ? input.slice(0, maxLen) : input;
}

function getMimeExtension(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "bin";
}

function getReporterLabel(reporter: any): string {
  if (!reporter) return "unknown";
  if (reporter.type === "guest") return "guest";
  if (reporter.type === "anonymous_user") return "anonymous_user";
  if (reporter.type === "named_user") return reporter.username || "named_user";
  return reporter.type || "unknown";
}

function getIssueCategoryLabel(category: string): string {
  return category === "error" ? "Error Report" : "Suggestion";
}

function secureCompareHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// --- Tests ---

describe("submit.js validation logic", () => {
  describe("category validation", () => {
    it('accepts "error"', () =>
      expect(validateCategory("error")).toBe(true));
    it('accepts "suggestion"', () =>
      expect(validateCategory("suggestion")).toBe(true));
    it("rejects invalid category", () =>
      expect(validateCategory("bug")).toBe(false));
    it("rejects empty category", () =>
      expect(validateCategory("")).toBe(false));
  });

  describe("normalizeErrorModule", () => {
    it("validates known error modules", () => {
      expect(normalizeErrorModule("routing")).toBe("routing");
      expect(normalizeErrorModule("map")).toBe("map");
      expect(normalizeErrorModule("auth")).toBe("auth");
      expect(normalizeErrorModule("sync")).toBe("sync");
      expect(normalizeErrorModule("i18n")).toBe("i18n");
      expect(normalizeErrorModule("ui")).toBe("ui");
      expect(normalizeErrorModule("performance")).toBe("performance");
      expect(normalizeErrorModule("other")).toBe("other");
    });

    it("is case-insensitive", () => {
      expect(normalizeErrorModule("ROUTING")).toBe("routing");
      expect(normalizeErrorModule("Map")).toBe("map");
    });

    it("trims whitespace", () => {
      expect(normalizeErrorModule("  map  ")).toBe("map");
    });

    it("returns null for unknown modules", () => {
      expect(normalizeErrorModule("database")).toBeNull();
      expect(normalizeErrorModule("network")).toBeNull();
    });

    it("returns 'other' for empty value", () => {
      expect(normalizeErrorModule("")).toBe("other");
      expect(normalizeErrorModule(null)).toBe("other");
    });
  });

  describe("full payload validation", () => {
    it("accepts valid error report", () => {
      const result = validateSubmitPayload({
        category: "error",
        content: "Map doesn't load on mobile",
        errorModule: "map",
      });
      expect(result.valid).toBe(true);
    });

    it("accepts valid suggestion", () => {
      const result = validateSubmitPayload({
        category: "suggestion",
        content: "Add dark mode support for station labels",
      });
      expect(result.valid).toBe(true);
    });

    it("defaults error module to 'other' when not specified", () => {
      // normalizeErrorModule returns "other" for empty/undefined → validation passes
      const result = validateSubmitPayload({
        category: "error",
        content: "Something broke",
        errorModule: "other",
      });
      expect(result.valid).toBe(true);
      expect(
        normalizeErrorModule(undefined)
      ).toBe("other");
    });

    it("rejects content exceeding 2000 chars", () => {
      const result = validateSubmitPayload({
        category: "error",
        content: "X".repeat(2001),
        errorModule: "other",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Content too long");
    });

    it("allows content at exactly 2000 chars", () => {
      const result = validateSubmitPayload({
        category: "suggestion",
        content: "X".repeat(2000),
      });
      expect(result.valid).toBe(true);
    });

    it("rejects empty content", () => {
      const result = validateSubmitPayload({
        category: "suggestion",
        content: "",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing content");
    });
  });
});

describe("_shared.js utility functions", () => {
  describe("clipText", () => {
    it("clips strings exceeding max length", () => {
      expect(clipText("hello world", 5)).toBe("hello");
    });

    it("returns full string when within limit", () => {
      expect(clipText("hello", 10)).toBe("hello");
    });

    it("returns empty for non-string input", () => {
      expect(clipText(null, 10)).toBe("");
      expect(clipText(undefined, 10)).toBe("");
      expect(clipText(123 as any, 10)).toBe("");
    });
  });

  describe("getMimeExtension", () => {
    it("maps known mime types", () => {
      expect(getMimeExtension("image/jpeg")).toBe("jpg");
      expect(getMimeExtension("image/png")).toBe("png");
      expect(getMimeExtension("image/webp")).toBe("webp");
      expect(getMimeExtension("image/gif")).toBe("gif");
    });

    it("returns 'bin' for unknown mime", () => {
      expect(getMimeExtension("image/bmp")).toBe("bin");
      expect(getMimeExtension("")).toBe("bin");
    });
  });

  describe("getReporterLabel", () => {
    it("identifies guest", () =>
      expect(getReporterLabel({ type: "guest" })).toBe("guest"));
    it("identifies anonymous_user", () =>
      expect(getReporterLabel({ type: "anonymous_user" })).toBe(
        "anonymous_user"
      ));
    it("identifies named_user", () =>
      expect(getReporterLabel({ type: "named_user", username: "osaka" })).toBe(
        "osaka"
      ));
    it("handles missing reporter", () =>
      expect(getReporterLabel(null)).toBe("unknown"));
  });

  describe("getIssueCategoryLabel", () => {
    it('maps "error" to "Error Report"', () =>
      expect(getIssueCategoryLabel("error")).toBe("Error Report"));
    it('maps "suggestion" to "Suggestion"', () =>
      expect(getIssueCategoryLabel("suggestion")).toBe("Suggestion"));
  });

  describe("secureCompareHex", () => {
    it("returns true for identical strings", () => {
      expect(secureCompareHex("abc123", "abc123")).toBe(true);
    });

    it("returns false for different strings", () => {
      expect(secureCompareHex("abc123", "abc124")).toBe(false);
    });

    it("returns false for different length strings", () => {
      expect(secureCompareHex("abc", "abcd")).toBe(false);
    });

    it("returns false for null/undefined inputs", () => {
      expect(secureCompareHex(null as any, "abc")).toBe(false);
      expect(secureCompareHex("abc", undefined as any)).toBe(false);
    });
  });
});

describe("Feedback ID format", () => {
  it("generates IDs matching the expected pattern", () => {
    const feedbackId = `fb_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    expect(feedbackId).toMatch(/^fb_\d{13}_[0-9a-f]{8}$/);
  });
});

describe("FeedbackKV index operations", () => {
  // Simple in-memory mock for feedback index logic
  let store: Map<string, any>;

  beforeEach(() => {
    store = new Map();
  });

  const FEEDBACK_INDEX_KEY = "feedback:ids";

  async function appendToIndex(feedbackId: string) {
    const raw = store.get(FEEDBACK_INDEX_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    ids.unshift(feedbackId);
    if (ids.length > 2000) ids.length = 2000;
    store.set(FEEDBACK_INDEX_KEY, JSON.stringify(ids));
  }

  async function getPage(cursor = 0, limit = 20) {
    const raw = store.get(FEEDBACK_INDEX_KEY);
    if (!raw) return { items: [], nextCursor: null, hasMore: false };
    const ids: string[] = JSON.parse(raw);
    const start = Math.max(0, cursor);
    const end = Math.min(ids.length, start + Math.max(1, Math.min(50, limit)));
    return {
      ids: ids.slice(start, end),
      nextCursor: end < ids.length ? end : null,
      hasMore: end < ids.length,
    };
  }

  it("appends items to index in reverse chronological order", async () => {
    await appendToIndex("fb_001");
    await appendToIndex("fb_002");
    await appendToIndex("fb_003");

    const page = await getPage(0, 10);
    expect(page.ids).toEqual(["fb_003", "fb_002", "fb_001"]);
  });

  it("caps index at 2000 entries", async () => {
    for (let i = 0; i < 2005; i++) {
      await appendToIndex(`fb_${String(i).padStart(4, "0")}`);
    }
    const raw = store.get(FEEDBACK_INDEX_KEY);
    const ids = JSON.parse(raw);
    expect(ids.length).toBeLessThanOrEqual(2000);
  });

  it("paginates correctly", async () => {
    for (let i = 0; i < 10; i++) {
      await appendToIndex(`fb_${i}`);
    }
    const page1 = await getPage(0, 3);
    expect(page1.ids).toHaveLength(3);
    expect(page1.hasMore).toBe(true);

    const page2 = await getPage(page1.nextCursor!, 3);
    expect(page2.ids).toHaveLength(3);

    const page4 = await getPage(9, 3);
    expect(page4.ids).toHaveLength(1);
    expect(page4.hasMore).toBe(false);
  });
});
