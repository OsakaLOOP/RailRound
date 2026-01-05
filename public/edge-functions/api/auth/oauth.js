export async function onRequest(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const url = new URL(event.request.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const provider = url.searchParams.get("provider");

    // 1. Handle Callback (if 'code' is present)
    if (code) {
      if (error) {
        return new Response(JSON.stringify({ error }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const CLIENT_ID = env.CLIENT_ID;
      const CLIENT_SECRET = env.CLIENT_SECRET;

      if (!CLIENT_ID || !CLIENT_SECRET) {
        return new Response(JSON.stringify({ error: "Server Configuration Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      // Exchange code for access token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code
        })
      });

      const tokenData = await tokenResponse.json();
      if (tokenData.error) throw new Error(tokenData.error_description || "Failed to get token");
      const accessToken = tokenData.access_token;

      // Fetch User Info
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'RailRound-EdgeFunction'
        }
      });

      if (!userResponse.ok) throw new Error("Failed to fetch GitHub user");
      const githubUser = await userResponse.json();

      // Database Logic
      const DB = globalThis.RAILROUND_KV;
      if (!DB) throw new Error("KV Missing");

      const bindingKey = `binding:github:${githubUser.id}`;
      let username = await DB.get(bindingKey);

      if (!username) {
        // Registration / Binding
        const candidateUsername = `github_${githubUser.login}`;
        const userKey = `user:${candidateUsername}`;

        // Strict check: If username is taken, ERROR. No switching, no recovery.
        const existingUser = await DB.get(userKey);

        if (existingUser) {
          throw new Error(`Username '${candidateUsername}' is already taken.`);
        }

        username = candidateUsername;

        const userData = {
          username,
          created_at: new Date().toISOString(),
          bindings: {
            github: {
              id: githubUser.id,
              login: githubUser.login,
              avatar_url: githubUser.avatar_url,
              name: githubUser.name
            }
          },
          trips: [],
          pins: []
        };

        await DB.put(userKey, JSON.stringify(userData));
        await DB.put(bindingKey, username);
      }

      // Create Session
      const token = crypto.randomUUID();
      const sessionKey = `session:${token}`;
      await DB.put(sessionKey, username, { expirationTtl: 86400 * 30 });

      // Redirect to App
      return Response.redirect(`${url.origin}/?token=${token}&username=${username}`, 302);
    }

    // 2. Handle Initiation (if 'provider' is present)
    if (provider === 'github') {
      const clientId = env.CLIENT_ID;
      if (!clientId) {
          return new Response(JSON.stringify({ error: "Server Configuration Error: Missing CLIENT_ID" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      // Point back to THIS file for the callback
      const redirectUri = `${url.origin}/api/auth/oauth`;
      const targetUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:user`;

      return Response.redirect(targetUrl, 302);
    }

    // Google Placeholder
    if (provider === 'google') {
      return new Response(JSON.stringify({ error: "Google Auth not implemented yet" }), { status: 501, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid Request" }), { status: 400, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Auth Failed", details: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
