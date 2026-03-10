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
        rowCollectionOnDone: true,
        encrypt: toBool(DB_ENCRYPT, !isLocal),
        trustServerCertificate: toBool(DB_TRUST_SERVER_CERT, isLocal),
        useUTC: false,
        ...(DB_PORT ? { port: Number(DB_PORT) } : {}),
        ...(DB_INSTANCE ? { instanceName: DB_INSTANCE } : {}),
    }
};

const POOL_MAX = 10;
const POOL_MIN = 2;

const idle = [];
let active = 0;
const queue = [];

function createConnection() {
    return new Promise((resolve, reject) => {
        const conn = new Connection(dbConfig);
        conn.on('connect', err => err ? reject(err) : resolve(conn));
        conn.connect();
    });
}

function isAlive(conn) {
    return conn.state && conn.state.name !== 'Final' && !conn.closed;
}

async function acquire() {
    while (idle.length > 0) {
        const conn = idle.pop();
        if (isAlive(conn)) return conn;
        active--;
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

    return new Promise((resolve, reject) => queue.push({ resolve, reject }));
}

function release(conn) {
    if (queue.length > 0) {
        const waiter = queue.shift();
        if (isAlive(conn)) {
            waiter.resolve(conn);
        } else {
            active--;
            acquire().then(waiter.resolve).catch(waiter.reject);
        }
        return;
    }

    if (isAlive(conn)) {
        idle.push(conn);
    } else {
        active--;
    }
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

module.exports = { acquire, release, initialize };
