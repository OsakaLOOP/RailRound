import { createContext, useContext } from "react";
import changelogData from '../public/changelog.json';

const meta = changelogData.meta;

// Global settings/configs that rarely change
export const MetaContext = createContext({
    thememode: 'light',
    area: 'JP',
    locale: 'zh-CN',
    devMode: false,
});
export const useMeta = () => useContext(MetaContext);

// Read-only version information and update checks
export const VersionContext = createContext<any>(null);
export const useVersion = () => useContext(VersionContext);
