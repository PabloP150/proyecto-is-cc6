jest.mock('../helpers/execQuery');

const { execReadCommand } = require('../helpers/execQuery');
const DeleteModel = require('../models/delete.model');
const TasksModel = require('../models/tasks.model');

const GID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALL_CLOCK = 'CONVERT(VARCHAR(16), datetime, 120)';

describe('delete.model.getEliminados', () => {
    beforeEach(() => {
        execReadCommand.mockReset();
        execReadCommand.mockResolvedValue([]);
    });

    test('selects the date as the wall-clock string GET /api/tasks sends, not the raw column', async () => {
        const row = { tid: 't1', gid: GID, name: 'Tests unitarios', description: '', datetime: '2026-10-21T00:00', percentage: 0 };
        execReadCommand.mockResolvedValue([row]);

        await expect(DeleteModel.getEliminados(GID)).resolves.toEqual([row]);

        const [query, params] = execReadCommand.mock.calls[0];
        expect(query).toContain(`REPLACE(${WALL_CLOCK}, ' ', 'T') AS datetime`);
        expect(query).not.toMatch(/description,\s*datetime,/);
        expect(params).toEqual([expect.objectContaining({ name: 'gid', value: GID })]);
    });

    test('uses the same conversion as the active tasks query', async () => {
        await TasksModel.getTasksByGroupId(GID);
        await DeleteModel.getEliminados(GID);

        const [tasksQuery, deletedQuery] = execReadCommand.mock.calls.map(([query]) => query);
        expect(tasksQuery).toContain(WALL_CLOCK);
        expect(deletedQuery).toContain(WALL_CLOCK);
    });
});
