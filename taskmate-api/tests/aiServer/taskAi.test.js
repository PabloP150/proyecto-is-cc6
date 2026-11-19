const { createTaskAi } = require('../../services/aiServer/taskAi');

const repo = { owner: 'o', name: 'r', defaultBranch: 'main' };
const files = [{ path: 'a.js', status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y' }];

const setup = ({ links, patches = files } = {}) => {
    const githubModel = { getTaskLinksByGroup: jest.fn(async () => links) };
    const repoService = {
        getConnectedRepo: jest.fn(async () => repo),
        getComparePatches: jest.fn(async () => ({ files: patches, aheadBy: 1 })),
    };
    const aiServer = { runCommand: jest.fn(async () => ({ run_id: 'run', result: { verdict: 'warn', findings: [] } })) };
    return { githubModel, repoService, aiServer, taskAi: createTaskAi({ githubModel, repoService, aiServer }) };
};

describe('taskAi.auditTask', () => {
    test('audits the task branch against its PR base', async () => {
        const s = setup({ links: [{ tid: 'ABC', branchName: 'tm/x-abc', pr: { baseBranch: 'develop' } }] });
        const out = await s.taskAi.auditTask({ gid: 'g', tid: 'abc' });
        expect(s.repoService.getComparePatches).toHaveBeenCalledWith(repo, 'develop', 'tm/x-abc');
        expect(s.aiServer.runCommand).toHaveBeenCalledWith('audit', { files, base: 'develop', head: 'tm/x-abc', repo: 'o/r' });
        expect(out).toEqual({ runId: 'run', verdict: 'warn', findings: [] });
    });

    test('falls back to the default branch without a PR', async () => {
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t', pr: null }] });
        await s.taskAi.auditTask({ gid: 'g', tid: 't' });
        expect(s.repoService.getComparePatches).toHaveBeenCalledWith(repo, 'main', 'tm/t');
    });

    test('task without branch / branch without changes', async () => {
        await expect(setup({ links: [] }).taskAi.auditTask({ gid: 'g', tid: 't' }))
            .rejects.toMatchObject({ code: 'TASK_NO_BRANCH', status: 409 });
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t' }], patches: [] });
        await expect(s.taskAi.auditTask({ gid: 'g', tid: 't' })).rejects.toMatchObject({ code: 'NOTHING_TO_REVIEW' });
        expect(s.aiServer.runCommand).not.toHaveBeenCalled();
    });
});
