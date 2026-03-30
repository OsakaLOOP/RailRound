import React, { useState, useEffect } from 'react';
import { Edit2, Plus, X, ListFilter, AlertTriangle, ArrowRightLeft, ArrowDown, Search, Loader2 } from 'lucide-react';
import { useStore, EditorMode } from '../../store';
import { DropZone } from '../DragContext';
import { LineSelector } from './LineSelector';
import { GlobalSearchModal } from './GlobalSearchModal';
import { isCompanyCompatible, getTransferableLines, findRoute } from '../../utils/railwayRouting'; // Will need to ensure these are typed
import { useShallow } from 'zustand/react/shallow';

export const TripEditor: React.FC = () => {
    const {
        isOpen, isEditing, form, editorMode, autoForm, isRouteSearching, railwayData, trips, pins, folders, badgeSettings, user
    } = useStore(useShallow(state => ({
        isOpen: state.isTripEditing,
        isEditing: !!state.editingTripId,
        form: state.tripForm,
        editorMode: state.editorMode,
        autoForm: state.autoForm,
        isRouteSearching: state.isRouteSearching,
        railwayData: state.railwayData,
        trips: state.trips,
        pins: state.pins,
        folders: state.folders,
        badgeSettings: state.badgeSettings,
        user: state.user
    })));

    const setForm = useStore(state => state.setTripForm);
    const setEditorMode = useStore(state => state.setEditorMode);
    const setAutoForm = useStore(state => state.setAutoForm);
    const setIsRouteSearching = useStore(state => state.setIsRouteSearching);
    const closeEditor = useStore(state => state.closeTripEditor);
    const setTrips = useStore(state => state.setTrips);
    // Ideally api.saveData calls should be in a thunk or store action, we will abstract later.

    const [selectorOpen, setSelectorOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [selectorTarget, setSelectorTarget] = useState<{ type: string; index?: number } | null>(null);
    const [allowedLines, setAllowedLines] = useState<string[] | null>(null);

    const onSave = () => {
        // Validation logic
        const validSegments = form.segments?.filter(s => s.fromId !== s.toId) || [];
        if (validSegments.length === 0) { alert("至少包含一段有效行程"); return; }
        if (validSegments.some(s => !s.lineKey || !s.fromId || !s.toId)) { alert("请完善信息"); return; }

        // Save logic adapted from RailRound.jsx handleSaveTrip
        const groupedTrips: any[] = [];
        let currentGroup = [validSegments[0]];
        for (let i = 1; i < validSegments.length; i++) {
           const prev = validSegments[i-1];
           const curr = validSegments[i];
           const meta1 = railwayData[prev.lineKey]?.meta;
           const meta2 = railwayData[curr.lineKey]?.meta;
           if (isCompanyCompatible(meta1, meta2)) { currentGroup.push(curr); }
           else { groupedTrips.push(currentGroup); currentGroup = [curr]; }
        }
        groupedTrips.push(currentGroup);

        const newTripsToAdd = groupedTrips.map((segs, index) => ({
            id: Date.now() + index,
            date: form.date || new Date().toISOString().split('T')[0],
            cost: index === 0 ? (form.cost || 0) : 0,
            memo: form.memo || '',
            segments: segs,
            lineKey: segs[0].lineKey, // legacy support
            fromId: segs[0].fromId,   // legacy support
            toId: segs[segs.length-1].toId
        }));

        let nextTrips = [...trips];
        const editingTripId = useStore.getState().editingTripId;
        if (editingTripId) { nextTrips = nextTrips.filter(t => t.id !== editingTripId); }
        const finalTrips = [...newTripsToAdd, ...nextTrips].sort((a,b) => b.date.localeCompare(a.date));

        setTrips(finalTrips);
        closeEditor();
    };

    const onAutoSearch = () => {
        const { startLine, startStation, endLine, endStation } = autoForm;
        if(!startLine || !startStation || !endLine || !endStation) return;
        setIsRouteSearching(true);
        setTimeout(() => {
            const result = findRoute(startLine, startStation, endLine, endStation, railwayData);
            if (result.error) { setIsRouteSearching(false); alert(`无法规划: ${result.error}`); }
            else {
                if(result.segments.length > 20) { setIsRouteSearching(false); alert("路径过长"); return; }
                setForm({ segments: result.segments });
                setEditorMode(EditorMode.Manual);
                setTimeout(() => setIsRouteSearching(false), 200);
            }
        }, 1000);
    };

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeEditor();
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                if (editorMode === EditorMode.Manual) onSave();
                else onAutoSearch();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeEditor, onSave, onAutoSearch, editorMode]);

    if (!isOpen) return null;

    const openSelector = (targetType: string, index: number | null = null, allowed: string[] | null = null) => {
        setSelectorTarget({ type: targetType, index: index !== null ? index : undefined });
        setAllowedLines(allowed);
        setSelectorOpen(true);
    };

    const openSearch = (targetType: string, index: number | null = null) => {
        setSelectorTarget({ type: targetType, index: index !== null ? index : undefined });
        setSearchOpen(true);
    };

    const handleLineSelect = (lineKey: string) => {
        if (!selectorTarget) return;
        const { type, index } = selectorTarget;

        if (type === 'segment' && index !== undefined && form.segments) {
            const newSegs = [...form.segments];
            const seg = { ...newSegs[index], lineKey, fromId: '', toId: '' };
            if (index > 0) {
                const prevSeg = newSegs[index - 1];
                const prevLineData = railwayData[prevSeg.lineKey];
                const prevEndSt = prevLineData?.stations.find(s => s.id === prevSeg.toId);
                if (prevEndSt) {
                    const newLineData = railwayData[lineKey];
                    const startSt = newLineData.stations.find(s => s.name_ja === prevEndSt.name_ja);
                    if (startSt) seg.fromId = startSt.id;
                }
            }
            newSegs[index] = seg;
            setForm({ segments: newSegs });
        } else if (type === 'autoStart') {
            setAutoForm({ ...autoForm, startLine: lineKey, startStation: '' });
        } else if (type === 'autoEnd') {
            setAutoForm({ ...autoForm, endLine: lineKey, endStation: '' });
        }
    };

    const handleSearchSelect = (lineKey: string, stationId?: string) => {
        if (!selectorTarget) return;
        const { type, index } = selectorTarget;

        if (type === 'segment' && index !== undefined && form.segments) {
            const newSegs = [...form.segments];
            const seg = { ...newSegs[index], lineKey, fromId: stationId || '', toId: '' };
            // If it's not the first segment and they didn't select a station, try to auto-fill
            if (index > 0 && !stationId) {
                const prevSeg = newSegs[index - 1];
                const prevLineData = railwayData[prevSeg.lineKey];
                const prevEndSt = prevLineData?.stations.find(s => s.id === prevSeg.toId);
                if (prevEndSt) {
                    const newLineData = railwayData[lineKey];
                    const startSt = newLineData.stations.find(s => s.name_ja === prevEndSt.name_ja);
                    if (startSt) seg.fromId = startSt.id;
                }
            }
            newSegs[index] = seg;
            setForm({ segments: newSegs });
        } else if (type === 'autoStart') {
            setAutoForm({ ...autoForm, startLine: lineKey, startStation: stationId || '' });
        } else if (type === 'autoEnd') {
            setAutoForm({ ...autoForm, endLine: lineKey, endStation: stationId || '' });
        }
    };

    const addSegment = () => {
        if ((form.segments?.length || 0) >= 10) { alert("最多 10 段"); return; }
        setForm({ segments: [...(form.segments || []), { id: Date.now().toString(), lineKey: '', fromId: '', toId: '' }] });
    };

    const updateSegment = (idx: number, field: string, val: any) => {
        if (!form.segments) return;
        const newSegs = [...form.segments];
        const seg = { ...newSegs[idx], [field]: val };
        if (field === 'toId' && idx < newSegs.length - 1) {
            newSegs[idx + 1] = { ...newSegs[idx + 1], lineKey: '', fromId: '', toId: '' };
        }
        newSegs[idx] = seg;
        setForm({ segments: newSegs });
    };

    const removeSegment = (idx: number) => {
        if (!form.segments) return;
        setForm({ segments: form.segments.filter((_, i) => i !== idx) });
    };

    return (
        <>
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-slide-up relative overflow-hidden">
            {isRouteSearching && (
              <div className="train-animation-layer">
                <svg viewBox="0 0 100 30" className="train-body" preserveAspectRatio="none"><path d="M 5 20 L 15 5 H 95 L 100 20 H 5 Z" fill="#e2e8f0" stroke="#3b82f6" strokeWidth="1"/><path d="M 5 20 Q 0 20 2 10 L 15 5" fill="none" stroke="#3b82f6" strokeWidth="1"/><rect x="20" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="35" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="50" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="65" y="8" width="10" height="5" fill="#3b82f6" rx="1"/><rect x="10" y="16" width="90" height="2" fill="#3b82f6"/></svg>
                <div className="speed-line" style={{top:'40%', left:'10%', width:'50px', animationDelay:'0s'}}></div>
                <div className="speed-line" style={{top:'60%', left:'20%', width:'80px', animationDelay:'0.2s'}}></div>
                <div className="speed-line" style={{top:'30%', left:'50%', width:'40px', animationDelay:'0.1s'}}></div>
              </div>
            )}

            <div className="p-4 border-b bg-gray-50 relative z-10">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800">
                    {isEditing ? <Edit2 size={18} /> : <Plus size={18} />}
                    {isEditing ? '编辑行程' : '新行程'}
                 </h3>
                 <button onClick={closeEditor}><X className="text-gray-400 hover:text-gray-600"/></button>
              </div>
              <div className="grid grid-cols-2 p-1 bg-gray-200 rounded-lg relative isolate overflow-hidden">
                 <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white shadow rounded-md transition-all duration-100 ease-out z-0`} style={{ left: editorMode === EditorMode.Manual ? '4px' : 'calc(50% + 0px)' }} />
                 <button onClick={() => setEditorMode(EditorMode.Manual)} className={`py-1.5 text-sm font-bold rounded-md z-10 transition-colors duration-300 ${editorMode === EditorMode.Manual ? 'text-gray-800' : 'text-gray-500'}`}>手动输入</button>
                 <button onClick={() => setEditorMode(EditorMode.Auto)} className={`py-1.5 text-sm font-bold rounded-md z-10 transition-colors duration-300 ${editorMode === EditorMode.Auto ? 'text-blue-600' : 'text-slate-500'}`}>自动规划</button>
              </div>
            </div>

            {editorMode === EditorMode.Manual && (
              <div className="p-6 space-y-6 overflow-y-auto">
                  <input type="date" className="w-full p-2 border rounded bg-gray-50 font-bold text-gray-800" value={form.date || ''} onChange={e => setForm({ date: e.target.value })} />

                  <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1 flex items-center gap-1"><span className="font-bold text-gray-600">¥</span> 金额 (JPY)</label>
                      <input type="number" className="w-full p-2 border rounded text-sm" placeholder="0" value={form.cost || ''} onChange={e => setForm({ cost: parseInt(e.target.value) || 0 })}/>
                  </div>

                  <div className="space-y-3">
                  {form.segments?.map((segment, idx) => {
                      const prevSegment = idx > 0 ? form.segments![idx - 1] : null;
                      const prevLineData = prevSegment ? railwayData[prevSegment.lineKey] : null;
                      const prevEndStName = prevSegment ? railwayData[prevSegment.lineKey]?.stations.find(s => s.id === prevSegment.toId)?.name_ja : null;

                      let currentAllowed: string[] | null = null;
                      let warning: string | null = null;

                      if (prevLineData && prevEndStName) {
                          const allKeys = Object.keys(railwayData);
                          currentAllowed = allKeys.filter(lineKey => {
                              if (lineKey === segment.lineKey) return true;
                              const currentMeta = railwayData[lineKey].meta;
                              if (!isCompanyCompatible(prevLineData.meta, currentMeta)) return false;
                              const prevEndSt = prevLineData.stations.find(s => s.id === prevSegment.toId);
                              const transferable = getTransferableLines(prevEndSt, prevSegment.lineKey, railwayData, true);
                              return transferable.includes(lineKey);
                          });
                          if (currentAllowed.length === 0 && !segment.lineKey) warning = "无可换乘的同公司/JR线路";
                      }

                      return (
                      <div key={segment.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 relative group">
                          <div className="absolute -left-3 top-3 w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm border-2 border-white">{idx + 1}</div>
                          {idx > 0 && <button onClick={() => removeSegment(idx)} className="absolute -right-2 -top-2 p-1 bg-white text-red-500 rounded-full shadow border border-gray-100 hover:bg-red-50"><X size={14} /></button>}

                          <div className="mb-2 pl-2">
                             <div className="flex rounded shadow-sm w-full border bg-white overflow-hidden">
                                <button
                                   onClick={() => openSelector('segment', idx, currentAllowed)}
                                   className="flex-1 p-2 text-sm font-bold text-gray-700 text-left flex items-center justify-between hover:bg-gray-50 transition-colors border-r"
                                >
                                   <span className={segment.lineKey ? "text-gray-800" : "text-gray-400"}>
                                       {segment.lineKey ? (
                                           <span className="flex items-center gap-2">
                                               {railwayData[segment.lineKey]?.meta.icon && <img src={railwayData[segment.lineKey].meta.icon!} className="h-4 w-auto"/>}
                                               {segment.lineKey}
                                           </span>
                                       ) : (idx === 0 ? "选择路线..." : "选择换乘路线...")}
                                   </span>
                                   <ListFilter size={16} className="text-gray-400" />
                                </button>
                                <button
                                    onClick={() => openSearch('segment', idx)}
                                    className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-500 transition-colors flex items-center justify-center w-10 shrink-0"
                                    title="全局搜索"
                                >
                                    <Search size={16} />
                                </button>
                             </div>
                             {warning && <div className="text-xs text-red-500 mt-1"><AlertTriangle size={12} className="inline"/> {warning}</div>}
                          </div>

                          <div className="grid grid-cols-[1fr,auto,1fr] gap-2 pl-2 items-center">
                            <DropZone onDrop={(item: any) => {
                                if (item.type === 'station') {
                                    const newSegs = [...form.segments!];
                                    newSegs[idx] = { ...newSegs[idx], lineKey: item.lineKey, fromId: item.id };
                                    setForm({ segments: newSegs });
                                }
                            }}>
                                <select className="w-full p-2 border rounded text-xs bg-white" value={segment.fromId} onChange={e => updateSegment(idx, 'fromId', e.target.value)}>
                                    <option value="">乘车...</option>
                                    {segment.lineKey && railwayData[segment.lineKey]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}
                                </select>
                            </DropZone>

                            <button
                                className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                                onClick={() => {
                                    const newSegs = [...form.segments!];
                                    newSegs[idx] = { ...newSegs[idx], fromId: segment.toId, toId: segment.fromId };
                                    setForm({ segments: newSegs });
                                }}
                            >
                                <ArrowRightLeft size={12} />
                            </button>

                            <DropZone onDrop={(item: any) => {
                                if (item.type === 'station') {
                                    const newSegs = [...form.segments!];
                                    const update = { ...newSegs[idx], toId: item.id };
                                    if (!update.lineKey) update.lineKey = item.lineKey;
                                    if (update.lineKey && update.lineKey !== item.lineKey) {
                                        update.lineKey = item.lineKey;
                                        update.fromId = '';
                                    }
                                    newSegs[idx] = update;
                                    setForm({ segments: newSegs });
                                }
                            }}>
                                <select className="w-full p-2 border rounded bg-white text-xs" value={segment.toId} onChange={e => updateSegment(idx, 'toId', e.target.value)}>
                                    <option value="">下车...</option>
                                    {segment.lineKey && railwayData[segment.lineKey]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}
                                </select>
                            </DropZone>
                          </div>
                      </div>
                      );
                  })}
                  </div>
                  <button onClick={addSegment} disabled={(form.segments?.length || 0) >= 10} className="w-full py-2 border-2 border-dashed border-gray-300 text-gray-400 rounded-lg hover:bg-gray-50 hover:text-gray-600 transition flex items-center justify-center gap-2 disabled:opacity-50"><Plus size={16} /> 添加换乘 / 下一程</button>
                  <textarea className="w-full p-2 border rounded h-20 bg-gray-50" placeholder="备注..." value={form.memo || ''} onChange={e => setForm({ memo: e.target.value })} />
              </div>
            )}

            {editorMode === EditorMode.Auto && (
                <div className="p-6 space-y-6 flex-1 transition-opacity duration-300">
                    <div id="auto-planning-form" className="space-y-4 bg-blue-50 p-4 rounded-lg border border-blue-100">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">出发地</label>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex rounded border bg-white overflow-hidden">
                                    <button onClick={() => openSelector('autoStart')} className="flex-1 p-2 text-sm text-left text-gray-700 truncate flex items-center gap-1 hover:bg-gray-50 border-r">{autoForm.startLine ? <span>{autoForm.startLine}</span> : <span className="text-gray-400">选择线路...</span>}</button>
                                    <button onClick={() => openSearch('autoStart')} className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-500 w-10 shrink-0 flex items-center justify-center"><Search size={16} /></button>
                                </div>
                                <select className="p-2 rounded border text-sm" disabled={!autoForm.startLine} value={autoForm.startStation} onChange={e => setAutoForm({ ...autoForm, startStation: e.target.value })}><option value="">车站...</option>{autoForm.startLine && railwayData[autoForm.startLine]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                            </div>
                        </div>
                        <div className="flex justify-center text-blue-300"><ArrowDown size={20}/></div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">目的地</label>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex rounded border bg-white overflow-hidden">
                                    <button onClick={() => openSelector('autoEnd')} className="flex-1 p-2 text-sm text-left text-gray-700 truncate flex items-center gap-1 hover:bg-gray-50 border-r">{autoForm.endLine ? <span>{autoForm.endLine}</span> : <span className="text-gray-400">选择线路...</span>}</button>
                                    <button onClick={() => openSearch('autoEnd')} className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-500 w-10 shrink-0 flex items-center justify-center"><Search size={16} /></button>
                                </div>
                                <select className="p-2 rounded border text-sm" disabled={!autoForm.endLine} value={autoForm.endStation} onChange={e => setAutoForm({ ...autoForm, endStation: e.target.value })}><option value="">车站...</option>{autoForm.endLine && railwayData[autoForm.endLine]?.stations.map(s => <option key={s.id} value={s.id}>{s.name_ja}</option>)}</select>
                            </div>
                        </div>
                    </div>
                    <button onClick={onAutoSearch} disabled={isRouteSearching} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition shadow-lg disabled:opacity-70">
                        {isRouteSearching ? <Loader2 className="animate-spin"/> : <Search size={18}/>}
                        {isRouteSearching ? '规划中...' : '搜索推荐路线'}
                    </button>
                    <div className="text-xs text-center text-slate-400">仅支持同一公司或JR集团内的换乘搜索</div>
                </div>
            )}

            {editorMode === EditorMode.Manual && <div className="p-4 border-t"><button onClick={onSave} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold">保存行程</button></div>}
          </div>
        </div>
        <LineSelector isOpen={selectorOpen} onClose={() => setSelectorOpen(false)} onSelect={handleLineSelect} allowedLines={allowedLines} />
        <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSearchSelect} />
        </>
    );
};
