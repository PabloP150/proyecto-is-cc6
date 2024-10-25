const Connection = require('tedious').Connection;
const dotenv = require('dotenv');

dotenv.config();

const {
    DB_SERVER,
    DB_AUTH_TYPE,
    DB_USERNAME,
    DB_PASSWORD,
    DB_NAME
} = process.env;

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
        encrypt: true,
        database: DB_NAME,
        rowCollectionOnDone: true
    }
};

const getConnection = () => {
    const connect = () => new Promise((resolve, reject) => {
        const connectionInstance = new Connection(configConnection);
        connectionInstance.on('connect', (error) => {
            if (!error) {
                resolve(connectionInstance);
            } else {
                console.error("Connection failed", error);
                reject(error);
            }
        });
        connectionInstance.connect();
    });
    return { connect };
};

module.exports = getConnection;
