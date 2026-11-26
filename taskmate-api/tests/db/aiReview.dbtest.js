const aiReview = require('../../models/aiReview.model');
const { execWriteCommand } = require('../../helpers/execQuery');
const h = require('./helpers');

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

async function task() {
    const { uid } = await h.createUser('air');
    const gid = await h.createGroup(uid);
    return h.createTask(gid);
}

describe('AiReviews (migration 011)', () => {
    test('one review per task and head commit; latest wins', async () => {
        const tid = await task();
        const first = await aiReview.claim({ tid, prNumber: 3, headSha: SHA1 });
        expect(first).toEqual(expect.any(Number));
        expect(await aiReview.claim({ tid, prNumber: 3, headSha: SHA1 })).toBeNull();

        await aiReview.finish(first, { status: 'done', verdict: 'warn', posted: 'no_permission', result: { body: 'ñ ✓' } });
        const second = await aiReview.claim({ tid, prNumber: 3, headSha: SHA2 });
        await aiReview.finish(second, { status: 'failed', errorCode: 'AI_SERVER_UNAVAILABLE' });

        const latest = await aiReview.getLatest(tid);
        expect(latest).toMatchObject({ id: second, status: 'failed', errorCode: 'AI_SERVER_UNAVAILABLE', headSha: SHA2 });
    });

    test('stored result round-trips (unicode) and a missing task has none', async () => {
        const tid = await task();
        const id = await aiReview.claim({ tid, prNumber: 1, headSha: SHA1 });
        await aiReview.finish(id, { status: 'done', verdict: 'pass', posted: 'posted', reviewUrl: 'https://gh/x', result: { body: 'Revisión ✓ ñ' } });
        expect(await aiReview.getLatest(tid)).toMatchObject({ verdict: 'pass', posted: 'posted', result: { body: 'Revisión ✓ ñ' } });
        expect(await aiReview.getLatest(await task())).toBeNull();
    });

    test('a failed review is claimed again and reset to pending; a done one is not', async () => {
        const tid = await task();
        const id = await aiReview.claim({ tid, prNumber: 4, headSha: SHA1 });
        await aiReview.finish(id, { status: 'failed', errorCode: 'AI_SERVER_UNAVAILABLE' });

        expect(await aiReview.claim({ tid, prNumber: 4, headSha: SHA1 })).toBe(id);
        expect(await aiReview.getLatest(tid)).toMatchObject({ id, status: 'pending', errorCode: null, verdict: null });
        // In progress again: a second caller gets nothing.
        expect(await aiReview.claim({ tid, prNumber: 4, headSha: SHA1 })).toBeNull();

        await aiReview.finish(id, { status: 'done', verdict: 'pass', posted: 'posted' });
        expect(await aiReview.claim({ tid, prNumber: 4, headSha: SHA1 })).toBeNull();
    });

    test('a pending review abandoned for too long is claimed again', async () => {
        const tid = await task();
        const id = await aiReview.claim({ tid, prNumber: 5, headSha: SHA1 });
        await execWriteCommand(
            `UPDATE dbo.AiReviews SET created_at = DATEADD(MINUTE, -${aiReview.STALE_PENDING_MINUTES + 1}, SYSDATETIMEOFFSET()) WHERE id = ${id}`,
        );
        expect(await aiReview.claim({ tid, prNumber: 5, headSha: SHA1 })).toBe(id);
    });

    test('check constraints reject bad values', async () => {
        const tid = await task();
        const id = await aiReview.claim({ tid, prNumber: 1, headSha: SHA1 });
        await expect(aiReview.finish(id, { status: 'weird' })).rejects.toThrow();
        await expect(aiReview.claim({ tid, prNumber: 1, headSha: 'z'.repeat(40) })).rejects.toThrow();
    });
});
