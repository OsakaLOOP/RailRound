import {
  withMethodHeaders,
  json,
  getKV,
  getUsernameFromAuthHeader,
  clipText
} from "../_shared.js";
import { verifyIssueTicket } from "../submit.js";
import {
  getGitHubConfig,
  buildIssueDraft,
  buildIssueBodyHash,
  fetchGitHubJson,
  buildHookSuccessFromIssue,
  toIssueListItem,
  isIssueLabelSuperset,
  makeIssueNotFoundError,
  makeReadableError
} from "../_github.js";

const headers = withMethodHeaders("POST, OPTIONS");
const FALLBACK_TIME_WINDOW_MS = 2 * 60 * 60 * 1000;
const FALLBACK_LIST_LIMIT = 50;

async function updateHook(DB, feedbackId, patch) {
  const key = `feedback:${feedbackId}`;
  const raw = await DB.get(key);
  if (!raw) {
    throw new Error("feedback_not_found");
  }
  const row = typeof raw === "string" ? JSON.parse(raw) : raw;
  const next = {
    ...row,
    hook: {
      ...(row.hook || {}),
      ...patch
    }
  };
  await DB.put(key, JSON.stringify(next));
  return next;
}

function isInsideWindow(issueCreatedAt, targetCreatedAtIso) {
  const issueMs = Date.parse(String(issueCreatedAt || ""));
  const targetMs = Date.parse(String(targetCreatedAtIso || ""));
  if (!Number.isFinite(issueMs) || !Number.isFinite(targetMs)) return false;
  return Math.abs(issueMs - targetMs) <= FALLBACK_TIME_WINDOW_MS;
}

function bodyContainsMarker(issueBody, marker) {
  const body = String(issueBody || "");
  const m = String(marker || "").trim();
  if (!m) return false;
  return body.includes(m);
}

async function findIssueByMarker(cfg, marker, feedbackId, githubLogin) {
  const q = encodeURIComponent(`repo:${cfg.owner}/${cfg.repo} is:issue ${feedbackId} ${githubLogin}`);
  const url = `https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=30`;
  const payload = await fetchGitHubJson(url, cfg, { userAgent: "RailRound-FeedbackConfirm" });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  for (const raw of items) {
    const issue = toIssueListItem(raw);
    if (!issue) continue;
    if (issue.user_login !== githubLogin) continue;
    if (bodyContainsMarker(issue.body, marker)) {
      return issue.raw;
    }
  }
  return null;
}

async function findIssueByFallback(cfg, record, githubLogin, expectedLabels) {
  const expected = buildIssueDraft(record).title;
  const listUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues?state=all&creator=${encodeURIComponent(githubLogin)}&per_page=${FALLBACK_LIST_LIMIT}&sort=created&direction=desc`;
  const payload = await fetchGitHubJson(listUrl, cfg, { userAgent: "RailRound-FeedbackConfirm" });
  const items = Array.isArray(payload) ? payload : [];

  for (const raw of items) {
    const issue = toIssueListItem(raw);
    if (!issue) continue;
    if (issue.user_login !== githubLogin) continue;
    if (issue.title !== expected) continue;
    if (!isInsideWindow(issue.created_at, record.created_at)) continue;
    if (!isIssueLabelSuperset(issue.labels, expectedLabels)) continue;
    return issue.raw;
  }

  return null;
}

function isAfterIssueTimeWindowStart(issueCreatedAt, issuedAtIso) {
  const issueMs = Date.parse(String(issueCreatedAt || ""));
  const issuedMs = Date.parse(String(issuedAtIso || ""));
  if (!Number.isFinite(issueMs) || !Number.isFinite(issuedMs)) return false;
  if (issueMs < issuedMs) return false;
  return issueMs - issuedMs <= FALLBACK_TIME_WINDOW_MS;
}

async function findLatestIssueByUserWindow(cfg, githubLogin, issuedAtIso) {
  const listUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues?state=all&creator=${encodeURIComponent(githubLogin)}&per_page=${FALLBACK_LIST_LIMIT}&sort=created&direction=desc`;
  const payload = await fetchGitHubJson(listUrl, cfg, { userAgent: "RailRound-FeedbackConfirm" });
  const items = Array.isArray(payload) ? payload : [];
  for (const raw of items) {
    const issue = toIssueListItem(raw);
    if (!issue) continue;
    if (issue.user_login !== githubLogin) continue;
    if (!isAfterIssueTimeWindowStart(issue.created_at, issuedAtIso)) continue;
    return issue.raw;
  }
  return null;
}

function buildFailedPatch(errorText, currentHook) {
  return {
    provider: "github_issue",
    status: "failed",
    issue_state: currentHook?.issue_state ?? null,
    issue_match_mode: currentHook?.issue_match_mode || null,
    error: clipText(errorText, 500)
  };
}

function buildDeletedPatch(currentHook) {
  return {
    provider: "github_issue",
    status: "success",
    issue_number: Number.isFinite(Number(currentHook?.issue_number))
      ? Number(currentHook.issue_number)
      : null,
    issue_url: currentHook?.issue_url || null,
    issue_state: "deleted",
    issue_title: null,
    issue_labels: [],
    issue_updated_at: null,
    last_comment: null,
    error: null
  };
}

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }
  if (event.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, headers);
  }

  const DB = getKV();
  if (!DB) return json({ error: "KV Missing" }, 500, headers);

  try {
    const body = await event.request.json().catch(() => ({}));
    const ticket = String(body?.ticket || "").trim();
    if (!ticket) {
      return json({ error: "Missing ticket" }, 400, headers);
    }

    const ticketData = await verifyIssueTicket(ticket, event.env);
    const authUser = await getUsernameFromAuthHeader(event.request, DB);
    if (!authUser || authUser !== String(ticketData.username || "")) {
      return json({ error: "Forbidden" }, 403, headers);
    }

    const feedbackId = String(ticketData.feedback_id || "");
    const githubLogin = String(ticketData.github_login || "");
    if (!feedbackId || !githubLogin) {
      throw new Error("invalid_ticket_payload");
    }

    const key = `feedback:${feedbackId}`;
    const raw = await DB.get(key);
    if (!raw) {
      return json({ error: "feedback_not_found" }, 404, headers);
    }
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    const hook = record?.hook || {};

    const cfg = getGitHubConfig(event.env);
    if (!cfg) {
      const failed = await updateHook(DB, feedbackId, buildFailedPatch("GitHub feedback hook not configured", hook));
      return json({ ok: false, hook: failed.hook }, 200, headers);
    }

    const imageBaseUrl = new URL(event.request.url).origin;
    const draft = buildIssueDraft(record, { markerNonce: ticketData.nonce, imageBaseUrl });
    const computedHash = await buildIssueBodyHash(draft.body);
    const expectedHash = String(ticketData.body_hash || "");
    if (!expectedHash || computedHash !== expectedHash) {
      const failed = await updateHook(DB, feedbackId, buildFailedPatch("invalid_body_hash", hook));
      return json({ ok: false, hook: failed.hook }, 200, headers);
    }

    let issue = null;
    let matchMode = null;
    try {
      issue = await findIssueByMarker(cfg, String(ticketData.marker || ""), feedbackId, githubLogin);
      if (issue) matchMode = "marker";
      if (!issue) {
        issue = await findIssueByFallback(cfg, record, githubLogin, ticketData.labels || []);
        if (issue) matchMode = "fallback";
      }
      if (!issue) {
        issue = await findLatestIssueByUserWindow(cfg, githubLogin, ticketData.created_at);
        if (issue) matchMode = "fallback_latest";
      }
    } catch (err) {
      const failed = await updateHook(DB, feedbackId, buildFailedPatch(makeReadableError(err), hook));
      return json({ ok: false, hook: failed.hook }, 200, headers);
    }

    if (!issue) {
      const failed = await updateHook(DB, feedbackId, {
        ...buildFailedPatch(makeIssueNotFoundError(), hook),
        issue_match_mode: null
      });
      return json({ ok: false, hook: failed.hook }, 200, headers);
    }

    const issueNumber = Number(issue?.number || 0);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      const failed = await updateHook(DB, feedbackId, buildFailedPatch("invalid_issue_number", hook));
      return json({ ok: false, hook: failed.hook }, 200, headers);
    }

    try {
      const latest = await fetchGitHubJson(
        `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues/${issueNumber}`,
        cfg,
        { userAgent: "RailRound-FeedbackConfirm" }
      );
      const success = await updateHook(DB, feedbackId, {
        ...buildHookSuccessFromIssue(latest),
        issue_submit_mode: "github_user_manual",
        issue_match_mode: matchMode,
        error: null
      });
      return json({ ok: true, hook: success.hook }, 200, headers);
    } catch (err) {
      if (Number(err?.status) === 404) {
        const deleted = await updateHook(DB, feedbackId, {
          ...buildDeletedPatch(hook),
          issue_submit_mode: "github_user_manual",
          issue_match_mode: matchMode
        });
        return json({ ok: true, hook: deleted.hook }, 200, headers);
      }
      const failed = await updateHook(DB, feedbackId, {
        ...buildFailedPatch(makeReadableError(err), hook),
        issue_submit_mode: "github_user_manual",
        issue_match_mode: matchMode
      });
      return json({ ok: false, hook: failed.hook }, 200, headers);
    }
  } catch (err) {
    return json({ error: makeReadableError(err) || "Failed to confirm issue" }, 400, headers);
  }
}
