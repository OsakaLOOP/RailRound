// SHA-256 Hashing helper
async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(event) {
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

  const DB = globalThis.RAILROUND_KV;
  if (!DB) return new Response(JSON.stringify({ error: "KV Missing" }), { status: 500, headers });

  try {
    const body = await event.request.json();
    const { username, password, reg_token } = body;

    if (!username || !password || !reg_token) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers });
    }

    // 1. Verify Registration Token
    const tempKey = `temp_reg:${reg_token}`;
    const tempRaw = await DB.get(tempKey);

    if (!tempRaw) {
      return new Response(JSON.stringify({ error: "Registration session expired or invalid" }), { status: 400, headers });
    }

    const githubUser = JSON.parse(tempRaw);

    // 2. Check Username Availability
    const userKey = `user:${username}`;
    const existing = await DB.get(userKey);
    if (existing) {
      return new Response(JSON.stringify({ error: "Username already exists" }), { status: 409, headers });
    }

    // 3. Create Account
    const hashedPassword = await sha256(password);

    const userData = {
      username,
      password: hashedPassword,
      created_at: new Date().toISOString(),
      bindings: {
        github: githubUser // Bind the GitHub info
      },
      trips: [],
      pins: []
    };

    // Store User
    await DB.put(userKey, JSON.stringify(userData));

    // Store Binding
    const bindingKey = `binding:github:${githubUser.id}`;
    await DB.put(bindingKey, username);

    // 4. Cleanup Temp Token
    await DB.delete(tempKey);

    // 5. Create Session (Auto Login)
    const token = crypto.randomUUID();
    const sessionKey = `session:${token}`;
    await DB.put(sessionKey, username, { expirationTtl: 86400 * 30 });

    return new Response(JSON.stringify({
      success: true,
      token,
      username
    }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
