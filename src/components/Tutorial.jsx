import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight, CheckCircle2, ArrowRight } from 'lucide-react';

const STEPS = [
    {
        id: 'welcome',
        target: '#header-title', // Center modal
        title: "欢迎来到 RailLOOP",
        content: "RailLOOP 是一个个人向旅铁手账, 旨在帮助你追踪和管理你的铁路旅程, 直观可感地展示旅行足迹.",
        position: 'center',
        action: 'next'
    },
    {
        id: 'tab-records',
        target: '#tab-btn-records',
        title: "行程记录",
        content: "这个标签页是你的旅程控制中心. 你可以在这里查看、添加和管理所有的铁路旅行记录, 或者添加到收藏",
        position: 'top',
        action: 'switch-tab',
        tab: 'records'
    },
    {
        id: 'add-trip',
        target: '#btn-add-trip',
        title: "初次记录",
        content: "点击打开新旅程编辑菜单",
        position: 'top',
        action: 'wait-interaction', 
        check: ({ isTripEditing }) => isTripEditing
    },
    {
        id: 'editor-modes',
        target: '#trip-editor-toggle-mode',
        title: "编辑模式",
        content: "你可以选择“手动录入”以此致敬旧时代的工匠精神，或者尝试“自动规划”, 将命运交给无限非概率驱动",
        position: 'bottom',
        action: 'wait-interaction',
        check: ({ editorMode }) => editorMode === 'auto'
    },
    {
        id: 'auto-planning-view',
        target: '#auto-planning-form',
        title: "自动规划",
        content: "在这里选择起点和终点，系统会自动为你规划一条基于新干线优先的路线。完成后，我们继续。",
        position: 'bottom',
        action: 'next'
    },
    {
        id: 'close-editor',
        target: '#btn-close-editor',
        title: "关闭编辑器",
        content: "先关掉它. 继续参观飞船的其他部分，别让编辑器挡住了视线. ",
        position: 'bottom',
        action: 'wait-interaction',
        check: ({ isTripEditing }) => !isTripEditing
    },
    {
        id: 'import-export',
        target: '#header-actions',
        title: "Escape Pods",
        content: "我们坚信数据归你自己所有, 前提是你得学会备份. 在这里你可以将行程导出为 KML/JSON. ",
        position: 'bottom',
        action: 'next'
    },
    {
        id: 'tab-map',
        target: '#tab-btn-map',
        title: "地图模式",
        content: "切换并查看铁路网络. 灰色的是未乘区段, 而已乘线路将以对应的颜色高亮显示. 放大到 10x 可查看 openrailwaymap 提供的配线和站台详情.",
        position: 'top',
        action: 'switch-tab',
        tab: 'map'
    },
    {
        id: 'map-pins',
        target: '#btn-pins-fab',
        title: "安放地图图钉",
        content: "在这里把照片或评论钉在地图上, 大概率比某个名叫 Jesus Christ 男人的十字架更牢固. ",
        position: 'right', // FAB is bottom-left
        action: 'wait-interaction',
        check: ({ pinMode }) => pinMode && pinMode !== 'idle'
    },
    {
        id: 'close-pin-editor',
        target: '#pin-editor',
        title: "关闭图钉模式",
        content: "图钉编辑器会出现在底部。你可以点击编辑器右上角的 'X' 按钮，或再次点击地图上的图钉按钮来关闭它。",
        position: 'top',
        action: 'wait-interaction',
        check: ({ pinMode }) => pinMode === 'idle'
    },
    {
        id: 'map-layers',
        target: '.leaflet-control-layers',
        title: "切换底图风格",
        content: "无论是为了省电还是为了配合夜宵，这里可以在深色和浅色地图风格间切换. ",
        position: 'left', // Top-right control
        action: 'next'
    },
    {
        id: 'tab-stats',
        target: '#tab-btn-stats',
        title: "Aftermath",
        content: "点击这里查看统计。看看你在这个星球的铁轨上究竟烧掉了多少钱，以及产生了多少碳排放(已加入todo).",
        position: 'top',
        action: 'wait-click-tab', // Specifically asked to guide click
        tab: 'stats',
        check: ({ activeTab }) => activeTab === 'stats'
    },
    {
        id: 'stats-content',
        target: '#stats-view-content',
        title: "铁道迷的勋章",
        content: "这里展示你的总里程、消费和最常访问的线路. ",
        position: 'center', 
        action: 'next'
    },
    {
        id: 'finish-login',
        target: null,
        title: "RailLOOP, 轻而易举啊",
        content: "引导结束。现在我们将打开登录界面，建议你绑定 GitHub 账号，这能让你生成酷炫的 SVG 卡片去主页显摆.",
        position: 'center',
        action: 'finish'
    },
    {
         id: 'login-guide',
         target: '#login-readme-container',
         title: "阅读协议",
         content: "在开始之前，请务必阅读这份实则是免责声明的用户指南. 如果你们当中有宇宙人、未来人、超能力者, 请忽略其中的物理限制条款.",
         position: 'left',
         action: 'end'
    }
];

const Tutorial = ({
    activeTab,
    setActiveTab,
    isTripEditing,
    setIsTripEditing,
    isLoginOpen,
    setIsLoginOpen,
    user,
    pinMode,
    editorMode
}) => {
    const [step, setStep] = useState(-1); // -1: Loading/Check, 0+: Steps
    const [rect, setRect] = useState(null);
    const [isVisible, setIsVisible] = useState(false);
    const [tooltipStyle, setTooltipStyle] = useState({});

    // Ref for the tooltip card to measure strict dimensions
    const tooltipRef = useRef(null);

    const handleNext = useCallback(() => {
        if (step === STEPS.length - 2) { // Finish step
            // Open Login Modal
            setIsLoginOpen(true);
            setTimeout(() => setStep(s => s + 1), 200);
        } else if (step >= STEPS.length - 1) {
            // End
            setStep(-2);
            setIsVisible(false);
        } else {
            setStep(s => s + 1);
        }
    }, [step, setIsLoginOpen, setStep, setIsVisible]);

    const handleSkip = useCallback((dontShowAgain) => {
        if (dontShowAgain) {
            localStorage.setItem('rail_tutorial_skipped', 'true');
        }
        setStep(-2);
        setIsVisible(false);
    }, [setStep, setIsVisible]);

    // Keyboard navigation for tutorial
    useEffect(() => {
        if (!isVisible || step < 0 || step >= STEPS.length) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                handleSkip(false);
            } else if (e.key === 'Enter') {
                const currentStepConfig = STEPS[step];
                if (currentStepConfig.action !== 'wait-interaction' && currentStepConfig.action !== 'wait-click-tab') {
                    handleNext();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isVisible, step, handleNext, handleSkip]);

    // Initialization check
    useEffect(() => {
        const skipped = localStorage.getItem('rail_tutorial_skipped');

        if (skipped === 'true' || user) {
            setStep(-2); // Skipped
            return;
        }
        setStep(0);
        setIsVisible(true);
    }, [user]);

    // Step Transition Logic & Rect Calculation
    useEffect(() => {
        if (step < 0 || step >= STEPS.length) return;

        const currentStep = STEPS[step];

        // 1. Target Resolution
        const updateRect = () => {
            if (!currentStep.target ) {
                setRect(null);
                setTooltipStyle({
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    opacity: 1,
                    transition: 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)'
                });
                return;
            }
            if (currentStep.target === '#header-title') {
                setTooltipStyle({
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    opacity: 1,
                    transition: 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)'
                });
            }    
            const el = document.querySelector(currentStep.target);
            if (el) {
                const r = el.getBoundingClientRect();

                // Add padding to highlight box
                const highlight = {
                    top: r.top - 5,
                    left: r.left - 5,
                    width: r.width + 10,
                    height: r.height + 10
                };
                setRect(highlight);
            } else {
                setRect(null);
            }
        };

        // Initial update
        updateRect();
        // Poll for rect changes (animations)
        const interval = setInterval(updateRect, 100);

        if (currentStep.action === 'switch-tab' && currentStep.tab && activeTab !== currentStep.tab) {
             setActiveTab(currentStep.tab);
        }

        // 3. Wait Conditions
        let checkInterval;
        if (currentStep.check) {
            checkInterval = setInterval(() => {
                // Pass component state to the check function
                if (currentStep.check({ activeTab, isTripEditing, isLoginOpen, pinMode, editorMode })) {
                    handleNext();
                }
            }, 200);
        }

        return () => {
            clearInterval(interval);
            if (checkInterval) clearInterval(checkInterval);
        };
    }, [step, activeTab, isTripEditing, isLoginOpen, pinMode, editorMode]);

    // Strict Positioning Logic
    const calculatePosition = () => {
        if (step < 0 || step >= STEPS.length || !rect || !tooltipRef.current) return;

        const currentStep = STEPS[step];
        const PADDING = 20;

        // Measure ACTUAL tooltip dimensions
        const CARD_W = tooltipRef.current.offsetWidth || 384;
        const CARD_H = tooltipRef.current.offsetHeight || 250;

        // Viewport Dimensions
        const winH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const winW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const offsetTop = window.visualViewport ? window.visualViewport.offsetTop : 0;

        // Adjust for viewport scrolling/offset if using visualViewport
        // Actually for fixed position elements, visualViewport logic is complex.
        // If we use simple innerHeight, it might be safer unless keyboard is up.
        // But for FAB (bottom) clipping, visualViewport height is the visible part.

        // Center of the target element
        const targetCenterX = rect.left + rect.width / 2;
        const targetCenterY = rect.top + rect.height / 2;

        let top = 0;
        let left = 0;
        let pos = currentStep.position;

        // Helper to check collision
        const checkBounds = (t, l) => {
            return (t >= PADDING && l >= PADDING && (t + CARD_H) <= (winH - PADDING) && (l + CARD_W) <= (winW - PADDING));
        };

        // 1. Determine Initial Position & Flip if needed
        const getCoords = (p) => {
            let t, l;
            if (p === 'bottom') {
                t = rect.top + rect.height + 20;
                l = targetCenterX - (CARD_W / 2);
            } else if (p === 'top') {
                t = rect.top - CARD_H - 20;
                l = targetCenterX - (CARD_W / 2);
            } else if (p === 'right') {
                t = targetCenterY - (CARD_H / 2);
                l = rect.left + rect.width + 20;
            } else if (p === 'left') {
                t = targetCenterY - (CARD_H / 2);
                l = rect.left - CARD_W - 20;
            } else { // center
                t = winH / 2 - CARD_H / 2;
                l = winW / 2 - CARD_W / 2;
            }
            return { t, l };
        };

        let coords = getCoords(pos);

        // Smart Flip
        if (!checkBounds(coords.t, coords.l) && pos !== 'center') {
            const opposites = { 'top': 'bottom', 'bottom': 'top', 'left': 'right', 'right': 'left' };
            const altPos = opposites[pos];
            if (altPos) {
                const altCoords = getCoords(altPos);
                // If alternative is better (or valid), take it
                // Simple heuristic: check if alt fits vertically for top/bottom swap
                if (pos === 'top' || pos === 'bottom') {
                    if (altCoords.t >= PADDING && (altCoords.t + CARD_H) <= (winH - PADDING)) {
                        coords = altCoords;
                        pos = altPos;
                    }
                }
                // Check if alt fits horizontally for left/right swap
                if (pos === 'left' || pos === 'right') {
                    if (altCoords.l >= PADDING && (altCoords.l + CARD_W) <= (winW - PADDING)) {
                        coords = altCoords;
                        pos = altPos;
                    }
                }
            }
        }

        // 2. Strict Clamping (The "Aggressive" Part)
        // Ensure card never goes off screen, even if it de-centers from target
        top = Math.max(PADDING, Math.min(coords.t, winH - CARD_H - PADDING));
        left = Math.max(PADDING, Math.min(coords.l, winW - CARD_W - PADDING));

        setTooltipStyle({
            position: 'fixed',
            top: `${top}px`,
            left: `${left}px`,
            transform: 'none',
            opacity: 1,
            transition: 'all 0.4s cubic-bezier(0.25, 1, 0.5, 1)' // Smooth transitions
        });
    };

    useLayoutEffect(() => {
        calculatePosition();
    }, [rect, step]);

    // ResizeObserver to handle content size changes
    useEffect(() => {
        if (!tooltipRef.current) return;
        const observer = new ResizeObserver(() => {
            calculatePosition();
        });
        observer.observe(tooltipRef.current);
        return () => observer.disconnect();
    }, [rect, step]);

    if (!isVisible || step < 0) return null;

    const currentStep = STEPS[step];

    // Render
    return createPortal(
        <div className="fixed inset-0 z-[2000] overflow-hidden pointer-events-none">
            {/* Mask / Spotlight */}
            {rect ? (
                <div
                    className="absolute transition-all duration-300 ease-out border-gray-900/80"
                    style={{
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)',
                        borderRadius: '8px',
                        pointerEvents: 'none' // Let clicks pass through to target
                    }}
                />
            ) : (
                // Full overlay if no target (Welcome step)
                <div className="absolute inset-0 bg-black/75 pointer-events-auto" />
            )}

            {/* Tooltip / Card */}
            <div
                ref={tooltipRef}
                className={`absolute pointer-events-auto flex flex-col gap-4 max-w-sm w-full p-6 bg-white rounded-2xl shadow-2xl`}
                style={{
                    ...tooltipStyle,
                    maxWidth: 'min(24rem, calc(100vw - 40px))'
                }}
            >
                <div>
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-xl font-bold text-gray-800">{currentStep.title}</h3>
                        <span className="text-xs font-bold text-gray-400 px-2 py-1 bg-gray-100 rounded-full">{step + 1} / {STEPS.length}</span>
                    </div>
                    <p className="text-gray-600 text-sm leading-relaxed mb-6">
                        {currentStep.content}
                    </p>

                    <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            {step === 0 && (
                                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                                    <input type="checkbox" onChange={(e) => { if(e.target.checked) handleSkip(true); }} className="rounded border-gray-300"/>
                                    不再显示
                                </label>
                            )}
                            {step > 0 && (
                                <button onClick={() => handleSkip(true)} className="text-xs text-gray-400 hover:text-gray-600 underline">跳过教程</button>
                            )}
                         </div>

                        {currentStep.action !== 'wait-interaction' && currentStep.action !== 'wait-click-tab' && (
                             <button
                                onClick={handleNext}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-200 transition-all transform active:scale-95"
                             >
                                {step === STEPS.length - 1 ? '结束' : '继续'} <ArrowRight size={16}/>
                             </button>
                        )}
                        {(currentStep.action === 'wait-interaction' || currentStep.action === 'wait-click-tab') && (
                            <div className="text-xs font-bold text-emerald-600 animate-pulse flex items-center gap-1">
                                <ChevronRight size={14}/> 请按照指示操作
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    , document.body);
};

export default Tutorial;
