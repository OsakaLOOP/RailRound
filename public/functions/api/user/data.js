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
        // Return only what is needed for the frontend app (latest_5 is for the card api, but no harm returning it)
        return new Response(JSON.stringify(data), { status: 200, headers });
    }

    if (event.request.method === "POST") {
        const body = await event.request.json();
        const { trips, pins, latest_5 } = body;

        // Fetch existing to preserve other fields (like password, bindings)
        const existingRaw = await DB.get(userKey);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};

        const newData = {
            ...existing,
            trips: trips || existing.trips || [],
            pins: pins || existing.pins || [],
            latest_5: latest_5 || existing.latest_5 || null // Store the pre-calculated card data
        };

        await DB.put(userKey, JSON.stringify(newData));
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
