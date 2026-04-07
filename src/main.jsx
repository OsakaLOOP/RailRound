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
      <React.Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-100 text-gray-500 font-bold">Loading Initial Data...</div>}>
        <AppLayout />
      </React.Suspense>
    </GlobalProvider>
  </React.StrictMode>
);
