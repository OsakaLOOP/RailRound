import {
  withMethodHeaders,
  json,
  getKV
} from "./_shared.js";
import {
  getGitHubConfig,
  fetchGitHubJson,
  toIssueListItem
} from "./_github.js";

const headers = withMethodHeaders("POST, OPTIONS");

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "all", "both", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "because", "but", "and", "or", "if", "while",
  "about", "up", "out", "it", "its", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "him",
  "her", "they", "them", "what", "which", "who", "whom",
  // Chinese stop words
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
  "吗", "呢", "吧", "啊", "哦", "嗯", "啦", "呀", "嘛", "么",
  // Japanese stop words
  "する", "いる", "ある", "なる", "こと", "これ", "それ", "あれ",
  "この", "その", "あの", "ため", "よう", "もの", "そこ", "ここ",
]);

function extractKeywords(text) {
  if (!text) return [];
  const cleaned = text
    .replace(/[，,\.\。！!？?\s\n\r]+/g, " ")
    .replace(/[^\w\s一-鿿぀-ゟ゠-ヿ]/g, "")
    .trim();
  if (!cleaned) return [];

  // Split into tokens: CJK characters as single tokens, others by whitespace
  const tokens = [];
  const parts = cleaned.split(/\s+/);
  for (const part of parts) {
    if (/^[一-鿿぀-ゟ゠-ヿ]+$/.test(part)) {
      // CJK: split into bigrams for better matching
      for (let i = 0; i < part.length; i++) {
        const ch = part[i];
        if (!STOP_WORDS.has(ch) && ch.length > 0) {
          tokens.push(ch);
        }
        if (i < part.length - 1) {
          const bigram = part[i] + part[i + 1];
          tokens.push(bigram);
        }
      }
    } else {
      // Non-CJK: whole word
      if (!STOP_WORDS.has(part.toLowerCase()) && part.length > 1) {
        tokens.push(part.toLowerCase());
      }
    }
  }

  // Score by frequency and length
  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }

  // Sort by frequency * length (longer, frequent tokens are more meaningful)
  const scored = [...freq.entries()]
    .map(([word, count]) => ({ word, score: count * Math.min(word.length, 6) }))
    .sort((a, b) => b.score - a.score);

  // Take top keywords, deduplicate single chars that are substrings of bigrams
  const seen = new Set();
  const result = [];
  for (const { word } of scored) {
    if (seen.has(word)) continue;
    if (result.length >= 5) break;
    seen.add(word);
    result.push(word);
  }

  return result;
}

export async function onRequest(event) {
  if (event.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }
  if (event.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, headers);
  }

  try {
    const DB = getKV();
    if (!DB) return json({ error: "KV Missing" }, 500, headers);

    let body;
    try {
      body = await event.request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, headers);
    }

    const content = String(body?.content || "").trim();
    if (!content || content.length < 5) {
      return json({ issues: [] }, 200, headers);
    }

    const cfg = getGitHubConfig(event.env);
    if (!cfg) return json({ error: "GitHub config missing" }, 500, headers);

    const keywords = extractKeywords(content);
    if (keywords.length === 0) {
      return json({ issues: [] }, 200, headers);
    }

    const queryTerms = keywords.join("+");
    const q = encodeURIComponent(`${queryTerms} repo:${cfg.owner}/${cfg.repo} label:feedback type:issue`);

    const url = `https://api.github.com/search/issues?q=${q}&per_page=5&sort=relevance&order=desc`;

    const data = await fetchGitHubJson(url, cfg, { userAgent: "RailRound-FeedbackHook" });

    const items = Array.isArray(data?.items) ? data.items : [];
    const issues = items.map(toIssueListItem).filter(Boolean);

    return json({ issues, keywords }, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Internal error" }, 500, headers);
  }
}
