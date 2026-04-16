import ReactGA from 'react-ga4';

// Initialize GA4 if ID is provided
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;
if (GA_MEASUREMENT_ID) {
    ReactGA.initialize(GA_MEASUREMENT_ID);
}

// Helper for Baidu Tongji
declare global {
    interface Window {
        _hmt?: any[];
        uetq?: any[];
    }
}

type EventParams = {
    category: string;
    action: string;
    label?: string;
    value?: number;
};

export const trackEvent = ({ category, action, label, value }: EventParams) => {
    // 1. Google Analytics 4
    if (GA_MEASUREMENT_ID) {
        ReactGA.event({
            category,
            action,
            label,
            value
        });
    }

    // 2. Baidu Tongji
    if (window._hmt) {
        // _hmt.push(['_trackEvent', category, action, opt_label, opt_value]);
        const baiduParams = ['_trackEvent', category, action];
        if (label) baiduParams.push(label);
        if (value !== undefined) baiduParams.push(value.toString());
        window._hmt.push(baiduParams);
    }

    // 3. Bing UET (Universal Event Tracking)
    if (window.uetq) {
        window.uetq.push('event', action, {
            event_category: category,
            event_label: label,
            event_value: value
        });
    }
};

// Common Events
export const AnalyticsEvents = {
    USER_ACTION: 'User_Action',
    TRIP_ACTION: 'Trip_Action',
    SYSTEM_ACTION: 'System_Action'
};
