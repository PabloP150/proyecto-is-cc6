// Unit tests for nodes.model.getNodeLayout with the query helpers mocked (no database needed).
jest.mock('../helpers/execQuery', () => ({ execReadCommand: jest.fn(), execWriteCommand: jest.fn() }));

const { TYPES } = require('tedious');
const { execReadCommand } = require('../helpers/execQuery');
const nodesModel = require('../models/nodes.model');

const GID = '11111111-1111-4111-8111-111111111111';

describe('nodesModel.getNodeLayout', () => {
    test('runs in the caller transaction with a range lock on the group nodes', async () => {
        const rows = [{ y_pos: 397, descriptionLength: 600 }];
        const tx = { read: jest.fn().mockResolvedValue(rows) };
        await expect(nodesModel.getNodeLayout(GID, { tx })).resolves.toBe(rows);
        expect(execReadCommand).not.toHaveBeenCalled();
        const [sql, params] = tx.read.mock.calls[0];
        expect(sql).toMatch(/SELECT y_pos, LEN\(description\) AS descriptionLength\s+FROM dbo\.Nodes WITH \(UPDLOCK, HOLDLOCK\) WHERE gid=@gid/);
        expect(params).toEqual([{ name: 'gid', type: TYPES.UniqueIdentifier, value: GID }]);
    });

    test('without a transaction it uses a plain read', async () => {
        execReadCommand.mockResolvedValue([{ y_pos: -12.5, descriptionLength: 0 }]);
        await expect(nodesModel.getNodeLayout(GID)).resolves.toEqual([{ y_pos: -12.5, descriptionLength: 0 }]);
        expect(execReadCommand).toHaveBeenCalledWith(expect.stringContaining('LEN(description)'), expect.any(Array));
    });

    test('a group without nodes → no rows', async () => {
        const tx = { read: jest.fn().mockResolvedValue([]) };
        await expect(nodesModel.getNodeLayout(GID, { tx })).resolves.toEqual([]);
    });
});
