const { AppError, isAppError, sendError } = require('../helpers/errors');
const { isUniqueViolation, isFkViolation } = require('../helpers/transaction');

// Turns SQL constraint violations into client errors; anything else is returned untouched.
//   unique:     {code, message} → 409 with that code
//   foreignKey: message         → 400 VALIDATION_ERROR
const mapConstraintError = (error, { unique, foreignKey } = {}) => {
    if (isAppError(error)) return error;
    if (unique && isUniqueViolation(error)) return new AppError(unique.code, unique.message, 409);
    if (foreignKey && isFkViolation(error)) return new AppError('VALIDATION_ERROR', foreignKey, 400);
    return error;
};

const notFoundHandler = (req, res) => sendError(res, new AppError('NOT_FOUND', 'Route not found', 404));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (!isAppError(err) && err && err.type === 'entity.parse.failed') {
        return sendError(res, new AppError('VALIDATION_ERROR', 'Malformed JSON body', 400));
    }
    if (!isAppError(err) && err && err.type === 'entity.too.large') {
        return sendError(res, new AppError('VALIDATION_ERROR', 'Request body too large', 413));
    }
    // Other client errors raised by body-parser & co. (e.g. unsupported charset); their text is not forwarded.
    if (!isAppError(err) && err && err.expose && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
        return sendError(res, new AppError('VALIDATION_ERROR', 'Invalid request', err.status));
    }
    return sendError(res, err);
};

module.exports = { notFoundHandler, errorHandler, mapConstraintError };
