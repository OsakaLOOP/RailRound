import {
  withMethodHeaders,
  json,
  getKV,
  getUsernameFromAuthHeader,
} from "./_shared.js";

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

    const username = await getUsernameFromAuthHeader(event.request, DB);
    if (!username) return json({ error: "Unauthorized" }, 401, headers);

    const rawSub = await DB.get(`subscription:${username}`);
    if (!rawSub) {
      return json(
        { username, totalMonths: 0, months: [], lastUpdated: null },
        200,
        headers
      );
    }

    const history =
      typeof rawSub === "string" ? JSON.parse(rawSub) : rawSub;
    return json(history, 200, headers);
  } catch (err) {
    return json(
      { error: err?.message || "Internal error" },
      500,
      headers
    );
  }
}
