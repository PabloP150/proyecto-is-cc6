// models/deployment.model.js — deployments reported by Vercel/AWS, the group→provider-project
// link and the webhook delivery log (tables from migrations/007_deployments.sql).
// Follows the same shape as models/github.model.js.
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction, isUniqueViolation } = require('../helpers/transaction');
const { TYPES } = require('tedious');

const PROVIDERS = ['vercel', 'aws'];
const STATES = ['queued', 'building', 'ready', 'error', 'canceled'];

// DATETIMEOFFSET(0) rounds to the nearest second; truncate so a stored timestamp never
// looks newer than the event it came from. Same reasoning as github.model.js.
const toDate = (value, field) => {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError(`${field} is not a valid date`);
    date.setUTCMilliseconds(0);
    return date;
};

const dateParam = (name, value) => ({ name, type: TYPES.DateTimeOffset, value, options: { scale: 0 } });
const str = (name, value, length) => ({ name, type: TYPES.NVarChar, value: value === undefined ? null : value, options: { length } });
const ascii = (name, value, length) => ({ name, type: TYPES.VarChar, value, options: { length } });
const uuid = (name, value) => ({ name, type: TYPES.UniqueIdentifier, value });

const read = (options, query, params) => (options && options.tx ? options.tx.read(query, params) : execReadCommand(query, params));
const write = (options, query, params) => (options && options.tx ? options.tx.write(query, params) : execWriteCommand(query, params));

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

const mapDeployment = (row) => ({
    deploymentId: row.deployment_id,
    provider: row.provider,
    gid: row.gid,
    repoId: toNumber(row.repo_id),
    state: row.state,
    environment: row.environment,
    branch: row.branch,
    commitSha: row.commit_sha,
    url: row.url,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

// ---------------------------------------------------------------- deploy targets

const linkDeployTarget = async ({ gid, provider, projectRef, connectedBy }, options = {}) =>
    useTransaction(options, async (tx) => {
        if (!PROVIDERS.includes(provider)) throw new TypeError(`unknown provider ${provider}`);
        try {
            // MERGE-free upsert: a group re-linking the same provider replaces its target.
            await tx.write(
                `UPDATE dbo.GroupDeployTargets
                    SET project_ref = @ref, connected_by = @by, created_at = SYSDATETIMEOFFSET()
                  WHERE gid = @gid AND provider = @provider;
                 IF @@ROWCOUNT = 0
                    INSERT INTO dbo.GroupDeployTargets (gid, provider, project_ref, connected_by)
                    VALUES (@gid, @provider, @ref, @by);`,
                [uuid('gid', gid), ascii('provider', provider, 20), str('ref', projectRef, 128), uuid('by', connectedBy)],
            );
        } catch (err) {
            // UQ_GroupDeployTargets_Project: that provider project belongs to another group.
            if (isUniqueViolation(err)) {
                const conflict = new Error('That deploy project is already linked to another group');
                conflict.code = 'DEPLOY_TARGET_TAKEN';
                throw conflict;
            }
            throw err;
        }
        return { gid, provider, projectRef };
    });

const getDeployTarget = async (gid, provider, options = {}) => {
    const rows = await read(
        options,
        `SELECT gid, provider, project_ref, created_at
           FROM dbo.GroupDeployTargets WHERE gid = @gid AND provider = @provider`,
        [uuid('gid', gid), ascii('provider', provider, 20)],
    );
    const row = rows && rows[0];
    return row ? { gid: row.gid, provider: row.provider, projectRef: row.project_ref, createdAt: row.created_at } : null;
};

// Routing a webhook: the provider sends its own project id, never a TaskMate group.
const findGroupByProjectRef = async (provider, projectRef, options = {}) => {
    const rows = await read(
        options,
        `SELECT gid FROM dbo.GroupDeployTargets WHERE provider = @provider AND project_ref = @ref`,
        [ascii('provider', provider, 20), str('ref', projectRef, 128)],
    );
    return rows && rows[0] ? rows[0].gid : null;
};

const unlinkDeployTarget = async (gid, provider, options = {}) =>
    (await write(
        options,
        `DELETE FROM dbo.GroupDeployTargets WHERE gid = @gid AND provider = @provider`,
        [uuid('gid', gid), ascii('provider', provider, 20)],
    )) > 0;

// ---------------------------------------------------------------- deployments

/**
 * Insert or update a deployment.
 *
 * Webhooks arrive out of order and are retried, so an update only moves a deployment
 * forward: an older `updatedAt` than the stored one is discarded rather than overwriting
 * a newer state. Same guard as applyPullRequest's gh_updated_at comparison.
 */
const applyDeployment = async (deployment, options = {}) =>
    useTransaction(options, async (tx) => {
        const {
            deploymentId, provider, gid, repoId, state, environment,
            branch, commitSha, url, errorMessage, updatedAt,
        } = deployment;

        if (!PROVIDERS.includes(provider)) throw new TypeError(`unknown provider ${provider}`);
        if (!STATES.includes(state)) throw new TypeError(`unknown state ${state}`);

        const when = toDate(updatedAt, 'updatedAt') || new Date();
        when.setUTCMilliseconds(0);

        const params = [
            str('id', deploymentId, 128),
            ascii('provider', provider, 20),
            uuid('gid', gid),
            { name: 'repoId', type: TYPES.BigInt, value: repoId === undefined ? null : repoId },
            ascii('state', state, 12),
            ascii('env', environment || 'production', 20),
            str('branch', branch, 255),
            { name: 'sha', type: TYPES.Char, value: commitSha || null, options: { length: 40 } },
            str('url', url, 512),
            str('err', errorMessage, 1024),
            dateParam('when', when),
        ];

        const rows = await tx.read(
            `MERGE dbo.Deployments WITH (HOLDLOCK) AS target
                  USING (SELECT @provider AS provider, @id AS deployment_id) AS src
                     ON target.provider = src.provider AND target.deployment_id = src.deployment_id
             WHEN MATCHED AND target.updated_at <= @when THEN
                  UPDATE SET state = @state, branch = COALESCE(@branch, target.branch),
                             commit_sha = COALESCE(@sha, target.commit_sha),
                             url = COALESCE(@url, target.url),
                             error_message = @err, repo_id = COALESCE(@repoId, target.repo_id),
                             updated_at = @when
             WHEN NOT MATCHED THEN
                  INSERT (deployment_id, provider, gid, repo_id, state, environment, branch,
                          commit_sha, url, error_message, created_at, updated_at)
                  VALUES (@id, @provider, @gid, @repoId, @state, @env, @branch, @sha, @url, @err, @when, @when)
             OUTPUT $action AS action, inserted.state AS state;`,
            params,
        );

        const row = rows && rows[0];
        // No OUTPUT row means the MATCHED guard rejected it: a stale retry, not a failure.
        if (!row) return { changed: false, stale: true, state: null };
        return { changed: true, stale: false, state: row.state, inserted: row.action === 'INSERT' };
    });

const listDeployments = async (gid, { limit = 20 } = {}, options = {}) => {
    const take = Math.max(1, Math.min(Number(limit) || 20, 100));
    const rows = await read(
        options,
        `SELECT TOP (@take) deployment_id, provider, gid, repo_id, state, environment,
                branch, commit_sha, url, error_message, created_at, updated_at
           FROM dbo.Deployments WHERE gid = @gid ORDER BY created_at DESC`,
        [uuid('gid', gid), { name: 'take', type: TYPES.Int, value: take }],
    );
    return (rows || []).map(mapDeployment);
};

const getLatestDeployment = async (gid, options = {}) => {
    const rows = await listDeployments(gid, { limit: 1 }, options);
    return rows[0] || null;
};

// ---------------------------------------------------------------- deliveries

/**
 * Claim a delivery id. Returns false when this delivery was already recorded, which is how
 * provider retries stay idempotent -- the same contract as github.model.beginDelivery.
 */
const beginDelivery = async ({ deliveryId, provider, event }, options = {}) => {
    try {
        await write(
            options,
            `INSERT INTO dbo.DeploymentWebhookDeliveries (delivery_id, provider, event)
             VALUES (@id, @provider, @event)`,
            [str('id', deliveryId, 128), ascii('provider', provider, 20), ascii('event', event, 50)],
        );
        return true;
    } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
    }
};

const finishDelivery = async (deliveryId, status, errorMessage = null, options = {}) =>
    (await write(
        options,
        `UPDATE dbo.DeploymentWebhookDeliveries
            SET status = @status, error_message = @err, processed_at = SYSDATETIMEOFFSET()
          WHERE delivery_id = @id`,
        [str('id', deliveryId, 128), ascii('status', status, 12), str('err', errorMessage, 1024)],
    )) > 0;

module.exports = {
    PROVIDERS,
    STATES,
    linkDeployTarget,
    getDeployTarget,
    unlinkDeployTarget,
    findGroupByProjectRef,
    applyDeployment,
    listDeployments,
    getLatestDeployment,
    beginDelivery,
    finishDelivery,
};
