import {
  withMethodHeaders,
  json,
  getKV,
  getUsernameFromAuthHeader,
  signTierToken,
  queryAfdianSponsors,
  findSponsor,
  hasActiveSubscription,
  buildSubscriptionMonth,
  upsertSubscriptionMonth,
} from "./_shared.js";

const headers = withMethodHeaders("POST, OPTIONS");

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

    const username = await getUsernameFromAuthHeader(event.request, DB);
    if (!username) return json({ error: "Unauthorized" }, 401, headers);

    const body = await event.request.json().catch(() => null);
    if (!body || !body.afdianUserId) {
      return json({ error: "Missing afdianUserId" }, 400, headers);
    }

    const afdianUserId = String(body.afdianUserId).trim();
    if (!afdianUserId) {
      return json({ error: "Invalid afdianUserId" }, 400, headers);
    }

    // Check if this Afdian ID is already bound to another user
    const existingBinding = await DB.get(`binding:afdian:${afdianUserId}`);
    if (existingBinding && existingBinding !== username) {
      return json(
        { error: "This Afdian account is already bound to another user" },
        409,
        headers
      );
    }

    // Query Afdian API
    let sponsorData;
    try {
      sponsorData = await queryAfdianSponsors(event.env);
    } catch (err) {
      return json(
        { error: `Afdian API query failed: ${err.message}` },
        502,
        headers
      );
    }

    const sponsor = findSponsor(sponsorData, afdianUserId);
    if (!sponsor) {
      return json(
        { error: "Sponsor not found. Make sure you have an active subscription." },
        404,
        headers
      );
    }

    const isActive = hasActiveSubscription(sponsor);
    if (!isActive) {
      return json(
        { error: "No active ¥8/month subscription found for this user." },
        400,
        headers
      );
    }

    // Read current user record
    const rawUser = await DB.get(`user:${username}`);
    const user = rawUser
      ? typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser
      : { username };

    // Write binding
    user.bindings = {
      ...(user.bindings || {}),
      afdian: {
        user_id: afdianUserId,
        bound_at: new Date().toISOString(),
      },
    };
    await DB.put(`binding:afdian:${afdianUserId}`, username);

    // Build subscription record
    const newMonth = buildSubscriptionMonth(sponsor);

    // Load or create subscription history
    let history = { username, totalMonths: 0, months: [], lastUpdated: "" };
    try {
      const rawSub = await DB.get(`subscription:${username}`);
      if (rawSub) {
        history =
          typeof rawSub === "string" ? JSON.parse(rawSub) : rawSub;
      }
    } catch {
      // start fresh
    }

    history = upsertSubscriptionMonth(history, newMonth);
    await DB.put(`subscription:${username}`, JSON.stringify(history));

    // Determine tier
    let tier = "free";
    let tierExpiresAt = null;
    let permanentUpgradedAt = user.permanentUpgradedAt || null;

    if (history.totalMonths >= 12) {
      tier = "permanent";
      permanentUpgradedAt = permanentUpgradedAt || new Date().toISOString();
      tierExpiresAt = null;
    } else {
      tier = "premium";
      // Expire 35 days from last payment (month + 5-day grace)
      const expiryDate = new Date(newMonth.lastPayTime || Date.now());
      expiryDate.setDate(expiryDate.getDate() + 35);
      tierExpiresAt = expiryDate.toISOString();
    }

    // Sign tier token
    let tierToken = null;
    try {
      tierToken = await signTierToken(
        { username, tier, expiresAt: tierExpiresAt },
        event.env
      );
    } catch {
      // signing failed — proceed without token
    }

    // Update user record
    user.tier = tier;
    user.tierToken = tierToken;
    user.tierExpiresAt = tierExpiresAt;
    user.permanentUpgradedAt = permanentUpgradedAt;
    user._subscriptionMonths = history.totalMonths;
    await DB.put(`user:${username}`, JSON.stringify(user));

    return json(
      {
        success: true,
        tier,
        tierToken,
        tierExpiresAt,
        permanentUpgradedAt,
        subscriptionMonths: history.totalMonths,
        afdianBound: true,
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
