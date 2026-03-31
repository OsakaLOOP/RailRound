import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { api } from '../services/api';
import { calculateLatestStats } from '../utils/stats';
import { meta } from '../../public/changelog.json';

const CURRENT_VERSION = meta["currentVersion"];

export const useUserData = () => {
    const {
        user,
        trips,
        pins,
        folders,
        badgeSettings,
        setTrips,
        setPins,
        setFolders,
        setBadgeSettings,
        setUserProfile,
        logout,
        segmentGeometries,
        railwayData,
        geoData
    } = useStore(state => ({
        user: state.user,
        trips: state.trips,
        pins: state.pins,
        folders: state.folders,
        badgeSettings: state.badgeSettings,
        setTrips: state.setTrips,
        setPins: state.setPins,
        setFolders: state.setFolders,
        setBadgeSettings: state.setBadgeSettings,
        setUserProfile: state.setUserProfile,
        logout: state.logout,
        segmentGeometries: state.segmentGeometries,
        railwayData: state.railwayData,
        geoData: state.geoData
    }));

    const saveData = async (token: string, currentTrips: any[], currentPins: any[], currentFolders: any[], currentBadgeSettings: any) => {
        try {
            const latest5 = calculateLatestStats(currentTrips, segmentGeometries, railwayData, geoData);
            await api.saveData(token, currentTrips, currentPins, latest5, CURRENT_VERSION, currentFolders, currentBadgeSettings);
        } catch (e: any) {
            console.error('Failed to save user data:', e);
            throw e;
        }
    };

    const loadUserData = async (token: string, isInteractive = false) => {
        try {
            const cloudData = await api.getData(token);
            setUserProfile(cloudData);

            let newTrips = cloudData.trips || [];
            let newPins = cloudData.pins || [];
            let newFolders = cloudData.folders || [];
            let newBadgeSettings = cloudData.badge_settings || { enabled: true };

            if (isInteractive && (trips.length > 0 || pins.length > 0)) {
                if (window.confirm("检测到本地有数据，是否保留并与云端数据合并？\n\n点击【确定】合并 (Keep Local)\n点击【取消】仅使用云端数据 (Overwrite Local)")) {
                    const tripMap = new Map();
                    newTrips.forEach((t: any) => tripMap.set(t.id, t));
                    trips.forEach((t: any) => tripMap.set(t.id, t));
                    newTrips = Array.from(tripMap.values());

                    const pinMap = new Map();
                    newPins.forEach((p: any) => pinMap.set(p.id, p));
                    pins.forEach((p: any) => pinMap.set(p.id, p));
                    newPins = Array.from(pinMap.values());

                    if (token) {
                        saveData(token, newTrips, newPins, newFolders, newBadgeSettings).catch(e => console.error("Auto sync failed after merge", e));
                    }
                }
            }

            setTrips(newTrips.sort((a: any, b: any) => b.date.localeCompare(a.date)));
            setPins(newPins);
            setFolders(newFolders);
            setBadgeSettings(newBadgeSettings);
            console.log('User data loaded successfully');
        } catch (e: any) {
            console.error('Failed to load user data:', e);
            if (e.message && e.message.includes('Unauthorized')) {
                logout();
            }
        }
    };

    return { loadUserData, saveData };
};
