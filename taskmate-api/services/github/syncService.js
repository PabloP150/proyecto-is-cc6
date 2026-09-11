const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const { githubApp, PERMISSIONS } = require('./githubApp');
const { getConnectedRepo, repoAuth, repoPath, scope, getRepoMeta } = require('./repoService');
const { isForkPullRequest, applyPullRequestInTx, notifyCompletion } = require('./pullRequestProcessor');

const MAX_BRANCHES = 30;
const MAX_PRS_PER_BRANCH = 10;
// Requests left untouched for the explorer and other users of the same installation.
const BUDGET_RESERVE = 20;

// Branches whose PR can still change first (no PR yet, or open); closed ones last.
const byPriority = (a, b) => {
    const rank = (link) => (!link.pr || link.pr.state === 'open' ? 0 : 1);
    return rank(a) - rank(b);
};

// Reconciles what webhooks may have missed (GitHub does not retry failed deliveries).
const syncGroup = async (gid) => {
    let repo = await getConnectedRepo(gid);
    const repoId = Number(repo.repoId);

    const meta = await getRepoMeta(repo);
    if (meta && meta.default_branch && (meta.default_branch !== repo.defaultBranch || meta.name !== repo.name)) {
        await githubModel.upsertRepository({
            repoId,
            installationId: Number(repo.installationId),
            name: String(meta.name || repo.name),
            defaultBranch: String(meta.default_branch),
            isPrivate: Boolean(meta.private),
        });
        repo = { ...repo, name: meta.name || repo.name, defaultBranch: meta.default_branch };
    }

    const affordable = Math.max(0, githubApp.availableBudget(repo.installationId) - BUDGET_RESERVE);
    const links = ((await githubModel.getTaskLinksByGroup(gid)) || [])
        .filter((link) => link && link.branchName)
        .sort(byPriority)
        .slice(0, Math.min(MAX_BRANCHES, affordable));

    let branchesChecked = 0;
    let pullRequestsFound = 0;
    let updated = 0;
    for (const link of links) {
        const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/pulls`, {
            ...scope(repo, PERMISSIONS.pulls),
            query: { state: 'all', head: `${repo.owner}:${link.branchName}`, per_page: MAX_PRS_PER_BRANCH },
        });
        branchesChecked += 1;
        const pulls = (Array.isArray(data) ? data : []).filter((pr) => pr && pr.head && pr.base && !isForkPullRequest(pr, repoId));
        pullRequestsFound += pulls.length;
        for (const pr of pulls) {
            const outcome = await transaction.withTransaction((tx) =>
                applyPullRequestInTx(pr, { repoId, defaultBranch: repo.defaultBranch }, { tx }));
            notifyCompletion(outcome.completion);
            if (outcome.changed || (outcome.completion && outcome.completion.status === 'completed')) updated += 1;
        }
    }
    return { branchesChecked, pullRequestsFound, updated };
};

module.exports = { syncGroup, MAX_BRANCHES, BUDGET_RESERVE };
