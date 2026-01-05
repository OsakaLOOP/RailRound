export async function onRequest(event) {
  const url = new URL(event.request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(JSON.stringify({ error }), { status: 400 });
  }

  if (!code) {
    return new Response("Missing code", { status: 400 });
  }

  const CLIENT_ID = globalThis.CLIENT_ID;
  const CLIENT_SECRET = globalThis.CLIENT_SEC;

  if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Server Configuration Error" }), { status: 500 });
  }

  try {
    // 1. Exchange code for access token
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

    // 2. Fetch User Info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'RailRound-EdgeFunction'
      }
    });

    if (!userResponse.ok) throw new Error("Failed to fetch GitHub user");
    const githubUser = await userResponse.json();

    // 3. Database Logic
    const DB = globalThis.RAILROUND_KV;
    if (!DB) throw new Error("KV Missing");

    const bindingKey = `binding:github:${githubUser.id}`;
    let username = await DB.get(bindingKey);

    if (!username) {
        // Registration / Binding
        // Check if a user with this login already exists manually to avoid overwrite
        // Strategy: Try `github_login`. If taken, try `github_login_id`.

        let candidateUsername = `github_${githubUser.login}`;
        let userKey = `user:${candidateUsername}`;
        let existingUser = await DB.get(userKey);

        if (existingUser) {
            // Collision or previous manual registration with same name?
            // If the existing user has NO github binding, we can't just take it.
            // We append ID to be safe.
            candidateUsername = `github_${githubUser.login}_${githubUser.id}`;
            userKey = `user:${candidateUsername}`;
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

    // 4. Create Session
    const token = crypto.randomUUID();
    const sessionKey = `session:${token}`;
    await DB.put(sessionKey, username, { expirationTtl: 86400 * 30 });

    // 5. Redirect to App
    return Response.redirect(`${url.origin}/?token=${token}&username=${username}`, 302);

  } catch (e) {
    return new Response(JSON.stringify({ error: "Auth Failed", details: e.message }), { status: 500 });
  }
}
