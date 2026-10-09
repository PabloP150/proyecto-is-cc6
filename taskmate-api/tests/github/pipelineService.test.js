jest.mock('../../models/github.model', () => ({ getGroupRepository: jest.fn() }));
jest.mock('../../models/cicd.model', () => ({ getPipeline: jest.fn(), upsertPipeline: jest.fn() }));

const githubModel = require('../../models/github.model');
const cicdModel = require('../../models/cicd.model');
const pipelineService = require('../../services/github/pipelineService');
const pipelineSpec = require('../../services/github/pipelineSpec');
const { useFakeGitHub, tokenRoute, REPO } = require('./helpers/fakeGitHub');

const GID = REPO.gid;
const UID = '22222222-2222-4222-8222-222222222222';
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const COMMIT = 'c'.repeat(40);
const API = '/repos/octo/demo';
const WORKFLOW = `${API}/contents/.github/workflows/taskmate-ci.yml`;

const file = (path, content) => ({
    body: { type: 'file', path, size: Buffer.byteLength(content), encoding: 'base64', content: Buffer.from(content).toString('base64'), sha: 'f'.repeat(40) },
});

const VITE_PACKAGE = JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest run', build: 'vite build' }, devDependencies: { vite: '^6' } });

const tokenPermissions = (fetchImpl) => fetchImpl.calls
    .filter((c) => c.method === 'POST' && c.path.endsWith('/access_tokens'))
    .map((c) => c.body.permissions);

// A Vite site at the root, a Python API in api/ and a docs/ folder with an index.html.
const routes = (extra = {}) => ({
    'POST /app/installations/77/access_tokens': tokenRoute('ghs_ci'),
    [`GET ${API}/commits`]: (call) => (call.query.path
        ? { body: [{ sha: COMMIT, html_url: `https://github.com/octo/demo/commit/${COMMIT}` }] }
        : { body: [{ sha: HEAD, commit: { tree: { sha: TREE } } }] }),
    [`GET ${API}/git/trees/${TREE}`]: {
        body: {
            truncated: false,
            tree: ['package.json', 'package-lock.json', 'index.html', '.nvmrc', 'src/main.js', 'api/requirements.txt', 'api/tests/test_app.py', 'docs/index.html']
                .map((path) => ({ path, type: 'blob', size: 10 })),
        },
    },
    [`GET ${API}/contents/package.json`]: file('package.json', VITE_PACKAGE),
    [`GET ${API}/contents/.nvmrc`]: file('.nvmrc', 'v22.3.0\n'),
    [`GET ${API}/contents/api/requirements.txt`]: file('api/requirements.txt', 'fastapi\npytest\n'),
    [`GET ${API}/pages`]: { status: 404, body: { message: 'Not Found' } },
    [`POST ${API}/pages`]: { status: 201, body: { html_url: 'https://octo.github.io/demo/', build_type: 'workflow' } },
    [`GET ${WORKFLOW}`]: { status: 404, body: { message: 'Not Found' } },
    [`PUT ${WORKFLOW}`]: { status: 201, body: { commit: { sha: COMMIT, html_url: `https://github.com/octo/demo/commit/${COMMIT}` } } },
    ...extra,
});

beforeEach(() => {
    pipelineService.factsCache.clear();
    githubModel.getGroupRepository.mockResolvedValue({ ...REPO });
    cicdModel.getPipeline.mockResolvedValue(null);
    cicdModel.upsertPipeline.mockResolvedValue({ created: true });
});

describe('collectFacts', () => {
    test('describes every project and only reads files the tree lists', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const facts = await pipelineService.collectFacts({ ...REPO });
        expect(facts.headSha).toBe(HEAD);
        expect(facts.workflowExists).toBe(false);
        expect(facts.projects.map((p) => [p.dir, p.stack])).toEqual([['.', 'node'], ['api', 'python']]);
        expect(facts.projects[0]).toMatchObject({ runtime: '22', lockfile: 'npm', framework: 'vite', siteDirs: ['.', 'docs'] });
        expect(facts.projects[1]).toMatchObject({ requirementFiles: ['requirements.txt'], usesPytest: true });
        const read = fetchImpl.calls.filter((c) => c.path.startsWith(`${API}/contents/`)).map((c) => c.path.slice(API.length + 10));
        expect(read.sort()).toEqual(['.nvmrc', 'api/requirements.txt', 'package.json']);
        expect(tokenPermissions(fetchImpl).every((p) => JSON.stringify(p) === JSON.stringify({ contents: 'read' }))).toBe(true);
    });
});

describe('proposePipeline', () => {
    test('detects the Vite project and renders its workflow', async () => {
        useFakeGitHub(routes());
        const result = await pipelineService.proposePipeline({ gid: GID, uid: UID });
        expect(result.source).toBe('detected');
        expect(result.spec.project).toEqual({ dir: '.', stack: 'node' });
        expect(result.spec.runtime).toBe('22');
        expect(result.spec.deploy).toEqual({ target: 'github-pages', framework: 'vite', outputDir: 'dist' });
        expect(pipelineSpec.isTaskmateWorkflow(result.yaml)).toBe(true);
        expect(result.stages.map((s) => s.key)).toEqual(['install', 'lint', 'test', 'build', 'deploy']);
        expect(result.options.nodeVersions).toEqual(pipelineSpec.NODE_VERSIONS);
    });

    test('reopens the saved spec when it still validates, otherwise proposes again with a note', async () => {
        useFakeGitHub(routes());
        const saved = { ...(await pipelineService.proposePipeline({ gid: GID, uid: UID })).spec, audit: true };
        cicdModel.getPipeline.mockResolvedValue({ spec: saved });
        const again = await pipelineService.proposePipeline({ gid: GID, uid: UID });
        expect(again.source).toBe('saved');
        expect(again.spec.audit).toBe(true);

        cicdModel.getPipeline.mockResolvedValue({ spec: { ...saved, test: { kind: 'script', name: 'gone' } } });
        const fresh = await pipelineService.proposePipeline({ gid: GID, uid: UID });
        expect(fresh.source).toBe('detected');
        expect(fresh.notes[0]).toMatch(/ya no coincide/);
    });

    test('dir/stack switch to another project', async () => {
        useFakeGitHub(routes());
        const result = await pipelineService.proposePipeline({ gid: GID, uid: UID, dir: 'api', stack: 'python' });
        expect(result.spec.project).toEqual({ dir: 'api', stack: 'python' });
        expect(result.spec.deploy).toBeNull();
    });

    test('a repository that is not connected never reaches GitHub', async () => {
        const fetchImpl = useFakeGitHub(routes());
        githubModel.getGroupRepository.mockResolvedValue(null);
        await expect(pipelineService.proposePipeline({ gid: GID, uid: UID })).rejects.toMatchObject({ code: 'REPO_NOT_CONNECTED' });
        expect(fetchImpl.calls).toHaveLength(0);
    });
});

describe('previewPipeline', () => {
    test('re-renders from the cached facts without reading the repository again', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const { spec } = await pipelineService.proposePipeline({ gid: GID, uid: UID });
        const before = fetchImpl.calls.length;
        const preview = await pipelineService.previewPipeline({ gid: GID, uid: UID, spec: { ...spec, lint: null, audit: true } });
        expect(fetchImpl.calls.length).toBe(before);
        expect(preview.yaml).toContain('npm audit --omit=dev --audit-level=high');
        expect(preview.yaml).not.toContain('npm run lint');
    });

    test('rejects an invalid spec', async () => {
        useFakeGitHub(routes());
        const { spec } = await pipelineService.proposePipeline({ gid: GID, uid: UID });
        await expect(pipelineService.previewPipeline({ gid: GID, uid: UID, spec: { ...spec, build: { kind: 'script', name: 'x; rm -rf /' } } }))
            .rejects.toMatchObject({ code: 'INVALID_PIPELINE', status: 400 });
    });
});

describe('applyPipeline', () => {
    const proposal = async () => (await pipelineService.proposePipeline({ gid: GID, uid: UID })).spec;

    test('enables Pages with the admin token, then commits the workflow with the workflows token and saves it', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const spec = await proposal();
        fetchImpl.calls.length = 0;
        const result = await pipelineService.applyPipeline({ gid: GID, uid: UID, username: 'ana', spec });

        const order = fetchImpl.calls.filter((c) => !c.path.endsWith('/access_tokens')).map((c) => `${c.method} ${c.path}`);
        expect(order.indexOf(`POST ${API}/pages`)).toBeLessThan(order.indexOf(`PUT ${WORKFLOW}`));
        const pagesCall = fetchImpl.calls.find((c) => c.method === 'POST' && c.path === `${API}/pages`);
        expect(pagesCall.body).toEqual({ build_type: 'workflow' });
        const put = fetchImpl.calls.find((c) => c.method === 'PUT' && c.path === WORKFLOW);
        expect(put.body.branch).toBe('main');
        expect(put.body.message).toMatch(/Configurado por ana desde TaskMate/);
        expect(put.body.sha).toBeUndefined();
        expect(pipelineSpec.isTaskmateWorkflow(Buffer.from(put.body.content, 'base64').toString('utf8'))).toBe(true);

        const permissions = tokenPermissions(fetchImpl).map((p) => JSON.stringify(p));
        expect(permissions).toContain(JSON.stringify({ administration: 'write', pages: 'write' }));
        expect(permissions).toContain(JSON.stringify({ contents: 'write', workflows: 'write' }));

        expect(cicdModel.upsertPipeline).toHaveBeenCalledWith(expect.objectContaining({
            repoId: REPO.repoId, workflowPath: pipelineSpec.WORKFLOW_PATH, commitSha: COMMIT, configuredBy: UID, spec,
        }));
        expect(result.commit).toEqual({ sha: COMMIT, url: `https://github.com/octo/demo/commit/${COMMIT}`, changed: true });
        expect(result.pages).toMatchObject({ enabled: true, changed: true });
    });

    test('switches a branch-based Pages site to GitHub Actions', async () => {
        const fetchImpl = useFakeGitHub(routes({
            [`GET ${API}/pages`]: { body: { build_type: 'legacy', html_url: 'https://octo.github.io/demo/' } },
            [`PUT ${API}/pages`]: { status: 204 },
        }));
        await pipelineService.applyPipeline({ gid: GID, uid: UID, spec: await proposal() });
        expect(fetchImpl.calls.some((c) => c.method === 'PUT' && c.path === `${API}/pages`)).toBe(true);
        expect(fetchImpl.calls.some((c) => c.method === 'POST' && c.path === `${API}/pages`)).toBe(false);
    });

    test('Pages already publishing from Actions is left alone', async () => {
        const fetchImpl = useFakeGitHub(routes({ [`GET ${API}/pages`]: { body: { build_type: 'workflow', html_url: 'https://octo.github.io/demo/' } } }));
        const result = await pipelineService.applyPipeline({ gid: GID, uid: UID, spec: await proposal() });
        expect(result.pages).toEqual({ enabled: true, changed: false, url: 'https://octo.github.io/demo/' });
        expect(fetchImpl.calls.some((c) => c.path === `${API}/pages` && c.method !== 'GET')).toBe(false);
    });

    test('a plan without Pages for the repository stops before the commit', async () => {
        const fetchImpl = useFakeGitHub(routes({
            [`POST ${API}/pages`]: { status: 422, body: { message: 'Your current plan does not support GitHub Pages for this repository.' } },
        }));
        await expect(pipelineService.applyPipeline({ gid: GID, uid: UID, spec: await proposal() })).rejects.toMatchObject({ code: 'PAGES_UNAVAILABLE', status: 409 });
        expect(fetchImpl.calls.some((c) => c.method === 'PUT' && c.path === WORKFLOW)).toBe(false);
        expect(cicdModel.upsertPipeline).not.toHaveBeenCalled();
    });

    test('a pipeline without deploy does not touch Pages', async () => {
        const fetchImpl = useFakeGitHub(routes());
        const { spec } = await pipelineService.proposePipeline({ gid: GID, uid: UID, dir: 'api', stack: 'python' });
        const result = await pipelineService.applyPipeline({ gid: GID, uid: UID, spec });
        expect(result.pages).toBeNull();
        expect(fetchImpl.calls.some((c) => c.path === `${API}/pages`)).toBe(false);
    });

    test('permissions not accepted yet in the installation', async () => {
        useFakeGitHub(routes({
            'POST /app/installations/77/access_tokens': (call) => (call.body.permissions.contents === 'read' && Object.keys(call.body.permissions).length === 1
                ? tokenRoute('ghs_read')(call)
                : { status: 422, body: { message: 'The permissions requested are not granted to this installation.' } }),
        }));
        await expect(pipelineService.applyPipeline({ gid: GID, uid: UID, spec: await proposal() })).rejects.toMatchObject({ code: 'APP_PERMISSIONS_MISSING', status: 409 });
    });
});

describe('commitWorkflow', () => {
    const text = '# taskmate-pipeline: 1\nname: x\n';

    test('never overwrites a workflow TaskMate did not write', async () => {
        const fetchImpl = useFakeGitHub(routes({ [`GET ${WORKFLOW}`]: file('.github/workflows/taskmate-ci.yml', 'name: theirs\n') }));
        await expect(pipelineService.commitWorkflow({ ...REPO }, text)).rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT', status: 409 });
        expect(fetchImpl.calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    test('updates its own file with the current blob sha', async () => {
        const fetchImpl = useFakeGitHub(routes({ [`GET ${WORKFLOW}`]: file('.github/workflows/taskmate-ci.yml', '# taskmate-pipeline: 1\nname: old\n') }));
        await pipelineService.commitWorkflow({ ...REPO }, text, { username: 'ana<script>' });
        const put = fetchImpl.calls.find((c) => c.method === 'PUT');
        expect(put.body.sha).toBe('f'.repeat(40));
        expect(put.body.message).toMatch(/Configurado por anascript desde TaskMate/);
    });

    test('an identical file is not committed again', async () => {
        const fetchImpl = useFakeGitHub(routes({ [`GET ${WORKFLOW}`]: file('.github/workflows/taskmate-ci.yml', text) }));
        const result = await pipelineService.commitWorkflow({ ...REPO }, text);
        expect(result).toEqual({ sha: COMMIT, url: `https://github.com/octo/demo/commit/${COMMIT}`, changed: false });
        expect(fetchImpl.calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    test.each([
        [409, 'Changes must be made through a pull request.', 'BRANCH_PROTECTED'],
        [422, 'Repository rule violations found', 'BRANCH_PROTECTED'],
        [409, 'is at abc but expected def', 'WORKFLOW_CHANGED'],
        [422, 'Invalid request', 'GITHUB_ERROR'],
    ])('%i "%s" → %s', async (status, message, code) => {
        useFakeGitHub(routes({ [`PUT ${WORKFLOW}`]: { status, body: { message } } }));
        await expect(pipelineService.commitWorkflow({ ...REPO }, text)).rejects.toMatchObject({ code });
    });
});

describe('getPipeline', () => {
    test('nothing configured', async () => {
        const fetchImpl = useFakeGitHub(routes());
        await expect(pipelineService.getPipeline(GID)).resolves.toEqual({ pipeline: null, workflowPath: pipelineSpec.WORKFLOW_PATH, pages: null });
        expect(fetchImpl.calls).toHaveLength(0);
    });

    test('a deploying pipeline also reports Pages; a missing permission is reported, not thrown', async () => {
        useFakeGitHub(routes({ [`GET ${API}/pages`]: { body: { build_type: 'workflow', html_url: 'https://octo.github.io/demo/' } } }));
        const spec = (await pipelineService.proposePipeline({ gid: GID, uid: UID })).spec;
        cicdModel.getPipeline.mockResolvedValue({ workflowPath: pipelineSpec.WORKFLOW_PATH, spec, commitSha: COMMIT, configuredAt: new Date(0), configuredByUsername: 'ana' });
        const result = await pipelineService.getPipeline(GID);
        expect(result.pipeline).toMatchObject({ commitSha: COMMIT, configuredBy: 'ana', deploys: true });
        expect(result.pages).toEqual({ enabled: true, buildType: 'workflow', url: 'https://octo.github.io/demo/', settingsUrl: 'https://github.com/octo/demo/settings/pages' });

        useFakeGitHub(routes({ 'POST /app/installations/77/access_tokens': { status: 422, body: { message: 'The permissions requested are not granted to this installation.' } } }));
        expect((await pipelineService.getPipeline(GID)).pages).toMatchObject({ enabled: null, error: 'APP_PERMISSIONS_MISSING' });
    });
});
