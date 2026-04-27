import {
  withMethodHeaders,
  json,
  getKV,
  putFeedbackObject,
  getUsernameFromAuthHeader,
  hmacHex,
  secureCompareHex,
  clipText,
  getMimeExtension
} from "./_shared.js";
import {
  getGitHubConfig,
  getIssueTicketSecret,
  buildIssueDraft,
  buildIssueBodyHash,
  buildIssueDraftUrl,
  createGitHubIssueFromDraft,
  buildHookSuccessFromIssue,
  makeReadableError
} from "./_github.js";

const headers = withMethodHeaders("POST, OPTIONS");
const MAX_CONTENT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_CATEGORIES = new Set(["error", "suggestion"]);
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_ERROR_MODULES = new Set([
  "routing",
  "map",
  "auth",
  "sync",
  "i18n",
  "ui",
  "performance",
  "other"
]);
const ALLOWED_ISSUE_SUBMIT_MODES = new Set(["system_auto", "github_user_manual"]);
const ISSUE_TICKET_TTL_MS = 15 * 60 * 1000;

function normalizeErrorModule(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return "other";
  if (!ALLOWED_ERROR_MODULES.has(value)) return null;
  return value;
}

async function updateHookStatus(DB, feedbackId, statusPatch) {
  const key = `feedback:${feedbackId}`;
  const raw = await DB.get(key);
  if (!raw) return;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const next = {
    ...data,
    hook: {
      ...(data.hook || {}),
      ...statusPatch
    }
  };
  await DB.put(key, JSON.stringify(next));
}

async function getUserProfile(DB, username) {
  if (!username) return null;
  const raw = await DB.get(`user:${username}`);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function buildDefaultHook(issueSubmitMode) {
  return {
    provider: "github_issue",
    status: "pending",
    issue_submit_mode: issueSubmitMode,
    issue_match_mode: null,
    issue_number: null,
    issue_state: null,
    issue_title: null,
    issue_labels: [],
    issue_updated_at: null,
    last_comment: null,
    issue_url: null,
    error: null
  };
}

function buildClientMeta(request, formData) {
  return {
    ua: clipText(request.headers.get("User-Agent") || "", 500),
    lang: clipText(String(formData.get("lang") || ""), 64),
    path: clipText(String(formData.get("path") || ""), 500),
    app_version: clipText(String(formData.get("appVersion") || ""), 64)
  };
}

async function runGitHubHook(DB, feedbackId, env) {
  try {
    const raw = await DB.get(`feedback:${feedbackId}`);
    if (!raw) return;
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    const cfg = getGitHubConfig(env);
    if (!cfg) {
      throw new Error("GitHub feedback hook not configured");
    }
    const { issue } = await createGitHubIssueFromDraft(record, cfg, {
      markerNonce: "system-auto"
    });
    await updateHookStatus(DB, feedbackId, {
      ...buildHookSuccessFromIssue(issue),
      issue_submit_mode: "system_auto",
      issue_match_mode: "marker"
    });
  } catch (err) {
    await updateHookStatus(DB, feedbackId, {
      provider: "github_issue",
      status: "failed",
      issue_submit_mode: "system_auto",
      error: makeReadableError(err)
    });
  }
}

async function signTicketPayload(payload, secret) {
  const stablePayload = {
    feedback_id: payload.feedback_id,
    username: payload.username,
    github_login: payload.github_login,
    body_hash: payload.body_hash,
    marker: payload.marker,
    labels: Array.isArray(payload.labels) ? payload.labels : [],
    created_at: payload.created_at,
    expires_at: payload.expires_at,
    nonce: payload.nonce
  };
  const message = JSON.stringify(stablePayload);
  const signature = await hmacHex(secret, message);
  const ticketObject = { ...stablePayload, signature };
  return btoa(unescape(encodeURIComponent(JSON.stringify(ticketObject))));
}

async function createManualIssueTicket(record, username, githubLogin, env) {
  const cfg = getGitHubConfig(env);
  if (!cfg) {
    throw new Error("GitHub feedback hook not configured");
  }

  const nonce = crypto.randomUUID();
  const issueDraft = buildIssueDraft(record, { markerNonce: nonce });
  const bodyHash = await buildIssueBodyHash(issueDraft.body);
  const now = Date.now();
  const issuedAtIso = new Date(now).toISOString();
  const expiresAt = now + ISSUE_TICKET_TTL_MS;
  const secret = getIssueTicketSecret(env);
  if (!secret) {
    throw new Error("GitHub ticket signing secret missing");
  }

  const ticket = await signTicketPayload(
    {
      feedback_id: record.id,
      username,
      github_login: githubLogin,
      body_hash: bodyHash,
      marker: issueDraft.marker,
      labels: issueDraft.labels,
      created_at: issuedAtIso,
      expires_at: expiresAt,
      nonce
    },
    secret
  );

  const draftUrl = buildIssueDraftUrl(cfg, issueDraft);

  return {
    ticket,
    draftUrl,
    bodyHash,
    marker: issueDraft.marker,
    issueDraft,
    expiresAt
  };
}

function decodeTicket(ticket) {
  try {
    const json = decodeURIComponent(escape(atob(String(ticket || ""))));
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function verifyTicketSignature(ticketObject, secret) {
  if (!ticketObject || !secret) return false;
  const expectedPayload = {
    feedback_id: ticketObject.feedback_id,
    username: ticketObject.username,
    github_login: ticketObject.github_login,
    body_hash: ticketObject.body_hash,
    marker: ticketObject.marker,
    labels: Array.isArray(ticketObject.labels) ? ticketObject.labels : [],
    created_at: ticketObject.created_at,
    expires_at: ticketObject.expires_at,
    nonce: ticketObject.nonce
  };
  const message = JSON.stringify(expectedPayload);
  const expectedSig = await hmacHex(secret, message);
  return secureCompareHex(expectedSig, String(ticketObject.signature || ""));
}

export async function verifyIssueTicket(ticket, env) {
  const decoded = decodeTicket(ticket);
  if (!decoded) {
    throw new Error("invalid_ticket");
  }

  const secret = getIssueTicketSecret(env);
  if (!secret) {
    throw new Error("ticket_secret_missing");
  }

  const ok = await verifyTicketSignature(decoded, secret);
  if (!ok) {
    throw new Error("invalid_ticket_signature");
  }

  const expires = Number(decoded.expires_at || 0);
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    throw new Error("ticket_expired");
  }

  return decoded;
}

async function buildRecordFromFormData(event, formData, reporter, issueSubmitMode) {
  const category = String(formData.get("category") || "").trim();
  const contentRaw = String(formData.get("content") || "");
  const includeIdentityRaw = String(formData.get("includeIdentity") || "false");
  const includeIdentity = includeIdentityRaw === "true" || includeIdentityRaw === "1";
  const content = contentRaw.trim();
  const errorModuleRaw = formData.get("errorModule");

  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error("Invalid category");
  }
  if (!content) {
    throw new Error("Missing content");
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error("Content too long");
  }

  const errorModule = category === "error" ? normalizeErrorModule(errorModuleRaw) : null;
  if (category === "error" && !errorModule) {
    throw new Error("Invalid error module");
  }

  const feedbackId = `fb_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  let screenshot = null;

  const maybeScreenshot = formData.get("screenshot");
  if (maybeScreenshot && typeof maybeScreenshot === "object" && typeof maybeScreenshot.arrayBuffer === "function") {
    const mime = maybeScreenshot.type || "application/octet-stream";
    const size = Number(maybeScreenshot.size || 0);
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      throw new Error("Invalid screenshot mime type");
    }
    if (size <= 0 || size > MAX_IMAGE_BYTES) {
      throw new Error("Screenshot exceeds size limit");
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const ext = getMimeExtension(mime);
    const r2Key = `feedback/${yyyy}/${mm}/${feedbackId}.${ext}`;
    const body = await maybeScreenshot.arrayBuffer();
    await putFeedbackObject(r2Key, body, mime, event.env);
    screenshot = { r2_key: r2Key, mime, size };
  }

  return {
    id: feedbackId,
    created_at: createdAt,
    category,
    error_module: errorModule,
    content,
    include_identity: includeIdentity,
    reporter,
    screenshot,
    client_meta: buildClientMeta(event.request, formData),
    hook: buildDefaultHook(issueSubmitMode)
  };
}

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }
  if (event.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, headers);
  }

  try {
    const DB = getKV();
    if (!DB) return json({ error: "KV Missing" }, 500, headers);

    const formData = await event.request.formData();
    const issueSubmitModeRaw = String(formData.get("issue_submit_mode") || "system_auto").trim();
    const issueSubmitMode = ALLOWED_ISSUE_SUBMIT_MODES.has(issueSubmitModeRaw)
      ? issueSubmitModeRaw
      : "system_auto";

    const username = await getUsernameFromAuthHeader(event.request, DB);
    const includeIdentityRaw = String(formData.get("includeIdentity") || "false");
    const includeIdentity = includeIdentityRaw === "true" || includeIdentityRaw === "1";
    const reporter = !username
      ? { type: "guest" }
      : includeIdentity
      ? { type: "named_user", username }
      : { type: "anonymous_user" };

    let githubLogin = null;
    if (issueSubmitMode === "github_user_manual") {
      if (!username) {
        return json({ error: "Login required for github_user_manual" }, 403, headers);
      }
      const profile = await getUserProfile(DB, username);
      const bindingLogin = String(profile?.bindings?.github?.login || "").trim();
      if (!bindingLogin) {
        return json({ error: "GitHub binding required for github_user_manual" }, 403, headers);
      }
      githubLogin = bindingLogin;
    }

    const record = await buildRecordFromFormData(event, formData, reporter, issueSubmitMode);
    await DB.put(`feedback:${record.id}`, JSON.stringify(record));

    if (issueSubmitMode === "system_auto") {
      const hookPromise = runGitHubHook(DB, record.id, event.env);
      if (typeof event.waitUntil === "function") {
        event.waitUntil(hookPromise);
      } else {
        hookPromise.catch(() => undefined);
      }
      return json({ success: true, id: record.id, hook_status: "pending", issue_submit_mode: issueSubmitMode }, 200, headers);
    }

    const ticketPayload = await createManualIssueTicket(record, username, githubLogin, event.env);
    await updateHookStatus(DB, record.id, {
      provider: "github_issue",
      status: "pending",
      issue_submit_mode: "github_user_manual",
      issue_match_mode: null,
      issue_ticket_expires_at: new Date(ticketPayload.expiresAt).toISOString(),
      issue_marker: ticketPayload.marker,
      error: null
    });

    return json(
      {
        success: true,
        id: record.id,
        hook_status: "pending",
        issue_submit_mode: "github_user_manual",
        draft_url: ticketPayload.draftUrl,
        ticket: ticketPayload.ticket,
        ticket_expires_at: new Date(ticketPayload.expiresAt).toISOString()
      },
      200,
      headers
    );
  } catch (err) {
    const msg = err?.message ? String(err.message) : String(err);
    if (
      msg === "Invalid category" ||
      msg === "Missing content" ||
      msg === "Content too long" ||
      msg === "Invalid error module" ||
      msg === "Invalid screenshot mime type" ||
      msg === "Screenshot exceeds size limit"
    ) {
      return json({ error: msg }, 400, headers);
    }
    return json({ error: msg || "Submit failed" }, 500, headers);
  }
}
