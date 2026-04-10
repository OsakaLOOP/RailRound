import React, { useEffect, useState, useEffectEvent } from "react";
import { verCalc, isVerSupported, verCmp } from "./utils/verCalc";
import changelogData from '../public/changelog.json';
import { MetaContext, VersionContext } from "./contexts";

const meta = changelogData.meta;
const logs = changelogData.logs;

export const GlobalProvider = ({ children }) => {
    const [versionInfo, setVersionInfo] = useState({
        currentVer: meta["currentVersion"],
        lastModified: meta["lastModified"],
        lastUpdated: meta["lastUpdated"],
        minVer: meta["minVer"] || "0.20",
        rawLogs: logs,
        ver: verCalc(meta["currentVersion"]),
        isSupported: isVerSupported(meta["currentVersion"], meta["minVer"] || "0.20"),
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
        ...meta,
        devMode
    };

    return (
        <VersionContext value={versionInfo}>
            <MetaContext value={metaContextValue}>
                {children}
            </MetaContext>
        </VersionContext>
    );
};
