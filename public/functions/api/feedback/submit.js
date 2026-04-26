import {
  withMethodHeaders,
  json,
  getKV,
  putFeedbackObject,
  getEnv,
  getUsernameFromAuthHeader,
  clipText,
  getMimeExtension,
  getIssueCategoryLabel,
  getReporterLabel
} from "./_shared.js";

const headers = withMethodHeaders("POST, OPTIONS");
const MAX_CONTENT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_CATEGORIES = new Set(["error", "suggestion"]);
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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

async function createGitHubIssue(record) {
  const token =
    getEnv("GITHUB_FEEDBACK_TOKEN") ||
    getEnv("GITHUB_TOKEN") ||
    getEnv("GH_TOKEN");
  const owner =
    getEnv("GITHUB_FEEDBACK_OWNER") ||
    getEnv("GITHUB_OWNER");
  const repo =
    getEnv("GITHUB_FEEDBACK_REPO") ||
    getEnv("GITHUB_REPO");
  if (!token || !owner || !repo) {
    throw new Error("GitHub feedback hook not configured");
  }

  const title = `[Feedback][${record.category}] ${record.id}`;
  const issueBody = [
    `Feedback ID: ${record.id}`,
    `Category: ${getIssueCategoryLabel(record.category)} (${record.category})`,
    `Reporter: ${getReporterLabel(record.reporter)}`,
    `Include Identity: ${record.include_identity ? "true" : "false"}`,
    `Has Screenshot: ${record.screenshot ? "true" : "false"}`,
    `Created At: ${record.created_at}`,
    "",
    "Content:",
    record.content,
    "",
    "Client Meta:",
    "```json",
    JSON.stringify(record.client_meta || {}, null, 2),
    "```"
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 10000);
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "RailRound-FeedbackHook",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels: ["feedback", `feedback:${record.category}`]
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.message || `GitHub API error ${res.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function runGitHubHook(DB, feedbackId) {
  try {
    const raw = await DB.get(`feedback:${feedbackId}`);
    if (!raw) return;
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    const issue = await createGitHubIssue(record);
    await updateHookStatus(DB, feedbackId, {
      provider: "github_issue",
      status: "success",
      issue_url: issue?.html_url || null,
      error: null
    });
  } catch (err) {
    const msg = err?.message ? String(err.message) : String(err);
    await updateHookStatus(DB, feedbackId, {
      provider: "github_issue",
      status: "failed",
      error: clipText(msg, 500)
    });
  }
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
    const category = String(formData.get("category") || "").trim();
    const contentRaw = String(formData.get("content") || "");
    const includeIdentityRaw = String(formData.get("includeIdentity") || "false");
    const includeIdentity = includeIdentityRaw === "true" || includeIdentityRaw === "1";
    const content = contentRaw.trim();

    if (!ALLOWED_CATEGORIES.has(category)) {
      return json({ error: "Invalid category" }, 400, headers);
    }
    if (!content) {
      return json({ error: "Missing content" }, 400, headers);
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return json({ error: "Content too long" }, 400, headers);
    }

    const username = await getUsernameFromAuthHeader(event.request, DB);
    const reporter = !username
      ? { type: "guest" }
      : includeIdentity
      ? { type: "named_user", username }
      : { type: "anonymous_user" };

    let screenshot = null;
    const maybeScreenshot = formData.get("screenshot");
    if (maybeScreenshot && typeof maybeScreenshot === "object" && typeof maybeScreenshot.arrayBuffer === "function") {
      const mime = maybeScreenshot.type || "application/octet-stream";
      const size = Number(maybeScreenshot.size || 0);
      if (!ALLOWED_IMAGE_MIME.has(mime)) {
        return json({ error: "Invalid screenshot mime type" }, 400, headers);
      }
      if (size <= 0 || size > MAX_IMAGE_BYTES) {
        return json({ error: "Screenshot exceeds size limit" }, 400, headers);
      }

      const feedbackId = `fb_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const ext = getMimeExtension(mime);
      const r2Key = `feedback/${yyyy}/${mm}/${feedbackId}.${ext}`;
      const body = await maybeScreenshot.arrayBuffer();
      await putFeedbackObject(r2Key, body, mime);

      const createdAt = now.toISOString();
      const record = {
        id: feedbackId,
        created_at: createdAt,
        category,
        content,
        include_identity: includeIdentity,
        reporter,
        screenshot: { r2_key: r2Key, mime, size },
        client_meta: {
          ua: clipText(event.request.headers.get("User-Agent") || "", 500),
          lang: clipText(String(formData.get("lang") || ""), 64),
          path: clipText(String(formData.get("path") || ""), 500),
          app_version: clipText(String(formData.get("appVersion") || ""), 64)
        },
        hook: {
          provider: "github_issue",
          status: "pending"
        }
      };

      await DB.put(`feedback:${feedbackId}`, JSON.stringify(record));
      const hookPromise = runGitHubHook(DB, feedbackId);
      if (typeof event.waitUntil === "function") {
        event.waitUntil(hookPromise);
      } else {
        hookPromise.catch(() => undefined);
      }

      return json({ success: true, id: feedbackId, hook_status: "pending" }, 200, headers);
    }

    const feedbackId = `fb_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    const record = {
      id: feedbackId,
      created_at: createdAt,
      category,
      content,
      include_identity: includeIdentity,
      reporter,
      screenshot,
      client_meta: {
        ua: clipText(event.request.headers.get("User-Agent") || "", 500),
        lang: clipText(String(formData.get("lang") || ""), 64),
        path: clipText(String(formData.get("path") || ""), 500),
        app_version: clipText(String(formData.get("appVersion") || ""), 64)
      },
      hook: {
        provider: "github_issue",
        status: "pending"
      }
    };

    await DB.put(`feedback:${feedbackId}`, JSON.stringify(record));
    const hookPromise = runGitHubHook(DB, feedbackId);
    if (typeof event.waitUntil === "function") {
      event.waitUntil(hookPromise);
    } else {
      hookPromise.catch(() => undefined);
    }

    return json({ success: true, id: feedbackId, hook_status: "pending" }, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Submit failed" }, 500, headers);
  }
}
