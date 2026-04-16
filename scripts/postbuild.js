import fs from 'fs';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexHtmlPath)) {
  console.error("dist/index.html not found. Build may have failed.");
  process.exit(1);
}

const baseHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

const LOCALES = [
  {
    code: 'zh-cn',
    title: 'RailLOOP - 铁路行程记录与分析',
    description: 'RailLOOP 是一个强大的铁路行程记录工具。它能帮助您可视化乘车路线、统计里程、发现新站点并与好友分享您的铁路旅程。',
    keywords: '铁路, 行程记录, 地图, 里程统计, 铁道迷, RailLOOP, 车站',
    lang: 'zh-CN'
  },
  {
    code: 'zh-tw',
    title: 'RailLOOP - 鐵路行程記錄與分析',
    description: 'RailLOOP 是一個強大的鐵路行程記錄工具。它能幫助您視覺化乘車路線、統計里程、發現新站點並與好友分享您的鐵路旅程。',
    keywords: '鐵路, 行程記錄, 地圖, 里程統計, 鐵道迷, RailLOOP, 車站',
    lang: 'zh-TW'
  },
  {
    code: 'en',
    title: 'RailLOOP - Railway Trip Logger & Map',
    description: 'RailLOOP is a powerful tool to log and visualize your railway trips. Track your mileage, discover new stations, and share your rail adventures with friends.',
    keywords: 'railway, trip logger, map, mileage tracker, railfan, RailLOOP, stations, transit',
    lang: 'en'
  },
  {
    code: 'ja-jp',
    title: 'RailLOOP - 鉄道乗車記録＆マップ',
    description: 'RailLOOPは強力な鉄道乗車記録ツールです。乗車ルートの可視化、走行距離の統計、新しい駅の発見、友人との旅の共有をサポートします。',
    keywords: '鉄道, 乗車記録, マップ, 走行距離, 鉄道ファン, RailLOOP, 駅',
    lang: 'ja-JP'
  }
];

const baseUrl = 'https://rail.s3xyseia.xyz';

function buildHeadTags(locale) {
  let tags = `
  <title>${locale.title}</title>
  <meta name="description" content="${locale.description}" />
  <meta name="keywords" content="${locale.keywords}" />
`;

  // Alternate links
  LOCALES.forEach(loc => {
    tags += `  <link rel="alternate" hreflang="${loc.lang}" href="${baseUrl}/${loc.code}" />\n`;
  });
  // Default alternate
  tags += `  <link rel="alternate" hreflang="x-default" href="${baseUrl}" />\n`;

  // Structured data (ld+json)
  const ldJson = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "RailLOOP",
    "url": baseUrl,
    "description": locale.description,
    "inLanguage": locale.lang
  };

  tags += `  <script type="application/ld+json">\n${JSON.stringify(ldJson, null, 2)}\n  </script>\n`;

  return tags;
}

LOCALES.forEach(locale => {
  const localeDir = path.join(distDir, locale.code);
  if (!fs.existsSync(localeDir)) {
    fs.mkdirSync(localeDir, { recursive: true });
  }

  const headTags = buildHeadTags(locale);

  // Replace the default title with our SEO injected tags
  let localizedHtml = baseHtml.replace(/<title>.*?<\/title>/, headTags);
  // Optional: replace the generic html lang attribute
  localizedHtml = localizedHtml.replace('<html lang="en"', `<html lang="${locale.lang}"`);

  const outPath = path.join(localeDir, 'index.html');
  fs.writeFileSync(outPath, localizedHtml, 'utf-8');
  console.log(`Generated ${outPath}`);
});
