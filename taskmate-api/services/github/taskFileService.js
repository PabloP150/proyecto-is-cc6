const githubModel = require('../../models/github.model');
const repoService = require('./repoService');

/**
 * Record which files a task touched, from the pull request on its branch.
 *
 * Called after a PR merges (so a completed task keeps its file list even once the branch is
 * deleted) and on demand when the task view is opened for a task that has no list yet.
 *
 * Never throws: the file list is supporting detail, so a GitHub failure must not break task
 * completion or the task view. The outcome is returned instead.
 */
const recordFilesForTask = async ({ tid, repo, prNumber, headSha = null }) => {
    if (!tid || !repo || !prNumber) return { recorded: false, reason: 'missing task, repo or pull request' };

    try {
        const files = await repoService.getPullRequestFiles(repo, prNumber);
        const count = await githubModel.replaceTaskFiles(tid, files, { prNumber, headSha });
        return { recorded: true, count };
    } catch (err) {
        return { recorded: false, reason: String((err && err.message) || err).slice(0, 200) };
    }
};

// Fire-and-forget variant for the webhook path: the webhook answer must not wait on GitHub.
// Mirrors branchService.cleanupTaskBranchInBackground.
const recordFilesInBackground = (args) => {
    Promise.resolve()
        .then(() => recordFilesForTask(args))
        .then((result) => {
            if (!result.recorded) {
                console.warn(`Task file list not recorded for ${args && args.tid}: ${result.reason}`);
            }
        })
        .catch((err) => console.error('Task file recording failed:', err && err.message));
};

module.exports = { recordFilesForTask, recordFilesInBackground };
