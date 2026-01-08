import React, { useState, useEffect } from 'react';
import { X, LogIn, UserPlus, Github, Mail } from 'lucide-react';
import { api } from '../services/api';

// Custom Markdown Renderer
const renderMarkdown = (text) => {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];

  // Track context for indentation of non-header content
  // Default (start/after H1): ml-4
  // After H2 (ml-0): ml-4
  // After H3 (ml-4): ml-8
  // After H4 (ml-8): ml-12
  let contentIndentClass = 'ml-4';

  // Helper to parse inline styles (Bold and Links)
  const parseInline = (text) => {
    if (!text) return { __html: '' };

    // Pass 1: Links [text](url)
    let processed = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, txt, url) => {
      const isGreen = txt.includes('CR200J') || url.includes('CR200J');
      const classes = isGreen
        ? "text-emerald-600 hover:text-emerald-800 hover:underline transition-colors font-medium"
        : "text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium";
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${classes}">${txt}</a>`;
    });

    // Pass 2: Bold (**text**)
    processed = processed.replace(/\*\*(.*?)\*\*/g, '<span class="font-bold">$1</span>');

    return { __html: processed };
  };

  // Helper to render buffered list items into a nested structure
  const flushList = () => {
    if (listBuffer.length === 0) return;

    // Build tree from flat list with indent levels
    const roots = [];
    const stack = [{ level: -1, children: roots }];

    listBuffer.forEach(item => {
      // Find parent with level < item.level
      while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      const newNode = { ...item, children: [] };
      parent.children.push(newNode);
      stack.push(newNode);
    });

    // Recursive render function
    const renderTree = (nodes) => {
      if (!nodes || nodes.length === 0) return null;
      return (
        <ul className="list-disc list-outside ml-5 space-y-1 text-gray-600">
          {nodes.map((node, i) => (
            <li key={i} className="pl-1">
              <span dangerouslySetInnerHTML={parseInline(node.content)} />
              {node.children.length > 0 && renderTree(node.children)}
            </li>
          ))}
        </ul>
      );
    };

    // Apply the current content indentation to the list container
    elements.push(
      <div key={`list-${elements.length}`} className={`mb-4 ${contentIndentClass}`}>
        {renderTree(roots)}
      </div>
    );
    listBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line: flush list
    if (!trimmed) {
      flushList();
      continue;
    }

    // Horizontal Rule (--- or ***)
    if (trimmed === '---' || trimmed === '***') {
      flushList();
      elements.push(<hr key={`hr-${i}`} className="my-6 border-t border-gray-200" />);
      continue;
    }

    // Headers
    // H1: Centered. Next content indent: ml-4 (Step 1)
    if (line.match(/^#\s/)) {
      flushList();
      contentIndentClass = 'ml-4';
      elements.push(
        <h1 key={i} className="text-2xl font-bold text-center my-6 text-gray-800">
          {line.substring(2).trim()}
        </h1>
      );
      continue;
    }
    // H2: ml-0 (Step 0). Next content indent: ml-4 (Step 1)
    if (line.match(/^##\s/)) {
      flushList();
      contentIndentClass = 'ml-4';
      elements.push(
        <h2 key={i} className="text-xl font-bold mt-8 mb-4 pb-2 border-b border-gray-200 text-gray-800">
          {line.substring(3).trim()}
        </h2>
      );
      continue;
    }
    // H3: ml-4 (Step 1). Next content indent: ml-8 (Step 2)
    if (line.match(/^###\s/)) {
      flushList();
      contentIndentClass = 'ml-8';
      elements.push(
        <h3 key={i} className="text-lg font-bold mt-6 mb-3 text-gray-800 ml-4">
          {line.substring(4).trim()}
        </h3>
      );
      continue;
    }
    // H4: ml-8 (Step 2). Next content indent: ml-12 (Step 3)
    if (line.match(/^####\s/)) {
        flushList();
        contentIndentClass = 'ml-12';
        elements.push(
          <h4 key={i} className="text-base font-bold mt-4 mb-2 text-gray-800 ml-8">
            {line.substring(5).trim()}
          </h4>
        );
        continue;
      }

    // List Items (- or *)
    const listMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const content = listMatch[3];
      listBuffer.push({ level: indent, content });
      continue;
    }

    // Flush list if we encounter non-list content
    flushList();

    // Blockquotes
    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className={`border-l-4 border-gray-300 pl-4 py-2 my-4 bg-gray-50 text-gray-600 italic rounded-r ${contentIndentClass}`} dangerouslySetInnerHTML={parseInline(trimmed.substring(2))} />
      );
      continue;
    }

    // Paragraph
    elements.push(
      <p key={i} className={`mb-4 leading-relaxed text-gray-600 ${contentIndentClass}`} dangerouslySetInnerHTML={parseInline(trimmed)} />
    );
  }

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
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-auto animate-slide-up h-[85vh] md:h-[650px]" onClick={e => e.stopPropagation()}>

        {/* Left: Login Form */}
        <div className="w-full md:w-[40%] p-8 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100 relative bg-white z-10">
             <button onClick={onClose} className="absolute top-4 left-4 md:hidden"><X className="text-gray-400 hover:text-gray-600"/></button>
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mb-2">
                    {isRegistering ? <UserPlus className="text-emerald-600"/> : <LogIn className="text-blue-600"/>}
                    {isRegistering ? '注册新账号' : '登录 RailLOOP'}
                </h2>
                <p className="text-sm text-gray-500">
                    {isRegistering ? '开启你的铁道制霸之旅' : '欢迎回来，铁道迷'}
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

            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar">
                <style jsx>{`
                  .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(156, 163, 175, 0.5);
                    border-radius: 20px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background-color: rgba(107, 114, 128, 0.8);
                  }
                `}</style>
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
