import React from 'react';
import { Star, CheckCircle2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUserData } from '../globalContext';

export default function AddToFolderModal() {
    const navigate = useNavigate();
    const { tripId } = useParams();
    const { folders, saveData, trips } = useUserData();

    const trip = trips.find(t => t.id.toString() === tripId);
    const onClose = () => navigate(-1);

    if (!trip) {
        // Can't find trip, close
        // useEffect to navigate back?
        // Just return null and navigate in effect
        React.useEffect(() => onClose(), []);
        return null;
    }

    const toggleFolder = (folderId) => {
        const updatedFolders = folders.map(f => {
            if (f.id === folderId) {
                const currentIds = new Set(f.trip_ids || []);
                if (currentIds.has(trip.id)) {
                    currentIds.delete(trip.id);
                } else {
                    currentIds.add(trip.id);
                }
                return { ...f, trip_ids: Array.from(currentIds) };
            }
            return f;
        });
        saveData(null, null, updatedFolders, null);
    };

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in pointer-events-auto" onClick={onClose}>
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
}
