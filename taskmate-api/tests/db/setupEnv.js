// Points helpers/pool.js at the disposable test database. Must run before pool.js is required:
// dotenv never overrides variables that are already set, so these win over any .env file.
const fs = require('fs');

function loadEnvFile(file) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    });
}

function mapTestDbEnv() {
    if (process.env.TEST_DB_ENV_FILE) loadEnvFile(process.env.TEST_DB_ENV_FILE);
    const required = ['TEST_DB_SERVER', 'TEST_DB_NAME', 'TEST_DB_USERNAME', 'TEST_DB_PASSWORD'];
    const missing = required.filter(name => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`DB tests need a disposable database: set ${missing.join(', ')} (or TEST_DB_ENV_FILE)`);
    }
    process.env.DB_SERVER = process.env.TEST_DB_SERVER;
    process.env.DB_NAME = process.env.TEST_DB_NAME;
    process.env.DB_USERNAME = process.env.TEST_DB_USERNAME;
    process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD;
    if (process.env.TEST_DB_PORT) process.env.DB_PORT = process.env.TEST_DB_PORT;
    else delete process.env.DB_PORT;
    delete process.env.DB_INSTANCE;
    process.env.ANALYTICS_ENABLED = 'true';
}

mapTestDbEnv();

module.exports = { mapTestDbEnv };
