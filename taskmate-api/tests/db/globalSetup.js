// Brings the test database to the latest schema once per run (base tables + migrations).
module.exports = async () => {
    require('./setupEnv');
    const runner = require('../../migrations/runner');
    await runner.ensureBaseSchema();
    await runner.up();
};
