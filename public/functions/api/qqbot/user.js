export async function onRequest(event) {
    const url = new URL(event.request.url);
    const key = url.searchParams.get("key");
    const hash = url.searchParams.get("hash");
    let limit = parseInt(url.searchParams.get("limit") || "10", 10);

    // Cap limit to a reasonable number to avoid huge payloads
    if (limit > 50) limit = 50;

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    const errorJson = (msg, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers });

    if (!key && !hash) {
        return errorJson("Key or Hash missing");
    }

    try {
        const DB = globalThis.RAILROUND_KV;
        if (!DB) return errorJson("KV Error", 500);

        let username = null;
        let isGlobalEnabled = true;

        if (hash) {
            // Folder Badge Mode
            const badgeDataRaw = await DB.get(`badge:${hash}`);
            if (!badgeDataRaw) return errorJson("Invalid Hash", 404);

            const badgeData = JSON.parse(badgeDataRaw);
            username = badgeData.username;

            if (username) {
                const userKey = `user:${username}`;
                const userDataRaw = await DB.get(userKey);
                if (userDataRaw) {
                     const u = JSON.parse(userDataRaw);
                     if (u.badge_settings?.enabled === false) {
                         isGlobalEnabled = false;
                     }
                }
            }
        } else if (key) {
            // Global Badge Mode
            username = await DB.get(`card_key:${key}`);
            if (!username) return errorJson("Invalid Key", 404);
        }

        if (!username) return errorJson("User not found", 404);

        const userKey = `user:${username}`;
        const dataRaw = await DB.get(userKey);

        if (!dataRaw) {
             return errorJson("User data not found", 404);
        }

        const data = JSON.parse(dataRaw);

        // Check Master Switch
        if (data.badge_settings?.enabled === false) {
            isGlobalEnabled = false;
        }

        if (!isGlobalEnabled) {
            return errorJson("Data access disabled by user", 403);
        }

        // Calculate total stats if not pre-calculated in latest_5 or if we need to be precise
        // The card.js uses data.latest_5 for stats. Let's use that if available, else calculate.
        let totalStats = data.latest_5 || { count: 0, dist: 0, lines: 0 };

        // Extract recent trips from the full trips array
        let recentTrips = [];
        if (data.trips && Array.isArray(data.trips)) {
            // Sort by date descending
            const sortedTrips = [...data.trips].sort((a, b) => {
                const dateA = a.date ? new Date(a.date).getTime() : 0;
                const dateB = b.date ? new Date(b.date).getTime() : 0;
                return dateB - dateA;
            });

            recentTrips = sortedTrips.slice(0, limit).map(trip => {
                // Return a simplified, clean object
                return {
                    id: trip.id,
                    title: trip.title || "Untitled Trip",
                    date: trip.date,
                    distance: trip.distance || 0,
                    lines: trip.lines ? trip.lines.map(l => l.name || l.id) : [],
                    stations: trip.stations ? trip.stations.map(s => s.name || s.id) : [],
                    path: trip.path || null // Include raw path coordinates if the bot needs to draw it
                };
            });
        }

        const responseData = {
            username: username,
            stats: {
                total_trips: totalStats.count || data.trips?.length || 0,
                total_distance: totalStats.dist || 0,
                total_lines: totalStats.lines || 0
            },
            recent_trips: recentTrips
        };

        return new Response(JSON.stringify(responseData), { status: 200, headers });

    } catch (e) {
        return errorJson(e.message, 500);
    }
}
