import React, { useState, useEffect } from 'react';
import { X, LogIn, UserPlus, Github, Mail } from 'lucide-react';
import { api } from '../services/api';

// Custom Markdown Renderer to ensure consistent styling without dependencies
const renderMarkdown = (text) => {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];
  let currentIndent = 0; // 0 for H1, 1 for H2, 2 for H3... used for indentation

  const flushList = () => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className={`list-disc list-inside mb-4 pl-4 space-y-1 text-gray-600 ${currentIndent === 1 ? 'ml-4' : currentIndent === 2 ? 'ml-8' : ''}`}>
          {listBuffer.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: parseLinks(item) }} />
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  const parseLinks = (str) => {
    // Replace [text](url) with <a ...> using callback to check for "CR200J"
    return str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      const isGreen = text.includes('CR200J') || url.includes('CR200J');
      const classes = isGreen
        ? "text-emerald-600 hover:text-emerald-800 hover:underline transition-colors font-medium"
        : "text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium";

      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${classes}">${text}</a>`;
    });
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed.startsWith('- ')) {
      listBuffer.push(trimmed.substring(2));
    } else {
      flushList();

      if (trimmed.startsWith('# ')) {
        currentIndent = 0;
        elements.push(
          <h1 key={index} className="text-2xl font-bold text-center my-6 text-gray-800">
            {trimmed.substring(2)}
          </h1>
        );
      } else if (trimmed.startsWith('## ')) {
        currentIndent = 1;
        elements.push(
          <h2 key={index} className="text-xl font-bold mt-6 mb-3 pb-2 border-b border-gray-200 text-gray-800 ml-4">
            {trimmed.substring(3)}
          </h2>
        );
      } else if (trimmed.startsWith('### ')) {
        currentIndent = 2;
        elements.push(
          <h3 key={index} className="text-lg font-bold mt-4 mb-2 text-gray-800 ml-8">
            {trimmed.substring(4)}
          </h3>
        );
      } else if (trimmed.startsWith('> ')) {
        // Blockquotes inherit indentation
        const indentClass = currentIndent === 1 ? 'ml-4' : currentIndent === 2 ? 'ml-8' : '';
        elements.push(
          <blockquote key={index} className={`border-l-4 border-gray-300 pl-4 py-2 my-4 bg-gray-50 text-gray-600 italic rounded-r ${indentClass}`}>
            {trimmed.substring(2)}
          </blockquote>
        );
      } else {
        // Paragraph - inherit indentation
        const indentClass = currentIndent === 1 ? 'ml-4' : currentIndent === 2 ? 'ml-8' : '';
        elements.push(
          <p key={index} className={`mb-4 leading-relaxed text-gray-600 ${indentClass}`} dangerouslySetInnerHTML={{ __html: parseLinks(trimmed) }} />
        );
      }
    }
  });
  flushList();

  return elements;
};

export const LoginModal = ({ isOpen, onClose, onLoginSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readmeContent, setReadmeContent] = useState('');
  const [lang, setLang] = useState('cn'); // cn, en, jp

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
        <div className="w-full md:w-[40%] p-8 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100 relative bg-white z-10">
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
                    {['cn', 'en', 'jp'].map(l => (
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

            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar">
                {renderMarkdown(readmeContent)}
            </div>

            <div className="p-4 border-t bg-white/50 backdrop-blur text-center text-xs text-gray-400 shrink-0">
                继续使用即代表您同意上述协议内容
            </div>
        </div>

      </div>
    </div>
  );
};
