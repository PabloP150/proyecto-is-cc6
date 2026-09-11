const githubModel = require('../../models/github.model');
const transaction = require('../../helpers/transaction');
const { githubApp, PERMISSIONS } = require('./githubApp');
const { getConnectedRepo, repoAuth, repoPath, scope, getRepoMeta } = require('./repoService');
const { isForkPullRequest, applyPullRequestInTx } = require('./pullRequestProcessor');

const MAX_BRANCHES = 50;
const MAX_PRS_PER_BRANCH = 10;

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

    const links = (await githubModel.getTaskLinksByGroup(gid)) || [];
    let checked = 0;
    let updated = 0;
    for (const link of links.slice(0, MAX_BRANCHES)) {
        if (!link || !link.branchName) continue;
        const { data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/pulls`, {
            ...scope(repo, PERMISSIONS.pulls),
            query: { state: 'all', head: `${repo.owner}:${link.branchName}`, per_page: MAX_PRS_PER_BRANCH },
        });
        checked += 1;
        const pulls = (Array.isArray(data) ? data : []).filter((pr) => pr && pr.head && pr.base && !isForkPullRequest(pr, repoId));
        for (const pr of pulls) {
            const outcome = await transaction.withTransaction((tx) =>
                applyPullRequestInTx(pr, { repoId, defaultBranch: repo.defaultBranch }, { tx }));
            if (outcome.changed || (outcome.completion && outcome.completion.status === 'completed')) updated += 1;
        }
    }
    return { checked, updated };
};

module.exports = { syncGroup, MAX_BRANCHES };
