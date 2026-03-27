import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { GlobalProvider } from './globalContext';
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
      <AppLayout />
    </GlobalProvider>
  </React.StrictMode>
);
