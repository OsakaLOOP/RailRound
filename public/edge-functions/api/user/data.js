export async function onRequest(event) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  const DB = event.env.RAILROUND_KV;
  if (!DB) return new Response(JSON.stringify({ error: "KV Missing" }), { status: 500, headers });

  // Auth check
  const authHeader = event.request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const token = authHeader.split(" ")[1];
  const sessionKey = `session:${token}`;

  try {
    const username = await DB.get(sessionKey);
    if (!username) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers });
    }

    const userKey = `user:${username}`;
    let rawUserData = await DB.get(userKey);

    if (!rawUserData) {
        return new Response(JSON.stringify({ error: "User data corrupted" }), { status: 404, headers });
    }

    let userData = typeof rawUserData === 'string' ? JSON.parse(rawUserData) : rawUserData;

    if (event.request.method === "GET") {
        // Return only data, remove sensitive info like password
        const { password, ...safeData } = userData;
        return new Response(JSON.stringify(safeData), { headers });
    }
    else if (event.request.method === "POST") {
        const body = await event.request.json();

        // Update trips and pins
        // We do a merge strategy or overwrite?
        // Plan said "Merge/Overwrite". Let's assume the client sends the full new state for simplicity and consistency with the current frontend app logic which holds full state.

        if (body.trips) userData.trips = body.trips;
        if (body.pins) userData.pins = body.pins;

        // Update timestamp
        userData.updated_at = new Date().toISOString();

        await DB.put(userKey, JSON.stringify(userData));

        return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
