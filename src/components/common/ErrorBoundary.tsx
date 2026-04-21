import * as React from 'react';
import { AlertCircle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="my-6 p-8 border-2 border-red-100 bg-red-50/30 rounded-3xl backdrop-blur-sm shadow-xl shadow-red-900/5 transition-all animate-in fade-in zoom-in duration-300">
          <div className="flex flex-col items-center text-center max-w-md mx-auto">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            
            <h2 className="text-xl font-bold text-slate-800 mb-2">组件渲染遇到了点阻碍</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              在这个原型版本中，部分内容可能因数据不匹配或逻辑冲突未能加载。
            </p>

            <div className="w-full bg-white/60 p-4 rounded-xl border border-red-100/50 mb-6 font-mono text-[10px] text-red-600 overflow-x-auto text-left whitespace-pre-wrap">
              {this.state.error?.message || 'Unknown Error'}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-5 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl transition-all hover:bg-slate-700 active:scale-95 shadow-lg shadow-slate-900/20"
              >
                <RotateCcw size={14} /> 刷新页面
              </button>
              <a 
                href="/blog/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2 bg-white text-slate-600 text-xs font-bold rounded-xl border border-slate-200 transition-all hover:bg-slate-50 active:scale-95 shadow-sm"
              >
                <Home size={14} /> 返回索引
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
