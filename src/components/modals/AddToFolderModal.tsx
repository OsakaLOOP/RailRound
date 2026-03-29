import React, { useEffect } from 'react';
import { X, Star, CheckCircle2 } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { calculateLatestStats } from '../../utils/stats';

export const AddToFolderModal: React.FC = () => {
    const { isOpen, trip, folders, trips, segmentGeometries, railwayData, geoData } = useStore(useShallow(state => ({
        isOpen: state.modals.addToFolderModalOpen,
        trip: state.modals.currentTripForFolder,
        folders: state.folders,
        trips: state.trips,
        segmentGeometries: state.segmentGeometries,
        railwayData: state.railwayData,
        geoData: state.geoData
    })));
    const setModalState = useStore(state => state.setModalState);
    const setFolders = useStore(state => state.setFolders);

    const onClose = () => setModalState({ addToFolderModalOpen: false, currentTripForFolder: null });

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    if (!isOpen || !trip) return null;

    const toggleFolder = (folderId: string) => {
        const updatedFolders = folders.map(f => {
            if (f.id === folderId) {
                const currentIds = new Set(f.trip_ids || []);
                if (currentIds.has(trip.id)) {
                    currentIds.delete(trip.id);
                } else {
                    currentIds.add(trip.id);
                }
                const newIds = Array.from(currentIds);

                // Recalculate stats for modified folder
                let stats = null;
                if (newIds.length > 0) {
                    const folderTrips = trips.filter(t => newIds.includes(t.id));
                    folderTrips.sort((a,b) => b.date.localeCompare(a.date));
                    stats = calculateLatestStats(folderTrips, segmentGeometries, railwayData, geoData);
                }

                return { ...f, trip_ids: newIds, stats };
            }
            return f;
        });
        setFolders(updatedFolders);
    };

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-xs rounded-xl shadow-2xl p-4 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-base text-gray-800 flex items-center gap-2"><Star size={18} className="text-yellow-500 fill-yellow-500"/> Add to Folder</h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
                </div>
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                    {folders.length === 0 && <div className="text-center text-gray-400 text-xs py-4">No folders created. Go to Stats page to create one.</div>}
                    {folders.map(f => {
                        const isSelected = f.trip_ids?.includes(trip.id);
                        return (
                            <button
                                key={f.id}
                                onClick={() => toggleFolder(f.id)}
                                className={`w-full p-3 rounded-lg flex items-center justify-between text-sm transition-colors ${isSelected ? 'bg-yellow-50 border border-yellow-200 text-yellow-800' : 'bg-gray-50 border border-transparent text-gray-600 hover:bg-gray-100'}`}
                            >
                                <span className="font-bold truncate">{f.name}</span>
                                {isSelected && <CheckCircle2 size={16} className="text-yellow-500"/>}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
