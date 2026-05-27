import React from 'react';
import { Train, LogOut, User, Download, Upload, Building2, Map as MapIcon, Star, Search } from 'lucide-react';
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
        <header className="rl-header text-white px-3 py-3 sm:px-4 z-30 flex justify-between shrink-0">
            <div id="header-title" className="flex items-center gap-2 min-w-0">
                <Train className="rl-brand-mark shrink-0" size={22}/>
                <span className="font-bold tracking-wide">RailLOOP</span>
                <VersionBadge version={CURRENT_VERSION} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
                <button
                    onClick={() => setModalState({ isGlobalSearchOpen: true })}
                    className="rl-header-button"
                    title={t('search.open', 'Search')}
                    aria-label={t('search.open', 'Search')}
                >
                    <Search size={14}/><span className="hidden sm:inline">{t('common.search', 'Search')}</span>
                </button>
                {user ? (
                   <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-300 hidden sm:inline">{t('header.welcome', '欢迎, {{name}}', { name: user.username })}</span>
                      <PremiumBadge />
                      {(!userProfile?.tier || userProfile.tier === 'free') && (
                        <button
                          onClick={() => setModalState({ isSubscribeOpen: true })}
                          className="rl-header-button bg-amber-600/90 hover:bg-amber-500"
                          title={t('premium.subscribe', 'Subscribe to Premium')}
                          aria-label={t('premium.subscribe', 'Subscribe to Premium')}
                        >
                          <Star size={14}/>
                        </button>
                      )}
                      <button
                          id="btn-login-user"
                          onClick={logout}
                          className="rl-header-button rl-header-button-danger"
                          title={t('header.logout', '退出')}
                          aria-label={t('header.logout', '退出')}
                      >
                          <LogOut size={14}/><span className="hidden sm:inline">{t('header.logout', '退出')}</span>
                      </button>
                   </div>
                ) : (
                   <button
                       onClick={() => setModalState({ isLoginOpen: true })}
                       className="rl-header-button bg-blue-600 hover:bg-blue-700 border-blue-600/50 text-white"
                       title={t('header.loginRegister', '登录 / 注册')}
                       aria-label={t('header.loginRegister', '登录 / 注册')}
                   >
                       <User size={14}/><span className="hidden sm:inline">{t('header.loginRegister', '登录 / 注册')}</span>
                   </button>
                )}

                {activeTab !== 'map' ? (
                <div id="header-actions" className="flex gap-2 border-l border-slate-700/70 pl-2">
                   <button
                       onClick={handleExportKML}
                       className="rl-header-button bg-emerald-600 hover:bg-emerald-700 border-emerald-600/50 text-white cursor-pointer"
                       title={t('header.exportKML', '导出 KML')}
                       aria-label={t('header.exportKML', '导出 KML')}
                   >
                       <Download size={14}/><span className="hidden sm:inline">{t('header.exportKML', '导出 KML')}</span>
                   </button>
                    <button
                        onClick={handleExportUserData}
                        className="rl-header-button bg-emerald-600 hover:bg-emerald-700 border-emerald-600/50 text-white cursor-pointer w-9 h-9 p-0 justify-center items-center"
                        title={t('header.exportData', 'Export backup')}
                        aria-label={t('header.exportData', 'Export backup')}
                    >
                        <Download size={18}/>
                    </button>
                    <label
                        className="rl-header-button bg-emerald-600 hover:bg-emerald-700 border-emerald-600/50 text-white cursor-pointer w-9 h-9 p-0 justify-center items-center"
                        title={t('header.importData', 'Import backup')}
                        aria-label={t('header.importData', 'Import backup')}
                    >
                        <Upload size={18}/>
                        <input type="file" accept=".json" className="hidden" onChange={handleImportUserData}/>
                    </label>
                </div>
                ) : (
                <div id="header-actions" className="flex gap-2 border-l border-slate-700/70 pl-2">
                    <label className="rl-header-button cursor-pointer" title={t('header.data', '数据')} aria-label={t('header.data', '数据')}><Building2 size={14}/><span className="hidden sm:inline">{t('header.data', '数据')}</span><input type="file" accept=".json" className="hidden" onChange={handleCompanyUpload}/></label>
                    <label className="rl-header-button cursor-pointer" title={t('header.mapData', '地图')} aria-label={t('header.mapData', '地图')}><MapIcon size={14}/><span className="hidden sm:inline">{t('header.mapData', '地图')}</span><input type="file" multiple accept=".geojson,.json" className="hidden" onChange={handleFileUpload}/></label>
                </div>
                )}
            </div>
        </header>
    );
};
