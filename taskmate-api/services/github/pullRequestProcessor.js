const githubModel = require('../../models/github.model');
const tasksModel = require('../../models/tasks.model');
const AnalyticsIntegration = require('../AnalyticsIntegration');
const branchService = require('./branchService');

const MAX_TITLE = 256;

// PRs whose head lives in another repository (forks, or a deleted fork: head.repo === null)
// never complete tasks: anyone can open them.
const isForkPullRequest = (pr, repoId) =>
    !pr || !pr.head || !pr.head.repo || Number(pr.head.repo.id) !== Number(repoId);

const toPullRequestRecord = (pr, repoId) => ({
    prId: Number(pr.id),
    repoId: Number(repoId),
    number: Number(pr.number),
    headBranch: String(pr.head.ref),
    baseBranch: String(pr.base.ref),
    title: String(pr.title || '').slice(0, MAX_TITLE),
    isDraft: Boolean(pr.draft),
    openedAt: pr.created_at || null,
    closedAt: pr.closed_at || pr.merged_at || null,
    mergedAt: pr.merged_at || null,
    ghUpdatedAt: pr.updated_at || pr.created_at || null,
});

// Must run inside a transaction: the PR row and the task completion commit together.
// completion.branch is the task's branch link (for the cleanup after the commit) and
// mergedHeadSha the merged PR's head, which only vouches for that same branch.
const applyPullRequestInTx = async (pr, { repoId, defaultBranch }, { tx }) => {
    const record = toPullRequestRecord(pr, repoId);
    const applied = await githubModel.applyPullRequest(record, { tx });
    let completion = null;
    if (applied && applied.becameMerged && defaultBranch && record.baseBranch === defaultBranch) {
        const link = await githubModel.findTaskByBranch(record.repoId, record.headBranch, { tx });
        if (link) {
            const result = await tasksModel.completeTask(link.tid, { tx, source: 'github_pr' });
            const branch = (result && result.branch) || null;
            completion = {
                tid: link.tid,
                gid: link.gid,
                status: result && result.status,
                branch,
                mergedHeadSha: branch && branch.branchName === record.headBranch ? pr.head.sha || null : null,
            };
        }
    }
    return { state: applied && applied.state, changed: Boolean(applied && applied.changed), completion };
};

// Call only after the transaction committed. Same analytics hook as POST /api/tasks/:tid/complete,
// then the task's branch cleanup in the background: the webhook answer and the sync result never
// wait for GitHub (branchService logs the outcome).
const notifyCompletion = (completion) => {
    if (!completion || completion.status !== 'completed') return;
    Promise.resolve()
        .then(() => AnalyticsIntegration.onTaskCompletion(completion.tid, true, { percentage: 100 }))
        .catch((error) => console.error('Analytics tracking failed for task completion:', error && error.message));
    if (completion.branch) {
        branchService.cleanupTaskBranchInBackground(completion.branch, { mergedHeadSha: completion.mergedHeadSha });
    }
};

module.exports = { isForkPullRequest, toPullRequestRecord, applyPullRequestInTx, notifyCompletion };
