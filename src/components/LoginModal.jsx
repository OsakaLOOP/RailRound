import React, { useState } from 'react';
import { X, LogIn, UserPlus, Github, Mail } from 'lucide-react';
import { api } from '../services/api';

export const LoginModal = ({ isOpen, onClose, onLoginSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let result;
      if (isRegistering) {
        result = await api.register(username, password);
      } else {
        result = await api.login(username, password);
      }
      onLoginSuccess(result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider) => {
    // api.initiateOAuth(provider) redirects.
    // If it returns a URL (mock), we should handle it.
    // However, the service currently redirects using window.location.href inside api.js
    // We will update api.js to return the URL instead so we can handle it here or just let it be.
    // For now, let's just call it.
    api.initiateOAuth(provider);
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            {isRegistering ? <UserPlus className="text-emerald-600"/> : <LogIn className="text-blue-600"/>}
            {isRegistering ? '注册新账号' : '登录'}
          </h2>
          <button onClick={onClose}><X className="text-gray-400 hover:text-gray-600"/></button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              required
              className="w-full p-3 border rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition outline-none"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">密码</label>
            <input
              type="password"
              required
              className="w-full p-3 border rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition outline-none"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl font-bold text-white transition shadow-lg
              ${isRegistering ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}
              ${loading ? 'opacity-70 cursor-wait' : ''}
            `}
          >
            {loading ? '请稍候...' : (isRegistering ? '注册' : '登录')}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">或通过以下方式</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => handleOAuth('github')}
              className="flex items-center justify-center gap-2 p-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700 text-sm"
            >
              <Github size={18}/> GitHub
            </button>
            <button
              onClick={() => handleOAuth('google')}
              className="flex items-center justify-center gap-2 p-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700 text-sm"
            >
              <Mail size={18}/> Google
            </button>
          </div>
        </div>

        <div className="mt-6 text-center text-sm">
          <span className="text-gray-500">{isRegistering ? '已有账号?' : '还没有账号?'}</span>
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="ml-2 font-bold text-blue-600 hover:underline"
          >
            {isRegistering ? '去登录' : '立即注册'}
          </button>
        </div>
      </div>
    </div>
  );
};
