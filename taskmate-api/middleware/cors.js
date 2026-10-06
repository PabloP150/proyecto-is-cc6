const cors = require('cors');

const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

// FRONTEND_URL may list several origins separated by commas.
const allowedOrigins = () => (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL)
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

// Requests without an Origin header (curl, server-to-server, same-origin) are not CORS requests.
const isAllowedOrigin = (origin) => !origin || allowedOrigins().includes(origin);

const corsMiddleware = () => {
    const origins = allowedOrigins();
    return cors({ origin: (origin, callback) => callback(null, origins) });
};

module.exports = {
    corsMiddleware,
    isAllowedOrigin,
    allowedOrigins,
};
