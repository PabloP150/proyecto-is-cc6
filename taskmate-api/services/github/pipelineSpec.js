// Phase 4: the CI/CD pipeline TaskMate writes into the group's repository. Pure functions only
// (no I/O): what the repository looks like (facts) → a proposed spec → validation → workflow YAML.
// The YAML is always rendered from a validated spec with a fixed template: neither the AI nor the
// admin can put free-form shell into the workflow, only `npm run <script that exists>` and fixed
// tools (npm ci/install/audit, pip, Ruff, pytest).
const { AppError } = require('../../helpers/errors');

const SPEC_VERSION = 1;
const WORKFLOW_PATH = '.github/workflows/taskmate-ci.yml';
const WORKFLOW_MARKER = `# taskmate-pipeline: ${SPEC_VERSION}`;
const WORKFLOW_MARKER_RE = /^# taskmate-pipeline: \d+\s*$/m;
const DEPLOY_TASK = 'deploy:taskmate';
const ENVIRONMENTS = Object.freeze(['staging', 'production']);

const NODE_VERSIONS = Object.freeze(['20', '22', '24', '26']);
const PYTHON_VERSIONS = Object.freeze(['3.10', '3.11', '3.12', '3.13', '3.14']);
const DEFAULT_NODE = '24';
const DEFAULT_PYTHON = '3.13';
const STACKS = Object.freeze(['node', 'python', 'static']);
const FRAMEWORKS = Object.freeze(['vite', 'cra', 'static']);
const OUTPUT_DIRS = Object.freeze({ vite: 'dist', cra: 'build' });
// Where a plain HTML site may live inside a project directory.
const SITE_DIRS = Object.freeze(['.', 'public', 'docs', 'site']);

const MAX_PROJECTS = 6;
const MAX_PROJECT_DEPTH = 2;
const MAX_DIR_LENGTH = 200;
const MAX_SCRIPTS = 40;
const MAX_SCRIPT_COMMAND = 200;
const SCRIPT_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,59}$/;
// No leading dot: no ".", "..", or hidden folders; the characters are safe inside quotes and shell words.
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const REQUIREMENTS_RE = /^requirements[A-Za-z0-9._-]*\.txt$/;
const NPM_DEFAULT_TEST = /no test specified/i;

// Folders that never hold the project the pipeline builds.
const SKIPPED_DIRS = new Set([
    'node_modules', 'dist', 'build', 'vendor', 'coverage', 'out', 'target', '__pycache__', 'venv', 'env',
    'bower_components', 'site-packages', 'examples', 'example', 'fixtures', 'test', 'tests', '__tests__',
]);

const invalid = (message) => new AppError('INVALID_PIPELINE', message, 400);

// ---------------------------------------------------------------- paths

const isSafeDir = (dir) => typeof dir === 'string'
    && dir.length > 0
    && dir.length <= MAX_DIR_LENGTH
    && (dir === '.' || dir.split('/').every((segment) => SEGMENT_RE.test(segment)));

const joinPath = (...parts) => {
    const kept = parts.filter((part) => part && part !== '.');
    return kept.length ? kept.join('/') : '.';
};

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');
const baseOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const depthOf = (dir) => (dir === '.' ? 0 : dir.split('/').length);

// Repository-relative blob paths inside `dir`, returned relative to it.
const filesUnder = (paths, dir) => {
    if (dir === '.') return paths;
    const prefix = `${dir}/`;
    return paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
};

// ---------------------------------------------------------------- facts (what the repository looks like)

const isSkippedPath = (path) => path.split('/').slice(0, -1).some((segment) => segment.startsWith('.') || SKIPPED_DIRS.has(segment.toLowerCase()));

/**
 * Candidate project directories from the repository tree (git tree entries {path, type}).
 * → [{dir, node, python, siteDirs}] — the root first, then by depth and name, at most MAX_PROJECTS.
 * A directory with a package.json is a Node project even if it also has an index.html (Vite, CRA).
 */
const findProjectDirs = (entries) => {
    const byDir = new Map();
    const touch = (dir) => {
        if (!byDir.has(dir)) byDir.set(dir, { dir, node: false, python: false, siteDirs: [] });
        return byDir.get(dir);
    };
    for (const entry of entries || []) {
        if (!entry || entry.type !== 'blob' || typeof entry.path !== 'string' || isSkippedPath(entry.path)) continue;
        const name = baseOf(entry.path);
        const dir = dirOf(entry.path);
        if (!isSafeDir(dir)) continue;
        if (depthOf(dir) <= MAX_PROJECT_DEPTH) {
            if (name === 'package.json') touch(dir).node = true;
            if (name === 'requirements.txt' || name === 'pyproject.toml') touch(dir).python = true;
        }
        if (name === 'index.html') {
            // An index.html in public/ docs/ site/ belongs to the folder above (GitHub Pages' docs/
            // convention, CRA's public/); anywhere else the folder itself is the site.
            const sub = baseOf(dir);
            const parent = dirOf(dir);
            if (dir !== '.' && SITE_DIRS.includes(sub) && depthOf(parent) <= MAX_PROJECT_DEPTH) touch(parent).siteDirs.push(sub);
            else if (depthOf(dir) <= MAX_PROJECT_DEPTH) touch(dir).siteDirs.push('.');
        }
    }
    return [...byDir.values()]
        .filter((project) => project.node || project.python || project.siteDirs.length > 0)
        .map((project) => ({ ...project, siteDirs: SITE_DIRS.filter((site) => project.siteDirs.includes(site)) }))
        .sort((a, b) => depthOf(a.dir) - depthOf(b.dir) || a.dir.localeCompare(b.dir))
        .slice(0, MAX_PROJECTS);
};

const clampVersion = (wanted, allowed) => {
    const index = allowed.indexOf(wanted);
    if (index >= 0) return wanted;
    const value = Number(wanted);
    if (!Number.isFinite(value)) return null;
    if (value < Number(allowed[0])) return allowed[0];
    if (value > Number(allowed[allowed.length - 1])) return allowed[allowed.length - 1];
    return allowed.find((v) => Number(v) >= value) || null;
};

// "v20.11.0", "20", "lts/*" (→ null), engines ">=18" (→ the default when it satisfies it), "^20" / "20.x" (→ 20).
const parseNodeVersion = (text, { isRange = false } = {}) => {
    if (typeof text !== 'string') return null;
    const value = text.trim();
    const match = value.match(/(\d+)/);
    if (!match) return null;
    if (isRange && /^>=?\s*\d/.test(value) && Number(match[1]) <= Number(DEFAULT_NODE)) return DEFAULT_NODE;
    return clampVersion(match[1], NODE_VERSIONS);
};

// ".python-version" "3.11.4" (→ 3.11), requires-python ">=3.10" (→ the default when it satisfies it), "~=3.11" (→ 3.11).
const parsePythonVersion = (text, { isRange = false } = {}) => {
    if (typeof text !== 'string') return null;
    const value = text.trim();
    const match = value.match(/(\d+)\.(\d+)/);
    if (!match) return null;
    const wanted = `${match[1]}.${match[2]}`;
    const asNumber = (v) => Number(v.split('.')[0]) * 100 + Number(v.split('.')[1]);
    if (isRange && /^>=?\s*\d/.test(value) && asNumber(wanted) <= asNumber(DEFAULT_PYTHON)) return DEFAULT_PYTHON;
    if (PYTHON_VERSIONS.includes(wanted)) return wanted;
    if (asNumber(wanted) < asNumber(PYTHON_VERSIONS[0])) return PYTHON_VERSIONS[0];
    if (asNumber(wanted) > asNumber(PYTHON_VERSIONS[PYTHON_VERSIONS.length - 1])) return PYTHON_VERSIONS[PYTHON_VERSIONS.length - 1];
    return null;
};

/**
 * Node project facts. files: paths relative to the project dir. texts: {packageJson, nodeVersion}
 * (.nvmrc or .node-version). siteDirs: folders of the project with an index.html (findProjectDirs).
 * An unreadable package.json gives a project with no scripts and a note.
 */
const nodeFacts = (dir, files, { packageJson, nodeVersion } = {}, siteDirs = []) => {
    let pkg = null;
    try {
        pkg = typeof packageJson === 'string' ? JSON.parse(packageJson) : null;
    } catch {
        pkg = null;
    }
    const valid = Boolean(pkg && typeof pkg === 'object' && !Array.isArray(pkg));
    const scripts = {};
    if (valid && pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [name, command] of Object.entries(pkg.scripts)) {
            if (Object.keys(scripts).length >= MAX_SCRIPTS) break;
            if (SCRIPT_RE.test(name) && typeof command === 'string') scripts[name] = command.slice(0, MAX_SCRIPT_COMMAND);
        }
    }
    const deps = valid ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
    const has = (name) => files.includes(name);
    const engines = valid && pkg.engines && typeof pkg.engines.node === 'string' ? pkg.engines.node : null;
    return {
        dir,
        stack: 'node',
        validManifest: valid,
        scripts,
        lockfile: has('package-lock.json') ? 'npm' : has('yarn.lock') ? 'yarn' : has('pnpm-lock.yaml') ? 'pnpm' : null,
        runtime: parseNodeVersion(nodeVersion) || parseNodeVersion(engines, { isRange: true }),
        framework: Object.prototype.hasOwnProperty.call(deps, 'vite') ? 'vite'
            : Object.prototype.hasOwnProperty.call(deps, 'react-scripts') ? 'cra' : null,
        siteDirs: [...siteDirs],
    };
};

/** Python project facts. texts: {requirements: {file: text}, pyproject, pythonVersion}. */
const pythonFacts = (dir, files, { requirements = {}, pyproject = null, pythonVersion = null } = {}) => {
    const requirementFiles = files.filter((file) => REQUIREMENTS_RE.test(file)).sort((a, b) =>
        (a === 'requirements.txt' ? -1 : b === 'requirements.txt' ? 1 : a.localeCompare(b))).slice(0, 4);
    const texts = [...Object.values(requirements), pyproject].filter((text) => typeof text === 'string');
    const hasTestFiles = files.some((file) => /(^|\/)tests?\//.test(file) || /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(file));
    const requiresPython = typeof pyproject === 'string' ? (pyproject.match(/requires-python\s*=\s*["']([^"']+)["']/) || [])[1] : null;
    return {
        dir,
        stack: 'python',
        requirementFiles,
        pyproject: files.includes('pyproject.toml'),
        runtime: parsePythonVersion(pythonVersion) || parsePythonVersion(requiresPython, { isRange: true }),
        usesPytest: texts.some((text) => /\bpytest\b/i.test(text)) || hasTestFiles,
    };
};

const staticFacts = (dir, siteDirs) => ({ dir, stack: 'static', siteDirs: [...siteDirs] });

// ---------------------------------------------------------------- proposal

const deployable = (project) => project.stack === 'static'
    || (project.stack === 'node' && Boolean(project.scripts.build) && Boolean(project.framework));

const defaultTest = (scripts) => (scripts.test && !NPM_DEFAULT_TEST.test(scripts.test) ? 'test' : null);

/**
 * Spec for one project of the facts (the first deployable one unless `dir`/`stack` pick another).
 * → {spec, notes}: notes are short Spanish explanations shown next to the proposal.
 */
const proposeSpec = (facts, { dir, stack } = {}) => {
    const projects = (facts && facts.projects) || [];
    if (projects.length === 0) {
        throw new AppError('PIPELINE_UNSUPPORTED', 'No Node.js, Python or static site project was found in the repository', 422);
    }
    let project;
    if (dir !== undefined || stack !== undefined) {
        project = projects.find((p) => p.dir === dir && (stack === undefined || p.stack === stack));
        if (!project) throw invalid('Unknown project');
    } else {
        project = projects.find((p) => p.stack === 'node' && deployable(p))
            || projects.find((p) => p.stack === 'static')
            || projects.find((p) => p.stack === 'node')
            || projects[0];
    }

    const notes = [];
    const spec = {
        version: SPEC_VERSION,
        project: { dir: project.dir, stack: project.stack },
        runtime: null,
        install: null,
        lint: null,
        audit: false,
        test: null,
        build: null,
        deploy: null,
    };

    if (project.stack === 'node') {
        const { scripts } = project;
        if (!project.validManifest) notes.push('No se pudo leer package.json; el pipeline solo instalará las dependencias.');
        spec.runtime = project.runtime || DEFAULT_NODE;
        spec.install = { kind: project.lockfile === 'npm' ? 'npm-ci' : 'npm-install' };
        if (project.lockfile && project.lockfile !== 'npm') {
            notes.push(`El proyecto usa ${project.lockfile}; TaskMate instalará con npm (npm install).`);
        }
        const lint = ['lint', 'eslint'].find((name) => scripts[name]);
        spec.lint = lint ? { kind: 'script', name: lint } : null;
        spec.audit = !lint;
        if (!lint) notes.push('No hay script de lint: el análisis estático será la auditoría de dependencias (npm audit).');
        const test = defaultTest(scripts);
        spec.test = test ? { kind: 'script', name: test } : null;
        if (!test) notes.push('No hay script de pruebas («test»).');
        spec.build = scripts.build ? { kind: 'script', name: 'build' } : null;
        if (deployable(project)) {
            spec.deploy = { target: 'github-pages', framework: project.framework, outputDir: OUTPUT_DIRS[project.framework] };
        } else {
            notes.push('El proyecto no genera un sitio estático conocido (Vite o Create React App): el pipeline no tendrá deploy.');
        }
    } else if (project.stack === 'python') {
        spec.runtime = project.runtime || DEFAULT_PYTHON;
        if (project.requirementFiles.length) spec.install = { kind: 'pip', files: [...project.requirementFiles] };
        else if (project.pyproject) spec.install = { kind: 'pip-project' };
        spec.lint = { kind: 'ruff' };
        spec.test = project.usesPytest ? { kind: 'pytest' } : null;
        if (!project.usesPytest) notes.push('No se encontraron pruebas de pytest.');
        notes.push('Los proyectos de Python tienen CI (instalar, Ruff y pytest) pero no deploy a GitHub Pages.');
    } else {
        spec.deploy = { target: 'github-pages', framework: 'static', outputDir: project.siteDirs[0] };
    }
    return { spec, notes };
};

// ---------------------------------------------------------------- validation

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const onlyKeys = (value, keys, label) => {
    if (!isPlainObject(value)) throw invalid(`${label} must be an object`);
    const extra = Object.keys(value).filter((key) => !keys.includes(key));
    if (extra.length) throw invalid(`${label} has unknown fields: ${extra.join(', ')}`);
};

const scriptStep = (value, scripts, label) => {
    if (value === null || value === undefined) return null;
    onlyKeys(value, ['kind', 'name'], label);
    if (value.kind !== 'script' || typeof value.name !== 'string' || !SCRIPT_RE.test(value.name)) throw invalid(`${label} is invalid`);
    if (!Object.prototype.hasOwnProperty.call(scripts, value.name)) throw invalid(`${label}: package.json has no "${value.name}" script`);
    return { kind: 'script', name: value.name };
};

const toolStep = (value, kind, label) => {
    if (value === null || value === undefined) return null;
    onlyKeys(value, ['kind'], label);
    if (value.kind !== kind) throw invalid(`${label} is invalid`);
    return { kind };
};

/**
 * Checks a spec (from the AI, the admin or the DB) against the repository facts and returns a
 * normalized copy. Throws INVALID_PIPELINE (400) on anything unknown or inconsistent.
 */
const validateSpec = (spec, facts) => {
    onlyKeys(spec, ['version', 'project', 'runtime', 'install', 'lint', 'audit', 'test', 'build', 'deploy'], 'spec');
    if (spec.version !== SPEC_VERSION) throw invalid('Unsupported spec version');
    onlyKeys(spec.project, ['dir', 'stack'], 'project');
    const { dir, stack } = spec.project;
    if (!STACKS.includes(stack) || !isSafeDir(dir)) throw invalid('project is invalid');
    const project = ((facts && facts.projects) || []).find((p) => p.dir === dir && p.stack === stack);
    if (!project) throw invalid('project was not found in the repository');

    const out = {
        version: SPEC_VERSION,
        project: { dir, stack },
        runtime: null,
        install: null,
        lint: null,
        audit: false,
        test: null,
        build: null,
        deploy: null,
    };
    if (typeof spec.audit !== 'boolean' && spec.audit !== undefined) throw invalid('audit must be a boolean');

    if (stack === 'node') {
        if (!NODE_VERSIONS.includes(spec.runtime)) throw invalid(`runtime must be one of ${NODE_VERSIONS.join(', ')}`);
        out.runtime = spec.runtime;
        onlyKeys(spec.install, ['kind'], 'install');
        if (spec.install.kind === 'npm-ci' && project.lockfile !== 'npm') throw invalid('npm ci needs a package-lock.json');
        if (!['npm-ci', 'npm-install'].includes(spec.install.kind)) throw invalid('install is invalid');
        out.install = { kind: spec.install.kind };
        out.lint = scriptStep(spec.lint, project.scripts, 'lint');
        out.audit = spec.audit === true;
        out.test = scriptStep(spec.test, project.scripts, 'test');
        out.build = scriptStep(spec.build, project.scripts, 'build');
    } else if (stack === 'python') {
        if (!PYTHON_VERSIONS.includes(spec.runtime)) throw invalid(`runtime must be one of ${PYTHON_VERSIONS.join(', ')}`);
        out.runtime = spec.runtime;
        if (spec.install !== null && spec.install !== undefined) {
            if (isPlainObject(spec.install) && spec.install.kind === 'pip') {
                onlyKeys(spec.install, ['kind', 'files'], 'install');
                const files = spec.install.files;
                if (!Array.isArray(files) || files.length === 0 || files.length > 4) throw invalid('install.files is invalid');
                if (new Set(files).size !== files.length || files.some((file) => !project.requirementFiles.includes(file))) {
                    throw invalid('install.files must be requirement files of the project');
                }
                out.install = { kind: 'pip', files: [...files] };
            } else {
                onlyKeys(spec.install, ['kind'], 'install');
                if (spec.install.kind !== 'pip-project' || !project.pyproject) throw invalid('install is invalid');
                out.install = { kind: 'pip-project' };
            }
        }
        out.lint = toolStep(spec.lint, 'ruff', 'lint');
        if (spec.audit === true) throw invalid('audit is only available for Node.js projects');
        out.test = toolStep(spec.test, 'pytest', 'test');
        if (spec.build !== null && spec.build !== undefined) throw invalid('build is only available for Node.js projects');
    } else {
        for (const key of ['runtime', 'install', 'lint', 'test', 'build']) {
            if (spec[key] !== null && spec[key] !== undefined) throw invalid(`${key} is not available for a static site`);
        }
        if (spec.audit === true) throw invalid('audit is only available for Node.js projects');
    }

    if (spec.deploy !== null && spec.deploy !== undefined) {
        onlyKeys(spec.deploy, ['target', 'framework', 'outputDir'], 'deploy');
        const { target, framework, outputDir } = spec.deploy;
        if (target !== 'github-pages') throw invalid('deploy.target must be github-pages');
        if (!FRAMEWORKS.includes(framework)) throw invalid('deploy.framework is invalid');
        if (!isSafeDir(outputDir)) throw invalid('deploy.outputDir is invalid');
        if (stack === 'python') throw invalid('Python projects cannot be deployed to GitHub Pages');
        if (stack === 'static') {
            if (framework !== 'static' || !project.siteDirs.includes(outputDir)) throw invalid('deploy.outputDir must be a folder with an index.html');
        } else {
            if (!out.build && framework !== 'static') throw invalid('deploy needs a build step');
            if (!out.build && !project.siteDirs.includes(outputDir)) throw invalid('deploy.outputDir needs a build step or an index.html');
            if (framework === 'static' && outputDir === '.') throw invalid('deploy.outputDir cannot be the whole Node.js project');
        }
        out.deploy = { target, framework, outputDir };
    } else if (stack === 'static') {
        throw invalid('a static site pipeline needs its deploy');
    }

    if (!out.install && !out.lint && !out.audit && !out.test && !out.build && !out.deploy) throw invalid('the pipeline has no steps');
    return out;
};

// ---------------------------------------------------------------- what each stage runs (for the UI)

const installCommands = (spec) => {
    if (!spec.install) return [];
    if (spec.install.kind === 'npm-ci') return ['npm ci'];
    if (spec.install.kind === 'npm-install') return ['npm install'];
    if (spec.install.kind === 'pip-project') return ['python -m pip install --upgrade pip', 'python -m pip install .'];
    return ['python -m pip install --upgrade pip', ...spec.install.files.map((file) => `python -m pip install -r ${file}`)];
};

const scriptCommand = (step) => (step.name === 'test' ? 'npm test' : `npm run ${step.name}`);

/** [{key, label, commands}] in pipeline order; deploy last. */
const describeStages = (spec) => {
    const stages = [];
    const add = (key, label, commands) => stages.push({ key, label, commands });
    if (spec.install) add('install', 'Instalar dependencias', installCommands(spec));
    if (spec.lint) add('lint', 'Análisis estático', spec.lint.kind === 'ruff' ? ['ruff check .'] : [scriptCommand(spec.lint)]);
    if (spec.audit) add('audit', 'Auditoría de dependencias', ['npm audit --omit=dev --audit-level=high']);
    if (spec.test) add('test', 'Pruebas', spec.test.kind === 'pytest' ? ['python -m pytest'] : [scriptCommand(spec.test)]);
    if (spec.build) add('build', 'Build', [scriptCommand(spec.build)]);
    if (spec.project.stack === 'static' && spec.deploy) add('check', 'Verificar el sitio', [`test -f ${joinPath(spec.deploy.outputDir, 'index.html')}`]);
    if (spec.deploy) add('deploy', 'Deploy a GitHub Pages', ['staging: /staging/ (automático en la rama principal)', 'producción: / (con aprobación en TaskMate)']);
    return stages;
};

// ---------------------------------------------------------------- YAML

// Every interpolated value was validated (safe characters only); quoting is belt and braces.
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;

class Lines {
    constructor() {
        this.lines = [];
    }

    add(indent, text = '') {
        this.lines.push(text ? `${' '.repeat(indent)}${text}` : '');
        return this;
    }

    block(indent, key, bodyLines) {
        this.add(indent, `${key}: |`);
        bodyLines.forEach((line) => this.add(indent + 2, line));
        return this;
    }

    toString() {
        return `${this.lines.join('\n')}\n`;
    }
}

const ACTIONS = Object.freeze({
    checkout: 'actions/checkout@v7',
    setupNode: 'actions/setup-node@v7',
    setupPython: 'actions/setup-python@v7',
    githubScript: 'actions/github-script@v9',
    configurePages: 'actions/configure-pages@v6',
    uploadPages: 'actions/upload-pages-artifact@v5',
    deployPages: 'actions/deploy-pages@v5',
});

const step = (out, name, { id, uses, ifExpr, workingDirectory, withs, env, run } = {}) => {
    out.add(6, `- name: ${q(name)}`);
    if (id) out.add(8, `id: ${id}`);
    if (ifExpr) out.add(8, `if: ${ifExpr}`);
    if (uses) out.add(8, `uses: ${uses}`);
    if (workingDirectory) out.add(8, `working-directory: ${q(workingDirectory)}`);
    if (withs) {
        out.add(8, 'with:');
        Object.entries(withs).forEach(([key, value]) => {
            if (Array.isArray(value)) out.block(10, key, value);
            else out.add(10, `${key}: ${value}`);
        });
    }
    if (env) {
        out.add(8, 'env:');
        Object.entries(env).forEach(([key, value]) => out.add(10, `${key}: ${value}`));
    }
    if (run) {
        if (run.length === 1) out.add(8, `run: ${run[0]}`);
        else out.block(8, 'run', run);
    }
};

const setupRuntime = (out, spec, { cache }) => {
    const dir = spec.project.dir;
    if (spec.project.stack === 'node') {
        const withs = { 'node-version': q(spec.runtime) };
        if (cache && spec.install && spec.install.kind === 'npm-ci') {
            withs.cache = 'npm';
            withs['cache-dependency-path'] = q(joinPath(dir, 'package-lock.json'));
        } else {
            withs['package-manager-cache'] = 'false';
        }
        step(out, `Node.js ${spec.runtime}`, { uses: ACTIONS.setupNode, withs });
    } else if (spec.project.stack === 'python') {
        step(out, `Python ${spec.runtime}`, { uses: ACTIONS.setupPython, withs: { 'python-version': q(spec.runtime) } });
    }
};

const ciSteps = (out, spec) => {
    step(out, 'Checkout', { uses: ACTIONS.checkout, withs: { 'persist-credentials': 'false' } });
    setupRuntime(out, spec, { cache: true });
    const install = installCommands(spec);
    if (install.length) step(out, 'Instalar dependencias', { run: install });
    if (spec.lint) {
        step(out, 'Análisis estático', {
            run: spec.lint.kind === 'ruff' ? ['python -m pip install ruff', 'ruff check .'] : [scriptCommand(spec.lint)],
        });
    }
    if (spec.audit) step(out, 'Auditoría de dependencias', { run: ['npm audit --omit=dev --audit-level=high'] });
    if (spec.test) {
        step(out, 'Pruebas', {
            run: spec.test.kind === 'pytest' ? ['python -m pip install pytest', 'python -m pytest'] : [scriptCommand(spec.test)],
        });
    }
    if (spec.build) step(out, 'Build', { run: [scriptCommand(spec.build)] });
    if (spec.project.stack === 'static' && spec.deploy) {
        const index = joinPath(spec.deploy.outputDir, 'index.html');
        step(out, 'Verificar el sitio', { run: [`test -f ${q(index)} || { echo "::error::Falta ${index}"; exit 1; }`] });
    }
};

// Latest successful TaskMate deploy of the other environment, so one Pages site keeps both.
const VERSIONS_SCRIPT = [
    "const SHA = /^[0-9a-f]{40}$/;",
    'const target = process.env.TARGET_ENV;',
    'const version = process.env.TARGET_VERSION;',
    "const requestedBy = String(process.env.REQUESTED_BY || '').replace(/[^A-Za-z0-9_.@ -]/g, '').slice(0, 60);",
    "if (!['staging', 'production'].includes(target)) throw new Error('Entorno inválido: ' + target);",
    "if (!SHA.test(version)) throw new Error('Versión inválida (se espera el SHA completo del commit): ' + version);",
    'const { owner, repo } = context.repo;',
    'const live = async (environment) => {',
    `  const { data } = await github.rest.repos.listDeployments({ owner, repo, environment, task: '${DEPLOY_TASK}', per_page: 30 });`,
    '  for (const deployment of data) {',
    '    const { data: statuses } = await github.rest.repos.listDeploymentStatuses({ owner, repo, deployment_id: deployment.id, per_page: 1 });',
    "    if (statuses.length > 0 && statuses[0].state === 'success') return deployment.sha;",
    '  }',
    "  return '';",
    '};',
    "const other = target === 'staging' ? 'production' : 'staging';",
    'const versions = { [target]: version, [other]: await live(other) };',
    "const logUrl = context.serverUrl + '/' + owner + '/' + repo + '/actions/runs/' + context.runId;",
    'const { data: deployment } = await github.rest.repos.createDeployment({',
    `  owner, repo, ref: version, task: '${DEPLOY_TASK}', environment: target,`,
    "  auto_merge: false, required_contexts: [], production_environment: target === 'production', transient_environment: false,",
    "  description: requestedBy ? 'Desde TaskMate, pedido por ' + requestedBy : 'Desde TaskMate',",
    '  payload: { taskmate: true, requestedBy, runId: context.runId },',
    '});',
    "await github.rest.repos.createDeploymentStatus({ owner, repo, deployment_id: deployment.id, state: 'in_progress', log_url: logUrl });",
    "core.setOutput('production', versions.production);",
    "core.setOutput('staging', versions.staging);",
    "core.setOutput('deployment_id', String(deployment.id));",
];

const SUCCESS_SCRIPT = [
    'const { owner, repo } = context.repo;',
    "const base = String(process.env.PAGE_URL || '').replace(/\\/?$/, '/');",
    "const url = process.env.TARGET_ENV === 'staging' ? base + 'staging/' : base;",
    "const logUrl = context.serverUrl + '/' + owner + '/' + repo + '/actions/runs/' + context.runId;",
    'await github.rest.repos.createDeploymentStatus({',
    "  owner, repo, deployment_id: Number(process.env.DEPLOYMENT_ID), state: 'success',",
    '  environment_url: url, log_url: logUrl, auto_inactive: true,',
    '});',
];

const FAILURE_SCRIPT = [
    'const { owner, repo } = context.repo;',
    "const logUrl = context.serverUrl + '/' + owner + '/' + repo + '/actions/runs/' + context.runId;",
    'await github.rest.repos.createDeploymentStatus({',
    "  owner, repo, deployment_id: Number(process.env.DEPLOYMENT_ID), state: 'failure', log_url: logUrl,",
    '});',
];

const PLACEHOLDER_HTML = [
    '<!doctype html>',
    '<html lang="es"><head><meta charset="utf-8"><title>Sin versión en producción</title></head>',
    '<body><p>Producción todavía no tiene una versión publicada desde TaskMate.</p>',
    '<p><a href="staging/">Ver staging</a></p></body></html>',
];

const buildForEnvironment = (out, spec, environment, label) => {
    const deploy = spec.deploy;
    const checkoutDir = `_taskmate/${environment}`;
    const projectDir = joinPath(checkoutDir, spec.project.dir);
    const output = `steps.versions.outputs.${environment}`;
    step(out, `Checkout de ${label}`, {
        ifExpr: `${output} != ''`,
        uses: ACTIONS.checkout,
        withs: { ref: `\${{ ${output} }}`, path: q(checkoutDir), 'persist-credentials': 'false' },
    });
    if (spec.project.stack !== 'node') return;
    const basePath = environment === 'staging' ? '${{ steps.pages.outputs.base_path }}/staging/' : '${{ steps.pages.outputs.base_path }}/';
    const run = [...installCommands(spec)];
    if (spec.build) {
        if (deploy.framework === 'vite') run.push(`${scriptCommand(spec.build)} -- --base="$BASE_PATH"`);
        else if (deploy.framework === 'cra') run.push(`PUBLIC_URL="\${BASE_PATH%/}" ${scriptCommand(spec.build)}`);
        else run.push(scriptCommand(spec.build));
    }
    step(out, `Build de ${label}`, {
        ifExpr: `${output} != ''`,
        workingDirectory: projectDir,
        env: { BASE_PATH: basePath },
        run,
    });
};

const deployJob = (out, spec) => {
    const site = (environment) => joinPath(`_taskmate/${environment}`, spec.project.dir, spec.deploy.outputDir);
    out.add(2, 'deploy:');
    out.add(4, "name: 'Deploy a GitHub Pages'");
    out.add(4, 'needs: ci');
    // Pushes to the default branch that passed CI go to staging; TaskMate dispatches production,
    // promotions and rollbacks (CI is skipped then: TaskMate only deploys versions that passed it).
    out.add(4, 'if: >-');
    out.add(6, 'always() && github.ref_name == github.event.repository.default_branch && (');
    out.add(8, "(github.event_name == 'push' && needs.ci.result == 'success') ||");
    out.add(8, "(github.event_name == 'workflow_dispatch' && inputs.environment != 'none')");
    out.add(6, ')');
    out.add(4, 'runs-on: ubuntu-latest');
    out.add(4, 'timeout-minutes: 30');
    out.add(4, 'permissions:');
    out.add(6, 'actions: read');
    out.add(6, 'contents: read');
    out.add(6, 'deployments: write');
    out.add(6, 'id-token: write');
    out.add(6, 'pages: write');
    out.add(4, 'concurrency:');
    out.add(6, 'group: taskmate-pages');
    out.add(6, 'cancel-in-progress: false');
    out.add(4, 'environment:');
    out.add(6, 'name: github-pages');
    out.add(6, 'url: ${{ steps.publish.outputs.page_url }}');
    out.add(4, 'steps:');
    step(out, 'Versiones a publicar', {
        id: 'versions',
        uses: ACTIONS.githubScript,
        env: {
            TARGET_ENV: "${{ github.event_name == 'push' && 'staging' || inputs.environment }}",
            TARGET_VERSION: "${{ github.event_name == 'push' && github.sha || inputs.version }}",
            REQUESTED_BY: '${{ inputs.requested_by }}',
        },
        withs: { script: VERSIONS_SCRIPT },
    });
    step(out, 'Configurar GitHub Pages', { id: 'pages', uses: ACTIONS.configurePages });
    if (spec.project.stack === 'node') setupRuntime(out, spec, { cache: false });
    buildForEnvironment(out, spec, 'production', 'producción');
    buildForEnvironment(out, spec, 'staging', 'staging');
    step(out, 'Armar el sitio (producción en /, staging en /staging/)', {
        env: {
            PRODUCTION: '${{ steps.versions.outputs.production }}',
            STAGING: '${{ steps.versions.outputs.staging }}',
        },
        run: [
            'set -euo pipefail',
            'copy_site() {',
            '  if [ ! -d "$1" ]; then echo "::error::No se encontró la carpeta del sitio: $1"; exit 1; fi',
            '  mkdir -p "$2"',
            '  tar --exclude=./.git --exclude=./.github -C "$1" -cf - . | tar -C "$2" -xf -',
            '}',
            'mkdir -p _site',
            'if [ -n "$PRODUCTION" ]; then',
            `  copy_site ${q(site('production'))} _site`,
            'else',
            `  printf '%s\\n' ${PLACEHOLDER_HTML.map(q).join(' ')} > _site/index.html`,
            'fi',
            'rm -rf _site/staging',
            'if [ -n "$STAGING" ]; then',
            `  copy_site ${q(site('staging'))} _site/staging`,
            'fi',
        ],
    });
    step(out, 'Subir el sitio', { uses: ACTIONS.uploadPages, withs: { path: '_site' } });
    step(out, 'Publicar en GitHub Pages', { id: 'publish', uses: ACTIONS.deployPages });
    step(out, 'Registrar el deploy', {
        uses: ACTIONS.githubScript,
        env: {
            DEPLOYMENT_ID: '${{ steps.versions.outputs.deployment_id }}',
            TARGET_ENV: "${{ github.event_name == 'push' && 'staging' || inputs.environment }}",
            PAGE_URL: '${{ steps.publish.outputs.page_url }}',
        },
        withs: { script: SUCCESS_SCRIPT },
    });
    step(out, 'Registrar el deploy fallido', {
        ifExpr: "(failure() || cancelled()) && steps.versions.outputs.deployment_id != ''",
        uses: ACTIONS.githubScript,
        env: { DEPLOYMENT_ID: '${{ steps.versions.outputs.deployment_id }}' },
        withs: { script: FAILURE_SCRIPT },
    });
};

const CI_JOB_NAMES = Object.freeze({ node: 'CI (Node.js)', python: 'CI (Python)', static: 'CI (sitio estático)' });

/** The workflow file for a validated spec. Deterministic: the same spec always gives the same text. */
const renderWorkflow = (spec) => {
    const out = new Lines();
    out.add(0, '# Generado por TaskMate (GitHub → CI/CD). Cámbialo desde TaskMate: si lo editas a mano,');
    out.add(0, '# TaskMate lo reemplaza la próxima vez que alguien configure el pipeline.');
    out.add(0, WORKFLOW_MARKER);
    out.add(0, "name: 'TaskMate CI/CD'");
    out.add(0, "run-name: ${{ inputs.environment && inputs.environment != 'none' && format('Deploy a {0} desde TaskMate', inputs.environment) || '' }}");
    out.add(0);
    out.add(0, 'on:');
    out.add(2, 'push:');
    out.add(4, "branches: ['**']");
    out.add(2, 'pull_request:');
    out.add(2, 'workflow_dispatch:');
    out.add(4, 'inputs:');
    out.add(6, 'environment:');
    out.add(8, "description: 'Entorno a desplegar (none = solo CI)'");
    out.add(8, 'type: choice');
    out.add(8, "options: ['none', 'staging', 'production']");
    out.add(8, "default: 'none'");
    out.add(6, 'version:');
    out.add(8, "description: 'Commit a desplegar (SHA completo)'");
    out.add(8, 'type: string');
    out.add(8, "default: ''");
    out.add(6, 'requested_by:');
    out.add(8, "description: 'Usuario de TaskMate que pidió el deploy'");
    out.add(8, 'type: string');
    out.add(8, "default: ''");
    out.add(0);
    out.add(0, 'permissions:');
    out.add(2, 'contents: read');
    out.add(0);
    out.add(0, 'jobs:');
    out.add(2, 'ci:');
    out.add(4, `name: ${q(CI_JOB_NAMES[spec.project.stack])}`);
    out.add(4, "if: github.event_name != 'workflow_dispatch' || inputs.environment == 'none'");
    out.add(4, 'runs-on: ubuntu-latest');
    out.add(4, 'timeout-minutes: 30');
    out.add(4, 'concurrency:');
    out.add(6, 'group: taskmate-ci-${{ github.ref }}');
    out.add(6, 'cancel-in-progress: true');
    if (spec.project.dir !== '.') {
        out.add(4, 'defaults:');
        out.add(6, 'run:');
        out.add(8, `working-directory: ${q(spec.project.dir)}`);
    }
    out.add(4, 'steps:');
    ciSteps(out, spec);
    if (spec.deploy) {
        out.add(0);
        deployJob(out, spec);
    }
    return out.toString();
};

const isTaskmateWorkflow = (text) => typeof text === 'string' && WORKFLOW_MARKER_RE.test(text);

module.exports = {
    SPEC_VERSION,
    WORKFLOW_PATH,
    DEPLOY_TASK,
    ENVIRONMENTS,
    NODE_VERSIONS,
    PYTHON_VERSIONS,
    DEFAULT_NODE,
    DEFAULT_PYTHON,
    SITE_DIRS,
    ACTIONS,
    isSafeDir,
    joinPath,
    filesUnder,
    findProjectDirs,
    parseNodeVersion,
    parsePythonVersion,
    nodeFacts,
    pythonFacts,
    staticFacts,
    proposeSpec,
    validateSpec,
    describeStages,
    renderWorkflow,
    isTaskmateWorkflow,
};
