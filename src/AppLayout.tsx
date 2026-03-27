import React, { useState, useRef, useEffect } from 'react';
import { DragProvider } from './components/DragContext';
import Chest from './components/Chest';
import StationMenu from './components/StationMenu';
import Tutorial from './components/Tutorial';
import { LoginModal } from './components/LoginModal';
import { GithubRegisterModal } from './components/modals/GithubRegisterModal';
import { GithubCardModal } from './components/modals/GithubCardModal';
import { FolderManagerModal } from './components/modals/FolderManagerModal';
import { AddToFolderModal } from './components/modals/AddToFolderModal';
import { TripEditor } from './components/modals/TripEditor';
import { MapContainer } from './components/map/MapContainer';
import { PinEditor } from './components/map/PinEditor';
import { FabButton } from './components/map/FabButton';
import { Header } from './components/layout/Header';
import { BottomNav } from './components/layout/BottomNav';
import { TripsPage } from './pages/TripsPage';
import { StatsPage } from './pages/StatsPage';
import { useStore } from './store';
import { db } from './utils/db';
import buildKMLString from './buildKml';
import { sliceGeoJsonPath, calculateLatestStats } from './utils/stats';

export const AppLayout: React.FC = () => {
    const {
        activeTab, user, setModalState, loadUserDataAction // Abstracted action or inline
    } = useStore(state => ({
        activeTab: state.activeTab,
        user: state.user,
        setModalState: state.setModalState
    }));

    const [stationMenu, setStationMenu] = useState<any>(null);
    const isDraggingRef = useRef(false);

    // Provide handlers for Header (Export/Import/Upload logic here or in thunks)
    const handleExportKML = () => { /* Export Logic */ };
    const handleExportUserData = () => { /* Export Logic */ };
    const handleImportUserData = (e: any) => { /* Import Logic */ };
    const handleCompanyUpload = (e: any) => { /* Upload Logic */ };
    const handleFileUpload = (e: any) => { /* GeoJSON Upload Logic */ };

    return (
        <DragProvider>
            <div className="flex flex-col h-screen bg-slate-100 font-sans text-slate-800 overflow-visible">
                <Header
                    handleExportKML={handleExportKML}
                    handleExportUserData={handleExportUserData}
                    handleImportUserData={handleImportUserData}
                    handleCompanyUpload={handleCompanyUpload}
                    handleFileUpload={handleFileUpload}
                />

                <div className="flex-1 relative overflow-hidden flex flex-col">
                    {activeTab === 'records' && <TripsPage />}
                    {activeTab === 'stats' && <StatsPage />}

                    <div className={`flex-1 relative ${activeTab === 'map' ? 'block' : 'hidden'}`}>
                        <MapContainer setStationMenu={setStationMenu} isDraggingRef={isDraggingRef} />
                        <FabButton />
                        <PinEditor />
                    </div>
                </div>

                <TripEditor />

                {/* Global Modals & Components */}
                <LoginModal isOpen={useStore.getState().modals.isLoginOpen} onClose={() => setModalState({ isLoginOpen: false })} onLoginSuccess={(data: any) => { useStore.getState().login(data.token, data.username); }} />
                <GithubRegisterModal />
                <GithubCardModal />
                <FolderManagerModal />
                <AddToFolderModal />

                {stationMenu && (
                    <StationMenu
                        position={stationMenu}
                        stationData={stationMenu.stationData}
                        railwayData={useStore.getState().railwayData}
                        onClose={() => setStationMenu(null)}
                    />
                )}

                <Chest />
                <BottomNav />
            </div>
        </DragProvider>
    );
};
