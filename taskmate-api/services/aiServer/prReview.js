// AI review of a task's pull request: AI server `review-pr` on the PR diff, stored in dbo.AiReviews
// and posted to GitHub as a COMMENT review (never approve / request changes) when the App may.
const { AppError } = require('../../helpers/errors');
const aiReviewModelDefault = require('../../models/aiReview.model');
const githubModelDefault = require('../../models/github.model');
const repoServiceDefault = require('../github/repoService');
const { githubApp: githubAppDefault, PERMISSIONS } = require('../github/githubApp');
const { aiServer: aiServerDefault } = require('./client');

const SHA_RE = /^[0-9a-f]{40}$/i;
const REVIEW_ACTIONS = new Set(['opened', 'synchronize', 'ready_for_review', 'reopened']);

const createPrReview = ({
    aiReviewModel = aiReviewModelDefault,
    repoService = repoServiceDefault,
    githubApp = githubAppDefault,
    aiServer = aiServerDefault,
    githubModel = githubModelDefault,
} = {}) => {
    const post = async (repo, prNumber, headSha, result) => {
        const send = (comments) => githubApp.request(repoService.repoAuth(repo), 'POST',
            `${repoService.repoPath(repo)}/pulls/${prNumber}/reviews`, {
                ...repoService.scope(repo, PERMISSIONS.pullsWrite),
                body: {
                    commit_id: headSha,
                    event: 'COMMENT',
                    body: result.body,
                    comments: comments.map((c) => ({ path: c.path, line: c.line, side: 'RIGHT', body: c.body })),
                },
            });
        try {
            let res;
            try {
                res = await send(result.comments || []);
            } catch (err) {
                // 422: an inline comment on a line GitHub does not consider part of the diff.
                if (!(err && err.githubStatus === 422) || !(result.comments || []).length) throw err;
                res = await send([]);
            }
            return { posted: 'posted', reviewUrl: (res && res.data && res.data.html_url) || null };
        } catch (err) {
            if (err && err.code === 'APP_PERMISSIONS_MISSING') return { posted: 'no_permission', reviewUrl: null };
            console.warn(`AI review not posted on PR #${prNumber}: ${err && err.code}`);
            return { posted: 'failed', reviewUrl: null };
        }
    };

    /**
     * Review one PR head commit. Returns null when that commit was already reviewed or is being
     * reviewed; a review that failed is claimed again and retried.
     */
    const reviewPullRequest = async ({ repo, tid, pr }) => {
        const headSha = String(pr.headSha || '');
        if (!SHA_RE.test(headSha)) return null;
        // Checked before claiming: without a configured server the attempt would only leave a
        // 'failed' row behind (the manual «Review PR» path reaches here without this check).
        if (!aiServer.enabled()) {
            throw new AppError('AI_SERVER_DISABLED', 'The AI server is not configured (AI_SERVER_URL).', 503);
        }
        const id = await aiReviewModel.claim({ tid, prNumber: pr.number, headSha });
        if (id === null) return null;

        try {
            const { files } = await repoService.getComparePatches(repo, pr.baseBranch, headSha);
            const out = await aiServer.runCommand('review-pr', {
                files, base: pr.baseBranch, head: pr.headBranch,
                title: String(pr.title || '').slice(0, 300), body: String(pr.body || '').slice(0, 5000),
            });
            const result = out.result || {};
            const { posted, reviewUrl } = await post(repo, pr.number, headSha, result);
            await aiReviewModel.finish(id, { status: 'done', verdict: result.verdict || null, posted, reviewUrl, result });
            return { id, verdict: result.verdict, posted, reviewUrl };
        } catch (err) {
            await aiReviewModel.finish(id, { status: 'failed', errorCode: (err && err.code) || 'ERROR' });
            throw err;
        }
    };

    // Webhook path: never blocks the webhook answer; the outcome is logged and stored.
    const reviewInBackground = (args) => {
        Promise.resolve()
            .then(() => reviewPullRequest(args))
            .catch((err) => console.warn(`AI review failed for task ${args && args.tid}: ${err && (err.code || err.message)}`));
    };

    /**
     * Webhook entry: review an open, non-draft task PR when the group allows AI analysis.
     * Resolves quickly; the review itself runs in the background.
     */
    const onPullRequestEvent = async (action, pr, repository) => {
        if (!REVIEW_ACTIONS.has(action) || !aiServer.enabled()) return false;
        if (!pr || pr.state !== 'open' || pr.draft || !pr.head || !pr.base) return false;
        const link = await githubModel.findTaskByBranch(Number(repository.id), String(pr.head.ref));
        if (!link) return false; // only task branches (tm/...) are reviewed
        const repo = await repoService.getConnectedRepo(link.gid);
        if (repo.aiAnalysisEnabled !== true || Number(repo.repoId) !== Number(repository.id)) return false;
        reviewInBackground({
            repo,
            tid: link.tid,
            pr: {
                number: pr.number, headSha: pr.head.sha, baseBranch: pr.base.ref, headBranch: pr.head.ref,
                title: pr.title, body: pr.body,
            },
        });
        return true;
    };

    return { reviewPullRequest, reviewInBackground, onPullRequestEvent, REVIEW_ACTIONS };
};

module.exports = { createPrReview, prReview: createPrReview(), REVIEW_ACTIONS };
