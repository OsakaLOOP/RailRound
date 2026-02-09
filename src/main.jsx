import React from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import './index.css';

import { GlobalProvider } from './globalContext';
import MainLayout from './MainLayout';
import TripsPage from './pages/TripsPage';
import StatsPage from './pages/StatsPage';
import LoginPage from './pages/LoginPage';
import TripEditorPage from './pages/TripEditorPage';
import GithubCardModal from './components/GithubCardModal';
import FolderManagerModal from './components/FolderManagerModal';
import AddToFolderModal from './components/AddToFolderModal';

const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/trips" replace />
      },
      {
        path: "map",
        element: null // Map is always rendered in Layout, this route just enables interaction
      },
      {
        path: "trips",
        element: <TripsPage />,
        children: [
            { path: "new", element: <TripEditorPage /> },
            { path: ":id/edit", element: <TripEditorPage /> },
            { path: "folder/:tripId", element: <AddToFolderModal /> }
        ]
      },
      {
        path: "stats",
        element: <StatsPage />,
        children: [
            { path: "card", element: <GithubCardModal /> },
            { path: "folders", element: <FolderManagerModal /> }
        ]
      },
      {
        path: "login",
        element: <LoginPage />
      }
    ]
  }
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GlobalProvider>
       <RouterProvider router={router} />
    </GlobalProvider>
  </StrictMode>,
);
