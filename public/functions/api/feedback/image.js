import { getKV, getFeedbackObject } from "./_shared.js";

export async function onRequest(event) {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");

  if (event.request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return new Response(null, { headers });
  }

  if (event.request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
    });
  }

  try {
    const url = new URL(event.request.url);
    const id = (url.searchParams.get("id") || "").trim();
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const DB = getKV();
    if (!DB) {
      return new Response(JSON.stringify({ error: "KV Missing" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const raw = await DB.get(`feedback:${id}`);
    if (!raw) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const item = typeof raw === "string" ? JSON.parse(raw) : raw;
    const r2Key = item?.screenshot?.r2_key;
    if (!r2Key) {
      return new Response(JSON.stringify({ error: "No screenshot" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const object = await getFeedbackObject(r2Key, event.env);
    if (!object) {
      return new Response(JSON.stringify({ error: "Image not found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
      });
    }

    headers.set("Cache-Control", "public, max-age=604800, immutable");
    headers.set("Content-Type", object.contentType || item.screenshot.mime || "application/octet-stream");
    if (Number.isFinite(object.size)) {
      headers.set("Content-Length", String(object.size));
    }

    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || "Failed to load image" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
    });
  }
}
