import {
  withMethodHeaders,
  json,
  getKV,
  assertAdmin,
  getAllFeedbackIds,
  clipText
} from "../_shared.js";

const headers = withMethodHeaders("POST, OPTIONS");
const CONCURRENCY = 3;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between re-fetches

function isRateLimitError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("insufficient fetch quota") || msg.includes("secondary rate limit");
}

function shouldSkipSync(hook) {
  if (!hook?.issue_updated_at) return false;
  const lastSync = Date.parse(String(hook.issue_updated_at));
  if (!Number.isFinite(lastSync)) return false;
  return (Date.now() - lastSync) < SYNC_COOLDOWN_MS;
}

function getGitHubConfig(env) {
  const token = String(env?.GITHUB_FEEDBACK_TOKEN || "").trim();
  const owner = String(env?.GITHUB_FEEDBACK_OWNER || "").trim();
  const repo = String(env?.GITHUB_FEEDBACK_REPO || "").trim();
  if (!token || !owner || !repo) return null;
  return { token, owner, repo };
}

async function fetchGitHubJson(url, cfg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 10000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "RailRound-FeedbackSync"
      }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(payload?.message || `GitHub API error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function toCommentPreview(commentPayload) {
  if (!commentPayload || typeof commentPayload !== "object") return null;
  const author =
    String(commentPayload?.user?.login || "").trim() ||
    String(commentPayload?.user?.name || "").trim();
  const createdAt = String(commentPayload?.created_at || "").trim();
  const body = String(commentPayload?.body || "").trim();
  if (!author || !createdAt || !body) return null;
  return { author, created_at: createdAt, body_preview: clipText(body, 300) };
}

async function fetchLatestComment(cfg, issueNumber) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues/${issueNumber}/comments?per_page=1&sort=updated&direction=desc`;
  const payload = await fetchGitHubJson(url, cfg);
  if (!Array.isArray(payload) || payload.length === 0) return null;
  return toCommentPreview(payload[0]);
}

function normalizeHookFromIssue(issue, lastComment) {
  const labels = Array.isArray(issue?.labels)
    ? issue.labels
        .map((label) => (typeof label === "string" ? label : String(label?.name || "")))
        .filter(Boolean)
    : [];
  return {
    issue_state: issue?.state === "closed" ? "closed" : "open",
    issue_title: issue?.title ? String(issue.title) : null,
    issue_labels: labels,
    issue_updated_at: issue?.updated_at ? String(issue.updated_at) : null,
    issue_url: issue?.html_url ? String(issue.html_url) : null,
    last_comment: lastComment,
    error: null
  };
}

async function syncOne(DB, key, row, cfg) {
  const issueNumber = Number(row?.hook?.issue_number);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    return { status: "skipped" };
  }

  const currentHook = row?.hook || {};

  // Skip if we fetched this issue less than 5 minutes ago
  if (shouldSkipSync(currentHook)) {
    return { status: "skipped" };
  }

  let issue;
  try {
    issue = await fetchGitHubJson(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues/${issueNumber}`,
      cfg
    );
  } catch (err) {
    if (Number(err?.status) === 404) {
      const next = {
        ...row,
        hook: {
          ...currentHook,
          provider: "github_issue",
          status: "success",
          issue_state: "deleted",
          issue_title: null,
          issue_labels: [],
          issue_updated_at: new Date().toISOString(),
          last_comment: null,
          error: null
        }
      };
      await DB.put(key, JSON.stringify(next));
      return { status: "updated" };
    }
    // Don't persist transient rate-limit errors
    if (isRateLimitError(err)) {
      return { status: "skipped" };
    }
    const next = {
      ...row,
      hook: {
        ...currentHook,
        provider: "github_issue",
        error: clipText(err?.message ? String(err.message) : String(err), 500)
      }
    };
    await DB.put(key, JSON.stringify(next));
    return { status: "failed", error: next.hook.error };
  }

  let lastComment = currentHook.last_comment ?? null;
  let commentError = null;
  try {
    lastComment = await fetchLatestComment(cfg, issueNumber);
  } catch (err) {
    // Don't persist transient rate-limit errors for comments either
    if (!isRateLimitError(err)) {
      commentError = clipText(err?.message ? String(err.message) : String(err), 500);
    }
  }

  const next = {
    ...row,
    hook: {
      ...currentHook,
      provider: "github_issue",
      ...normalizeHookFromIssue(issue, lastComment),
      error: commentError
    }
  };
  await DB.put(key, JSON.stringify(next));
  return { status: "updated" };
}

async function runConcurrent(items, worker, concurrency) {
  const results = new Array(items.length);
  let index = 0;
  async function consume() {
    while (true) {
      const cur = index;
      index += 1;
      if (cur >= items.length) return;
      results[cur] = await worker(items[cur], cur);
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => consume());
  await Promise.all(workers);
  return results;
}

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") return new Response(null, { headers });
  if (event.request.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

  try {
    const DB = getKV();
    if (!DB) return json({ error: "KV Missing" }, 500, headers);

    const isAdmin = await assertAdmin(event.request, DB);
    if (!isAdmin) return json({ error: "Forbidden" }, 403, headers);

    const cfg = getGitHubConfig(event.env);
    if (!cfg) return json({ error: "GitHub feedback hook not configured" }, 400, headers);

    const allIds = await getAllFeedbackIds(DB);
    const candidates = [];

    for (const id of allIds) {
      const key = `feedback:${id}`;
      const raw = await DB.get(key);
      if (!raw) continue;
      try {
        const row = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!row || !row.id) continue;
        const hook = row.hook || {};
        if (hook.provider !== "github_issue") continue;
        const issueNumber = Number(hook.issue_number);
        if (!Number.isFinite(issueNumber) || issueNumber <= 0) continue;
        candidates.push({ key, row });
      } catch { /* skip */ }
    }

    const scanned = candidates.length;

    const syncResults = await runConcurrent(
      candidates,
      async (entry) => syncOne(DB, entry.key, entry.row, cfg),
      CONCURRENCY
    );

    let updated = 0;
    let failed = 0;
    let skipped = 0;
    const errors = [];
    for (let i = 0; i < syncResults.length; i += 1) {
      const result = syncResults[i];
      if (result?.status === "updated") updated += 1;
      else if (result?.status === "failed") {
        failed += 1;
        errors.push({ id: candidates[i]?.row?.id || "unknown", error: result.error || "sync failed" });
      } else {
        skipped += 1;
      }
    }

    return json({ scanned, updated, failed, skipped, errors }, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Failed to sync" }, 500, headers);
  }
}
