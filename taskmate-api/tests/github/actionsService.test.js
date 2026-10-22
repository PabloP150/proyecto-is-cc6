jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));
jest.mock('../../models/cicd.model', () => ({ getPipeline: jest.fn() }));

const githubModel = require('../../models/github.model');
const cicdModel = require('../../models/cicd.model');
const actionsService = require('../../services/github/actionsService');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const GID = REPO.gid;
const API = '/repos/octo/demo';
const SHA = 'd'.repeat(40);

const run = (extra = {}) => ({
    id: 901,
    name: 'TaskMate CI/CD',
    display_title: 'feat: login',
    workflow_id: 55,
    path: '.github/workflows/taskmate-ci.yml',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: SHA,
    run_number: 12,
    run_attempt: 1,
    actor: { login: 'ana', avatar_url: 'https://avatars/ana' },
    triggering_actor: { login: 'ana', avatar_url: 'https://avatars/ana' },
    created_at: '2026-10-09T10:00:00Z',
    run_started_at: '2026-10-09T10:00:05Z',
    updated_at: '2026-10-09T10:02:05Z',
    pull_requests: [{ number: 7 }],
    html_url: 'https://github.com/octo/demo/actions/runs/901',
    ...extra,
});

const job = (id, extra = {}) => ({
    id,
    name: `job ${id}`,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-09T10:00:10Z',
    completed_at: '2026-10-09T10:01:10Z',
    run_attempt: 1,
    html_url: `https://github.com/octo/demo/actions/runs/901/job/${id}`,
    steps: [{ number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', started_at: '2026-10-09T10:00:10Z', completed_at: '2026-10-09T10:00:12Z' }],
    ...extra,
});

const tokenRoutes = { 'POST /app/installations/77/access_tokens': tokenRoute('ghs_actions') };

beforeEach(() => {
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
    cicdModel.getPipeline.mockResolvedValue({ workflowPath: '.github/workflows/taskmate-ci.yml' });
});

describe('listRuns', () => {
    test('formats runs and asks for an actions:read token scoped to the repository', async () => {
        const fetchImpl = useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs`]: { body: { total_count: 1, workflow_runs: [run()] } } });
        const result = await actionsService.listRuns(GID, { branch: 'main', status: 'failure', page: '2' });
        expect(result).toEqual({
            totalCount: 1,
            page: 2,
            perPage: actionsService.RUNS_PER_PAGE,
            runs: [{
                id: 901, name: 'TaskMate CI/CD', title: 'feat: login', workflowId: 55, workflowPath: '.github/workflows/taskmate-ci.yml',
                isTaskmate: true, event: 'push', status: 'completed', conclusion: 'success', branch: 'main', headSha: SHA, shortSha: 'ddddddd',
                runNumber: 12, attempt: 1, actor: { login: 'ana', avatarUrl: 'https://avatars/ana' }, triggeringActor: { login: 'ana', avatarUrl: 'https://avatars/ana' },
                createdAt: '2026-10-09T10:00:00Z', startedAt: '2026-10-09T10:00:05Z', updatedAt: '2026-10-09T10:02:05Z', durationMs: 120000,
                pullRequests: [7], htmlUrl: 'https://github.com/octo/demo/actions/runs/901',
            }],
        });
        const call = fetchImpl.calls.find((c) => c.path === `${API}/actions/runs`);
        expect(call.query).toEqual({ per_page: '20', page: '2', branch: 'main', status: 'failure' });
        const mint = fetchImpl.calls.find((c) => c.path.endsWith('/access_tokens'));
        expect(mint.body).toEqual({ permissions: { actions: 'read' }, repository_ids: [REPO.repoId] });
    });

    test('a workflow filter uses the workflow runs endpoint; running runs have no duration', async () => {
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/workflows/55/runs`]: { body: { total_count: 1, workflow_runs: [run({ status: 'in_progress', conclusion: null })] } } });
        const result = await actionsService.listRuns(GID, { workflow: '55' });
        expect(result.runs[0]).toMatchObject({ status: 'in_progress', durationMs: null });
    });

    test.each([
        [{ page: '0' }],
        [{ page: '51' }],
        [{ page: 'x' }],
        [{ status: 'exploded' }],
        [{ workflow: '-1' }],
        [{ workflow: '1e3' }],
        [{ branch: '../main' }],
        [{ branch: 'a..b' }],
    ])('rejects %j before touching the DB or GitHub', async (opts) => {
        const fetchImpl = useFakeGitHub(tokenRoutes);
        await expect(actionsService.listRuns(GID, opts)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(githubModel.getGroupRepository).not.toHaveBeenCalled();
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('Actions permission missing in the installation', async () => {
        useFakeGitHub({ 'POST /app/installations/77/access_tokens': { status: 422, body: { message: 'The permissions requested are not granted to this installation.' } } });
        await expect(actionsService.listRuns(GID)).rejects.toMatchObject({ code: 'APP_PERMISSIONS_MISSING' });
    });
});

describe('listWorkflows', () => {
    test('marks the TaskMate workflow', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/workflows`]: { body: { workflows: [
                { id: 55, name: 'TaskMate CI/CD', path: '.github/workflows/taskmate-ci.yml', state: 'active' },
                { id: 56, name: 'Other', path: '.github/workflows/other.yml', state: 'disabled_manually' },
            ] } },
        });
        await expect(actionsService.listWorkflows(GID)).resolves.toEqual([
            { id: 55, name: 'TaskMate CI/CD', path: '.github/workflows/taskmate-ci.yml', state: 'active', isTaskmate: true },
            { id: 56, name: 'Other', path: '.github/workflows/other.yml', state: 'disabled_manually', isTaskmate: false },
        ]);
    });
});

describe('getRun', () => {
    test('run with every job (paginated) and their steps', async () => {
        const page2 = `https://api.github.com${API}/actions/runs/901/jobs?filter=latest&per_page=100&page=2`;
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run() },
            [`GET ${API}/actions/runs/901/jobs`]: (call) => (call.query.page === '2'
                ? { body: { jobs: [job(2)] } }
                : { body: { jobs: [job(1)] }, headers: { link: `<${page2}>; rel="next"` } }),
        });
        const result = await actionsService.getRun(GID, '901');
        expect(result.run.id).toBe(901);
        expect(result.jobs.map((j) => j.id)).toEqual([1, 2]);
        expect(result.jobs[0]).toMatchObject({ durationMs: 60000, steps: [{ number: 1, name: 'Checkout', durationMs: 2000 }] });
        expect(fetchImpl.calls.find((c) => c.path === `${API}/actions/runs/901/jobs`).query.filter).toBe('latest');
    });

    test('an unknown run (or one of another repository) is RUN_NOT_FOUND', async () => {
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/902`]: { status: 404, body: { message: 'Not Found' } } });
        await expect(actionsService.getRun(GID, 902)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', status: 404 });
    });

    test.each([['abc'], ['0'], ['-5'], ['12345678901234567']])('rejects run id %j', async (id) => {
        await expect(actionsService.getRun(GID, id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('getJobLog', () => {
    const BLOB = 'https://pipelinesghubeus1.actions.githubusercontent.com/logs/job-77.txt?sig=abc';
    const logRoutes = (body, extra = {}) => ({
        ...tokenRoutes,
        [`GET ${API}/actions/jobs/77/logs`]: { status: 302, headers: { location: BLOB } },
        'GET /logs/job-77.txt': () => new Response(body, { status: 200 }),
        ...extra,
    });

    test('follows the redirect without the GitHub token and cleans the log', async () => {
        const log = [
            '2026-10-09T21:00:00.1234567Z ##[group]Run npm run lint',
            '2026-10-09T21:00:01.0000000Z \u001b[31m/src/a.js\u001b[0m',
            '2026-10-09T21:00:01.5000000Z   3:7  error  x is not defined  no-undef',
            '2026-10-09T21:00:02.0000000Z ##[error]Process completed with exit code 1.',
            '2026-10-09T21:00:02.1000000Z GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz123456',
            '',
        ].join('\n');
        const fetchImpl = useFakeGitHub(logRoutes(log));
        const result = await actionsService.getJobLog(GID, '77');
        expect(result).toEqual({
            jobId: 77,
            lines: [
                '##[group]Run npm run lint',
                '/src/a.js',
                '  3:7  error  x is not defined  no-undef',
                '##[error]Process completed with exit code 1.',
                'GROQ_API_KEY=[REDACTED]',
            ],
            errors: ['Process completed with exit code 1.'],
            truncated: false,
            endMissing: false,
        });
        const blobCall = fetchImpl.calls.find((c) => c.path === '/logs/job-77.txt');
        expect(blobCall.headers.Authorization).toBeUndefined();
        expect(blobCall.headers.Range).toBeUndefined();
        const apiCall = fetchImpl.calls.find((c) => c.path.endsWith('/actions/jobs/77/logs'));
        expect(apiCall.headers.Authorization).toBe('Bearer ghs_actions');
    });

    test('keeps only the tail of a long log and drops the cut first line', async () => {
        const line = (i) => `2026-10-09T21:00:00.0000000Z line ${String(i).padStart(6, '0')} ${'x'.repeat(80)}`;
        const big = Array.from({ length: 6000 }, (_, i) => line(i)).join('\n');
        useFakeGitHub(logRoutes(big));
        const result = await actionsService.getJobLog(GID, 77);
        expect(result.truncated).toBe(true);
        expect(result.lines.length).toBeLessThanOrEqual(3000);
        expect(result.lines[result.lines.length - 1]).toMatch(/^line 005999 /);
        expect(result.lines.every((l) => /^line \d{6} x+$/.test(l))).toBe(true);
    });

    test.each([
        ['http://pipelines.actions.githubusercontent.com/logs/x'],
        ['https://evil.example.com/logs/x'],
        ['https://actions.githubusercontent.com.evil.io/x'],
    ])('refuses a log location outside GitHub storage: %s', async (location) => {
        const fetchImpl = useFakeGitHub(logRoutes('x', { [`GET ${API}/actions/jobs/77/logs`]: { status: 302, headers: { location } } }));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'GITHUB_ERROR' });
        expect(fetchImpl.calls.some((c) => c.path === '/logs/x' || c.path === '/x')).toBe(false);
    });

    test.each([[404], [410]])('no log yet or expired (%i) → LOG_NOT_AVAILABLE', async (status) => {
        useFakeGitHub(logRoutes('x', { [`GET ${API}/actions/jobs/77/logs`]: { status, body: { message: 'Not Found' } } }));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'LOG_NOT_AVAILABLE', status: 404 });
    });

    test('rejects a bad job id before GitHub', async () => {
        await expect(actionsService.getJobLog(GID, '../x')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    // ---- long logs: only the tail is downloaded
    const TAIL = 256 * 1024;
    const CAP = 20 * 1024 * 1024;
    const LINE_BYTES = 128;
    const logLine = (i) => `2026-10-09T21:00:00.0000000Z line ${String(i).padStart(7, '0')} `.padEnd(LINE_BYTES - 1, 'x') + '\n';
    const logText = (from, count) => Array.from({ length: count }, (_, i) => logLine(from + i)).join('');

    // A body produced on demand (nothing is held in memory up front); records what was read.
    const lazyBody = (chunkAt, { count = Infinity, error } = {}) => {
        const state = { pulled: 0, cancelled: false };
        let i = 0;
        const stream = new ReadableStream({
            pull(controller) {
                if (i >= count) {
                    if (error) controller.error(error);
                    else controller.close();
                    return;
                }
                const chunk = Buffer.from(chunkAt(i));
                i += 1;
                state.pulled += chunk.length;
                controller.enqueue(new Uint8Array(chunk));
            },
            cancel() {
                state.cancelled = true;
            },
        });
        return { stream, state };
    };
    const LINES_PER_CHUNK = 512;
    const linesChunk = (i) => logText(i * LINES_PER_CHUNK, LINES_PER_CHUNK);

    test('a long log: asks the storage only for its tail with a Range header (206)', async () => {
        const length = 30 * 1024 * 1024;
        const full = lazyBody(linesChunk);
        // The last TAIL bytes of the log start in the middle of a line.
        const tail = `${'x'.repeat(40)}\n${logText(0, Math.floor((TAIL - 41) / LINE_BYTES) - 1)}2026-10-09T21:00:09.0000000Z ##[error]boom\n`;
        const fetchImpl = useFakeGitHub(logRoutes('', {
            'GET /logs/job-77.txt': (call) => (call.headers.Range
                ? new Response(tail, { status: 206, headers: { 'content-range': `bytes ${length - TAIL}-${length - 1}/${length}` } })
                : new Response(full.stream, { status: 200, headers: { 'content-length': String(length) } })),
        }));
        const result = await actionsService.getJobLog(GID, 77);
        const blobCalls = fetchImpl.calls.filter((c) => c.path === '/logs/job-77.txt');
        expect(blobCalls.map((c) => c.headers.Range)).toEqual([undefined, `bytes=${length - TAIL}-`]);
        expect(blobCalls.every((c) => c.headers.Authorization === undefined)).toBe(true);
        expect(full.state.cancelled).toBe(true);
        expect(full.state.pulled).toBeLessThan(1024 * 1024);
        expect(result).toMatchObject({ truncated: true, endMissing: false, errors: ['boom'] });
        expect(result.lines[0]).toMatch(/^line 0000000 x+$/);
        expect(result.lines[result.lines.length - 1]).toBe('##[error]boom');
    });

    test('a log that fits in the tail is read in one request, without Range', async () => {
        const text = logText(0, 10);
        const fetchImpl = useFakeGitHub(logRoutes('', {
            'GET /logs/job-77.txt': () => new Response(text, { status: 200, headers: { 'content-length': String(Buffer.byteLength(text)) } }),
        }));
        const result = await actionsService.getJobLog(GID, 77);
        expect(result).toMatchObject({ truncated: false, endMissing: false });
        expect(result.lines).toHaveLength(10);
        expect(fetchImpl.calls.filter((c) => c.path === '/logs/job-77.txt')).toHaveLength(1);
    });

    test('Range ignored (200): the whole log is streamed and only its tail kept', async () => {
        const text = logText(0, 3000);
        const length = Buffer.byteLength(text);
        expect(length).toBeGreaterThan(TAIL);
        const fetchImpl = useFakeGitHub(logRoutes('', {
            'GET /logs/job-77.txt': () => new Response(text, { status: 200, headers: { 'content-length': String(length) } }),
        }));
        const result = await actionsService.getJobLog(GID, 77);
        expect(fetchImpl.calls.filter((c) => c.path === '/logs/job-77.txt')).toHaveLength(2);
        expect(result).toMatchObject({ truncated: true, endMissing: false });
        expect(result.lines[result.lines.length - 1]).toMatch(/^line 0002999 x+$/);
        expect(result.lines.every((l) => /^line \d{7} x+$/.test(l))).toBe(true);
    });

    test('Range ignored and the log is over the cap: stops at the cap and says the end is missing', async () => {
        const length = 30 * 1024 * 1024;
        const bodies = [];
        useFakeGitHub(logRoutes('', {
            'GET /logs/job-77.txt': () => {
                const body = lazyBody(linesChunk, { count: length / (LINES_PER_CHUNK * LINE_BYTES) });
                bodies.push(body);
                return new Response(body.stream, { status: 200, headers: { 'content-length': String(length) } });
            },
        }));
        const result = await actionsService.getJobLog(GID, 77);
        expect(result).toMatchObject({ truncated: true, endMissing: true });
        expect(result.lines.length).toBeGreaterThan(0);
        const streamed = bodies[1].state;
        expect(streamed.cancelled).toBe(true);
        // The chunk that crosses the cap, plus one the stream buffers ahead.
        expect(streamed.pulled).toBeLessThanOrEqual(CAP + 2 * LINES_PER_CHUNK * LINE_BYTES);
        expect(bodies[0].state.cancelled).toBe(true);
    });

    // ---- a dropped or slow download is GitHub's failure (502), not ours (500)
    test.each([
        ['the connection drops', () => new TypeError('terminated')],
        ['the deadline passes', () => new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ])('%s while streaming → GITHUB_ERROR 502', async (_label, makeError) => {
        useFakeGitHub(logRoutes('', {
            'GET /logs/job-77.txt': () => new Response(lazyBody(linesChunk, { count: 2, error: makeError() }).stream, { status: 200 }),
        }));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'GITHUB_ERROR', status: 502 });
    });

    test('the ranged download dropping or timing out → GITHUB_ERROR 502', async () => {
        const length = 1024 * 1024;
        useFakeGitHub(logRoutes('', {
            'GET /logs/job-77.txt': (call) => {
                if (!call.headers.Range) return new Response(lazyBody(linesChunk).stream, { status: 200, headers: { 'content-length': String(length) } });
                throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
            },
        }));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'GITHUB_ERROR', status: 502 });
        useFakeGitHub(logRoutes('', {
            'GET /logs/job-77.txt': (call) => new Response(
                lazyBody(linesChunk, call.headers.Range ? { count: 1, error: new TypeError('terminated') } : {}).stream,
                { status: call.headers.Range ? 206 : 200, headers: { 'content-length': String(length) } },
            ),
        }));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'GITHUB_ERROR', status: 502 });
    });

    test('a ranged request the storage refuses → GITHUB_ERROR; an expired one → LOG_NOT_AVAILABLE', async () => {
        const routeWith = (status) => logRoutes('', {
            'GET /logs/job-77.txt': (call) => (call.headers.Range
                ? new Response('', { status })
                : new Response(lazyBody(linesChunk).stream, { status: 200, headers: { 'content-length': String(TAIL * 4) } })),
        });
        useFakeGitHub(routeWith(416));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'GITHUB_ERROR', status: 502 });
        useFakeGitHub(routeWith(404));
        await expect(actionsService.getJobLog(GID, 77)).rejects.toMatchObject({ code: 'LOG_NOT_AVAILABLE', status: 404 });
    });

    test('a private key printed over several lines is hidden whole, not only its BEGIN line', async () => {
        const log = [
            '2026-10-09T21:00:00.0000000Z before',
            '2026-10-09T21:00:00.1000000Z -----BEGIN RSA PRIVATE KEY-----',
            '2026-10-09T21:00:00.2000000Z MIIEowIBAAKCAQEAsecretlineone',
            '2026-10-09T21:00:00.3000000Z bW9yZXNlY3JldGxpbmV0d28=',
            '2026-10-09T21:00:00.4000000Z -----END RSA PRIVATE KEY-----',
            '2026-10-09T21:00:00.5000000Z > Authorization: Bearer abc123.def456',
            '2026-10-09T21:00:00.6000000Z after',
        ].join('\n');
        useFakeGitHub(logRoutes(log));
        const result = await actionsService.getJobLog(GID, 77);
        expect(result.lines).toEqual(['before', '[REDACTED]', '> Authorization: Bearer [REDACTED]', 'after']);
    });
});

describe('parseLog redaction', () => {
    const ts = '2026-10-09T21:00:00.0000000Z ';

    test('a key cut at the end of the log (download cap) is hidden up to the end', () => {
        const text = [`${ts}before`, `${ts}-----BEGIN OPENSSH PRIVATE KEY-----`, `${ts}b3BlbnNzaC1rZXktdjEAAAAA`, `${ts}c2Vjb25kbGluZQ`].join('\n');
        expect(actionsService.parseLog(text).lines).toEqual(['before', '[REDACTED]']);
    });

    test('a BEGIN marker with no key after it hides only the rest of its line, not the failure below', () => {
        const text = [
            `${ts}gitleaks: finding -----BEGIN RSA PRIVATE KEY----- in fixtures/key.txt`,
            `${ts}step 2`,
            `${ts}##[error]Process completed with exit code 1.`,
        ].join('\n');
        expect(actionsService.parseLog(text)).toEqual({
            lines: ['gitleaks: finding [REDACTED]', 'step 2', '##[error]Process completed with exit code 1.'],
            errors: ['Process completed with exit code 1.'],
            truncated: false,
        });
        // A short word after a lone marker is not taken for the last line of a key.
        const alone = [`${ts}-----BEGIN RSA PRIVATE KEY-----`, `${ts}Done`, `${ts}##[error]boom`].join('\n');
        expect(actionsService.parseLog(alone).lines).toEqual(['[REDACTED]', 'Done', '##[error]boom']);
    });

    test('a lone BEGIN marker does not reach the END of a later key', () => {
        const text = [
            `${ts}-----BEGIN RSA PRIVATE KEY-----`, `${ts}step`, `${ts}##[error]a`,
            `${ts}-----BEGIN EC PRIVATE KEY-----`, `${ts}${'A'.repeat(64)}`, `${ts}abc=`, `${ts}-----END EC PRIVATE KEY-----"`,
            `${ts}after`,
        ].join('\n');
        expect(actionsService.parseLog(text)).toEqual({ lines: ['[REDACTED]', 'step', '##[error]a', '[REDACTED]"', 'after'], errors: ['a'], truncated: false });
    });

    test.each([
        ['an encrypted PEM key (headers, blank line, indented)', [
            '  -----BEGIN RSA PRIVATE KEY-----', '  Proc-Type: 4,ENCRYPTED', '  DEK-Info: AES-128-CBC,ABCDEF', '',
            `  ${'B'.repeat(64)}`, `  ${'C'.repeat(20)}`, '  -----END RSA PRIVATE KEY-----', 'ok',
        ], ['  [REDACTED]', 'ok']],
        ['a PGP key block with its checksum line', [
            '-----BEGIN PGP PRIVATE KEY BLOCK-----', 'Version: GnuPG v2', '', 'l'.repeat(64), '=AbCd', '-----END PGP PRIVATE KEY BLOCK-----', 'ok',
        ], ['[REDACTED]', 'ok']],
        ['a key printed by docker build (BuildKit prefixes)', [
            '#5 0.123 -----BEGIN OPENSSH PRIVATE KEY-----', `#5 0.124 ${'b'.repeat(70)}`, `#5 0.124 ${'c'.repeat(10)}`,
            '#5 0.125 -----END OPENSSH PRIVATE KEY-----', '#5 DONE 0.3s',
        ], ['#5 0.123 [REDACTED]', '#5 DONE 0.3s']],
    ])('%s is hidden whole', (_name, lines, expected) => {
        expect(actionsService.parseLog(lines.map((line) => `${ts}${line}`).join('\n')).lines).toEqual(expected);
    });

    test('a line ending in a secret\'s name or an Authorization scheme leaves the next line alone', () => {
        const text = [
            'Configuring credentials:', 'next step runs', 'Enter password:', 'something here',
            'token=', 'abc def', 'Authorization: Bearer', 'more text',
        ].map((line) => `${ts}${line}`).join('\n');
        expect(actionsService.parseLog(text).lines).toEqual([
            'Configuring credentials:', 'next step runs', 'Enter password:', 'something here',
            'token=', 'abc def', 'Authorization: Bearer', 'more text',
        ]);
    });

    test('a tail cut inside a key (END without BEGIN) hides everything up to the END line', () => {
        const text = [`ZXktdjEAAAAA`, `${ts}c2Vjb25kbGluZQ`, `${ts}-----END OPENSSH PRIVATE KEY-----`, `${ts}after`].join('\n');
        expect(actionsService.parseLog(text, { truncated: true })).toEqual({ lines: ['[REDACTED]', 'after'], errors: [], truncated: true });
    });

    test('a cut tail where an END marker follows ordinary lines hides nothing', () => {
        const text = ['cut', `${ts}step 1`, `${ts}##[error]boom`, `${ts}echo -----END RSA PRIVATE KEY-----`, `${ts}after`].join('\n');
        expect(actionsService.parseLog(text, { truncated: true })).toEqual({
            lines: ['step 1', '##[error]boom', 'echo -----END RSA PRIVATE KEY-----', 'after'],
            errors: ['boom'],
            truncated: true,
        });
    });

    test('a cut tail inside a prefixed key hides it up to its END line', () => {
        const text = ['MIIcut', `${ts}#5 0.1 ${'d'.repeat(64)}`, `${ts}#5 0.1 dd==`, `${ts}#5 0.2 -----END RSA PRIVATE KEY-----`, `${ts}after`].join('\n');
        expect(actionsService.parseLog(text, { truncated: true }).lines).toEqual(['#5 0.2 [REDACTED]', 'after']);
    });

    test('a complete key in a cut tail is redacted as usual and the rest is kept', () => {
        const text = ['cut', `${ts}keep`, `${ts}-----BEGIN PRIVATE KEY-----`, `${ts}MIIEvQIBADANBg`, `${ts}-----END PRIVATE KEY-----`, `${ts}##[error]x`].join('\n');
        expect(actionsService.parseLog(text, { truncated: true })).toEqual({ lines: ['keep', '[REDACTED]', '##[error]x'], errors: ['x'], truncated: true });
    });

    test('a secret on a line longer than the line limit is redacted before the line is cut', () => {
        const text = `${'a'.repeat(1990)} ghp_abcdefghijklmnopqrstuvwxyz0123456789`;
        const [line] = actionsService.parseLog(text).lines;
        expect(line).not.toMatch(/ghp_/);
    });
});

describe('getJobAnnotations', () => {
    test('errors with file and line from the check run, secrets redacted', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/check-runs/77/annotations`]: { body: [
                { path: 'src/a.js', start_line: 3, end_line: 3, annotation_level: 'failure', title: 'no-undef', message: "'x' is not defined" },
                { path: '.github', start_line: 1, end_line: 1, annotation_level: 'warning', message: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
                { path: null, annotation_level: 'weird', message: 'm' },
            ] },
        });
        await expect(actionsService.getJobAnnotations(GID, 77)).resolves.toEqual([
            { path: 'src/a.js', startLine: 3, endLine: 3, level: 'failure', title: 'no-undef', message: "'x' is not defined" },
            { path: '.github', startLine: 1, endLine: 1, level: 'warning', title: null, message: 'token [REDACTED]' },
            { path: null, startLine: null, endLine: null, level: 'notice', title: null, message: 'm' },
        ]);
        const mint = fetchImpl.calls.find((c) => c.path.endsWith('/access_tokens'));
        expect(mint.body.permissions).toEqual({ checks: 'read' });
    });
});

describe('dispatchPipeline', () => {
    const DISPATCH = `POST ${API}/actions/workflows/taskmate-ci.yml/dispatches`;

    test('runs the TaskMate CI on an existing branch with an actions:write token', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/branches/feature/login`]: { body: { name: 'feature/login' } },
            [DISPATCH]: { status: 204 },
        });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'feature/login' })).resolves.toEqual({ dispatched: true, ref: 'feature/login' });
        const call = fetchImpl.calls.find((c) => c.method === 'POST' && c.path.endsWith('/dispatches'));
        expect(call.body).toEqual({ ref: 'feature/login', inputs: { environment: 'none' } });
        const mints = fetchImpl.calls.filter((c) => c.path.endsWith('/access_tokens')).map((c) => c.body.permissions);
        expect(mints).toContainEqual({ actions: 'write' });
    });

    test('needs a TaskMate pipeline and a real branch (not a commit)', async () => {
        const fetchImpl = useFakeGitHub({ ...tokenRoutes, [`GET ${API}/branches/nope`]: { status: 404, body: { message: 'Branch not found' } } });
        // A commit SHA is not a branch: GitHub's branch lookup answers 404.
        await expect(actionsService.dispatchPipeline(GID, { ref: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 404 });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'nope' })).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
        expect(fetchImpl.calls.some((c) => c.path.endsWith('/dispatches'))).toBe(false);
        await expect(actionsService.dispatchPipeline(GID, { ref: '' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        cicdModel.getPipeline.mockResolvedValue(null);
        await expect(actionsService.dispatchPipeline(GID, { ref: 'main' })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED', status: 409 });
    });

    test.each([['20261022'], ['deadbeef'], ['c0ffee1'], ['a'.repeat(40)]])('a branch named like a commit (%s) can be run', async (name) => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/branches/${name}`]: { body: { name } },
            [DISPATCH]: { status: 204 },
        });
        await expect(actionsService.dispatchPipeline(GID, { ref: name })).resolves.toEqual({ dispatched: true, ref: name });
        expect(fetchImpl.calls.find((c) => c.path.endsWith('/dispatches')).body.ref).toBe(name);
    });

    test.each([
        ["Workflow does not have 'workflow_dispatch' trigger"],
        ['Unexpected inputs provided: ["environment"]'],
        ["Provided value 'none' for input 'environment' not in the list of allowed values"],
        ["Required input 'version' not provided"],
    ])('a branch with an old or missing TaskMate workflow (%s) → BRANCH_WORKFLOW_OUTDATED', async (message) => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/branches/old`]: { body: { name: 'old' } },
            [DISPATCH]: { status: 422, body: { message } },
        });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'old' })).rejects.toMatchObject({ code: 'BRANCH_WORKFLOW_OUTDATED', status: 409 });
    });

    test.each([['feature/input-form'], ['fix/workflow_dispatch']])('a branch deleted before the dispatch (%s) → BRANCH_NOT_FOUND, even with "input" in its name', async (name) => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/branches/${name}`]: { body: { name } },
            [DISPATCH]: { status: 422, body: { message: `No ref found for: ${name}` } },
        });
        await expect(actionsService.dispatchPipeline(GID, { ref: name })).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 404 });
    });

    test('other dispatch refusals: branch gone → BRANCH_NOT_FOUND, disabled → WORKFLOW_DISABLED, no workflow → PIPELINE_NOT_CONFIGURED, else GITHUB_ERROR', async () => {
        const withDispatch = (response) => useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/branches/old`]: { body: { name: 'old' } },
            [DISPATCH]: response,
        });
        withDispatch({ status: 422, body: { message: 'No ref found for: old' } });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'old' })).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 404 });
        // A disabled workflow is repository-wide: merging the default branch would not help.
        withDispatch({ status: 422, body: { message: "Cannot trigger a 'workflow_dispatch' on a disabled workflow" } });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'old' })).rejects.toMatchObject({ code: 'WORKFLOW_DISABLED', status: 409 });
        withDispatch({ status: 404, body: { message: 'Not Found' } });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'old' })).rejects.toMatchObject({ code: 'PIPELINE_NOT_CONFIGURED', status: 409 });
        withDispatch({ status: 422, body: { message: 'Something unexpected' } });
        await expect(actionsService.dispatchPipeline(GID, { ref: 'old' })).rejects.toMatchObject({ code: 'GITHUB_ERROR', status: 502 });
    });
});

describe('rerunFailed / cancelRun', () => {
    const deployRun = run({ event: 'workflow_dispatch', display_title: 'Deploy a producción desde TaskMate', conclusion: 'failure' });

    test('re-runs the failed jobs of a failed run', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ conclusion: 'failure' }) },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: { status: 201, body: {} },
        });
        await expect(actionsService.rerunFailed(GID, '901')).resolves.toEqual({ rerun: true, runId: 901 });
        expect(fetchImpl.calls.some((c) => c.method === 'POST' && c.path.endsWith('/rerun-failed-jobs'))).toBe(true);
    });

    test('a successful or running run cannot be re-run', async () => {
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/901`]: { body: run() } });
        await expect(actionsService.rerunFailed(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_RERUNNABLE', status: 409 });
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/901`]: { body: run({ status: 'in_progress', conclusion: null }) } });
        await expect(actionsService.rerunFailed(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_RERUNNABLE' });
    });

    test('deploy runs are admin-only to re-run or cancel', async () => {
        const fetchImpl = useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: deployRun },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: { status: 201, body: {} },
        });
        await expect(actionsService.rerunFailed(GID, 901, { isAdmin: false })).rejects.toMatchObject({ code: 'NOT_GROUP_ADMIN', status: 403 });
        await expect(actionsService.cancelRun(GID, 901, { isAdmin: false })).rejects.toMatchObject({ code: 'NOT_GROUP_ADMIN' });
        expect(fetchImpl.calls.some((c) => c.method === 'POST' && c.path.includes('/runs/901/'))).toBe(false);
        await expect(actionsService.rerunFailed(GID, 901, { isAdmin: true })).resolves.toMatchObject({ rerun: true });
    });

    test('cancels a running run; a finished one is RUN_NOT_CANCELLABLE', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ status: 'in_progress', conclusion: null }) },
            [`POST ${API}/actions/runs/901/cancel`]: { status: 202, body: {} },
        });
        await expect(actionsService.cancelRun(GID, 901)).resolves.toEqual({ cancelled: true, runId: 901 });
        useFakeGitHub({ ...tokenRoutes, [`GET ${API}/actions/runs/901`]: { body: run() } });
        await expect(actionsService.cancelRun(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_CANCELLABLE', status: 409 });
    });

    test('GitHub refusing the re-run (too old) → RUN_NOT_RERUNNABLE', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ conclusion: 'failure' }) },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: { status: 403, body: { message: 'Unable to retry this workflow run because it was created over a month ago' } },
        });
        await expect(actionsService.rerunFailed(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_RERUNNABLE' });
    });

    test.each([[409], [422]])('GitHub refusing the re-run with %i → RUN_NOT_RERUNNABLE', async (status) => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ conclusion: 'failure' }) },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: { status, body: { message: 'This workflow is already running' } },
        });
        await expect(actionsService.rerunFailed(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_RERUNNABLE', status: 409 });
    });

    const secondaryLimit = { status: 403, headers: { 'retry-after': '30' }, body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' } };
    const primaryLimit = () => ({
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 90) },
        body: { message: 'API rate limit exceeded for installation ID 77.' },
    });

    test('a rate limit (403) on re-run is GITHUB_RATE_LIMITED with retryAfterSec, not RUN_NOT_RERUNNABLE', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ conclusion: 'failure' }) },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: secondaryLimit,
        });
        await expect(actionsService.rerunFailed(GID, 901))
            .rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED', status: 503, details: { retryAfterSec: 30 } });
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ conclusion: 'failure' }) },
            [`POST ${API}/actions/runs/901/rerun-failed-jobs`]: primaryLimit(),
        });
        const err = await actionsService.rerunFailed(GID, 901).catch((e) => e);
        expect(err).toMatchObject({ code: 'GITHUB_RATE_LIMITED', status: 503 });
        expect(err.details.retryAfterSec).toBeGreaterThanOrEqual(85);
        expect(err.details.retryAfterSec).toBeLessThanOrEqual(90);
    });

    test('a rate limit (403) on cancel is GITHUB_RATE_LIMITED with retryAfterSec, not RUN_NOT_CANCELLABLE', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ status: 'in_progress', conclusion: null }) },
            [`POST ${API}/actions/runs/901/cancel`]: secondaryLimit,
        });
        await expect(actionsService.cancelRun(GID, 901))
            .rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED', status: 503, details: { retryAfterSec: 30 } });
    });

    test('GitHub answering 409 to the cancel (it just finished) → RUN_NOT_CANCELLABLE', async () => {
        useFakeGitHub({
            ...tokenRoutes,
            [`GET ${API}/actions/runs/901`]: { body: run({ status: 'in_progress', conclusion: null }) },
            [`POST ${API}/actions/runs/901/cancel`]: { status: 409, body: { message: 'Cannot cancel a workflow run that is completed.' } },
        });
        await expect(actionsService.cancelRun(GID, 901)).rejects.toMatchObject({ code: 'RUN_NOT_CANCELLABLE', status: 409 });
    });
});
