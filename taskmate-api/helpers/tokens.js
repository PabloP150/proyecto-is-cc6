const jwt = require('jsonwebtoken');
const { AppError } = require('./errors');

const ALGORITHM = 'HS256';
const ACCESS_TYP = 'access';
const ACCESS_TTL = '24h';
const PURPOSE_AUDIENCE = 'taskmate';

const getSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return secret;
};

const signAccessToken = ({ userId, username }) => {
    if (!userId) throw new Error('signAccessToken requires a userId');
    return jwt.sign({ userId, username, typ: ACCESS_TYP }, getSecret(), {
        algorithm: ALGORITHM,
        expiresIn: ACCESS_TTL,
    });
};

// Only login tokens: typ 'access', no audience (purpose tokens carry one) and an expiry.
const verifyAccessToken = (token) => {
    let decoded;
    try {
        decoded = jwt.verify(token, getSecret(), { algorithms: [ALGORITHM] });
    } catch {
        throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.', 401);
    }
    if (decoded.typ !== ACCESS_TYP || decoded.aud !== undefined || !decoded.userId || !decoded.exp) {
        throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.', 401);
    }
    return { userId: decoded.userId, username: decoded.username };
};

const signPurposeToken = (purpose, payload = {}, expiresIn = '10m') => {
    if (typeof purpose !== 'string' || !purpose || purpose === ACCESS_TYP) {
        throw new Error('signPurposeToken requires a purpose other than "access"');
    }
    return jwt.sign({ ...payload, typ: purpose }, getSecret(), {
        algorithm: ALGORITHM,
        audience: PURPOSE_AUDIENCE,
        expiresIn,
    });
};

// Returns the decoded claims (payload plus typ/aud/iat/exp).
const verifyPurposeToken = (purpose, token) => {
    let decoded;
    try {
        decoded = jwt.verify(token, getSecret(), { algorithms: [ALGORITHM], audience: PURPOSE_AUDIENCE });
    } catch {
        throw new AppError('INVALID_STATE', 'Invalid or expired token.', 403);
    }
    if (!purpose || decoded.typ !== purpose) {
        throw new AppError('INVALID_STATE', 'Invalid or expired token.', 403);
    }
    return decoded;
};

module.exports = {
    signAccessToken,
    verifyAccessToken,
    signPurposeToken,
    verifyPurposeToken,
};
