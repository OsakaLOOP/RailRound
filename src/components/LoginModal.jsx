import React, { useState, useEffect } from 'react';
import { X, LogIn, UserPlus, Github, Mail, Globe } from 'lucide-react';
import { api } from '../services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Dependencies: react-markdown, remark-gfm are required.

export const LoginModal = ({ isOpen, onClose, onLoginSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readmeContent, setReadmeContent] = useState('');
  const [lang, setLang] = useState('zh-cn'); 

  useEffect(() => {
    if (isOpen) {
      fetch(`/readme/${lang}.md`)
        .then(res => res.text())
        .then(text => setReadmeContent(text))
        .catch(err => setReadmeContent('# Error loading guide'));
    }
  }, [isOpen, lang]);

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
    api.initiateOAuth(provider);
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden animate-slide-up h-[80vh] md:h-[600px]" onClick={e => e.stopPropagation()}>

        {/* Left: Login Form */}
        <div className="w-full md:w-[40%] p-8 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100 relative">
             <button onClick={onClose} className="absolute top-4 left-4 md:hidden"><X className="text-gray-400 hover:text-gray-600"/></button>
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mb-2">
                    {isRegistering ? <UserPlus className="text-emerald-600"/> : <LogIn className="text-blue-600"/>}
                    {isRegistering ? '注册新账号' : '登录 RailRound'}
                </h2>
                <p className="text-sm text-gray-500">
                    {isRegistering ? '开启你的铁道制霸之旅' : '欢迎回来，指挥官'}
                </p>
            </div>

            {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 animate-fade-in">
                {error}
            </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wide">用户名</label>
                <input
                type="text"
                required
                className="w-full p-3 border rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition outline-none font-bold text-gray-700"
                value={username}
                onChange={e => setUsername(e.target.value)}
                />
            </div>
            <div>
                <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wide">密码</label>
                <input
                type="password"
                required
                className="w-full p-3 border rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition outline-none font-bold text-gray-700"
                value={password}
                onChange={e => setPassword(e.target.value)}
                />
            </div>

            <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 rounded-xl font-bold text-white transition shadow-lg transform active:scale-95
                ${isRegistering ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}
                ${loading ? 'opacity-70 cursor-wait' : ''}
                `}
            >
                {loading ? '请稍候...' : (isRegistering ? '立即注册' : '登录')}
            </button>
            </form>

            <div className="mt-8">
                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase tracking-wider font-bold">
                    <span className="px-2 bg-white text-gray-400">第三方登录</span>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                    onClick={() => handleOAuth('github')}
                    className="flex items-center justify-center gap-2 p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition font-bold text-gray-700 text-sm"
                    >
                    <Github size={18}/> GitHub
                    </button>
                    <button
                    disabled
                    className="flex items-center justify-center gap-2 p-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-400 text-sm cursor-not-allowed font-bold"
                    >
                    <Mail size={18}/> Google
                    </button>
                </div>
            </div>

            <div className="mt-6 text-center text-sm">
            <span className="text-gray-400">{isRegistering ? '已有账号?' : '还没有账号?'}</span>
            <button
                onClick={() => setIsRegistering(!isRegistering)}
                className="ml-2 font-bold text-blue-600 hover:underline"
            >
                {isRegistering ? '去登录' : '创建新账号'}
            </button>
            </div>
        </div>

        {/* Right: User Guide / Agreement */}
        <div className="w-full md:w-[60%] bg-slate-50 flex flex-col relative">
            <button onClick={onClose} className="absolute top-4 right-4 z-10 hidden md:block"><X className="text-gray-400 hover:text-gray-600"/></button>

            <div className="flex items-center justify-between p-4 border-b bg-white/50 backdrop-blur shrink-0">
                <div className="font-bold text-gray-500 text-sm">用户指南 / 协议</div>
                <div className="flex bg-gray-200 p-1 rounded-lg">
                    {['zh-cn', 'en', 'ja-jp', 'zh-tw'].map(l => (
                        <button
                            key={l}
                            onClick={() => setLang(l)}
                            className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${lang === l ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {l.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
                <article className="prose prose-sm prose-slate max-w-none prose-headings:font-bold prose-h1:text-center prose-h1:text-2xl prose-h1:text-gray-800 prose-p:text-gray-600 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {readmeContent}
                    </ReactMarkdown>
                </article>
            </div>

            <div className="p-4 border-t bg-white/50 backdrop-blur text-center text-xs text-gray-400 shrink-0">
                继续使用即代表您同意上述协议内容
            </div>
        </div>

      </div>
    </div>
  );
};
