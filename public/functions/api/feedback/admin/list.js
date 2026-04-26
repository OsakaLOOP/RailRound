import {
  withMethodHeaders,
  json,
  getKV,
  assertAdmin,
  clipText
} from "../_shared.js";

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

    const isAdmin = await assertAdmin(event.request, DB);
    if (!isAdmin) return json({ error: "Forbidden" }, 403, headers);

    const url = new URL(event.request.url);
    const cursor = url.searchParams.get("cursor") || undefined;
    const limitRaw = Number(url.searchParams.get("limit") || 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));
    const category = url.searchParams.get("category");
    const status = url.searchParams.get("status");

    const items = [];
    let listCursor = cursor;
    let hasMore = false;
    let listComplete = false;
    let rounds = 0;

    while (items.length < limit && rounds < 8) {
      rounds += 1;
      const page = await DB.list({
        prefix: "feedback:",
        cursor: listCursor,
        limit: Math.min(100, limit * 4)
      });
      listCursor = page.cursor;
      listComplete = Boolean(page.list_complete);

      const records = await Promise.all(
        (page.keys || []).map(async (k) => {
          const raw = await DB.get(k.name);
          if (!raw) return null;
          try {
            return typeof raw === "string" ? JSON.parse(raw) : raw;
          } catch {
            return null;
          }
        })
      );

      for (const row of records) {
        if (!row || !row.id) continue;
        if (category && row.category !== category) continue;
        const rowStatus = row.hook?.status || "pending";
        if (status && rowStatus !== status) continue;

        items.push({
          id: row.id,
          created_at: row.created_at,
          category: row.category,
          content_preview: clipText(row.content || "", 160),
          reporter: row.reporter || { type: "unknown" },
          hook: {
            status: rowStatus,
            issue_url: row.hook?.issue_url || null
          },
          has_screenshot: Boolean(row.screenshot?.r2_key)
        });
        if (items.length >= limit) break;
      }

      if (listComplete) break;
      hasMore = Boolean(listCursor);
    }

    items.sort((a, b) => (String(b.created_at || "")).localeCompare(String(a.created_at || "")));

    return json(
      {
        items,
        cursor: listComplete ? null : listCursor || null,
        has_more: listComplete ? false : Boolean(listCursor || hasMore)
      },
      200,
      headers
    );
  } catch (err) {
    return json({ error: err?.message || "Failed to list feedback" }, 500, headers);
  }
}
