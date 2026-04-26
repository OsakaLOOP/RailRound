import {
  withMethodHeaders,
  json,
  getKV,
  getFeedbackObject,
  hmacHex,
  secureCompareHex,
  getImageSigningSecret
} from "../_shared.js";

const headers = withMethodHeaders("GET, OPTIONS");

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

    const url = new URL(event.request.url);
    const id = (url.searchParams.get("id") || "").trim();
    const key = (url.searchParams.get("key") || "").trim();
    const expiresRaw = Number(url.searchParams.get("expires") || 0);
    const sig = (url.searchParams.get("sig") || "").trim();

    if (!id || !key || !expiresRaw || !sig) {
      return json({ error: "Missing signed URL parameters" }, 400, headers);
    }
    if (!Number.isFinite(expiresRaw) || Date.now() > expiresRaw) {
      return json({ error: "Signed URL expired" }, 403, headers);
    }

    const secret = getImageSigningSecret();
    if (!secret) return json({ error: "Image signing secret is not configured" }, 500, headers);

    const expectedSig = await hmacHex(secret, `${key}|${expiresRaw}|${id}`);
    if (!secureCompareHex(sig, expectedSig)) {
      return json({ error: "Invalid signature" }, 403, headers);
    }

    const raw = await DB.get(`feedback:${id}`);
    if (!raw) return json({ error: "Feedback not found" }, 404, headers);
    const item = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!item?.screenshot?.r2_key || item.screenshot.r2_key !== key) {
      return json({ error: "Screenshot mismatch" }, 403, headers);
    }

    const object = await getFeedbackObject(key);
    if (!object) return json({ error: "Image not found" }, 404, headers);

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Cache-Control", "private, max-age=60");
    responseHeaders.set("Content-Type", object.contentType || item?.screenshot?.mime || "application/octet-stream");
    if (Number.isFinite(object.size)) {
      responseHeaders.set("Content-Length", String(object.size));
    }

    return new Response(object.body, { status: 200, headers: responseHeaders });
  } catch (err) {
    return json({ error: err?.message || "Failed to load image" }, 500, headers);
  }
}
