// Phase 4: the CI/CD pipeline TaskMate writes into the group's repository. Pure functions only
// (no I/O): what the repository looks like (facts) → a proposed spec → validation → workflow YAML.
// The YAML is always rendered from a validated spec with a fixed template: neither the AI nor the
// admin can put free-form shell into the workflow, only `npm run <script that exists>` and fixed
// tools (npm ci/install/audit, pip, Ruff, pytest).
const { AppError } = require('../../helpers/errors');

const SPEC_VERSION = 1;
// Version of the generated workflow, written in its marker line. Bump it when the template changes
// in a way repositories should pick up: TaskMate then flags older workflows as outdated. (The spec
// format has its own SPEC_VERSION so saved pipelines stay valid across template changes.)
// 2: build/deploy split, deploy queue, reuse of the published site, stale re-run guard.
const TEMPLATE_VERSION = 2;
const WORKFLOW_PATH = '.github/workflows/taskmate-ci.yml';
const WORKFLOW_MARKER = `# taskmate-pipeline: ${TEMPLATE_VERSION}`;
const WORKFLOW_MARKER_RE = /^# taskmate-pipeline: (\d+)\s*$/m;
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

// ---------------------------------------------------------------- scripts that never finish

// A script that starts a server or a watcher never ends: as a CI stage it would hang the job until
// its timeout. Recognized by its name (start, dev, preview…) or by what it runs (vite without
// build, next dev, nodemon, --watch…, also through `npm run <script>`); never offered for a stage.
const LONG_RUNNING_NAMES = new Set(['start', 'dev', 'develop', 'serve', 'server', 'preview', 'watch']);
const ALWAYS_LONG_RUNNING = new Set([
    'nodemon', 'http-server', 'live-server', 'serve', 'browser-sync', 'json-server', 'lite-server',
    'ts-node-dev', 'webpack-dev-server', 'electron', 'start-storybook',
]);
const LONG_RUNNING_SUBCOMMANDS = {
    next: ['dev', 'start'],
    nuxt: ['dev', 'start', 'preview'],
    nuxi: ['dev', 'preview'],
    astro: ['dev', 'preview'],
    remix: ['dev'],
    vitepress: ['dev', 'preview'],
    docusaurus: ['start', 'serve'],
    gatsby: ['develop', 'serve'],
    'react-scripts': ['start'],
    ng: ['serve'],
    'vue-cli-service': ['serve'],
    webpack: ['serve'],
    expo: ['start'],
    storybook: ['dev'],
};
const RUNNERS = new Set(['npx', 'bunx', 'cross-env', 'dotenv', 'exec', 'pnpm', 'yarn', 'bun']);
const SCRIPT_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
// Shell command separators of a package.json script (a newline also starts a new command).
const COMMAND_SEPARATORS = /&&|\|\||[;|&\n]/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// The words of one command without the runners, flags and VAR=value in front of the tool.
const toolWords = (segment) => {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    while (words.length && (RUNNERS.has(words[0]) || words[0].startsWith('-') || ENV_ASSIGNMENT.test(words[0]))) words.shift();
    return words;
};

const toolName = (word) => word.slice(word.lastIndexOf('/') + 1);

const longRunningSegment = (segment, scripts, seen) => {
    const raw = segment.trim().split(/\s+/).filter(Boolean);
    const runsScript = SCRIPT_RUNNERS.has(raw[0]) && raw[1] === 'run' && typeof raw[2] === 'string';
    if (runsScript) return isLongRunningScript(raw[2], scripts[raw[2]], scripts, seen);
    const words = toolWords(segment);
    if (words.length === 0) return false;
    if (words.some((word) => word.startsWith('--watch') || word === '-w' || word === '--serve')) return true;
    const tool = toolName(words[0]);
    const sub = words[1];
    if (ALWAYS_LONG_RUNNING.has(tool)) return true;
    if (tool === 'vite' || tool === 'parcel') return sub !== 'build';
    return Boolean(LONG_RUNNING_SUBCOMMANDS[tool] && LONG_RUNNING_SUBCOMMANDS[tool].includes(sub));
};

/** True when the script (name + command) would start a server or a watcher. */
function isLongRunningScript(name, command, scripts = {}, seen = new Set()) {
    if (LONG_RUNNING_NAMES.has(name)) return true;
    if (typeof command !== 'string' || seen.has(name)) return false;
    seen.add(name);
    return command.split(COMMAND_SEPARATORS).some((segment) => longRunningSegment(segment, scripts, seen));
}

/**
 * True when `npm run <script> -- --base=<path>` reaches Vite: npm appends the flag to the script's
 * LAST command, so that command must be `vite build` itself ("vite build && cp …" hands --base to cp)
 * and must not set --base already. A command cut at MAX_SCRIPT_COMMAND cannot be checked.
 */
function viteBuildTakesBase(command) {
    if (typeof command !== 'string' || command.length >= MAX_SCRIPT_COMMAND) return false;
    const segments = command.split(COMMAND_SEPARATORS);
    const words = toolWords(segments[segments.length - 1]);
    if (words.length < 2 || toolName(words[0]) !== 'vite' || words[1] !== 'build') return false;
    return !words.some((word) => word === '--base' || word.startsWith('--base='));
}

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
        longRunning: Object.keys(scripts).filter((name) => isLongRunningScript(name, scripts[name], scripts)).sort(),
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

// A script that exists and finishes (not a server or a watcher).
const usable = (project, name) => Boolean(project.scripts[name]) && !project.longRunning.includes(name);

// Vite gets its base path through --base, which only works on a build script ending in `vite build`.
const viteBaseBlocked = (project) => project.framework === 'vite' && usable(project, 'build') && !viteBuildTakesBase(project.scripts.build);

const deployable = (project) => project.stack === 'static'
    || (project.stack === 'node' && usable(project, 'build') && Boolean(project.framework) && !viteBaseBlocked(project));

// True when the repository path `dir` is `folder` or inside it ('.' holds everything).
const isInside = (dir, folder) => folder === '.' || dir === folder || dir.startsWith(`${folder}/`);

/**
 * A static deploy publishes repository files as they are: true when `outputDir` of the project
 * holds the code of another project (Node.js or Python; a site at the root would publish all of
 * it). Static "projects" inside it (about/index.html) are just pages of the published site.
 */
const publishesOtherProjects = (projects, project, outputDir) => {
    const published = joinPath(project.dir, outputDir);
    return projects.some((other) => other.stack !== 'static'
        && !(other.dir === project.dir && other.stack === project.stack)
        && isInside(other.dir, published));
};

// The first site folder of a static project that publishes only the site (null when none does).
const safeSiteDir = (projects, project) => project.siteDirs.find((site) => !publishesOtherProjects(projects, project, site)) || null;

// A static project inside another static site's folder (about/ next to a root index.html) is a page
// of that site: never proposed on its own as the whole site.
const pageOfAnotherSite = (projects, project) => project.stack === 'static' && projects.some((other) => other.stack === 'static'
    && other.dir !== project.dir && other.siteDirs.some((site) => isInside(project.dir, joinPath(other.dir, site))));

const dirLabel = (dir) => (dir === '.' ? 'la raíz del repositorio' : `«${dir}»`);

const defaultTest = (project) => (usable(project, 'test') && !NPM_DEFAULT_TEST.test(project.scripts.test) ? 'test' : null);

/**
 * Spec for one project of the facts (the first deployable one unless `dir`/`stack` pick another).
 * → {spec, notes}: notes are short Spanish explanations shown next to the proposal.
 */
const proposeSpec = (facts, { dir, stack } = {}) => {
    const projects = (facts && facts.projects) || [];
    if (projects.length === 0) {
        throw new AppError('PIPELINE_UNSUPPORTED', 'No Node.js, Python or static site project was found in the repository', 422);
    }
    const notes = [];
    const unsafeSite = (p) => p.stack === 'static' && !safeSiteDir(projects, p);
    const siteToPropose = (p) => p.stack === 'static' && !unsafeSite(p) && !pageOfAnotherSite(projects, p);
    let project;
    if (dir !== undefined || stack !== undefined) {
        project = projects.find((p) => p.dir === dir && (stack === undefined || p.stack === stack));
        if (!project) throw invalid('Unknown project');
        if (unsafeSite(project)) throw invalid('This static site would also publish the code of the other projects of the repository');
    } else {
        project = projects.find((p) => p.stack === 'node' && deployable(p))
            || projects.find(siteToPropose)
            || projects.find((p) => p.stack === 'node')
            || projects.find((p) => p.stack !== 'static' || siteToPropose(p));
        if (!project) throw new AppError('PIPELINE_UNSUPPORTED', 'No project of the repository can be built or published safely', 422);
        const skipped = projects.filter(unsafeSite);
        if (skipped.length && !(project.stack === 'node' && deployable(project))) {
            notes.push(`No se propone publicar el sitio estático de ${skipped.map((p) => dirLabel(p.dir)).join(', ')}: publicaría también el código de los otros proyectos del repositorio.`);
        }
    }

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
        const lint = ['lint', 'eslint'].find((name) => usable(project, name));
        spec.lint = lint ? { kind: 'script', name: lint } : null;
        spec.audit = !lint;
        if (!lint) notes.push('No hay script de lint: el análisis estático será la auditoría de dependencias (npm audit).');
        const test = defaultTest(project);
        spec.test = test ? { kind: 'script', name: test } : null;
        if (!test) notes.push('No hay script de pruebas («test»).');
        spec.build = usable(project, 'build') ? { kind: 'script', name: 'build' } : null;
        const skipped = ['lint', 'test', 'build'].filter((name) => scripts[name] && project.longRunning.includes(name));
        if (skipped.length) {
            notes.push(`No se usa ${skipped.map((name) => `«${name}»`).join(', ')}: inicia un servidor o se queda vigilando cambios y nunca terminaría.`);
        }
        if (deployable(project)) {
            spec.deploy = { target: 'github-pages', framework: project.framework, outputDir: OUTPUT_DIRS[project.framework] };
        } else if (viteBaseBlocked(project)) {
            notes.push('El script «build» no termina en «vite build» (o ya fija --base): TaskMate le agrega --base para publicar staging y producción en su ruta, así que el pipeline no tendrá deploy.');
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
        const site = safeSiteDir(projects, project);
        if (site !== project.siteDirs[0]) {
            notes.push(`Se publica la carpeta «${site}»: publicar ${dirLabel(joinPath(project.dir, project.siteDirs[0]))} incluiría el código de los otros proyectos del repositorio.`);
        }
        spec.deploy = { target: 'github-pages', framework: 'static', outputDir: site };
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

const scriptStep = (value, project, label) => {
    if (value === null || value === undefined) return null;
    onlyKeys(value, ['kind', 'name'], label);
    if (value.kind !== 'script' || typeof value.name !== 'string' || !SCRIPT_RE.test(value.name)) throw invalid(`${label} is invalid`);
    if (!Object.prototype.hasOwnProperty.call(project.scripts, value.name)) throw invalid(`${label}: package.json has no "${value.name}" script`);
    if (project.longRunning.includes(value.name)) {
        throw invalid(`${label}: "${value.name}" starts a server or a watcher and would never finish`);
    }
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
        out.lint = scriptStep(spec.lint, project, 'lint');
        out.audit = spec.audit === true;
        out.test = scriptStep(spec.test, project, 'test');
        out.build = scriptStep(spec.build, project, 'build');
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
            if (framework === 'vite' && !viteBuildTakesBase(project.scripts[out.build.name])) {
                throw invalid(`deploy: the "${out.build.name}" script must end with a plain "vite build" (TaskMate appends --base=… to it for staging and production)`);
            }
        }
        if (framework === 'static' && publishesOtherProjects(facts.projects, project, outputDir)) {
            throw invalid('deploy.outputDir would also publish the code of other projects of the repository');
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

const AUDIT_COMMAND = 'npm audit --omit=dev --audit-level=high';
// Ruff and pytest report in GitHub's format, so failures become annotations on the file and line
// (the pytest plugin turns itself on inside Actions). Jest is left alone: CRA's Jest 27 has no
// GitHub reporter; Vitest already annotates by itself.
const RUFF_COMMAND = 'ruff check --output-format=github .';
const PYTEST_INSTALL = 'python -m pip install pytest pytest-github-actions-annotate-failures';
const PYTEST_COMMAND = 'python -m pytest';

/** [{key, label, commands}] in pipeline order; deploy last. */
const describeStages = (spec) => {
    const stages = [];
    const add = (key, label, commands) => stages.push({ key, label, commands });
    if (spec.install) add('install', 'Instalar dependencias', installCommands(spec));
    if (spec.lint) add('lint', 'Análisis estático', spec.lint.kind === 'ruff' ? [RUFF_COMMAND] : [scriptCommand(spec.lint)]);
    if (spec.audit) add('audit', 'Auditoría de dependencias', [AUDIT_COMMAND]);
    if (spec.test) add('test', 'Pruebas', spec.test.kind === 'pytest' ? [PYTEST_COMMAND] : [scriptCommand(spec.test)]);
    if (spec.build) add('build', 'Build', [scriptCommand(spec.build)]);
    if (spec.project.stack === 'static' && spec.deploy) add('check', 'Verificar el sitio', [`test -f ${joinPath(spec.deploy.outputDir, 'index.html')}`]);
    if (spec.deploy) {
        add('deploy', 'Deploy a GitHub Pages', [
            'staging: /staging/ (automático en la rama principal)',
            'producción: / (con aprobación en TaskMate)',
            'solo se construye la versión que se despliega; el otro entorno se conserva del sitio publicado',
        ]);
    }
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
    downloadArtifact: 'actions/download-artifact@v8',
    deployPages: 'actions/deploy-pages@v5',
});

// The Pages artifact (upload-pages-artifact's default name; it holds artifact.tar) is kept 90 days
// instead of 1: the next deploy downloads it to keep the environment it does not rebuild.
const PAGES_ARTIFACT = 'github-pages';
const PAGES_RETENTION_DAYS = 90;
const PREVIOUS_DIR = '_taskmate/previous';
const PREVIOUS_TAR = `${PREVIOUS_DIR}/artifact.tar`;
const DEPLOY_GROUP = 'taskmate-pages';

const step = (out, name, { id, ifExpr, continueOnError, uses, workingDirectory, withs, env, run } = {}) => {
    out.add(6, `- name: ${q(name)}`);
    if (id) out.add(8, `id: ${id}`);
    if (ifExpr) out.add(8, `if: ${ifExpr}`);
    if (continueOnError) out.add(8, 'continue-on-error: true');
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
        // Always quoted: a script name may end in ":" and `run: npm run lint:` is not valid YAML.
        if (run.length === 1) out.add(8, `run: ${q(run[0])}`);
        else out.block(8, 'run', run);
    }
};

const permissions = (out, entries) => {
    out.add(4, 'permissions:');
    Object.entries(entries).forEach(([key, value]) => out.add(6, `${key}: ${value}`));
};

const setupRuntime = (out, spec, { cache, ifExpr }) => {
    const dir = spec.project.dir;
    if (spec.project.stack === 'node') {
        const withs = { 'node-version': q(spec.runtime) };
        if (cache && spec.install && spec.install.kind === 'npm-ci') {
            withs.cache = 'npm';
            withs['cache-dependency-path'] = q(joinPath(dir, 'package-lock.json'));
        } else {
            withs['package-manager-cache'] = 'false';
        }
        step(out, `Node.js ${spec.runtime}`, { ifExpr, uses: ACTIONS.setupNode, withs });
    } else if (spec.project.stack === 'python') {
        step(out, `Python ${spec.runtime}`, { ifExpr, uses: ACTIONS.setupPython, withs: { 'python-version': q(spec.runtime) } });
    }
};

const ciSteps = (out, spec) => {
    step(out, 'Checkout', { uses: ACTIONS.checkout, withs: { 'persist-credentials': 'false' } });
    setupRuntime(out, spec, { cache: true });
    const install = installCommands(spec);
    if (install.length) step(out, 'Instalar dependencias', { run: install });
    if (spec.lint) {
        step(out, 'Análisis estático', {
            run: spec.lint.kind === 'ruff' ? ['python -m pip install ruff', RUFF_COMMAND] : [scriptCommand(spec.lint)],
        });
    }
    if (spec.audit) step(out, 'Auditoría de dependencias', { run: [AUDIT_COMMAND] });
    if (spec.test) {
        step(out, 'Pruebas', {
            run: spec.test.kind === 'pytest' ? [PYTEST_INSTALL, PYTEST_COMMAND] : [scriptCommand(spec.test)],
        });
    }
    if (spec.build) step(out, 'Build', { run: [scriptCommand(spec.build)] });
    if (spec.project.stack === 'static' && spec.deploy) {
        const index = joinPath(spec.deploy.outputDir, 'index.html');
        step(out, 'Verificar el sitio', { run: [`test -f ${q(index)} || { echo "::error::Falta ${index}"; exit 1; }`] });
    }
};

// What to publish and the GitHub Deployment that records it. Push runs whose commit is no longer the
// head of the default branch (re-runs of old runs) deploy nothing: skip=true and no Deployment.
// base_run is the run of the newest successful TaskMate deploy: its Pages artifact is the site live
// now, so only the target environment is rebuilt; other_version is the other environment's live
// commit, rebuilt only when that artifact cannot be downloaded.
const VERSIONS_SCRIPT = [
    'const SHA = /^[0-9a-f]{40}$/;',
    `const TASK = '${DEPLOY_TASK}';`,
    'const target = process.env.TARGET_ENV;',
    'const version = process.env.TARGET_VERSION;',
    "const requestedBy = String(process.env.REQUESTED_BY || '').replace(/[^A-Za-z0-9_.@ -]/g, '').slice(0, 60);",
    "if (!['staging', 'production'].includes(target)) throw new Error('Entorno inválido: ' + target);",
    "if (!SHA.test(version)) throw new Error('Versión inválida (se espera el SHA completo del commit): ' + version);",
    'const { owner, repo } = context.repo;',
    "core.setOutput('skip', 'false');",
    "if (context.eventName === 'push') {",
    '  const branch = context.payload.repository.default_branch;',
    "  const { data: head } = await github.rest.git.getRef({ owner, repo, ref: 'heads/' + branch });",
    '  if (head.object.sha !== version) {',
    "    core.notice('No se despliega ' + version.slice(0, 7) + ': ya no es la última versión de ' + branch + '.');",
    "    core.setOutput('skip', 'true');",
    '    return;',
    '  }',
    '}',
    'const succeeded = async (deployment) => {',
    '  const { data } = await github.rest.repos.listDeploymentStatuses({ owner, repo, deployment_id: deployment.id, per_page: 1 });',
    "  return data.length > 0 && data[0].state === 'success';",
    '};',
    'const runIdOf = (deployment) => {',
    '  let payload = deployment.payload;',
    "  for (let i = 0; i < 3 && typeof payload === 'string'; i += 1) {",
    '    try {',
    '      payload = JSON.parse(payload);',
    '    } catch (err) {',
    "      return '';",
    '    }',
    '  }',
    "  const runId = payload && typeof payload === 'object' ? Number(payload.runId) : 0;",
    "  return Number.isSafeInteger(runId) && runId > 0 ? String(runId) : '';",
    '};',
    "let baseRun = '';",
    'const { data: recent } = await github.rest.repos.listDeployments({ owner, repo, task: TASK, per_page: 30 });',
    'for (const deployment of recent) {',
    "  if (['staging', 'production'].includes(deployment.environment) && await succeeded(deployment)) {",
    '    baseRun = runIdOf(deployment);',
    '    break;',
    '  }',
    '}',
    "const other = target === 'staging' ? 'production' : 'staging';",
    "let otherVersion = '';",
    'const { data: otherDeploys } = await github.rest.repos.listDeployments({ owner, repo, environment: other, task: TASK, per_page: 30 });',
    'for (const deployment of otherDeploys) {',
    '  if (SHA.test(deployment.sha) && await succeeded(deployment)) {',
    '    otherVersion = deployment.sha;',
    '    break;',
    '  }',
    '}',
    "const pathOf = (environment) => (environment === 'staging' ? '/staging/' : '/');",
    "core.setOutput('target', target);",
    "core.setOutput('target_version', version);",
    "core.setOutput('target_path', pathOf(target));",
    "core.setOutput('other_version', otherVersion);",
    "core.setOutput('other_path', pathOf(other));",
    "core.setOutput('base_run', baseRun);",
    "const logUrl = context.serverUrl + '/' + owner + '/' + repo + '/actions/runs/' + context.runId;",
    'const { data: deployment } = await github.rest.repos.createDeployment({',
    '  owner, repo, ref: version, task: TASK, environment: target,',
    "  auto_merge: false, required_contexts: [], production_environment: target === 'production', transient_environment: false,",
    "  description: requestedBy ? 'Desde TaskMate, pedido por ' + requestedBy : 'Desde TaskMate',",
    '  payload: { taskmate: true, requestedBy, runId: context.runId },',
    '});',
    "if (!deployment.id) throw new Error('GitHub no creó el deployment: ' + (deployment.message || ''));",
    '// Right away, so the failure step can close this deployment whatever fails next.',
    "core.setOutput('deployment_id', String(deployment.id));",
    "await github.rest.repos.createDeploymentStatus({ owner, repo, deployment_id: deployment.id, state: 'in_progress', log_url: logUrl });",
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

// Closes a deployment that is still open. Never over a final status: the close job may run after a
// recorder already wrote one, and a deployment that ended (maybe live now) keeps it.
const FAILURE_SCRIPT = [
    'const { owner, repo } = context.repo;',
    'const deploymentId = Number(process.env.DEPLOYMENT_ID);',
    'const { data: statuses } = await github.rest.repos.listDeploymentStatuses({ owner, repo, deployment_id: deploymentId, per_page: 1 });',
    "const last = statuses.length > 0 ? statuses[0].state : '';",
    "if (['success', 'failure', 'error', 'inactive'].includes(last)) {",
    "  core.info('El deploy ya quedó registrado como ' + last + '.');",
    '  return;',
    '}',
    "const logUrl = context.serverUrl + '/' + owner + '/' + repo + '/actions/runs/' + context.runId;",
    'await github.rest.repos.createDeploymentStatus({',
    "  owner, repo, deployment_id: deploymentId, state: 'failure', log_url: logUrl,",
    '});',
];

// The deploy job publishes the Pages artifact of this run with the deployment of the build job.
// Re-running only the deploy job ("Re-run failed jobs" after a failed deploy, "Re-run this job")
// would reuse the build outputs and artifact of an earlier attempt: the whole site as it was then,
// over newer deploys, and its old deployment marked live. Only a build of this attempt deploys.
const ATTEMPT_SCRIPT = [
    "const built = String(process.env.BUILD_ATTEMPT || '');",
    "const attempt = String(process.env.RUN_ATTEMPT || '');",
    'if (built !== attempt) {',
    "  core.setFailed('No se vuelve a ejecutar solo el deploy: publicaría el sitio que armó el intento ' + (built || '?')",
    "    + ' de esta ejecución, que puede estar desactualizado. Vuelve a desplegar desde TaskMate (o vuelve a ejecutar todos los jobs).');",
    '}',
];

const PLACEHOLDER_HTML = [
    '<!doctype html>',
    '<html lang="es"><head><meta charset="utf-8"><title>Sin versión en producción</title></head>',
    '<body><p>Producción todavía no tiene una versión publicada desde TaskMate.</p>',
    '<p><a href="staging/">Ver staging</a></p></body></html>',
];

const PRODUCTION_UNAVAILABLE_HTML = [
    '<!doctype html>',
    '<html lang="es"><head><meta charset="utf-8"><title>Producción no disponible</title></head>',
    '<body><p>TaskMate no pudo reconstruir la versión publicada de producción. Vuelve a desplegarla desde TaskMate.</p>',
    '<p><a href="staging/">Ver staging</a></p></body></html>',
];

const STAGING_UNAVAILABLE_HTML = [
    '<!doctype html>',
    '<html lang="es"><head><meta charset="utf-8"><title>Staging no disponible</title></head>',
    '<body><p>TaskMate no pudo reconstruir la versión publicada de staging; vuelve con el próximo deploy a staging.</p></body></html>',
];

const SKIP = "steps.versions.outputs.skip != 'true'";

// Checkout (and build, for Node) of one version: 'target' is the version being deployed; 'other'
// is the live version of the other environment, a fallback that never fails the deploy.
const versionSteps = (out, spec, which, { names, ifExpr, fallback }) => {
    const checkoutDir = `_taskmate/${which}`;
    step(out, names.checkout, {
        id: `${which}_checkout`,
        ifExpr,
        continueOnError: fallback,
        uses: ACTIONS.checkout,
        withs: { ref: `\${{ steps.versions.outputs.${which}_version }}`, path: q(checkoutDir), 'persist-credentials': 'false' },
    });
    if (spec.project.stack !== 'node') return;
    const run = [...installCommands(spec)];
    if (spec.build) {
        if (spec.deploy.framework === 'vite') run.push(`${scriptCommand(spec.build)} -- --base="$BASE_PATH"`);
        // As is: CRA accepts the trailing slash, and "/" (user sites, custom domains) cut to "" is ignored.
        else if (spec.deploy.framework === 'cra') run.push(`PUBLIC_URL="$BASE_PATH" ${scriptCommand(spec.build)}`);
        else run.push(scriptCommand(spec.build));
    }
    step(out, names.build, {
        id: `${which}_build`,
        ifExpr: `steps.${which}_checkout.outcome == 'success'`,
        continueOnError: fallback,
        workingDirectory: joinPath(checkoutDir, spec.project.dir),
        env: { BASE_PATH: `\${{ steps.pages.outputs.base_path }}\${{ steps.versions.outputs.${which}_path }}` },
        run,
    });
};

// The site to publish: the published one (or the other environment rebuilt, or a placeholder) with
// the target environment replaced. Production is everything but staging/; staging is staging/.
const assembleScript = (spec) => {
    const site = (which) => q(joinPath(`_taskmate/${which}`, spec.project.dir, spec.deploy.outputDir));
    const html = (lines) => lines.map(q).join(' ');
    return [
        'set -euo pipefail',
        'copy_site() {',
        '  local from="$1" to="$2"',
        '  shift 2',
        '  if [ ! -d "$from" ]; then echo "::error::No se encontró la carpeta del sitio: $from"; return 1; fi',
        '  mkdir -p "$to"',
        '  tar --exclude=./.git --exclude=./.github "$@" -C "$from" -cf - . | tar -C "$to" -xf -',
        '}',
        'copy_env() {',
        '  if [ "$2" = production ]; then copy_site "$1" _site --exclude=./staging; else copy_site "$1" _site/staging; fi',
        '}',
        'clear_env() {',
        '  if [ "$1" = production ]; then find _site -mindepth 1 -maxdepth 1 ! -name staging -exec rm -rf {} +; else rm -rf _site/staging; fi',
        '}',
        'if [ "$TARGET_ENV" = production ]; then OTHER_ENV=staging; else OTHER_ENV=production; fi',
        'rm -rf _site',
        'mkdir -p _site',
        `if [ "$PREVIOUS" = success ] && [ -f ${q(PREVIOUS_TAR)} ]; then`,
        `  tar -C _site -xf ${q(PREVIOUS_TAR)}`,
        'elif [ -n "$OTHER_VERSION" ]; then',
        `  if [ "$OTHER_BUILT" = success ] && copy_env ${site('other')} "$OTHER_ENV"; then`,
        '    echo "No se pudo descargar el sitio publicado: se reconstruyó $OTHER_ENV desde ${OTHER_VERSION:0:7}."',
        '  else',
        '    echo "::warning::No se pudo reconstruir $OTHER_ENV (${OTHER_VERSION:0:7}): queda una página provisional hasta su próximo deploy."',
        '    clear_env "$OTHER_ENV"',
        '    if [ "$OTHER_ENV" = production ]; then',
        `      printf '%s\\n' ${html(PRODUCTION_UNAVAILABLE_HTML)} > _site/index.html`,
        '    else',
        '      mkdir -p _site/staging',
        `      printf '%s\\n' ${html(STAGING_UNAVAILABLE_HTML)} > _site/staging/index.html`,
        '    fi',
        '  fi',
        'elif [ "$TARGET_ENV" = staging ]; then',
        `  printf '%s\\n' ${html(PLACEHOLDER_HTML)} > _site/index.html`,
        'fi',
        'clear_env "$TARGET_ENV"',
        `copy_env ${site('target')} "$TARGET_ENV"`,
    ];
};

// Build job: installs and builds without the OIDC token or Pages write access (those are only in the
// deploy job, which runs no code of the repository).
const buildJob = (out, spec) => {
    out.add(2, 'build:');
    out.add(4, "name: 'Build del deploy'");
    out.add(4, 'needs: ci');
    // Pushes to the default branch that passed CI go to staging; TaskMate dispatches production,
    // promotions and rollbacks (CI is skipped then: TaskMate only deploys versions that passed it).
    // !cancelled(), not always(): a job whose `if` uses always() keeps running when the run is cancelled.
    out.add(4, 'if: >-');
    out.add(6, '!cancelled() && github.ref_name == github.event.repository.default_branch && (');
    out.add(8, "(github.event_name == 'push' && needs.ci.result == 'success') ||");
    out.add(8, "(github.event_name == 'workflow_dispatch' && inputs.environment != 'none')");
    out.add(6, ')');
    out.add(4, 'runs-on: ubuntu-latest');
    out.add(4, 'timeout-minutes: 30');
    // pages: read is what configure-pages needs to read the site's base path.
    permissions(out, { actions: 'read', contents: 'read', deployments: 'write', pages: 'read' });
    out.add(4, 'outputs:');
    out.add(6, 'skip: ${{ steps.versions.outputs.skip }}');
    out.add(6, 'target: ${{ steps.versions.outputs.target }}');
    out.add(6, 'deployment_id: ${{ steps.versions.outputs.deployment_id }}');
    // The deploy and close jobs only act on a build of their own attempt (see ATTEMPT_SCRIPT).
    out.add(6, 'attempt: ${{ github.run_attempt }}');
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
    step(out, 'Configurar GitHub Pages', { id: 'pages', ifExpr: SKIP, uses: ACTIONS.configurePages });
    if (spec.project.stack === 'node') setupRuntime(out, spec, { cache: false, ifExpr: SKIP });
    step(out, 'Descargar el sitio publicado', {
        id: 'previous',
        ifExpr: `${SKIP} && steps.versions.outputs.base_run != ''`,
        continueOnError: true,
        uses: ACTIONS.downloadArtifact,
        withs: {
            name: PAGES_ARTIFACT,
            'run-id': '${{ steps.versions.outputs.base_run }}',
            'github-token': '${{ github.token }}',
            path: q(PREVIOUS_DIR),
        },
    });
    versionSteps(out, spec, 'target', {
        names: { checkout: 'Checkout de la versión a desplegar', build: 'Build de la versión a desplegar' },
        ifExpr: SKIP,
        fallback: false,
    });
    versionSteps(out, spec, 'other', {
        names: { checkout: 'Checkout del otro entorno (respaldo)', build: 'Build del otro entorno (respaldo)' },
        ifExpr: `${SKIP} && steps.versions.outputs.other_version != '' && (steps.previous.outcome != 'success' || hashFiles('${PREVIOUS_TAR}') == '')`,
        fallback: true,
    });
    step(out, 'Armar el sitio (producción en /, staging en /staging/)', {
        ifExpr: SKIP,
        env: {
            TARGET_ENV: '${{ steps.versions.outputs.target }}',
            OTHER_VERSION: '${{ steps.versions.outputs.other_version }}',
            PREVIOUS: '${{ steps.previous.outcome }}',
            OTHER_BUILT: spec.project.stack === 'node' ? '${{ steps.other_build.outcome }}' : '${{ steps.other_checkout.outcome }}',
        },
        run: assembleScript(spec),
    });
    step(out, 'Subir el sitio', {
        ifExpr: SKIP,
        uses: ACTIONS.uploadPages,
        withs: { path: '_site', 'retention-days': String(PAGES_RETENTION_DAYS) },
    });
    step(out, 'Registrar el deploy fallido', {
        ifExpr: "(failure() || cancelled()) && steps.versions.outputs.deployment_id != ''",
        uses: ACTIONS.githubScript,
        env: { DEPLOYMENT_ID: '${{ steps.versions.outputs.deployment_id }}' },
        withs: { script: FAILURE_SCRIPT },
    });
};

const deployJob = (out) => {
    out.add(2, 'deploy:');
    out.add(4, "name: 'Deploy a GitHub Pages'");
    out.add(4, 'needs: build');
    out.add(4, 'if: >-');
    out.add(6, "!cancelled() && needs.build.result == 'success' && needs.build.outputs.skip != 'true'");
    out.add(4, 'runs-on: ubuntu-latest');
    out.add(4, 'timeout-minutes: 20');
    permissions(out, { actions: 'read', deployments: 'write', 'id-token': 'write', pages: 'write' });
    out.add(4, 'environment:');
    out.add(6, 'name: github-pages');
    out.add(6, 'url: ${{ steps.publish.outputs.page_url }}');
    out.add(4, 'steps:');
    step(out, 'Comprobar que el build es de este intento', {
        id: 'current',
        uses: ACTIONS.githubScript,
        env: { BUILD_ATTEMPT: '${{ needs.build.outputs.attempt }}', RUN_ATTEMPT: '${{ github.run_attempt }}' },
        withs: { script: ATTEMPT_SCRIPT },
    });
    step(out, 'Publicar en GitHub Pages', { id: 'publish', uses: ACTIONS.deployPages });
    // Both recorders only after the attempt check passed: a refused re-run never writes a status on
    // the old deployment (it may be the live one).
    step(out, 'Registrar el deploy', {
        ifExpr: "steps.current.outcome == 'success'",
        uses: ACTIONS.githubScript,
        env: {
            DEPLOYMENT_ID: '${{ needs.build.outputs.deployment_id }}',
            TARGET_ENV: '${{ needs.build.outputs.target }}',
            PAGE_URL: '${{ steps.publish.outputs.page_url }}',
        },
        withs: { script: SUCCESS_SCRIPT },
    });
    step(out, 'Registrar el deploy fallido', {
        ifExpr: "(failure() || cancelled()) && needs.build.outputs.deployment_id != '' && steps.current.outcome == 'success'",
        uses: ACTIONS.githubScript,
        env: { DEPLOYMENT_ID: '${{ needs.build.outputs.deployment_id }}' },
        withs: { script: FAILURE_SCRIPT },
    });
};

// Closes the deployment when the deploy job never ran its recorders: the run was cancelled between
// build and deploy (deploy is then skipped), an environment rule of github-pages rejected the job
// before its first step, a runner was lost. always() is safe here: the job runs no repository code
// and only writes on a deployment that is still open (FAILURE_SCRIPT); the attempt check keeps a
// partial re-run away from the deployment of an earlier attempt.
const closeJob = (out) => {
    out.add(2, 'close:');
    out.add(4, "name: 'Cerrar el deploy'");
    out.add(4, 'needs: [build, deploy]');
    out.add(4, 'if: >-');
    out.add(6, "always() && needs.build.outputs.deployment_id != '' && needs.build.outputs.attempt == github.run_attempt");
    out.add(6, "&& needs.deploy.result != 'success'");
    out.add(4, 'runs-on: ubuntu-latest');
    out.add(4, 'timeout-minutes: 5');
    permissions(out, { deployments: 'write' });
    out.add(4, 'steps:');
    step(out, 'Registrar el deploy fallido', {
        uses: ACTIONS.githubScript,
        env: { DEPLOYMENT_ID: '${{ needs.build.outputs.deployment_id }}' },
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
    if (spec.deploy) {
        // Runs that may deploy (pushes to the default branch, deploys from TaskMate) take turns, in
        // order, none dropped: the build job reads the published site and replaces one environment,
        // so the whole run holds the group (job-level groups would let another run's build slip in
        // between this build and its deploy). queue: max keeps up to 100 waiting runs; the default
        // keeps one and cancels the older one. Runs that cannot deploy get a group of their own.
        out.add(0, 'concurrency:');
        out.add(2, 'group: >-');
        out.add(4, "${{ github.ref_name == github.event.repository.default_branch && (github.event_name == 'push' ||");
        out.add(4, "(github.event_name == 'workflow_dispatch' && inputs.environment != 'none'))");
        out.add(4, `&& '${DEPLOY_GROUP}' || format('taskmate-run-{0}', github.run_id) }}`);
        out.add(2, 'cancel-in-progress: false');
        out.add(2, 'queue: max');
        out.add(0);
    }
    out.add(0, 'jobs:');
    out.add(2, 'ci:');
    out.add(4, `name: ${q(CI_JOB_NAMES[spec.project.stack])}`);
    out.add(4, "if: github.event_name != 'workflow_dispatch' || inputs.environment == 'none'");
    out.add(4, 'runs-on: ubuntu-latest');
    out.add(4, 'timeout-minutes: 30');
    // Per event and ref, so a manual run never cancels a push run. On the default branch nothing is
    // cancelled (that push may still deploy); on other branches and PRs a newer commit wins.
    out.add(4, 'concurrency:');
    out.add(6, 'group: taskmate-ci-${{ github.event_name }}-${{ github.ref }}');
    out.add(6, 'cancel-in-progress: ${{ github.ref_name != github.event.repository.default_branch }}');
    if (spec.project.dir !== '.') {
        out.add(4, 'defaults:');
        out.add(6, 'run:');
        out.add(8, `working-directory: ${q(spec.project.dir)}`);
    }
    out.add(4, 'steps:');
    ciSteps(out, spec);
    if (spec.deploy) {
        out.add(0);
        buildJob(out, spec);
        out.add(0);
        deployJob(out);
        out.add(0);
        closeJob(out);
    }
    return out.toString();
};

const isTaskmateWorkflow = (text) => typeof text === 'string' && WORKFLOW_MARKER_RE.test(text);

/** Template version of a TaskMate workflow file (its marker line), or null for any other file. */
const templateVersionOf = (text) => {
    const match = typeof text === 'string' ? text.match(WORKFLOW_MARKER_RE) : null;
    return match ? Number(match[1]) : null;
};

module.exports = {
    SPEC_VERSION,
    TEMPLATE_VERSION,
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
    isLongRunningScript,
    viteBuildTakesBase,
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
    templateVersionOf,
};
