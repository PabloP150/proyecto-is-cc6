const { createPrReview } = require('../../services/aiServer/prReview');

const SHA = 'a'.repeat(40);
const repo = { owner: 'o', name: 'r', repoId: 7, installationId: 1, aiAnalysisEnabled: true };
const pr = { number: 3, headSha: SHA, baseBranch: 'main', headBranch: 'tm/t', title: 'T', body: 'B' };
const result = { verdict: 'warn', body: 'review', comments: [{ path: 'a.js', line: 2, body: 'x' }] };

const setup = ({ claim = 11, post } = {}) => {
    const aiReviewModel = { claim: jest.fn(async () => claim), finish: jest.fn(async () => {}) };
    const repoService = {
        repoAuth: () => ({}), repoPath: () => '/repos/o/r', scope: () => ({}),
        getComparePatches: jest.fn(async () => ({ files: [{ path: 'a.js', patch: '@@' }] })),
        getConnectedRepo: jest.fn(async () => repo),
    };
    const githubApp = { request: post || jest.fn(async () => ({ data: { html_url: 'https://gh/r/1' } })) };
    const aiServer = { enabled: () => true, runCommand: jest.fn(async () => ({ result })) };
    const githubModel = { findTaskByBranch: jest.fn(async () => ({ tid: 't', gid: 'g' })) };
    const svc = createPrReview({ aiReviewModel, repoService, githubApp, aiServer, githubModel });
    return { aiReviewModel, repoService, githubApp, aiServer, githubModel, svc };
};

describe('prReview.reviewPullRequest', () => {
    test('reviews, posts a COMMENT review and stores it', async () => {
        const s = setup();
        const out = await s.svc.reviewPullRequest({ repo, tid: 't', pr });
        expect(s.aiServer.runCommand).toHaveBeenCalledWith('review-pr', expect.objectContaining({ base: 'main', head: 'tm/t', title: 'T' }));
        const [, method, path, opts] = s.githubApp.request.mock.calls[0];
        expect([method, path]).toEqual(['POST', '/repos/o/r/pulls/3/reviews']);
        expect(opts.body).toMatchObject({ commit_id: SHA, event: 'COMMENT', comments: [{ path: 'a.js', line: 2, side: 'RIGHT' }] });
        expect(s.aiReviewModel.finish).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'done', posted: 'posted', reviewUrl: 'https://gh/r/1' }));
        expect(out.posted).toBe('posted');
    });

    test('same commit already claimed: nothing runs', async () => {
        const s = setup({ claim: null });
        expect(await s.svc.reviewPullRequest({ repo, tid: 't', pr })).toBeNull();
        expect(s.aiServer.runCommand).not.toHaveBeenCalled();
    });

    test('422 on inline comments retries with the body only', async () => {
        const post = jest.fn()
            .mockRejectedValueOnce(Object.assign(new Error('x'), { githubStatus: 422, code: 'GITHUB_ERROR' }))
            .mockResolvedValueOnce({ data: { html_url: 'u' } });
        const s = setup({ post });
        await s.svc.reviewPullRequest({ repo, tid: 't', pr });
        expect(post.mock.calls[1][3].body.comments).toEqual([]);
        expect(s.aiReviewModel.finish).toHaveBeenCalledWith(11, expect.objectContaining({ posted: 'posted' }));
    });

    test('App without pull_requests: write -> stored as no_permission', async () => {
        const s = setup({ post: jest.fn(async () => { throw Object.assign(new Error('p'), { code: 'APP_PERMISSIONS_MISSING' }); }) });
        await s.svc.reviewPullRequest({ repo, tid: 't', pr });
        expect(s.aiReviewModel.finish).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'done', posted: 'no_permission' }));
    });

    test('AI server failure is stored and rethrown', async () => {
        const s = setup();
        s.aiServer.runCommand.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'AI_SERVER_UNAVAILABLE' }));
        await expect(s.svc.reviewPullRequest({ repo, tid: 't', pr })).rejects.toMatchObject({ code: 'AI_SERVER_UNAVAILABLE' });
        expect(s.aiReviewModel.finish).toHaveBeenCalledWith(11, { status: 'failed', errorCode: 'AI_SERVER_UNAVAILABLE' });
    });
});

describe('prReview.onPullRequestEvent', () => {
    const ghPr = (over = {}) => ({ number: 3, state: 'open', draft: false, title: 'T', body: null,
        head: { ref: 'tm/t', sha: SHA }, base: { ref: 'main' }, ...over });

    test('open task PR with consent -> review queued', async () => {
        const s = setup();
        expect(await s.svc.onPullRequestEvent('opened', ghPr(), { id: 7 })).toBe(true);
    });

    test.each([
        ['closed action', 'closed', {}, {}],
        ['draft', 'opened', { draft: true }, {}],
        ['closed state', 'synchronize', { state: 'closed' }, {}],
    ])('%s -> ignored', async (_n, action, over) => {
        const s = setup();
        expect(await s.svc.onPullRequestEvent(action, ghPr(over), { id: 7 })).toBe(false);
    });

    test('not a task branch, or consent off -> ignored', async () => {
        const s = setup();
        s.githubModel.findTaskByBranch.mockResolvedValueOnce(null);
        expect(await s.svc.onPullRequestEvent('opened', ghPr(), { id: 7 })).toBe(false);
        s.repoService.getConnectedRepo.mockResolvedValueOnce({ ...repo, aiAnalysisEnabled: false });
        expect(await s.svc.onPullRequestEvent('opened', ghPr(), { id: 7 })).toBe(false);
    });
});
