import React from 'react';
import { Train, LogOut, User, Download, Upload, Building2, FilePlus, Star } from 'lucide-react';
import { useStore } from '../../store';
import { VersionBadge } from '../VersionBadge';
import { PremiumBadge } from '../PremiumBadge';
import changelog from '../../../public/changelog.json';
const { meta } = changelog;
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { useAppRouteState } from '../../hooks/useAppRouteState';

const CURRENT_VERSION = meta["currentVersion"];

export const Header: React.FC<{
    handleExportKML: () => void;
    handleExportUserData: () => void;
    handleImportUserData: (e: any) => void;
    handleCompanyUpload: (e: any) => void;
    handleFileUpload: (e: any) => void;
}> = ({ handleExportKML, handleExportUserData, handleImportUserData, handleCompanyUpload, handleFileUpload }) => {
    const { user, userProfile } = useStore(useShallow(state => ({ user: state.user, userProfile: state.userProfile })));
    const { tab: activeTab } = useAppRouteState();
    const setModalState = useStore(state => state.setModalState);
    const logout = useStore(state => state.logout);
    const { t } = useTranslation();

    return (
        <header className="bg-slate-900 text-white p-4 shadow-md z-30 flex justify-between shrink-0">
            <div id="header-title" className="flex items-center gap-2">
                <Train className="text-emerald-400"/>
                <span className="font-bold">RailLOOP</span>
                <VersionBadge version={CURRENT_VERSION} />
            </div>
            <div className="flex items-center gap-2">
                {user ? (
                   <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-300 hidden sm:inline">{t('header.welcome', '欢迎, {{name}}', { name: user.username })}</span>
                      <PremiumBadge />
                      {(!userProfile?.tier || userProfile.tier === 'free') && (
                        <button
                          onClick={() => setModalState({ isSubscribeOpen: true })}
                          className="bg-amber-600 hover:bg-amber-500 p-2 rounded text-xs flex items-center gap-1 transition font-bold"
                          title={t('premium.subscribe', 'Subscribe to Premium')}
                        >
                          <Star size={14}/>
                        </button>
                      )}
                      <button id="btn-login-user" onClick={logout} className="bg-slate-700 hover:bg-red-900 p-2 rounded text-xs flex items-center gap-1 transition">
                          <LogOut size={14}/><span className="hidden sm:inline">{t('header.logout', '退出')}</span>
                      </button>
                   </div>
                ) : (
                   <button onClick={() => setModalState({ isLoginOpen: true })} className="bg-blue-600 hover:bg-blue-500 p-2 rounded text-xs flex items-center gap-1 transition font-bold">
                       <User size={14}/><span className="hidden sm:inline">{t('header.loginRegister', '登录 / 注册')}</span>
                   </button>
                )}

                {activeTab !== 'map' ? (
                <div id="header-actions" className="flex gap-2 ml-2 border-l border-slate-700 pl-2">
                   <button onClick={handleExportKML} className="cursor-pointer bg-emerald-700 hover:bg-emerald-600 p-2 rounded text-xs flex items-center gap-1 transition">
                       <Download size={14}/><span className="hidden sm:inline">{t('header.exportKML', '导出 KML')}</span>
                   </button>
                    <button onClick={handleExportUserData} className="cursor-pointer bg-emerald-900/50 hover:bg-emerald-800 p-2 rounded text-xs flex items-center gap-1 transition">
                        <Download size={14}/>
                    </button>
                    <label className="cursor-pointer bg-slate-800/50 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition">
                        <Upload size={14}/>
                        <input type="file" accept=".json" className="hidden" onChange={handleImportUserData}/>
                    </label>
                </div>
                ) : (
                <div id="header-actions" className="flex gap-2 ml-2 border-l border-slate-700 pl-2">
                    <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition"><Building2 size={14}/><span className="hidden sm:inline">{t('header.data', '数据')}</span><input type="file" accept=".json" className="hidden" onChange={handleCompanyUpload}/></label>
                    <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 p-2 rounded text-xs flex items-center gap-1 transition"><FilePlus size={14}/><span className="hidden sm:inline">{t('header.mapData', '地图')}</span><input type="file" multiple accept=".geojson,.json" className="hidden" onChange={handleFileUpload}/></label>
                </div>
                )}
            </div>
        </header>
    );
};
