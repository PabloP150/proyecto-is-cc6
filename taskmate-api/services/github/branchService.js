const { AppError } = require('../../helpers/errors');
const githubModel = require('../../models/github.model');
const tasksModel = require('../../models/tasks.model');
const { githubApp, PERMISSIONS } = require('./githubApp');
const { buildBranchName } = require('./branchName');
const { getConnectedRepo, repoAuth, repoPath, scope } = require('./repoService');

const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const encodeRef = (ref) => ref.split('/').map(encodeURIComponent).join('/');

const branchUrl = (repo, branchName) =>
    `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/tree/${encodeRef(branchName)}`;

const result = (repo, tid, branchName, baseSha, created) => ({
    tid,
    branchName,
    branchUrl: branchUrl(repo, branchName),
    baseSha,
    created,
});

const loadTask = async (tid, gid) => {
    const rows = await tasksModel.getTask(tid);
    const task = Array.isArray(rows) ? rows[0] : rows;
    if (!task || (gid && task.gid && !sameId(String(task.gid), String(gid)))) {
        throw new AppError('TASK_NOT_FOUND', 'Task not found', 404);
    }
    return task;
};

const getHeadSha = async (repo, branch) => {
    const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/git/ref/heads/${encodeRef(branch)}`, scope(repo, PERMISSIONS.writeRefs));
    const sha = data && data.object && data.object.sha;
    if (!sha) throw new AppError('GITHUB_ERROR', 'GitHub returned no commit for the branch', 502);
    return sha;
};

const deleteRef = async (repo, branchName) => {
    try {
        await githubApp.request(repoAuth(repo), 'DELETE', `${repoPath(repo)}/git/refs/heads/${encodeRef(branchName)}`, scope(repo, PERMISSIONS.writeRefs));
    } catch {
        // Best effort: the orphan ref is harmless and a retry of the request adopts it.
    }
};

// Not atomic across GitHub and the DB: create the ref, then the row; if the row fails, only a
// ref created by this very request is deleted (never an adopted one, never one a concurrent
// request already linked).
const createTaskBranch = async ({ tid, gid, uid }) => {
    const task = await loadTask(tid, gid);
    const repo = await getConnectedRepo(gid || task.gid);
    const repoId = Number(repo.repoId);

    const existing = await githubModel.getTaskBranch(tid);
    if (existing) {
        if (Number(existing.repoId) !== repoId) {
            throw new AppError('BRANCH_CONFLICT', 'The task is already linked to a branch in another repository', 409);
        }
        return { status: 200, data: result(repo, tid, existing.branchName, existing.baseSha, false) };
    }

    const branchName = buildBranchName(task.name, tid);
    const headSha = await getHeadSha(repo, repo.defaultBranch);

    const created = await githubApp.request(repoAuth(repo), 'POST', `${repoPath(repo)}/git/refs`, {
        ...scope(repo, PERMISSIONS.writeRefs),
        body: { ref: `refs/heads/${branchName}`, sha: headSha },
        allowStatus: [422],
    });

    let createdHere = true;
    let baseSha = headSha;
    if (created.status === 422) {
        const message = created.data && typeof created.data.message === 'string' ? created.data.message : '';
        if (!/already exists/i.test(message)) {
            throw new AppError('GITHUB_ERROR', 'GitHub rejected the branch', 502);
        }
        const claimedBy = await githubModel.findTaskByBranch(repoId, branchName);
        if (claimedBy) {
            throw new AppError('BRANCH_CONFLICT', 'The branch already belongs to another task', 409);
        }
        createdHere = false;
        baseSha = await getHeadSha(repo, branchName);
    }

    try {
        await githubModel.insertTaskBranch({ tid, repoId, branchName, baseSha, createdBy: uid });
    } catch (error) {
        let current = null;
        try {
            current = await githubModel.getTaskBranch(tid);
        } catch {
            current = null;
        }
        if (current && Number(current.repoId) === repoId && current.branchName === branchName) {
            return { status: 200, data: result(repo, tid, branchName, current.baseSha, false) };
        }
        if (createdHere) await deleteRef(repo, branchName);
        throw error;
    }

    return { status: createdHere ? 201 : 200, data: result(repo, tid, branchName, baseSha, createdHere) };
};

module.exports = { createTaskBranch, branchUrl };
