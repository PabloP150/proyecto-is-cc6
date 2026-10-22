// Phase 4: configure the group's CI/CD pipeline from TaskMate. Reads the repository (facts),
// proposes (or asks the AI for, pipelineAi.js) and validates a spec (pipelineSpec.js), enables
// GitHub Pages when the pipeline deploys, and commits the rendered workflow to the default branch.
const { AppError, isAppError } = require('../../helpers/errors');
const cicdModel = require('../../models/cicd.model');
const { githubApp, PERMISSIONS } = require('./githubApp');
const repoService = require('./repoService');
const pipelineSpec = require('./pipelineSpec');
const pipelineAi = require('./pipelineAi');
const { TtlStore } = require('./ttlStore');

const MAX_MANIFEST_BYTES = 256 * 1024;
const FACTS_TTL_MS = 15 * 60 * 1000;
const MAX_USERNAME = 40;
// Facts behind the last proposal per (repository, user), so previews do not read the repository again.
const factsCache = new TtlStore({ ttlMs: FACTS_TTL_MS, maxEntries: 500 });

const { repoAuth, repoPath, scope } = repoService;
const factsKey = (repo, uid) => `${repo.repoId}:${String(uid).toLowerCase()}`;
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// One small text file of the default branch; null when it is missing, too large or binary.
const readText = async (repo, path) => {
    try {
        const file = await repoService.getFileForRepo(repo, { path });
        if (file.binary || typeof file.content !== 'string' || file.size > MAX_MANIFEST_BYTES) return null;
        return file.content;
    } catch (err) {
        if (isAppError(err) && ['FILE_NOT_FOUND', 'FILE_TOO_LARGE', 'VALIDATION_ERROR'].includes(err.code)) return null;
        throw err;
    }
};

/**
 * What the default branch looks like: candidate projects (Node.js, Python, static sites) with the
 * facts the spec is validated against. Only files the tree lists are read (no 404 round trips).
 */
const collectFacts = async (repo) => {
    const tree = await repoService.getTreeForRepo(repo);
    const blobs = tree.entries.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
    const projects = [];
    for (const candidate of pipelineSpec.findProjectDirs(tree.entries)) {
        const files = pipelineSpec.filesUnder(blobs, candidate.dir);
        const read = (name) => (files.includes(name) ? readText(repo, pipelineSpec.joinPath(candidate.dir, name)) : null);
        if (candidate.node) {
            const packageJson = await read('package.json');
            const nodeVersion = (await read('.nvmrc')) || (await read('.node-version'));
            projects.push(pipelineSpec.nodeFacts(candidate.dir, files, { packageJson, nodeVersion }, candidate.siteDirs));
        }
        if (candidate.python) {
            const base = pipelineSpec.pythonFacts(candidate.dir, files);
            const requirements = {};
            for (const file of base.requirementFiles) requirements[file] = await read(file);
            const pyproject = await read('pyproject.toml');
            const pythonVersion = await read('.python-version');
            projects.push(pipelineSpec.pythonFacts(candidate.dir, files, { requirements, pyproject, pythonVersion }));
        }
        if (!candidate.node && candidate.siteDirs.length > 0) projects.push(pipelineSpec.staticFacts(candidate.dir, candidate.siteDirs));
    }
    return {
        defaultBranch: repo.defaultBranch,
        headSha: tree.sha,
        truncated: Boolean(tree.truncated),
        workflowExists: blobs.includes(pipelineSpec.WORKFLOW_PATH),
        projects,
    };
};

const cachedFacts = async (repo, uid) => {
    const key = factsKey(repo, uid);
    const cached = factsCache.get(key);
    if (cached) return cached;
    const facts = await collectFacts(repo);
    factsCache.set(key, facts);
    return facts;
};

const options = () => ({
    nodeVersions: [...pipelineSpec.NODE_VERSIONS],
    pythonVersions: [...pipelineSpec.PYTHON_VERSIONS],
});

const rendered = (spec) => ({
    spec,
    stages: pipelineSpec.describeStages(spec),
    yaml: pipelineSpec.renderWorkflow(spec),
});

// ---------------------------------------------------------------- GitHub Pages

const pagesUrl = (repo) => `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/settings/pages`;

/** {enabled, buildType, url, settingsUrl} — or {error} when it cannot be read (e.g. permissions not accepted yet). */
const getPagesStatus = async (repo) => {
    try {
        const { status, data } = await githubApp.request(repoAuth(repo), 'GET', `${repoPath(repo)}/pages`, {
            ...scope(repo, PERMISSIONS.pagesRead),
            allowStatus: [404],
        });
        if (status === 404 || !data) return { enabled: false, buildType: null, url: null, settingsUrl: pagesUrl(repo) };
        return {
            enabled: true,
            buildType: data.build_type || null,
            url: typeof data.html_url === 'string' ? data.html_url : null,
            settingsUrl: pagesUrl(repo),
        };
    } catch (err) {
        if (isAppError(err) && ['APP_PERMISSIONS_MISSING', 'REPO_NOT_ACCESSIBLE'].includes(err.code)) {
            return { enabled: null, error: err.code, settingsUrl: pagesUrl(repo) };
        }
        throw err;
    }
};

const pagesError = (data) => {
    const message = data && typeof data.message === 'string' ? data.message : '';
    if (/plan|upgrade|not available|private/i.test(message)) {
        return new AppError('PAGES_UNAVAILABLE', 'GitHub Pages is not available for this repository on its current plan', 409);
    }
    return new AppError('GITHUB_ERROR', 'GitHub could not enable Pages', 502);
};

/**
 * Makes sure Pages publishes from GitHub Actions ("workflow" build type): creates the site, or
 * switches an existing branch-based site. → {enabled: true, changed, url}
 */
const ensurePages = async (repo) => {
    const current = await getPagesStatus(repo);
    if (current.enabled === true && current.buildType === 'workflow') return { enabled: true, changed: false, url: current.url };
    const request = (method) => githubApp.request(repoAuth(repo), method, `${repoPath(repo)}/pages`, {
        ...scope(repo, PERMISSIONS.pagesAdmin),
        body: { build_type: 'workflow' },
        allowStatus: [409, 422],
    });
    let result = await request(current.enabled === true ? 'PUT' : 'POST');
    // Created meanwhile (or the read was not allowed): switch it to the workflow build type.
    if (result.status === 409) result = await request('PUT');
    if (result.status === 409 || result.status === 422) throw pagesError(result.data);
    const after = await getPagesStatus(repo);
    return { enabled: true, changed: true, url: after.url || null };
};

// ---------------------------------------------------------------- workflow file

const isProtectionMessage = (message) => /protected|pull request|rule|required status/i.test(message);

const latestCommitOf = async (repo, path, auth) => {
    const { data } = await githubApp.request(auth.auth, 'GET', `${repoPath(repo)}/commits`, {
        ...auth.scope,
        query: { sha: repo.defaultBranch, path, per_page: 1 },
    });
    const commit = Array.isArray(data) ? data[0] : null;
    return commit ? { sha: commit.sha, url: commit.html_url || null } : null;
};

const cleanUsername = (username) => String(username || '').replace(/[^\p{L}\p{N}_.@ -]/gu, '').trim().slice(0, MAX_USERNAME) || 'un administrador';

/**
 * Writes the workflow to the default branch. A file at the same path that TaskMate did not write is
 * never overwritten. → {sha, url, changed}
 */
const commitWorkflow = async (repo, text, { username } = {}) => {
    const path = pipelineSpec.WORKFLOW_PATH;
    const auth = { auth: repoAuth(repo), scope: scope(repo, PERMISSIONS.writeWorkflow) };
    const url = `${repoPath(repo)}/contents/${encodePath(path)}`;
    const existing = await githubApp.request(auth.auth, 'GET', url, { ...auth.scope, query: { ref: repo.defaultBranch }, allowStatus: [404] });

    let existingSha;
    if (existing.status !== 404 && existing.data) {
        if (Array.isArray(existing.data) || existing.data.type !== 'file') {
            throw new AppError('WORKFLOW_CONFLICT', 'The workflow path is not a regular file', 409);
        }
        const current = Buffer.from(existing.data.content || '', existing.data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
        if (!pipelineSpec.isTaskmateWorkflow(current)) {
            throw new AppError('WORKFLOW_CONFLICT', 'A workflow with the same name exists and was not written by TaskMate', 409);
        }
        if (current === text) {
            const last = await latestCommitOf(repo, path, auth);
            if (last) return { ...last, changed: false };
        }
        existingSha = existing.data.sha;
    }

    const result = await githubApp.request(auth.auth, 'PUT', url, {
        ...auth.scope,
        body: {
            message: `ci: configurar el pipeline de TaskMate\n\nConfigurado por ${cleanUsername(username)} desde TaskMate.`,
            content: Buffer.from(text, 'utf8').toString('base64'),
            branch: repo.defaultBranch,
            ...(existingSha ? { sha: existingSha } : {}),
        },
        allowStatus: [409, 422],
    });
    if (result.status === 409 || result.status === 422) {
        const message = result.data && typeof result.data.message === 'string' ? result.data.message : '';
        if (isProtectionMessage(message)) {
            throw new AppError('BRANCH_PROTECTED', 'The default branch only accepts changes through pull requests', 409);
        }
        if (result.status === 409) throw new AppError('WORKFLOW_CHANGED', 'The workflow file changed on GitHub meanwhile; try again', 409);
        throw new AppError('GITHUB_ERROR', 'GitHub rejected the workflow file', 502);
    }
    const commit = result.data && result.data.commit;
    if (!commit || typeof commit.sha !== 'string') throw new AppError('GITHUB_ERROR', 'GitHub returned no commit', 502);
    return { sha: commit.sha, url: commit.html_url || null, changed: true };
};

// ---------------------------------------------------------------- operations used by the routes

const formatPipeline = (row) => {
    if (!row) return null;
    const spec = row.spec && typeof row.spec === 'object' ? row.spec : null;
    return {
        workflowPath: row.workflowPath,
        commitSha: row.commitSha,
        configuredAt: row.configuredAt,
        configuredBy: row.configuredByUsername,
        spec,
        stages: spec ? pipelineSpec.describeStages(spec) : [],
        deploys: Boolean(spec && spec.deploy),
    };
};

/** The pipeline TaskMate configured for the group's repository (null if none) and the Pages status. */
/**
 * The workflow file as it is on the default branch: {present, templateVersion, currentVersion,
 * outdated}. outdated = written by an older TaskMate template (it lacks fixes the current one has);
 * null when it cannot be read right now (the card just shows no warning).
 */
const getWorkflowStatus = async (repo) => {
    const current = pipelineSpec.TEMPLATE_VERSION;
    try {
        const file = await repoService.getFileForRepo(repo, { path: pipelineSpec.WORKFLOW_PATH });
        const version = pipelineSpec.templateVersionOf(file.content);
        return { present: true, templateVersion: version, currentVersion: current, outdated: version !== null && version < current };
    } catch (err) {
        if (isAppError(err) && err.code === 'FILE_NOT_FOUND') {
            return { present: false, templateVersion: null, currentVersion: current, outdated: false };
        }
        if (isAppError(err)) return null;
        throw err;
    }
};

const getPipeline = async (gid) => {
    const repo = await repoService.getConnectedRepo(gid);
    const row = await cicdModel.getPipeline(repo.repoId);
    const pipeline = formatPipeline(row);
    return {
        pipeline,
        workflowPath: pipelineSpec.WORKFLOW_PATH,
        workflow: pipeline ? await getWorkflowStatus(repo) : null,
        pages: pipeline && pipeline.deploys ? await getPagesStatus(repo) : null,
    };
};

// Why the AI proposal was not used, for the note above the detected one.
const AI_FAILURE_REASONS = {
    LLM_TIMEOUT: 'tardó demasiado en responder',
    LLM_RATE_LIMIT: 'alcanzó su límite de uso; inténtalo en unos minutos',
    LLM_INVALID_OUTPUT: 'propuso algo que no coincide con el repositorio',
    LLM_ERROR: 'no está disponible en este momento',
};

/**
 * The AI's spec validated against the facts → {spec, explanation}, or {error: code} on any failure
 * (the caller then keeps the detected proposal). With a project switch the AI must keep that project.
 */
const aiProposal = async ({ repo, facts, detected, project }) => {
    try {
        const { spec, explanation } = await pipelineAi.proposeWithAi({ repo, facts, detected, options: options() });
        const validated = pipelineSpec.validateSpec(spec, facts);
        if (project && (validated.project.dir !== detected.project.dir || validated.project.stack !== detected.project.stack)) {
            return { error: 'LLM_INVALID_OUTPUT' };
        }
        return { spec: validated, explanation };
    } catch (err) {
        if (!isAppError(err)) console.error('[pipeline] AI proposal failed:', err.message);
        if (isAppError(err) && err.code === 'INVALID_PIPELINE') return { error: 'LLM_INVALID_OUTPUT' };
        return { error: isAppError(err) && AI_FAILURE_REASONS[err.code] ? err.code : 'LLM_ERROR' };
    }
};

/**
 * Proposal for the setup screen: detected from the repository (or the saved spec when it still
 * validates). `dir`/`stack` switch to another project of the repository. `ai: true` asks the AI
 * (the group must allow AI analysis); with `ai` omitted the AI proposes when the group allows it,
 * there is no saved spec and no project switch. Any AI failure falls back to the detected spec.
 */
const proposePipeline = async ({ gid, uid, dir, stack, ai }) => {
    const repo = await repoService.getConnectedRepo(gid);
    const aiAvailable = repo.aiAnalysisEnabled === true;
    if (ai === true && !aiAvailable) throw new AppError('AI_ANALYSIS_DISABLED', 'AI analysis is disabled for this group', 409);
    const facts = await collectFacts(repo);
    factsCache.set(factsKey(repo, uid), facts);

    const switching = dir !== undefined || stack !== undefined;
    let spec = null;
    let notes = [];
    let source = 'detected';
    let aiError = null;
    if (!switching && ai !== true) {
        const row = await cicdModel.getPipeline(repo.repoId);
        if (row && row.spec) {
            try {
                spec = pipelineSpec.validateSpec(row.spec, facts);
                source = 'saved';
            } catch {
                notes.push('El pipeline guardado ya no coincide con el repositorio; esta es una propuesta nueva.');
            }
        }
    }
    if (!spec) {
        const proposal = pipelineSpec.proposeSpec(facts, switching ? { dir, stack } : {});
        const detected = pipelineSpec.validateSpec(proposal.spec, facts);
        const useAi = ai === true || (ai === undefined && aiAvailable && !switching);
        const fromAi = useAi ? await aiProposal({ repo, facts, detected, project: switching }) : null;
        if (fromAi && fromAi.spec) {
            // The explanation replaces the detection notes (they describe the detected spec).
            spec = fromAi.spec;
            source = 'ai';
            notes = [...(fromAi.explanation ? [fromAi.explanation] : []), ...notes];
        } else {
            spec = detected;
            if (fromAi) {
                aiError = fromAi.error;
                notes.unshift(`No se pudo usar la IA (${AI_FAILURE_REASONS[aiError]}); esta es la propuesta de la detección automática.`);
            }
            notes = [...notes, ...proposal.notes];
        }
    }
    if (facts.truncated) notes.push('El repositorio es muy grande: solo se revisó parte de sus archivos.');
    return {
        source,
        notes,
        facts,
        options: options(),
        workflowExists: facts.workflowExists,
        ai: { available: aiAvailable, used: source === 'ai', error: aiError },
        ...rendered(spec),
    };
};

/** Validated spec rendered to YAML, for the live preview while the admin edits. */
const previewPipeline = async ({ gid, uid, spec }) => {
    const repo = await repoService.getConnectedRepo(gid);
    const facts = await cachedFacts(repo, uid);
    return rendered(pipelineSpec.validateSpec(spec, facts));
};

/**
 * Validates the spec against the repository as it is now, enables Pages if the pipeline deploys
 * (before the commit: that push already runs the deploy job), commits the workflow and saves it.
 */
const applyPipeline = async ({ gid, uid, username, spec }) => {
    const repo = await repoService.getConnectedRepo(gid);
    const facts = await collectFacts(repo);
    factsCache.set(factsKey(repo, uid), facts);
    const validated = pipelineSpec.validateSpec(spec, facts);
    const text = pipelineSpec.renderWorkflow(validated);

    const pages = validated.deploy ? await ensurePages(repo) : null;
    const commit = await commitWorkflow(repo, text, { username });
    await cicdModel.upsertPipeline({
        repoId: repo.repoId,
        workflowPath: pipelineSpec.WORKFLOW_PATH,
        spec: validated,
        commitSha: commit.sha,
        configuredBy: uid,
    });
    const row = await cicdModel.getPipeline(repo.repoId);
    return { pipeline: formatPipeline(row), commit, pages, ...rendered(validated) };
};

module.exports = {
    collectFacts,
    getPagesStatus,
    ensurePages,
    commitWorkflow,
    getPipeline,
    proposePipeline,
    previewPipeline,
    applyPipeline,
    factsCache,
};
