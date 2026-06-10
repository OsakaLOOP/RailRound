import {
  withMethodHeaders,
  json,
  getKV,
  signTierToken,
  buildSubscriptionMonth,
  upsertSubscriptionMonth,
} from "../user/_shared.js";

const headers = withMethodHeaders("POST, OPTIONS");

/**
 * Verify Afdian webhook signature.
 * Afdian sends: { ec, em, data: { type, order: {...} } }
 * The verification token is configured as AFDIAN_WEBHOOK_SECRET.
 * Currently Afdian webhooks use a simple token check in the query string
 * or a request header. Adjust based on actual Afdian webhook implementation.
 */
async function verifyWebhook(event) {
  const env = event.env;
  const secret = String((env && env.AFDIAN_WEBHOOK_SECRET) || "").trim();

  // If no secret configured, accept all (dev mode)
  if (!secret) {
    console.warn("[afdian-webhook] No AFDIAN_WEBHOOK_SECRET configured — accepting all requests");
    return true;
  }

  // Check query string token
  const url = new URL(event.request.url);
  const qsToken = url.searchParams.get("token") || "";
  if (qsToken && qsToken === secret) return true;

  // Check Authorization header
  const authHeader = event.request.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${secret}`) return true;

  // Check x-afdian-signature header
  const sigHeader = event.request.headers.get("x-afdian-signature") || "";
  if (sigHeader && sigHeader === secret) return true;

  return false;
}

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }
  if (event.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, headers);
  }

  try {
    const verified = await verifyWebhook(event);
    if (!verified) {
      return json({ error: "Invalid webhook signature" }, 403, headers);
    }

    const DB = getKV();
    if (!DB) return json({ error: "KV Missing" }, 500, headers);

    const body = await event.request.json().catch(() => null);
    if (!body || !body.data) {
      return json({ received: true }, 200, headers); // Idempotent — ignore malformed
    }

    // Afdian webhook format:
    // { ec: 200, em: "", data: { type: "order", order: { user_id, plan_id, status, ... } } }
    const order = body.data.order || body.data || {};
    const afdianUserId = String(order.user_id || order.sponsor_user_id || "").trim();

    if (!afdianUserId) {
      return json({ received: true }, 200, headers); // Can't process without user ID
    }

    // Look up bound RailRound user
    const username = await DB.get(`binding:afdian:${afdianUserId}`);
    if (!username) {
      return json(
        { received: true, note: "Afdian user not bound to any RailRound account" },
        200,
        headers
      );
    }

    // Read current user
    const rawUser = await DB.get(`user:${username}`);
    if (!rawUser) {
      return json({ received: true, note: "RailRound user not found" }, 200, headers);
    }
    const user = typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser;

    // Build month record from webhook data
    const newMonth = buildSubscriptionMonth({
      first_pay_time: order.first_pay_time || order.create_time,
      last_pay_time: order.last_pay_time || order.pay_time || order.create_time,
      last_order_id: order.out_trade_no || order.order_id || "",
      first_order_id: order.out_trade_no || order.order_id || "",
      sponsor_plans: order.sponsor_plans || [
        {
          status: order.status === 2 ? 1 : 0, // 2=cancelled
          plan: {
            name: order.plan_title || order.plan_name || "Monthly ¥8",
            price: String(order.total_amount || order.amount || "800"),
          },
        },
      ],
    });

    // Load or create subscription history
    let history = {
      username,
      totalMonths: 0,
      months: [],
      lastUpdated: "",
    };
    try {
      const rawSub = await DB.get(`subscription:${username}`);
      if (rawSub) {
        history = typeof rawSub === "string" ? JSON.parse(rawSub) : rawSub;
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
    } else if (newMonth.status === "active") {
      tier = "premium";
      const expiryDate = new Date(newMonth.lastPayTime || Date.now());
      expiryDate.setDate(expiryDate.getDate() + 35);
      tierExpiresAt = expiryDate.toISOString();
    }
    // If cancelled and <12, tier stays "free"

    // Sign tier token
    let tierToken = null;
    if (tier !== "free") {
      try {
        tierToken = await signTierToken(
          { username, tier, expiresAt: tierExpiresAt },
          event.env
        );
      } catch {
        // proceed without token
      }
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
        received: true,
        tier,
        totalMonths: history.totalMonths,
        username,
      },
      200,
      headers
    );
  } catch (err) {
    console.error("[afdian-webhook] Error:", err);
    return json(
      { error: err?.message || "Internal error" },
      500,
      headers
    );
  }
}
