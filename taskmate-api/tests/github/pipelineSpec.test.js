const YAML = require('yaml');
const spec = require('../../services/github/pipelineSpec');

const tree = (paths) => paths.map((path) => ({ path, type: 'blob' }));
const pkg = (scripts = {}, extra = {}) => JSON.stringify({ name: 'demo', scripts, ...extra });

const viteProject = (overrides = {}) => spec.nodeFacts('.', ['package.json', 'package-lock.json', 'index.html'], {
    packageJson: pkg({ lint: 'eslint .', test: 'vitest run', build: 'vite build' }, { devDependencies: { vite: '^6.0.0' } }),
    ...overrides,
}, ['.']);

const facts = (...projects) => ({ projects });

// Every value a workflow step runs, so tests can look for injected text.
const runScripts = (workflow) => Object.values(workflow.jobs).flatMap((job) => (job.steps || []).map((s) => s.run || '').concat(
    (job.steps || []).map((s) => (s.with && s.with.script) || '')
));

describe('findProjectDirs', () => {
    test('finds Node, Python and static projects, root first, skipping vendored and hidden folders', () => {
        const dirs = spec.findProjectDirs(tree([
            'package.json', 'index.html',
            'api/requirements.txt', 'api/app.py',
            'site/docs/index.html',
            'node_modules/x/package.json',
            '.github/x/package.json',
            'web/build/index.html',
            'a/b/c/package.json',
        ]));
        expect(dirs).toEqual([
            { dir: '.', node: true, python: false, siteDirs: ['.'] },
            { dir: 'api', node: false, python: true, siteDirs: [] },
            { dir: 'site', node: false, python: false, siteDirs: ['docs'] },
        ]);
    });

    test('an index.html in public/ docs/ site/ belongs to the folder above', () => {
        expect(spec.findProjectDirs(tree(['web/package.json', 'web/public/index.html', 'docs/index.html']))).toEqual([
            { dir: '.', node: false, python: false, siteDirs: ['docs'] },
            { dir: 'web', node: true, python: false, siteDirs: ['public'] },
        ]);
    });

    test('ignores unsafe directory names and caps the number of projects', () => {
        expect(spec.findProjectDirs(tree(['we b/package.json', 'x;y/package.json']))).toEqual([]);
        const many = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, '0')}/package.json`);
        expect(spec.findProjectDirs(tree(many))).toHaveLength(6);
    });
});

describe('isLongRunningScript', () => {
    test.each([
        ['dev', 'vite'],
        ['start', 'node src/index.js'],
        ['preview', 'vite preview'],
        ['web', 'vite --port 5173'],
        ['web', 'npx vite'],
        ['web', 'NODE_ENV=development node_modules/.bin/vite'],
        ['web', 'next dev'],
        ['web', 'react-scripts start'],
        ['web', 'ng serve --open'],
        ['web', 'nodemon server.js'],
        ['web', 'tsc --watch'],
        ['web', 'jest --watchAll'],
        ['web', 'tsc -w'],
        ['web', 'eleventy --serve'],
        ['web', 'npm run lint && parcel index.html'],
        ['web', 'cross-env PORT=3000 serve -s build'],
        ['web', 'storybook dev -p 6006'],
        ['web', 'tsc\nnodemon server.js'],
    ])('%s: %s never finishes', (name, command) => {
        expect(spec.isLongRunningScript(name, command)).toBe(true);
    });

    test.each([
        ['build', 'vite build'],
        ['build', 'tsc && vite build --base=./'],
        ['test', 'vitest run'],
        ['test', 'vitest'],
        ['test', 'jest --coverage'],
        ['lint', 'eslint .'],
        ['build', 'react-scripts build'],
        ['build', 'next build'],
        ['build', 'parcel build index.html'],
        ['docs', 'storybook build'],
    ])('%s: %s finishes', (name, command) => {
        expect(spec.isLongRunningScript(name, command)).toBe(false);
    });

    test('follows npm run into other scripts, without looping', () => {
        const scripts = { ci: 'npm run lint && npm run serve:web', 'serve:web': 'vite', lint: 'eslint .', a: 'npm run b', b: 'npm run a' };
        expect(spec.isLongRunningScript('ci', scripts.ci, scripts)).toBe(true);
        expect(spec.isLongRunningScript('a', scripts.a, scripts)).toBe(false);
    });

    test('node facts list them; proposals skip them and validation rejects them', () => {
        const project = spec.nodeFacts('.', ['package.json', 'package-lock.json'], {
            packageJson: pkg({ dev: 'vite', preview: 'vite preview', build: 'vite build', test: 'jest --watch', lint: 'eslint .' }, { devDependencies: { vite: '6' } }),
        }, ['.']);
        expect(project.longRunning).toEqual(['dev', 'preview', 'test']);
        const { spec: proposal, notes } = spec.proposeSpec(facts(project));
        expect(proposal.test).toBeNull();
        expect(proposal.build).toEqual({ kind: 'script', name: 'build' });
        expect(notes.join(' ')).toMatch(/«test».*nunca terminaría/);
        expect(() => spec.validateSpec({ ...proposal, build: { kind: 'script', name: 'dev' } }, facts(project)))
            .toThrow(/"dev" starts a server or a watcher/);
    });
});

describe('versions', () => {
    test('node: .nvmrc and engines', () => {
        expect(spec.parseNodeVersion('v20.11.0')).toBe('20');
        expect(spec.parseNodeVersion('lts/*')).toBeNull();
        expect(spec.parseNodeVersion('16')).toBe('20');
        expect(spec.parseNodeVersion('99')).toBe('26');
        expect(spec.parseNodeVersion('>=18', { isRange: true })).toBe(spec.DEFAULT_NODE);
        expect(spec.parseNodeVersion('^22.1.0', { isRange: true })).toBe('22');
        expect(spec.parseNodeVersion(undefined)).toBeNull();
    });

    test('python: .python-version and requires-python', () => {
        expect(spec.parsePythonVersion('3.11.4')).toBe('3.11');
        expect(spec.parsePythonVersion('3.8')).toBe('3.10');
        expect(spec.parsePythonVersion('3.99')).toBe('3.14');
        expect(spec.parsePythonVersion('>=3.10', { isRange: true })).toBe(spec.DEFAULT_PYTHON);
        expect(spec.parsePythonVersion('~=3.11', { isRange: true })).toBe('3.11');
        expect(spec.parsePythonVersion('three')).toBeNull();
    });
});

describe('facts', () => {
    test('node facts keep only well-formed script names and detect lockfile and framework', () => {
        const project = spec.nodeFacts('web', ['package.json', 'yarn.lock'], {
            packageJson: pkg({ build: 'react-scripts build', 'bad name': 'x', test: 'jest' }, { dependencies: { 'react-scripts': '5.0.1' }, engines: { node: '>=18' } }),
        }, ['public']);
        expect(project).toEqual({
            dir: 'web', stack: 'node', validManifest: true,
            scripts: { build: 'react-scripts build', test: 'jest' }, longRunning: [],
            lockfile: 'yarn', runtime: spec.DEFAULT_NODE, framework: 'cra', siteDirs: ['public'],
        });
    });

    test('an unreadable package.json gives an empty project', () => {
        const project = spec.nodeFacts('.', ['package.json'], { packageJson: '{nope' });
        expect(project.validManifest).toBe(false);
        expect(project.scripts).toEqual({});
    });

    test('python facts: requirement files first, pytest from texts or test files', () => {
        const project = spec.pythonFacts('api', ['requirements-dev.txt', 'requirements.txt', 'pyproject.toml', 'app.py'], {
            requirements: { 'requirements.txt': 'fastapi\n', 'requirements-dev.txt': 'pytest==8\n' },
            pyproject: '[project]\nrequires-python = ">=3.11"\n',
        });
        expect(project.requirementFiles).toEqual(['requirements.txt', 'requirements-dev.txt']);
        expect(project.usesPytest).toBe(true);
        expect(project.runtime).toBe(spec.DEFAULT_PYTHON);
        expect(spec.pythonFacts('.', ['tests/test_app.py', 'pyproject.toml']).usesPytest).toBe(true);
        expect(spec.pythonFacts('.', ['main.py', 'requirements.txt']).usesPytest).toBe(false);
    });
});

describe('proposeSpec', () => {
    test('picks the deployable Vite project with lint, tests, build and Pages', () => {
        const { spec: proposal, notes } = spec.proposeSpec(facts(viteProject()));
        expect(proposal).toEqual({
            version: 1,
            project: { dir: '.', stack: 'node' },
            runtime: spec.DEFAULT_NODE,
            install: { kind: 'npm-ci' },
            lint: { kind: 'script', name: 'lint' },
            audit: false,
            test: { kind: 'script', name: 'test' },
            build: { kind: 'script', name: 'build' },
            deploy: { target: 'github-pages', framework: 'vite', outputDir: 'dist' },
        });
        expect(notes).toEqual([]);
    });

    test('without lint the static analysis is npm audit; the npm placeholder test is not a test', () => {
        const project = spec.nodeFacts('.', ['package.json'], {
            packageJson: pkg({ start: 'node src/index.js', test: 'echo "Error: no test specified" && exit 1' }),
        });
        const { spec: proposal, notes } = spec.proposeSpec(facts(project));
        expect(proposal.install).toEqual({ kind: 'npm-install' });
        expect(proposal.lint).toBeNull();
        expect(proposal.audit).toBe(true);
        expect(proposal.test).toBeNull();
        expect(proposal.deploy).toBeNull();
        expect(notes.join(' ')).toMatch(/npm audit/);
        expect(notes.join(' ')).toMatch(/no tendrá deploy/);
    });

    test('python projects get Ruff and pytest, no deploy', () => {
        const project = spec.pythonFacts('api', ['requirements.txt', 'tests/test_x.py'], { requirements: { 'requirements.txt': 'x' } });
        const { spec: proposal } = spec.proposeSpec(facts(project));
        expect(proposal).toMatchObject({
            project: { dir: 'api', stack: 'python' },
            install: { kind: 'pip', files: ['requirements.txt'] },
            lint: { kind: 'ruff' },
            test: { kind: 'pytest' },
            deploy: null,
        });
    });

    test('a static site deploys its first site folder; dir/stack pick another project', () => {
        const f = facts(spec.pythonFacts('.', ['requirements.txt']), spec.staticFacts('docs', ['.']));
        expect(spec.proposeSpec(f).spec.project).toEqual({ dir: 'docs', stack: 'static' });
        expect(spec.proposeSpec(f).spec.deploy).toEqual({ target: 'github-pages', framework: 'static', outputDir: '.' });
        expect(spec.proposeSpec(f, { dir: '.', stack: 'python' }).spec.project).toEqual({ dir: '.', stack: 'python' });
        expect(() => spec.proposeSpec(f, { dir: 'nope' })).toThrow(expect.objectContaining({ code: 'INVALID_PIPELINE' }));
    });

    test('a repository without projects is unsupported', () => {
        expect(() => spec.proposeSpec(facts())).toThrow(expect.objectContaining({ code: 'PIPELINE_UNSUPPORTED', status: 422 }));
    });

    test('every proposal validates', () => {
        const f = facts(
            viteProject(),
            spec.nodeFacts('web', ['package.json'], { packageJson: pkg({ build: 'react-scripts build' }, { dependencies: { 'react-scripts': '5' } }) }, ['public']),
            spec.pythonFacts('api', ['pyproject.toml']),
            spec.staticFacts('site', ['.', 'docs']),
        );
        for (const project of f.projects) {
            const { spec: proposal } = spec.proposeSpec(f, { dir: project.dir, stack: project.stack });
            expect(spec.validateSpec(proposal, f)).toEqual(proposal);
        }
    });
});

describe('validateSpec', () => {
    const f = facts(viteProject(), spec.pythonFacts('api', ['requirements.txt', 'pyproject.toml']), spec.staticFacts('site', ['docs']));
    const base = () => JSON.parse(JSON.stringify(spec.proposeSpec(f).spec));
    const rejects = (mutate, pattern) => {
        const s = base();
        mutate(s);
        expect(() => spec.validateSpec(s, f)).toThrow(expect.objectContaining({ code: 'INVALID_PIPELINE', status: 400, message: expect.stringMatching(pattern) }));
    };

    test('rejects unknown fields anywhere', () => {
        rejects((s) => { s.extra = 1; }, /unknown fields: extra/);
        rejects((s) => { s.lint.command = 'rm -rf /'; }, /lint has unknown fields/);
        rejects((s) => { s.deploy.token = 'x'; }, /deploy has unknown fields/);
        rejects((s) => { s.project.path = '.'; }, /project has unknown fields/);
    });

    test('only scripts that exist in package.json, with safe names', () => {
        rejects((s) => { s.test = { kind: 'script', name: 'deploy' }; }, /no "deploy" script/);
        rejects((s) => { s.build = { kind: 'script', name: 'build && curl evil' }; }, /build is invalid/);
        rejects((s) => { s.lint = { kind: 'shell', name: 'lint' }; }, /lint is invalid/);
    });

    test('versions, install and project must match the repository', () => {
        rejects((s) => { s.runtime = '16'; }, /runtime must be one of/);
        rejects((s) => { s.version = 2; }, /Unsupported spec version/);
        rejects((s) => { s.project.dir = '../x'; }, /project is invalid/);
        rejects((s) => { s.project.dir = 'other'; }, /not found/);
        rejects((s) => { s.install = { kind: 'yarn' }; }, /install is invalid/);
        const noLock = facts(spec.nodeFacts('.', ['package.json'], { packageJson: pkg({ test: 'jest' }) }));
        const s = spec.proposeSpec(noLock).spec;
        s.install = { kind: 'npm-ci' };
        expect(() => spec.validateSpec(s, noLock)).toThrow(/package-lock/);
    });

    test('deploy rules', () => {
        rejects((s) => { s.deploy.target = 'vercel'; }, /github-pages/);
        rejects((s) => { s.deploy.outputDir = '../../etc'; }, /outputDir is invalid/);
        rejects((s) => { s.deploy.framework = 'next'; }, /framework is invalid/);
        rejects((s) => { s.build = null; }, /needs a build step/);
        rejects((s) => { s.deploy.framework = 'static'; s.deploy.outputDir = '.'; }, /whole Node.js project/);
    });

    test('python and static specs', () => {
        const py = spec.proposeSpec(f, { dir: 'api', stack: 'python' }).spec;
        expect(spec.validateSpec(py, f).install).toEqual({ kind: 'pip', files: ['requirements.txt'] });
        expect(spec.validateSpec({ ...py, install: { kind: 'pip-project' } }, f).install).toEqual({ kind: 'pip-project' });
        expect(() => spec.validateSpec({ ...py, install: { kind: 'pip', files: ['../secrets.txt'] } }, f)).toThrow(/requirement files/);
        expect(() => spec.validateSpec({ ...py, audit: true }, f)).toThrow(/only available for Node/);
        expect(() => spec.validateSpec({ ...py, deploy: { target: 'github-pages', framework: 'static', outputDir: 'docs' } }, f)).toThrow(/Python projects/);

        const site = spec.proposeSpec(f, { dir: 'site', stack: 'static' }).spec;
        expect(spec.validateSpec(site, f).deploy.outputDir).toBe('docs');
        expect(() => spec.validateSpec({ ...site, deploy: null }, f)).toThrow(/needs its deploy/);
        expect(() => spec.validateSpec({ ...site, deploy: { ...site.deploy, outputDir: 'public' } }, f)).toThrow(/index.html/);
        expect(() => spec.validateSpec({ ...site, runtime: '24' }, f)).toThrow(/not available for a static site/);
    });

    test('a pipeline needs at least one step', () => {
        const project = spec.nodeFacts('.', ['package.json'], { packageJson: pkg({}) });
        const s = { version: 1, project: { dir: '.', stack: 'node' }, runtime: '24', install: { kind: 'npm-install' }, lint: null, audit: false, test: null, build: null, deploy: null };
        expect(spec.validateSpec(s, facts(project)).install).toEqual({ kind: 'npm-install' });
    });

    test('non-object specs are rejected', () => {
        expect(() => spec.validateSpec(null, f)).toThrow(/spec must be an object/);
        expect(() => spec.validateSpec([], f)).toThrow(/spec must be an object/);
    });
});

describe('renderWorkflow', () => {
    const f = facts(
        viteProject(),
        spec.nodeFacts('web', ['package.json'], { packageJson: pkg({ build: 'react-scripts build', test: 'react-scripts test' }, { dependencies: { 'react-scripts': '5' } }) }, ['public']),
        spec.pythonFacts('api', ['requirements.txt', 'requirements-dev.txt', 'tests/test_x.py']),
        spec.staticFacts('site', ['.']),
    );
    const render = (dir, stack, mutate = (s) => s) => {
        const validated = spec.validateSpec(mutate(spec.proposeSpec(f, { dir, stack }).spec), f);
        const text = spec.renderWorkflow(validated);
        return { text, workflow: YAML.parse(text) };
    };
    const stepNamed = (job, name) => job.steps.find((s) => s.name === name);
    const assembleOf = (workflow) => workflow.jobs.build.steps.find((s) => s.name.startsWith('Armar el sitio'));

    test('vite: valid YAML with CI, a build job, a deploy job and the TaskMate marker', () => {
        const { text, workflow } = render('.', 'node');
        expect(spec.isTaskmateWorkflow(text)).toBe(true);
        expect(Object.keys(workflow.on)).toEqual(['push', 'pull_request', 'workflow_dispatch']);
        expect(workflow.on.workflow_dispatch.inputs.environment.options).toEqual(['none', 'staging', 'production']);
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(Object.keys(workflow.jobs)).toEqual(['ci', 'build', 'deploy', 'close']);
        expect(workflow.jobs.ci.steps.map((s) => s.name)).toEqual(['Checkout', 'Node.js 24', 'Instalar dependencias', 'Análisis estático', 'Pruebas', 'Build']);
        expect(workflow.jobs.ci.steps.map((s) => s.run).filter(Boolean)).toEqual(['npm ci', 'npm run lint', 'npm test', 'npm run build']);
        expect(workflow.jobs.build.needs).toBe('ci');
        expect(workflow.jobs.deploy.needs).toBe('build');
        expect(workflow.jobs.build.steps.map((s) => s.name)).toEqual([
            'Versiones a publicar', 'Configurar GitHub Pages', 'Node.js 24', 'Descargar el sitio publicado',
            'Checkout de la versión a desplegar', 'Build de la versión a desplegar',
            'Checkout del otro entorno (respaldo)', 'Build del otro entorno (respaldo)',
            'Armar el sitio (producción en /, staging en /staging/)', 'Subir el sitio', 'Registrar el deploy fallido',
        ]);
        const build = stepNamed(workflow.jobs.build, 'Build de la versión a desplegar');
        expect(build.env.BASE_PATH).toBe('${{ steps.pages.outputs.base_path }}${{ steps.versions.outputs.target_path }}');
        expect(build.run).toBe('npm ci\nnpm run build -- --base="$BASE_PATH"\n');
        expect(build['working-directory']).toBe('_taskmate/target');
    });

    test('cancelling the run stops the deploy: !cancelled(), never always() where repository code runs', () => {
        const { workflow } = render('.', 'node');
        // Only the close job (no repository code, writes a status at most) keeps running on cancel.
        const withAlways = Object.entries(workflow.jobs).filter(([, job]) => /always\(\)/.test(JSON.stringify(job))).map(([id]) => id);
        expect(withAlways).toEqual(['close']);
        expect(workflow.jobs.build.if.trim()).toMatch(/^!cancelled\(\) && github\.ref_name == github\.event\.repository\.default_branch && \(/);
        expect(workflow.jobs.build.if).toContain("(github.event_name == 'push' && needs.ci.result == 'success')");
        expect(workflow.jobs.build.if).toContain("(github.event_name == 'workflow_dispatch' && inputs.environment != 'none')");
        expect(workflow.jobs.deploy.if).toBe("!cancelled() && needs.build.result == 'success' && needs.build.outputs.skip != 'true'");
    });

    test('concurrency: CI per event and ref, never cancelled on the default branch; deploy runs queue, none dropped', () => {
        const { workflow } = render('.', 'node');
        expect(workflow.jobs.ci.concurrency).toEqual({
            group: 'taskmate-ci-${{ github.event_name }}-${{ github.ref }}',
            'cancel-in-progress': '${{ github.ref_name != github.event.repository.default_branch }}',
        });
        // The whole run holds the group, so another run's build cannot slip in between build and deploy.
        expect(workflow.concurrency['cancel-in-progress']).toBe(false);
        expect(workflow.concurrency.queue).toBe('max');
        const group = workflow.concurrency.group.replace(/\s+/g, ' ');
        expect(group).toBe("${{ github.ref_name == github.event.repository.default_branch && (github.event_name == 'push' || "
            + "(github.event_name == 'workflow_dispatch' && inputs.environment != 'none')) && 'taskmate-pages' || format('taskmate-run-{0}', github.run_id) }}");
        expect(workflow.jobs.build.concurrency).toBeUndefined();
        expect(workflow.jobs.deploy.concurrency).toBeUndefined();
        // Without a deploy there is nothing to serialize.
        expect(render('api', 'python').workflow.concurrency).toBeUndefined();
    });

    test('dependencies are installed and built without the OIDC token or Pages write access', () => {
        const { workflow } = render('.', 'node');
        const { build, deploy } = workflow.jobs;
        expect(build.permissions).toEqual({ actions: 'read', contents: 'read', deployments: 'write', pages: 'read' });
        expect(deploy.permissions).toEqual({ actions: 'read', deployments: 'write', 'id-token': 'write', pages: 'write' });
        expect(build.environment).toBeUndefined();
        expect(deploy.environment).toEqual({ name: 'github-pages', url: '${{ steps.publish.outputs.page_url }}' });
        // The deploy job runs no code of the repository: no checkout, no run steps.
        expect(deploy.steps.every((s) => !s.run && [spec.ACTIONS.deployPages, spec.ACTIONS.githubScript].includes(s.uses))).toBe(true);
        expect(build.outputs).toEqual({
            skip: '${{ steps.versions.outputs.skip }}',
            target: '${{ steps.versions.outputs.target }}',
            deployment_id: '${{ steps.versions.outputs.deployment_id }}',
            attempt: '${{ github.run_attempt }}',
        });
        expect(stepNamed(deploy, 'Registrar el deploy').env).toEqual({
            DEPLOYMENT_ID: '${{ needs.build.outputs.deployment_id }}',
            TARGET_ENV: '${{ needs.build.outputs.target }}',
            PAGE_URL: '${{ steps.publish.outputs.page_url }}',
        });
        expect(stepNamed(build, 'Registrar el deploy fallido').if).toBe("(failure() || cancelled()) && steps.versions.outputs.deployment_id != ''");
    });

    test('re-running only the deploy job never publishes an earlier attempt\'s build', () => {
        const { workflow } = render('.', 'node');
        const { deploy } = workflow.jobs;
        // First the attempt check, then the publish; nothing else runs before it.
        expect(deploy.steps.map((s) => s.id || s.name)).toEqual(['current', 'publish', 'Registrar el deploy', 'Registrar el deploy fallido']);
        expect(deploy.steps[0]).toMatchObject({
            name: 'Comprobar que el build es de este intento',
            uses: spec.ACTIONS.githubScript,
            env: { BUILD_ATTEMPT: '${{ needs.build.outputs.attempt }}', RUN_ATTEMPT: '${{ github.run_attempt }}' },
        });
        expect(deploy.steps[0].if).toBeUndefined();
        expect(deploy.steps[1].if).toBeUndefined();
        // A refused re-run writes no status on the old deployment (it may be the live one).
        expect(stepNamed(deploy, 'Registrar el deploy').if).toBe("steps.current.outcome == 'success'");
        expect(stepNamed(deploy, 'Registrar el deploy fallido').if)
            .toBe("(failure() || cancelled()) && needs.build.outputs.deployment_id != '' && steps.current.outcome == 'success'");
    });

    test('a close job records the failure when the deploy job never ran its recorders', () => {
        const { workflow } = render('.', 'node');
        const { close } = workflow.jobs;
        expect(close.needs).toEqual(['build', 'deploy']);
        expect(close.if.replace(/\s+/g, ' ').trim()).toBe("always() && needs.build.outputs.deployment_id != '' "
            + "&& needs.build.outputs.attempt == github.run_attempt && needs.deploy.result != 'success'");
        expect(close.permissions).toEqual({ deployments: 'write' });
        expect(close['timeout-minutes']).toBe(5);
        expect(close.environment).toBeUndefined();
        expect(close.steps).toHaveLength(1);
        expect(close.steps[0]).toMatchObject({ uses: spec.ACTIONS.githubScript, env: { DEPLOYMENT_ID: '${{ needs.build.outputs.deployment_id }}' } });
        expect(close.steps[0].run).toBeUndefined();
        // The same recorder as the other jobs, which never overwrites a final status.
        expect(close.steps[0].with.script).toBe(stepNamed(workflow.jobs.build, 'Registrar el deploy fallido').with.script);
        expect(close.steps[0].with.script).toContain("if (['success', 'failure', 'error', 'inactive'].includes(last))");
        expect(render('api', 'python').workflow.jobs.close).toBeUndefined();
    });

    test('only the target version is built; the other environment comes from the published site', () => {
        const { workflow } = render('.', 'node');
        const { build } = workflow.jobs;
        const download = stepNamed(build, 'Descargar el sitio publicado');
        expect(download).toMatchObject({
            id: 'previous',
            uses: spec.ACTIONS.downloadArtifact,
            'continue-on-error': true,
            if: "steps.versions.outputs.skip != 'true' && steps.versions.outputs.base_run != ''",
            with: { name: 'github-pages', 'run-id': '${{ steps.versions.outputs.base_run }}', 'github-token': '${{ github.token }}', path: '_taskmate/previous' },
        });
        expect(stepNamed(build, 'Subir el sitio').with).toEqual({ path: '_site', 'retention-days': 90 });
        // The fallback rebuild only runs when that site cannot be downloaded, and never fails the deploy.
        const otherCheckout = stepNamed(build, 'Checkout del otro entorno (respaldo)');
        const otherBuild = stepNamed(build, 'Build del otro entorno (respaldo)');
        expect(otherCheckout.if).toBe("steps.versions.outputs.skip != 'true' && steps.versions.outputs.other_version != '' "
            + "&& (steps.previous.outcome != 'success' || hashFiles('_taskmate/previous/artifact.tar') == '')");
        expect(otherCheckout.with.ref).toBe('${{ steps.versions.outputs.other_version }}');
        expect(otherCheckout['continue-on-error']).toBe(true);
        expect(otherBuild).toMatchObject({ if: "steps.other_checkout.outcome == 'success'", 'continue-on-error': true, 'working-directory': '_taskmate/other' });
        expect(otherBuild.env.BASE_PATH).toBe('${{ steps.pages.outputs.base_path }}${{ steps.versions.outputs.other_path }}');
        expect(stepNamed(build, 'Checkout de la versión a desplegar')['continue-on-error']).toBeUndefined();
        const assemble = assembleOf(workflow);
        expect(assemble.env).toEqual({
            TARGET_ENV: '${{ steps.versions.outputs.target }}',
            OTHER_VERSION: '${{ steps.versions.outputs.other_version }}',
            PREVIOUS: '${{ steps.previous.outcome }}',
            OTHER_BUILT: '${{ steps.other_build.outcome }}',
        });
        expect(assemble.run).toContain("tar -C _site -xf '_taskmate/previous/artifact.tar'");
        expect(assemble.run).toContain(`if [ "$OTHER_BUILT" = success ] && copy_env '_taskmate/other/dist' "$OTHER_ENV"; then`);
        expect(assemble.run).toContain('::warning::');
        expect(assemble.run).toMatch(/clear_env "\$TARGET_ENV"\ncopy_env '_taskmate\/target\/dist' "\$TARGET_ENV"\n$/);
        // Production is everything but staging/: its own staging/ folder never overwrites staging.
        expect(assemble.run).toContain('copy_site "$1" _site --exclude=./staging');
    });

    test('a skipped deploy (stale push re-run) runs nothing after the versions step', () => {
        const { workflow } = render('.', 'node');
        const [versions, ...rest] = workflow.jobs.build.steps;
        expect(versions.id).toBe('versions');
        expect(versions.with.script).toContain("github.rest.git.getRef({ owner, repo, ref: 'heads/' + branch })");
        for (const s of rest) {
            const guarded = /steps\.versions\.outputs\.skip != 'true'/.test(s.if || '')
                || /^steps\.(target|other)_checkout\.outcome == 'success'$/.test(s.if || '')
                || /steps\.versions\.outputs\.deployment_id != ''/.test(s.if || '');
            expect([s.name, guarded]).toEqual([s.name, true]);
        }
    });

    test('the deployment id is an output before anything else can fail', () => {
        const { workflow } = render('.', 'node');
        const script = workflow.jobs.build.steps[0].with.script;
        const create = script.indexOf('github.rest.repos.createDeployment(');
        const output = script.indexOf("core.setOutput('deployment_id'");
        const inProgress = script.indexOf("state: 'in_progress'");
        expect(create).toBeGreaterThan(0);
        expect(output).toBeGreaterThan(create);
        expect(inProgress).toBeGreaterThan(output);
    });

    test('workflow inputs never reach a shell: they go through env and are validated in the script', () => {
        for (const [dir, stack] of [['.', 'node'], ['web', 'node'], ['site', 'static'], ['api', 'python']]) {
            const { workflow } = render(dir, stack);
            for (const script of runScripts(workflow)) {
                expect(script).not.toMatch(/\$\{\{\s*(inputs|github\.event)/);
            }
        }
        const { workflow } = render('.', 'node');
        const versions = workflow.jobs.build.steps.find((s) => s.id === 'versions');
        expect(versions.env.TARGET_VERSION).toBe("${{ github.event_name == 'push' && github.sha || inputs.version }}");
        expect(versions.with.script).toContain('if (!SHA.test(version)) throw');
        expect(versions.with.script).toContain("const TASK = 'deploy:taskmate';");
    });

    test('cra in a subfolder: working directory, PUBLIC_URL as is and no npm cache without a lockfile', () => {
        const { workflow } = render('web', 'node');
        expect(workflow.jobs.ci.defaults.run['working-directory']).toBe('web');
        expect(workflow.jobs.ci.steps[1].with).toEqual({ 'node-version': '24', 'package-manager-cache': false });
        const build = stepNamed(workflow.jobs.build, 'Build de la versión a desplegar');
        expect(build['working-directory']).toBe('_taskmate/target/web');
        // "/" (user sites, custom domains) must reach CRA as "/", not as "" (which CRA ignores).
        expect(build.run).toBe('npm install\nPUBLIC_URL="$BASE_PATH" npm run build\n');
        expect(stepNamed(workflow.jobs.build, 'Build del otro entorno (respaldo)')['working-directory']).toBe('_taskmate/other/web');
        expect(assembleOf(workflow).run).toContain("copy_env '_taskmate/target/web/build' \"$TARGET_ENV\"");
        expect(workflow.jobs.ci.steps.some((s) => s.name === 'Auditoría de dependencias')).toBe(true);
    });

    test('python: setup-python, requirement files, Ruff and pytest with GitHub annotations; no deploy jobs', () => {
        const { workflow } = render('api', 'python');
        expect(Object.keys(workflow.jobs)).toEqual(['ci']);
        expect(workflow.jobs.ci.steps[1].uses).toBe(spec.ACTIONS.setupPython);
        expect(workflow.jobs.ci.steps.map((s) => s.run).filter(Boolean)).toEqual([
            'python -m pip install --upgrade pip\npython -m pip install -r requirements.txt\npython -m pip install -r requirements-dev.txt\n',
            'python -m pip install ruff\nruff check --output-format=github .\n',
            'python -m pip install pytest pytest-github-actions-annotate-failures\npython -m pytest\n',
        ]);
    });

    test('static site: no runtime, checks index.html and publishes the folder without .git', () => {
        const { workflow } = render('site', 'static');
        expect(workflow.jobs.ci.steps.map((s) => s.name)).toEqual(['Checkout', 'Verificar el sitio']);
        expect(workflow.jobs.build.steps.some((s) => (s.uses || '').startsWith('actions/setup-node'))).toBe(false);
        expect(workflow.jobs.build.steps.some((s) => s.run && s.name.startsWith('Build'))).toBe(false);
        const assemble = assembleOf(workflow);
        expect(assemble.env.OTHER_BUILT).toBe('${{ steps.other_checkout.outcome }}');
        expect(assemble.run).toContain("copy_env '_taskmate/target/site' \"$TARGET_ENV\"");
        expect(assemble.run).toContain('--exclude=./.git');
    });

    test('every single-line run is quoted, so a script name ending in ":" stays valid YAML', () => {
        const project = spec.nodeFacts('.', ['package.json', 'package-lock.json'], {
            packageJson: pkg({ 'lint:': 'eslint .', test: 'jest', build: 'vite build' }, { devDependencies: { vite: '6' } }),
        }, ['.']);
        const lintFacts = facts(project);
        const s = spec.proposeSpec(lintFacts).spec;
        s.lint = { kind: 'script', name: 'lint:' };
        const text = spec.renderWorkflow(spec.validateSpec(s, lintFacts));
        expect(text).toContain("run: 'npm run lint:'");
        expect(text).not.toMatch(/^\s*run: (?!['|])/m);
        expect(YAML.parse(text).jobs.ci.steps.find((step) => step.name === 'Análisis estático').run).toBe('npm run lint:');
        // Quoting does not change what runs.
        const check = render('site', 'static').workflow.jobs.ci.steps[1].run;
        expect(check).toBe('test -f \'index.html\' || { echo "::error::Falta index.html"; exit 1; }');
    });

    test('rendering is deterministic', () => {
        expect(render('.', 'node').text).toBe(render('.', 'node').text);
    });
});

describe('Vite base path', () => {
    test.each([
        'vite build',
        'tsc -b && vite build',
        'vue-tsc --noEmit && vite build --mode production',
        'npx vite build',
        'cross-env NODE_ENV=production vite build',
        'node_modules/.bin/vite build',
    ])('%s takes --base', (command) => {
        expect(spec.viteBuildTakesBase(command)).toBe(true);
    });

    test.each([
        'vite build && cp dist/index.html dist/404.html',
        'vite build --base=./',
        'vite build --base /x/',
        'npm run build:vite',
        'vite build;',
        'vite build | tee build.log',
        'vite build\ncp dist/index.html dist/404.html',
        'vite',
        'tsc',
        `vite build ${'x'.repeat(200)}`,
    ])('%s does not', (command) => {
        expect(spec.viteBuildTakesBase(command)).toBe(false);
    });

    const project = (build) => spec.nodeFacts('.', ['package.json', 'package-lock.json'], {
        packageJson: pkg({ build, test: 'vitest run' }, { devDependencies: { vite: '6' } }),
    }, ['.']);

    test('proposals do not deploy a Vite build that would not get --base, and say why', () => {
        const { spec: proposal, notes } = spec.proposeSpec(facts(project('vite build && cp dist/index.html dist/404.html')));
        expect(proposal.build).toEqual({ kind: 'script', name: 'build' });
        expect(proposal.deploy).toBeNull();
        expect(notes.join(' ')).toMatch(/no termina en «vite build»/);
        expect(spec.proposeSpec(facts(project('tsc -b && vite build'))).spec.deploy).toEqual({ target: 'github-pages', framework: 'vite', outputDir: 'dist' });
    });

    test('validation rejects a Vite deploy whose build script does not end in vite build', () => {
        const f = facts(project('vite build && cp dist/index.html dist/404.html'));
        const s = { ...spec.proposeSpec(f).spec, deploy: { target: 'github-pages', framework: 'vite', outputDir: 'dist' } };
        expect(() => spec.validateSpec(s, f)).toThrow(expect.objectContaining({
            code: 'INVALID_PIPELINE',
            message: expect.stringMatching(/"build" script must end with a plain "vite build"/),
        }));
        // CRA gets its base path through PUBLIC_URL, whatever the script looks like.
        expect(spec.validateSpec({ ...s, deploy: { ...s.deploy, framework: 'cra', outputDir: 'build' } }, f).deploy.framework).toBe('cra');
    });
});

describe('static sites never publish other projects', () => {
    const api = spec.pythonFacts('api', ['requirements.txt']);

    test('a site at the repository root is skipped when the repository has other projects', () => {
        const f = facts(spec.staticFacts('.', ['.']), api);
        const { spec: proposal, notes } = spec.proposeSpec(f);
        expect(proposal.project).toEqual({ dir: 'api', stack: 'python' });
        expect(notes.join(' ')).toMatch(/No se propone publicar el sitio estático de la raíz del repositorio/);
        expect(() => spec.proposeSpec(f, { dir: '.', stack: 'static' })).toThrow(expect.objectContaining({ code: 'INVALID_PIPELINE' }));
        const s = { version: 1, project: { dir: '.', stack: 'static' }, runtime: null, install: null, lint: null, audit: false, test: null, build: null, deploy: { target: 'github-pages', framework: 'static', outputDir: '.' } };
        expect(() => spec.validateSpec(s, f)).toThrow(expect.objectContaining({ code: 'INVALID_PIPELINE', message: expect.stringMatching(/other projects/) }));
    });

    test('another site folder of the same project is used instead', () => {
        const f = facts(spec.staticFacts('.', ['.', 'docs']), api);
        const { spec: proposal, notes } = spec.proposeSpec(f);
        expect(proposal.project).toEqual({ dir: '.', stack: 'static' });
        expect(proposal.deploy.outputDir).toBe('docs');
        expect(notes.join(' ')).toMatch(/Se publica la carpeta «docs»/);
        expect(spec.validateSpec(proposal, f)).toEqual(proposal);
    });

    // What pipelineService builds from the tree: a folder with an index.html and no package.json is a static site.
    const factsOf = (paths) => facts(...spec.findProjectDirs(tree(paths)).flatMap((d) => [
        ...(d.node ? [spec.nodeFacts(d.dir, [], { packageJson: pkg({}) }, d.siteDirs)] : []),
        ...(d.python ? [spec.pythonFacts(d.dir, ['requirements.txt'])] : []),
        ...(!d.node && d.siteDirs.length ? [spec.staticFacts(d.dir, d.siteDirs)] : []),
    ]));
    const multiPage = ['index.html', 'about/index.html', 'blog/index.html', 'blog/post-1/index.html', 'css/site.css'];

    test('a multi-page site at the root is published whole: its sub-pages are not other projects', () => {
        const f = factsOf(multiPage);
        expect(f.projects.map((p) => `${p.dir}:${p.stack}`)).toEqual(['.:static', 'about:static', 'blog:static', 'blog/post-1:static']);
        const { spec: proposal, notes } = spec.proposeSpec(f);
        expect(proposal.project).toEqual({ dir: '.', stack: 'static' });
        expect(proposal.deploy).toEqual({ target: 'github-pages', framework: 'static', outputDir: '.' });
        expect(notes).toEqual([]);
        expect(spec.validateSpec(proposal, f)).toEqual(proposal);
        // A sub-page can still be picked on purpose, and a static site inside a static site is fine.
        expect(spec.validateSpec(spec.proposeSpec(f, { dir: 'blog', stack: 'static' }).spec, f).deploy.outputDir).toBe('.');
    });

    test('the same site with an API inside is still rejected, and none of its pages is proposed as the whole site', () => {
        const f = factsOf([...multiPage, 'api/requirements.txt', 'api/main.py']);
        const { spec: proposal, notes } = spec.proposeSpec(f);
        expect(proposal.project).toEqual({ dir: 'api', stack: 'python' });
        expect(notes.join(' ')).toMatch(/No se propone publicar el sitio estático de la raíz del repositorio: publicaría también el código/);
        expect(() => spec.proposeSpec(f, { dir: '.', stack: 'static' })).toThrow(expect.objectContaining({ code: 'INVALID_PIPELINE' }));
        const s = { version: 1, project: { dir: '.', stack: 'static' }, runtime: null, install: null, lint: null, audit: false, test: null, build: null, deploy: { target: 'github-pages', framework: 'static', outputDir: '.' } };
        expect(() => spec.validateSpec(s, f)).toThrow(expect.objectContaining({ code: 'INVALID_PIPELINE', message: expect.stringMatching(/other projects/) }));
        // With a Node.js tool instead, the tool is proposed (CI only), never a page of the site.
        const node = factsOf([...multiPage, 'tools/package.json']);
        expect(spec.proposeSpec(node).spec.project).toEqual({ dir: 'tools', stack: 'node' });
    });

    test('a site and a Python app in the same folder: the site would publish the app', () => {
        const f = factsOf(['index.html', 'requirements.txt', 'app.py']);
        expect(f.projects.map((p) => `${p.dir}:${p.stack}`)).toEqual(['.:python', '.:static']);
        expect(spec.proposeSpec(f).spec.project).toEqual({ dir: '.', stack: 'python' });
        expect(() => spec.proposeSpec(f, { dir: '.', stack: 'static' })).toThrow(/other projects/);
    });

    test('a folder that holds another project is rejected; a lone site at the root is fine', () => {
        const nested = facts(spec.staticFacts('site', ['.']), spec.pythonFacts('site/api', ['requirements.txt']));
        expect(() => spec.proposeSpec(nested, { dir: 'site', stack: 'static' })).toThrow(/other projects/);
        const lone = facts(spec.staticFacts('.', ['.']));
        expect(spec.validateSpec(spec.proposeSpec(lone).spec, lone).deploy.outputDir).toBe('.');
    });
});

describe('describeStages', () => {
    test('lists what each stage runs, in order', () => {
        const f = facts(viteProject());
        const stages = spec.describeStages(spec.proposeSpec(f).spec);
        expect(stages.map((s) => s.key)).toEqual(['install', 'lint', 'test', 'build', 'deploy']);
        expect(stages[1]).toEqual({ key: 'lint', label: 'Análisis estático', commands: ['npm run lint'] });
        expect(stages[4].commands.join(' ')).toMatch(/solo se construye la versión que se despliega/);
    });

    test('python stages show the annotated Ruff command', () => {
        const f = facts(spec.pythonFacts('.', ['requirements.txt', 'tests/test_x.py']));
        const stages = spec.describeStages(spec.proposeSpec(f).spec);
        expect(stages.find((s) => s.key === 'lint').commands).toEqual(['ruff check --output-format=github .']);
        expect(stages.find((s) => s.key === 'test').commands).toEqual(['python -m pytest']);
    });
});

describe('isTaskmateWorkflow', () => {
    test('only files with the marker line', () => {
        expect(spec.isTaskmateWorkflow('name: x\n# taskmate-pipeline: 1\n')).toBe(true);
        expect(spec.isTaskmateWorkflow('name: x\n# taskmate-pipeline: one\n')).toBe(false);
        expect(spec.templateVersionOf('name: x\n# taskmate-pipeline: 1\n')).toBe(1);
        expect(spec.templateVersionOf('name: x\n')).toBeNull();
        expect(spec.TEMPLATE_VERSION).toBeGreaterThan(1);
        expect(spec.templateVersionOf(spec.renderWorkflow(spec.proposeSpec(facts(viteProject())).spec))).toBe(spec.TEMPLATE_VERSION);
        expect(spec.isTaskmateWorkflow(null)).toBe(false);
    });
});
