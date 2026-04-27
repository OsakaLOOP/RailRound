export const BLOG_LANGS = ['zh-cn', 'en', 'ja-jp', 'zh-tw'] as const;

export type BlogLang = (typeof BLOG_LANGS)[number];

export const DEFAULT_BLOG_LANG: BlogLang = 'zh-cn';

export const BLOG_LANG_TO_HREFLANG: Record<BlogLang, string> = {
  'zh-cn': 'zh-CN',
  en: 'en',
  'ja-jp': 'ja-JP',
  'zh-tw': 'zh-TW',
};

const CONTENT_TO_URL_CATEGORY: Record<string, string> = {
  dev: 'dev',
  docs: 'doc',
};

const URL_TO_CONTENT_CATEGORY: Record<string, string> = {
  dev: 'dev',
  doc: 'docs',
  docs: 'docs',
};

export function isBlogLang(value: string | undefined): value is BlogLang {
  if (!value) return false;
  return (BLOG_LANGS as readonly string[]).includes(value);
}

export function normalizeBlogLang(value: string | undefined): BlogLang {
  return isBlogLang(value) ? value : DEFAULT_BLOG_LANG;
}

export function canonicalBlogPath(pathname: string): string {
  const parts = pathname.replace(/^\/blog\/?/, '').split('/').filter(Boolean);
  const firstSegment = parts[0];
  const lang = normalizeBlogLang(firstSegment);
  const rest = isBlogLang(firstSegment) ? parts.slice(1) : parts;
  const suffix = rest.length > 0 ? `${rest.join('/')}/` : '';
  return `/blog/${lang}/${suffix}`;
}

export function blogAlternatePath(pathname: string, lang: BlogLang): string {
  const parts = canonicalBlogPath(pathname).replace(/^\/blog\/?/, '').split('/').filter(Boolean);
  const rest = parts.slice(1);
  const suffix = rest.length > 0 ? `${rest.join('/')}/` : '';
  return `/blog/${lang}/${suffix}`;
}

export function getPostSlug(id: string, version?: string): string {
  if (version) return `v${version}`;
  const slugPart = id.split('/').pop();
  return slugPart || id;
}

export function toUrlCategory(category: string): string {
  return CONTENT_TO_URL_CATEGORY[category] || category;
}

export function toContentCategory(category: string): string {
  return URL_TO_CONTENT_CATEGORY[category] || category;
}

