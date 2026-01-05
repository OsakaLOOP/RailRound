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

  // --- CONFIGURATION ---
  // In a real environment, these should be environment variables
  const CLIENT_ID = "YOUR_GITHUB_CLIENT_ID";
  const CLIENT_SECRET = "YOUR_GITHUB_CLIENT_SECRET";
  // ---------------------

  try {
    // 1. Exchange code for access token
    // const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    //   method: 'POST',
    //   headers: {
    //     'Accept': 'application/json',
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     client_id: CLIENT_ID,
    //     client_secret: CLIENT_SECRET,
    //     code: code
    //   })
    // });
    // const tokenData = await tokenResponse.json();
    // if (tokenData.error) throw new Error(tokenData.error_description);
    // const accessToken = tokenData.access_token;

    // 2. Fetch User Info
    // const userResponse = await fetch('https://api.github.com/user', {
    //   headers: { 'Authorization': `Bearer ${accessToken}` }
    // });
    // const githubUser = await userResponse.json();

    // MOCK DATA for structure demonstration
    const githubUser = {
        id: 12345,
        login: "mock_github_user"
    };

    // 3. Database Logic
    const DB = globalThis.RAILROUND_KV;
    if (!DB) throw new Error("KV Missing");

    // Look for existing binding
    // Ideally we would have a secondary index or lookup key like `binding:github:{id}` -> `username`
    const bindingKey = `binding:github:${githubUser.id}`;
    let username = await DB.get(bindingKey);

    if (!username) {
        // Registration / Binding
        username = `github_${githubUser.login}`;

        // Ensure username uniqueness or handle collision
        const userKey = `user:${username}`;
        const existing = await DB.get(userKey);

        if (!existing) {
            // Create new user
            const userData = {
                username,
                created_at: new Date().toISOString(),
                bindings: { github: githubUser.id },
                trips: [],
                pins: []
            };
            await DB.put(userKey, JSON.stringify(userData));
            await DB.put(bindingKey, username);
        } else {
            // User exists but binding missing? Or name collision?
            // For simplicity, we assume we just log them in if name matches, or append random.
            // Here we just proceed.
        }
    }

    // 4. Create Session
    const token = crypto.randomUUID();
    const sessionKey = `session:${token}`;
    await DB.put(sessionKey, username, { expirationTtl: 86400 * 30 });

    // 5. Redirect to App
    // We pass the token in the URL fragment or query param so the frontend can grab it
    return Response.redirect(`${url.origin}/?token=${token}&username=${username}`, 302);

  } catch (e) {
    return new Response(JSON.stringify({ error: "Auth Failed", details: e.message }), { status: 500 });
  }
}
