const pool = require('./pool');
const { Request } = require('tedious');

const rowToObject = (columns) => {
    const row = {};
    columns.forEach(col => { row[col.metadata.colName] = col.value; });
    return row;
};

/**
 * Runs one request on `conn` and resolves once tedious invokes the Request callback,
 * which is the only point where the whole batch has finished: `rowCount` is the sum
 * of every statement's count and `rows` holds the rows of every result set in order.
 */
const runRequest = (conn, query, params) => new Promise((resolve, reject) => {
    const rows = [];
    const request = new Request(query, (err, rowCount) => {
        if (err) reject(err);
        else resolve({ rows, rowCount: rowCount ?? 0 });
    });
    if (params) {
        params.forEach(p => request.addParameter(p.name, p.type, p.value, p.options));
    }
    request.on('row', columns => rows.push(rowToObject(columns)));
    conn.execSql(request);
});

const execQuery = async (query, params = null) => {
    const conn = await pool.acquire();
    let failed = false;
    try {
        return await runRequest(conn, query, params);
    } catch (err) {
        failed = true;
        throw err;
    } finally {
        // A failed batch may leave session state behind (e.g. an open transaction).
        await pool.release(conn, { reset: failed });
    }
};

const execWriteCommand = async (query, params = null) => (await execQuery(query, params)).rowCount;

const execReadCommand = async (query, params = null) => (await execQuery(query, params)).rows;

module.exports = { execWriteCommand, execReadCommand, execQuery, runRequest, rowToObject };
