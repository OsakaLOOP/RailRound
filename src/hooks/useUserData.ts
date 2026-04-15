import { useStore } from '../store';
import { api } from '../services/api';
import { calculateLatestStats } from '../core/tripCalculator';
import { showConfirm } from '../utils/alerts';
import i18next from 'i18next';
import changelog from '../../public/changelog.json';
const { meta } = changelog;

const CURRENT_VERSION = meta["currentVersion"] || "1.0.0";

// Refactored to not be a custom hook that calls useStore() inside it,
// to completely prevent any potential React re-render loops due to useShallow/missing dependencies.
export const useUserData = () => {
    const saveData = async (token: string, currentTrips: any[], currentPins: any[], currentFolders: any[], currentBadgeSettings: any) => {
        try {
            const state = useStore.getState();
            const latest5 = calculateLatestStats(currentTrips, state.segmentGeometries, state.railwayData, state.geoData);
            await api.saveData(token, currentTrips, currentPins, latest5, CURRENT_VERSION, currentFolders, currentBadgeSettings);
        } catch (e: any) {
            console.error('Failed to save user data:', e);
            throw e;
        }
    };

    const loadUserData = async (token: string, isInteractive = false) => {
        try {
            const cloudData = await api.getData(token);
            const state = useStore.getState();

            state.setUserProfile(cloudData);

            let newTrips = cloudData.trips || [];
            let newPins = cloudData.pins || [];
            let newFolders = cloudData.folders || [];
            let newBadgeSettings = cloudData.badge_settings || { enabled: true };

            if (isInteractive && (state.trips.length > 0 || state.pins.length > 0 || state.folders.length > 0 || state.badgeSettings?.defaultMapCenter)) {
                if (await showConfirm(
                    i18next.t('app.mergeConfirmTitle', '数据冲突'),
                    i18next.t('app.mergeConfirm', "检测到本地有数据或个人配置，是否保留并与云端数据合并？\n\n点击【确定】合并 (Keep Local)\n点击【取消】仅使用云端数据 (Overwrite Local)")
                )) {
                    const tripMap = new Map();
                    newTrips.forEach((t: any) => tripMap.set(t.id, t));
                    state.trips.forEach((t: any) => tripMap.set(t.id, t));
                    newTrips = Array.from(tripMap.values());

                    const pinMap = new Map();
                    newPins.forEach((p: any) => pinMap.set(p.id, p));
                    state.pins.forEach((p: any) => pinMap.set(p.id, p));
                    newPins = Array.from(pinMap.values());

                    const folderMap = new Map();
                    newFolders.forEach((f: any) => folderMap.set(f.id, f));
                    state.folders.forEach((f: any) => folderMap.set(f.id, f));
                    newFolders = Array.from(folderMap.values());

                    // Merge badge settings: Cloud > Local > Default
                    newBadgeSettings = {
                        ...state.badgeSettings,
                        ...cloudData.badge_settings,
                        defaultMapCenter: cloudData.badge_settings?.defaultMapCenter || state.badgeSettings?.defaultMapCenter,
                        enabled: cloudData.badge_settings?.enabled !== undefined ? cloudData.badge_settings.enabled : state.badgeSettings?.enabled ?? true
                    };

                    if (token) {
                        saveData(token, newTrips, newPins, newFolders, newBadgeSettings).catch(e => console.error("Auto sync failed after merge", e));
                    }
                }
            } else if (!isInteractive) {
                // Background sync merge fallback for missing remote settings
                if (!cloudData.badge_settings?.defaultMapCenter && state.badgeSettings?.defaultMapCenter) {
                     newBadgeSettings.defaultMapCenter = state.badgeSettings.defaultMapCenter;
                     saveData(token, newTrips, newPins, newFolders, newBadgeSettings).catch(e => console.error("Auto sync settings failed", e));
                }
            }

            state.setTrips(newTrips.sort((a: any, b: any) => b.date.localeCompare(a.date)));
            state.setPins(newPins);
            state.setFolders(newFolders);
            
            // Merge settings: Cloud > Local
            const mergedBadgeSettings = {
                ...state.badgeSettings,
                ...(cloudData.badge_settings || {})
            };
            state.setBadgeSettings(mergedBadgeSettings);
            console.log('User data loaded successfully');
        } catch (e: any) {
            console.error('Failed to load user data:', e);
            if (e.message && e.message.includes('Unauthorized')) {
                useStore.getState().logout();
            }
        }
    };

    return { loadUserData, saveData };
};
