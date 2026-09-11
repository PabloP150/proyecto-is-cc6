// Each test file gets its own module registry, hence its own pool: close it so Jest can exit.
afterAll(async () => {
    await require('../../helpers/pool').end();
});
