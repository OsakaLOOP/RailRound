import React, { useEffect, useState, useEffectEvent } from "react";
import { verCalc, isVerSupported, verCmp } from "./utils/verCalc";
import { MetaContext, VersionContext } from "./contexts";

export const GlobalProvider = ({ children }) => {
    const [versionInfo, setVersionInfo] = useState({
        currentVer: "0.0.0",
        lastModified: "",
        lastUpdated: "",
        minVer: "0.20",
        rawLogs: [],
        ver: verCalc("0.0.0"),
        isSupported: true,
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
        const checkUpdate = async () => {
            try {
                const res = await fetch(`/changelog.json?t=${Date.now()}`);
                if (!res.ok) return;
                const data = await res.json();
                onUpdateReceived(data);
            } catch (e) { console.warn("[RailLOOP] Update Check failed", e); }
        }
        const timer = setInterval(checkUpdate, 600000); // 10 minutes
        checkUpdate();
        return () => clearInterval(timer);
    }, []);

    const [devMode, setDevMode] = useState(false);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('dev') === '1' || urlParams.get('dev') === 'true') {
            setDevMode(true);
        }
    }, []);

    const metaContextValue = {
        currentVersion: versionInfo.currentVer,
        lastModified: versionInfo.lastModified,
        lastUpdated: versionInfo.lastUpdated,
        minVer: versionInfo.minVer,
        devMode
    };

    return (
        <VersionContext.Provider value={versionInfo}>
            <MetaContext.Provider value={metaContextValue}>
                {children}
            </MetaContext.Provider>
        </VersionContext.Provider>
    );
};
