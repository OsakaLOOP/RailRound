export const SITE_ORIGIN = 'https://rail.s3xyseia.xyz';

export const APP_LANGS = ['zh-cn', 'en', 'ja-jp', 'zh-tw'];
export const APP_TABS = ['records', 'map', 'stats'];
export const DEFAULT_APP_LANG = 'zh-cn';
export const DEFAULT_APP_TAB = 'records';

export const APP_LANG_TO_I18N = {
  'zh-cn': 'zh-CN',
  en: 'en',
  'ja-jp': 'ja-JP',
  'zh-tw': 'zh-TW',
};

export const APP_LANG_TO_HTML = {
  'zh-cn': 'zh-CN',
  en: 'en',
  'ja-jp': 'ja-JP',
  'zh-tw': 'zh-TW',
};

export const APP_LANG_TO_HREFLANG = {
  'zh-cn': 'zh-CN',
  en: 'en',
  'ja-jp': 'ja-JP',
  'zh-tw': 'zh-TW',
};

export const APP_SEO = {
  'zh-cn': {
    siteTitle: 'RailLOOP',
    description: 'RailLOOP 是一个个人向旅铁手账应用，用于记录、统计并可视化你的铁路旅行。',
    tabs: {
      records: {
        title: 'RailLOOP | 行程记录',
        description: '记录、整理并管理你的铁路旅行与乘车片段。',
      },
      map: {
        title: 'RailLOOP | 旅行地图',
        description: '在地图上查看你的铁路旅行轨迹、车站与收藏点。',
      },
      stats: {
        title: 'RailLOOP | 统计',
        description: '查看铁路旅行里程、线路覆盖和个人统计数据。',
      },
    },
  },
  en: {
    siteTitle: 'RailLOOP',
    description: 'RailLOOP is a personal railway trip log for recording, analyzing, and visualizing rail journeys.',
    tabs: {
      records: {
        title: 'RailLOOP | Records',
        description: 'Record, organize, and manage your railway trips and ride segments.',
      },
      map: {
        title: 'RailLOOP | Map',
        description: 'View your rail journeys, stations, and saved pins on an interactive map.',
      },
      stats: {
        title: 'RailLOOP | Stats',
        description: 'Explore mileage, line coverage, and personal railway travel statistics.',
      },
    },
  },
  'ja-jp': {
    siteTitle: 'RailLOOP',
    description: 'RailLOOP は鉄道旅行を記録、集計、可視化する個人向けの旅ログアプリです。',
    tabs: {
      records: {
        title: 'RailLOOP | 記録',
        description: '鉄道旅行と乗車区間を記録、整理、管理できます。',
      },
      map: {
        title: 'RailLOOP | マップ',
        description: '鉄道旅行の軌跡、駅、保存したピンを地図で確認できます。',
      },
      stats: {
        title: 'RailLOOP | 統計',
        description: '乗車距離、路線カバー率、個人の鉄道旅行統計を確認できます。',
      },
    },
  },
  'zh-tw': {
    siteTitle: 'RailLOOP',
    description: 'RailLOOP 是一個個人向旅鐵手帳應用，用於記錄、統計並視覺化你的鐵路旅行。',
    tabs: {
      records: {
        title: 'RailLOOP | 行程記錄',
        description: '記錄、整理並管理你的鐵路旅行與乘車片段。',
      },
      map: {
        title: 'RailLOOP | 旅行地圖',
        description: '在地圖上查看你的鐵路旅行軌跡、車站與收藏點。',
      },
      stats: {
        title: 'RailLOOP | 統計',
        description: '查看鐵路旅行里程、路線覆蓋和個人統計資料。',
      },
    },
  },
};

export function isAppLang(value) {
  return APP_LANGS.includes(value);
}

export function isAppTab(value) {
  return APP_TABS.includes(value);
}

export function normalizeAppLang(value, fallback = DEFAULT_APP_LANG) {
  if (!value) return fallback;
  const lang = String(value).trim().toLowerCase().replace(/_/g, '-');
  if (isAppLang(lang)) return lang;
  if (lang === 'zh' || lang.startsWith('zh-cn') || lang.startsWith('zh-hans')) return 'zh-cn';
  if (lang.startsWith('zh-tw') || lang.startsWith('zh-hk') || lang.startsWith('zh-mo') || lang.startsWith('zh-hant')) return 'zh-tw';
  if (lang === 'ja' || lang.startsWith('ja-jp')) return 'ja-jp';
  if (lang === 'en' || lang.startsWith('en-')) return 'en';
  return fallback;
}

export function normalizeAppTab(value, fallback = DEFAULT_APP_TAB) {
  if (!value) return fallback;
  const tab = String(value).trim().toLowerCase();
  return isAppTab(tab) ? tab : fallback;
}

export function toI18nLang(value) {
  return APP_LANG_TO_I18N[normalizeAppLang(value)] || APP_LANG_TO_I18N[DEFAULT_APP_LANG];
}

export function buildAppPath(lang = DEFAULT_APP_LANG, tab = DEFAULT_APP_TAB) {
  return `/${normalizeAppLang(lang)}/${normalizeAppTab(tab)}`;
}

export function buildAppUrl(lang = DEFAULT_APP_LANG, tab = DEFAULT_APP_TAB) {
  return `${SITE_ORIGIN}${buildAppPath(lang, tab)}`;
}

export function buildBlogPath(lang = DEFAULT_APP_LANG, rest = '') {
  const suffix = String(rest || '').replace(/^\/+/, '');
  return `/blog/${normalizeAppLang(lang)}/${suffix}`;
}

export function getCanonicalBlogBase(lang = DEFAULT_APP_LANG) {
  return buildBlogPath(lang);
}

export function getAppSeo(lang = DEFAULT_APP_LANG, tab = DEFAULT_APP_TAB) {
  const normalizedLang = normalizeAppLang(lang);
  const normalizedTab = normalizeAppTab(tab);
  const langSeo = APP_SEO[normalizedLang] || APP_SEO[DEFAULT_APP_LANG];
  return langSeo.tabs[normalizedTab] || {
    title: langSeo.siteTitle,
    description: langSeo.description,
  };
}

export function getRouteInfoFromPath(pathname = '') {
  const parts = pathname.split('/').filter(Boolean);
  const lang = normalizeAppLang(parts[0], null);
  const tab = normalizeAppTab(parts[1], null);
  if (!lang || !tab) return null;
  return { lang, tab };
}

export function getPreferredAppLang(...values) {
  for (const value of values) {
    const lang = normalizeAppLang(value, null);
    if (lang) return lang;
  }
  return DEFAULT_APP_LANG;
}

export function getCanonicalAppPath(pathname = '/', fallbackLang = DEFAULT_APP_LANG) {
  if (pathname === '/blog' || pathname.startsWith('/blog/')) return null;

  const fallback = normalizeAppLang(fallbackLang);
  const parts = pathname.split('/').filter(Boolean);
  const first = parts[0];
  if (!first) return buildAppPath(fallback, DEFAULT_APP_TAB);

  const firstAsTab = normalizeAppTab(first, null);
  if (firstAsTab) return buildAppPath(fallback, firstAsTab);

  const lang = normalizeAppLang(first, null);
  if (lang) {
    const tab = normalizeAppTab(parts[1], DEFAULT_APP_TAB);
    return buildAppPath(lang, tab);
  }

  return buildAppPath(fallback, DEFAULT_APP_TAB);
}

export function buildAppPathForLanguage(pathname = '/', targetLang = DEFAULT_APP_LANG) {
  const info = getRouteInfoFromPath(pathname);
  return buildAppPath(targetLang, info?.tab || DEFAULT_APP_TAB);
}
