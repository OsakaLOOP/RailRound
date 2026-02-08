import React, { useState, useEffect } from 'react';
import { useAuth } from '../globalContext';
import { api } from '../services/api';
import { X, AlertTriangle, Loader2, Github } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
    const { login, user } = useAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState('login'); // 'login' or 'register'

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            let data;
            if (mode === 'login') {
                data = await api.login(username, password);
            } else {
                data = await api.register(username, password);
            }
            login(data.token, data.username);
            navigate(-1); // Go back to where we came from
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const onClose = () => navigate(-1);

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in pointer-events-auto" onClick={onClose}>
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">
                        {mode === 'login' ? '登录' : '注册新账户'}
                    </h3>
                    <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
                </div>

                {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2"><AlertTriangle size={16}/> {error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">用户名</label>
                        <input type="text" required className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all outline-none" value={username} onChange={e => setUsername(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">密码</label>
                        <input type="password" required className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all outline-none" value={password} onChange={e => setPassword(e.target.value)} />
                    </div>
                    <button type="submit" disabled={loading} className="w-full bg-gray-900 text-white py-3 rounded-lg font-bold hover:bg-black transition-colors disabled:opacity-50 flex justify-center">
                        {loading ? <Loader2 className="animate-spin"/> : (mode === 'login' ? '登录' : '创建账户')}
                    </button>
                </form>

                <div className="mt-6 border-t pt-4">
                     <button onClick={() => api.initiateOAuth('github')} className="w-full bg-[#24292F] text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
                         <Github size={20}/>
                         使用 GitHub 登录
                     </button>
                </div>

                <div className="mt-4 text-center text-sm text-gray-500">
                    {mode === 'login' ? (
                        <p>没有账户？ <button onClick={() => setMode('register')} className="text-blue-600 font-bold hover:underline">立即注册</button></p>
                    ) : (
                         <p>已有账户？ <button onClick={() => setMode('login')} className="text-blue-600 font-bold hover:underline">直接登录</button></p>
                    )}
                </div>
            </div>
        </div>
    );
}
