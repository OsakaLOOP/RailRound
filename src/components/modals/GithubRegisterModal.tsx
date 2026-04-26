import React, { useState, useEffect } from 'react';
import { X, Github, AlertTriangle, Loader2 } from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../services/api';
import { useShallow } from 'zustand/react/shallow';
import { useUserData } from '../../hooks/useUserData';
import { useTranslation } from 'react-i18next';

import { trackEvent, AnalyticsEvents } from "../utils/analytics";
export const GithubRegisterModal: React.FC = () => {
    const { isOpen, regToken } = useStore(useShallow(state => ({
        isOpen: state.modals.isGithubRegOpen,
        regToken: state.modals.githubRegToken
    })));
    const setModalState = useStore(state => state.setModalState);
    const login = useStore(state => state.login);
    const { loadUserData } = useUserData();

    const { t } = useTranslation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const onClose = () => setModalState({ isGithubRegOpen: false, githubRegToken: null });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!regToken) return;
        setError(null);
        setLoading(true);
        try {
            const data = await api.completeGithubRegistration(username, password, regToken);
            login(data.token, data.username);
            loadUserData(data.token, true);
            onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 animate-slide-up">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2"><Github size={24} /> {t('githubReg.title', '完成注册')}</h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600" /></button>
                </div>
                <div className="mb-4 text-sm text-gray-500">
                    {t('githubReg.desc', '欢迎使用 GitHub 登录！请设置您的用户名和密码以完成账户创建。')}
                </div>
                {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2"><AlertTriangle size={16} /> {error}</div>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">{t('githubReg.username', '用户名')}</label>
                        <input type="text" required className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all outline-none" value={username} onChange={e => setUsername(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">{t('githubReg.password', '密码')}</label>
                        <input type="password" required className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all outline-none" value={password} onChange={e => setPassword(e.target.value)} />
                    </div>
                    <button type="submit" disabled={loading} className="w-full bg-gray-900 text-white py-3 rounded-lg font-bold hover:bg-black transition-colors disabled:opacity-50 flex justify-center">
                        {loading ? <Loader2 className="animate-spin" /> : t('githubReg.createBtn', '创建账户')}
                    </button>
                </form>
            </div>
        </div>
    );
};
