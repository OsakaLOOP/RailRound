/**
 * Client-side tier token verification.
 *
 * Verifies the HMAC-SHA256 signature on a tierToken to confirm it was issued
 * by the server. This raises the bar for frontend tampering from "change a
 * string in DevTools" to "must defeat HMAC crypto" — while acknowledging that
 * the true security boundary is server-side enforcement on resource-consuming
 * endpoints.
 *
 * The signing key MUST NOT be present on the client; verification works by
 * comparing the token's embedded signature against the server's public commitment.
 *
 * Strategy: the client requests a "verification challenge" from the server —
 * a one-time nonce signed by the same TIER_SIGNING_KEY. The client verifies
 * the tierToken signature matches the challenge signature pattern.
 *
 * For the P0 implementation, we use a simpler approach:
 * - tierToken is verified by making a lightweight GET /api/user/tier call
 * - the server's response is authoritative (it re-verifies its own token)
 * - this is NOT crypto-level client-side verification, but it's the correct
 *   approach: only trust what the server tells you
 */

import { useStore } from "../store";

const TIER_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let lastTierSync = 0;

/**
 * Re-verify tier status with the server.
 * Returns the verified tier data or null if verification fails.
 *
 * This is the correct approach: the server is the only source of truth.
 * Client-side crypto verification of HMAC would require embedding the
 * signing key, which defeats the purpose.
 */
export async function syncTierFromServer(): Promise<{
  tier: string;
  verified: boolean;
} | null> {
  const state = useStore.getState();
  const token = state.user?.token;
  if (!token) return null;

  try {
    const res = await fetch("/api/user/tier", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const verified = data.tier === "premium" || data.tier === "permanent";

    // Update store with verified tier
    state.setUserProfile({
      ...state.userProfile,
      tier: data.tier,
      tierVerified: verified,
      tierToken: data.tierToken || null,
      tierExpiresAt: data.tierExpiresAt || null,
      subscriptionMonths: data.subscriptionMonths || 0,
    } as any);

    lastTierSync = Date.now();
    return { tier: data.tier, verified };
  } catch {
    return null;
  }
}

/**
 * Check if tier needs re-verification (periodic sync).
 */
export function shouldSyncTier(): boolean {
  return Date.now() - lastTierSync > TIER_SYNC_INTERVAL_MS;
}

/**
 * Clear all tier state — used when verification fails or on logout.
 */
export function clearTierState() {
  const state = useStore.getState();
  state.setUserProfile({
    ...state.userProfile,
    tier: "free" as any,
    tierVerified: false,
    tierToken: null,
    tierExpiresAt: null,
    subscriptionMonths: 0,
  } as any);
  lastTierSync = 0;
}
