import { createContext, useContext } from "react";
const changelogData = { meta: { currentVersion: '1.0.0' } };

const meta = changelogData.meta;

// Global settings/configs that rarely change
export const MetaContext = createContext({
    thememode: 'light',
    devMode: false,
});
export const useMeta = () => useContext(MetaContext);

// Read-only version information and update checks
export const VersionContext = createContext<any>(null);
export const useVersion = () => useContext(VersionContext);
