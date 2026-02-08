import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Layers, Map as MapIcon, PieChart } from 'lucide-react';
import MapComponent from './components/MapComponent';
import Chest from './components/Chest';
import Tutorial from './components/Tutorial';
import { useAuth } from './globalContext';

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isMapMode = location.pathname === '/map' || location.pathname === '/';
  const showMap = isMapMode;

  return (
    <div className="relative w-full h-full min-h-screen overflow-hidden bg-slate-100 flex flex-col">
       {/* Map Layer (z-0) */}
       <div
         className={`absolute inset-0 z-0 transition-opacity duration-300 ${showMap ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
       >
         <MapComponent />
       </div>

       {/* Router Layer (z-10) */}
       <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">
          <Outlet />
       </div>

       {/* Global UI */}
       <div className="absolute bottom-24 right-4 z-20 pointer-events-auto">
          <Chest />
       </div>

       <Tutorial />

       {/* Navigation Bar (z-30) */}
       <nav className="absolute bottom-0 left-0 right-0 bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30 pointer-events-auto">
            <NavLink to="/records" className={({isActive}) => `p-2 rounded-lg ${isActive ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>
                <Layers />
            </NavLink>
            <NavLink to="/map" className={({isActive}) => `p-2 rounded-lg ${isActive ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>
                <MapIcon />
            </NavLink>
            <NavLink to="/stats" className={({isActive}) => `p-2 rounded-lg ${isActive ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>
                <PieChart />
            </NavLink>
       </nav>
    </div>
  );
}
