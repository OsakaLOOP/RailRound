import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

// Constant for non-React contexts or initial checks
export const IS_MOBILE = (() => {
  if (typeof window === 'undefined') return false;
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= MOBILE_BREAKPOINT;
  return hasTouch || isSmallScreen;
})();

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(IS_MOBILE);

  useEffect(() => {
    const checkMobile = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(hasTouch || isSmallScreen);
    };

    window.addEventListener('resize', checkMobile);
    // Initial check just in case
    checkMobile();

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}
