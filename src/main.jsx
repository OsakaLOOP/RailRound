import React from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import './index.css';

import { GlobalProvider } from './globalContext';
import MainLayout from './MainLayout';
import RecordsPage from './pages/RecordsPage';
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
        element: <Navigate to="/records" replace />
      },
      {
        path: "map",
        element: null // Map is always rendered in Layout, this route just enables interaction
      },
      {
        path: "records",
        element: <RecordsPage />
      },
      {
        path: "stats",
        element: <StatsPage />
      },
      {
        path: "login",
        element: <LoginPage />
      },
      {
        path: "trips/new",
        element: <TripEditorPage />
      },
      {
        path: "trips/:id/edit",
        element: <TripEditorPage />
      },
      {
        path: "stats/card",
        element: <GithubCardModal />
      },
      {
        path: "stats/folders",
        element: <FolderManagerModal />
      },
      {
        path: "records/folder/:tripId",
        element: <AddToFolderModal />
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
