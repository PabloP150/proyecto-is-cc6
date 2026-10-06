const { v4: uuidv4 } = require('uuid');
const github = require('../../models/github.model');
const { execReadCommand, execWriteCommand } = require('../../helpers/execQuery');
const { isCheckViolation } = require('../../helpers/transaction');
const h = require('./helpers');

const SHA = 'c'.repeat(40);
const t = (iso) => new Date(iso);

async function setup({ link = true } = {}) {
    const user = await h.createUser('gh');
    const gid = await h.createGroup(user.uid);
    const installationId = h.githubId();
    const repoId = h.githubId();
    await github.upsertInstallation({ installationId, accountLogin: 'octo-org', accountType: 'Organization' });
    await github.upsertRepository({ repoId, installationId, name: 'taskmate', defaultBranch: 'main', isPrivate: false });
    if (link) await github.linkGroupRepository({ gid, repoId, connectedBy: user.uid });
    return { user, gid, installationId, repoId };
}

const prBase = (repoId, over = {}) => ({
    prId: h.githubId(), repoId, number: Math.floor(Math.random() * 1e6) + 1, headBranch: 'tm/x', baseBranch: 'main',
    title: 'PR', isDraft: false, openedAt: t('2026-09-01T10:00:00Z'), closedAt: null, mergedAt: null,
    ghUpdatedAt: t('2026-09-01T10:00:00Z'), ...over,
});

describe('installations and repositories', () => {
    it('upserts, suspends and links a repository to a group', async () => {
        const { user, gid, installationId, repoId } = await setup({ link: false });
        await expect(github.upsertInstallation({ installationId, accountLogin: 'octo-org', accountType: 'Organization' }))
            .resolves.toEqual({ created: false });
        await expect(github.linkGroupRepository({ gid, repoId, connectedBy: user.uid })).resolves.toEqual({ previousRepoId: null });
        expect(await github.setInstallationSuspended(installationId, t('2026-09-02T00:00:00Z'))).toBe(true);

        const repo = await github.getGroupRepository(gid);
        expect(repo).toEqual(expect.objectContaining({
            repoId, owner: 'octo-org', name: 'taskmate', fullName: 'octo-org/taskmate', defaultBranch: 'main',
            isPrivate: false, installationId, connectedByUsername: user.username, aiAnalysisEnabled: false,
        }));
        expect(repo.suspendedAt.toISOString()).toBe('2026-09-02T00:00:00.000Z');

        const other = h.githubId();
        await github.upsertRepository({ repoId: other, installationId, name: 'other', defaultBranch: 'dev', isPrivate: true });
        await expect(github.linkGroupRepository({ gid, repoId: other, connectedBy: user.uid })).resolves.toEqual({ previousRepoId: repoId });
        expect(await github.unlinkGroupRepository(gid)).toBe(true);
        expect(await github.getGroupRepository(gid)).toBeNull();
    });

    it('deleting an installation cascades to repositories, links, branches and PRs', async () => {
        const { user, gid, installationId, repoId } = await setup();
        const tid = await h.createTask(gid);
        await github.insertTaskBranch({ tid, repoId, branchName: 'tm/a', baseSha: SHA, createdBy: user.uid });
        await github.applyPullRequest(prBase(repoId, { headBranch: 'tm/a' }));

        expect(await github.deleteInstallation(installationId)).toBe(true);
        const p = [{ name: 'repoId', type: require('tedious').TYPES.BigInt, value: repoId }];
        for (const table of ['dbo.GitHubRepositories', 'dbo.GroupRepositories', 'dbo.TaskBranches', 'dbo.PullRequests']) {
            expect(await h.count(`${table} WHERE repo_id = @repoId`, p)).toBe(0);
        }
        expect(await h.count('dbo.Tasks WHERE tid = @tid', [h.guid('tid', tid)])).toBe(1);
    });
});

describe('repository switch, unlink and AI opt-in', () => {
    it('switching repos drops the old branches and old-repo merges no longer find the task', async () => {
        const { user, gid, installationId, repoId } = await setup();
        const tid = await h.createTask(gid);
        await github.insertTaskBranch({ tid, repoId, branchName: 'tm/old', baseSha: SHA, createdBy: user.uid });
        expect(await github.setAiAnalysisEnabled(gid, true)).toBe(true);

        const newRepo = h.githubId();
        await github.upsertRepository({ repoId: newRepo, installationId, name: 'next', defaultBranch: 'main', isPrivate: true });
        await github.linkGroupRepository({ gid, repoId: newRepo, connectedBy: user.uid });

        expect(await github.getTaskBranch(tid)).toBeNull();
        expect(await github.findTaskByBranch(repoId, 'tm/old')).toBeNull();
        expect(await github.getTaskLinksByGroup(gid)).toEqual([]);
        expect((await github.getGroupRepository(gid)).aiAnalysisEnabled).toBe(false);
        // A new branch for the same task is possible again.
        await github.insertTaskBranch({ tid, repoId: newRepo, branchName: 'tm/old', baseSha: SHA, createdBy: user.uid });
        expect(h.sameId((await github.findTaskByBranch(newRepo, 'tm/old')).tid, tid)).toBe(true);
    });

    it('re-linking the same repo keeps branches and the opt-in; unlinking drops every branch', async () => {
        const { user, gid, repoId } = await setup();
        const tid = await h.createTask(gid);
        await github.insertTaskBranch({ tid, repoId, branchName: 'tm/keep', baseSha: SHA, createdBy: user.uid });
        await github.setAiAnalysisEnabled(gid, true);
        await github.linkGroupRepository({ gid, repoId, connectedBy: user.uid });
        expect(await github.getTaskBranch(tid)).not.toBeNull();
        expect((await github.getGroupRepository(gid)).aiAnalysisEnabled).toBe(true);

        expect(await github.unlinkGroupRepository(gid)).toBe(true);
        expect(await github.getTaskBranch(tid)).toBeNull();
        expect(await github.findTaskByBranch(repoId, 'tm/keep')).toBeNull();
        expect(await github.unlinkGroupRepository(gid)).toBe(false);
        expect(await github.setAiAnalysisEnabled(gid, true)).toBe(false);
    });

    it('branch rows left from an older link are ignored by findTaskByBranch and getTaskLinksByGroup', async () => {
        const { user, gid, installationId } = await setup();
        const tid = await h.createTask(gid);
        const otherRepo = h.githubId();
        await github.upsertRepository({ repoId: otherRepo, installationId, name: 'other', defaultBranch: 'main', isPrivate: false });
        await github.insertTaskBranch({ tid, repoId: otherRepo, branchName: 'tm/stray', baseSha: SHA, createdBy: user.uid });
        expect(await github.findTaskByBranch(otherRepo, 'tm/stray')).toBeNull();
        expect(await github.getTaskLinksByGroup(gid)).toEqual([]);
    });
});

describe('task branches', () => {
    it('branch names are unique per repository and case-sensitive', async () => {
        const { user, gid, repoId } = await setup();
        const [t1, t2, t3] = [await h.createTask(gid), await h.createTask(gid), await h.createTask(gid)];
        await github.insertTaskBranch({ tid: t1, repoId, branchName: 'tm/feature', baseSha: SHA, createdBy: user.uid });
        await expect(github.insertTaskBranch({ tid: t2, repoId, branchName: 'tm/Feature', baseSha: SHA, createdBy: user.uid }))
            .resolves.toEqual(expect.objectContaining({ branchName: 'tm/Feature' }));
        await expect(github.insertTaskBranch({ tid: t3, repoId, branchName: 'tm/feature', baseSha: SHA, createdBy: user.uid }))
            .rejects.toEqual(expect.objectContaining({ code: 'BRANCH_CONFLICT', status: 409, details: { reason: 'branch_taken' } }));
        await expect(github.insertTaskBranch({ tid: t1, repoId, branchName: 'tm/other', baseSha: SHA, createdBy: user.uid }))
            .rejects.toEqual(expect.objectContaining({ code: 'BRANCH_CONFLICT', details: { reason: 'task_has_branch' } }));
        await expect(github.insertTaskBranch({ tid: uuidv4(), repoId, branchName: 'tm/ghost', baseSha: SHA, createdBy: user.uid }))
            .rejects.toEqual(expect.objectContaining({ code: 'TASK_NOT_FOUND', status: 404 }));

        const found = await github.findTaskByBranch(repoId, 'tm/Feature');
        expect(h.sameId(found.tid, t2)).toBe(true);
        expect(h.sameId(found.gid, gid)).toBe(true);
        expect(await github.findTaskByBranch(repoId, 'TM/FEATURE')).toBeNull();
        expect(await github.getTaskBranch(t1)).toEqual(expect.objectContaining({ repoId, branchName: 'tm/feature', baseSha: SHA }));
    });

    it('getTaskLinksByGroup returns the latest PR of each branch', async () => {
        const { user, gid, repoId } = await setup();
        const [withPr, without] = [await h.createTask(gid), await h.createTask(gid)];
        await github.insertTaskBranch({ tid: withPr, repoId, branchName: 'tm/pr', baseSha: SHA, createdBy: user.uid });
        await github.insertTaskBranch({ tid: without, repoId, branchName: 'tm/nopr', baseSha: SHA, createdBy: user.uid });
        await github.applyPullRequest(prBase(repoId, { headBranch: 'tm/pr', number: 1, title: 'old', openedAt: t('2026-09-01T00:00:00Z'),
            closedAt: t('2026-09-02T00:00:00Z'), ghUpdatedAt: t('2026-09-02T00:00:00Z') }));
        await github.applyPullRequest(prBase(repoId, { headBranch: 'tm/pr', number: 2, title: 'new', isDraft: true,
            openedAt: t('2026-09-03T00:00:00Z'), ghUpdatedAt: t('2026-09-03T00:00:00Z') }));

        const links = await github.getTaskLinksByGroup(gid);
        const byTid = Object.fromEntries(links.map(l => [String(l.tid).toLowerCase(), l]));
        expect(byTid[without].pr).toBeNull();
        expect(byTid[withPr]).toEqual(expect.objectContaining({ branchName: 'tm/pr' }));
        expect(byTid[withPr].pr).toEqual(expect.objectContaining({ number: 2, title: 'new', state: 'open', isDraft: true, mergedAt: null }));
    });
});

describe('pull requests', () => {
    let repoId;
    beforeAll(async () => { ({ repoId } = await setup()); });

    it('computes state and enforces merged => closed', async () => {
        const pr = prBase(repoId, { closedAt: t('2026-09-02T00:00:00Z'), ghUpdatedAt: t('2026-09-02T00:00:00Z') });
        await expect(github.applyPullRequest(pr)).resolves.toEqual({ state: 'closed', changed: true, becameMerged: false });
        const err = await execWriteCommand(
            'UPDATE dbo.PullRequests SET closed_at = NULL, merged_at = SYSDATETIMEOFFSET() WHERE pr_id = @id',
            [{ name: 'id', type: require('tedious').TYPES.BigInt, value: pr.prId }]
        ).catch(e => e);
        expect(isCheckViolation(err)).toBe(true);
    });

    it('a merge received before the "opened" event is never undone', async () => {
        const merged = prBase(repoId, { closedAt: t('2026-09-05T12:00:00Z'), mergedAt: t('2026-09-05T12:00:00Z'), ghUpdatedAt: t('2026-09-05T12:00:00Z') });
        await expect(github.applyPullRequest(merged)).resolves.toEqual({ state: 'merged', changed: true, becameMerged: true });
        const lateOpened = { ...merged, closedAt: null, mergedAt: null, ghUpdatedAt: t('2026-09-01T10:00:00Z') };
        await expect(github.applyPullRequest(lateOpened)).resolves.toEqual({ state: 'merged', changed: false, becameMerged: false });
        // Even a newer event without merge data keeps merged_at (and therefore closed_at).
        const edited = { ...merged, title: 'edited', mergedAt: null, closedAt: null, ghUpdatedAt: t('2026-09-06T00:00:00Z') };
        await expect(github.applyPullRequest(edited)).resolves.toEqual({ state: 'merged', changed: true, becameMerged: false });
        const [row] = await execReadCommand('SELECT title, state FROM dbo.PullRequests WHERE pr_id = @id',
            [{ name: 'id', type: require('tedious').TYPES.BigInt, value: merged.prId }]);
        expect(row).toEqual({ title: 'edited', state: 'merged' });
    });

    it('a stale "reopened" does not reopen; a newer one does; same-second ties never reopen', async () => {
        const pr = prBase(repoId, { ghUpdatedAt: t('2026-09-01T10:00:00Z') });
        await github.applyPullRequest(pr);
        const closed = { ...pr, closedAt: t('2026-09-02T00:00:00Z'), ghUpdatedAt: t('2026-09-02T00:00:00Z') };
        await expect(github.applyPullRequest(closed)).resolves.toEqual(expect.objectContaining({ state: 'closed', changed: true }));
        const staleReopen = { ...pr, closedAt: null, ghUpdatedAt: t('2026-09-01T23:59:59Z') };
        await expect(github.applyPullRequest(staleReopen)).resolves.toEqual({ state: 'closed', changed: false, becameMerged: false });
        const tieReopen = { ...pr, closedAt: null, ghUpdatedAt: t('2026-09-02T00:00:00.400Z') };
        await expect(github.applyPullRequest(tieReopen)).resolves.toEqual(expect.objectContaining({ state: 'closed' }));
        const reopen = { ...pr, closedAt: null, ghUpdatedAt: t('2026-09-03T00:00:00Z') };
        await expect(github.applyPullRequest(reopen)).resolves.toEqual({ state: 'open', changed: true, becameMerged: false });
        await expect(github.applyPullRequest(reopen)).resolves.toEqual({ state: 'open', changed: false, becameMerged: false });
    });
});

describe('webhook deliveries', () => {
    it('processed/ignored are duplicates, failed is reprocessed, purge removes old rows', async () => {
        const deliveryId = uuidv4();
        const delivery = { deliveryId, event: 'pull_request', action: 'closed', installationId: h.githubId() };
        await expect(github.beginDelivery(delivery)).resolves.toEqual({ duplicate: false, previousStatus: null });
        await expect(github.beginDelivery(delivery)).resolves.toEqual({ duplicate: true, previousStatus: 'processing' });

        expect(await github.failDelivery(deliveryId, 'x'.repeat(2000))).toBe(true);
        const [failed] = await execReadCommand('SELECT status, LEN(error) AS len FROM dbo.GitHubWebhookDeliveries WHERE delivery_id = @id', [h.guid('id', deliveryId)]);
        expect(failed).toEqual({ status: 'failed', len: 1000 });
        await expect(github.beginDelivery(delivery)).resolves.toEqual({ duplicate: false, previousStatus: 'failed' });

        expect(await github.finishDelivery(deliveryId, 'processed')).toBe(true);
        await expect(github.beginDelivery(delivery)).resolves.toEqual({ duplicate: true, previousStatus: 'processed' });
        await expect(github.finishDelivery(deliveryId, 'failed')).rejects.toThrow(TypeError);

        const ignoredId = uuidv4();
        await github.beginDelivery({ deliveryId: ignoredId, event: 'push' });
        await github.finishDelivery(ignoredId, 'ignored');
        await expect(github.beginDelivery({ deliveryId: ignoredId, event: 'push' })).resolves.toEqual({ duplicate: true, previousStatus: 'ignored' });

        await execWriteCommand(
            'UPDATE dbo.GitHubWebhookDeliveries SET received_at = DATEADD(DAY, -40, SYSDATETIMEOFFSET()) WHERE delivery_id = @id',
            [h.guid('id', ignoredId)]
        );
        expect(await github.purgeDeliveries(30)).toBeGreaterThanOrEqual(1);
        expect(await h.count('dbo.GitHubWebhookDeliveries WHERE delivery_id = @id', [h.guid('id', ignoredId)])).toBe(0);
        expect(await h.count('dbo.GitHubWebhookDeliveries WHERE delivery_id = @id', [h.guid('id', deliveryId)])).toBe(1);
    });

    it('the same signed payload under a new delivery id is a duplicate (replay protection)', async () => {
        const hash = require('crypto').createHash('sha256').update(`body-${uuidv4()}`).digest('hex');
        const first = uuidv4();
        await expect(github.beginDelivery({ deliveryId: first, event: 'pull_request', payloadSha256: hash }))
            .resolves.toEqual({ duplicate: false, previousStatus: null });
        await github.finishDelivery(first, 'processed');

        const replay = await github.beginDelivery({ deliveryId: uuidv4(), event: 'pull_request', payloadSha256: hash.toUpperCase() });
        expect(replay).toEqual(expect.objectContaining({ duplicate: true, previousStatus: 'processed' }));
        expect(h.sameId(replay.duplicateOf, first)).toBe(true);
        await expect(github.beginDelivery({ deliveryId: uuidv4(), event: 'x', payloadSha256: 'nothex' })).rejects.toThrow(TypeError);
    });

    it('a failed payload can be reprocessed under a new delivery id; the hash moves to it', async () => {
        const hash = require('crypto').createHash('sha256').update(`body-${uuidv4()}`).digest('hex');
        const failed = uuidv4();
        await github.beginDelivery({ deliveryId: failed, event: 'pull_request', payloadSha256: hash });
        await github.failDelivery(failed, 'boom');
        const retry = uuidv4();
        await expect(github.beginDelivery({ deliveryId: retry, event: 'pull_request', payloadSha256: hash }))
            .resolves.toEqual({ duplicate: false, previousStatus: null });
        const rows = await execReadCommand(
            'SELECT delivery_id, status, payload_sha256 FROM dbo.GitHubWebhookDeliveries WHERE delivery_id IN (@a, @b)',
            [h.guid('a', failed), h.guid('b', retry)]
        );
        const byId = Object.fromEntries(rows.map(r => [String(r.delivery_id).toLowerCase(), r]));
        expect(byId[failed]).toEqual(expect.objectContaining({ status: 'failed', payload_sha256: null }));
        expect(byId[retry]).toEqual(expect.objectContaining({ status: 'processing', payload_sha256: hash }));
    });

    it('a delivery stuck in processing for more than 10 minutes can be claimed again', async () => {
        const deliveryId = uuidv4();
        await github.beginDelivery({ deliveryId, event: 'pull_request' });
        await execWriteCommand(
            'UPDATE dbo.GitHubWebhookDeliveries SET received_at = DATEADD(MINUTE, -11, SYSDATETIMEOFFSET()) WHERE delivery_id = @id',
            [h.guid('id', deliveryId)]
        );
        await expect(github.beginDelivery({ deliveryId, event: 'pull_request' })).resolves.toEqual({ duplicate: false, previousStatus: 'processing' });
    });
});
