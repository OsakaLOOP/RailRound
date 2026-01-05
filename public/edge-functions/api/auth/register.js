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
    const existing = await DB.get(key);
    if (existing) {
      return new Response(JSON.stringify({ error: "Username already exists" }), { status: 409, headers });
    }

    // Hash password
    const hashedPassword = await sha256(password);

    // Create user object
    const userData = {
      username,
      password: hashedPassword,
      created_at: new Date().toISOString(),
      bindings: {},
      trips: [],
      pins: []
    };

    // Store in KV
    await DB.put(key, JSON.stringify(userData));

    // Auto-login: Create session
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
