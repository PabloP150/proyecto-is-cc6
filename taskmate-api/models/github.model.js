// models/github.model.js — GitHub App installations, repositories, group links, task branches,
// pull requests and the webhook delivery log (tables from migrations/002_github.sql).
// BIGINT ids come back from tedious as strings and are normalized with Number().
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction, isUniqueViolation, isFkViolation, violatedConstraint } = require('../helpers/transaction');
const { AppError } = require('../helpers/errors');
const { TYPES } = require('tedious');

const DELIVERY_STALE_MINUTES = 10;

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

const bigIntParam = (name, value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive integer`);
    return { name, type: TYPES.BigInt, value: n };
};

// DATETIMEOFFSET(0) rounds to the nearest second, so values are truncated first: a rounded-up
// timestamp would look newer than the GitHub event it came from.
const toDate = (value, field) => {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError(`${field} is not a valid date`);
    date.setUTCMilliseconds(0);
    return date;
};

const dateParam = (name, value) => ({ name, type: TYPES.DateTimeOffset, value, options: { scale: 0 } });
const time = (date) => (date ? date.getTime() : null);

const read = (options, query, params) => (options && options.tx ? options.tx.read(query, params) : execReadCommand(query, params));
const write = (options, query, params) => (options && options.tx ? options.tx.write(query, params) : execWriteCommand(query, params));

// ---------------------------------------------------------------- installations

const upsertInstallation = async ({ installationId, accountLogin, accountType, suspendedAt }, options = {}) =>
    useTransaction(options, async (tx) => {
        const params = [
            bigIntParam('id', installationId),
            { name: 'login', type: TYPES.NVarChar, value: accountLogin },
            { name: 'type', type: TYPES.VarChar, value: accountType },
            // `suspendedAt: undefined` leaves the current value alone on update.
            { name: 'setSuspended', type: TYPES.Bit, value: suspendedAt !== undefined },
            dateParam('suspendedAt', toDate(suspendedAt, 'suspendedAt')),
        ];
        const updated = await tx.write(
            `UPDATE dbo.GitHubInstallations WITH (HOLDLOCK)
             SET account_login = @login, account_type = @type,
                 suspended_at = CASE WHEN @setSuspended = 1 THEN @suspendedAt ELSE suspended_at END
             WHERE installation_id = @id`,
            params
        );
        if (updated > 0) return { created: false };
        await tx.write(
            `INSERT INTO dbo.GitHubInstallations (installation_id, account_login, account_type, suspended_at)
             VALUES (@id, @login, @type, @suspendedAt)`,
            params
        );
        return { created: true };
    });

const setInstallationSuspended = async (installationId, suspendedAt, options = {}) => (await write(options,
    'UPDATE dbo.GitHubInstallations SET suspended_at = @suspendedAt WHERE installation_id = @id',
    [bigIntParam('id', installationId), dateParam('suspendedAt', toDate(suspendedAt, 'suspendedAt'))]
)) > 0;

// Cascades to repositories, group links, task branches and pull requests.
const deleteInstallation = async (installationId, options = {}) => (await write(options,
    'DELETE FROM dbo.GitHubInstallations WHERE installation_id = @id',
    [bigIntParam('id', installationId)]
)) > 0;

// ---------------------------------------------------------------- repositories

const upsertRepository = async ({ repoId, installationId, name, defaultBranch, isPrivate }, options = {}) =>
    useTransaction(options, async (tx) => {
        const params = [
            bigIntParam('repoId', repoId),
            bigIntParam('installationId', installationId),
            { name: 'name', type: TYPES.NVarChar, value: name },
            { name: 'defaultBranch', type: TYPES.NVarChar, value: defaultBranch },
            { name: 'isPrivate', type: TYPES.Bit, value: Boolean(isPrivate) },
        ];
        const updated = await tx.write(
            `UPDATE dbo.GitHubRepositories WITH (HOLDLOCK)
             SET installation_id = @installationId, name = @name, default_branch = @defaultBranch,
                 is_private = @isPrivate, updated_at = SYSDATETIMEOFFSET()
             WHERE repo_id = @repoId`,
            params
        );
        if (updated > 0) return { created: false };
        await tx.write(
            `INSERT INTO dbo.GitHubRepositories (repo_id, installation_id, name, default_branch, is_private)
             VALUES (@repoId, @installationId, @name, @defaultBranch, @isPrivate)`,
            params
        );
        return { created: true };
    });

// Cascades to group links, task branches and pull requests.
const deleteRepository = async (repoId, options = {}) => (await write(options,
    'DELETE FROM dbo.GitHubRepositories WHERE repo_id = @repoId',
    [bigIntParam('repoId', repoId)]
)) > 0;

// ---------------------------------------------------------------- group <-> repository

// linkGroupRepository({gid, repoId, connectedBy}) → {previousRepoId}
const linkGroupRepository = async ({ gid, repoId, connectedBy }, options = {}) => {
    try {
        return await useTransaction(options, async (tx) => {
            const params = [
                { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
                bigIntParam('repoId', repoId),
                { name: 'connectedBy', type: TYPES.UniqueIdentifier, value: connectedBy },
            ];
            const current = await tx.read(
                'SELECT repo_id FROM dbo.GroupRepositories WITH (UPDLOCK, HOLDLOCK) WHERE gid = @gid',
                params
            );
            if (current.length > 0) {
                await tx.write(
                    `UPDATE dbo.GroupRepositories
                     SET repo_id = @repoId, connected_by = @connectedBy, connected_at = SYSDATETIMEOFFSET()
                     WHERE gid = @gid`,
                    params
                );
            } else {
                await tx.write(
                    'INSERT INTO dbo.GroupRepositories (gid, repo_id, connected_by) VALUES (@gid, @repoId, @connectedBy)',
                    params
                );
            }
            return { previousRepoId: current.length > 0 ? toNumber(current[0].repo_id) : null };
        });
    } catch (err) {
        if (isFkViolation(err)) throw new AppError('NOT_FOUND', 'Group, repository or user not found', 404);
        throw err;
    }
};

const unlinkGroupRepository = async (gid, options = {}) => (await write(options,
    'DELETE FROM dbo.GroupRepositories WHERE gid = @gid',
    [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }]
)) > 0;

const getGroupRepository = async (gid, options = {}) => {
    const rows = await read(options,
        `SELECT gr.gid, gr.repo_id, i.account_login AS owner, r.name, r.default_branch, r.is_private,
                r.installation_id, i.suspended_at, gr.connected_at, gr.connected_by,
                u.username AS connected_by_username
         FROM dbo.GroupRepositories gr
         INNER JOIN dbo.GitHubRepositories r ON r.repo_id = gr.repo_id
         INNER JOIN dbo.GitHubInstallations i ON i.installation_id = r.installation_id
         LEFT JOIN dbo.Users u ON u.uid = gr.connected_by
         WHERE gr.gid = @gid`,
        [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
        gid: r.gid,
        repoId: toNumber(r.repo_id),
        owner: r.owner,
        name: r.name,
        fullName: `${r.owner}/${r.name}`,
        defaultBranch: r.default_branch,
        isPrivate: Boolean(r.is_private),
        installationId: toNumber(r.installation_id),
        suspendedAt: r.suspended_at,
        connectedAt: r.connected_at,
        connectedBy: r.connected_by,
        connectedByUsername: r.connected_by_username,
    };
};

// ---------------------------------------------------------------- task branches

const getTaskBranch = async (tid, options = {}) => {
    const rows = await read(options,
        `SELECT tid, repo_id, branch_name, base_sha, created_by, created_at
         FROM dbo.TaskBranches WHERE tid = @tid`,
        [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
        tid: r.tid,
        repoId: toNumber(r.repo_id),
        branchName: r.branch_name,
        baseSha: r.base_sha,
        createdBy: r.created_by,
        createdAt: r.created_at,
    };
};

// Throws AppError BRANCH_CONFLICT (409) when the task already has a branch or the name is taken
// in the repository, TASK_NOT_FOUND (404) when the task does not exist.
const insertTaskBranch = async ({ tid, repoId, branchName, baseSha, createdBy }, options = {}) => {
    try {
        await write(options,
            `INSERT INTO dbo.TaskBranches (tid, repo_id, branch_name, base_sha, created_by)
             VALUES (@tid, @repoId, @branchName, @baseSha, @createdBy)`,
            [
                { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
                bigIntParam('repoId', repoId),
                { name: 'branchName', type: TYPES.NVarChar, value: branchName },
                { name: 'baseSha', type: TYPES.Char, value: baseSha },
                { name: 'createdBy', type: TYPES.UniqueIdentifier, value: createdBy },
            ]
        );
    } catch (err) {
        if (isUniqueViolation(err)) {
            const reason = violatedConstraint(err) === 'PK_TaskBranches' ? 'task_has_branch' : 'branch_taken';
            throw new AppError('BRANCH_CONFLICT', 'A branch already exists for this task or name', 409, { reason });
        }
        if (isFkViolation(err) && violatedConstraint(err) === 'FK_TaskBranches_Tasks') {
            throw new AppError('TASK_NOT_FOUND', 'Task not found', 404);
        }
        throw err;
    }
    return { tid, repoId: Number(repoId), branchName, baseSha, createdBy };
};

// Branch names compare case-sensitively (BIN2 collation on the column).
const findTaskByBranch = async (repoId, branchName, options = {}) => {
    const rows = await read(options,
        `SELECT tb.tid, t.gid
         FROM dbo.TaskBranches tb
         INNER JOIN dbo.Tasks t ON t.tid = tb.tid
         WHERE tb.repo_id = @repoId AND tb.branch_name = @branchName`,
        [bigIntParam('repoId', repoId), { name: 'branchName', type: TYPES.NVarChar, value: branchName }]
    );
    return rows.length > 0 ? { tid: rows[0].tid, gid: rows[0].gid } : null;
};

// [{tid, branchName, pr: null | {number, title, state, isDraft, openedAt, mergedAt}}] — latest PR per branch.
const getTaskLinksByGroup = async (gid, options = {}) => {
    const rows = await read(options,
        `SELECT tb.tid, tb.branch_name, pr.number, pr.title, pr.state, pr.is_draft, pr.opened_at, pr.merged_at
         FROM dbo.TaskBranches tb
         INNER JOIN dbo.Tasks t ON t.tid = tb.tid
         OUTER APPLY (
             SELECT TOP 1 p.number, p.title, p.state, p.is_draft, p.opened_at, p.merged_at
             FROM dbo.PullRequests p
             WHERE p.repo_id = tb.repo_id AND p.head_branch = tb.branch_name
             ORDER BY p.opened_at DESC, p.number DESC
         ) pr
         WHERE t.gid = @gid
         ORDER BY tb.created_at, tb.tid`,
        [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }]
    );
    return rows.map(r => ({
        tid: r.tid,
        branchName: r.branch_name,
        pr: r.number === null ? null : {
            number: r.number,
            title: r.title,
            state: r.state,
            isDraft: Boolean(r.is_draft),
            openedAt: r.opened_at,
            mergedAt: r.merged_at,
        },
    }));
};

// ---------------------------------------------------------------- pull requests

const stateOf = (closedAt, mergedAt) => (mergedAt ? 'merged' : closedAt ? 'closed' : 'open');

/**
 * applyPullRequest(pr, {tx}) → {state, changed, becameMerged}
 * Webhooks can arrive out of order, so gh_updated_at decides: an older event changes nothing,
 * except that a merge is a terminal fact and is never lost (merged_at is never cleared).
 * On a same-second tie closed_at is sticky, so a late "opened" cannot reopen a closed PR.
 */
const applyPullRequest = async (pr, options = {}) => useTransaction(options, async (tx) => {
    const incoming = {
        number: pr.number,
        headBranch: pr.headBranch,
        baseBranch: pr.baseBranch,
        title: pr.title,
        isDraft: Boolean(pr.isDraft),
        openedAt: toDate(pr.openedAt, 'openedAt'),
        closedAt: toDate(pr.closedAt, 'closedAt'),
        mergedAt: toDate(pr.mergedAt, 'mergedAt'),
        ghUpdatedAt: toDate(pr.ghUpdatedAt, 'ghUpdatedAt'),
    };
    if (!Number.isInteger(incoming.number) || incoming.number <= 0) throw new TypeError('number must be a positive integer');
    if (!incoming.openedAt || !incoming.ghUpdatedAt) throw new TypeError('openedAt and ghUpdatedAt are required');

    const idParam = bigIntParam('prId', pr.prId);
    const rows = await tx.read(
        `SELECT number, head_branch, base_branch, title, is_draft, opened_at, closed_at, merged_at, gh_updated_at, state
         FROM dbo.PullRequests WITH (UPDLOCK, HOLDLOCK) WHERE pr_id = @prId`,
        [idParam]
    );

    const fieldParams = (v) => [
        idParam,
        { name: 'number', type: TYPES.Int, value: v.number },
        { name: 'headBranch', type: TYPES.NVarChar, value: v.headBranch },
        { name: 'baseBranch', type: TYPES.NVarChar, value: v.baseBranch },
        { name: 'title', type: TYPES.NVarChar, value: String(v.title ?? '').slice(0, 256) },
        { name: 'isDraft', type: TYPES.Bit, value: v.isDraft },
        dateParam('openedAt', v.openedAt),
        dateParam('closedAt', v.closedAt),
        dateParam('mergedAt', v.mergedAt),
        dateParam('ghUpdatedAt', v.ghUpdatedAt),
    ];

    if (rows.length === 0) {
        const next = { ...incoming, closedAt: incoming.closedAt || incoming.mergedAt };
        await tx.write(
            `INSERT INTO dbo.PullRequests
                 (pr_id, repo_id, number, head_branch, base_branch, title, is_draft, opened_at, closed_at, merged_at, gh_updated_at)
             VALUES (@prId, @repoId, @number, @headBranch, @baseBranch, @title, @isDraft, @openedAt, @closedAt, @mergedAt, @ghUpdatedAt)`,
            [...fieldParams(next), bigIntParam('repoId', pr.repoId)]
        );
        return { state: stateOf(next.closedAt, next.mergedAt), changed: true, becameMerged: Boolean(next.mergedAt) };
    }

    const cur = rows[0];
    const current = {
        number: cur.number,
        headBranch: cur.head_branch,
        baseBranch: cur.base_branch,
        title: cur.title,
        isDraft: Boolean(cur.is_draft),
        openedAt: cur.opened_at,
        closedAt: cur.closed_at,
        mergedAt: cur.merged_at,
        ghUpdatedAt: cur.gh_updated_at,
    };

    let next;
    if (time(incoming.ghUpdatedAt) < time(current.ghUpdatedAt)) {
        if (current.mergedAt || !incoming.mergedAt) return { state: cur.state, changed: false, becameMerged: false };
        next = { ...current, mergedAt: incoming.mergedAt, closedAt: current.closedAt || incoming.closedAt || incoming.mergedAt };
    } else {
        const tie = time(incoming.ghUpdatedAt) === time(current.ghUpdatedAt);
        const mergedAt = current.mergedAt || incoming.mergedAt;
        let closedAt = incoming.closedAt || (tie || mergedAt ? current.closedAt : null);
        if (mergedAt && !closedAt) closedAt = mergedAt;
        next = { ...incoming, closedAt, mergedAt };
    }

    const changed = next.number !== current.number
        || next.headBranch !== current.headBranch
        || next.baseBranch !== current.baseBranch
        || String(next.title ?? '').slice(0, 256) !== current.title
        || next.isDraft !== current.isDraft
        || time(next.openedAt) !== time(current.openedAt)
        || time(next.closedAt) !== time(current.closedAt)
        || time(next.mergedAt) !== time(current.mergedAt)
        || time(next.ghUpdatedAt) !== time(current.ghUpdatedAt);
    if (!changed) return { state: cur.state, changed: false, becameMerged: false };

    await tx.write(
        `UPDATE dbo.PullRequests
         SET number = @number, head_branch = @headBranch, base_branch = @baseBranch, title = @title,
             is_draft = @isDraft, opened_at = @openedAt, closed_at = @closedAt, merged_at = @mergedAt,
             gh_updated_at = @ghUpdatedAt
         WHERE pr_id = @prId`,
        fieldParams(next)
    );
    return {
        state: stateOf(next.closedAt, next.mergedAt),
        changed: true,
        becameMerged: !current.mergedAt && Boolean(next.mergedAt),
    };
});

// ---------------------------------------------------------------- webhook deliveries

/**
 * beginDelivery({deliveryId, event, action, installationId}) → {duplicate, previousStatus}
 * duplicate = already 'processed'/'ignored', or 'processing' by another request right now.
 * 'failed' deliveries (and 'processing' ones abandoned for more than 10 minutes) are claimed again.
 */
const beginDelivery = async ({ deliveryId, event, action = null, installationId = null }) => useTransaction({}, async (tx) => {
    const params = [
        { name: 'id', type: TYPES.UniqueIdentifier, value: deliveryId },
        { name: 'event', type: TYPES.VarChar, value: event },
        { name: 'action', type: TYPES.VarChar, value: action },
        { name: 'installationId', type: TYPES.BigInt, value: installationId === null ? null : Number(installationId) },
        { name: 'staleMinutes', type: TYPES.Int, value: DELIVERY_STALE_MINUTES },
    ];
    const rows = await tx.read(
        `SELECT status,
                CASE WHEN received_at < DATEADD(MINUTE, -@staleMinutes, SYSDATETIMEOFFSET()) THEN 1 ELSE 0 END AS stale
         FROM dbo.GitHubWebhookDeliveries WITH (UPDLOCK, HOLDLOCK) WHERE delivery_id = @id`,
        params
    );
    if (rows.length === 0) {
        await tx.write(
            `INSERT INTO dbo.GitHubWebhookDeliveries (delivery_id, event, action, installation_id)
             VALUES (@id, @event, @action, @installationId)`,
            params
        );
        return { duplicate: false, previousStatus: null };
    }
    const { status, stale } = rows[0];
    if (status === 'processed' || status === 'ignored' || (status === 'processing' && !stale)) {
        return { duplicate: true, previousStatus: status };
    }
    await tx.write(
        `UPDATE dbo.GitHubWebhookDeliveries
         SET status = 'processing', processed_at = NULL, error = NULL, received_at = SYSDATETIMEOFFSET(),
             event = @event, action = @action, installation_id = @installationId
         WHERE delivery_id = @id`,
        params
    );
    return { duplicate: false, previousStatus: status };
});

const finishDelivery = async (deliveryId, status, options = {}) => {
    if (status !== 'processed' && status !== 'ignored') throw new TypeError(`finishDelivery: invalid status "${status}"`);
    return (await write(options,
        `UPDATE dbo.GitHubWebhookDeliveries
         SET status = @status, processed_at = SYSDATETIMEOFFSET(), error = NULL
         WHERE delivery_id = @id`,
        [
            { name: 'id', type: TYPES.UniqueIdentifier, value: deliveryId },
            { name: 'status', type: TYPES.VarChar, value: status },
        ]
    )) > 0;
};

// Runs on its own connection: the processing transaction has already been rolled back.
const failDelivery = async (deliveryId, message) => (await execWriteCommand(
    `UPDATE dbo.GitHubWebhookDeliveries
     SET status = 'failed', processed_at = SYSDATETIMEOFFSET(), error = @error
     WHERE delivery_id = @id`,
    [
        { name: 'id', type: TYPES.UniqueIdentifier, value: deliveryId },
        { name: 'error', type: TYPES.NVarChar, value: String(message ?? '').slice(0, 1000) },
    ]
)) > 0;

const purgeDeliveries = async (olderThanDays = 30) => {
    if (!Number.isInteger(olderThanDays) || olderThanDays < 1) throw new TypeError('olderThanDays must be a positive integer');
    return execWriteCommand(
        'DELETE FROM dbo.GitHubWebhookDeliveries WHERE received_at < DATEADD(DAY, -@days, SYSDATETIMEOFFSET())',
        [{ name: 'days', type: TYPES.Int, value: olderThanDays }]
    );
};

module.exports = {
    upsertInstallation,
    setInstallationSuspended,
    deleteInstallation,
    upsertRepository,
    deleteRepository,
    linkGroupRepository,
    unlinkGroupRepository,
    getGroupRepository,
    getTaskBranch,
    insertTaskBranch,
    findTaskByBranch,
    getTaskLinksByGroup,
    applyPullRequest,
    beginDelivery,
    finishDelivery,
    failDelivery,
    purgeDeliveries,
};
