import fs from 'node:fs';
import path from 'node:path';

const API_KEY = process.env.BING_WEBMASTER_API_KEY;
const SITE_URL = process.env.BING_WEBMASTER_SITE_URL || 'https://railround.com';
const MAX_URLS = Number.parseInt(process.env.BING_WEBMASTER_MAX_URLS || '500', 10);

const distDir = path.resolve(process.cwd(), 'dist');
const rootSitemapPath = path.join(distDir, 'sitemap.xml');

function normalizeSiteUrl(url) {
  return url.replace(/\/+$/, '');
}

function parseLocValues(xmlText) {
  const matches = xmlText.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g);
  return [...matches].map((match) => match[1].trim());
}

function isXmlUrl(url) {
  return url.toLowerCase().endsWith('.xml');
}

function toDistPathFromAbsoluteUrl(url) {
  const normalizedSite = normalizeSiteUrl(SITE_URL).toLowerCase();
  const normalizedUrl = url.toLowerCase();
  if (!normalizedUrl.startsWith(normalizedSite)) {
    return null;
  }

  const relativePart = url.slice(normalizeSiteUrl(SITE_URL).length).replace(/^\/+/, '');
  return path.join(distDir, relativePart);
}

function collectUrlsFromSitemapFile(entryPath, sitemapFiles, pageUrls) {
  if (!fs.existsSync(entryPath)) {
    return;
  }

  const xml = fs.readFileSync(entryPath, 'utf-8');
  const locs = parseLocValues(xml);

  for (const loc of locs) {
    if (isXmlUrl(loc)) {
      const nestedPath = toDistPathFromAbsoluteUrl(loc);
      if (!nestedPath || sitemapFiles.has(nestedPath)) {
        continue;
      }
      sitemapFiles.add(nestedPath);
      collectUrlsFromSitemapFile(nestedPath, sitemapFiles, pageUrls);
      continue;
    }
    pageUrls.add(loc);
  }
}

async function submitBatch(siteUrl, urlBatch) {
  const endpoint = `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=${encodeURIComponent(API_KEY)}`;
  const payload = {
    siteUrl,
    urlList: urlBatch,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bing API request failed (${response.status}): ${errorText}`);
  }

  const body = await response.json();
  if (body?.d) {
    console.log('Bing API response:', body.d);
  } else {
    console.log('Bing API response:', body);
  }
}

async function main() {
  if (!API_KEY) {
    console.log('Skip Bing indexing submit: BING_WEBMASTER_API_KEY is not set.');
    process.exit(0);
  }

  if (!fs.existsSync(rootSitemapPath)) {
    console.warn(`Skip Bing indexing submit: sitemap not found at ${rootSitemapPath}`);
    process.exit(0);
  }

  const sitemapFiles = new Set([rootSitemapPath]);
  const pageUrls = new Set();
  collectUrlsFromSitemapFile(rootSitemapPath, sitemapFiles, pageUrls);

  const candidateUrls = [...pageUrls].filter((url) =>
    url.toLowerCase().startsWith(normalizeSiteUrl(SITE_URL).toLowerCase()),
  );

  if (candidateUrls.length === 0) {
    console.warn('Skip Bing indexing submit: no URLs found from sitemap.');
    process.exit(0);
  }

  const limitedUrls = candidateUrls.slice(0, Number.isFinite(MAX_URLS) ? MAX_URLS : 500);
  console.log(`Submitting ${limitedUrls.length} URLs to Bing Webmaster API for ${SITE_URL}`);
  await submitBatch(normalizeSiteUrl(SITE_URL), limitedUrls);
}

main().catch((error) => {
  console.error('Bing indexing submit failed:', error);
  process.exit(1);
});
