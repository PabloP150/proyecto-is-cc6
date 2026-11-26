const cors = require('cors');

const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

// FRONTEND_URL may list several origins separated by commas.
const allowedOrigins = () => (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL)
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

// Local development only (ALLOW_LAN_ORIGINS=true): the app opened from another device on the same
// network, whatever its address (http, a private IPv4 address, any port).
const PRIVATE_IPV4_ORIGIN = /^http:\/\/(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(:\d{1,5})?$/;
const isLanOrigin = (origin) => process.env.ALLOW_LAN_ORIGINS === 'true' && PRIVATE_IPV4_ORIGIN.test(origin);

// Requests without an Origin header (curl, server-to-server, same-origin) are not CORS requests.
const isAllowedOrigin = (origin) => !origin || allowedOrigins().includes(origin) || isLanOrigin(origin);

const corsMiddleware = () => cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) });

module.exports = {
    corsMiddleware,
    isAllowedOrigin,
    allowedOrigins,
};
