import React, { useEffect } from 'react';
import { Magnet, MapPin, X, Camera, MessageSquare, Trash2 } from 'lucide-react';

const COLOR_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#64748b'];

export const PinEditor = ({ editingPin, setEditingPin, pinMode, setPinMode, deletePin, savePin }) => {
  if (!editingPin) return null;

  useEffect(() => {
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            setEditingPin(null);
            setPinMode('idle');
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            savePin();
        }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
        document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editingPin, savePin, setEditingPin, setPinMode]);

  return (
    <div id="pin-editor" className="absolute bottom-6 left-4 right-4 z-[400] bg-white rounded-xl shadow-2xl p-4 animate-slide-up max-w-md mx-auto border border-gray-200 pointer-events-auto">
      <div className="flex justify-between items-center mb-3 border-b pb-2"><span className="font-bold text-gray-700 flex items-center gap-2">{pinMode === 'snap' ? <Magnet size={16} className="text-indigo-600"/> : <Move size={16} />}{pinMode === 'snap' ? `吸附: ${editingPin.lineKey || '未知'}` : '自由位置'}</span><button onClick={() => {setEditingPin(null); setPinMode('idle');}} className="absolute right-0"><X size={18} className="text-gray-400"/></button></div>
      <div className="flex gap-3 mb-3"><div className="flex bg-gray-100 rounded-lg p-1 gap-1">{['photo', 'comment'].map(t => (<button key={t} onClick={() => setEditingPin({...editingPin, type: t})} className={`p-2 rounded-md ${editingPin.type===t ? 'bg-white shadow text-blue-600' : 'text-gray-400'}`}>{t==='photo'?<Camera size={18}/>:<MessageSquare size={18}/>}</button>))}</div><div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">{COLOR_PALETTE.map(c => <button key={c} onClick={() => setEditingPin({...editingPin, color: c})} className={`w-6 h-6 rounded-full border-2 ${editingPin.color===c?'border-gray-600 scale-110':'border-transparent'}`} style={{background: c}} />)}</div></div>
      <input className="w-full p-2 border rounded text-sm mb-2" placeholder="备注..." value={editingPin.comment||''} onChange={e => setEditingPin({...editingPin, comment: e.target.value})} />
      {editingPin.type==='photo' && <input className="w-full p-2 border rounded text-sm mb-3" placeholder="图片URL..." value={editingPin.imageUrl||''} onChange={e => setEditingPin({...editingPin, imageUrl: e.target.value})} />}
      <div className="flex gap-2">{!editingPin.isTemp && <button onClick={() => deletePin(editingPin.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={20}/></button>}<button onClick={savePin} className="flex-1 bg-slate-800 text-white py-2 rounded-lg font-bold text-sm hover:bg-slate-700">{editingPin.isTemp ? '添加' : '更新'}</button></div>
    </div>
  );
};

// Simple Icon placeholder
const Move = ({size}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M15 19l-3 3-3-3M2 12h20M12 2v20"/></svg>;
