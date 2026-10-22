const { v4: uuidv4 } = require('uuid');
const github = require('../../models/github.model');
const cicd = require('../../models/cicd.model');
const { TYPES } = require('tedious');
const { execWriteCommand } = require('../../helpers/execQuery');
const { isCheckViolation } = require('../../helpers/transaction');
const h = require('./helpers');

const SHA = 'e'.repeat(40);
const SPEC = { version: 1, project: { dir: '.', stack: 'node' }, deploy: null };

async function setup() {
    const user = await h.createUser('ci');
    const gid = await h.createGroup(user.uid);
    const installationId = h.githubId();
    const repoId = h.githubId();
    await github.upsertInstallation({ installationId, accountLogin: 'octo', accountType: 'User' });
    await github.upsertRepository({ repoId, installationId, name: 'site', defaultBranch: 'main', isPrivate: false });
    await github.linkGroupRepository({ gid, repoId, connectedBy: user.uid });
    return { user, gid, installationId, repoId };
}

describe('pipelines', () => {
    it('upserts the pipeline of a repository and reads it back with its spec', async () => {
        const { user, repoId } = await setup();
        await expect(cicd.getPipeline(repoId)).resolves.toBeNull();
        await expect(cicd.upsertPipeline({ repoId, workflowPath: '.github/workflows/taskmate-ci.yml', spec: SPEC, commitSha: SHA, configuredBy: user.uid }))
            .resolves.toEqual({ created: true });
        const other = await h.createUser('ci2');
        const nextSha = 'F'.repeat(40);
        await expect(cicd.upsertPipeline({ repoId, workflowPath: '.github/workflows/taskmate-ci.yml', spec: { ...SPEC, audit: true }, commitSha: nextSha, configuredBy: other.uid }))
            .resolves.toEqual({ created: false });

        const pipeline = await cicd.getPipeline(repoId);
        expect(pipeline).toEqual(expect.objectContaining({
            repoId, workflowPath: '.github/workflows/taskmate-ci.yml', spec: { ...SPEC, audit: true },
            commitSha: nextSha.toLowerCase(), configuredByUsername: other.username,
        }));
        expect(h.sameId(pipeline.configuredBy, other.uid)).toBe(true);
        expect(await cicd.deletePipeline(repoId)).toBe(true);
        expect(await cicd.getPipeline(repoId)).toBeNull();
    });

    it('rejects bad input and unknown repositories; cascades with the repository', async () => {
        const { user, installationId, repoId } = await setup();
        await expect(cicd.upsertPipeline({ repoId, workflowPath: 'x', spec: SPEC, commitSha: 'nope', configuredBy: user.uid })).rejects.toThrow(TypeError);
        await expect(cicd.upsertPipeline({ repoId, workflowPath: 'x', spec: { big: 'x'.repeat(5000) }, commitSha: SHA, configuredBy: user.uid })).rejects.toThrow(/too large/);
        await expect(cicd.upsertPipeline({ repoId: h.githubId(), workflowPath: 'x', spec: SPEC, commitSha: SHA, configuredBy: user.uid }))
            .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

        await cicd.upsertPipeline({ repoId, workflowPath: 'x', spec: SPEC, commitSha: SHA, configuredBy: user.uid });
        await github.deleteInstallation(installationId);
        expect(await cicd.getPipeline(repoId)).toBeNull();
    });

    it('the spec column only holds JSON', async () => {
        const { user, repoId } = await setup();
        const err = await execWriteCommand(
            `INSERT INTO dbo.RepoPipelines (repo_id, workflow_path, spec, commit_sha, configured_by)
             VALUES (@repoId, N'x', N'{not json', @sha, @uid)`,
            [{ name: 'repoId', type: TYPES.BigInt, value: repoId }, { name: 'sha', type: TYPES.Char, value: SHA }, h.guid('uid', user.uid)]
        ).catch((e) => e);
        expect(isCheckViolation(err)).toBe(true);
    });
});

describe('deploy requests', () => {
    it('one pending request per group and environment; decided requests free the slot', async () => {
        const { user, gid, repoId } = await setup();
        const admin = user;
        const member = await h.createUser('dev');
        await h.addMember(member.uid, gid);

        const first = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: member.uid });
        expect(first).toEqual(expect.objectContaining({
            environment: 'production', versionSha: SHA, status: 'pending', requestedByUsername: member.username, decidedBy: null, decidedAt: null,
        }));
        await expect(cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: admin.uid }))
            .rejects.toMatchObject({ code: 'DEPLOY_REQUEST_PENDING', status: 409 });
        // Another environment has its own slot.
        await cicd.createDeployRequest({ gid, repoId, environment: 'staging', versionSha: SHA, requestedBy: member.uid });

        const approved = await cicd.decideDeployRequest({ requestId: first.requestId, gid, status: 'approved', decidedBy: admin.uid });
        expect(approved).toEqual(expect.objectContaining({ status: 'approved', decidedByUsername: admin.username }));
        expect(approved.decidedAt).toBeInstanceOf(Date);
        // Already decided: a second admin cannot decide it again.
        await expect(cicd.decideDeployRequest({ requestId: first.requestId, gid, status: 'rejected', decidedBy: admin.uid })).resolves.toBeNull();

        const second = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: 'a'.repeat(40), requestedBy: member.uid });
        const list = await cicd.listDeployRequests(gid);
        expect(list[0].status).toBe('pending');
        expect(list.map((r) => r.requestId.toLowerCase())).toEqual(expect.arrayContaining([first.requestId.toLowerCase(), second.requestId.toLowerCase()]));
    });

    it('decisions are scoped to the group; an approval can be reopened when the dispatch fails', async () => {
        const { user, gid, repoId } = await setup();
        const request = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid });
        await expect(cicd.decideDeployRequest({ requestId: request.requestId, gid: uuidv4(), status: 'approved', decidedBy: user.uid })).resolves.toBeNull();
        await cicd.decideDeployRequest({ requestId: request.requestId, gid, status: 'approved', decidedBy: user.uid, note: 'ok' });
        expect(await cicd.reopenDeployRequest({ requestId: request.requestId, gid })).toBe(true);
        const reopened = await cicd.getDeployRequest(request.requestId);
        expect(reopened).toEqual(expect.objectContaining({ status: 'pending', decidedBy: null, decidedAt: null, note: null }));
        expect(await cicd.reopenDeployRequest({ requestId: request.requestId, gid })).toBe(false);
    });

    it('constraints: environment, SHA and decision columns', async () => {
        const { user, gid, repoId } = await setup();
        const err = await cicd.createDeployRequest({ gid, repoId, environment: 'qa', versionSha: SHA, requestedBy: user.uid }).catch((e) => e);
        expect(isCheckViolation(err)).toBe(true);
        await expect(cicd.createDeployRequest({ gid, repoId, environment: 'staging', versionSha: 'xyz', requestedBy: user.uid })).rejects.toThrow(TypeError);
        await expect(cicd.decideDeployRequest({ requestId: uuidv4(), gid, status: 'pending', decidedBy: user.uid })).rejects.toThrow(TypeError);
        // A group without a linked repository (here: no group at all) cannot hold requests.
        await expect(cicd.createDeployRequest({ gid: uuidv4(), repoId, environment: 'staging', versionSha: SHA, requestedBy: user.uid }))
            .rejects.toMatchObject({ code: 'REPO_NOT_CONNECTED', status: 409 });
        await expect(cicd.createDeployRequest({ gid, repoId, environment: 'staging', versionSha: SHA, requestedBy: uuidv4() }))
            .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('requests disappear with their group', async () => {
        const { user, gid, repoId } = await setup();
        const request = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid });
        await execWriteCommand('DELETE FROM dbo.UserGroups WHERE gid = @gid', [h.guid('gid', gid)]);
        await execWriteCommand('DELETE FROM dbo.Groups WHERE gid = @gid', [h.guid('gid', gid)]);
        expect(await cicd.getDeployRequest(request.requestId)).toBeNull();
    });
});

describe('deploy requests follow the repository linked now (Phase 4, D4)', () => {
    const pendingOf = async (gid) => h.count("dbo.DeployRequests WHERE gid = @gid AND status = 'pending'", [h.guid('gid', gid)]);

    it('switching repositories deletes the pending requests of the old one; decided ones stay as history', async () => {
        const { user, gid, installationId, repoId } = await setup();
        const decidedOld = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid });
        await cicd.decideDeployRequest({ requestId: decidedOld.requestId, gid, status: 'rejected', decidedBy: user.uid });
        const pendingOld = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: 'a'.repeat(40), requestedBy: user.uid });

        // Re-linking the same repository keeps its pending request.
        await github.linkGroupRepository({ gid, repoId, connectedBy: user.uid });
        expect(await cicd.getDeployRequest(pendingOld.requestId)).toEqual(expect.objectContaining({ status: 'pending' }));

        const newRepo = h.githubId();
        await github.upsertRepository({ repoId: newRepo, installationId, name: 'next', defaultBranch: 'main', isPrivate: false });
        await github.linkGroupRepository({ gid, repoId: newRepo, connectedBy: user.uid });
        expect(await cicd.getDeployRequest(pendingOld.requestId)).toBeNull();
        expect(await cicd.getDeployRequest(decidedOld.requestId)).toEqual(expect.objectContaining({ status: 'rejected' }));

        // The pending slot is free for the new repository, and a late request for the old one is refused.
        const fresh = await cicd.createDeployRequest({ gid, repoId: newRepo, environment: 'production', versionSha: SHA, requestedBy: user.uid });
        await expect(cicd.createDeployRequest({ gid, repoId, environment: 'staging', versionSha: SHA, requestedBy: user.uid }))
            .rejects.toMatchObject({ code: 'DEPLOY_REQUEST_STALE', status: 409 });

        // Only the current repository's requests are listed when asked for.
        const current = await cicd.listDeployRequests(gid, { repoId: newRepo });
        expect(current.map((r) => r.requestId.toLowerCase())).toEqual([fresh.requestId.toLowerCase()]);
        expect((await cicd.listDeployRequests(gid)).map((r) => r.requestId.toLowerCase()))
            .toEqual(expect.arrayContaining([fresh.requestId.toLowerCase(), decidedOld.requestId.toLowerCase()]));
        await expect(cicd.listDeployRequests(gid, { repoId: 'x' })).rejects.toThrow(TypeError);
    });

    it('unlinking deletes every pending request of the group; a request without a link is refused', async () => {
        const { user, gid, repoId } = await setup();
        const approved = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid });
        await cicd.decideDeployRequest({ requestId: approved.requestId, gid, status: 'approved', decidedBy: user.uid });
        await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: 'a'.repeat(40), requestedBy: user.uid });
        await cicd.createDeployRequest({ gid, repoId, environment: 'staging', versionSha: SHA, requestedBy: user.uid });
        expect(await pendingOf(gid)).toBe(2);

        expect(await github.unlinkGroupRepository(gid)).toBe(true);
        expect(await pendingOf(gid)).toBe(0);
        expect(await cicd.getDeployRequest(approved.requestId)).toEqual(expect.objectContaining({ status: 'approved' }));
        await expect(cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid }))
            .rejects.toMatchObject({ code: 'REPO_NOT_CONNECTED' });
    });

    it('a request racing a repository switch never keeps the pending slot for the old repository', async () => {
        for (let i = 0; i < 6; i += 1) {
            const { user, gid, installationId, repoId } = await setup();
            const newRepo = h.githubId();
            await github.upsertRepository({ repoId: newRepo, installationId, name: `next${i}`, defaultBranch: 'main', isPrivate: false });
            const [create, link] = await Promise.allSettled([
                cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid }),
                i % 2 === 0
                    ? github.linkGroupRepository({ gid, repoId: newRepo, connectedBy: user.uid })
                    : github.unlinkGroupRepository(gid),
            ]);
            expect(link.status).toBe('fulfilled');
            if (create.status === 'rejected') expect(['DEPLOY_REQUEST_STALE', 'REPO_NOT_CONNECTED']).toContain(create.reason.code);
            expect(await pendingOf(gid)).toBe(0);
        }
    });
});

describe('an approval whose dispatch failed (Phase 4, D5)', () => {
    it('goes back to pending; when a new request took the slot it is cancelled with a note instead', async () => {
        const { user, gid, repoId } = await setup();
        const member = await h.createUser('dev');
        await h.addMember(member.uid, gid);
        const request = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: member.uid });
        await cicd.decideDeployRequest({ requestId: request.requestId, gid, status: 'approved', decidedBy: user.uid });
        // While GitHub was being asked, a member made a new request: the pending slot is taken.
        const newer = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: 'a'.repeat(40), requestedBy: member.uid });

        await expect(cicd.reopenDeployRequest({ requestId: request.requestId, gid }))
            .rejects.toMatchObject({ code: 'DEPLOY_REQUEST_PENDING', status: 409 });
        expect(await cicd.getDeployRequest(request.requestId)).toEqual(expect.objectContaining({ status: 'approved' }));

        await expect(cicd.cancelApprovedDeployRequest({ requestId: request.requestId, gid: uuidv4(), note: 'x' })).resolves.toBeNull();
        const cancelled = await cicd.cancelApprovedDeployRequest({ requestId: request.requestId, gid, note: 'No se pudo iniciar el deploy en GitHub; pide de nuevo.' });
        expect(cancelled).toEqual(expect.objectContaining({
            status: 'cancelled', note: 'No se pudo iniciar el deploy en GitHub; pide de nuevo.', decidedByUsername: user.username,
        }));
        expect(cancelled.decidedAt).toBeInstanceOf(Date);
        // Only approved requests: a second call and a pending request change nothing.
        await expect(cicd.cancelApprovedDeployRequest({ requestId: request.requestId, gid, note: 'x' })).resolves.toBeNull();
        await expect(cicd.cancelApprovedDeployRequest({ requestId: newer.requestId, gid, note: 'x' })).resolves.toBeNull();
        expect(await cicd.getDeployRequest(newer.requestId)).toEqual(expect.objectContaining({ status: 'pending' }));
    });

    const pendingOf = async (gid) => h.count("dbo.DeployRequests WHERE gid = @gid AND status = 'pending'", [h.guid('gid', gid)]);
    const NOTE = 'No se pudo iniciar el deploy en GitHub; pide de nuevo.';

    it('is not reopened for a repository the group switched away from meanwhile; it is cancelled instead', async () => {
        const { user, gid, installationId, repoId } = await setup();
        const request = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid });
        await cicd.decideDeployRequest({ requestId: request.requestId, gid, status: 'approved', decidedBy: user.uid });
        // While GitHub was being asked, an admin linked another repository (approved requests survive the switch).
        const newRepo = h.githubId();
        await github.upsertRepository({ repoId: newRepo, installationId, name: 'next', defaultBranch: 'main', isPrivate: false });
        await github.linkGroupRepository({ gid, repoId: newRepo, connectedBy: user.uid });

        expect(await cicd.reopenDeployRequest({ requestId: request.requestId, gid })).toBe(false);
        expect(await cicd.getDeployRequest(request.requestId)).toEqual(expect.objectContaining({ status: 'approved' }));
        const cancelled = await cicd.cancelApprovedDeployRequest({ requestId: request.requestId, gid, note: NOTE });
        expect(cancelled).toEqual(expect.objectContaining({ status: 'cancelled', note: NOTE }));
        expect(await pendingOf(gid)).toBe(0);
        // The pending slot stays free for the repository the group uses now.
        await expect(cicd.createDeployRequest({ gid, repoId: newRepo, environment: 'production', versionSha: SHA, requestedBy: user.uid }))
            .resolves.toEqual(expect.objectContaining({ status: 'pending' }));
    });

    it('is not reopened once the group has no repository', async () => {
        const { user, gid, repoId } = await setup();
        const request = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid });
        await cicd.decideDeployRequest({ requestId: request.requestId, gid, status: 'approved', decidedBy: user.uid });
        expect(await github.unlinkGroupRepository(gid)).toBe(true);

        expect(await cicd.reopenDeployRequest({ requestId: request.requestId, gid })).toBe(false);
        expect(await pendingOf(gid)).toBe(0);
        await expect(cicd.cancelApprovedDeployRequest({ requestId: request.requestId, gid, note: NOTE }))
            .resolves.toEqual(expect.objectContaining({ status: 'cancelled' }));
    });

    it('a reopen racing a repository switch never keeps the pending slot for the old repository', async () => {
        for (let i = 0; i < 6; i += 1) {
            const { user, gid, installationId, repoId } = await setup();
            const request = await cicd.createDeployRequest({ gid, repoId, environment: 'production', versionSha: SHA, requestedBy: user.uid });
            await cicd.decideDeployRequest({ requestId: request.requestId, gid, status: 'approved', decidedBy: user.uid });
            const newRepo = h.githubId();
            await github.upsertRepository({ repoId: newRepo, installationId, name: `next${i}`, defaultBranch: 'main', isPrivate: false });
            const [reopen, link] = await Promise.allSettled([
                cicd.reopenDeployRequest({ requestId: request.requestId, gid }),
                i % 2 === 0
                    ? github.linkGroupRepository({ gid, repoId: newRepo, connectedBy: user.uid })
                    : github.unlinkGroupRepository(gid),
            ]);
            expect(link.status).toBe('fulfilled');
            expect(reopen.status).toBe('fulfilled');
            // Reopened before the switch → the switch deleted it; after it → not reopened.
            expect(await pendingOf(gid)).toBe(0);
        }
    });
});
