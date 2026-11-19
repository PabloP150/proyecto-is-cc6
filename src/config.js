// Without an explicit URL, the API is on the same host as the page (so the app also works
// when opened from another computer on the network, not only on localhost).
const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
const API_BASE = process.env.REACT_APP_API_URL || `http://${host}:9000`;
const WS_BASE  = process.env.REACT_APP_WS_URL  || `ws://${host}:9000`;

export { API_BASE, WS_BASE };
