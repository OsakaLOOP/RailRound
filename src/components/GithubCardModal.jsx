import React from 'react';
import { Github, Eye, EyeOff, Loader2, Lock, X } from 'lucide-react';
import { api } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { useAuth, useUserData } from '../globalContext';

export default function GithubCardModal() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { folders, badgeSettings, setBadgeSettings, saveData } = useUserData();

    const [cardKey, setCardKey] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [source, setSource] = React.useState('global');

    const onClose = () => navigate(-1);

    React.useEffect(() => {
        if (user && !cardKey) {
            setLoading(true);
            api.getOrCreateCardKey(user.token)
                .then(setCardKey)
                .catch(err => setError(err.message))
                .finally(() => setLoading(false));
        }
    }, [user, cardKey]);

    let url = "";
    if (source === 'global' && cardKey) {
        url = `${window.location.origin}/api/card?key=${cardKey}`;
    } else if (source !== 'global') {
        const f = folders.find(fo => fo.id === source);
        if (f && f.hash) {
            url = `${window.location.origin}/api/card?hash=${f.hash}`;
        }
    }

    const md = url ? `[![RailLOOP Stats](${url})](${window.location.origin})` : "Please select a valid source";
    const publicFolders = folders.filter(f => f.is_public && f.hash);

    const toggleEnabled = () => {
        const newSettings = { ...badgeSettings, enabled: !badgeSettings.enabled };
        saveData(null, null, null, newSettings);
    };

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in pointer-events-auto" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg flex items-center gap-2"><Github size={20}/> GitHub Profile Decoration</h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
                </div>

                <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
                        {badgeSettings.enabled ? <Eye size={16} className="text-emerald-500"/> : <EyeOff size={16} className="text-red-500"/>}
                        Public Badge Access
                    </span>
                    <button
                        onClick={toggleEnabled}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${badgeSettings.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${badgeSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`}/>
                    </button>
                </div>

                {loading ? (
                    <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-blue-500"/></div>
                ) : error ? (
                    <div className="p-4 bg-red-50 text-red-500 rounded-lg">{error}</div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">Source</label>
                            <select
                                className="w-full p-2 border rounded-lg text-sm"
                                value={source}
                                onChange={e => setSource(e.target.value)}
                            >
                                <option value="global">Global (All Trips)</option>
                                {publicFolders.map(f => (
                                    <option key={f.id} value={f.id}>Folder: {f.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="bg-slate-100 p-4 rounded-lg flex justify-center overflow-hidden min-h-[100px] items-center">
                            {badgeSettings.enabled ? (
                                url ? <img src={url} alt="Preview" className="max-w-full shadow-sm rounded" /> : <span className="text-xs text-gray-400">No public URL available</span>
                            ) : (
                                <span className="text-sm text-red-400 font-bold flex items-center gap-2"><Lock size={16}/> Badges are disabled</span>
                            )}
                        </div>

                        {badgeSettings.enabled && url && (
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">Markdown Code (Copy to README)</label>
                                <div className="relative">
                                    <textarea readOnly className="w-full p-3 border rounded-lg bg-slate-50 font-mono text-xs text-slate-600 h-20 resize-none outline-none focus:ring-2 focus:ring-blue-500" value={md} onClick={e => e.target.select()} />
                                </div>
                            </div>
                        )}
                        <button onClick={onClose} className="w-full bg-slate-800 text-white py-2 rounded-lg font-bold">Close</button>
                    </div>
                )}
            </div>
        </div>
    );
}
