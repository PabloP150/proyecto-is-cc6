const pool = require('./pool');
const { Request } = require('tedious');

const execQuery = (query, params, callbackEvent) => {
    return new Promise(async (resolve, reject) => {
        let conn;
        try {
            conn = await pool.acquire();
        } catch (err) {
            return reject(err);
        }

        const release = () => pool.release(conn);

        const request = new Request(query, err => {
            if (err) reject(err);
        });

        if (params) {
            params.forEach(p => request.addParameter(p.name, p.type, p.value));
        }

        request.on('error', err => {
            release();
            reject(err);
        });

        callbackEvent(request, release, resolve);
        conn.execSql(request);
    });
};

const execWriteCommand = (query, params) => {
    const callbackEvent = (request, release, resolve) => {
        request.on('requestCompleted', (rowCount, more) => {
            release();
            resolve(rowCount, more);
        });
    };
    return execQuery(query, params, callbackEvent);
};

const execReadCommand = (query, params = null) => {
    const callbackEvent = (request, release, resolve) => {
        request.on('doneInProc', (rowCount, more, rows) => {
            const responseRows = [];
            if (rows) rows.forEach(row => {
                const currentRow = {};
                if (row) row.forEach(col => { currentRow[col.metadata.colName] = col.value; });
                responseRows.push(currentRow);
            });
            resolve(responseRows);
        });
        request.on('requestCompleted', () => release());
    };
    return execQuery(query, params, callbackEvent);
};

module.exports = { execWriteCommand, execReadCommand };
