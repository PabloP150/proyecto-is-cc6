jest.mock('../../helpers/execQuery', () => ({ execReadCommand: jest.fn(), execWriteCommand: jest.fn() }));
jest.mock('../../helpers/transaction', () => ({
    useTransaction: jest.fn(),
    isUniqueViolation: jest.fn(),
    isFkViolation: jest.fn(),
    violatedConstraint: jest.fn(),
}));

const { execReadCommand } = require('../../helpers/execQuery');
const { useTransaction } = require('../../helpers/transaction');
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

describe('pending deploy requests of other repositories (Phase 4)', () => {
    const NEW_REPO = 501;
    let tx;
    beforeEach(() => {
        tx = { read: jest.fn(), write: jest.fn().mockResolvedValue(1) };
        useTransaction.mockImplementation((options, fn) => fn(tx));
    });
    const statements = () => tx.write.mock.calls.map(([sql, params]) => ({ sql: sql.replace(/\s+/g, ' ').trim(), params }));
    const param = (params, name) => params.find((p) => p.name === name).value;
    const deleteRequests = () => statements().find((s) => /DELETE FROM dbo\.DeployRequests/.test(s.sql));

    test('switching repositories deletes the pending requests of any other repository, in the same transaction', async () => {
        tx.read.mockResolvedValue([{ repo_id: '500' }]);
        await expect(githubModel.linkGroupRepository({ gid: GID, repoId: NEW_REPO, connectedBy: GID })).resolves.toEqual({ previousRepoId: 500 });
        const del = deleteRequests();
        expect(del.sql).toMatch(/WHERE gid = @gid AND status = 'pending' AND \(@repoId IS NULL OR repo_id <> @repoId\)/);
        expect(param(del.params, 'gid')).toBe(GID);
        expect(param(del.params, 'repoId')).toBe(NEW_REPO);
        // Locked link row first, then the update, then the cleanups.
        expect(tx.read.mock.calls[0][0]).toMatch(/GroupRepositories WITH \(UPDLOCK, HOLDLOCK\)/);
        expect(statements()[0].sql).toMatch(/^UPDATE dbo\.GroupRepositories/);
    });

    test('unlinking deletes every pending request of the group, after locking the link row', async () => {
        tx.read.mockResolvedValue([{ repo_id: '500' }]);
        await expect(githubModel.unlinkGroupRepository(GID)).resolves.toBe(true);
        expect(tx.read.mock.calls[0][0]).toMatch(/GroupRepositories WITH \(UPDLOCK, HOLDLOCK\)/);
        const del = deleteRequests();
        expect(param(del.params, 'repoId')).toBeNull();
        const order = statements().map((s) => s.sql.match(/^DELETE (?:\w+ )?FROM dbo\.(\w+)/)[1]);
        expect(order).toEqual(['TaskBranches', 'DeployRequests', 'GroupRepositories']);
    });
});
