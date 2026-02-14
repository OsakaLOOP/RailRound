import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Layers, Map as MapIcon, PieChart } from 'lucide-react';
import MapComponent from './feature/map/MapComponent';
export default function MainLayout() {
    const location = useLocation();
    const currentPage = location.pathname.split('/')[1];
    const navigationType = useNavigationType();

    const background = location.state && location.state.mode && location.state.mode==="modal" && location.state.background;

    return (
        <div className="flex flex-col h-screen bg-slate-100">
            <div 
                className={`absolute inset-0 z-0 transition-opacity duration-300 ${currentPage==="map" ?
                'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
            >
                <MapComponent />
            </div>

            

            <div className="flex-1 relative z-10 overflow-hidden flex flex-col pointer-events-none">
                <div className="flex-1 pointer-events-auto overflow-y-auto">
                    <Outlet /> 
                </div>
            </div>
            <nav className="bg-white border-t p-2 flex justify-around shrink-0 pb-safe z-30">
                {['trips', 'map', 'stats'].map(t => <Link id={`tab-btn-${t}`} key={t} to={`/${t}`} className={`p-2 rounded-lg ${currentPage===t ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>{t==='records' ? <Layers/> : t==='map' ? <MapIcon/> : <PieChart/>}</Link>)}
            </nav>
        </div>    
        
    )}