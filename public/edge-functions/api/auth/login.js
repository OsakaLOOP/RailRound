// SHA-256 Hashing helper
async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(event) {
  // Handle CORS
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (event.request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  const DB = event.env.RAILROUND_KV;
  if (!DB) return new Response(JSON.stringify({ error: "KV Missing" }), { status: 500, headers });

  try {
    const body = await event.request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({ error: "Missing username or password" }), { status: 400, headers });
    }

    const key = `user:${username}`;

    // Check if user exists
    const rawData = await DB.get(key);
    if (!rawData) {
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers });
    }

    const userData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    const hashedPassword = await sha256(password);

    if (userData.password !== hashedPassword) {
       return new Response(JSON.stringify({ error: "Invalid password" }), { status: 401, headers });
    }

    // Create session
    const token = crypto.randomUUID();
    const sessionKey = `session:${token}`;
    await DB.put(sessionKey, username, { expirationTtl: 86400 * 30 }); // 30 days

    return new Response(JSON.stringify({
      success: true,
      token,
      username
    }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
