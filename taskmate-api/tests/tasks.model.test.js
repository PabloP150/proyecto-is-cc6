// Unit tests for the tasks.model reads with the query helpers mocked (no database needed).
jest.mock('../helpers/execQuery', () => ({ execReadCommand: jest.fn(), execWriteCommand: jest.fn() }));

const { TYPES } = require('tedious');
const { execReadCommand } = require('../helpers/execQuery');
const TasksModel = require('../models/tasks.model');

const GID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('tasks.model reads: creation time (migration 008)', () => {
    beforeEach(() => {
        execReadCommand.mockReset();
        execReadCommand.mockResolvedValue([]);
    });

    test('getTasksByGroupId lists the group oldest first, tid breaking ties', async () => {
        const rows = [{ tid: TID, createdAt: new Date('2026-09-01T10:00:00Z') }];
        execReadCommand.mockResolvedValue(rows);

        await expect(TasksModel.getTasksByGroupId(GID)).resolves.toBe(rows);

        const [query, params] = execReadCommand.mock.calls[0];
        expect(query).toMatch(/FROM dbo\.Tasks WHERE gid=@gid ORDER BY created_at, created_seq$/);
        expect(params).toEqual([{ name: 'gid', type: TYPES.UniqueIdentifier, value: GID }]);
    });

    test('getTasksByGroupId and getTask return the column as createdAt', async () => {
        await TasksModel.getTasksByGroupId(GID);
        await TasksModel.getTask(TID);

        const [listQuery, oneQuery] = execReadCommand.mock.calls.map(([query]) => query);
        for (const query of [listQuery, oneQuery]) {
            expect(query).toMatch(/\bcreated_at AS createdAt\b/);
            expect(query).toContain("CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr");
        }
        expect(oneQuery).toMatch(/WHERE tid=@tid$/);
        expect(execReadCommand.mock.calls[1][1]).toEqual([{ name: 'tid', type: TYPES.UniqueIdentifier, value: TID }]);
    });
});

describe('tasks.model completeTask / trashTask: the creation time moves with the task (migration 008)', () => {
    // A transaction stub: the first read finds the task, the branch reads find none.
    const fakeTx = () => ({
        read: jest.fn()
            .mockResolvedValueOnce([{ tid: TID, gid: GID, name: 'T', description: '', list: 'L', datetimeStr: '2026-09-11 10:00', percentage: 0 }])
            .mockResolvedValue([]),
        write: jest.fn().mockResolvedValue(1),
    });

    test.each([
        ['completeTask', 'Complete', 'completed'],
        ['trashTask', 'DeleteTask', 'deleted'],
    ])('%s copies created_at into %s, both refreshing an old row and inserting a new one', async (fn, table, status) => {
        const tx = fakeTx();

        await expect(TasksModel[fn](TID, { tx })).resolves.toEqual(expect.objectContaining({ status }));

        const [archive] = tx.write.mock.calls[0];
        expect(archive).toContain(`FROM dbo.${table}`);
        expect(archive).toMatch(/UPDATE \w SET [^;]*\bcreated_at = t\.created_at, created_seq = t\.created_seq\b[^;]*;/);
        expect(archive).toMatch(new RegExp(`INSERT INTO dbo\\.${table} \\([^)]*, created_at, created_seq\\)\\s+SELECT [^;]*, t\\.created_at, t\\.created_seq\\s+FROM dbo\\.Tasks t`));
    });
});
