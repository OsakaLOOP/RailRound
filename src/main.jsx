import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n';
import { GlobalProvider } from './GlobalProvider';
import { AppLayout } from './AppLayout'; // Ensure it points to AppLayout
import { isMobile } from 'react-device-detect';

// Suppress console logs in production
if (import.meta.env.PROD) {
  console.log = () => {};
}

// Add touch-action for mobile interaction stability
if (isMobile) {
    document.documentElement.style.touchAction = 'manipulation';
    document.body.style.touchAction = 'manipulation';
}

const root = createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <GlobalProvider>
      <React.Suspense fallback={
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-100/80 backdrop-blur-sm pointer-events-none transition-opacity duration-300">
              <div className="flex flex-col items-center gap-4 animate-fade-in">
                  <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
              </div>
          </div>
      }>
        <AppLayout />
      </React.Suspense>
    </GlobalProvider>
  </React.StrictMode>
);
