jest.mock('../../helpers/execQuery', () => ({ execReadCommand: jest.fn(), execWriteCommand: jest.fn() }));
jest.mock('../../helpers/transaction', () => ({
    useTransaction: jest.fn(),
    isUniqueViolation: jest.fn(),
    isFkViolation: jest.fn(),
    violatedConstraint: jest.fn(),
}));

const { execReadCommand } = require('../../helpers/execQuery');
const githubModel = require('../../models/github.model');

const GID = '11111111-1111-4111-8111-111111111111';
const OPENED = new Date('2026-10-01T10:00:00Z');
const MERGED = new Date('2026-10-02T10:00:00Z');

beforeEach(() => {
    execReadCommand.mockReset();
});

describe('getTaskLinksByGroup', () => {
    test('returns the base branch of each latest PR', async () => {
        execReadCommand.mockResolvedValue([
            { tid: 'T1', branch_name: 'tm/login-1', number: 4, title: 'Login', state: 'merged', is_draft: false,
                base_branch: 'develop', opened_at: OPENED, merged_at: MERGED },
            { tid: 'T2', branch_name: 'tm/nopr-2', number: null, title: null, state: null, is_draft: null,
                base_branch: null, opened_at: null, merged_at: null },
        ]);

        const links = await githubModel.getTaskLinksByGroup(GID);

        const [query, params] = execReadCommand.mock.calls[0];
        expect(query).toMatch(/SELECT TOP 1 [^)]*p\.base_branch/);
        expect(query).toMatch(/pr\.base_branch/);
        expect(params).toEqual([expect.objectContaining({ name: 'gid', value: GID })]);
        expect(links).toEqual([
            {
                tid: 'T1',
                branchName: 'tm/login-1',
                pr: { number: 4, title: 'Login', state: 'merged', isDraft: false, baseBranch: 'develop', openedAt: OPENED, mergedAt: MERGED },
            },
            { tid: 'T2', branchName: 'tm/nopr-2', pr: null },
        ]);
    });
});
