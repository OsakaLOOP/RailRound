import {
  withMethodHeaders,
  json,
  getKV,
  getUsernameFromAuthHeader
} from "./_shared.js";
import {
  getGitHubConfig,
  fetchGitHubJson,
  toIssueListItem
} from "./_github.js";

const headers = withMethodHeaders("GET, OPTIONS");

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }
  if (event.request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, headers);
  }

  try {
    const DB = getKV();
    if (!DB) return json({ error: "KV Missing" }, 500, headers);

    const username = await getUsernameFromAuthHeader(event.request, DB);
    if (!username) {
      return json({ error: "Login required" }, 401, headers);
    }

    const raw = await DB.get(`user:${username}`);
    const profile = raw ? JSON.parse(raw) : null;
    const githubLogin = String(profile?.bindings?.github?.login || "").trim();
    if (!githubLogin) {
      return json({ error: "GitHub binding required" }, 403, headers);
    }

    const cfg = getGitHubConfig(event.env);
    if (!cfg) return json({ error: "GitHub config missing" }, 500, headers);

    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues?creator=${encodeURIComponent(githubLogin)}&labels=feedback&state=all&sort=created&direction=desc&per_page=30`;

    const data = await fetchGitHubJson(url, cfg, { userAgent: "RailRound-FeedbackHook" });

    const issues = (Array.isArray(data) ? data : [])
      .map(toIssueListItem)
      .filter(Boolean);

    return json({ issues }, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Internal error" }, 500, headers);
  }
}
