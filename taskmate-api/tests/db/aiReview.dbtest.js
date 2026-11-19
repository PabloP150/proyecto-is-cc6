const aiReview = require('../../models/aiReview.model');
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

    test('check constraints reject bad values', async () => {
        const tid = await task();
        const id = await aiReview.claim({ tid, prNumber: 1, headSha: SHA1 });
        await expect(aiReview.finish(id, { status: 'weird' })).rejects.toThrow();
        await expect(aiReview.claim({ tid, prNumber: 1, headSha: 'z'.repeat(40) })).rejects.toThrow();
    });
});
