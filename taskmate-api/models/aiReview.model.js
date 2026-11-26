// dbo.AiReviews (migrations/011_ai_reviews.sql): AI reviews of task pull requests.
const { execQuery, execReadCommand, execWriteCommand } = require('../helpers/execQuery');
const { isUniqueViolation } = require('../helpers/transaction');
const { TYPES } = require('tedious');

const MAX_RESULT_CHARS = 200000;
// A review normally ends in a few minutes (the AI server call alone times out at 3). A 'pending'
// row older than this was left behind by a process that died mid-review and may be claimed again.
const STALE_PENDING_MINUTES = 15;
const tidParam = (tid) => ({ name: 'tid', type: TYPES.UniqueIdentifier, value: tid });

const claimParams = ({ tid, prNumber, headSha }) => [
    tidParam(tid),
    { name: 'pr', type: TYPES.Int, value: Number(prNumber) },
    { name: 'sha', type: TYPES.Char, value: headSha, options: { length: 40 } },
];

/**
 * Take back a review of (task, commit) that failed or was abandoned mid-review, resetting it to
 * 'pending'. A single conditional UPDATE, so two callers racing for the same row cannot both win.
 */
const reclaim = async (args) => {
    const { rows } = await execQuery(
        `UPDATE dbo.AiReviews
            SET status = 'pending', pr_number = @pr, verdict = NULL, posted = NULL, review_url = NULL,
                result_json = NULL, error_code = NULL, created_at = SYSDATETIMEOFFSET()
         OUTPUT INSERTED.id
          WHERE tid = @tid AND head_sha = @sha
            AND (status = 'failed'
                 OR (status = 'pending' AND created_at < DATEADD(MINUTE, -@stale, SYSDATETIMEOFFSET())))`,
        [...claimParams(args), { name: 'stale', type: TYPES.Int, value: STALE_PENDING_MINUTES }],
    );
    return rows && rows[0] ? Number(rows[0].id) : null;
};

/**
 * Reserve the review of (task, head commit). null when it is already done or in progress: nothing
 * to do. A failed review, or one abandoned as 'pending', is claimed again so it can be retried.
 */
const claim = async (args) => {
    try {
        const { rows } = await execQuery(
            `INSERT INTO dbo.AiReviews (tid, pr_number, head_sha, status)
             OUTPUT INSERTED.id VALUES (@tid, @pr, @sha, 'pending')`,
            claimParams(args),
        );
        return rows && rows[0] ? Number(rows[0].id) : null;
    } catch (err) {
        if (isUniqueViolation(err)) return reclaim(args);
        throw err;
    }
};

const finish = async (id, { status, verdict = null, posted = null, reviewUrl = null, result = null, errorCode = null }) => {
    const json = result === null ? null : JSON.stringify(result);
    await execWriteCommand(
        `UPDATE dbo.AiReviews
            SET status = @status, verdict = @verdict, posted = @posted, review_url = @url,
                result_json = @json, error_code = @err
          WHERE id = @id`,
        [
            { name: 'id', type: TYPES.BigInt, value: id },
            { name: 'status', type: TYPES.VarChar, value: status, options: { length: 12 } },
            { name: 'verdict', type: TYPES.VarChar, value: verdict, options: { length: 4 } },
            { name: 'posted', type: TYPES.VarChar, value: posted, options: { length: 14 } },
            { name: 'url', type: TYPES.NVarChar, value: reviewUrl ? String(reviewUrl).slice(0, 400) : null, options: { length: 400 } },
            { name: 'json', type: TYPES.NVarChar, value: json && json.length <= MAX_RESULT_CHARS ? json : null },
            { name: 'err', type: TYPES.VarChar, value: errorCode ? String(errorCode).slice(0, 40) : null, options: { length: 40 } },
        ],
    );
};

const getLatest = async (tid) => {
    const rows = await execReadCommand(
        `SELECT TOP 1 id, pr_number, head_sha, status, verdict, posted, review_url, result_json, error_code, created_at
           FROM dbo.AiReviews WHERE tid = @tid ORDER BY created_at DESC, id DESC`,
        [tidParam(tid)],
    );
    const r = rows && rows[0];
    if (!r) return null;
    let result = null;
    try { result = r.result_json ? JSON.parse(r.result_json) : null; } catch { result = null; }
    return {
        id: Number(r.id),
        prNumber: Number(r.pr_number),
        headSha: r.head_sha,
        status: r.status,
        verdict: r.verdict,
        posted: r.posted,
        reviewUrl: r.review_url,
        errorCode: r.error_code,
        createdAt: r.created_at,
        result,
    };
};

module.exports = { claim, finish, getLatest, STALE_PENDING_MINUTES };
