export async function onRequest(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const DB = globalThis.RAILROUND_KV;
    if (!DB) throw new Error("KV Missing");

    const authHeader = event.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
       return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    const token = authHeader.split(" ")[1];

    // Verify Session
    const username = await DB.get(`session:${token}`);
    if (!username) {
        return new Response(JSON.stringify({ error: "Invalid Token" }), { status: 401, headers });
    }

    const userKey = `user:${username}`;

    if (event.request.method === "GET") {
        const dataRaw = await DB.get(userKey);
        const data = dataRaw ? JSON.parse(dataRaw) : { trips: [], pins: [] };

        // Security: Remove sensitive fields
        const { password, ...safeData } = data;

        return new Response(JSON.stringify(safeData), { status: 200, headers });
    }

    if (event.request.method === "POST") {
        const body = await event.request.json();
        const { trips, pins, latest_5, version, folders, badge_settings } = body;

        // Fetch existing to preserve other fields (like password, bindings)
        const existingRaw = await DB.get(userKey);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};

        // --- Folder Badge Sync Logic ---
        if (folders && Array.isArray(folders)) {
            const oldFolders = existing.folders || [];

            // 1. Identify hashes to delete (existed before, but now removed or made private)
            // Map current public hashes
            const newPublicHashes = new Set(folders.filter(f => f.is_public && f.hash).map(f => f.hash));

            const promises = [];

            oldFolders.forEach(f => {
                if (f.hash && !newPublicHashes.has(f.hash)) {
                    promises.push(DB.delete(`badge:${f.hash}`));
                }
            });

            // 2. Identify/Update hashes to save
            folders.forEach(f => {
                if (f.is_public && f.hash && f.stats) {
                    // Store minimal data needed for the card
                    const badgeData = {
                        username: username,
                        stats: f.stats,
                        type: 'folder',
                        updated_at: new Date().toISOString()
                    };
                    promises.push(DB.put(`badge:${f.hash}`, JSON.stringify(badgeData)));
                }
            });

            if (promises.length > 0) {
                await Promise.allSettled(promises);
            }
        }
        // -------------------------------

        const newData = {
            ...existing,
            trips: trips || existing.trips || [],
            pins: pins || existing.pins || [],
            latest_5: latest_5 || existing.latest_5 || null, // Store the pre-calculated card data
            folders: folders || existing.folders || [],
            badge_settings: badge_settings || existing.badge_settings || { enabled: true },
            version: version || existing.version || null
        };

        await DB.put(userKey, JSON.stringify(newData));
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
