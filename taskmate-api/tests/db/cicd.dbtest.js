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
        await expect(cicd.createDeployRequest({ gid: uuidv4(), repoId, environment: 'staging', versionSha: SHA, requestedBy: user.uid }))
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
