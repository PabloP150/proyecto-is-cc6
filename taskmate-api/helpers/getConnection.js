const Connection = require('tedious').Connection;
const dotenv = require('dotenv');

dotenv.config();

const {
    DB_SERVER,
    DB_AUTH_TYPE = 'default',
    DB_USERNAME,
    DB_PASSWORD,
    DB_NAME,
    DB_PORT,
    DB_INSTANCE,
    DB_ENCRYPT,
    DB_TRUST_SERVER_CERT
} = process.env;

// Normalize booleans from env (e.g., "true"/"false")
const toBool = (val, fallback) => {
    if (val === undefined) return fallback;
    if (typeof val === 'boolean') return val;
    return String(val).toLowerCase() === 'true';
};

// For local SQL Server, typically encrypt=false and trustServerCertificate=true.
// For Azure SQL, encrypt=true and trustServerCertificate=false.
const isLocalServer = DB_SERVER?.toLowerCase() === 'localhost' || DB_SERVER === '127.0.0.1';
const encrypt = toBool(DB_ENCRYPT, isLocalServer ? false : true);
const trustServerCertificate = toBool(DB_TRUST_SERVER_CERT, isLocalServer ? true : false);

const configConnection = {
    server: DB_SERVER,
    authentication: {
        type: DB_AUTH_TYPE,
        options: {
            userName: DB_USERNAME,
            password: DB_PASSWORD
        },
    },
    options: {
        database: DB_NAME,
        rowCollectionOnDone: true,
        encrypt,
        trustServerCertificate,
    // Evita convertir fechas a UTC, usa zona horaria local del servidor
    useUTC: false,
        ...(DB_PORT ? { port: Number(DB_PORT) } : {}),
        ...(DB_INSTANCE ? { instanceName: DB_INSTANCE } : {}),
    }
};

const getConnection = () => {
    const connect = () => new Promise((resolve, reject) => {
        const connectionInstance = new Connection(configConnection);
        connectionInstance.on('connect', (error) => {
            if (!error) {
                resolve(connectionInstance);
            } else {
                console.error("[DB] Connection failed", error?.message || error);
                reject(error);
            }
        });
        connectionInstance.connect();
    });
    return { connect };
};

module.exports = getConnection;
