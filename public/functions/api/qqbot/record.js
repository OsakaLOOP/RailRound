export async function onRequest(event) {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (event.request.method === "OPTIONS") {
        return new Response(null, { headers });
    }

    if (event.request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers });
    }

    const errorJson = (msg, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers });

    try {
        const DB = globalThis.RAILROUND_KV;
        if (!DB) return errorJson("KV Error", 500);

        let body;
        try {
            body = await event.request.json();
        } catch (e) {
            return errorJson("Invalid JSON body");
        }

        const { key, title, date, distance, stations, lines, segments, svg_points } = body;

        if (!key) return errorJson("User Key is required");

        // 1. Authenticate user using the write key (separate from public card_key)
        const username = await DB.get(`card_write_key:${key}`);
        if (!username) return errorJson("Invalid Key", 401);

        const userKey = `user:${username}`;
        const dataRaw = await DB.get(userKey);

        if (!dataRaw) return errorJson("User data not found", 404);

        const data = JSON.parse(dataRaw);

        // 2. Build the new trip object
        const newTripId = crypto.randomUUID();
        const tripDate = date || new Date().toISOString().split('T')[0];
        const tripDistance = parseFloat(distance) || 0;

        // Bot typically just passes strings. Let's normalize to objects expected by frontend if possible
        const parsedStations = Array.isArray(stations) ? stations.map((s, idx) => ({
            id: typeof s === 'string' ? s : (s.id || `st_${idx}`),
            name: typeof s === 'string' ? s : (s.name || "Unknown")
        })) : [];

        const parsedLines = Array.isArray(lines) ? lines.map((l, idx) => ({
             id: typeof l === 'string' ? l : (l.id || `ln_${idx}`),
             name: typeof l === 'string' ? l : (l.name || "Unknown")
        })) : [];

        const newTrip = {
            id: newTripId,
            title: title || `Bot Trip on ${tripDate}`,
            date: tripDate,
            distance: tripDistance,
            stations: parsedStations,
            lines: parsedLines,
            segments: Array.isArray(segments) ? segments : null,
            // Provide a dummy horizontal path if nothing else is available
            // so the card.js doesn't crash if it expects svg_points
            path: [{x: 0, y: 0}, {x: 100, y: 0}]
        };

        // 3. Update User Data
        data.trips = data.trips || [];
        // Insert at beginning assuming it's the latest
        data.trips.unshift(newTrip);

        // Update latest_5 (for the card.js SVG generation)
        data.latest_5 = data.latest_5 || { count: 0, dist: 0, lines: 0, latest: [] };
        data.latest_5.latest = data.latest_5.latest || [];

        // Recalculate totals
        data.latest_5.count = data.trips.length;
        data.latest_5.dist = data.trips.reduce((sum, t) => sum + (parseFloat(t.distance) || 0), 0);

        // Recalculate unique lines
        const allLines = new Set();
        data.trips.forEach(t => {
            if (t.lines && Array.isArray(t.lines)) {
                t.lines.forEach(l => allLines.add(l.id || l.name || l));
            }
        });
        data.latest_5.lines = allLines.size;

        // Build simplified latest list for the card (limit 5)
        const newLatestTrip = {
            title: newTrip.title,
            date: newTrip.date,
            dist: newTrip.distance,
            // Use the provided accurate SVG path if the bot calculated it, otherwise fallback
            svg_points: svg_points || "M 0 15 L 100 15"
        };

        data.latest_5.latest.unshift(newLatestTrip);
        if (data.latest_5.latest.length > 5) {
            data.latest_5.latest = data.latest_5.latest.slice(0, 5);
        }

        // 4. Save back to KV
        await DB.put(userKey, JSON.stringify(data));

        return new Response(JSON.stringify({
            success: true,
            message: "Trip recorded successfully",
            trip: {
                id: newTripId,
                title: newTrip.title,
                distance: newTrip.distance
            },
            updated_stats: {
                total_trips: data.latest_5.count,
                total_distance: data.latest_5.dist,
                total_lines: data.latest_5.lines
            }
        }), { status: 200, headers });

    } catch (e) {
        return errorJson(e.message, 500);
    }
}
