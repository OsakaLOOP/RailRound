/**
 * Unit tests for _github.js: draft building, image URLs, issue data transforms.
 */
import { describe, it, expect } from "vitest";

import {
  buildIssueMarker,
  buildIssueDraft,
  buildIssueDraftUrl,
  formatUtcForTitle,
  normalizeIssueLabels,
  normalizeIssueState,
  buildHookSuccessFromIssue,
  isIssueLabelSuperset,
  toIssueListItem,
  makeReadableError,
  getIssueTicketSecret,
} from "../../../public/functions/api/feedback/_github.js";

// ============================================================
// buildIssueMarker
// ============================================================
describe("buildIssueMarker", () => {
  it("generates marker without nonce", () => {
    const m = buildIssueMarker("fb_123");
    expect(m).toBe("<!-- railround-feedback-marker:fb_123 -->");
  });

  it("generates marker with nonce", () => {
    const m = buildIssueMarker("fb_123", "nonce99");
    expect(m).toBe("<!-- railround-feedback-marker:fb_123:nonce99 -->");
  });

  it("empty id returns empty string", () => {
    expect(buildIssueMarker("")).toBe("");
  });
});

// ============================================================
// formatUtcForTitle
// ============================================================
describe("formatUtcForTitle", () => {
  it("formats ISO date to UTC title format", () => {
    // Use a fixed ISO that maps to a known UTC representation
    const result = formatUtcForTitle("2025-06-15T12:34:56.789Z");
    expect(result).toMatch(/^2025-06-15 \d{2}:\d{2}:\d{2} UTC$/);
  });

  it("handles invalid date gracefully", () => {
    expect(formatUtcForTitle("not-a-date")).toBe("unknown-time");
  });

  it("handles falsy input", () => {
    const result = formatUtcForTitle("");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
  });
});

// ============================================================
// buildIssueDraft
// ============================================================
describe("buildIssueDraft", () => {
  const baseRecord = {
    id: "fb_test_001",
    created_at: "2025-06-15T12:00:00.000Z",
    category: "error",
    error_module: "map",
    content: "Map crashes on zoom level 18 in Tokyo area.",
    reporter: { type: "guest" },
    include_identity: false,
    client_meta: { ua: "Chrome/120", lang: "en" },
  };

  it("builds draft with all sections", () => {
    const draft = buildIssueDraft(baseRecord);
    expect(draft.title).toContain("[Feedback]");
    expect(draft.title).toContain("[error]");
    expect(draft.title).toContain("[map]");
    expect(draft.title).toContain("UTC");
    expect(draft.body).toContain("<!-- railround-feedback-marker:fb_test_001 -->");
    expect(draft.body).toContain("Feedback ID: fb_test_001");
    expect(draft.body).toContain('Category: Error Report (error)');
    expect(draft.body).toContain("Error Module: map");
    expect(draft.body).toContain("Reporter: guest");
    expect(draft.body).toContain("Content:");
    expect(draft.body).toContain("Map crashes on zoom level 18");
    expect(draft.body).toContain("Client Meta:");
    expect(draft.body).toContain('"ua": "Chrome/120"');
    expect(draft.labels).toContain("feedback");
    expect(draft.labels).toContain("feedback:error");
    expect(draft.labels).toContain("feedback:module:map");
    expect(draft.marker).toBeTruthy();
  });

  it("suggestion category skips error_module labels", () => {
    const rec = { ...baseRecord, category: "suggestion", error_module: undefined };
    const draft = buildIssueDraft(rec);
    expect(draft.body).toContain("Error Module: n/a");
    expect(draft.labels).toContain("feedback:suggestion");
    expect(draft.labels).not.toContain("feedback:module:map");
  });

  it("no screenshot, no imageBaseUrl → no image in body", () => {
    const draft = buildIssueDraft(baseRecord, { imageBaseUrl: "https://example.com" });
    expect(draft.body).not.toContain("!["); // no image markdown
  });

  it("screenshot + imageBaseUrl → image in body", () => {
    const rec = {
      ...baseRecord,
      screenshot: { r2_key: "feedback/2025/06/fb_test_001.jpg", mime: "image/jpeg", size: 12345 },
    };
    const draft = buildIssueDraft(rec, { imageBaseUrl: "https://example.com" });
    expect(draft.body).toContain("Screenshot:");
    expect(draft.body).toContain(
      "![Screenshot](https://example.com/api/feedback/image?id=fb_test_001)"
    );
  });

  it("screenshot without imageBaseUrl → no image in body", () => {
    const rec = {
      ...baseRecord,
      screenshot: { r2_key: "feedback/2025/06/fb_test_001.jpg", mime: "image/jpeg", size: 12345 },
    };
    const draft = buildIssueDraft(rec, {});
    expect(draft.body).not.toContain("!["); // no imageBaseUrl provided
  });

  it("markerNonce is passed to marker", () => {
    const draft = buildIssueDraft(baseRecord, { markerNonce: "system-auto" });
    expect(draft.marker).toContain(":system-auto");
  });

  it("named_user reporter shows in body", () => {
    const rec = {
      ...baseRecord,
      reporter: { type: "named_user", username: "osaka" },
    };
    const draft = buildIssueDraft(rec);
    expect(draft.body).toContain("Reporter: osaka");
  });

  it("anonymous_user reporter shows in body", () => {
    const rec = {
      ...baseRecord,
      reporter: { type: "anonymous_user" },
    };
    const draft = buildIssueDraft(rec);
    expect(draft.body).toContain("Reporter: anonymous_user");
  });
});

// ============================================================
// buildIssueDraftUrl
// ============================================================
describe("buildIssueDraftUrl", () => {
  it("builds GitHub new-issue URL with correct params", () => {
    const draft = {
      title: "Test Title",
      body: "Test body content",
      labels: ["feedback", "bug"],
    };
    const url = buildIssueDraftUrl(
      { owner: "OsakaLOOP", repo: "RailRound" },
      draft
    );
    expect(url).toContain("github.com/OsakaLOOP/RailRound/issues/new");
    expect(url).toContain("title=Test+Title");
    expect(url).toContain("body=Test+body+content");
    expect(url).toContain("labels=feedback%2Cbug");
  });
});

// ============================================================
// normalizeIssueLabels
// ============================================================
describe("normalizeIssueLabels", () => {
  it("extracts label strings from objects", () => {
    const issue = {
      labels: [
        { name: "feedback", color: "blue" },
        { name: "bug", color: "red" },
      ],
    };
    expect(normalizeIssueLabels(issue)).toEqual(["feedback", "bug"]);
  });

  it("handles string labels", () => {
    expect(normalizeIssueLabels({ labels: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("empty → []", () => {
    expect(normalizeIssueLabels({})).toEqual([]);
    expect(normalizeIssueLabels(null)).toEqual([]);
  });
});

// ============================================================
// normalizeIssueState
// ============================================================
describe("normalizeIssueState", () => {
  it("open → open", () => expect(normalizeIssueState("open")).toBe("open"));
  it("closed → closed", () => expect(normalizeIssueState("closed")).toBe("closed"));
  it("other → null", () => expect(normalizeIssueState("locked")).toBeNull());
  it("null → null", () => expect(normalizeIssueState(null)).toBeNull());
});

// ============================================================
// buildHookSuccessFromIssue
// ============================================================
describe("buildHookSuccessFromIssue", () => {
  const issue = {
    number: 42,
    state: "open",
    title: "Fix map crash",
    labels: [{ name: "bug" }],
    updated_at: "2025-06-15T12:00:00Z",
    html_url: "https://github.com/O/R/issues/42",
  };

  it("builds success hook from issue", () => {
    const hook = buildHookSuccessFromIssue(issue);
    expect(hook.provider).toBe("github_issue");
    expect(hook.status).toBe("success");
    expect(hook.issue_number).toBe(42);
    expect(hook.issue_state).toBe("open");
    expect(hook.issue_title).toBe("Fix map crash");
    expect(hook.issue_labels).toEqual(["bug"]);
    expect(hook.issue_url).toBe("https://github.com/O/R/issues/42");
    expect(hook.last_comment).toBeNull();
    expect(hook.error).toBeNull();
  });

  it("accepts overrides", () => {
    const hook = buildHookSuccessFromIssue(issue, { issue_match_mode: "marker" } as any);
    expect(hook.issue_match_mode).toBe("marker");
  });

  it("handles null/undefined gracefully", () => {
    const hook = buildHookSuccessFromIssue(null);
    expect(hook.status).toBe("success");
    expect(hook.issue_number).toBeNull();
  });
});

// ============================================================
// isIssueLabelSuperset
// ============================================================
describe("isIssueLabelSuperset", () => {
  it("true when all expected labels present", () => {
    expect(isIssueLabelSuperset(["a", "b", "c"], ["a", "c"])).toBe(true);
  });
  it("false when expected label missing", () => {
    expect(isIssueLabelSuperset(["a", "b"], ["a", "c"])).toBe(false);
  });
  it("true for empty expected", () => {
    expect(isIssueLabelSuperset(["a", "b"], [])).toBe(true);
    expect(isIssueLabelSuperset(["a", "b"], null)).toBe(true);
  });
  it("false when issue has no labels", () => {
    expect(isIssueLabelSuperset([], ["a"])).toBe(false);
  });
});

// ============================================================
// toIssueListItem
// ============================================================
describe("toIssueListItem", () => {
  it("converts raw issue to item", () => {
    const raw = {
      number: 1,
      title: "Test",
      body: "body text",
      state: "open",
      html_url: "https://github.com/O/R/issues/1",
      updated_at: "2025-01-01T00:00:00Z",
      created_at: "2025-01-01T00:00:00Z",
      user: { login: "tester" },
      labels: [{ name: "bug" }],
    };
    const item = toIssueListItem(raw);
    expect(item).not.toBeNull();
    expect(item!.number).toBe(1);
    expect(item!.user_login).toBe("tester");
    expect(item!.labels).toEqual(["bug"]);
  });

  it("filters out pull requests", () => {
    const raw = { number: 1, pull_request: {} };
    expect(toIssueListItem(raw)).toBeNull();
  });

  it("null → null", () => {
    expect(toIssueListItem(null)).toBeNull();
  });
});

// ============================================================
// makeReadableError
// ============================================================
describe("makeReadableError", () => {
  it("extracts message from Error", () => {
    expect(makeReadableError(new Error("test error"))).toBe("test error");
  });
  it("clips long messages", () => {
    expect(makeReadableError(new Error("x".repeat(600)), 100)).toHaveLength(100);
  });
  it("handles non-Error", () => {
    expect(makeReadableError("raw string")).toBe("raw string");
  });
});

// ============================================================
// getIssueTicketSecret
// ============================================================
describe("getIssueTicketSecret", () => {
  it("returns custom secret when set", () => {
    expect(getIssueTicketSecret({ FEEDBACK_GITHUB_TICKET_SECRET: "custom" })).toBe("custom");
  });
  it("falls back to GITHUB_FEEDBACK_TOKEN", () => {
    expect(getIssueTicketSecret({ GITHUB_FEEDBACK_TOKEN: "gh_token" })).toBe("gh_token");
  });
  it("prefers custom over fallback", () => {
    expect(getIssueTicketSecret({
      FEEDBACK_GITHUB_TICKET_SECRET: "custom",
      GITHUB_FEEDBACK_TOKEN: "gh_token",
    })).toBe("custom");
  });
  it("returns empty when neither set", () => {
    expect(getIssueTicketSecret({})).toBe("");
  });
});
