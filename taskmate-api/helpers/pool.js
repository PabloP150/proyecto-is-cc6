const { Connection } = require('tedious');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });

const { DB_SERVER, DB_AUTH_TYPE = 'default', DB_USERNAME, DB_PASSWORD, DB_NAME, DB_PORT, DB_INSTANCE, DB_ENCRYPT, DB_TRUST_SERVER_CERT } = process.env;

const toBool = (val, fallback) => {
    if (val === undefined) return fallback;
    return String(val).toLowerCase() === 'true';
};

const isLocal = DB_SERVER?.toLowerCase() === 'localhost' || DB_SERVER === '127.0.0.1';

const dbConfig = {
    server: DB_SERVER,
    authentication: { type: DB_AUTH_TYPE, options: { userName: DB_USERNAME, password: DB_PASSWORD } },
    options: {
        database: DB_NAME,
        // Rows are collected from 'row' events by execQuery/transaction; tedious does not need to buffer them.
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        encrypt: toBool(DB_ENCRYPT, !isLocal),
        trustServerCertificate: toBool(DB_TRUST_SERVER_CERT, isLocal),
        useUTC: false,
        ...(DB_PORT ? { port: Number(DB_PORT) } : {}),
        ...(DB_INSTANCE ? { instanceName: DB_INSTANCE } : {}),
    }
};

const POOL_MAX = Number(process.env.DB_POOL_MAX) || 10;
const POOL_MIN = 2;
const ACQUIRE_TIMEOUT_MS = 10000;

const idle = [];
let active = 0;
const queue = [];
let ending = false;

function createConnection() {
    return new Promise((resolve, reject) => {
        const conn = new Connection(dbConfig);
        // A socket error on an idle connection must not crash the process; the
        // connection moves to the Final state and is discarded on next acquire.
        conn.on('error', () => {});
        conn.on('connect', err => err ? reject(err) : resolve(conn));
        conn.connect();
    });
}

function isAlive(conn) {
    return Boolean(conn && conn.state && conn.state.name === 'LoggedIn' && !conn.closed);
}

function discard(conn) {
    active--;
    try { conn.close(); } catch (_) { /* already closed */ }
    // A waiter may be blocked on the slot we just freed.
    if (queue.length > 0 && active < POOL_MAX) {
        const waiter = queue.shift();
        clearTimeout(waiter.timer);
        active++;
        createConnection()
            .then(waiter.resolve)
            .catch(err => { active--; waiter.reject(err); });
    }
}

function handOff(conn) {
    if (ending) {
        discard(conn);
        return;
    }
    if (queue.length > 0) {
        const waiter = queue.shift();
        clearTimeout(waiter.timer);
        waiter.resolve(conn);
        return;
    }
    idle.push(conn);
}

async function acquire() {
    while (idle.length > 0) {
        const conn = idle.pop();
        if (isAlive(conn)) return conn;
        active--;
        try { conn.close(); } catch (_) { /* already closed */ }
    }

    if (active < POOL_MAX) {
        active++;
        try {
            return await createConnection();
        } catch (err) {
            active--;
            throw err;
        }
    }

    return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
            const idx = queue.indexOf(waiter);
            if (idx !== -1) queue.splice(idx, 1);
            reject(new Error('[DB Pool] Timed out waiting for a connection'));
        }, ACQUIRE_TIMEOUT_MS);
        queue.push(waiter);
    });
}

/**
 * Returns a connection to the pool.
 * `reset: true` (always used after a transaction) runs tedious' conn.reset(), which
 * issues sp_reset_connection plus the initial SET options: open transactions are
 * rolled back, XACT_ABORT/isolation level/LOCK_TIMEOUT go back to defaults.
 * A connection that is still inside a transaction is always reset. If the reset
 * fails the connection is closed and never reused.
 */
function release(conn, { reset = false } = {}) {
    if (!isAlive(conn)) {
        discard(conn);
        return Promise.resolve();
    }
    if (!reset && !conn.inTransaction) {
        handOff(conn);
        return Promise.resolve();
    }
    return new Promise(resolve => {
        conn.reset(err => {
            if (err || !isAlive(conn) || conn.inTransaction) discard(conn);
            else handOff(conn);
            resolve();
        });
    });
}

async function initialize() {
    const promises = [];
    for (let i = 0; i < POOL_MIN; i++) {
        active++;
        promises.push(
            createConnection()
                .then(conn => idle.push(conn))
                .catch(err => { active--; console.warn('[DB Pool] Pre-warm failed:', err.message); })
        );
    }
    await Promise.all(promises);
    console.log(`[DB Pool] Ready — ${idle.length} idle connections (max: ${POOL_MAX})`);
}

// Closes idle connections and rejects waiters (tests and graceful shutdown). Connections
// borrowed at that moment, or acquired later, are closed when released.
async function end() {
    ending = true;
    while (queue.length > 0) {
        const waiter = queue.shift();
        clearTimeout(waiter.timer);
        waiter.reject(new Error('[DB Pool] Pool is shutting down'));
    }
    while (idle.length > 0) {
        const conn = idle.pop();
        active--;
        try { conn.close(); } catch (_) { /* already closed */ }
    }
}

const stats = () => ({ active, idle: idle.length, waiting: queue.length, max: POOL_MAX });

// `connect` opens a dedicated connection outside the pool (migration runner).
module.exports = { acquire, release, initialize, end, stats, connect: createConnection };
