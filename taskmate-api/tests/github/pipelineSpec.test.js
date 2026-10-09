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
            scripts: { build: 'react-scripts build', test: 'jest' },
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
    const render = (dir, stack) => {
        const validated = spec.validateSpec(spec.proposeSpec(f, { dir, stack }).spec, f);
        const text = spec.renderWorkflow(validated);
        return { text, workflow: YAML.parse(text) };
    };

    test('vite: valid YAML with CI, deploy to Pages and the TaskMate marker', () => {
        const { text, workflow } = render('.', 'node');
        expect(spec.isTaskmateWorkflow(text)).toBe(true);
        expect(Object.keys(workflow.on)).toEqual(['push', 'pull_request', 'workflow_dispatch']);
        expect(workflow.on.workflow_dispatch.inputs.environment.options).toEqual(['none', 'staging', 'production']);
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(workflow.jobs.ci.steps.map((s) => s.name)).toEqual(['Checkout', 'Node.js 24', 'Instalar dependencias', 'Análisis estático', 'Pruebas', 'Build']);
        expect(workflow.jobs.ci.steps.map((s) => s.run).filter(Boolean)).toEqual(['npm ci', 'npm run lint', 'npm test', 'npm run build']);
        expect(workflow.jobs.deploy.needs).toBe('ci');
        expect(workflow.jobs.deploy.permissions).toEqual({ actions: 'read', contents: 'read', deployments: 'write', 'id-token': 'write', pages: 'write' });
        expect(workflow.jobs.deploy.environment.name).toBe('github-pages');
        const build = workflow.jobs.deploy.steps.find((s) => s.name === 'Build de staging');
        expect(build.env.BASE_PATH).toBe('${{ steps.pages.outputs.base_path }}/staging/');
        expect(build.run).toContain('npm run build -- --base="$BASE_PATH"');
        const assemble = workflow.jobs.deploy.steps.find((s) => s.name.startsWith('Armar el sitio'));
        expect(assemble.run).toContain("copy_site '_taskmate/production/dist' _site");
        expect(assemble.run).toContain("copy_site '_taskmate/staging/dist' _site/staging");
    });

    test('workflow inputs never reach a shell: they go through env and are validated in the script', () => {
        for (const [dir, stack] of [['.', 'node'], ['web', 'node'], ['site', 'static'], ['api', 'python']]) {
            const { workflow } = render(dir, stack);
            for (const script of runScripts(workflow)) {
                expect(script).not.toMatch(/\$\{\{\s*(inputs|github\.event)/);
            }
        }
        const { workflow } = render('.', 'node');
        const versions = workflow.jobs.deploy.steps.find((s) => s.id === 'versions');
        expect(versions.env.TARGET_VERSION).toBe("${{ github.event_name == 'push' && github.sha || inputs.version }}");
        expect(versions.with.script).toContain("if (!SHA.test(version)) throw");
        expect(versions.with.script).toContain("task: 'deploy:taskmate'");
    });

    test('cra in a subfolder: working directory, PUBLIC_URL and no npm cache without a lockfile', () => {
        const { workflow } = render('web', 'node');
        expect(workflow.jobs.ci.defaults.run['working-directory']).toBe('web');
        expect(workflow.jobs.ci.steps[1].with).toEqual({ 'node-version': '24', 'package-manager-cache': false });
        const build = workflow.jobs.deploy.steps.find((s) => s.name === 'Build de producción');
        expect(build['working-directory']).toBe('_taskmate/production/web');
        expect(build.run).toContain('PUBLIC_URL="${BASE_PATH%/}" npm run build');
        expect(workflow.jobs.ci.steps.some((s) => s.name === 'Auditoría de dependencias')).toBe(true);
    });

    test('python: setup-python, requirement files, Ruff and pytest; no deploy job', () => {
        const { workflow } = render('api', 'python');
        expect(workflow.jobs.deploy).toBeUndefined();
        expect(workflow.jobs.ci.steps[1].uses).toBe(spec.ACTIONS.setupPython);
        expect(workflow.jobs.ci.steps.map((s) => s.run).filter(Boolean)).toEqual([
            'python -m pip install --upgrade pip\npython -m pip install -r requirements.txt\npython -m pip install -r requirements-dev.txt\n',
            'python -m pip install ruff\nruff check .\n',
            'python -m pip install pytest\npython -m pytest\n',
        ]);
    });

    test('static site: no runtime, checks index.html and publishes the folder without .git', () => {
        const { workflow } = render('site', 'static');
        expect(workflow.jobs.ci.steps.map((s) => s.name)).toEqual(['Checkout', 'Verificar el sitio']);
        expect(workflow.jobs.deploy.steps.some((s) => (s.uses || '').startsWith('actions/setup-node'))).toBe(false);
        const assemble = workflow.jobs.deploy.steps.find((s) => s.name.startsWith('Armar el sitio'));
        expect(assemble.run).toContain("copy_site '_taskmate/production/site' _site");
        expect(assemble.run).toContain('--exclude=./.git');
    });

    test('rendering is deterministic', () => {
        expect(render('.', 'node').text).toBe(render('.', 'node').text);
    });
});

describe('describeStages', () => {
    test('lists what each stage runs, in order', () => {
        const f = facts(viteProject());
        const stages = spec.describeStages(spec.proposeSpec(f).spec);
        expect(stages.map((s) => s.key)).toEqual(['install', 'lint', 'test', 'build', 'deploy']);
        expect(stages[1]).toEqual({ key: 'lint', label: 'Análisis estático', commands: ['npm run lint'] });
    });
});

describe('isTaskmateWorkflow', () => {
    test('only files with the marker line', () => {
        expect(spec.isTaskmateWorkflow('name: x\n# taskmate-pipeline: 1\n')).toBe(true);
        expect(spec.isTaskmateWorkflow('name: x\n# taskmate-pipeline: one\n')).toBe(false);
        expect(spec.isTaskmateWorkflow(null)).toBe(false);
    });
});
