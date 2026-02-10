/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useMemo, useEffectEvent, useCallback, useRef, use } from "react";
// createContext, 这是让一切好起来的关键!

import { api } from "./services/api";
import { db } from "./utils/db";
import { verCalc, isVerSupported, verCmp } from "./utils/verCalc";
import { meta, logs } from '../public/changelog.json';

export const MetaContext = createContext({
        thememode: 'light',
        area: 'JP', // 用于决定地图显示区域等
        locale: 'zh-CN', 
});// 注意这里的 Meta 代表全局设置, 与版本信息的 meta 无关.
export const useMeta = () => useContext(MetaContext);// Hook

export const VersionContext = createContext(null);
export const useVersion = () => useContext(VersionContext);// Hook

export const AuthContext = createContext({
    isLoggedIn: false,
    username: null,
    token: null,// a.k.a. user. 
    userProfile: null,

});// 用于用户登录逻辑的迁移. 还要创建其他 Hook. UserDataContext 必须实现 actions 对象，封装所有数据修改逻辑(含乐观更新).


export const UserDataContext = createContext(null);// 用于用户数据存储的迁移. 后面将采用 S3.
export const useAuth = () => useContext(AuthContext);
export const useUserData = () => useContext(UserDataContext)// Hook

export const GeoContext = createContext(null);
export const useGeo = () => useContext(GeoContext);// Hook
// 用于地理数据加载和 Worker 通信


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

    const onUpdateReceived = useEffectEvent((remoteData) => {
        // 确保 versionInfo.currentVer 永远是最新的

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
    });// react 19.2 新 Hook, 避免闭包.

    useEffect(() => {
        const checkUpdate = async() => {
            try{
                const res = await fetch(`/changelog.json?t=${Date.now()}`);
                if (!res.ok) return;
                const data = await res.json();
                
                onUpdateReceived(data);
                
            } catch(e){console.warn("[RailLOOP] Update Check failed", e);}

        }
        const timer = setInterval(checkUpdate, 600000);// 每10分钟检查
        checkUpdate();
        return () => clearInterval(timer);

    }, []);// 只挂载一次

    // Auth State
    const [user, setUser] = useState({
        isLoggedIn: false,
        token: null,
        username: null,
    });
    const [userProfile, setUserProfile] = useState(null);
    
    const login = useCallback(async (token, username) => {
        setUser({isLoggedIn:true, token, username });
        localStorage.setItem('railloop_token', token);
        localStorage.setItem('railloop_username', username);
    }, []);

    const logout = useCallback(() => {
        setUser({isLoggedIn:false, username:null, token:null});
        setUserProfile(null);
        localStorage.removeItem('railloop_token');
        localStorage.removeItem('railloop_username');
        window.location.href = '/';
    }, []);

    return (
        <VersionContext value={versionInfo}>
            <MetaContext value={meta}>
                <AuthContext value={user}>
                    <GeoContext value={null}>
                        <UserDataContext value={null}>
                            {children}
                        </UserDataContext>
                    </GeoContext>
                </AuthContext>
            </MetaContext>
        </VersionContext>
    );// react 19+ 特性, 不需要使用.Provider. Working at 19.2.4.
};