import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { GlobalProvider } from './GlobalProvider';
import { AppLayout } from './AppLayout'; // Ensure it points to AppLayout
import { IS_MOBILE } from './hooks/useMobile';

// Suppress console logs in production
if (import.meta.env.PROD) {
  console.log = () => {};
}

// Add touch-action for mobile interaction stability
if (IS_MOBILE) {
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
