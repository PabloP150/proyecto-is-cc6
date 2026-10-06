const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { AppError, sendError } = require('../helpers/errors');

const positiveInt = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const clientIp = (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');

const userOrIpKey = (req) => (req.user && req.user.userId ? `user:${req.user.userId}` : `ip:${clientIp(req)}`);

// keyByUser needs req.user, so mount those limiters after requireAuth; without a user they fall back to the IP.
function createLimiter({
    windowMs = 60 * 1000,
    limit = 60,
    keyByUser = true,
    keyGenerator,
    message = 'Too many requests, please try again later.',
    ...options
} = {}) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        keyGenerator: keyGenerator || (keyByUser ? userOrIpKey : (req) => `ip:${clientIp(req)}`),
        handler: (req, res) => sendError(res, new AppError('RATE_LIMITED', message, 429)),
        ...options,
    });
}

// Login and registration share one counter per IP.
const authLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    limit: positiveInt(process.env.AUTH_RATE_LIMIT_MAX, 10),
    keyByUser: false,
    message: 'Too many authentication attempts, please try again later.',
});

const apiLimiter = createLimiter({
    windowMs: 60 * 1000,
    limit: positiveInt(process.env.API_RATE_LIMIT_MAX, 300),
    keyByUser: true,
});

module.exports = {
    createLimiter,
    authLimiter,
    apiLimiter,
};
