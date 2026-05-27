/**
 * Integration tests: round-trips with mocked KV, my-issues merge+dedup,
 * reporter structures, backward compatibility with legacy record shapes.
 */
import { describe, it, expect, beforeEach } from "vitest";

// Actual source under test
import {
  appendToFeedbackIndex,
  getFeedbackIndexPage,
  getAllFeedbackIds,
  getAllFeedbackDebugDump,
  getReporterLabel,
} from "../../../public/functions/api/feedback/_shared.js";

// ---- Helpers ----

function makeMockKV(initial = new Map<string, string>()) {
  const store = initial;
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    store,
  };
}

function buildRecord(overrides: Record<string, any> = {}): any {
  return {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    created_at: new Date().toISOString(),
    category: "error",
    error_module: "map",
    content: "Test feedback content",
    include_identity: false,
    reporter: { type: "guest" },
    screenshot: null,
    client_meta: { ua: "test", lang: "en" },
    hook: { status: "pending" },
    ...overrides,
  };
}

// ---- Reporter type compatibility ----
describe("Reporter type backward compatibility", () => {
  it("legacy guest (no username)", () => {
    expect(getReporterLabel({ type: "guest" })).toBe("guest");
  });

  it("anonymous_user (logged in, submitted anonymously)", () => {
    // This is the case the user identified: logged-in user, anonymous submit
    const label = getReporterLabel({ type: "anonymous_user" });
    expect(label).toBe("anonymous_user");
    // No username leaked — privacy preserved
  });

  it("named_user with username", () => {
    expect(getReporterLabel({ type: "named_user", username: "osaka" })).toBe("osaka");
  });

  it("named_user without username (edge case)", () => {
    // Should not happen in practice, but graceful fallback
    expect(getReporterLabel({ type: "named_user" })).toBe("named_user");
  });

  it("null/undefined reporter", () => {
    expect(getReporterLabel(null)).toBe("unknown");
    expect(getReporterLabel(undefined)).toBe("unknown");
  });

  it("future unknown type — passes through raw", () => {
    // Adding new reporter types in the future won't break the label function
    expect(getReporterLabel({ type: "future_type_v2" })).toBe("future_type_v2");
  });
});

// ---- Feedback record structure compatibility ----
describe("Feedback record structure", () => {
  it("minimal valid record has all required fields", () => {
    const rec = buildRecord();
    expect(rec.id).toMatch(/^fb_\d{13}_[0-9a-z]{8}$/);
    expect(rec.created_at).toBeTruthy();
    expect(["error", "suggestion"]).toContain(rec.category);
    expect(rec.reporter).toHaveProperty("type");
    expect(rec.hook).toHaveProperty("status");
  });

  it("record with screenshot stores r2_key", () => {
    const rec = buildRecord({
      screenshot: { r2_key: "feedback/2025/06/fb_001.jpg", mime: "image/jpeg", size: 5000 },
    });
    expect(rec.screenshot.r2_key).toBeTruthy();
    expect(rec.screenshot.mime).toBe("image/jpeg");
  });

  it("record without screenshot is null", () => {
    const rec = buildRecord({ screenshot: null });
    expect(rec.screenshot).toBeNull();
  });

  it("hook status transitions are valid", () => {
    const validStatuses = ["pending", "success", "failed"];
    for (const status of validStatuses) {
      const rec = buildRecord({ hook: { status } });
      expect(rec.hook.status).toBe(status);
    }
  });

  it("hook with full GitHub binding", () => {
    const rec = buildRecord({
      hook: {
        provider: "github_issue",
        status: "success",
        issue_number: 42,
        issue_state: "open",
        issue_title: "Fix bug",
        issue_labels: ["feedback", "bug"],
        issue_url: "https://github.com/O/R/issues/42",
        issue_updated_at: "2025-06-15T12:00:00Z",
        last_comment: null,
        error: null,
      },
    });
    expect(rec.hook.provider).toBe("github_issue");
    expect(rec.hook.issue_number).toBe(42);
    expect(rec.hook.issue_state).toBe("open");
  });

  it("legacy record with minimal hook (backward compat)", () => {
    // Old records might only have hook.status or be missing hook entirely
    const rec = buildRecord({ hook: undefined });
    // Simulate what reading an old record looks like
    const hook = rec.hook ?? { status: "pending" };
    expect(hook.status).toBe("pending");
  });
});

// ---- Round-trip: submit → index → query ----
describe("Submit → Index → Query round-trip", () => {
  let kv: ReturnType<typeof makeMockKV>;

  beforeEach(() => { kv = makeMockKV(); });

  it("full round-trip with single record", async () => {
    const rec = buildRecord();
    // Step 1: store record
    await kv.put(`feedback:${rec.id}`, JSON.stringify(rec));
    // Step 2: append to index
    await appendToFeedbackIndex(kv, rec.id);

    // Step 3: query via index page
    const page = await getFeedbackIndexPage(kv, { limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(rec.id);
    expect(page.items[0].content).toBe(rec.content);
  });

  it("full round-trip with multiple records", async () => {
    const records = [
      buildRecord({ content: "First" }),
      buildRecord({ content: "Second" }),
      buildRecord({ content: "Third" }),
    ];

    for (const rec of records) {
      await kv.put(`feedback:${rec.id}`, JSON.stringify(rec));
      await appendToFeedbackIndex(kv, rec.id);
    }

    // Index is reverse chronological (last appended is first)
    const page = await getFeedbackIndexPage(kv, { limit: 20 });
    expect(page.items).toHaveLength(3);
    expect(page.items[0].content).toBe("Third");
    expect(page.items[1].content).toBe("Second");
    expect(page.items[2].content).toBe("First");
  });

  it("partial round-trip: record exists but index is missing", async () => {
    const rec = buildRecord();
    await kv.put(`feedback:${rec.id}`, JSON.stringify(rec));
    // index NOT updated (simulating failed appendToFeedbackIndex)

    const page = await getFeedbackIndexPage(kv, { limit: 20 });
    expect(page.items).toEqual([]); // index missing → empty page

    // But debug dump reveals the problem
    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexRaw).toBeNull(); // index is missing
    // Individual record still exists in KV but can't be found without index
  });

  it("partial round-trip: record missing but index references it", async () => {
    const rec = buildRecord();
    await kv.put(`feedback:${rec.id}`, JSON.stringify(rec));
    await appendToFeedbackIndex(kv, rec.id);

    // Simulate record deletion (but index still references it)
    kv.store.delete(`feedback:${rec.id}`);

    const page = await getFeedbackIndexPage(kv, { limit: 20 });
    expect(page.items).toEqual([]); // missing record silently skipped

    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexCount).toBe(1);
    expect(dump.foundCount).toBe(0);
    expect(dump.missingIds).toEqual([rec.id]);
  });

  it("admin list category + status filtering", async () => {
    const records = [
      buildRecord({ category: "error", hook: { status: "pending" }, content: "err-pending" }),
      buildRecord({ category: "error", hook: { status: "success" }, content: "err-success" }),
      buildRecord({ category: "suggestion", hook: { status: "pending" }, content: "sug-pending" }),
    ];

    for (const rec of records) {
      await kv.put(`feedback:${rec.id}`, JSON.stringify(rec));
      await appendToFeedbackIndex(kv, rec.id);
    }

    // Category filter
    const allItems = (await getFeedbackIndexPage(kv, { limit: 20 })).items;
    const errors = allItems.filter((r: any) => r.category === "error");
    expect(errors).toHaveLength(2);

    const suggestions = allItems.filter((r: any) => r.category === "suggestion");
    expect(suggestions).toHaveLength(1);

    // Status filter
    const pending = allItems.filter((r: any) => (r.hook?.status || "pending") === "pending");
    expect(pending).toHaveLength(2);
  });
});

// ---- my-issues merge + dedup (simulated) ----
describe("my-issues merge + dedup logic", () => {
  let kv: ReturnType<typeof makeMockKV>;

  beforeEach(() => { kv = makeMockKV(); });

  it("merges ID-based and username-based results, deduplicating", async () => {
    // User has 3 feedback entries:
    // 1. Guest submission (only in myFeedbackIds)
    // 2. Anonymous submission (only in myFeedbackIds)
    // 3. Named submission (in myFeedbackIds AND matches username)

    const guestRec = buildRecord({ id: "fb_guest", reporter: { type: "guest" }, content: "guest" });
    const anonRec = buildRecord({ id: "fb_anon", reporter: { type: "anonymous_user" }, content: "anon" });
    const namedRec = buildRecord({ id: "fb_named", reporter: { type: "named_user", username: "osaka" }, content: "named" });

    await kv.put("feedback:fb_guest", JSON.stringify(guestRec));
    await kv.put("feedback:fb_anon", JSON.stringify(anonRec));
    await kv.put("feedback:fb_named", JSON.stringify(namedRec));
    await kv.put("feedback:ids", JSON.stringify(["fb_named", "fb_anon", "fb_guest"]));

    const username = "osaka";
    const persistedIds = ["fb_guest", "fb_anon", "fb_named"];

    // Simulate merge logic from my-issues.js
    const seen = new Set<string>();
    const merged: any[] = [];

    function add(items: any[]) {
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
      }
    }

    // ID path (use add for dedup, matching real my-issues.js)
    for (const id of persistedIds) {
      const raw = await kv.get(`feedback:${id}`);
      if (raw) add([JSON.parse(raw)]);
    }

    // Username path
    const allIds = await getAllFeedbackIds(kv);
    for (const id of allIds) {
      const raw = await kv.get(`feedback:${id}`);
      if (!raw) continue;
      const row = JSON.parse(raw);
      if (row.reporter?.username === username) {
        add([row]); // deduped via add()
      }
    }

    // guest: from IDs only
    // anon: from IDs only
    // named: from both IDs and username, but deduped
    expect(merged).toHaveLength(3);
    const contents = merged.map((r: any) => r.content).sort();
    expect(contents).toEqual(["anon", "guest", "named"]);
  });

  it("guest-only path works with just IDs", async () => {
    const guestRec = buildRecord({ id: "fb_g1", reporter: { type: "guest" }, content: "g1" });
    await kv.put("feedback:fb_g1", JSON.stringify(guestRec));

    const persistedIds = ["fb_g1"];
    const results: any[] = [];
    for (const id of persistedIds) {
      const raw = await kv.get(`feedback:${id}`);
      if (raw) results.push(JSON.parse(raw));
    }
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("g1");
  });

  it("authenticated-only path works with username match", async () => {
    const namedRec = buildRecord({
      id: "fb_n1",
      reporter: { type: "named_user", username: "osaka" },
      content: "n1",
    });
    // Also create a different user's record (should not match)
    const otherRec = buildRecord({
      id: "fb_other",
      reporter: { type: "named_user", username: "other_user" },
      content: "other",
    });

    await kv.put("feedback:fb_n1", JSON.stringify(namedRec));
    await kv.put("feedback:fb_other", JSON.stringify(otherRec));
    await kv.put("feedback:ids", JSON.stringify(["fb_n1", "fb_other"]));

    const username = "osaka";
    const allIds = await getAllFeedbackIds(kv);
    const results: any[] = [];
    for (const id of allIds) {
      const raw = await kv.get(`feedback:${id}`);
      if (!raw) continue;
      const row = JSON.parse(raw);
      if (row.reporter?.username === username) {
        results.push(row);
      }
    }
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("n1");
  });
});

// ---- Debug dump integrity ----
describe("Debug dump integrity", () => {
  let kv: ReturnType<typeof makeMockKV>;

  beforeEach(() => { kv = makeMockKV(); });

  it("empty store → all zeros", async () => {
    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexCount).toBe(0);
    expect(dump.foundCount).toBe(0);
    expect(dump.missingIds).toEqual([]);
    expect(dump.records).toEqual([]);
  });

  it("healthy store → complete data", async () => {
    for (let i = 0; i < 5; i++) {
      const rec = buildRecord({ id: `fb_${i}`, content: `Content ${i}` });
      await kv.put(`feedback:${rec.id}`, JSON.stringify(rec));
      await appendToFeedbackIndex(kv, rec.id);
    }

    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexCount).toBe(5);
    expect(dump.foundCount).toBe(5);
    expect(dump.missingIds).toEqual([]);
    expect(dump.records).toHaveLength(5);
    // Records should be full objects, not clipped
    for (const rec of dump.records) {
      expect(rec.id).toBeTruthy();
      expect(rec.content).toBeTruthy();
      expect(rec.reporter).toBeTruthy();
    }
  });

  it("corrupted records are counted as missing", async () => {
    await kv.put("feedback:ids", JSON.stringify(["fb_corrupt"]));
    await kv.put("feedback:fb_corrupt", "not-json{{{");

    const dump = await getAllFeedbackDebugDump(kv);
    expect(dump.indexCount).toBe(1);
    expect(dump.foundCount).toBe(0);
    expect(dump.missingIds).toEqual(["fb_corrupt"]);
  });
});
