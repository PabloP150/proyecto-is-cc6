const { ids, registerMocks, applyDefaults, bearer } = require('./support/mocks');

registerMocks();

// Limits are read when middleware/rateLimit.js loads; each Jest file has its own module registry.
process.env.API_RATE_LIMIT_MAX = '5';

const request = require('supertest');
const app = require('../../app');

beforeEach(() => { applyDefaults(); });

test('login is limited to 10 attempts per 15 minutes per IP → 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 10; i++) {
        const res = await request(app).post('/api/users/login').send({ username: 'ghost', password: 'wrong-password' });
        expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/users/login').send({ username: 'ghost', password: 'wrong-password' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(blocked.headers['retry-after']).toBeDefined();

    // Registration shares the same counter
    const register = await request(app).post('/api/users').send({ username: 'someone', password: 'secret123' });
    expect(register.status).toBe(429);
});

test('the API limiter is keyed by user, not by IP', async () => {
    const path = `/api/tasks?gid=${ids.GROUP_A}`;
    for (let i = 0; i < 5; i++) {
        expect((await request(app).get(path).set(bearer(ids.ALICE))).status).toBe(200);
    }
    const blocked = await request(app).get(path).set(bearer(ids.ALICE));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');

    // Same IP, different user: still allowed
    expect((await request(app).get(path).set(bearer(ids.BOB))).status).toBe(200);
});
