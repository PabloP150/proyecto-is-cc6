const { TYPES } = require('tedious');
const pool = require('../../helpers/pool');
const { execReadCommand, execWriteCommand, runRequest } = require('../../helpers/execQuery');
const { withTransaction, isUniqueViolation, isDeadlock } = require('../../helpers/transaction');
const { AppError } = require('../../helpers/errors');

const TABLE = 'dbo.TxHelperTest';
const idParam = (id) => ({ name: 'id', type: TYPES.Int, value: id });
const insertRow = (tx, id) => tx.write(`INSERT INTO ${TABLE} (id, v) VALUES (@id, 0)`, [idParam(id)]);
const rowsWithIds = async (ids) => (await execReadCommand(
    `SELECT id FROM ${TABLE} WHERE id IN (${ids.map((_, i) => `@p${i}`).join(',')})`,
    ids.map((id, i) => ({ name: `p${i}`, type: TYPES.Int, value: id }))
)).map(r => r.id);

const SESSION_STATE = `SELECT @@SPID AS spid, @@TRANCOUNT AS trancount, (@@OPTIONS & 16384) AS xact_abort,
    @@LOCK_TIMEOUT AS lock_timeout,
    (SELECT transaction_isolation_level FROM sys.dm_exec_sessions WHERE session_id = @@SPID) AS isolation`;

let nextId = 1000;
const newId = () => ++nextId;

beforeAll(async () => {
    await execWriteCommand(`IF OBJECT_ID(N'${TABLE}', N'U') IS NOT NULL DROP TABLE ${TABLE};
        CREATE TABLE ${TABLE} (id INT NOT NULL CONSTRAINT PK_TxHelperTest PRIMARY KEY, v INT NOT NULL)`);
});

afterAll(async () => {
    await execWriteCommand(`IF OBJECT_ID(N'${TABLE}', N'U') IS NOT NULL DROP TABLE ${TABLE}`);
});

describe('execQuery', () => {
    it('execReadCommand returns the rows of every result set in a batch', async () => {
        const rows = await execReadCommand('SELECT 1 AS a; SELECT 2 AS a UNION ALL SELECT 3');
        expect(rows.map(r => r.a)).toEqual([1, 2, 3]);
    });

    it('execWriteCommand returns the affected row count', async () => {
        const [a, b] = [newId(), newId()];
        const count = await execWriteCommand(`INSERT INTO ${TABLE} (id, v) VALUES (@a, 0), (@b, 0)`, [
            { name: 'a', type: TYPES.Int, value: a }, { name: 'b', type: TYPES.Int, value: b },
        ]);
        expect(count).toBe(2);
        expect(await execWriteCommand(`UPDATE ${TABLE} SET v = 1 WHERE id = -1`)).toBe(0);
    });

    it('reports an error raised by a later statement of the batch', async () => {
        await expect(execReadCommand('SELECT 1 AS a; SELECT 1/0 AS b')).rejects.toThrow(/divide by zero/i);
    });
});

describe('withTransaction', () => {
    it('commits and returns the callback result', async () => {
        const id = newId();
        const result = await withTransaction(async (tx) => {
            await insertRow(tx, id);
            return (await tx.query(`SELECT v FROM ${TABLE} WHERE id = @id`, [idParam(id)])).rows[0];
        });
        expect(result).toEqual({ v: 0 });
        expect(await rowsWithIds([id])).toEqual([id]);
    });

    it('rolls back when the callback throws', async () => {
        const id = newId();
        await expect(withTransaction(async (tx) => {
            await insertRow(tx, id);
            throw new Error('boom');
        })).rejects.toThrow('boom');
        expect(await rowsWithIds([id])).toEqual([]);
    });

    it('rolls back every row when a statement fails mid-transaction (PK violation)', async () => {
        const [a, b] = [newId(), newId()];
        let caught;
        try {
            await withTransaction(async (tx) => {
                await insertRow(tx, a);
                await insertRow(tx, b);
                await insertRow(tx, a);
            });
        } catch (err) {
            caught = err;
        }
        expect(isUniqueViolation(caught)).toBe(true);
        expect(await rowsWithIds([a, b])).toEqual([]);
    });

    it('never runs queued statements after a failure, even if the callback swallows it', async () => {
        const [a, b] = [newId(), newId()];
        await expect(withTransaction(async (tx) => {
            await insertRow(tx, a);
            await insertRow(tx, a).catch(() => {});
            await insertRow(tx, b).catch(() => {});
            return 'swallowed';
        })).rejects.toThrow(/PRIMARY KEY/);
        // With XACT_ABORT the server already rolled back: `b` would have been autocommitted.
        expect(await rowsWithIds([a, b])).toEqual([]);
    });

    it('accepts Promise.all inside the transaction (FIFO on one connection)', async () => {
        const ids = Array.from({ length: 20 }, newId);
        const counts = await withTransaction(tx => Promise.all(ids.map(id => insertRow(tx, id))));
        expect(counts).toEqual(ids.map(() => 1));
        expect((await rowsWithIds(ids)).sort()).toEqual([...ids].sort());
    });

    it('returns the connection clean: no transaction, XACT_ABORT off, READ COMMITTED, default lock timeout', async () => {
        let spidInTx;
        await expect(withTransaction(async (tx) => {
            const [state] = await tx.read(SESSION_STATE);
            spidInTx = state.spid;
            expect(state).toEqual(expect.objectContaining({ trancount: 1, xact_abort: 16384, lock_timeout: 1500, isolation: 4 }));
            await tx.write('SELECT 1/0');
        }, { isolationLevel: 'SERIALIZABLE', lockTimeoutMs: 1500 })).rejects.toThrow(/divide by zero/i);

        // The pool hands back the most recently released connection first.
        const conn = await pool.acquire();
        try {
            const { rows: [state] } = await runRequest(conn, SESSION_STATE);
            expect(state.spid).toBe(spidInTx);
            expect(state).toEqual(expect.objectContaining({ trancount: 0, xact_abort: 0, lock_timeout: -1, isolation: 2 }));
        } finally {
            await pool.release(conn);
        }
    });

    it('turns a lock timeout into AppError DB_BUSY', async () => {
        const id = newId();
        await execWriteCommand(`INSERT INTO ${TABLE} (id, v) VALUES (@id, 0)`, [idParam(id)]);
        let release;
        const holding = new Promise(resolve => { release = resolve; });
        let locked;
        const locker = withTransaction(async (tx) => {
            await tx.write(`UPDATE ${TABLE} SET v = v + 1 WHERE id = @id`, [idParam(id)]);
            locked();
            await holding;
        });
        await new Promise(resolve => { locked = resolve; });

        const err = await withTransaction(
            tx => tx.write(`UPDATE ${TABLE} SET v = v + 10 WHERE id = @id`, [idParam(id)]),
            { lockTimeoutMs: 300 }
        ).catch(e => e);
        release();
        await locker;

        expect(err).toBeInstanceOf(AppError);
        expect(err).toEqual(expect.objectContaining({ code: 'DB_BUSY', status: 503 }));
        const [row] = await execReadCommand(`SELECT v FROM ${TABLE} WHERE id = @id`, [idParam(id)]);
        expect(row.v).toBe(1);
    });

    it('retries the deadlock victim and both transactions end up applied', async () => {
        const [a, b] = [newId(), newId()];
        await execWriteCommand(`INSERT INTO ${TABLE} (id, v) VALUES (@a, 0), (@b, 0)`, [
            { name: 'a', type: TYPES.Int, value: a }, { name: 'b', type: TYPES.Int, value: b },
        ]);
        const attempts = { first: 0, second: 0 };
        let arrived = 0;
        let openBarrier;
        const barrier = new Promise(resolve => { openBarrier = resolve; });
        const reachBarrier = async () => {
            arrived += 1;
            if (arrived === 2) openBarrier();
            await barrier;
        };
        const bump = (tx, id) => tx.write(`UPDATE ${TABLE} SET v = v + 1 WHERE id = @id`, [idParam(id)]);

        const first = withTransaction(async (tx) => {
            attempts.first += 1;
            await bump(tx, a);
            if (attempts.first === 1) await reachBarrier();
            await bump(tx, b);
        }, { lockTimeoutMs: 30000 });
        const second = withTransaction(async (tx) => {
            attempts.second += 1;
            await bump(tx, b);
            if (attempts.second === 1) await reachBarrier();
            await bump(tx, a);
        }, { lockTimeoutMs: 30000 });

        await Promise.all([first, second]);
        expect(attempts.first + attempts.second).toBe(3);
        const rows = await execReadCommand(`SELECT v FROM ${TABLE} WHERE id IN (@a, @b)`, [
            { name: 'a', type: TYPES.Int, value: a }, { name: 'b', type: TYPES.Int, value: b },
        ]);
        expect(rows.map(r => r.v)).toEqual([2, 2]);
    });

    it('gives up after `retries` deadlocks with DB_BUSY', async () => {
        const deadlock = Object.assign(new Error('Transaction was deadlocked'), { number: 1205 });
        let calls = 0;
        const err = await withTransaction(async () => { calls += 1; throw deadlock; }, { retries: 1 }).catch(e => e);
        expect(calls).toBe(2);
        expect(err.code).toBe('DB_BUSY');
        expect(isDeadlock(err)).toBe(true);
    });

    it('does not leak pool connections after 50 failed transactions', async () => {
        const id = newId();
        await execWriteCommand(`INSERT INTO ${TABLE} (id, v) VALUES (@id, 0)`, [idParam(id)]);
        const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => withTransaction(async (tx) => {
            if (i % 2 === 0) throw new Error('js failure');
            await insertRow(tx, id);
        })));
        expect(results.every(r => r.status === 'rejected')).toBe(true);

        const stats = pool.stats();
        expect(stats.waiting).toBe(0);
        expect(stats.active).toBeLessThanOrEqual(stats.max);
        expect(stats.active - stats.idle).toBe(0);
        await expect(execReadCommand('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
    });
});
