// Unit tests for helpers/transaction.js with a fake connection (no database needed).
// The same behaviour is exercised against SQL Server in transaction.dbtest.js.
jest.mock('../../helpers/pool', () => ({ acquire: jest.fn(), release: jest.fn() }));
jest.mock('../../helpers/execQuery', () => ({ runRequest: jest.fn() }));

const pool = require('../../helpers/pool');
const { runRequest } = require('../../helpers/execQuery');
const {
    withTransaction, useTransaction, isUniqueViolation, isFkViolation, isCheckViolation, isDeadlock, violatedConstraint,
} = require('../../helpers/transaction');

const sqlError = (number, message = 'error') => Object.assign(new Error(message), { number });

function fakeConnection() {
    const conn = {
        inTransaction: false,
        calls: [],
        execSqlBatch: jest.fn(request => { conn.calls.push(request.sqlTextOrProcedure); request.userCallback(null, 0, []); }),
        beginTransaction: jest.fn(cb => { conn.calls.push('BEGIN'); conn.inTransaction = true; cb(null); }),
        commitTransaction: jest.fn(cb => { conn.calls.push('COMMIT'); conn.inTransaction = false; cb(null); }),
        rollbackTransaction: jest.fn(cb => { conn.calls.push('ROLLBACK'); conn.inTransaction = false; cb(null); }),
    };
    return conn;
}

let conns;
beforeEach(() => {
    conns = [];
    pool.acquire.mockImplementation(async () => { const c = fakeConnection(); conns.push(c); return c; });
    pool.release.mockResolvedValue();
    runRequest.mockImplementation(async (conn, sql) => ({ rows: [{ sql }], rowCount: 1 }));
});

describe('withTransaction (unit)', () => {
    it('sets XACT_ABORT/LOCK_TIMEOUT, commits and releases with reset', async () => {
        const result = await withTransaction(tx => tx.read('SELECT 1'), { lockTimeoutMs: 1234 });
        expect(result).toEqual([{ sql: 'SELECT 1' }]);
        expect(conns[0].calls).toEqual(['SET XACT_ABORT ON; SET LOCK_TIMEOUT 1234;', 'BEGIN', 'COMMIT']);
        expect(pool.release).toHaveBeenCalledWith(conns[0], { reset: true });
    });

    it('runs queued requests one at a time in FIFO order', async () => {
        let running = 0;
        let maxRunning = 0;
        const order = [];
        runRequest.mockImplementation(async (conn, sql) => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            await new Promise(resolve => setTimeout(resolve, 5));
            order.push(sql);
            running -= 1;
            return { rows: [], rowCount: 1 };
        });
        await withTransaction(tx => Promise.all(['a', 'b', 'c'].map(sql => tx.write(sql))));
        expect(order).toEqual(['a', 'b', 'c']);
        expect(maxRunning).toBe(1);
    });

    it('after a failure, rejects queued requests without sending them and rolls back', async () => {
        runRequest.mockImplementation(async (conn, sql) => {
            if (sql === 'bad') throw sqlError(2627, 'Violation of PRIMARY KEY constraint');
            return { rows: [], rowCount: 1 };
        });
        const results = [];
        await expect(withTransaction(async (tx) => {
            await Promise.allSettled(['ok', 'bad', 'never'].map(sql => tx.write(sql).then(
                () => results.push(`${sql}:ok`), err => results.push(`${sql}:${err.message}`)
            )));
            return 'callback swallowed the error';
        })).rejects.toThrow('Violation of PRIMARY KEY constraint');
        expect(results).toEqual(['ok:ok', 'bad:Violation of PRIMARY KEY constraint', 'never:Transaction aborted by a previous error']);
        expect(runRequest.mock.calls.map(c => c[1])).toEqual(['ok', 'bad']);
        expect(conns[0].calls).toContain('ROLLBACK');
        expect(conns[0].calls).not.toContain('COMMIT');
        expect(pool.release).toHaveBeenCalledWith(conns[0], { reset: true });
    });

    it('does not roll back when the server already ended the transaction', async () => {
        runRequest.mockImplementation(async (conn) => { conn.inTransaction = false; throw sqlError(547, 'FOREIGN KEY'); });
        await expect(withTransaction(tx => tx.write('x'))).rejects.toThrow('FOREIGN KEY');
        expect(conns[0].rollbackTransaction).not.toHaveBeenCalled();
    });

    it('retries deadlocks on a fresh connection, then gives up with DB_BUSY', async () => {
        let attempts = 0;
        runRequest.mockImplementation(async () => {
            attempts += 1;
            if (attempts === 1) throw sqlError(1205, 'deadlocked');
            return { rows: [], rowCount: 1 };
        });
        await expect(withTransaction(tx => tx.write('x'))).resolves.toBe(1);
        expect(pool.acquire).toHaveBeenCalledTimes(2);

        runRequest.mockRejectedValue(sqlError(1205, 'deadlocked'));
        const err = await withTransaction(tx => tx.write('x'), { retries: 1 }).catch(e => e);
        expect(err).toEqual(expect.objectContaining({ code: 'DB_BUSY', status: 503 }));
        expect(isDeadlock(err)).toBe(true);
    });

    it('validates its options', async () => {
        await expect(withTransaction(async () => {}, { lockTimeoutMs: 1.5 })).rejects.toThrow(TypeError);
        await expect(withTransaction(async () => {}, { isolationLevel: 'CHAOS' })).rejects.toThrow(TypeError);
    });

    it('useTransaction reuses the caller transaction when given', async () => {
        const tx = { read: jest.fn().mockResolvedValue([]) };
        await useTransaction({ tx }, t => t.read('SELECT 1'));
        expect(tx.read).toHaveBeenCalledWith('SELECT 1');
        expect(pool.acquire).not.toHaveBeenCalled();
    });
});

describe('SQL error helpers', () => {
    it('classify driver errors, including AggregateError and wrapped causes', () => {
        const aggregate = new AggregateError([sqlError(3621), sqlError(2601, "Cannot insert duplicate key row with unique index 'UQ_X'")]);
        expect(isUniqueViolation(aggregate)).toBe(true);
        const wrapped = Object.assign(new Error('outer'), { cause: sqlError(1205) });
        expect(isDeadlock(wrapped)).toBe(true);
        const fk = sqlError(547, 'The INSERT statement conflicted with the FOREIGN KEY constraint "FK_TaskBranches_Tasks".');
        const check = sqlError(547, 'The UPDATE statement conflicted with the CHECK constraint "CK_PullRequests_MergedClosed".');
        expect([isFkViolation(fk), isCheckViolation(fk)]).toEqual([true, false]);
        expect([isFkViolation(check), isCheckViolation(check)]).toEqual([false, true]);
        expect(violatedConstraint(fk)).toBe('FK_TaskBranches_Tasks');
        expect(isUniqueViolation(new Error('plain'))).toBe(false);
    });
});
