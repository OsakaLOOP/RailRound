export const SITE_ORIGIN: string;
export const APP_LANGS: readonly string[];
export const APP_TABS: readonly string[];
export const DEFAULT_APP_LANG: string;
export const DEFAULT_APP_TAB: string;
export const APP_LANG_TO_I18N: Record<string, string>;
export const APP_LANG_TO_HTML: Record<string, string>;
export const APP_LANG_TO_HREFLANG: Record<string, string>;
export const APP_SEO: Record<string, any>;

export function isAppLang(value: unknown): boolean;
export function isAppTab(value: unknown): boolean;
export function normalizeAppLang(value: unknown, fallback?: string | null): string | null;
export function normalizeAppTab(value: unknown, fallback?: string | null): string | null;
export function toI18nLang(value: unknown): string;
export function buildAppPath(lang?: string | null, tab?: string | null): string;
export function buildAppUrl(lang?: string | null, tab?: string | null): string;
export function buildBlogPath(lang?: string | null, rest?: string): string;
export function buildFeedbackCallbackPath(lang?: string | null): string;
export function getCanonicalBlogBase(lang?: string | null): string;
export function getAppSeo(lang?: string | null, tab?: string | null): { title: string; description: string };
export function getRouteInfoFromPath(pathname?: string): { lang: string; tab: string } | null;
export function getPreferredAppLang(...values: unknown[]): string;
export function getCanonicalAppPath(pathname?: string, fallbackLang?: string | null): string | null;
export function buildAppPathForLanguage(pathname?: string, targetLang?: string | null): string;

