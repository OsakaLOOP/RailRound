import {
  withMethodHeaders,
  json,
  getKV,
  getAllFeedbackIds,
  getAllFeedbackDebugDump,
  getUsernameFromAuthHeader,
  clipText
} from "./_shared.js";

const headers = withMethodHeaders("GET, OPTIONS");

function mapRow(row, imageBaseUrl) {
  const r2Key = row.screenshot?.r2_key;
  return {
    id: row.id,
    created_at: row.created_at,
    category: row.category,
    error_module: row.error_module || null,
    content_preview: clipText(row.content || "", 160),
    reporter: row.reporter || { type: "unknown" },
    hook: {
      status: row.hook?.status || "pending",
      issue_number: Number.isFinite(Number(row.hook?.issue_number)) ? Number(row.hook.issue_number) : null,
      issue_state: row.hook?.issue_state || null,
      issue_title: row.hook?.issue_title || null,
      issue_url: row.hook?.issue_url || null,
      issue_labels: Array.isArray(row.hook?.issue_labels) ? row.hook.issue_labels : [],
      issue_updated_at: row.hook?.issue_updated_at || null
    },
    has_screenshot: Boolean(r2Key),
    screenshot_url: r2Key && imageBaseUrl
      ? `${imageBaseUrl}/api/feedback/image?id=${encodeURIComponent(row.id)}`
      : null
  };
}

async function fetchRecordsByIds(DB, ids, imageBaseUrl) {
  const results = [];
  for (const id of ids) {
    const raw = await DB.get(`feedback:${id}`);
    if (!raw) continue;
    try {
      const row = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (row && row.id) results.push(mapRow(row, imageBaseUrl));
    } catch { /* skip */ }
  }
  return results;
}

async function fetchRecordsByUsername(DB, username, imageBaseUrl) {
  const allIds = await getAllFeedbackIds(DB);
  const results = [];
  for (const id of allIds) {
    const raw = await DB.get(`feedback:${id}`);
    if (!raw) continue;
    try {
      const row = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!row || !row.id) continue;
      const reporter = row.reporter || {};
      if (reporter.username === username) {
        results.push(mapRow(row, imageBaseUrl));
      }
    } catch { /* skip */ }
  }
  return results;
}

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") return new Response(null, { headers });
  if (event.request.method !== "GET") return json({ error: "Method not allowed" }, 405, headers);

  try {
    const DB = getKV();
    if (!DB) return json({ error: "KV Missing" }, 500, headers);

    const url = new URL(event.request.url);
    const isDebug = url.searchParams.get("debug") === "1";

    let debugDump = null;
    if (isDebug) {
      debugDump = await getAllFeedbackDebugDump(DB);
    }

    const imageBaseUrl = new URL(event.request.url).origin;
    const rawIds = url.searchParams.get("ids");
    const username = await getUsernameFromAuthHeader(event.request, DB);
    const seen = new Set();
    const merged = [];

    function add(items) {
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
      }
    }

    // Look up by explicit IDs (guest + anonymous_user persistence)
    if (rawIds) {
      const ids = rawIds.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
      add(await fetchRecordsByIds(DB, ids, imageBaseUrl));
    }

    // Look up by username (named_user submissions)
    if (username) {
      add(await fetchRecordsByUsername(DB, username, imageBaseUrl));
    }

    // If neither path has any criteria, require login
    if (!rawIds && !username) {
      return json({ error: "Login required" }, 401, headers);
    }

    merged.sort((a, b) => (String(b.created_at || "")).localeCompare(String(a.created_at || "")));

    const payload = { issues: merged, has_more: false };
    if (debugDump) payload._debug = debugDump;
    return json(payload, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Internal error" }, 500, headers);
  }
}
