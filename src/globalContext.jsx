import { createContext, useContext, useEffect, useState, useEffectEvent } from "react";
import { verCalc, isVerSupported, verCmp } from "./utils/verCalc";
import changelogData from '../public/changelog.json';

const meta = changelogData.meta;
const logs = changelogData.logs;

// Global settings/configs that rarely change
export const MetaContext = createContext({
    thememode: 'light',
    area: 'JP',
    locale: 'zh-CN',
});
export const useMeta = () => useContext(MetaContext);

// Read-only version information and update checks
export const VersionContext = createContext(null);
export const useVersion = () => useContext(VersionContext);

export const GlobalProvider = ({ children }) => {
    const [versionInfo, setVersionInfo] = useState({
        currentVer: meta["currentVersion"],
        lastModified: meta["lastModified"],
        lastUpdated: meta["lastUpdated"],
        minVer: meta["minVer"]||"0.20",
        rawLogs: logs,
        ver: verCalc(meta["currentVersion"]),
        isSupported: isVerSupported(meta["currentVersion"], meta["minVer"]||"0.20"),
    });

    const [hasUpdate, setHasUpdate] = useState(null);

    const onUpdateReceived = useEffectEvent((remoteData) => {
        const remoteMeta = remoteData.meta;
        const remoteVer = remoteMeta.currentVersion;        
        const cmpRes = verCmp(remoteVer, versionInfo.currentVer);
        
        if (cmpRes && cmpRes.diff > 0) {
            console.log(`[RailLOOP] Update Available: ${remoteVer} (current: ${versionInfo.currentVer}), min supported: ${remoteMeta.minVer || "0.20"})`);
            setHasUpdate(cmpRes.at);
            setVersionInfo({
                currentVer: remoteVer,
                lastModified: remoteMeta.lastModified,
                lastUpdated: remoteMeta.lastUpdated,
                minVer: remoteMeta.minVer || "0.20",
                rawLogs: remoteData.logs,
                ver: verCalc(remoteVer),
                isSupported: isVerSupported(remoteVer, remoteMeta.minVer || "0.20")
            });
        }
    });

    useEffect(() => {
        const checkUpdate = async() => {
            try {
                const res = await fetch(`/changelog.json?t=${Date.now()}`);
                if (!res.ok) return;
                const data = await res.json();
                onUpdateReceived(data);
            } catch(e){ console.warn("[RailLOOP] Update Check failed", e); }
        }
        const timer = setInterval(checkUpdate, 600000); // 10 minutes
        checkUpdate();
        return () => clearInterval(timer);
    }, []);

    // Removed UserDataContext, AuthContext, GeoContext as they are now handled by Zustand
    return (
        <VersionContext value={versionInfo}>
            <MetaContext value={meta}>
                {children}
            </MetaContext>
        </VersionContext>
    );
};
