export async function onRequest(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  const url = new URL(event.request.url);
  const provider = url.searchParams.get("provider");

  // GitHub OAuth
  if (provider === 'github') {
      const clientId = env.CLIENT_ID;
      if (!clientId) {
          return new Response(JSON.stringify({ error: "Server Configuration Error: Missing CLIENT_ID" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }

      const redirectUri = `${url.origin}/api/auth/callback/github`;
      const targetUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:user`;

      return Response.redirect(targetUrl, 302);
  }

  // Google Placeholder (File structure remains, implementation pending)
  if (provider === 'google') {
      return new Response(JSON.stringify({ error: "Google Auth not implemented yet" }), { status: 501, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Provider not supported" }), { status: 400, headers: { "Content-Type": "application/json" } });
}
