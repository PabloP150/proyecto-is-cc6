const getConnection = require('./getConnection');
const Request = require('tedious').Request;

const execQuery = (query, params, callbackEvent) => {
    const command = new Promise((resolve, reject) => {
        getConnection().connect()
        .then(instance => {
            const request = new Request(query, (error) => {
                if (error) {
                    reject(error);
                }
            });
            if (params) {
                params.forEach(param => {
                    request.addParameter(
                        param.name,
                        param.type,
                        param.value
                    );
                });
            }
            const close = () => instance.close();

            request.on('error', error => {
                close();
                reject(error);
            });
            callbackEvent(request, close, resolve);
            instance.execSql(request);
        })
        .catch(error => reject(error));
    });
    return command;
};

const execWriteCommand = (query, params) => {
    const callbackEvent = (request, close, resolve) => {
        request.on('requestCompleted', (rowCount, more) => {
            close();
            resolve(rowCount, more);
        });
    };
    return execQuery(query, params, callbackEvent);
}

const execReadCommand = (query, params = null) => {
    const callbackEvent = (request, close, resolve) => {
        request.on('doneInProc', (rowCount, more, rows) => {
            const responseRows = [];
            if (rows) rows.forEach(row => {
                const currentRow = {};
                if (row) row.forEach(column => {
                    currentRow[column.metadata.colName] = column.value;
                });
                responseRows.push(currentRow); 
            });
            resolve(responseRows);
        });
        request.on('requestCompleted', () => close());
    };
    return execQuery(query, params, callbackEvent);
};

module.exports = {
    execWriteCommand,
    execReadCommand
};
