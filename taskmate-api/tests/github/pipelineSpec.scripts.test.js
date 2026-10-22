// Runs the github-script code of the rendered workflow against a fake GitHub API: what it publishes,
// when it skips, and which run's Pages artifact it reuses.
const YAML = require('yaml');
const spec = require('../../services/github/pipelineSpec');

const SHA = (c) => c.repeat(40);
const HEAD = SHA('a');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const workflow = () => {
    const project = spec.nodeFacts('.', ['package.json', 'package-lock.json'], {
        packageJson: JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '6' } }),
    }, ['.']);
    const facts = { projects: [project] };
    return YAML.parse(spec.renderWorkflow(spec.validateSpec(spec.proposeSpec(facts).spec, facts)));
};
const scriptOf = (job, name) => workflow().jobs[job].steps.find((s) => s.name === name).with.script;

/**
 * deployments: [{id, environment, sha, payload, statuses: ['success', …] newest first}] newest first.
 * Every call is logged in `calls`, in order, with core outputs as ['output', name, value].
 */
const fakeGitHub = ({ deployments = [], head = HEAD, failInProgress = false, artifacts = null, artifactsError = null } = {}) => {
    const calls = [];
    const outputs = {};
    const statusesOf = (id) => (deployments.find((d) => d.id === id) || { statuses: [] }).statuses;
    const github = {
        rest: {
            actions: {
                // artifacts: {runId: [{expired}]}; null = every run still has its github-pages artifact.
                listWorkflowRunArtifacts: jest.fn(async ({ run_id: runId, name }) => {
                    calls.push(['listWorkflowRunArtifacts', runId, name]);
                    if (artifactsError) throw artifactsError;
                    return { data: { artifacts: artifacts ? artifacts[runId] || [] : [{ name, expired: false }] } };
                }),
            },
            git: {
                getRef: jest.fn(async (args) => {
                    calls.push(['getRef', args.ref]);
                    return { data: { object: { sha: head } } };
                }),
            },
            repos: {
                listDeployments: jest.fn(async ({ environment, task }) => {
                    calls.push(['listDeployments', environment || null, task]);
                    return { data: deployments.filter((d) => !environment || d.environment === environment) };
                }),
                listDeploymentStatuses: jest.fn(async ({ deployment_id: id, per_page: perPage }) => ({
                    data: statusesOf(id).slice(0, perPage).map((state) => ({ state })),
                })),
                createDeployment: jest.fn(async (args) => {
                    calls.push(['createDeployment', args]);
                    return { data: { id: 900 } };
                }),
                createDeploymentStatus: jest.fn(async (args) => {
                    calls.push(['createDeploymentStatus', args.state, args.deployment_id]);
                    if (failInProgress && args.state === 'in_progress') throw new Error('GitHub is down');
                }),
            },
        },
    };
    const core = {
        setOutput: (name, value) => {
            outputs[name] = value;
            calls.push(['output', name, value]);
        },
        notice: jest.fn(),
        info: jest.fn(),
        setFailed: jest.fn(),
    };
    return { github, core, calls, outputs };
};

const run = async (script, { fake, eventName = 'push', env }) => {
    const context = {
        eventName,
        repo: { owner: 'grupo', repo: 'app' },
        payload: { repository: { default_branch: 'main' } },
        serverUrl: 'https://github.com',
        runId: 777,
    };
    const fn = new AsyncFunction('github', 'context', 'core', 'process', script);
    return fn(fake.github, context, fake.core, { env });
};

const pushEnv = (sha = HEAD) => ({ TARGET_ENV: 'staging', TARGET_VERSION: sha, REQUESTED_BY: '' });

describe('versions script', () => {
    const script = scriptOf('build', 'Versiones a publicar');

    test('a push at the head of the default branch deploys staging over the newest published site', async () => {
        const fake = fakeGitHub({
            deployments: [
                { id: 5, environment: 'production', sha: SHA('e'), payload: { runId: 50 }, statuses: ['failure', 'in_progress'] },
                // The payload may come back JSON-encoded (twice, even).
                { id: 4, environment: 'staging', sha: SHA('d'), payload: JSON.stringify(JSON.stringify({ runId: 40 })), statuses: ['success'] },
                { id: 3, environment: 'production', sha: SHA('c'), payload: { runId: 30 }, statuses: ['success'] },
                { id: 2, environment: 'production', sha: SHA('b'), payload: { runId: 20 }, statuses: ['success'] },
            ],
        });
        await run(script, { fake, env: pushEnv() });
        expect(fake.github.rest.git.getRef).toHaveBeenCalledWith({ owner: 'grupo', repo: 'app', ref: 'heads/main' });
        expect(fake.outputs).toEqual({
            skip: 'false',
            target: 'staging',
            target_version: HEAD,
            target_path: '/staging/',
            other_version: SHA('c'),
            other_path: '/',
            base_run: '40',
            deployment_id: '900',
        });
        const created = fake.calls.find((c) => c[0] === 'createDeployment')[1];
        expect(created).toMatchObject({
            ref: HEAD, task: 'deploy:taskmate', environment: 'staging', production_environment: false,
            payload: { taskmate: true, requestedBy: '', runId: 777 },
        });
    });

    test('a re-run of an old push deploys nothing and records no deployment', async () => {
        const fake = fakeGitHub({ head: SHA('f') });
        await run(script, { fake, env: pushEnv(HEAD) });
        expect(fake.outputs).toEqual({ skip: 'true' });
        expect(fake.github.rest.repos.createDeployment).not.toHaveBeenCalled();
        expect(fake.github.rest.repos.listDeployments).not.toHaveBeenCalled();
        expect(fake.core.notice).toHaveBeenCalledWith(expect.stringMatching(/ya no es la última versión de main/));
    });

    test('a deploy from TaskMate does not look at the branch head', async () => {
        const fake = fakeGitHub({
            head: SHA('f'),
            deployments: [{ id: 7, environment: 'staging', sha: SHA('b'), payload: { runId: 70 }, statuses: ['success'] }],
        });
        await run(script, { fake, eventName: 'workflow_dispatch', env: { TARGET_ENV: 'production', TARGET_VERSION: SHA('b'), REQUESTED_BY: 'ana<script>' } });
        expect(fake.github.rest.git.getRef).not.toHaveBeenCalled();
        expect(fake.outputs).toMatchObject({ skip: 'false', target: 'production', target_path: '/', other_version: SHA('b'), other_path: '/staging/', base_run: '70' });
        const created = fake.calls.find((c) => c[0] === 'createDeployment')[1];
        expect(created).toMatchObject({ environment: 'production', production_environment: true, payload: { requestedBy: 'anascript' } });
    });

    test('nothing published yet: no artifact to reuse and no other version', async () => {
        const fake = fakeGitHub();
        await run(script, { fake, env: pushEnv() });
        expect(fake.outputs).toMatchObject({ base_run: '', other_version: '', deployment_id: '900' });
    });

    test('a deploy without a usable run id (older workflow) falls back to rebuilding the other environment', async () => {
        const fake = fakeGitHub({
            deployments: [{ id: 1, environment: 'production', sha: SHA('c'), payload: '{not json', statuses: ['success'] }],
        });
        await run(script, { fake, env: pushEnv() });
        expect(fake.outputs).toMatchObject({ base_run: '', other_version: SHA('c') });
    });

    test('a published site GitHub no longer keeps is not downloaded: the other environment is rebuilt', async () => {
        const deployments = [
            { id: 4, environment: 'staging', sha: SHA('b'), payload: { runId: 40 }, statuses: ['success'] },
            { id: 3, environment: 'production', sha: SHA('c'), payload: { runId: 30 }, statuses: ['success'] },
        ];
        const expired = fakeGitHub({ deployments, artifacts: { 40: [{ name: 'github-pages', expired: true }] } });
        await run(script, { fake: expired, env: pushEnv() });
        expect(expired.calls).toContainEqual(['listWorkflowRunArtifacts', 40, 'github-pages']);
        expect(expired.outputs).toMatchObject({ base_run: '', other_version: SHA('c') });
        expect(expired.core.info).toHaveBeenCalledWith(expect.stringMatching(/ya no está guardado en GitHub/));

        // If GitHub cannot say, the download is still attempted (and falls back on its own).
        const unknown = fakeGitHub({ deployments, artifactsError: new Error('boom') });
        await run(script, { fake: unknown, env: pushEnv() });
        expect(unknown.outputs).toMatchObject({ base_run: '40', other_version: SHA('c') });
    });

    test('the deployment id is an output before the in_progress status, so a failure there is still recorded', async () => {
        const fake = fakeGitHub({ failInProgress: true });
        await expect(run(script, { fake, env: pushEnv() })).rejects.toThrow('GitHub is down');
        expect(fake.outputs.deployment_id).toBe('900');
        const order = fake.calls.map((c) => (c[0] === 'output' ? `output:${c[1]}` : c[0]));
        expect(order.indexOf('output:deployment_id')).toBeLessThan(order.indexOf('createDeploymentStatus'));
        expect(order.indexOf('createDeployment')).toBeLessThan(order.indexOf('output:deployment_id'));
    });

    test('rejects an unknown environment or a version that is not a full SHA', async () => {
        await expect(run(script, { fake: fakeGitHub(), eventName: 'workflow_dispatch', env: { TARGET_ENV: 'qa', TARGET_VERSION: HEAD } }))
            .rejects.toThrow(/Entorno inválido/);
        await expect(run(script, { fake: fakeGitHub(), eventName: 'workflow_dispatch', env: { TARGET_ENV: 'production', TARGET_VERSION: 'main' } }))
            .rejects.toThrow(/Versión inválida/);
    });
});

describe('deploy recorders', () => {
    test('success: staging gets its /staging/ URL; failure closes the deployment', async () => {
        const fake = fakeGitHub();
        await run(scriptOf('deploy', 'Registrar el deploy'), {
            fake, env: { DEPLOYMENT_ID: '900', TARGET_ENV: 'staging', PAGE_URL: 'https://grupo.github.io/app' },
        });
        expect(fake.github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(expect.objectContaining({
            deployment_id: 900, state: 'success', environment_url: 'https://grupo.github.io/app/staging/', auto_inactive: true,
        }));
        await run(scriptOf('build', 'Registrar el deploy fallido'), { fake, env: { DEPLOYMENT_ID: '900' } });
        expect(fake.github.rest.repos.createDeploymentStatus).toHaveBeenLastCalledWith(expect.objectContaining({ deployment_id: 900, state: 'failure' }));
    });

    test.each([['build'], ['deploy'], ['close']])('the %s failure recorder closes only a deployment that is still open', async (job) => {
        const script = scriptOf(job, 'Registrar el deploy fallido');
        for (const statuses of [['in_progress'], ['queued', 'pending'], []]) {
            const fake = fakeGitHub({ deployments: [{ id: 900, environment: 'staging', sha: HEAD, payload: {}, statuses }] });
            await run(script, { fake, env: { DEPLOYMENT_ID: '900' } });
            expect(fake.github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(expect.objectContaining({ deployment_id: 900, state: 'failure' }));
        }
        // A deployment that already ended keeps its status: a live one is never marked as failed.
        for (const state of ['success', 'failure', 'error', 'inactive']) {
            const fake = fakeGitHub({ deployments: [{ id: 900, environment: 'staging', sha: HEAD, payload: {}, statuses: [state, 'in_progress'] }] });
            await run(script, { fake, env: { DEPLOYMENT_ID: '900' } });
            expect(fake.github.rest.repos.createDeploymentStatus).not.toHaveBeenCalled();
        }
    });
});

describe('deploy attempt check', () => {
    const script = scriptOf('deploy', 'Comprobar que el build es de este intento');

    test('a deploy job of the same attempt as its build goes on', async () => {
        const fake = fakeGitHub();
        await run(script, { fake, env: { BUILD_ATTEMPT: '2', RUN_ATTEMPT: '2' } });
        expect(fake.core.setFailed).not.toHaveBeenCalled();
    });

    test.each([
        ['re-run of the deploy job only', { BUILD_ATTEMPT: '1', RUN_ATTEMPT: '2' }],
        ['build outputs missing', { BUILD_ATTEMPT: '', RUN_ATTEMPT: '1' }],
    ])('%s: fails, telling to deploy again from TaskMate, and calls no API', async (_, env) => {
        const fake = fakeGitHub();
        await run(script, { fake, env });
        expect(fake.core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/Vuelve a desplegar desde TaskMate/));
        expect(fake.calls).toEqual([]);
    });
});
