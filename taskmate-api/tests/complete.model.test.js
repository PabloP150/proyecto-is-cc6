jest.mock('../helpers/execQuery');

const { execReadCommand } = require('../helpers/execQuery');
const CompleteModel = require('../models/complete.model');
const TasksModel = require('../models/tasks.model');

const GID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALL_CLOCK = "CONVERT(VARCHAR(16), datetime, 120)";

describe('complete.model.getCompletados', () => {
    beforeEach(() => {
        execReadCommand.mockResolvedValue([]);
    });

    test('selects the date as the wall-clock string GET /api/tasks sends, not the raw column', async () => {
        const row = { tid: 't1', gid: GID, name: 'Tests unitarios', description: '', percentage: 100, datetime: '2026-10-21T00:00' };
        execReadCommand.mockResolvedValue([row]);

        await expect(CompleteModel.getCompletados(GID)).resolves.toEqual([row]);

        const [query, params] = execReadCommand.mock.calls[0];
        expect(query).toContain(`REPLACE(${WALL_CLOCK}, ' ', 'T') AS datetime`);
        expect(query).not.toMatch(/,\s*datetime\s+FROM/);
        expect(params).toEqual([expect.objectContaining({ name: 'gid', value: GID })]);
    });

    test('uses the same conversion as the active tasks query', async () => {
        await TasksModel.getTasksByGroupId(GID);
        await CompleteModel.getCompletados(GID);

        const [tasksQuery, completeQuery] = execReadCommand.mock.calls.map(([query]) => query);
        expect(tasksQuery).toContain(WALL_CLOCK);
        expect(completeQuery).toContain(WALL_CLOCK);
    });
});
