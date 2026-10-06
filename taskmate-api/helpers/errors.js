// Shared API error: a stable machine-readable `code` plus the HTTP status to answer with.
class AppError extends Error {
    constructor(code, message, status = 400, details) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.status = status;
        if (details !== undefined) this.details = details;
    }
}

const isAppError = (err) => err instanceof AppError;

// Standard error envelope. `success: false` keeps the analytics clients working;
// unknown errors are logged server-side and never leak DB/driver text to the client.
const sendError = (res, err) => {
    if (isAppError(err)) {
        return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
};

module.exports = { AppError, isAppError, sendError };
