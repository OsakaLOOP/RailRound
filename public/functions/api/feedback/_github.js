import {
  clipText,
  getIssueCategoryLabel,
  getReporterLabel,
  sha256Hex
} from "./_shared.js";

const ISSUE_MARKER_PREFIX = "railround-feedback-marker";

export function getGitHubConfig(env) {
  const token = String(env?.GITHUB_FEEDBACK_TOKEN || "").trim();
  const owner = String(env?.GITHUB_FEEDBACK_OWNER || "").trim();
  const repo = String(env?.GITHUB_FEEDBACK_REPO || "").trim();
  if (!token || !owner || !repo) return null;
  return { token, owner, repo };
}

export function getIssueTicketSecret(env) {
  return String(env?.FEEDBACK_GITHUB_TICKET_SECRET || env?.GITHUB_FEEDBACK_TOKEN || "").trim();
}

export function formatUtcForTitle(isoTime) {
  const date = new Date(isoTime || Date.now());
  if (Number.isNaN(date.getTime())) return "unknown-time";
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

export function buildIssueMarker(feedbackId, nonce = "") {
  const cleanId = String(feedbackId || "").trim();
  const cleanNonce = String(nonce || "").trim();
  if (!cleanId) return "";
  return cleanNonce
    ? `<!-- ${ISSUE_MARKER_PREFIX}:${cleanId}:${cleanNonce} -->`
    : `<!-- ${ISSUE_MARKER_PREFIX}:${cleanId} -->`;
}

export function buildIssueDraft(record, options = {}) {
  const titleTime = formatUtcForTitle(record?.created_at);
  const modulePart =
    record?.category === "error" && record?.error_module
      ? `[${record.error_module}]`
      : "";
  const title = `[Feedback][${record?.category || "unknown"}]${modulePart}[${titleTime}]`;
  const marker = buildIssueMarker(record?.id, options.markerNonce);

  const bodyLines = [
    marker,
    `Feedback ID: ${record?.id || "unknown"}`,
    `Category: ${getIssueCategoryLabel(record?.category)} (${record?.category || "unknown"})`,
    `Error Module: ${record?.error_module || "n/a"}`,
    `Reporter: ${getReporterLabel(record?.reporter)}`,
    `Include Identity: ${record?.include_identity ? "true" : "false"}`,
    `Has Screenshot: ${record?.screenshot ? "true" : "false"}`,
    `Created At: ${record?.created_at || ""}`,
    "",
    "Content:",
    String(record?.content || ""),
    "",
    "Client Meta:",
    "```json",
    JSON.stringify(record?.client_meta || {}, null, 2),
    "```"
  ];

  if (record?.screenshot?.r2_key && options.imageBaseUrl) {
    const imgUrl = `${options.imageBaseUrl}/api/feedback/image?id=${encodeURIComponent(record.id)}`;
    bodyLines.push("", "Screenshot:", `![Screenshot](${imgUrl})`);
  }

  const body = bodyLines.join("\n");
  const labels = [
    "feedback",
    `feedback:${record?.category || "unknown"}`,
    ...(record?.category === "error" && record?.error_module
      ? [`feedback:module:${record.error_module}`]
      : [])
  ];

  return { title, body, labels, marker };
}

export async function buildIssueBodyHash(issueBody) {
  return await sha256Hex(String(issueBody || ""));
}

export function buildIssueDraftUrl(cfg, draft) {
  const params = new URLSearchParams();
  params.set("title", String(draft?.title || ""));
  params.set("body", String(draft?.body || ""));
  if (Array.isArray(draft?.labels) && draft.labels.length > 0) {
    params.set("labels", draft.labels.join(","));
  }
  return `https://github.com/${cfg.owner}/${cfg.repo}/issues/new?${params.toString()}`;
}

export async function fetchGitHubJson(url, cfg, options = {}) {
  const method = options.method || "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 10000);
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": options.userAgent || "RailRound-FeedbackHook"
    };
    if (cfg?.token) {
      headers.Authorization = `Bearer ${cfg.token}`;
    }
    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
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

export async function createGitHubIssueFromDraft(record, cfg, options = {}) {
  const draft = buildIssueDraft(record, options);
  const payload = await fetchGitHubJson(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues`,
    cfg,
    {
      method: "POST",
      body: {
        title: draft.title,
        body: draft.body,
        labels: draft.labels
      },
      userAgent: "RailRound-FeedbackHook"
    }
  );
  return { issue: payload, draft };
}

export function normalizeIssueLabels(issue) {
  return Array.isArray(issue?.labels)
    ? issue.labels
        .map((label) => (typeof label === "string" ? label : String(label?.name || "")))
        .filter(Boolean)
    : [];
}

export function normalizeIssueState(issueStateRaw) {
  if (issueStateRaw === "closed") return "closed";
  if (issueStateRaw === "open") return "open";
  return null;
}

export function buildHookSuccessFromIssue(issue, overrides = {}) {
  return {
    provider: "github_issue",
    status: "success",
    issue_number: Number.isFinite(Number(issue?.number)) ? Number(issue.number) : null,
    issue_state: normalizeIssueState(issue?.state),
    issue_title: issue?.title ? String(issue.title) : null,
    issue_labels: normalizeIssueLabels(issue),
    issue_updated_at: issue?.updated_at ? String(issue.updated_at) : null,
    issue_url: issue?.html_url ? String(issue.html_url) : null,
    last_comment: null,
    error: null,
    ...overrides
  };
}

export function isIssueLabelSuperset(issueLabels, expectedLabels) {
  if (!Array.isArray(expectedLabels) || expectedLabels.length === 0) return true;
  const labelSet = new Set((Array.isArray(issueLabels) ? issueLabels : []).map((x) => String(x)));
  return expectedLabels.every((x) => labelSet.has(String(x)));
}

export function toIssueListItem(issue) {
  if (!issue || typeof issue !== "object") return null;
  const pullRequest = issue.pull_request;
  if (pullRequest) return null;
  return {
    number: Number(issue.number || 0),
    title: issue.title ? String(issue.title) : "",
    body: issue.body ? String(issue.body) : "",
    state: issue.state ? String(issue.state) : "",
    html_url: issue.html_url ? String(issue.html_url) : "",
    updated_at: issue.updated_at ? String(issue.updated_at) : "",
    created_at: issue.created_at ? String(issue.created_at) : "",
    user_login: issue?.user?.login ? String(issue.user.login) : "",
    labels: normalizeIssueLabels(issue),
    raw: issue
  };
}

export function makeIssueNotFoundError() {
  return "issue_not_found";
}

export function makeReadableError(err, maxLen = 500) {
  const message = err?.message ? String(err.message) : String(err || "unknown_error");
  return clipText(message, maxLen);
}
