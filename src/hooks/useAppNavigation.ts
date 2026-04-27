import { useNavigate, useLocation } from 'react-router-dom';
import { useAppRouteState } from './useAppRouteState';
import { buildAppPath } from '../utils/routes';

export const useAppNavigation = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { lang, tab, canonicalPath, isCanonical } = useAppRouteState();

    const goToTab = (targetTab: string, options?: { preserveSearch?: boolean; preserveHash?: boolean }) => {
        const { preserveSearch = true, preserveHash = true } = options || {};
        const search = preserveSearch ? location.search : '';
        const hash = preserveHash ? location.hash : '';
        navigate(`${buildAppPath(lang, targetTab)}${search}${hash}`);
    };

    const goToLanguage = (targetLang: string, options?: { preserveSearch?: boolean; preserveHash?: boolean }) => {
        const { preserveSearch = true, preserveHash = true } = options || {};
        const search = preserveSearch ? location.search : '';
        const hash = preserveHash ? location.hash : '';
        navigate(`${buildAppPath(targetLang, tab)}${search}${hash}`);
    };

    const goToPathCanonicalIfNeeded = () => {
        if (!isCanonical && canonicalPath) {
             navigate(`${canonicalPath}${location.search}${location.hash}`, { replace: true });
        }
    };

    return { goToTab, goToLanguage, goToPathCanonicalIfNeeded };
};
