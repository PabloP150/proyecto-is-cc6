const { AppError, isAppError } = require('../../helpers/errors');
const githubModel = require('../../models/github.model');
const tasksModel = require('../../models/tasks.model');
const { githubApp, PERMISSIONS } = require('./githubApp');
const { buildBranchName } = require('./branchName');
const { getConnectedRepo, getRepoMeta, repoAuth, repoPath, scope } = require('./repoService');

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

// ---------------------------------------------------------------- cleanup when a task leaves the board

// Total time an HTTP handler waits for the cleanups before answering; they keep running after it.
const CLEANUP_WAIT_MS = 5 * 1000;
// Branches of one list checked at the same time: GitHub penalizes bursts of concurrent requests.
const CLEANUP_CONCURRENCY = 3;
// Worst case per branch: repository, branch ref, compare, open PRs from it and into it, delete.
const CLEANUP_REQUESTS = 6;
// Requests a cleanup never touches, left for the explorer, the sync and other users of the same
// installation (same reserve as syncService's BUDGET_RESERVE).
const CLEANUP_BUDGET_RESERVE = 20;
const SHA_RE = /^[0-9a-f]{40}$/i;

// No URL once the branch is gone from GitHub.
const cleanupResult = (repo, name, outcome) => ({
    name,
    outcome,
    url: outcome !== 'deleted' && outcome !== 'missing' && repo && repo.owner && repo.name ? branchUrl(repo, name) : null,
});

// The repository the branch lived in when the task left the board.
const linkRepo = (link) => ({ owner: link.owner, name: link.repoName });

const errorCode = (err) => (isAppError(err) ? err.code : (err && err.name) || 'Error');

const logCleanup = (link, result, when = '') =>
    console.log(`GitHub branch cleanup of ${result.name} (task ${link.tid})${when}: ${result.outcome}`);

const nonEmpty = (value) => typeof value === 'string' && value !== '';

// The repository as GitHub sees it now (renames are followed by GitHub's redirect). The stored
// owner login and default branch are refreshed only by some webhooks and the sync: a stale login
// makes the open-PR filter silently match nothing, a stale default branch compares the wrong base.
const liveRepo = async (repo) => {
    const meta = await getRepoMeta(repo);
    const owner = meta.owner && meta.owner.login;
    if (Number(meta.id) !== Number(repo.repoId) || !nonEmpty(owner) || !nonEmpty(meta.name) || !nonEmpty(meta.default_branch)) {
        throw new AppError('GITHUB_ERROR', 'GitHub returned another repository or an incomplete one', 502);
    }
    return { ...repo, owner, name: meta.name, defaultBranch: meta.default_branch };
};

// Number of open PRs matching `filter` (at most 1 is asked for).
const countOpenPulls = async (auth, repo, filter) => {
    const { data } = await githubApp.request(auth, 'GET', `${repoPath(repo)}/pulls`, {
        ...scope(repo, PERMISSIONS.pulls),
        query: { ...filter, state: 'open', per_page: 1 },
    });
    if (!Array.isArray(data)) throw new AppError('GITHUB_ERROR', 'GitHub returned no pull request list', 502);
    return data.length;
};

/**
 * cleanupTaskBranch(link, {mergedHeadSha}) → {name, outcome, url}; never rejects.
 * link: the TaskBranches row the task had when it left the board, as tasks.model completeTask /
 * trashTask / deleteTasksByList read it (already limited to the group's linked repository).
 * The branch is deleted only when all of these hold:
 *   a) the group is still linked to that repository (same id on GitHub) and the name is not its
 *      default branch;
 *   b) every commit of the branch is in the default branch (compare ahead_by === 0), or the branch
 *      head is still the head of the PR that was just merged into it (mergedHeadSha: squash and
 *      rebase merges leave ahead_by > 0);
 *   c) no open pull request uses the branch, as head (any base) or as base: GitHub closes both
 *      kinds when the branch goes.
 * A check that cannot be completed (GitHub error, request budget, timeout) leaves it ('error').
 * outcome: 'deleted' | 'kept_unmerged' | 'kept_open_pr' | 'missing' | 'skipped' | 'error'.
 */
const cleanupTaskBranch = async (link, { mergedHeadSha = null } = {}) => {
    const name = link && link.branchName;
    let repo = link ? linkRepo(link) : null;
    const done = (outcome) => cleanupResult(repo, name, outcome);
    try {
        if (!name) return done('skipped');
        const current = await githubModel.getGroupRepository(link.gid);
        if (!current || Number(current.repoId) !== Number(link.repoId)) return done('skipped');
        repo = current;
        if (current.suspendedAt || name === current.defaultBranch) return done('skipped');
        // Better to skip up front than to run the checks and then lack the request for the delete.
        if (githubApp.availableBudget(current.installationId) < CLEANUP_REQUESTS + CLEANUP_BUDGET_RESERVE) {
            throw new AppError('GITHUB_RATE_LIMITED', 'GitHub request budget exhausted', 503);
        }

        const auth = repoAuth(current);
        repo = await liveRepo(current);
        if (name === repo.defaultBranch) return done('skipped');
        const path = repoPath(repo);
        const ref = encodeRef(name);

        // Resolved as refs/heads/<name> (a bare name would resolve a tag of the same name first);
        // this is the only 404 that means the branch is gone.
        const head = await githubApp.request(auth, 'GET', `${path}/git/ref/heads/${ref}`, { ...scope(repo), allowStatus: [404] });
        if (head.status === 404) return done('missing');
        const sha = head.data && head.data.object && head.data.object.sha;
        if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new AppError('GITHUB_ERROR', 'GitHub returned no commit for the branch', 502);

        // Compared by sha, so rule b judges the very commit the merged-head check looks at. The
        // branch exists: a 404 here (no shared history, default branch renamed meanwhile) is a
        // check that could not be completed, not a missing branch.
        const compare = await githubApp.request(auth, 'GET', `${path}/compare/${encodeRef(repo.defaultBranch)}...${sha}`, {
            ...scope(repo),
            query: { per_page: 1 },
            allowStatus: [404],
        });
        if (compare.status === 404) throw new AppError('GITHUB_ERROR', 'GitHub could not compare the branch with the default branch', 502);
        const aheadBy = compare.data && compare.data.ahead_by;
        if (!Number.isInteger(aheadBy)) throw new AppError('GITHUB_ERROR', 'GitHub compare returned no ahead_by', 502);
        const merged = aheadBy === 0
            || (typeof mergedHeadSha === 'string' && SHA_RE.test(mergedHeadSha) && sha.toLowerCase() === mergedHeadSha.toLowerCase());

        const [fromBranch, intoBranch] = await Promise.all([
            countOpenPulls(auth, repo, { head: `${repo.owner}:${name}` }),
            countOpenPulls(auth, repo, { base: name }),
        ]);
        if (fromBranch + intoBranch > 0) return done('kept_open_pr');
        if (!merged) return done('kept_unmerged');

        // Known race: a push that lands between the checks above and this DELETE is deleted with
        // the branch. GitHub has no conditional ref delete ("only if the head is still X"), so the
        // window cannot be closed from here; it is as short as the checks.
        const deleted = await githubApp.request(auth, 'DELETE', `${path}/git/refs/heads/${ref}`, {
            ...scope(repo, PERMISSIONS.writeRefs),
            allowStatus: [404, 422],
        });
        const message = deleted.data && typeof deleted.data.message === 'string' ? deleted.data.message : '';
        // GitHub answers a missing ref with 422 "Reference does not exist".
        if (deleted.status === 404 || (deleted.status === 422 && /does not exist/i.test(message))) return done('missing');
        if (deleted.status === 422) throw new AppError('GITHUB_ERROR', 'GitHub refused to delete the branch', 502);
        return done('deleted');
    } catch (err) {
        if (isAppError(err) && err.code === 'GITHUB_NOT_CONFIGURED') return done('skipped');
        console.warn(`GitHub branch cleanup of ${name} failed (${errorCode(err)}); the branch was left in place`);
        return done('error');
    }
};

// One promise per link; link i starts when link i - concurrency has finished.
const startCleanups = (links, concurrency) => {
    const runs = [];
    links.forEach((link, i) => {
        const previous = i >= concurrency ? runs[i - concurrency] : Promise.resolve();
        runs.push(previous.then(() => cleanupTaskBranch(link)));
    });
    return runs;
};

/**
 * cleanupBranchesWithin(links, {waitMs}) → [{name, outcome, url}] in the order of `links`; never rejects.
 * For HTTP handlers, after the task change committed: waits at most `waitMs` in total. A cleanup
 * still running by then is answered as 'error' (as far as the caller can tell the branch is still
 * there) and goes on in the background, where only its final outcome is logged.
 */
const cleanupBranchesWithin = async (links, { waitMs = CLEANUP_WAIT_MS } = {}) => {
    const pending = (links || []).filter((link) => link && link.branchName);
    if (pending.length === 0) return [];
    const results = new Array(pending.length).fill(null);
    const runs = startCleanups(pending, CLEANUP_CONCURRENCY).map((run, i) => run.then((result) => {
        results[i] = result;
        return result;
    }));
    let timer;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(resolve, waitMs);
        if (timer.unref) timer.unref();
    });
    await Promise.race([Promise.all(runs), deadline]);
    clearTimeout(timer);
    return pending.map((link, i) => {
        if (results[i]) return results[i];
        runs[i].then((late) => logCleanup(link, late, ' after the response'));
        return cleanupResult(linkRepo(link), link.branchName, 'error');
    });
};

// For completions nobody waits for (merged-PR webhook, sync): runs after the commit and only logs.
const cleanupTaskBranchInBackground = (link, options = {}) => {
    if (!link || !link.branchName) return;
    cleanupTaskBranch(link, options).then((result) => logCleanup(link, result));
};

module.exports = {
    createTaskBranch,
    branchUrl,
    cleanupTaskBranch,
    cleanupBranchesWithin,
    cleanupTaskBranchInBackground,
    CLEANUP_WAIT_MS,
};
