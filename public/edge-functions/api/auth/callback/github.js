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

    const CLIENT_ID = env.CLIENT_ID;
    const CLIENT_SECRET = env.CLIENT_SECRET;

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
      let candidateUsername = `github_${githubUser.login}`;
      let userKey = `user:${candidateUsername}`;
      let existingUserStr = await DB.get(userKey);
      let recover = false;

      if (existingUserStr) {
        // Collision or previous registration?
        try {
          const existingUser = JSON.parse(existingUserStr);
          if (existingUser.bindings && existingUser.bindings.github && existingUser.bindings.github.id === githubUser.id) {
            // It's the same user! The binding key was lost. Recover it.
            recover = true;
          }
        } catch (e) {
          // Ignore parse error, treat as collision
        }

        if (!recover) {
          // Real collision, switch to ID-based username
          candidateUsername = `github_${githubUser.login}_${githubUser.id}`;
          userKey = `user:${candidateUsername}`;

          // Double check if THIS exists (paranoia check / recovering ID-based user)
          existingUserStr = await DB.get(userKey);
          if (existingUserStr) {
             try {
                const existingUser = JSON.parse(existingUserStr);
                if (existingUser.bindings && existingUser.bindings.github && existingUser.bindings.github.id === githubUser.id) {
                    recover = true;
                } else {
                    throw new Error("Username collision for backup name");
                }
             } catch (e) {
                if (e.message === "Username collision for backup name") throw e;
                // If parse error here, maybe we should overwrite?
                // But safer to assume collision.
                throw new Error("Username collision for backup name (corrupt data)");
             }
          }
        }
      }

      username = candidateUsername;

      // If we are recovering, we don't need to overwrite the user data, just the binding.
      // But updating the user data (e.g. avatar) is good practice.
      // So we always put.

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

      // Merge with existing data if we are recovering to not lose trips?
      // "recover" flag means we found a user that IS us.
      if (recover && existingUserStr) {
          try {
             const existing = JSON.parse(existingUserStr);
             userData.created_at = existing.created_at || userData.created_at;
             userData.trips = existing.trips || [];
             userData.pins = existing.pins || [];
             // Update bindings and generic info
          } catch(e) {}
      }

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
