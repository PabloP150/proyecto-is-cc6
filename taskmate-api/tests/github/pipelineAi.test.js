// The AI proposes the pipeline over the LLMService link: request shape, reply correlation, error
// mapping, timeout and cleanup. A fake link (EventEmitter + send) stands in for LLMService.
const EventEmitter = require('events');
const { proposeWithAi } = require('../../services/github/pipelineAi');

const REPO = { fullName: 'octo/demo', defaultBranch: 'main', installationId: 77 };
const OPTIONS = { nodeVersions: ['20', '22', '24', '26'], pythonVersions: ['3.12', '3.13'] };
const NODE = {
    dir: '.',
    stack: 'node',
    validManifest: true,
    scripts: { lint: 'eslint .', test: 'vitest run', build: 'vite build', dev: 'vite' },
    longRunning: ['dev'],
    lockfile: 'npm',
    runtime: '22',
    framework: 'vite',
    siteDirs: ['.'],
};
const PYTHON = { dir: 'api', stack: 'python', requirementFiles: ['requirements.txt'], pyproject: false, runtime: null, usesPytest: true };
const FACTS = { defaultBranch: 'main', projects: [NODE, PYTHON] };
const DETECTED = {
    version: 1,
    project: { dir: '.', stack: 'node' },
    runtime: '22',
    install: { kind: 'npm-ci' },
    lint: { kind: 'script', name: 'lint' },
    audit: false,
    test: { kind: 'script', name: 'test' },
    build: { kind: 'script', name: 'build' },
    deploy: { target: 'github-pages', framework: 'vite', outputDir: 'dist' },
};
// What Python answers: the spec fields (no version) plus the explanation.
const withoutVersion = ({ version, ...fields }) => fields;
const PROPOSAL = { ...withoutVersion(DETECTED), audit: true, explanation: 'Uso npm ci porque hay package-lock.json.' };

const fakeLlm = ({ sent = true } = {}) => {
    const llm = new EventEmitter();
    llm.send = jest.fn().mockResolvedValue(sent);
    return llm;
};

const start = (llm, extra = {}) => proposeWithAi({ repo: REPO, facts: FACTS, detected: DETECTED, options: OPTIONS, llm, ...extra });
const sentMessage = (llm) => llm.send.mock.calls[0][0];
const reply = (llm, body) => {
    const { requestId, sessionId } = sentMessage(llm);
    llm.emit(sessionId, { requestId, sessionId, ...body });
};

afterEach(() => {
    jest.useRealTimers();
});

describe('proposeWithAi', () => {
    test('sends the facts to propose_pipeline and returns the spec with its explanation', async () => {
        const llm = fakeLlm();
        const promise = start(llm);
        const message = sentMessage(llm);
        expect(message.method).toBe('propose_pipeline');
        expect(message.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(message.sessionId).toBe(`pipeline:${message.requestId}`);
        expect(message.params.repo).toEqual({ fullName: 'octo/demo', defaultBranch: 'main' });
        expect(message.params.detected).toEqual(DETECTED);
        expect(message.params.options).toEqual(OPTIONS);
        expect(message.params.projects).toEqual([
            {
                dir: '.', stack: 'node', scripts: NODE.scripts, longRunning: ['dev'], lockfile: 'npm', runtime: '22', framework: 'vite',
                siteDirs: ['.'], requirementFiles: [], pyproject: false, usesPytest: false,
            },
            {
                dir: 'api', stack: 'python', scripts: {}, longRunning: [], lockfile: null, runtime: null, framework: null,
                siteDirs: [], requirementFiles: ['requirements.txt'], pyproject: false, usesPytest: true,
            },
        ]);
        expect(llm.listenerCount(message.sessionId)).toBe(1);

        reply(llm, { event: 'pipeline_proposal', data: { proposal: PROPOSAL } });
        const result = await promise;
        expect(result.spec).toEqual({ ...DETECTED, audit: true });
        expect(result.spec).not.toHaveProperty('explanation');
        expect(result.explanation).toBe('Uso npm ci porque hay package-lock.json.');
        expect(llm.listenerCount(message.sessionId)).toBe(0);
    });

    test('script commands are redacted and cut; at most 40 scripts and 6 projects, always with the detected one', async () => {
        const scripts = { deploy: `curl -H "Authorization: token ghp_${'a'.repeat(36)}" x && ${'y'.repeat(300)}` };
        for (let i = 0; i < 50; i += 1) scripts[`s${i}`] = 'echo';
        const many = Array.from({ length: 8 }, (_, i) => ({ dir: `p${i}`, stack: 'static', siteDirs: ['.'] }));
        const facts = { projects: [{ ...NODE, scripts }, ...many] };
        const detected = { ...DETECTED, project: { dir: 'p7', stack: 'static' } };
        const llm = fakeLlm();
        const promise = start(llm, { facts, detected });
        const { projects } = sentMessage(llm).params;
        reply(llm, { event: 'pipeline_proposal_error', error: { code: 'LLM_ERROR' } });
        await expect(promise).rejects.toMatchObject({ code: 'LLM_ERROR' });
        expect(projects).toHaveLength(6);
        expect(projects[5].dir).toBe('p7');
        expect(Object.keys(projects[0].scripts)).toHaveLength(40);
        expect(projects[0].scripts.deploy).not.toContain('ghp_');
        expect(projects[0].scripts.deploy).toContain('[REDACTED]');
        expect(projects[0].scripts.deploy.length).toBeLessThanOrEqual(200);
    });

    test('ignores replies to other requests', async () => {
        const llm = fakeLlm();
        const promise = start(llm);
        const { sessionId, requestId } = sentMessage(llm);
        llm.emit(sessionId, { event: 'pipeline_proposal_error', requestId: 'other', sessionId, error: { code: 'LLM_ERROR' } });
        llm.emit(sessionId, { event: 'pipeline_proposal', sessionId, data: { proposal: PROPOSAL } });
        llm.emit(sessionId, { event: 'pipeline_proposal', requestId, sessionId, data: { proposal: { ...PROPOSAL, audit: false } } });
        await expect(promise).resolves.toMatchObject({ spec: { audit: false } });
    });

    test.each([
        ['LLM_TIMEOUT', 'LLM_TIMEOUT', 504],
        ['LLM_RATE_LIMIT', 'LLM_RATE_LIMIT', 503],
        ['LLM_INVALID_OUTPUT', 'LLM_INVALID_OUTPUT', 502],
        ['LLM_ERROR', 'LLM_ERROR', 503],
        ['INVALID_PARAMS', 'LLM_ERROR', 503],
        ['INTERNAL_ERROR', 'LLM_ERROR', 503],
        [undefined, 'LLM_ERROR', 503],
    ])('Python error %s → %s (%i)', async (pythonCode, code, status) => {
        const llm = fakeLlm();
        const promise = start(llm);
        reply(llm, { event: 'pipeline_proposal_error', error: { code: pythonCode, message: 'detalle interno' } });
        const err = await promise.catch((e) => e);
        expect(err).toMatchObject({ name: 'AppError', code, status });
        expect(err.message).not.toContain('detalle interno');
        expect(llm.listenerCount(sentMessage(llm).sessionId)).toBe(0);
    });

    test('a rate limit carries retryAfterSec', async () => {
        const llm = fakeLlm();
        const promise = start(llm);
        reply(llm, { event: 'pipeline_proposal_error', error: { code: 'LLM_RATE_LIMIT', retryAfterSec: 12.2 } });
        await expect(promise).rejects.toMatchObject({ code: 'LLM_RATE_LIMIT', details: { retryAfterSec: 13 } });
    });

    test.each([
        [{}],
        [{ proposal: null }],
        [{ proposal: [] }],
        [null],
    ])('a reply without a proposal object is invalid output: %j', async (data) => {
        const llm = fakeLlm();
        const promise = start(llm);
        reply(llm, { event: 'pipeline_proposal', data });
        await expect(promise).rejects.toMatchObject({ code: 'LLM_INVALID_OUTPUT', status: 502 });
    });

    test('the explanation is plain text of at most 600 characters', async () => {
        const llm = fakeLlm();
        const promise = start(llm);
        reply(llm, { event: 'pipeline_proposal', data: { proposal: { ...PROPOSAL, explanation: `  a\u0000b${'x'.repeat(700)}` } } });
        const { explanation } = await promise;
        expect(explanation.startsWith('a b')).toBe(true);
        expect(explanation).toHaveLength(600);

        const other = fakeLlm();
        const without = start(other);
        reply(other, { event: 'pipeline_proposal', data: { proposal: { ...PROPOSAL, explanation: 5 } } });
        expect((await without).explanation).toBe('');
    });

    test('a message that could not be sent is LLM_ERROR', async () => {
        const llm = fakeLlm({ sent: false });
        const promise = start(llm);
        await expect(promise).rejects.toMatchObject({ code: 'LLM_ERROR', status: 503 });
        expect(llm.listenerCount(sentMessage(llm).sessionId)).toBe(0);
    });

    test('a send that throws is LLM_ERROR', async () => {
        const llm = fakeLlm();
        llm.send.mockImplementation(() => {
            throw new Error('boom');
        });
        await expect(start(llm)).rejects.toMatchObject({ code: 'LLM_ERROR' });
    });

    test('the link to Python dropping fails the request right away', async () => {
        const llm = fakeLlm();
        const promise = start(llm);
        reply(llm, { event: 'error', connectionLost: true, error: { code: 'LLM_ERROR', message: 'AI service connection lost' } });
        await expect(promise).rejects.toMatchObject({ code: 'LLM_ERROR', status: 503 });
        expect(llm.listenerCount(sentMessage(llm).sessionId)).toBe(0);
    });

    test('no answer in time is LLM_TIMEOUT; a late reply is ignored', async () => {
        jest.useFakeTimers();
        const llm = fakeLlm();
        const promise = start(llm, { timeoutMs: 1000 });
        const { sessionId } = sentMessage(llm);
        jest.advanceTimersByTime(999);
        expect(llm.listenerCount(sessionId)).toBe(1);
        jest.advanceTimersByTime(1);
        await expect(promise).rejects.toMatchObject({ code: 'LLM_TIMEOUT', status: 504 });
        expect(llm.listenerCount(sessionId)).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
        expect(() => reply(llm, { event: 'pipeline_proposal', data: { proposal: PROPOSAL } })).not.toThrow();
    });

    test('an answer clears the timer', async () => {
        jest.useFakeTimers();
        const llm = fakeLlm();
        const promise = start(llm, { timeoutMs: 1000 });
        reply(llm, { event: 'pipeline_proposal', data: { proposal: PROPOSAL } });
        await promise;
        expect(jest.getTimerCount()).toBe(0);
    });
});
