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

  // This is a placeholder.
  // In a real implementation, you would redirect to the provider's OAuth URL
  // We use 302 Redirect so the browser follows it.

  // Since we don't have real Client IDs, we redirect to a mock page or just back to home with a param for demo.
  // For a real implementation:
  // const targetUrl = `https://github.com/login/oauth/authorize?client_id=...`;

  // Mocking: Redirect to a dummy external page to demonstrate the flow,
  // or just return JSON if the client expects to handle it.
  // But the requirement is "let auth handle redirect".

  let targetUrl = "";
  if (provider === 'github') {
      targetUrl = `https://github.com/login/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=${url.origin}/api/auth/callback/github`;
  } else if (provider === 'google') {
      targetUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=${url.origin}/api/auth/callback/google`;
  } else {
      return new Response(JSON.stringify({ error: "Provider not supported" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Return a redirect response
  return Response.redirect(targetUrl, 302);
}
