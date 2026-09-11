// DB integration tests (tests/db/*.dbtest.js) against a DISPOSABLE SQL Server. They run
// migrations up and down and write data, so the connection comes only from TEST_DB_* vars
// (never from DB_*/.env): TEST_DB_SERVER, TEST_DB_PORT, TEST_DB_NAME, TEST_DB_USERNAME,
// TEST_DB_PASSWORD — or TEST_DB_ENV_FILE pointing at a file that defines them.
// Run with: npm run test:db
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/db/**/*.dbtest.js'],
    globalSetup: './tests/db/globalSetup.js',
    setupFiles: ['./tests/db/setupEnv.js'],
    setupFilesAfterEnv: ['./tests/db/afterEnv.js'],
    testTimeout: 60000,
    verbose: true,
};
