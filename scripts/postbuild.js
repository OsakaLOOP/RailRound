import fs from 'fs';
import path from 'path';
import {
  APP_LANGS,
  APP_LANG_TO_HREFLANG,
  APP_LANG_TO_HTML,
  APP_TABS,
  DEFAULT_APP_LANG,
  DEFAULT_APP_TAB,
  SITE_ORIGIN,
  buildAppPath,
  getAppSeo,
} from '../src/utils/routes.js';

const distDir = path.resolve(process.cwd(), 'dist');
const rootDir = process.cwd();
const indexHtmlPath = path.join(distDir, 'index.html');
const rootEdgeOnePath = path.join(rootDir, 'edgeone.json');
const distEdgeOnePath = path.join(distDir, 'edgeone.json');

if (!fs.existsSync(indexHtmlPath)) {
  console.error('dist/index.html not found. Build may have failed.');
  process.exit(1);
}

const baseHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function replaceBetween(html, startToken, endToken, replacement) {
  const start = html.indexOf(startToken);
  const end = html.indexOf(endToken, start + startToken.length);
  if (start === -1 || end === -1) return html;
  return `${html.slice(0, start)}${replacement}${html.slice(end + endToken.length)}`;
}

function stripManagedHead(html) {
  return html
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+(?:property|name)=["']og:[^"']+["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+(?:property|name)=["']twitter:[^"']+["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']alternate["'][^>]*>\s*/gi, '');
}

function withSeoHead(html, {
  lang,
  title,
  description,
  canonicalPath,
  tab = DEFAULT_APP_TAB,
  noindex = false,
  includeAlternates = false,
}) {
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  let next = stripManagedHead(html);
  next = next.replace(/<html\s+lang=["'][^"']*["']/i, `<html lang="${APP_LANG_TO_HTML[lang] || lang}"`);
  next = replaceBetween(next, '<title>', '</title>', `<title>${escapeHtml(title)}</title>`);

  const alternates = includeAlternates
    ? [
      ...APP_LANGS.map((alternateLang) => {
        const href = `${SITE_ORIGIN}${buildAppPath(alternateLang, tab)}`;
        return `<link rel="alternate" hreflang="${APP_LANG_TO_HREFLANG[alternateLang]}" href="${escapeAttr(href)}" />`;
      }),
      `<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/zh-cn/records" />`,
    ].join('\n  ')
    : '';

  const managedHead = [
    `<meta name="description" content="${escapeAttr(description)}" />`,
    noindex ? '<meta name="robots" content="noindex,follow" />' : '',
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`,
    alternates,
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${escapeAttr(canonicalUrl)}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:url" content="${escapeAttr(canonicalUrl)}" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
  ].filter(Boolean).join('\n  ');

  return next.replace('</head>', `  ${managedHead}\n</head>`);
}

function writeHtml(relativePath, html) {
  const outputPath = path.join(distDir, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf-8');
  console.log(`Generated ${outputPath}`);
}

function writeAppEntry(lang, tab) {
  const seo = getAppSeo(lang, tab);
  const html = withSeoHead(baseHtml, {
    lang,
    tab,
    title: seo.title,
    description: seo.description,
    canonicalPath: buildAppPath(lang, tab),
    includeAlternates: true,
  });
  writeHtml(path.join(lang, tab, 'index.html'), html);
}

function writeCompatibilityEntry(relativeDir, canonicalPath, lang = DEFAULT_APP_LANG) {
  const seo = getAppSeo(lang, DEFAULT_APP_TAB);
  const html = withSeoHead(baseHtml, {
    lang,
    title: seo.title,
    description: seo.description,
    canonicalPath,
    noindex: true,
  });
  writeHtml(path.join(relativeDir, 'index.html'), html);
}

for (const lang of APP_LANGS) {
  for (const tab of APP_TABS) {
    writeAppEntry(lang, tab);
  }

  writeCompatibilityEntry(lang, buildAppPath(lang, DEFAULT_APP_TAB), lang);
}

for (const tab of APP_TABS) {
  writeCompatibilityEntry(tab, buildAppPath(DEFAULT_APP_LANG, tab));
}

writeCompatibilityEntry('.', buildAppPath(DEFAULT_APP_LANG, DEFAULT_APP_TAB));

const appSitemapUrls = APP_LANGS.flatMap((lang) => APP_TABS.map((tab) => `${SITE_ORIGIN}${buildAppPath(lang, tab)}`));
const appSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${appSitemapUrls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(distDir, 'app-sitemap.xml'), appSitemap, 'utf-8');

const rootSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE_ORIGIN}/app-sitemap.xml</loc></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/blog/sitemap-index.xml</loc></sitemap>
</sitemapindex>
`;
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), rootSitemap, 'utf-8');

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
fs.writeFileSync(path.join(distDir, 'robots.txt'), robots, 'utf-8');

if (fs.existsSync(rootEdgeOnePath)) {
  fs.copyFileSync(rootEdgeOnePath, distEdgeOnePath);
  console.log(`Copied ${rootEdgeOnePath} to ${distEdgeOnePath}`);
}
