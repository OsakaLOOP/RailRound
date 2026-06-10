export async function onRequest(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (event.request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers });
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
    const dataRaw = await DB.get(userKey);
    const data = dataRaw ? JSON.parse(dataRaw) : {};

    let needsSave = false;

    // Check if read-only card key exists (for public badge)
    if (!data.card_key) {
      data.card_key = crypto.randomUUID();
      await DB.put(`card_key:${data.card_key}`, username);
      needsSave = true;
    }

    // Check if write key exists (for bot operations, private)
    if (!data.card_write_key) {
      data.card_write_key = crypto.randomUUID();
      await DB.put(`card_write_key:${data.card_write_key}`, username);
      needsSave = true;
    }

    if (needsSave) {
      await DB.put(userKey, JSON.stringify(data));
    }

    return new Response(JSON.stringify({
      key: data.card_key,
      write_key: data.card_write_key
    }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
