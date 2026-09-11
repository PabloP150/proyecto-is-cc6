#!/usr/bin/env node
// Node migration runner (tests and `npm run db:migrate`). Same files and bookkeeping as
// run-migrations.sh: every NNN_name.sql runs in one transaction together with its
// dbo.SchemaMigrations row, so a failed migration leaves nothing behind.
const fs = require('fs');
const path = require('path');
const { Request } = require('tedious');

const MIGRATIONS_DIR = __dirname;
const BASE_SCHEMA_FILE = path.resolve(__dirname, '..', 'taskmate_tables.sql');
const MIGRATION_FILE = /^(\d{3})_([A-Za-z0-9_-]+)\.sql$/;

const splitBatches = (sql) => sql
    .split(/^\s*GO\s*$/im)
    .map(batch => batch.trim())
    .filter(Boolean);

const listMigrations = (dir = MIGRATIONS_DIR) => fs.readdirSync(dir)
    .filter(file => MIGRATION_FILE.test(file) && !file.endsWith('.down.sql'))
    .map(file => {
        const [, version, name] = MIGRATION_FILE.exec(file);
        const downFile = path.join(dir, `${version}_${name}.down.sql`);
        return {
            version: Number(version),
            name,
            file: path.join(dir, file),
            downFile: fs.existsSync(downFile) ? downFile : null,
        };
    })
    .sort((a, b) => a.version - b.version);

const batch = (conn, sql) => new Promise((resolve, reject) => {
    const rows = [];
    const request = new Request(sql, err => (err ? reject(err) : resolve(rows)));
    request.on('row', columns => {
        const row = {};
        columns.forEach(col => { row[col.metadata.colName] = col.value; });
        rows.push(row);
    });
    conn.execSqlBatch(request);
});

// Migrations need DDL rights the app login does not have: MIGRATION_DB_USERNAME/PASSWORD
// (e.g. SA) when set, otherwise the DB_* app credentials.
const migrationCredentials = () => (process.env.MIGRATION_DB_USERNAME
    ? { userName: process.env.MIGRATION_DB_USERNAME, password: process.env.MIGRATION_DB_PASSWORD }
    : undefined);

const openConnection = () => require('../helpers/pool').connect(migrationCredentials());

async function withConnection(fn, { log = () => {} } = {}) {
    const conn = await openConnection();
    const onInfo = (info) => log(info.message);
    conn.on('infoMessage', onInfo);
    try {
        return await fn(conn);
    } finally {
        conn.removeListener('infoMessage', onInfo);
        conn.close();
    }
}

const ENSURE_TABLE_SQL = splitBatches(fs.readFileSync(path.join(MIGRATIONS_DIR, '_schema_migrations.sql'), 'utf8'))[0];

const appliedVersions = async (conn) => {
    await batch(conn, ENSURE_TABLE_SQL);
    const rows = await batch(conn, 'SELECT version FROM dbo.SchemaMigrations ORDER BY version');
    return rows.map(r => r.version);
};

// Runs the batches of `file` plus `bookkeeping` inside one transaction.
async function runFileInTransaction(conn, file, bookkeeping) {
    const batches = splitBatches(fs.readFileSync(file, 'utf8'));
    await batch(conn, 'SET XACT_ABORT ON; BEGIN TRANSACTION;');
    try {
        for (let i = 0; i < batches.length; i++) {
            try {
                await batch(conn, batches[i]);
            } catch (err) {
                err.message = `${path.basename(file)} (batch ${i + 1}): ${err.message}`;
                throw err;
            }
        }
        await batch(conn, bookkeeping);
        await batch(conn, 'COMMIT TRANSACTION;');
    } catch (err) {
        await batch(conn, 'IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;').catch(() => {});
        throw err;
    }
}

const versionLiteral = (version) => {
    if (!Number.isInteger(version) || version < 0) throw new Error(`Invalid migration version ${version}`);
    return String(version);
};

const nameLiteral = (name) => `N'${String(name).replace(/'/g, "''")}'`;

async function up({ to = Infinity, dir = MIGRATIONS_DIR, log } = {}) {
    return withConnection(async (conn) => {
        const applied = new Set(await appliedVersions(conn));
        const done = [];
        for (const m of listMigrations(dir)) {
            if (m.version > to || applied.has(m.version)) continue;
            await runFileInTransaction(conn, m.file,
                `INSERT INTO dbo.SchemaMigrations (version, name) VALUES (${versionLiteral(m.version)}, ${nameLiteral(m.name)});`);
            done.push(m.version);
        }
        return done;
    }, { log });
}

// Reverts the last `steps` applied migrations, or every migration above `to` when given.
async function down({ steps = 1, to, dir = MIGRATIONS_DIR, log } = {}) {
    return withConnection(async (conn) => {
        const byVersion = new Map(listMigrations(dir).map(m => [m.version, m]));
        const applied = (await appliedVersions(conn)).sort((a, b) => b - a);
        const targets = to === undefined ? applied.slice(0, steps) : applied.filter(v => v > to);
        const done = [];
        for (const version of targets) {
            const m = byVersion.get(version);
            if (!m || !m.downFile) throw new Error(`No down migration for version ${version}`);
            await runFileInTransaction(conn, m.downFile,
                `DELETE FROM dbo.SchemaMigrations WHERE version = ${versionLiteral(version)};`);
            done.push(version);
        }
        return done;
    }, { log });
}

// Re-runs an applied migration file (all of them are idempotent), e.g. after fixing the data
// that made 001 skip a constraint. The SchemaMigrations row is left as it is.
async function reapply({ version, dir = MIGRATIONS_DIR, log } = {}) {
    const m = listMigrations(dir).find(item => item.version === version);
    if (!m) throw new Error(`No migration with version ${version}`);
    return withConnection(async (conn) => {
        await runFileInTransaction(conn, m.file, 'SELECT 1 AS reapplied;');
        return version;
    }, { log });
}

async function status({ dir = MIGRATIONS_DIR } = {}) {
    return withConnection(async (conn) => {
        const applied = new Set(await appliedVersions(conn));
        return listMigrations(dir).map(m => ({ version: m.version, name: m.name, applied: applied.has(m.version) }));
    });
}

// Creates the base tables (taskmate_tables.sql) when the database is empty.
async function ensureBaseSchema({ log } = {}) {
    return withConnection(async (conn) => {
        const rows = await batch(conn, "SELECT CASE WHEN OBJECT_ID(N'dbo.Users', N'U') IS NULL THEN 0 ELSE 1 END AS present");
        if (rows[0].present) return false;
        for (const sql of splitBatches(fs.readFileSync(BASE_SCHEMA_FILE, 'utf8'))) {
            await batch(conn, sql);
        }
        return true;
    }, { log });
}

// Runs one batch with the migration credentials (tests use it for DDL the app login cannot run).
const execAdmin = (sql) => withConnection(conn => batch(conn, sql));

module.exports = { up, down, reapply, status, ensureBaseSchema, execAdmin, splitBatches, listMigrations };

if (require.main === module) {
    const [command = 'up', ...rest] = process.argv.slice(2);
    const flag = (name) => {
        const i = rest.indexOf(name);
        return i === -1 ? undefined : rest[i + 1];
    };
    const log = (message) => console.log(`  ${message}`);
    (async () => {
        if (rest.includes('--with-base') && await ensureBaseSchema({ log })) console.log('Base schema created');
        if (command === 'up') {
            const to = flag('--to') !== undefined ? Number(flag('--to')) : undefined;
            const done = await up({ to, log });
            console.log(done.length ? `Applied: ${done.join(', ')}` : 'Nothing to apply');
        } else if (command === 'down') {
            const to = flag('--to') !== undefined ? Number(flag('--to')) : undefined;
            const steps = flag('--steps') !== undefined ? Number(flag('--steps')) : 1;
            const done = await down({ steps, to, log });
            console.log(done.length ? `Reverted: ${done.join(', ')}` : 'Nothing to revert');
        } else if (command === 'reapply') {
            const version = Number(rest[0]);
            await reapply({ version, log });
            console.log(`Re-ran ${version}`);
        } else if (command === 'status') {
            (await status()).forEach(m => console.log(`${m.applied ? '[x]' : '[ ]'} ${String(m.version).padStart(3, '0')}_${m.name}`));
        } else {
            throw new Error(`Unknown command "${command}" (use up | down | reapply | status)`);
        }
    })().catch(err => {
        console.error(`Migration failed: ${err.message}`);
        process.exit(1);
    });
}
