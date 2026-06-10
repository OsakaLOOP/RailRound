import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

const normalizeDetectedLanguage = (input: string | null | undefined): string => {
  const lower = String(input || '').toLowerCase().replace('_', '-');
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'ja' || lower.startsWith('ja-')) return 'ja-JP';
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-hant')) return 'zh-TW';
  return 'zh-CN';
};

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en', 'ja-JP', 'zh-TW'],
    debug: true,
    interpolation: {
      escapeValue: false,
    },
    load: 'currentOnly',
    detection: {
      order: ['path', 'localStorage', 'navigator', 'htmlTag'],
      lookupFromPathIndex: 1,
      caches: ['localStorage'],
      convertDetectedLanguage: (lng: string) => normalizeDetectedLanguage(lng),
    },
    backend: {
      loadPath: (lngs: string | readonly string[], namespaces: string | readonly string[]) => {
        const rawLng = normalizeDetectedLanguage((Array.isArray(lngs) ? lngs[0] : lngs) || 'zh-CN');
        const ns = (Array.isArray(namespaces) ? namespaces[0] : namespaces) || 'translation';
        return `/locales/${rawLng}/${ns}.json`;
      },
    },
  });

export default i18n;
