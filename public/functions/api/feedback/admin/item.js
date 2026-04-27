import {
  withMethodHeaders,
  json,
  getKV,
  assertAdmin,
  hmacHex,
  getImageSigningSecret
} from "../_shared.js";

const headers = withMethodHeaders("GET, OPTIONS");
const IMAGE_TTL_MS = 5 * 60 * 1000;

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }
  if (event.request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, headers);
  }

  try {
    const DB = getKV();
    if (!DB) return json({ error: "KV Missing" }, 500, headers);

    const isAdmin = await assertAdmin(event.request, DB);
    if (!isAdmin) return json({ error: "Forbidden" }, 403, headers);

    const url = new URL(event.request.url);
    const id = (url.searchParams.get("id") || "").trim();
    if (!id) return json({ error: "Missing id" }, 400, headers);

    const raw = await DB.get(`feedback:${id}`);
    if (!raw) return json({ error: "Not found" }, 404, headers);
    const item = typeof raw === "string" ? JSON.parse(raw) : raw;

    let screenshotUrl = null;
    const r2Key = item?.screenshot?.r2_key;
    if (r2Key) {
      const secret = getImageSigningSecret(event.env);
      if (secret) {
        const expires = Date.now() + IMAGE_TTL_MS;
        const message = `${r2Key}|${expires}|${id}`;
        const sig = await hmacHex(secret, message);
        screenshotUrl = `${url.origin}/api/feedback/admin/image?id=${encodeURIComponent(id)}&key=${encodeURIComponent(r2Key)}&expires=${expires}&sig=${sig}`;
      }
    }

    const normalizedItem = {
      ...item,
      hook: {
        ...(item?.hook || {}),
        issue_match_mode: item?.hook?.issue_match_mode || null
      },
      screenshot_url: screenshotUrl
    };

    return json({ item: normalizedItem }, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Failed to fetch feedback item" }, 500, headers);
  }
}
