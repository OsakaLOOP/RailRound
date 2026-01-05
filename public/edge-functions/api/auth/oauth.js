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
    const DB = globalThis.RAILROUND_KV;

    // 1. Handle Callback (if 'code' is present)
    if (code) {
      if (error) {
        return new Response(JSON.stringify({ error }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      if (!DB) throw new Error("KV Missing");

      const CLIENT_ID = env.CLIENT_ID;
      const CLIENT_SECRET = env.CLIENT_SECRET;

      if (!CLIENT_ID || !CLIENT_SECRET) {
        return new Response(JSON.stringify({ error: "Server Configuration Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      // Parse State to check for Session Token (Binding Mode)
      const stateParam = url.searchParams.get("state");
      let sessionToken = null;
      if (stateParam) {
        try {
          const parsed = JSON.parse(decodeURIComponent(stateParam));
          if (parsed && parsed.t) sessionToken = parsed.t;
        } catch (e) {
          console.warn("Failed to parse state", e);
        }
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

      const bindingKey = `binding:github:${githubUser.id}`;

      // --- Scenario A: Binding to Existing Account ---
      if (sessionToken) {
        // Verify Session
        const sessionKey = `session:${sessionToken}`;
        const currentUsername = await DB.get(sessionKey);

        if (!currentUsername) {
          return Response.redirect(`${url.origin}/?error=session_expired`, 302);
        }

        // Check if this GitHub ID is already bound
        const existingBoundUser = await DB.get(bindingKey);
        if (existingBoundUser && existingBoundUser !== currentUsername) {
           return Response.redirect(`${url.origin}/?error=github_bound_to_other`, 302);
        }

        // Perform Binding
        const userKey = `user:${currentUsername}`;
        const userDataRaw = await DB.get(userKey);
        if (!userDataRaw) throw new Error("User record missing");

        const userData = JSON.parse(userDataRaw);
        userData.bindings = userData.bindings || {};
        userData.bindings.github = {
          id: githubUser.id,
          login: githubUser.login,
          avatar_url: githubUser.avatar_url,
          name: githubUser.name
        };

        await DB.put(userKey, JSON.stringify(userData));
        await DB.put(bindingKey, currentUsername);

        // Redirect home with status
        return Response.redirect(`${url.origin}/?status=bound_success`, 302);
      }

      // --- Scenario B: Login or Register ---
      let username = await DB.get(bindingKey);

      if (username) {
        // Login Flow
        const token = crypto.randomUUID();
        const sessionKey = `session:${token}`;
        await DB.put(sessionKey, username, { expirationTtl: 86400 * 30 });
        return Response.redirect(`${url.origin}/?token=${token}&username=${username}`, 302);
      } else {
        // Register Flow (Pending)
        // Store GitHub info temporarily
        const regToken = crypto.randomUUID();
        const tempKey = `temp_reg:${regToken}`;
        const tempPayload = {
           id: githubUser.id,
           login: githubUser.login,
           avatar_url: githubUser.avatar_url,
           name: githubUser.name
        };
        // Expires in 1 hour
        await DB.put(tempKey, JSON.stringify(tempPayload), { expirationTtl: 3600 });

        // Redirect to frontend completion flow
        return Response.redirect(`${url.origin}/?reg_token=${regToken}`, 302);
      }
    }

    // 2. Handle Initiation (if 'provider' is present)
    if (provider === 'github') {
      const clientId = env.CLIENT_ID;
      if (!clientId) {
          return new Response(JSON.stringify({ error: "Server Configuration Error: Missing CLIENT_ID" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      // Parse session_token if provided (for binding)
      const sessionToken = url.searchParams.get("session_token");
      const stateObj = {
        nonce: crypto.randomUUID(),
        t: sessionToken || undefined
      };
      // Simple JSON encoding for state
      const state = encodeURIComponent(JSON.stringify(stateObj));

      // Point back to THIS file for the callback
      const redirectUri = `${url.origin}/api/auth/oauth`;
      const targetUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:user&state=${state}`;

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
