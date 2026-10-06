const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction } = require('../helpers/transaction');
const { TYPES } = require('tedious');

// Convierte strings de fecha a Date en hora local sin interpretaciones UTC.
// Soporta: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DDTHH:mm:ss', y objetos Date.
const toLocalDate = (dt) => {
    if (!dt) return null;
    if (dt instanceof Date) return dt;
    if (typeof dt === 'string') {
        // Solo fecha
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
            const [y,m,d] = dt.split('-').map(Number);
            return new Date(y, m - 1, d, 0, 0, 0, 0);
        }
        // Fecha con hora (al menos HH:mm)
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dt)) {
            const [datePart, timePart] = dt.split('T');
            const [y,m,d] = datePart.split('-').map(Number);
            const [hh,mm,ss] = timePart.split(':').map(Number);
            return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
        }
    }
    // Fallback a parser nativo
    return new Date(dt);
};

const addTask = async (taskData, options = {}) => {
    const { tid, gid, name, description, list, datetime, percentage } = taskData;
    const safeDescription = (description === undefined || description === null) ? '' : description;
    const query = `INSERT INTO dbo.Tasks (tid, gid, name, description, list, datetime, percentage)
                   VALUES (@tid, @gid, @name, @description, @list, @datetime, @percentage)`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.NVarChar, value: name },
    { name: 'description', type: TYPES.NVarChar, value: safeDescription },
        { name: 'list', type: TYPES.NVarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: toLocalDate(datetime) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return options.tx ? options.tx.write(query, params) : execWriteCommand(query, params);
};

const updateTask = async (taskData) => {
    const { tid, gid, name, description, list, datetime, percentage } = taskData;
    const safeDescription = (description === undefined || description === null) ? '' : description;
    const query = `UPDATE dbo.Tasks
                   SET gid=@gid, name=@name, description=@description, list=@list,
                       datetime=@datetime, percentage=@percentage
                   WHERE tid=@tid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'name', type: TYPES.NVarChar, value: name },
    { name: 'description', type: TYPES.NVarChar, value: safeDescription },
        { name: 'list', type: TYPES.NVarChar, value: list },
        { name: 'datetime', type: TYPES.SmallDateTime, value: toLocalDate(datetime) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? 0 },
    ];
    return execWriteCommand(query, params);
};

const updateTaskFromNode = async (taskData) => {
    const { tid, name, description, date, percentage } = taskData;
    const safeDescription = (description === undefined || description === null) ? '' : description;
    const query = `UPDATE dbo.Tasks
                   SET name=@name, description=@description, datetime=@datetime,
                       percentage = COALESCE(@percentage, percentage)
                   WHERE tid=@tid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'name', type: TYPES.NVarChar, value: name },
    { name: 'description', type: TYPES.NVarChar, value: safeDescription },
        { name: 'datetime', type: TYPES.SmallDateTime, value: toLocalDate(date) },
        { name: 'percentage', type: TYPES.Int, value: percentage ?? null },
    ];
    return execWriteCommand(query, params);
};

// TaskAnalytics is a history table: closing a fact never deletes it. `closed_at` is clamped to
// assigned_at so CK_TaskAnalytics_CompletedAt holds even if the two clocks disagree.
const CLOSE_PENDING_FACTS = (status, where) => `
    UPDATE ta
    SET success_status = '${status}',
        completed_at = c.closed_at,
        completion_time_hours = ${status === 'completed'
            ? 'CAST(DATEDIFF(SECOND, ta.assigned_at, c.closed_at) / 3600.0 AS DECIMAL(10,2))'
            : 'NULL'}
    FROM dbo.TaskAnalytics ta
    CROSS APPLY (SELECT CASE WHEN GETDATE() < ta.assigned_at THEN ta.assigned_at ELSE GETDATE() END AS closed_at) c
    WHERE ta.success_status = 'pending' AND ${where}`;

// GitHub branch links that the Tasks delete is about to cascade away, read first so the branch
// can be cleaned up after the commit. Only a branch of the repository the group is linked to
// right now counts (same rule as github.model findTaskByBranch). UPDLOCK, HOLDLOCK keeps a
// branch linked concurrently from slipping in before the cascade: its insert waits, then fails
// on the FK and createTaskBranch removes the ref it made.
const readLinkedBranches = async (tx, where, params) => {
    const rows = await tx.read(
        `SELECT tb.tid, t.gid, tb.repo_id, tb.branch_name, tb.base_sha, i.account_login AS owner, r.name AS repo_name
         FROM dbo.TaskBranches tb WITH (UPDLOCK, HOLDLOCK)
         INNER JOIN dbo.Tasks t ON t.tid = tb.tid
         INNER JOIN dbo.GroupRepositories gr ON gr.gid = t.gid AND gr.repo_id = tb.repo_id
         INNER JOIN dbo.GitHubRepositories r ON r.repo_id = tb.repo_id
         INNER JOIN dbo.GitHubInstallations i ON i.installation_id = r.installation_id
         WHERE ${where}
         ORDER BY tb.created_at, tb.tid`,
        params
    );
    return rows.map(r => ({
        tid: r.tid,
        gid: r.gid,
        repoId: Number(r.repo_id),
        owner: r.owner,
        repoName: r.repo_name,
        branchName: r.branch_name,
        baseSha: r.base_sha,
    }));
};

/**
 * completeTask(tid, {tx, source: 'manual' | 'github_pr'})
 *   → {status: 'completed' | 'already_completed' | 'not_found', task?, branch?}
 * Keeps the "move to Complete" semantics in one transaction: the Tasks row is locked
 * (UPDLOCK, HOLDLOCK) so two concurrent completions serialize and the loser sees
 * 'already_completed'. Complete gets percentage 100, pending TaskAnalytics facts become
 * 'completed', UserTask rows go away and TaskBranches is removed by the FK cascade.
 * branch (only with 'completed'): the removed link {tid, gid, repoId, owner, repoName,
 * branchName, baseSha}, or null when the task had no branch in the group's linked repository.
 */
const completeTask = async (tid, options = {}) => {
    const { source = 'manual' } = options;
    if (!['manual', 'github_pr'].includes(source)) {
        throw new TypeError(`completeTask: invalid source "${source}"`);
    }
    return useTransaction(options, async (tx) => {
        const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
        const rows = await tx.read(
            `SELECT tid, gid, name, description, list, CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr, percentage
             FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE tid = @tid`,
            params
        );
        if (rows.length === 0) {
            const done = await tx.read('SELECT tid FROM dbo.Complete WHERE tid = @tid', params);
            return { status: done.length > 0 ? 'already_completed' : 'not_found' };
        }

        // A Complete row can already exist from the old two-request flow; refresh it instead of failing.
        await tx.write(
            `UPDATE c SET gid = t.gid, name = t.name, description = t.description, percentage = 100, datetime = t.datetime
             FROM dbo.Complete c INNER JOIN dbo.Tasks t ON t.tid = c.tid
             WHERE c.tid = @tid;
             INSERT INTO dbo.Complete (tid, gid, name, description, percentage, datetime)
             SELECT t.tid, t.gid, t.name, t.description, 100, t.datetime
             FROM dbo.Tasks t
             WHERE t.tid = @tid AND NOT EXISTS (SELECT 1 FROM dbo.Complete c WHERE c.tid = @tid)`,
            params
        );
        await tx.write(CLOSE_PENDING_FACTS('completed', 'ta.tid = @tid'), params);
        await tx.write('DELETE FROM dbo.UserTask WHERE tid = @tid', params);
        const [branch = null] = await readLinkedBranches(tx, 'tb.tid = @tid', params);
        await tx.write('DELETE FROM dbo.Tasks WHERE tid = @tid', params);

        return { status: 'completed', task: { ...rows[0], percentage: 100 }, branch };
    });
};

/**
 * trashTask(tid, {tx}) → {status: 'deleted' | 'not_found', task?, branch?}
 * The UI's "delete" (copy into DeleteTask, then remove the task) as one transaction: the task is
 * locked, archived in DeleteTask (refreshing a row left by the old two-request flow), its
 * pending analytics facts marked 'failed', its assignments removed and the Tasks row deleted
 * (TaskBranches goes by cascade; `branch` is the removed link, as in completeTask).
 */
const trashTask = async (tid, options = {}) => useTransaction(options, async (tx) => {
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    const rows = await tx.read(
        `SELECT tid, gid, name, description, list, CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr, percentage
         FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE tid = @tid`,
        params
    );
    if (rows.length === 0) return { status: 'not_found' };

    await tx.write(
        `UPDATE d SET gid = t.gid, name = t.name, description = t.description, datetime = t.datetime,
                      percentage = ISNULL(t.percentage, 0)
         FROM dbo.DeleteTask d INNER JOIN dbo.Tasks t ON t.tid = d.tid
         WHERE d.tid = @tid;
         INSERT INTO dbo.DeleteTask (tid, gid, name, description, datetime, percentage)
         SELECT t.tid, t.gid, t.name, t.description, t.datetime, ISNULL(t.percentage, 0)
         FROM dbo.Tasks t
         WHERE t.tid = @tid AND NOT EXISTS (SELECT 1 FROM dbo.DeleteTask d WHERE d.tid = @tid)`,
        params
    );
    await tx.write(CLOSE_PENDING_FACTS('failed', 'ta.tid = @tid'), params);
    await tx.write('DELETE FROM dbo.UserTask WHERE tid = @tid', params);
    const [branch = null] = await readLinkedBranches(tx, 'tb.tid = @tid', params);
    await tx.write('DELETE FROM dbo.Tasks WHERE tid = @tid', params);

    return { status: 'deleted', task: rows[0], branch };
});

const getTask = async (tid) => {
    // Devuelve la fecha/hora como string exacto desde SQL (YYYY-MM-DD HH:mm)
    const query = `SELECT tid, gid, name, description, list, CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr, percentage FROM dbo.Tasks WHERE tid=@tid`;
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    return execReadCommand(query, params);
};

const getTasksByGroupId = async (gid) => {
    // Devuelve la fecha/hora como string exacto desde SQL (YYYY-MM-DD HH:mm)
    const query = `SELECT tid, gid, name, description, list, CONVERT(VARCHAR(16), datetime, 120) AS datetimeStr, percentage FROM dbo.Tasks WHERE gid=@gid`;
    const params = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    return execReadCommand(query, params);
};

// Same cleanup as trashTask (without the DeleteTask copy) for every task of a list; the range lock keeps new tasks from
// slipping into the list between statements. → {rowCount: tasks deleted, branches: the removed branch links (see completeTask)}
const deleteTasksByList = async (gid, list, options = {}) => useTransaction(options, async (tx) => {
    const params = [
        { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
        { name: 'list', type: TYPES.NVarChar, value: list },
    ];
    await tx.read('SELECT tid FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE gid = @gid AND list = @list', params);
    await tx.write(
        CLOSE_PENDING_FACTS('failed', 'ta.tid IN (SELECT tid FROM dbo.Tasks WHERE gid = @gid AND list = @list)'),
        params
    );
    await tx.write(
        `DELETE ut FROM dbo.UserTask ut INNER JOIN dbo.Tasks t ON t.tid = ut.tid
         WHERE t.gid = @gid AND t.list = @list`,
        params
    );
    const branches = await readLinkedBranches(tx, 't.gid = @gid AND t.list = @list', params);
    const rowCount = await tx.write('DELETE FROM dbo.Tasks WHERE gid = @gid AND list = @list', params);
    return { rowCount, branches };
});

module.exports = {
    addTask,
    updateTask,
    updateTaskFromNode,
    completeTask,
    trashTask,
    getTask,
    getTasksByGroupId,
    deleteTasksByList,
};