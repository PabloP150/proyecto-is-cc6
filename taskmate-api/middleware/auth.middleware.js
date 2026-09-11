const { verifyAccessToken } = require('../helpers/tokens');
const { AppError, sendError } = require('../helpers/errors');

const BEARER_RE = /^Bearer\s+(\S+)\s*$/i;

function requireAuth(req, res, next) {
    const match = typeof req.headers.authorization === 'string' && req.headers.authorization.match(BEARER_RE);
    if (!match) {
        return sendError(res, new AppError('UNAUTHENTICATED', 'Authentication required.', 401));
    }
    try {
        req.user = verifyAccessToken(match[1]);
    } catch (error) {
        return sendError(res, error);
    }
    next();
}

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
