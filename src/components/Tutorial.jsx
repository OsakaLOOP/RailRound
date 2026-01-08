import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ArrowRight } from 'lucide-react';

const Tutorial = ({
    activeTab,
    setActiveTab,
    isTripEditing,
    setIsTripEditing,
    isLoginOpen,
    setIsLoginOpen,
    user,
    pinMode
}) => {
    const [step, setStep] = useState(-1); // -1: Loading/Check, 0+: Steps
    const [rect, setRect] = useState(null);
    const [isVisible, setIsVisible] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({});

    // Ref for the tooltip card to measure strict dimensions
    const tooltipRef = useRef(null);

    // Config
    const STEPS = [
        {
            id: 'welcome',
            target: null, // Center modal
            title: "Welcome to RailLOOP",
            content: "Welcome! Let's take a quick tour to help you get started with tracking your railway journeys.",
            position: 'center',
            action: 'next'
        },
        {
            id: 'tab-records',
            target: '#tab-btn-records',
            title: "Your Journey Log",
            content: "This is the Records tab. Here you can view and manage all your railway trips.",
            position: 'top',
            action: 'switch-tab',
            tab: 'records'
        },
        {
            id: 'add-trip',
            target: '#btn-add-trip',
            title: "Record a Trip",
            content: "Click here to add a new trip. Let's try opening it now.",
            position: 'top',
            action: 'wait-interaction', // Wait for user to click
            check: () => isTripEditing
        },
        {
            id: 'editor-modes',
            target: '#trip-editor-toggle-mode',
            title: "Two Input Modes",
            content: "You can manually enter details or use the 'Auto Plan' feature to search for routes.",
            position: 'bottom',
            action: 'next'
        },
        {
            id: 'close-editor',
            target: '#btn-close-editor',
            title: "Close Editor",
            content: "Let's close this for now to continue the tour.",
            position: 'bottom',
            action: 'wait-interaction',
            check: () => !isTripEditing
        },
        {
            id: 'import-export',
            target: '#header-actions',
            title: "Data Management",
            content: "Here you can export your data (KML/JSON) or import backups. Keep your data safe!",
            position: 'bottom',
            action: 'next'
        },
        {
            id: 'tab-map',
            target: '#tab-btn-map',
            title: "Map View",
            content: "Switch to the Map tab to see your travels on the map.",
            position: 'top',
            action: 'switch-tab',
            tab: 'map'
        },
        {
            id: 'map-pins',
            target: '#btn-pins-fab',
            title: "Map Pins",
            content: "Use this button to add pins (photos or comments) to the map.",
            position: 'right', // FAB is bottom-left
            action: 'wait-interaction',
            check: () => pinMode && pinMode !== 'idle'
        },
        {
            id: 'map-layers',
            target: '.leaflet-control-layers',
            title: "Switch Map Style",
            content: "Toggle between Dark and Light map themes here.",
            position: 'left', // Top-right control
            action: 'next'
        },
        {
            id: 'tab-stats',
            target: '#tab-btn-stats',
            title: "Statistics",
            content: "Finally, check your travel statistics here.",
            position: 'top',
            action: 'wait-click-tab', // Specifically asked to guide click
            tab: 'stats',
            check: () => activeTab === 'stats'
        },
        {
            id: 'stats-content',
            target: '#stats-view-content',
            title: "Your Achievements",
            content: "View your total distance, cost, and most frequented lines here.",
            position: 'center', // It's a large area, maybe just highlight without blocking? Or center modal over it? Let's try target.
            action: 'next'
        },
        {
            id: 'finish-login',
            target: null,
            title: "Login & User Guide",
            content: "That's it! We'll now open the Login screen where you can read the full User Guide.",
            position: 'center',
            action: 'finish'
        },
        {
             id: 'login-guide',
             target: '#login-readme-container',
             title: "Read the Guide",
             content: "Please take a moment to read the User Guide / Agreement here.",
             position: 'left',
             action: 'end'
        }
    ];

    // Initialization check
    useEffect(() => {
        const skipped = localStorage.getItem('rail_tutorial_skipped');
        // If user logged in (and likely not new), maybe skip?
        // Requirement says "entering page in non-login status".
        // If user is already logged in via token in URL or localStorage, we might skip,
        // BUT user specifically said "non-login status".
        // We will assume `user` prop is null if not logged in.

        if (skipped === 'true' || user) {
            setStep(-2); // Skipped
            return;
        }

        // Start tutorial
        setStep(0);
        setIsVisible(true);
    }, [user]);

    // Step Transition Logic & Rect Calculation
    useEffect(() => {
        if (step < 0 || step >= STEPS.length) return;

        const currentStep = STEPS[step];

        // 1. Target Resolution
        const updateRect = () => {
            if (!currentStep.target) {
                setRect(null);
                setTooltipPos({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
                return;
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
                // Element not found? Retry in a bit (maybe animation or mounting)
                setRect(null);
            }
        };

        // Initial update
        updateRect();
        // Poll for rect changes (animations)
        const interval = setInterval(updateRect, 100);

        // 2. Auto-actions (Switch Tab)
        if (currentStep.action === 'switch-tab' && currentStep.tab && activeTab !== currentStep.tab) {
             setActiveTab(currentStep.tab);
        }

        // 3. Wait Conditions
        let checkInterval;
        if (currentStep.check) {
            checkInterval = setInterval(() => {
                if (currentStep.check()) {
                    handleNext();
                }
            }, 200);
        }

        return () => {
            clearInterval(interval);
            if (checkInterval) clearInterval(checkInterval);
        };
    }, [step, activeTab, isTripEditing, isLoginOpen, pinMode]);

    // Strict Positioning Logic
    const calculatePosition = () => {
        if (step < 0 || step >= STEPS.length || !rect || !tooltipRef.current) return;

        const currentStep = STEPS[step];
        const PADDING = 20;

        // Measure ACTUAL tooltip dimensions
        const CARD_W = tooltipRef.current.offsetWidth || 384;
        const CARD_H = tooltipRef.current.offsetHeight || 250;

        let top, left, transform = 'none';

        if (currentStep.position === 'bottom') {
            top = rect.top + rect.height + 20;
            left = rect.left;
        } else if (currentStep.position === 'top') {
            top = rect.top - CARD_H - 20;
            left = rect.left;
        } else if (currentStep.position === 'right') {
            // Vertically center for side positioning
            top = rect.top + (rect.height / 2) - (CARD_H / 2);
            left = rect.left + rect.width + 20;
        } else if (currentStep.position === 'left') {
            // Vertically center for side positioning
            top = rect.top + (rect.height / 2) - (CARD_H / 2);
            left = rect.left - CARD_W - 20;
        } else { // center
            top = '50%';
            left = '50%';
            transform = 'translate(-50%, -50%)';
        }

        // --- Strict Boundary Logic ---
        // Use visualViewport if available for mobile robustness
        const winH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const winW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const offsetTop = window.visualViewport ? window.visualViewport.offsetTop : 0;

        // Adjust for viewport scrolling/offset if using visualViewport
        // Actually for fixed position elements, visualViewport logic is complex.
        // If we use simple innerHeight, it might be safer unless keyboard is up.
        // But for FAB (bottom) clipping, visualViewport height is the visible part.

        if (typeof top === 'number') {
            // 1. Flip Logic (Vertical)
            // If overflow bottom, try flip top
            if (top + CARD_H > winH - PADDING) {
                if (currentStep.position === 'bottom') {
                     const flippedTop = rect.top - CARD_H - 20;
                     if (flippedTop > PADDING) top = flippedTop;
                }
            }
            // If overflow top, try flip bottom
            if (top < PADDING) {
                if (currentStep.position === 'top') {
                    const flippedBottom = rect.top + rect.height + 20;
                    if (flippedBottom + CARD_H < winH - PADDING) top = flippedBottom;
                }
            }

            // 2. Clamp Logic (Vertical) - Final fallback
            if (top < PADDING) top = PADDING;
            if (top + CARD_H > winH - PADDING) top = winH - CARD_H - PADDING;
        }

        if (typeof left === 'number') {
            // 1. Flip Logic (Horizontal)
            if (left + CARD_W > winW - PADDING) {
                if (currentStep.position === 'right') {
                    const flippedLeft = rect.left - CARD_W - 20;
                    if (flippedLeft > PADDING) left = flippedLeft;
                }
            }
             if (left < PADDING) {
                if (currentStep.position === 'left') {
                    const flippedRight = rect.left + rect.width + 20;
                    if (flippedRight + CARD_W < winW - PADDING) left = flippedRight;
                }
            }

            // 2. Clamp Logic (Horizontal)
            if (left < PADDING) left = PADDING;
            if (left + CARD_W > winW - PADDING) left = winW - CARD_W - PADDING;
        }

        setTooltipPos({ top, left, transform });
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

    const handleNext = () => {
        if (step === STEPS.length - 2) { // Finish step
            // Open Login Modal
            setIsLoginOpen(true);
            // Wait a bit for modal to open then next
            setTimeout(() => setStep(s => s + 1), 500);
        } else if (step >= STEPS.length - 1) {
            // End
            setStep(-2);
            setIsVisible(false);
        } else {
            setStep(s => s + 1);
        }
    };

    const handleSkip = (dontShowAgain) => {
        if (dontShowAgain) {
            localStorage.setItem('rail_tutorial_skipped', 'true');
        }
        setStep(-2);
        setIsVisible(false);
    };

    if (!isVisible || step < 0) return null;

    const currentStep = STEPS[step];
    const isInteractionStep = currentStep.action === 'wait-interaction' || currentStep.action === 'wait-click-tab';

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
                className={`absolute pointer-events-auto transition-all duration-300 flex flex-col gap-4 max-w-sm w-full p-6 bg-white rounded-2xl shadow-2xl animate-slide-up`}
                style={{
                    top: tooltipPos.top,
                    left: tooltipPos.left,
                    transform: tooltipPos.transform,
                    opacity: tooltipPos.top ? 1 : 0 // Hide until positioned
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
                                    Don't show again
                                </label>
                            )}
                            {step > 0 && (
                                <button onClick={() => handleSkip(true)} className="text-xs text-gray-400 hover:text-gray-600 underline">Skip Tutorial</button>
                            )}
                         </div>

                        {!isInteractionStep && (
                             <button
                                onClick={handleNext}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-200 transition-all transform active:scale-95"
                             >
                                {step === STEPS.length - 1 ? 'Finish' : 'Next'} <ArrowRight size={16}/>
                             </button>
                        )}
                        {isInteractionStep && (
                            <div className="text-xs font-bold text-emerald-600 animate-pulse flex items-center gap-1">
                                <ChevronRight size={14}/> Please interact to continue...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    , document.body);
};

export default Tutorial;
