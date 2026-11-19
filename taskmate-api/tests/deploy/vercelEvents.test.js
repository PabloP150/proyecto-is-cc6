const { toDeploymentRecord, isDeploymentEvent, EVENT_STATES } = require('../../services/deploy/vercelEvents');

const event = (type, overrides = {}) => ({
    id: 'evt_1',
    type,
    createdAt: 1760000000000,
    payload: {
        project: { id: 'prj_abc123' },
        deployment: {
            id: 'dpl_xyz789',
            url: 'taskmate-git-main.vercel.app',
            target: 'production',
            meta: {
                githubCommitRef: 'main',
                githubCommitSha: 'a'.repeat(40),
            },
        },
        ...overrides,
    },
});

describe('isDeploymentEvent', () => {
    test('recognises the lifecycle events', () => {
        expect(isDeploymentEvent('deployment.created')).toBe(true);
        expect(isDeploymentEvent('deployment.succeeded')).toBe(true);
        expect(isDeploymentEvent('deployment.error')).toBe(true);
    });

    test('ignores unrelated events', () => {
        expect(isDeploymentEvent('project.created')).toBe(false);
        expect(isDeploymentEvent('domain.created')).toBe(false);
        expect(isDeploymentEvent(undefined)).toBe(false);
    });
});

describe('toDeploymentRecord', () => {
    test('maps a successful deployment', () => {
        const record = toDeploymentRecord(event('deployment.succeeded'));
        expect(record).toMatchObject({
            deploymentId: 'dpl_xyz789',
            projectRef: 'prj_abc123',
            provider: 'vercel',
            state: 'ready',
            environment: 'production',
            branch: 'main',
            commitSha: 'a'.repeat(40),
            url: 'https://taskmate-git-main.vercel.app',
        });
    });

    test('each lifecycle event maps to its own state', () => {
        for (const [type, state] of Object.entries(EVENT_STATES)) {
            expect(toDeploymentRecord(event(type)).state).toBe(state);
        }
    });

    test('a failure carries its message; a success clears it', () => {
        const failed = toDeploymentRecord(event('deployment.error', { errorMessage: 'Build failed: exit 1' }));
        expect(failed.state).toBe('error');
        expect(failed.errorMessage).toBe('Build failed: exit 1');

        const ok = toDeploymentRecord(event('deployment.succeeded', { errorMessage: 'stale' }));
        expect(ok.errorMessage).toBeNull();
    });

    test('anything that is not production is a preview', () => {
        const body = event('deployment.succeeded');
        body.payload.deployment.target = null;
        expect(toDeploymentRecord(body).environment).toBe('preview');
    });

    test('returns null for a non-deployment event', () => {
        expect(toDeploymentRecord(event('project.created'))).toBeNull();
        expect(toDeploymentRecord({ type: 'deployment.succeeded' })).toBeNull();
        expect(toDeploymentRecord(null)).toBeNull();
    });

    test('returns null without a deployment id or project id', () => {
        const noProject = event('deployment.succeeded');
        delete noProject.payload.project;
        expect(toDeploymentRecord(noProject)).toBeNull();

        const noId = event('deployment.succeeded');
        delete noId.payload.deployment.id;
        expect(toDeploymentRecord(noId)).toBeNull();
    });

    test('a malformed commit sha is dropped rather than stored', () => {
        const body = event('deployment.succeeded');
        body.payload.deployment.meta.githubCommitSha = 'not-a-sha';
        expect(toDeploymentRecord(body).commitSha).toBeNull();
    });

    test('survives a payload with no git metadata at all', () => {
        const body = event('deployment.created');
        delete body.payload.deployment.meta;
        const record = toDeploymentRecord(body);
        expect(record.branch).toBeNull();
        expect(record.commitSha).toBeNull();
        expect(record.state).toBe('queued');
    });

    test('an absolute url is left alone', () => {
        const body = event('deployment.succeeded');
        body.payload.deployment.url = 'https://already-absolute.vercel.app';
        expect(toDeploymentRecord(body).url).toBe('https://already-absolute.vercel.app');
    });
});
