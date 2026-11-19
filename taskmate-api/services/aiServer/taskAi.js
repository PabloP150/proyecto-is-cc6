// AI server commands over a task's branch: the diff comes from GitHub (compare API), so the AI
// server needs no checkout of the group's repository.
const { AppError } = require('../../helpers/errors');
const githubModelDefault = require('../../models/github.model');
const repoServiceDefault = require('../github/repoService');
const { aiServer: aiServerDefault } = require('./client');

const sameTid = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const createTaskAi = ({ githubModel = githubModelDefault, repoService = repoServiceDefault, aiServer = aiServerDefault } = {}) => {
    // The task's branch diff against the base its PR targets (or the default branch).
    const taskDiff = async ({ gid, tid }) => {
        const links = await githubModel.getTaskLinksByGroup(gid);
        const link = links.find((item) => sameTid(item.tid, tid));
        if (!link || !link.branchName) throw new AppError('TASK_NO_BRANCH', 'This task has no branch yet.', 409);
        const repo = await repoService.getConnectedRepo(gid);
        // Same consent gate as the repo analysis and the AI pipeline proposal: the admin decides.
        if (repo.aiAnalysisEnabled !== true) throw new AppError('AI_ANALYSIS_DISABLED', 'AI analysis is disabled for this group', 409);
        const base = (link.pr && link.pr.baseBranch) || repo.defaultBranch;
        const head = link.branchName;
        const { files } = await repoService.getComparePatches(repo, base, head);
        if (files.length === 0) throw new AppError('NOTHING_TO_REVIEW', 'The task branch has no changes yet.', 409);
        return { repo, base, head, files };
    };

    const auditTask = async ({ gid, tid }) => {
        const { repo, base, head, files } = await taskDiff({ gid, tid });
        const out = await aiServer.runCommand('audit', { files, base, head, repo: `${repo.owner}/${repo.name}` });
        return { runId: out.run_id, ...out.result };
    };

    return { taskDiff, auditTask };
};

module.exports = { createTaskAi, taskAi: createTaskAi() };
