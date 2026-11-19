const { createTaskAi } = require('../../services/aiServer/taskAi');

const repo = { owner: 'o', name: 'r', defaultBranch: 'main', aiAnalysisEnabled: true };
const files = [{ path: 'a.js', status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y' }];

const setup = ({ links, patches = files, ai = true } = {}) => {
    const githubModel = { getTaskLinksByGroup: jest.fn(async () => links) };
    const repoService = {
        getConnectedRepo: jest.fn(async () => ({ ...repo, aiAnalysisEnabled: ai })),
        getComparePatches: jest.fn(async () => ({ files: patches, aheadBy: 1 })),
    };
    repoService.getPullRequest = jest.fn(async () => ({ head: { sha: 'b'.repeat(40), ref: 'tm/t' }, base: { ref: 'main' }, title: 'T', body: '' }));
    const aiServer = { runCommand: jest.fn(async () => ({ run_id: 'run', result: { verdict: 'warn', findings: [] } })) };
    const aiReviewModel = { getLatest: jest.fn(async () => ({ id: 1, verdict: 'warn' })) };
    const prReview = { reviewPullRequest: jest.fn(async () => ({})) };
    return { githubModel, repoService, aiServer, aiReviewModel, prReview,
        taskAi: createTaskAi({ githubModel, repoService, aiServer, aiReviewModel, prReview }) };
};

describe('taskAi.auditTask', () => {
    test('audits the task branch against its PR base', async () => {
        const s = setup({ links: [{ tid: 'ABC', branchName: 'tm/x-abc', pr: { baseBranch: 'develop' } }] });
        const out = await s.taskAi.auditTask({ gid: 'g', tid: 'abc' });
        expect(s.repoService.getComparePatches).toHaveBeenCalledWith(expect.objectContaining({ owner: 'o' }), 'develop', 'tm/x-abc');
        expect(s.aiServer.runCommand).toHaveBeenCalledWith('audit', { files, base: 'develop', head: 'tm/x-abc', repo: 'o/r' });
        expect(out).toEqual({ runId: 'run', verdict: 'warn', findings: [] });
    });

    test('falls back to the default branch without a PR', async () => {
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t', pr: null }] });
        await s.taskAi.auditTask({ gid: 'g', tid: 't' });
        expect(s.repoService.getComparePatches).toHaveBeenCalledWith(expect.objectContaining({ owner: 'o' }), 'main', 'tm/t');
    });

    test('task without branch / branch without changes', async () => {
        await expect(setup({ links: [] }).taskAi.auditTask({ gid: 'g', tid: 't' }))
            .rejects.toMatchObject({ code: 'TASK_NO_BRANCH', status: 409 });
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t' }], patches: [] });
        await expect(s.taskAi.auditTask({ gid: 'g', tid: 't' })).rejects.toMatchObject({ code: 'NOTHING_TO_REVIEW' });
        expect(s.aiServer.runCommand).not.toHaveBeenCalled();
    });

    test('refuses when the admin has not enabled AI analysis', async () => {
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t' }], ai: false });
        await expect(s.taskAi.auditTask({ gid: 'g', tid: 't' })).rejects.toMatchObject({ code: 'AI_ANALYSIS_DISABLED', status: 409 });
        expect(s.repoService.getComparePatches).not.toHaveBeenCalled();
        expect(s.aiServer.runCommand).not.toHaveBeenCalled();
    });

    test('generateTestsForTask sends the branch patches', async () => {
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t' }] });
        s.aiServer.runCommand.mockResolvedValueOnce({ run_id: 'g', result: { proposals: [], skipped: [] } });
        const out = await s.taskAi.generateTestsForTask({ gid: 'g', tid: 't' });
        expect(s.aiServer.runCommand).toHaveBeenCalledWith('generate-tests', { files, base: 'main', head: 'tm/t' });
        expect(out).toEqual({ runId: 'g', proposals: [], skipped: [] });
    });

    test('reviewTaskPr runs on the open PR head and returns the stored review', async () => {
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t', pr: { number: 4, state: 'open' } }] });
        expect(await s.taskAi.reviewTaskPr({ gid: 'g', tid: 't' })).toEqual({ id: 1, verdict: 'warn' });
        expect(s.prReview.reviewPullRequest).toHaveBeenCalledWith(expect.objectContaining({
            tid: 't', pr: expect.objectContaining({ number: 4, headSha: 'b'.repeat(40), baseBranch: 'main' }) }));
    });

    test('reviewTaskPr needs an open PR and AI consent', async () => {
        await expect(setup({ links: [{ tid: 't', branchName: 'tm/t', pr: null }] }).taskAi.reviewTaskPr({ gid: 'g', tid: 't' }))
            .rejects.toMatchObject({ code: 'NO_OPEN_PR' });
        const s = setup({ links: [{ tid: 't', branchName: 'tm/t', pr: { number: 4, state: 'open' } }], ai: false });
        await expect(s.taskAi.reviewTaskPr({ gid: 'g', tid: 't' })).rejects.toMatchObject({ code: 'AI_ANALYSIS_DISABLED' });
    });
});
