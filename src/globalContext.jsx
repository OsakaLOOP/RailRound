/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useMemo } from "react";// createContext, 这是让一切好起来的关键!
import { verCalc, isVerSupported, verCmp } from "./utils/verCalc";
import { meta, logs } from '../public/changelog.json';

export const VersionContext = createContext(null);
export const useVersion = () => useContext(VersionContext);// Hook

export const UserMetaContext = createContext({
    isLoggedIn: false,
    username: null,
    token: null,

});// 用于用户登录逻辑的迁移
export const UserDataContext = createContext(null);// 用于用户数据存储的迁移
export const useUserMeta = () => useContext(UserMetaContext);
export const useUserData = () => useContext(UserDataContext)// Hook

export const RouteContext = createContext(null);// 现在只是 SPA, 所以考虑引入路由和上下文, 不要搞得全是弹窗.
export const useRouteContext = () => useContext(RouteContext);// Hook

// geoContext

export const GlobalProvider = ({ children }) => {

    const [versionInfo, setVersionInfo] = useState({
        currentVer: meta["currentVersion"],
        lastModified: meta["lastModified"],
        lastUpdated: meta["lastUpdated"],
        minVer: meta["minVer"]||"0.20",
        rawLogs: logs,
        ver: verCalc(meta["currentVersion"]),
        isSupported: isVerSupported(meta["currentVersion"], meta["minVer"]||"0.20"),
    });// 用于完善版本检查, 提示等. 为了让 Context 有更多用处, 我们考虑支持热更新.

    const [hasUpdate, setHasUpdate] = useState(null);

    useEffect(() => {
        const checkUpdate = async() => {
            try{
                const res = await fetch(`/changelog.json?t=${Date.now()}`);
                if (!res.ok) return;
                const data = await res.json();
                const remoteVer = data.meta.currentVersion;
                const cmpRes = verCmp(remoteVer,versionInfo.currentVer);
                
                if (cmpRes.diff > 0) {
                    setHasUpdate(cmpRes.at);
                    const remoteMeta = data.meta;
                    const remoteLogs = data.logs;
                    setVersionInfo({
                        // 直接字段映射
                        currentVer: remoteMeta.currentVersion,
                        lastModified: remoteMeta.lastModified,
                        lastUpdated: remoteMeta.lastUpdated,
                        minVer: remoteMeta.minVer || "0.20",
                        rawLogs: remoteLogs,
                        
                        // 重新计算字段
                        ver: verCalc(remoteMeta.currentVersion),
                        isSupported: isVerSupported(remoteMeta.currentVersion, remoteMeta.minVer || "0.20")
                    });                }

            } catch(e){console.warn("[RailLOOP] Update Check failed", e);}

        }
        const timer = setInterval(checkUpdate, 600000);// 每10分钟检查
        checkUpdate();
        return () => clearInterval(timer);

    }, []);// 只挂载一次

    const userInfo = {
        isLoggedIn: false,
        username: null,
        token: null,
    };

    
    return (
        <VersionContext.Provider value={versionInfo}>
            <RouteContext.Provider value={null}>
                <UserMetaContext.Provider value={userInfo}>
                    <UserDataContext.Provider value={null}>
                        {children}
                    </UserDataContext.Provider>
                </UserMetaContext.Provider>
            </RouteContext.Provider>
        </VersionContext.Provider>
    );// react 19+ 特性可以不要.Provider, 但是还没做好准备迁移
};