import {
  withMethodHeaders,
  json,
  getKV,
  getUsernameFromAuthHeader,
  resolveUserTier,
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

    const tierInfo = await resolveUserTier(username, DB, event.env);

    // Load subscription months count
    let subscriptionMonths = 0;
    try {
      const rawSub = await DB.get(`subscription:${username}`);
      if (rawSub) {
        const sub = typeof rawSub === "string" ? JSON.parse(rawSub) : rawSub;
        subscriptionMonths = sub.totalMonths || 0;
      }
    } catch {
      // best-effort
    }

    // Check afdian binding
    const rawUser = await DB.get(`user:${username}`);
    const user = rawUser
      ? typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser
      : {};
    const afdianBound = !!(user.bindings && user.bindings.afdian);

    return json(
      {
        tier: tierInfo.tier,
        tierToken: tierInfo.tierToken,
        tierExpiresAt: tierInfo.tierExpiresAt,
        permanentUpgradedAt: tierInfo.permanentUpgradedAt,
        subscriptionMonths,
        afdianBound,
      },
      200,
      headers
    );
  } catch (err) {
    return json(
      { error: err?.message || "Internal error" },
      500,
      headers
    );
  }
}
