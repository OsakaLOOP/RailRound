import fs from 'fs';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexHtmlPath)) {
  console.error('dist/index.html not found. Build may have failed.');
  process.exit(1);
}

const baseHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

const LOCALES = [
  { code: 'zh-cn', lang: 'zh-CN', title: 'RailLOOP', description: 'RailLOOP 是一个个人向旅铁手账应用。' },
  { code: 'zh-tw', lang: 'zh-TW', title: 'RailLOOP', description: 'RailLOOP 是一個個人向旅鐵手帳應用。' },
  { code: 'en', lang: 'en', title: 'RailLOOP', description: 'RailLOOP is a personal railway trip log app.' },
  { code: 'ja-jp', lang: 'ja-JP', title: 'RailLOOP', description: 'RailLOOP は個人向けの鉄道旅ログアプリです。' }
];

function applyHead(html, locale) {
  let next = html.replace(/<title>.*?<\/title>/, `<title>${locale.title}</title>`);
  next = next.replace(
    /<meta name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${locale.description}" />`
  );
  next = next.replace(/<html lang="[^"]*"/, `<html lang="${locale.lang}"`);
  return next;
}

for (const locale of LOCALES) {
  const localeDir = path.join(distDir, locale.code);
  if (!fs.existsSync(localeDir)) {
    fs.mkdirSync(localeDir, { recursive: true });
  }
  const localizedHtml = applyHead(baseHtml, locale);
  const outPath = path.join(localeDir, 'index.html');
  fs.writeFileSync(outPath, localizedHtml, 'utf-8');
  console.log(`Generated ${outPath}`);
}
