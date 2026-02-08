import React from 'react';
import { Magnet, MapPin } from 'lucide-react';

export const FabButton = ({ pinMode, togglePinMode }) => (
  <div id="btn-pins-fab" className="absolute bottom-24 left-4 z-[400] flex flex-col gap-3 pointer-events-auto">
    <button onClick={togglePinMode} className={`p-3 rounded-full shadow-lg transition-all transform hover:scale-105 ${pinMode==='idle'?'bg-white text-gray-700':pinMode==='free'?'bg-blue-500 text-white':'bg-indigo-600 text-white ring-4 ring-indigo-200'}`}>
        {pinMode === 'snap' ? <Magnet size={24} /> : <MapPin size={24} />}
    </button>
  </div>
);
