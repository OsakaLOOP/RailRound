// Shared helpers for user tier/premium API endpoints.

const COMMON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};

export function withMethodHeaders(methods) {
  return { ...COMMON_HEADERS, "Access-Control-Allow-Methods": methods };
}

export function json(data, status = 200, headers = COMMON_HEADERS) {
  return new Response(JSON.stringify(data), { status, headers });
}

export function getKV() {
  return globalThis.RAILROUND_KV;
}

export async function getUsernameFromAuthHeader(request, DB) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;
  return await DB.get(`session:${token}`);
}

// --- HMAC Tier Token Helpers ---

function utf8Bytes(input) {
  return new TextEncoder().encode(input);
}

function hex(inputBytes) {
  return Array.from(new Uint8Array(inputBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") return utf8Bytes(input);
  return new Uint8Array(0);
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    toUint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, toUint8Array(message));
  return hex(sig);
}

export function b64urlEncode(input) {
  return btoa(String(input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function b64urlDecode(input) {
  let str = String(input).replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

function secureCompareHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function getTierSigningKey(env) {
  return String((env && env.TIER_SIGNING_KEY) || "");
}

/**
 * Sign a tier token payload.
 * Returns base64url-encoded JSON containing { payload, signature }.
 */
export async function signTierToken(payload, env) {
  const secret = getTierSigningKey(env);
  if (!secret) throw new Error("TIER_SIGNING_KEY not configured");

  const nonce = crypto.randomUUID();
  const stablePayload = {
    username: payload.username,
    tier: payload.tier,
    expiresAt: payload.expiresAt || null,
    nonce,
    iat: new Date().toISOString(),
  };
  const message = JSON.stringify(stablePayload);
  const signature = await hmacSha256Hex(secret, message);
  return b64urlEncode(JSON.stringify({ payload: stablePayload, signature }));
}

/**
 * Verify a tier token. Returns the payload if valid, null otherwise.
 */
export async function verifyTierToken(rawToken, env) {
  try {
    const json = b64urlDecode(rawToken);
    const { payload, signature } = JSON.parse(json);
    if (!payload || !signature) return null;

    const secret = getTierSigningKey(env);
    if (!secret) return null;

    const message = JSON.stringify(payload);
    const expectedSig = await hmacSha256Hex(secret, message);
    if (!secureCompareHex(expectedSig, String(signature))) return null;

    // Check expiry
    if (payload.expiresAt) {
      const expires = Date.parse(String(payload.expiresAt));
      if (!Number.isFinite(expires) || expires <= Date.now()) return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Tier verification context returned by requireTier on success.
 */
export class TierContext {
  constructor(username, tier, tokenPayload) {
    this.username = username;
    this.tier = tier;
    this.tokenPayload = tokenPayload;
  }
}

/**
 * Require a minimum tier level for an API endpoint.
 *
 * Extracts the tier token from the X-Tier-Token header, verifies its
 * HMAC signature, checks expiry, and confirms the user has at least
 * the requested tier.
 *
 * Usage in any premium endpoint:
 *   const tierCtx = await requireTier(request, env, "premium");
 *   if (!tierCtx) return json({ error: "Premium required" }, 403, headers);
 *   // tierCtx.username is verified
 *
 * @param {Request} request
 * @param {object} env
 * @param {"premium"|"permanent"} minTier
 * @returns {TierContext|null}
 */
export async function requireTier(request, env, minTier = "premium") {
  const tierToken = request.headers.get("X-Tier-Token") || "";
  if (!tierToken) return null;

  const payload = await verifyTierToken(tierToken, env);
  if (!payload) return null;

  // Permanent passes any check
  if (payload.tier === "permanent") {
    return new TierContext(payload.username, "permanent", payload);
  }

  // Premium required, and payload says premium
  if (minTier === "premium" && payload.tier === "premium") {
    return new TierContext(payload.username, "premium", payload);
  }

  return null;
}

/**
 * Verify a user's tier from KV (for endpoints that use session auth).
 *
 * Reads the user's stored tier from KV, re-verifies the stored token.
 * Auto-downgrades if expired. Returns the effective tier.
 *
 * @param {string} username
 * @param {object} DB - KV namespace
 * @param {object} env
 * @returns {{ tier: string, tierToken: string|null, tierExpiresAt: string|null, permanentUpgradedAt: string|null }}
 */
export async function resolveUserTier(username, DB, env) {
  const rawUser = await DB.get(`user:${username}`);
  if (!rawUser) return { tier: "free", tierToken: null, tierExpiresAt: null, permanentUpgradedAt: null };

  const user = typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser;
  let tier = user.tier || "free";
  let tierToken = user.tierToken || null;
  let tierExpiresAt = user.tierExpiresAt || null;

  // Auto-downgrade expired premium
  if (tier === "premium" && tierExpiresAt) {
    const expires = Date.parse(String(tierExpiresAt));
    if (Number.isFinite(expires) && expires <= Date.now()) {
      tier = "free";
      tierToken = null;
      tierExpiresAt = null;
      await DB.put(
        `user:${username}`,
        JSON.stringify({ ...user, tier: "free", tierToken: null, tierExpiresAt: null })
      );
    }
  }

  // Verify existing token, re-sign if needed
  if ((tier === "premium" || tier === "permanent") && tierToken) {
    const payload = await verifyTierToken(tierToken, env);
    if (!payload) {
      // Token invalid — re-sign
      tierToken = null;
    }
  }

  if ((tier === "premium" || tier === "permanent") && !tierToken) {
    try {
      tierToken = await signTierToken(
        { username, tier, expiresAt: tier === "permanent" ? null : tierExpiresAt },
        env
      );
      await DB.put(
        `user:${username}`,
        JSON.stringify({ ...user, tier, tierToken, tierExpiresAt })
      );
    } catch {
      // proceed without token
    }
  }

  return {
    tier,
    tierToken,
    tierExpiresAt,
    permanentUpgradedAt: user.permanentUpgradedAt || null,
  };
}

// --- Afdian API Helpers ---

async function md5Hex(input) {
  const hashBuffer = await crypto.subtle.digest("MD5", toUint8Array(input));
  return hex(hashBuffer);
}

function getAfdianConfig(env) {
  const userId = String((env && env.AFDIAN_USER_ID) || "").trim();
  const token = String((env && env.AFDIAN_TOKEN) || "").trim();
  if (!userId || !token) return null;
  return { userId, token };
}

/**
 * Build Afdian API query-sponsor request signature.
 * Algorithm: md5(token + "params" + paramsJson + "ts" + ts + "user_id" + user_id)
 */
async function afdianSign(config, paramsJson, ts) {
  const message = `${config.token}params${paramsJson}ts${ts}user_id${config.userId}`;
  return await md5Hex(message);
}

/**
 * Call Afdian API to query sponsorship list.
 */
export async function queryAfdianSponsors(env, page = 1) {
  const config = getAfdianConfig(env);
  if (!config) throw new Error("Afdian API not configured");

  const ts = Math.floor(Date.now() / 1000);
  const params = JSON.stringify({ page, per_page: 100 });
  const sign = await afdianSign(config, params, ts);

  const body = new URLSearchParams();
  body.append("user_id", config.userId);
  body.append("params", params);
  body.append("ts", String(ts));
  body.append("sign", sign);

  const res = await fetch("https://afdian.com/api/open/query-sponsor", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Afdian API returned ${res.status}`);
  }

  const data = await res.json();
  if (data.ec !== 200) {
    throw new Error(data.em || "Afdian API error");
  }

  return data.data;
}

/**
 * Find a specific sponsor in the Afdian response by user_id.
 */
export function findSponsor(data, afdianUserId) {
  if (!data || !Array.isArray(data.list)) return null;
  return data.list.find(
    (s) => String(s.user?.user_id || "") === String(afdianUserId)
  ) || null;
}

/**
 * Determine if sponsor has an active ¥8/month subscription.
 */
export function hasActiveSubscription(sponsor) {
  if (!sponsor || !Array.isArray(sponsor.sponsor_plans)) return false;
  return sponsor.sponsor_plans.some(
    (p) => {
      const planName = String(p.plan?.name || "").toLowerCase();
      const planPrice = String(p.plan?.price || "0");
      const isMonthly = planPrice === "8.00" || planPrice === "8";
      const isYearly = planPrice === "60.00" || planPrice === "60";
      return (isMonthly || isYearly) && p.status === 0;
    }
  );
}

/**
 * Build subscription month record from Afdian sponsor data.
 */
export function buildSubscriptionMonth(sponsor) {
  const activePlan = (sponsor.sponsor_plans || []).find(
    (p) => p.status === 0 || p.status === 1
  );
  const planName = activePlan?.plan?.name || "Monthly ¥8";
  const amount = parseFloat(activePlan?.plan?.price || "8") || 8;
  const firstPayTime = sponsor.first_pay_time || sponsor.last_pay_time || "";
  const lastPayTime = sponsor.last_pay_time || firstPayTime || "";

  const d = new Date(lastPayTime || Date.now());
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    planName,
    amount,
    orderId: String(sponsor.last_order_id || sponsor.first_order_id || ""),
    lastPayTime,
    status: hasActiveSubscription(sponsor) ? "active" : "cancelled",
  };
}

/**
 * Count unique (year, month) entries in subscription history.
 */
export function countUniqueMonths(months) {
  const seen = new Set();
  for (const m of (months || [])) {
    seen.add(`${m.year}-${String(m.month).padStart(2, "0")}`);
  }
  return seen.size;
}

/**
 * Upsert a month into the subscription history (deduplicate by orderId).
 */
export function upsertSubscriptionMonth(history, newMonth) {
  const months = Array.isArray(history?.months) ? [...history.months] : [];
  const existingIdx = months.findIndex((m) => m.orderId === newMonth.orderId);
  if (existingIdx >= 0) {
    months[existingIdx] = { ...months[existingIdx], ...newMonth };
  } else {
    months.push(newMonth);
  }
  months.sort((a, b) => {
    const da = `${a.year}-${String(a.month).padStart(2, "0")}`;
    const db = `${b.year}-${String(b.month).padStart(2, "0")}`;
    return db.localeCompare(da);
  });
  return {
    totalMonths: countUniqueMonths(months),
    months,
    lastUpdated: new Date().toISOString(),
  };
}
