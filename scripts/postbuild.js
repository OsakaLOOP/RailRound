import fs from 'fs';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const publicDir = path.resolve(process.cwd(), 'public');

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
    lang: 'zh-CN',
    localePath: 'zh-CN'
  },
  {
    code: 'zh-tw',
    title: 'RailLOOP - 鐵路行程記錄與分析',
    description: 'RailLOOP 是一個強大的鐵路行程記錄工具。它能幫助您視覺化乘車路線、統計里程、發現新站點並與好友分享您的鐵路旅程。',
    keywords: '鐵路, 行程記錄, 地圖, 里程統計, 鐵道迷, RailLOOP, 車站',
    lang: 'zh-TW',
    localePath: 'zh-TW'
  },
  {
    code: 'en',
    title: 'RailLOOP - Railway Trip Logger & Map',
    description: 'RailLOOP is a powerful tool to log and visualize your railway trips. Track your mileage, discover new stations, and share your rail adventures with friends.',
    keywords: 'railway, trip logger, map, mileage tracker, railfan, RailLOOP, stations, transit',
    lang: 'en',
    localePath: 'en'
  },
  {
    code: 'ja-jp',
    title: 'RailLOOP - 鉄道乗車記録＆マップ',
    description: 'RailLOOPは強力な鉄道乗車記録ツールです。乗車ルートの可視化、走行距離の統計、新しい駅の発見、友人との旅の共有をサポートします。',
    keywords: '鉄道, 乗車記録, マップ, 走行距離, 鉄道ファン, RailLOOP, 駅',
    lang: 'ja-JP',
    localePath: 'ja-JP'
  }
];

const baseUrl = 'https://rail.s3xyseia.xyz';

function buildHeadTags(locale) {
  let tags = `
  <title>${locale.title}</title>
  <meta name="description" content="${locale.description}" />
  <meta name="keywords" content="${locale.keywords}" />
`;

  LOCALES.forEach(loc => {
    tags += `  <link rel="alternate" hreflang="${loc.lang}" href="${baseUrl}/${loc.code}" />\n`;
  });
  tags += `  <link rel="alternate" hreflang="x-default" href="${baseUrl}" />\n`;

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

// 1. Extract Latest Changelog
let changelogText = '';
try {
  const changelogData = JSON.parse(fs.readFileSync(path.join(publicDir, 'changelog.json'), 'utf-8'));
  if (changelogData.logs && changelogData.logs.length > 0) {
    const latest = changelogData.logs[0];
    changelogText = `<h2>Latest Update: Version ${latest.version} (${latest.date})</h2><p>${latest.content}</p>`;
  }
} catch (e) {
  console.warn("Failed to parse changelog.json", e.message);
}

// 2. Extract Company Data
let companiesText = '';
try {
  const companyData = JSON.parse(fs.readFileSync(path.join(publicDir, 'company_data.json'), 'utf-8'));
  companiesText = `<h3>Supported Companies</h3><ul>` + Object.keys(companyData).map(c => `<li>${c}</li>`).join('') + `</ul>`;
} catch (e) {
  console.warn("Failed to parse company_data.json", e.message);
}

// 3. Extract GeoJSON hierarchy
let geojsonHierarchyHtml = '<h3>Railway Network</h3><ul>';
try {
  const geojsonDir = path.join(publicDir, 'geojson');
  if (fs.existsSync(geojsonDir)) {
    const files = fs.readdirSync(geojsonDir).filter(f => f.endsWith('.geojson') || f.endsWith('.json'));

    // Structure: company -> line -> stations[]
    const hierarchy = {};

    files.forEach(file => {
      try {
        const fileData = JSON.parse(fs.readFileSync(path.join(geojsonDir, file), 'utf-8'));
        if (fileData.features) {
          fileData.features.forEach(feature => {
            const props = feature.properties || {};
            const type = props.type;
            const name = props.name || 'Unknown';
            const comp = props.company || props.operator || 'Unknown Company';

            if (type === 'line') {
              if (!hierarchy[comp]) hierarchy[comp] = {};
              if (!hierarchy[comp][name]) hierarchy[comp][name] = new Set();
            } else if (type === 'station') {
              const line = props.line || 'Unknown Line';
              if (!hierarchy[comp]) hierarchy[comp] = {};
              if (!hierarchy[comp][line]) hierarchy[comp][line] = new Set();
              hierarchy[comp][line].add(name);
            }
          });
        }
      } catch (err) {
        console.warn(`Failed to process ${file}`, err.message);
      }
    });

    for (const [comp, lines] of Object.entries(hierarchy)) {
      geojsonHierarchyHtml += `<li><strong>${comp}</strong><ul>`;
      for (const [line, stations] of Object.entries(lines)) {
        geojsonHierarchyHtml += `<li><em>${line}</em>: ${Array.from(stations).join(', ')}</li>`;
      }
      geojsonHierarchyHtml += `</ul></li>`;
    }
  }
} catch (e) {
  console.warn("Failed to process geojson folder", e.message);
}
geojsonHierarchyHtml += '</ul>';

// Generate for each locale
LOCALES.forEach(locale => {
  const localeDir = path.join(distDir, locale.code);
  if (!fs.existsSync(localeDir)) {
    fs.mkdirSync(localeDir, { recursive: true });
  }

  const headTags = buildHeadTags(locale);

  let localizedHtml = baseHtml.replace(/<title>.*?<\/title>/, headTags);
  localizedHtml = localizedHtml.replace('<html lang="en"', `<html lang="${locale.lang}"`);

  // 4. Extract Locale JSON
  let localeTextHtml = '';
  try {
    const localeFilePath = path.join(publicDir, 'locales', locale.localePath, 'translation.json');
    if (fs.existsSync(localeFilePath)) {
      const localeData = JSON.parse(fs.readFileSync(localeFilePath, 'utf-8'));
      // Flatten locale object to string values
      const extractValues = (obj) => {
        let values = [];
        for (const val of Object.values(obj)) {
          if (typeof val === 'string') values.push(val);
          else if (typeof val === 'object') values = values.concat(extractValues(val));
        }
        return values;
      };
      const allStrings = extractValues(localeData);
      localeTextHtml = `<h3>App Texts</h3><p>${allStrings.join(' | ')}</p>`;
    }
  } catch (e) {
    console.warn(`Failed to process locale ${locale.localePath}`, e.message);
  }

  // Combine SEO block
  const seoBlock = `
    <div id="seo-content" style="display:none;" aria-hidden="true">
      <h1>${locale.title}</h1>
      <p>${locale.description}</p>
      ${changelogText}
      ${companiesText}
      ${geojsonHierarchyHtml}
      ${localeTextHtml}
    </div>
  `;

  // Inject before closing </body>
  localizedHtml = localizedHtml.replace('</body>', `${seoBlock}\n</body>`);

  const outPath = path.join(localeDir, 'index.html');
  fs.writeFileSync(outPath, localizedHtml, 'utf-8');
  console.log(`Generated ${outPath}`);
});
