// models/cicd.model.js — Phase 4 (CI/CD): the pipeline TaskMate wrote into each repository and the
// production deploy requests waiting for a group admin (tables from migrations/007_cicd.sql).
// BIGINT ids come back from tedious as strings and are normalized with Number().
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction, isUniqueViolation, isFkViolation } = require('../helpers/transaction');
const { AppError } = require('../helpers/errors');
const { TYPES } = require('tedious');

const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_SPEC = 4000;

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

const bigIntParam = (name, value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive integer`);
    return { name, type: TYPES.BigInt, value: n };
};

const shaParam = (name, value) => {
    if (typeof value !== 'string' || !SHA_RE.test(value)) throw new TypeError(`${name} must be a 40-character commit SHA`);
    return { name, type: TYPES.Char, value: value.toLowerCase() };
};

const guid = (name, value) => ({ name, type: TYPES.UniqueIdentifier, value });

const read = (options, query, params) => (options && options.tx ? options.tx.read(query, params) : execReadCommand(query, params));
const write = (options, query, params) => (options && options.tx ? options.tx.write(query, params) : execWriteCommand(query, params));

const parseSpec = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------- pipelines

const toPipeline = (r) => ({
    repoId: toNumber(r.repo_id),
    workflowPath: r.workflow_path,
    spec: parseSpec(r.spec),
    commitSha: r.commit_sha,
    configuredBy: r.configured_by,
    configuredByUsername: r.configured_by_username || null,
    configuredAt: r.configured_at,
});

const getPipeline = async (repoId, options = {}) => {
    const rows = await read(options,
        `SELECT p.repo_id, p.workflow_path, p.spec, p.commit_sha, p.configured_by, p.configured_at,
                u.username AS configured_by_username
         FROM dbo.RepoPipelines p
         LEFT JOIN dbo.Users u ON u.uid = p.configured_by
         WHERE p.repo_id = @repoId`,
        [bigIntParam('repoId', repoId)]
    );
    return rows.length > 0 ? toPipeline(rows[0]) : null;
};

// upsertPipeline({repoId, workflowPath, spec (object), commitSha, configuredBy}) → {created}
const upsertPipeline = async ({ repoId, workflowPath, spec, commitSha, configuredBy }, options = {}) => {
    const specText = JSON.stringify(spec);
    if (!specText || specText.length > MAX_SPEC) throw new TypeError('spec is too large');
    try {
        return await useTransaction(options, async (tx) => {
            const params = [
                bigIntParam('repoId', repoId),
                { name: 'workflowPath', type: TYPES.NVarChar, value: String(workflowPath) },
                { name: 'spec', type: TYPES.NVarChar, value: specText },
                shaParam('commitSha', commitSha),
                guid('configuredBy', configuredBy),
            ];
            const updated = await tx.write(
                `UPDATE dbo.RepoPipelines WITH (HOLDLOCK)
                 SET workflow_path = @workflowPath, spec = @spec, commit_sha = @commitSha,
                     configured_by = @configuredBy, configured_at = SYSDATETIMEOFFSET()
                 WHERE repo_id = @repoId`,
                params
            );
            if (updated > 0) return { created: false };
            await tx.write(
                `INSERT INTO dbo.RepoPipelines (repo_id, workflow_path, spec, commit_sha, configured_by)
                 VALUES (@repoId, @workflowPath, @spec, @commitSha, @configuredBy)`,
                params
            );
            return { created: true };
        });
    } catch (err) {
        if (isFkViolation(err)) throw new AppError('NOT_FOUND', 'Repository or user not found', 404);
        throw err;
    }
};

const deletePipeline = async (repoId, options = {}) => (await write(options,
    'DELETE FROM dbo.RepoPipelines WHERE repo_id = @repoId',
    [bigIntParam('repoId', repoId)]
)) > 0;

// ---------------------------------------------------------------- deploy requests

const REQUEST_COLUMNS = `
    r.request_id, r.gid, r.repo_id, r.environment, r.version_sha, r.requested_by, r.requested_at,
    r.status, r.decided_by, r.decided_at, r.note,
    req.username AS requested_by_username, dec.username AS decided_by_username`;

const REQUEST_JOINS = `
    LEFT JOIN dbo.Users req ON req.uid = r.requested_by
    LEFT JOIN dbo.Users dec ON dec.uid = r.decided_by`;

const toRequest = (r) => ({
    requestId: r.request_id,
    gid: r.gid,
    repoId: toNumber(r.repo_id),
    environment: r.environment,
    versionSha: r.version_sha,
    requestedBy: r.requested_by,
    requestedByUsername: r.requested_by_username || null,
    requestedAt: r.requested_at,
    status: r.status,
    decidedBy: r.decided_by,
    decidedByUsername: r.decided_by_username || null,
    decidedAt: r.decided_at,
    note: r.note,
});

/**
 * createDeployRequest({gid, repoId, environment, versionSha, requestedBy}) → request
 * Throws DEPLOY_REQUEST_PENDING (409) when the group already has a pending request for that environment.
 */
const createDeployRequest = async ({ gid, repoId, environment, versionSha, requestedBy }, options = {}) => {
    try {
        return await useTransaction(options, async (tx) => {
            const rows = await tx.read(
                `INSERT INTO dbo.DeployRequests (gid, repo_id, environment, version_sha, requested_by)
                 OUTPUT INSERTED.request_id
                 VALUES (@gid, @repoId, @environment, @versionSha, @requestedBy)`,
                [
                    guid('gid', gid),
                    bigIntParam('repoId', repoId),
                    { name: 'environment', type: TYPES.VarChar, value: environment },
                    shaParam('versionSha', versionSha),
                    guid('requestedBy', requestedBy),
                ]
            );
            return getDeployRequest(rows[0].request_id, { tx });
        });
    } catch (err) {
        if (isUniqueViolation(err)) {
            throw new AppError('DEPLOY_REQUEST_PENDING', 'There is already a pending deploy request for this environment', 409);
        }
        if (isFkViolation(err)) throw new AppError('NOT_FOUND', 'Group, repository or user not found', 404);
        throw err;
    }
};

const getDeployRequest = async (requestId, options = {}) => {
    const rows = await read(options,
        `SELECT ${REQUEST_COLUMNS} FROM dbo.DeployRequests r ${REQUEST_JOINS} WHERE r.request_id = @id`,
        [guid('id', requestId)]
    );
    return rows.length > 0 ? toRequest(rows[0]) : null;
};

// Newest first; pending ones are always included.
const listDeployRequests = async (gid, { limit = 20 } = {}, options = {}) => {
    const top = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const rows = await read(options,
        `SELECT TOP (@top) ${REQUEST_COLUMNS}
         FROM dbo.DeployRequests r ${REQUEST_JOINS}
         WHERE r.gid = @gid
         ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requested_at DESC, r.request_id`,
        [guid('gid', gid), { name: 'top', type: TYPES.Int, value: top }]
    );
    return rows.map(toRequest);
};

/**
 * decideDeployRequest({requestId, gid, status, decidedBy, note}) → request | null
 * Only a pending request of that group changes (null otherwise), so two admins cannot both decide it.
 */
const decideDeployRequest = async ({ requestId, gid, status, decidedBy, note = null }, options = {}) => {
    if (!['approved', 'rejected', 'cancelled'].includes(status)) throw new TypeError(`decideDeployRequest: invalid status "${status}"`);
    return useTransaction(options, async (tx) => {
        const updated = await tx.write(
            `UPDATE dbo.DeployRequests
             SET status = @status, decided_by = @decidedBy, decided_at = SYSDATETIMEOFFSET(), note = @note
             WHERE request_id = @id AND gid = @gid AND status = 'pending'`,
            [
                guid('id', requestId),
                guid('gid', gid),
                { name: 'status', type: TYPES.VarChar, value: status },
                guid('decidedBy', decidedBy),
                { name: 'note', type: TYPES.NVarChar, value: note === null || note === undefined ? null : String(note).slice(0, 500) },
            ]
        );
        return updated > 0 ? getDeployRequest(requestId, { tx }) : null;
    });
};

// Puts an approved request back to pending (the dispatch to GitHub failed after the approval).
const reopenDeployRequest = async ({ requestId, gid }, options = {}) => (await write(options,
    `UPDATE dbo.DeployRequests SET status = 'pending', decided_by = NULL, decided_at = NULL, note = NULL
     WHERE request_id = @id AND gid = @gid AND status = 'approved'`,
    [guid('id', requestId), guid('gid', gid)]
)) > 0;

module.exports = {
    getPipeline,
    upsertPipeline,
    deletePipeline,
    createDeployRequest,
    getDeployRequest,
    listDeployRequests,
    decideDeployRequest,
    reopenDeployRequest,
};
