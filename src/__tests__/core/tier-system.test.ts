/**
 * Unit tests for tier token signing/verification and subscription history logic.
 */
import { describe, it, expect, beforeAll } from "vitest";

// Replicate core logic from _shared.js for testing (no Edge runtime deps)

// --- HMAC helpers (using Node crypto) ---
let subtleCrypto: SubtleCrypto;

beforeAll(async () => {
  if (globalThis.crypto?.subtle) {
    subtleCrypto = globalThis.crypto.subtle;
  } else {
    const nodeCrypto = await import("node:crypto");
    subtleCrypto = (nodeCrypto as any).webcrypto.subtle;
  }
});

function b64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): string {
  let str = String(input).replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

function hex(inputBytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(inputBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toUint8Array(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(input);
  return new Uint8Array(bytes);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await subtleCrypto.importKey(
    "raw",
    toUint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await subtleCrypto.sign("HMAC", key, toUint8Array(message));
  return hex(sig);
}

function secureCompareHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// --- Tier Token ---

interface TierPayload {
  username: string;
  tier: string;
  expiresAt: string | null;
  nonce: string;
  iat: string;
}

async function signTierPayload(payload: TierPayload, secret: string): Promise<string> {
  const message = JSON.stringify(payload);
  const signature = await hmacSha256Hex(secret, message);
  return b64urlEncode(JSON.stringify({ payload, signature }));
}

async function verifyTierToken(
  rawToken: string,
  secret: string
): Promise<TierPayload | null> {
  try {
    const json = b64urlDecode(rawToken);
    const { payload, signature } = JSON.parse(json);
    if (!payload || !signature) return null;

    const message = JSON.stringify(payload);
    const expectedSig = await hmacSha256Hex(secret, message);
    if (!secureCompareHex(expectedSig, String(signature))) return null;

    if (payload.expiresAt) {
      const expires = Date.parse(String(payload.expiresAt));
      if (!Number.isFinite(expires) || expires <= Date.now()) return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// --- Subscription History ---

interface SubscriptionMonth {
  year: number;
  month: number;
  planName: string;
  amount: number;
  orderId: string;
  lastPayTime: string;
  status: "active" | "cancelled";
}

interface SubscriptionHistory {
  username: string;
  totalMonths: number;
  months: SubscriptionMonth[];
  lastUpdated: string;
}

function countUniqueMonths(months: SubscriptionMonth[]): number {
  const seen = new Set<string>();
  for (const m of months || []) {
    seen.add(`${m.year}-${String(m.month).padStart(2, "0")}`);
  }
  return seen.size;
}

function upsertSubscriptionMonth(
  history: SubscriptionHistory | null,
  newMonth: SubscriptionMonth
): SubscriptionHistory {
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
    username: history?.username || "",
    totalMonths: countUniqueMonths(months),
    months,
    lastUpdated: new Date().toISOString(),
  };
}

// --- Tests ---

describe("Tier Token crypto", () => {
  const SECRET = "test-signing-key-abc123";

  it("signs and verifies a valid token", async () => {
    const payload: TierPayload = {
      username: "test_user",
      tier: "premium",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      nonce: crypto.randomUUID(),
      iat: new Date().toISOString(),
    };

    const token = await signTierPayload(payload, SECRET);
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");

    const verified = await verifyTierToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.username).toBe("test_user");
    expect(verified!.tier).toBe("premium");
  });

  it("rejects token with wrong secret", async () => {
    const payload: TierPayload = {
      username: "test_user",
      tier: "premium",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      nonce: crypto.randomUUID(),
      iat: new Date().toISOString(),
    };

    const token = await signTierPayload(payload, SECRET);
    const verified = await verifyTierToken(token, "wrong-secret");
    expect(verified).toBeNull();
  });

  it("rejects expired token", async () => {
    const payload: TierPayload = {
      username: "test_user",
      tier: "premium",
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
      nonce: crypto.randomUUID(),
      iat: new Date().toISOString(),
    };

    const token = await signTierPayload(payload, SECRET);
    const verified = await verifyTierToken(token, SECRET);
    expect(verified).toBeNull();
  });

  it("accepts permanent token (no expiry)", async () => {
    const payload: TierPayload = {
      username: "test_user",
      tier: "permanent",
      expiresAt: null,
      nonce: crypto.randomUUID(),
      iat: new Date().toISOString(),
    };

    const token = await signTierPayload(payload, SECRET);
    const verified = await verifyTierToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.tier).toBe("permanent");
  });

  it("rejects tampered token", async () => {
    const payload: TierPayload = {
      username: "test_user",
      tier: "premium",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      nonce: crypto.randomUUID(),
      iat: new Date().toISOString(),
    };

    const token = await signTierPayload(payload, SECRET);
    // Tamper: decode, change tier, re-encode WITHOUT re-signing
    const decoded = JSON.parse(b64urlDecode(token));
    decoded.payload.tier = "permanent";
    const tampered = b64urlEncode(JSON.stringify(decoded));

    const verified = await verifyTierToken(tampered, SECRET);
    expect(verified).toBeNull();
  });

  it("produces unique nonces for each signing", async () => {
    const payload1: TierPayload = {
      username: "test_user",
      tier: "premium",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      nonce: crypto.randomUUID(),
      iat: new Date().toISOString(),
    };
    const payload2: TierPayload = { ...payload1, nonce: crypto.randomUUID() };

    const token1 = await signTierPayload(payload1, SECRET);
    const token2 = await signTierPayload(payload2, SECRET);
    expect(token1).not.toBe(token2);
  });
});

describe("Subscription history logic", () => {
  const makeMonth = (overrides: Partial<SubscriptionMonth> = {}): SubscriptionMonth => ({
    year: 2026,
    month: 4,
    planName: "Monthly ¥8",
    amount: 8,
    orderId: "order_001",
    lastPayTime: "2026-04-15T00:00:00Z",
    status: "active",
    ...overrides,
  });

  it("counts unique months correctly", () => {
    const months: SubscriptionMonth[] = [
      makeMonth({ year: 2026, month: 1, orderId: "a" }),
      makeMonth({ year: 2026, month: 2, orderId: "b" }),
      makeMonth({ year: 2026, month: 3, orderId: "c" }),
    ];
    expect(countUniqueMonths(months)).toBe(3);
  });

  it("deduplicates same month", () => {
    const months: SubscriptionMonth[] = [
      makeMonth({ year: 2026, month: 1, orderId: "a" }),
      makeMonth({ year: 2026, month: 1, orderId: "b" }), // same month, different order
    ];
    expect(countUniqueMonths(months)).toBe(1);
  });

  it("upserts by orderId", () => {
    let history: SubscriptionHistory = {
      username: "test",
      totalMonths: 0,
      months: [],
      lastUpdated: "",
    };

    // First insert
    history = upsertSubscriptionMonth(history, makeMonth({ orderId: "a", year: 2026, month: 1 }));
    expect(history.months).toHaveLength(1);
    expect(history.totalMonths).toBe(1);

    // Same orderId should update, not duplicate
    history = upsertSubscriptionMonth(history, makeMonth({ orderId: "a", year: 2026, month: 1, status: "cancelled" }));
    expect(history.months).toHaveLength(1);
    expect(history.months[0].status).toBe("cancelled");

    // Different orderId should append
    history = upsertSubscriptionMonth(history, makeMonth({ orderId: "b", year: 2026, month: 2 }));
    expect(history.months).toHaveLength(2);
    expect(history.totalMonths).toBe(2);
  });

  it("sorts months newest first", () => {
    let history: SubscriptionHistory = {
      username: "test",
      totalMonths: 0,
      months: [],
      lastUpdated: "",
    };

    history = upsertSubscriptionMonth(history, makeMonth({ orderId: "a", year: 2026, month: 1 }));
    history = upsertSubscriptionMonth(history, makeMonth({ orderId: "b", year: 2026, month: 5 }));
    history = upsertSubscriptionMonth(history, makeMonth({ orderId: "c", year: 2026, month: 3 }));

    expect(history.months[0].month).toBe(5);
    expect(history.months[1].month).toBe(3);
    expect(history.months[2].month).toBe(1);
  });

  it("reaches permanent at 12 unique months", () => {
    let history: SubscriptionHistory = {
      username: "test",
      totalMonths: 0,
      months: [],
      lastUpdated: "",
    };

    for (let m = 1; m <= 12; m++) {
      history = upsertSubscriptionMonth(
        history,
        makeMonth({ orderId: `order_${m}`, year: 2026, month: m })
      );
    }

    expect(history.totalMonths).toBe(12);
  });

  it("handles null history", () => {
    const history = upsertSubscriptionMonth(
      null as any,
      makeMonth({ orderId: "a" })
    );
    expect(history.months).toHaveLength(1);
    expect(history.totalMonths).toBe(1);
    expect(history.username).toBe("");
  });

  it("handles empty months array", () => {
    expect(countUniqueMonths([])).toBe(0);
  });
});

describe("Tier determination from subscription status", () => {
  function determineTier(totalMonths: number, isActive: boolean): string {
    if (totalMonths >= 12) return "permanent";
    if (isActive) return "premium";
    return "free";
  }

  it('returns "free" for no subscription', () => {
    expect(determineTier(0, false)).toBe("free");
  });

  it('returns "premium" for active subscription < 12 months', () => {
    expect(determineTier(5, true)).toBe("premium");
    expect(determineTier(11, true)).toBe("premium");
  });

  it('returns "permanent" for 12+ months regardless of active status', () => {
    expect(determineTier(12, true)).toBe("permanent");
    expect(determineTier(12, false)).toBe("permanent");
    expect(determineTier(24, false)).toBe("permanent");
  });

  it('returns "free" for cancelled subscription < 12 months', () => {
    expect(determineTier(3, false)).toBe("free");
  });
});
