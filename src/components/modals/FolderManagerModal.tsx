import React, { useState, useEffect } from 'react';
import { X, Folder, Globe, Trash2 } from 'lucide-react';
import { useStore } from '../../store';

export const FolderManagerModal: React.FC = () => {
    const { isOpen, folders } = useStore(state => ({
        isOpen: state.modals.folderManagerOpen,
        folders: state.folders
    }));
    const setModalState = useStore(state => state.setModalState);
    const setFolders = useStore(state => state.setFolders);
    const [newFolderName, setNewFolderName] = useState("");

    const onClose = () => setModalState({ folderManagerOpen: false });

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    if (!isOpen) return null;

    const handleCreate = () => {
        if (!newFolderName.trim()) return;
        const newFolder = {
            id: crypto.randomUUID(),
            name: newFolderName.trim(),
            is_public: false,
            trip_ids: [],
            stats: null,
            hash: null
        };
        setFolders([...folders, newFolder]);
        setNewFolderName("");
    };

    const handleDelete = (id: string) => {
        if (confirm("Delete this folder?")) {
            setFolders(folders.filter(f => f.id !== id));
        }
    };

    const togglePublic = (id: string) => {
        const updated = folders.map(f => {
            if (f.id === id) {
                const willBePublic = !f.is_public;
                return {
                    ...f,
                    is_public: willBePublic,
                    hash: willBePublic ? (f.hash || crypto.randomUUID()) : null
                };
            }
            return f;
        });
        setFolders(updated);
    };

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2"><Folder size={24}/> 收藏夹</h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }} className="flex gap-2 mb-4">
                    <input
                        className="flex-1 p-2 border rounded-lg text-sm"
                        placeholder="名称..."
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                    />
                    <button type="submit" disabled={!newFolderName.trim()} className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-50">Create</button>
                </form>

                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {folders.length === 0 && <div className="text-center text-gray-400 py-4 text-sm">No folders yet.</div>}
                    {folders.map(f => (
                        <div key={f.id} className="p-3 border rounded-lg flex items-center justify-between bg-gray-50">
                            <div>
                                <div className="font-bold text-sm text-gray-700">{f.name}</div>
                                <div className="text-xs text-gray-400">{f.trip_ids?.length || 0} trips</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => togglePublic(f.id)}
                                    className={`p-1.5 rounded-md transition-colors ${f.is_public ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-400'}`}
                                    title={f.is_public ? "Public" : "Private"}
                                >
                                    <Globe size={16}/>
                                </button>
                                <button onClick={() => handleDelete(f.id)} className="p-1.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={16}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
