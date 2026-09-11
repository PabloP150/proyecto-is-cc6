const githubModel = require('../../models/github.model');
const tasksModel = require('../../models/tasks.model');
const AnalyticsIntegration = require('../AnalyticsIntegration');

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
const applyPullRequestInTx = async (pr, { repoId, defaultBranch }, { tx }) => {
    const record = toPullRequestRecord(pr, repoId);
    const applied = await githubModel.applyPullRequest(record, { tx });
    let completion = null;
    if (applied && applied.becameMerged && defaultBranch && record.baseBranch === defaultBranch) {
        const link = await githubModel.findTaskByBranch(record.repoId, record.headBranch, { tx });
        if (link) {
            completion = await tasksModel.completeTask(link.tid, { tx, source: 'github_pr' });
            completion = { tid: link.tid, gid: link.gid, status: completion && completion.status };
        }
    }
    return { state: applied && applied.state, changed: Boolean(applied && applied.changed), completion };
};

// Same hook as POST /api/tasks/:tid/complete; call only after the transaction committed.
const notifyCompletion = (completion) => {
    if (!completion || completion.status !== 'completed') return;
    Promise.resolve()
        .then(() => AnalyticsIntegration.onTaskCompletion(completion.tid, true, { percentage: 100 }))
        .catch((error) => console.error('Analytics tracking failed for task completion:', error && error.message));
};

module.exports = { isForkPullRequest, toPullRequestRecord, applyPullRequestInTx, notifyCompletion };
