import React from 'react';
import { Helmet } from 'react-helmet-async';
import { AppRouteState } from '../../hooks/useAppRouteState';
import { getAppSeo, APP_LANGS, APP_LANG_TO_HREFLANG, APP_LANG_TO_HTML, SITE_ORIGIN, buildAppUrl } from '../../utils/routes';

interface AppSEOProps {
    routeState: AppRouteState;
}

export const AppSEO: React.FC<AppSEOProps> = ({ routeState }) => {
    const { lang, tab, canonicalPath } = routeState;
    const seo = getAppSeo(lang, tab);

    return (
        <Helmet htmlAttributes={{ lang: APP_LANG_TO_HTML[lang] || lang }}>
            <title>{seo.title}</title>
            <meta name="description" content={seo.description} />
            
            {/* canonical links */}
            {canonicalPath && (
                 <link rel="canonical" href={`${SITE_ORIGIN}${canonicalPath}`} />
            )}

            {/* hreflang links */}
            {APP_LANGS.map((l) => (
                <link 
                    key={l} 
                    rel="alternate" 
                    hrefLang={APP_LANG_TO_HREFLANG[l] || l} 
                    href={buildAppUrl(l, tab)} 
                />
            ))}
            <link rel="alternate" hrefLang="x-default" href={buildAppUrl('zh-cn', tab)} />
        </Helmet>
    );
};
