import { useLocation, useParams } from 'react-router-dom';
import { getRouteInfoFromPath, getCanonicalAppPath, normalizeAppLang, DEFAULT_APP_LANG, DEFAULT_APP_TAB } from '../utils/routes';
import { useStore } from '../store';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';

export interface AppRouteState {
    lang: string;
    tab: string;
    canonicalPath: string;
    isCanonical: boolean;
}

export const useAppRouteState = (): AppRouteState => {
    const location = useLocation();
    const params = useParams();
    const { i18n } = useTranslation();
    const badgeLanguage = useStore(state => state.badgeSettings.language);

    return useMemo(() => {
        const info = getRouteInfoFromPath(location.pathname);
        
        let lang = info?.lang || normalizeAppLang(params.lang, null);
        if (!lang) {
             lang = normalizeAppLang(badgeLanguage) || normalizeAppLang(i18n.language) || DEFAULT_APP_LANG;
        }

        const tab = info?.tab || DEFAULT_APP_TAB;
        
        const canonicalPath = getCanonicalAppPath(location.pathname, lang) || `/${lang}/${tab}`;
        const isCanonical = canonicalPath === location.pathname;

        return {
            lang,
            tab,
            canonicalPath,
            isCanonical
        };
    }, [location.pathname, params.lang, badgeLanguage, i18n.language]);
};
