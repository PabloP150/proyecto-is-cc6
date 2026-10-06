const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '..');

const sourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.(js|jsx)$/.test(entry.name) ? [full] : [];
  });

describe('static guards', () => {
  const files = sourceFiles(SRC).map((file) => ({ file: path.relative(SRC, file), text: fs.readFileSync(file, 'utf8') }));

  // Routes removed from the API: POST /api/completados, POST /api/delete, DELETE /api/tasks/:id,
  // GET /api/usertask/getutid (task delete/complete are atomic endpoints now).
  it.each([
    ['POST /api/completados', /api\.post\(\s*['"`]\/api\/completados/],
    ['POST /api/delete', /api\.post\(\s*['"`]\/api\/delete/],
    ['DELETE /api/tasks/:id', /api\.del\(\s*`\/api\/tasks\/\$\{/],
    ['GET /api/usertask/getutid', /getutid/],
    ['POST /api/analytics/batch-update', /analytics\/batch-update/],
  ])('no source file calls the removed route %s', (_route, pattern) => {
    const offenders = files.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('caps milestone names in both node editors', () => {
    ['components/flow/Flow.jsx', 'components/BlockDiagram.jsx'].forEach((file) => {
      expect(fs.readFileSync(path.join(SRC, file), 'utf8')).toContain('maxLength={LIMITS.nodeName}');
    });
  });

  it('never enables rehype-raw for repository content', () => {
    const github = files.filter(({ file }) => file.startsWith(`components${path.sep}github`));
    expect(github.length).toBeGreaterThan(0);
    expect(github.filter(({ text }) => /from\s+['"]rehype-raw['"]/.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it('builds without source maps and keeps .env.production free of secrets', () => {
    const env = fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8');
    expect(env).toMatch(/^GENERATE_SOURCEMAP=false$/m);
    const keys = env.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => line.split('=')[0]);
    expect(keys.filter((key) => /SECRET|TOKEN|PASSWORD|KEY/i.test(key))).toEqual([]);
  });
});
