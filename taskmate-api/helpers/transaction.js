const { Request, ISOLATION_LEVEL } = require('tedious');
const pool = require('./pool');
const { runRequest } = require('./execQuery');
const { AppError } = require('./errors');

// ---- SQL Server error classification -------------------------------------------------

// tedious reports several server errors in one request as an AggregateError, and callers
// may wrap the driver error in `cause`, so every number in the chain is considered.
const sqlErrorNumbers = (err, acc = new Set(), depth = 0) => {
    if (!err || typeof err !== 'object' || depth > 5) return acc;
    if (typeof err.number === 'number') acc.add(err.number);
    if (Array.isArray(err.errors)) err.errors.forEach(e => sqlErrorNumbers(e, acc, depth + 1));
    if (err.cause && err.cause !== err) sqlErrorNumbers(err.cause, acc, depth + 1);
    return acc;
};

const sqlErrors = (err, acc = [], depth = 0) => {
    if (!err || typeof err !== 'object' || depth > 5) return acc;
    if (typeof err.number === 'number') acc.push(err);
    if (Array.isArray(err.errors)) err.errors.forEach(e => sqlErrors(e, acc, depth + 1));
    if (err.cause && err.cause !== err) sqlErrors(err.cause, acc, depth + 1);
    return acc;
};

const hasNumber = (err, ...numbers) => {
    const found = sqlErrorNumbers(err);
    return numbers.some(n => found.has(n));
};

const isUniqueViolation = (err) => hasNumber(err, 2627, 2601);
// 547 is shared by FOREIGN KEY and CHECK conflicts; only the message tells them apart.
const isFkViolation = (err) => sqlErrors(err).some(e => e.number === 547 && /FOREIGN KEY|REFERENCE/i.test(e.message || ''));
const isCheckViolation = (err) => sqlErrors(err).some(e => e.number === 547 && /CHECK constraint/i.test(e.message || ''));
const isDeadlock = (err) => hasNumber(err, 1205);
const isLockTimeout = (err) => hasNumber(err, 1222);
// Name of the constraint mentioned by the first matching server error, if any.
const violatedConstraint = (err) => {
    for (const e of sqlErrors(err)) {
        const m = /constraint ['"]([^'"]+)['"]/i.exec(e.message || '');
        if (m) return m[1];
    }
    return null;
};

// ---- low level helpers ---------------------------------------------------------------

const execBatch = (conn, sql) => new Promise((resolve, reject) => {
    conn.execSqlBatch(new Request(sql, err => (err ? reject(err) : resolve())));
});

const tediousCall = (conn, method, ...args) => new Promise((resolve, reject) => {
    conn[method](err => (err ? reject(err) : resolve()), ...args);
});

const resolveIsolationLevel = (level) => {
    if (level === undefined || level === null) return undefined;
    if (typeof level === 'number' && Object.values(ISOLATION_LEVEL).includes(level)) return level;
    if (typeof level === 'string') {
        const key = level.trim().toUpperCase().replace(/\s+/g, '_');
        if (ISOLATION_LEVEL[key] !== undefined && key !== 'NO_CHANGE') return ISOLATION_LEVEL[key];
    }
    throw new TypeError(`Unknown isolation level: ${level}`);
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---- transaction object --------------------------------------------------------------

class Transaction {
    constructor(conn) {
        this.conn = conn;
        this.tail = Promise.resolve();
        this.error = null;
        this.closed = false;
    }

    /**
     * tedious runs one request at a time per connection, so requests are chained in a
     * FIFO queue (Promise.all inside a transaction is safe). After the first failure every
     * queued request is rejected without reaching the server: with XACT_ABORT ON the server
     * has already rolled back, and anything sent afterwards would run in autocommit mode.
     */
    query(sql, params = null) {
        const run = () => {
            if (this.closed) throw new Error('Transaction already finished');
            if (this.error) {
                const aborted = new Error('Transaction aborted by a previous error');
                aborted.cause = this.error;
                throw aborted;
            }
            return runRequest(this.conn, sql, params).catch(err => {
                if (!this.error) this.error = err;
                throw err;
            });
        };
        const result = this.tail.then(run, run);
        this.tail = result.catch(() => {});
        return result;
    }

    async read(sql, params = null) {
        return (await this.query(sql, params)).rows;
    }

    async write(sql, params = null) {
        return (await this.query(sql, params)).rowCount;
    }

    drain() {
        return this.tail;
    }
}

async function runOnce(fn, lockTimeoutMs, isolationLevel) {
    const conn = await pool.acquire();
    const tx = new Transaction(conn);
    try {
        // Session-level SETs must go in a plain batch: inside sp_executesql they would be
        // reverted when the call returns.
        await execBatch(conn, `SET XACT_ABORT ON; SET LOCK_TIMEOUT ${lockTimeoutMs};`);
        await tediousCall(conn, 'beginTransaction', '', isolationLevel);

        let result;
        let fnError = null;
        try {
            result = await fn(tx);
        } catch (err) {
            fnError = err;
        }
        await tx.drain();
        tx.closed = true;
        if (fnError) throw fnError;
        // The callback may have swallowed a failed request; the transaction is doomed anyway.
        if (tx.error) throw tx.error;

        await tediousCall(conn, 'commitTransaction');
        return result;
    } finally {
        tx.closed = true;
        if (conn.inTransaction) {
            try { await tediousCall(conn, 'rollbackTransaction'); } catch (_) { /* reset below also rolls back */ }
        }
        await pool.release(conn, { reset: true });
    }
}

/**
 * withTransaction(async (tx) => {...}, {retries = 2, lockTimeoutMs = 5000, isolationLevel})
 * tx.read(sql, params) → rows[] · tx.write(sql, params) → rowCount · tx.query(sql, params) → {rows, rowCount}
 * Deadlocks (1205) are retried by re-running the whole callback; a deadlock that exhausts the
 * retries or a lock timeout (1222) becomes AppError DB_BUSY (503) with the driver error as `cause`.
 */
async function withTransaction(fn, { retries = 2, lockTimeoutMs = 5000, isolationLevel } = {}) {
    if (typeof fn !== 'function') throw new TypeError('withTransaction requires a callback');
    if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < -1) {
        throw new TypeError('lockTimeoutMs must be an integer >= -1');
    }
    const level = resolveIsolationLevel(isolationLevel);

    for (let attempt = 0; ; attempt++) {
        try {
            return await runOnce(fn, lockTimeoutMs, level);
        } catch (err) {
            if (isDeadlock(err) && attempt < retries) {
                await sleep(20 * (attempt + 1) + Math.floor(Math.random() * 30));
                continue;
            }
            if ((isDeadlock(err) || isLockTimeout(err)) && !(err instanceof AppError)) {
                const busy = new AppError('DB_BUSY', 'The database is busy, please try again', 503);
                busy.cause = err;
                throw busy;
            }
            throw err;
        }
    }
}

// Runs `fn` in the caller's transaction when `options.tx` is given, otherwise in a new one.
const useTransaction = (options, fn) => (options && options.tx
    ? fn(options.tx)
    : withTransaction(fn, options || {}));

module.exports = {
    withTransaction,
    useTransaction,
    isUniqueViolation,
    isFkViolation,
    isCheckViolation,
    isDeadlock,
    isLockTimeout,
    violatedConstraint,
    sqlErrorNumbers,
    ISOLATION_LEVEL,
};
