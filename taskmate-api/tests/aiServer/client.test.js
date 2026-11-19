const { createAiServerClient } = require('../../services/aiServer/client');

const env = { AI_SERVER_URL: 'http://ai.test/', AI_SERVER_SECRET: 's'.repeat(40), AI_SERVER_PROJECT: 'P' };
const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });

describe('AI server client', () => {
    test('posts the command with the secret and project', async () => {
        const fetchImpl = jest.fn(() => reply(200, { run_id: 'r1', result: { verdict: 'pass' } }));
        const out = await createAiServerClient({ fetchImpl, env }).runCommand('audit', { base: 'main' });
        expect(out.run_id).toBe('r1');
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('http://ai.test/commands/audit');
        expect(init.headers['x-ai-server-secret']).toBe('s'.repeat(40));
        expect(JSON.parse(init.body)).toEqual({ project: 'P', args: { base: 'main' } });
    });

    test('disabled without AI_SERVER_URL', async () => {
        const client = createAiServerClient({ fetchImpl: jest.fn(), env: {} });
        expect(client.enabled()).toBe(false);
        await expect(client.runCommand('audit', {})).rejects.toMatchObject({ code: 'AI_SERVER_DISABLED', status: 503 });
    });

    test.each([
        [401, {}, 'AI_SERVER_AUTH', 502],
        [422, { detail: [] }, 'AI_SERVER_BAD_REQUEST', 400],
        [400, { detail: 'not indexed' }, 'AI_SERVER_BAD_REQUEST', 400],
        [501, {}, 'AI_SERVER_NOT_IMPLEMENTED', 501],
        [500, {}, 'AI_SERVER_ERROR', 502],
    ])('HTTP %i -> %s', async (status, body, code, httpStatus) => {
        const client = createAiServerClient({ fetchImpl: () => reply(status, body), env });
        await expect(client.runCommand('audit', {})).rejects.toMatchObject({ code, status: httpStatus });
    });

    test('network failure and timeout', async () => {
        const down = createAiServerClient({ fetchImpl: () => Promise.reject(new TypeError('fetch failed')), env });
        await expect(down.runCommand('audit', {})).rejects.toMatchObject({ code: 'AI_SERVER_UNAVAILABLE' });
        const slow = createAiServerClient({ fetchImpl: () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })), env });
        await expect(slow.runCommand('audit', {})).rejects.toMatchObject({ code: 'AI_SERVER_TIMEOUT', status: 504 });
    });
});
