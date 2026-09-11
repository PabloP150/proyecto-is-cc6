const { v4: uuidv4 } = require('uuid');
const { execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { useTransaction } = require('../helpers/transaction');
const { AppError } = require('../helpers/errors');
const { TYPES } = require('tedious');

const addUsertask = async (usertaskData) => {
    const { utid, uid, tid, completed } = usertaskData;
    // Idempotent: skip insert if (uid, tid) already exists (avoids PK violation)
    const query = `
        INSERT INTO dbo.UserTask (utid, uid, tid, completed)
        SELECT @utid, @uid, @tid, @completed
        WHERE NOT EXISTS (SELECT 1 FROM dbo.UserTask WHERE uid=@uid AND tid=@tid)
    `;
    const params = [
        { name: 'utid', type: TYPES.UniqueIdentifier, value: utid },
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'completed', type: TYPES.Bit, value: !!completed },
    ];
    return execWriteCommand(query, params);
};

// Unassigning closes the user's pending analytics fact as 'reassigned' so it stops counting
// as current workload. Returns the number of UserTask rows deleted.
const deleteUsertask = async (uid, tid, options = {}) => useTransaction(options, async (tx) => {
    const params = [
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
    ];
    const deleted = await tx.write('DELETE FROM dbo.UserTask WHERE uid=@uid AND tid=@tid', params);
    if (deleted > 0) {
        await tx.write(
            `UPDATE dbo.TaskAnalytics
             SET success_status = 'reassigned',
                 completed_at = CASE WHEN GETDATE() < assigned_at THEN assigned_at ELSE GETDATE() END
             WHERE uid = @uid AND tid = @tid AND success_status = 'pending'`,
            params
        );
    }
    return deleted;
});

const getUsertasksByTid = async (tid) => {
    const query = `SELECT utid, uid, tid, completed FROM dbo.UserTask WHERE tid=@tid`;
    const params = [{ name: 'tid', type: TYPES.UniqueIdentifier, value: tid }];
    return execReadCommand(query, params);
};

const getutid = async (tid, uid) => {
    const query = `SELECT utid FROM dbo.UserTask WHERE tid=@tid AND uid=@uid`;
    const params = [
        { name: 'tid', type: TYPES.UniqueIdentifier, value: tid },
        { name: 'uid', type: TYPES.UniqueIdentifier, value: uid },
    ];
    return execReadCommand(query, params);
};

/**
 * populateAssignmentsForGroup(gid) → {assigned, group, members, totalTasks}
 * Demo-data utility (formerly inline in server.js /api/utils/populate-assignments): every task
 * of the group without an assignee goes to a random member, with a UserTask row and a
 * TaskAnalytics fact (tasks at 100% get a completed fact with a synthetic duration).
 * All-or-nothing; the group row is locked so two concurrent calls cannot double-assign.
 * Throws AppError NOT_FOUND (404) when the group does not exist.
 */
const populateAssignmentsForGroup = async (gid, options = {}) => useTransaction(options, async (tx) => {
    const gidParam = [{ name: 'gid', type: TYPES.UniqueIdentifier, value: gid }];
    const groups = await tx.read('SELECT gid, name FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE gid = @gid', gidParam);
    if (groups.length === 0) throw new AppError('NOT_FOUND', 'Group not found', 404);

    const members = await tx.read(
        `SELECT u.uid, u.username FROM dbo.Users u
         INNER JOIN dbo.UserGroups ug ON ug.uid = u.uid
         WHERE ug.gid = @gid`,
        gidParam
    );
    const unassigned = await tx.read(
        `SELECT t.tid, t.percentage FROM dbo.Tasks t
         WHERE t.gid = @gid AND NOT EXISTS (SELECT 1 FROM dbo.UserTask ut WHERE ut.tid = t.tid)`,
        gidParam
    );

    let assigned = 0;
    if (members.length > 0) {
        await Promise.all(unassigned.map(async (task) => {
            const member = members[Math.floor(Math.random() * members.length)];
            const isCompleted = task.percentage >= 100;
            const params = [
                { name: 'utid', type: TYPES.UniqueIdentifier, value: uuidv4() },
                { name: 'id', type: TYPES.UniqueIdentifier, value: uuidv4() },
                { name: 'uid', type: TYPES.UniqueIdentifier, value: member.uid },
                { name: 'tid', type: TYPES.UniqueIdentifier, value: task.tid },
                { name: 'gid', type: TYPES.UniqueIdentifier, value: gid },
                { name: 'completed', type: TYPES.Bit, value: isCompleted },
                { name: 'status', type: TYPES.VarChar, value: isCompleted ? 'completed' : 'pending' },
                // Synthetic history, as before: completion up to 24 h after assignment, 1–9 h of work.
                { name: 'completedAfterSec', type: TYPES.Int, value: isCompleted ? Math.floor(Math.random() * 86400) : null },
                { name: 'hours', type: TYPES.Decimal, value: isCompleted ? Math.random() * 8 + 1 : null, options: { precision: 10, scale: 2 } },
            ];
            await tx.write(
                `INSERT INTO dbo.UserTask (utid, uid, tid, completed) VALUES (@utid, @uid, @tid, @completed);
                 DECLARE @now DATETIME2 = GETDATE();
                 INSERT INTO dbo.TaskAnalytics
                     (id, tid, uid, gid, task_category, assigned_at, completed_at, success_status, completion_time_hours)
                 VALUES (@id, @tid, @uid, @gid, 'general', @now,
                         CASE WHEN @completedAfterSec IS NULL THEN NULL ELSE DATEADD(SECOND, @completedAfterSec, @now) END,
                         @status, @hours)`,
                params
            );
            assigned++;
        }));
    }

    return { assigned, group: groups[0].name, members: members.length, totalTasks: unassigned.length };
});

module.exports = {
    addUsertask,
    deleteUsertask,
    getUsertasksByTid,
    getutid,
    populateAssignmentsForGroup,
};
