export const BLOG_LANGS = ['zh-cn', 'en', 'ja-jp', 'zh-tw'] as const;

export type BlogLang = (typeof BLOG_LANGS)[number];

export const DEFAULT_BLOG_LANG: BlogLang = 'zh-cn';

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

