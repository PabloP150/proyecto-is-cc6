const { ids, registerMocks, applyDefaults, tokenFor, bearer } = require('./support/mocks');

registerMocks();

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../../app');
const tokens = require('../../helpers/tokens');
const { AppError } = require('../../helpers/errors');

const SECRET = process.env.JWT_SECRET;
const PROTECTED = `/api/tasks?gid=${ids.GROUP_A}`;

describe('requireAuth', () => {
    let m;
    beforeEach(() => { m = applyDefaults(); });

    test('401 UNAUTHENTICATED without a token', async () => {
        const res = await request(app).get(PROTECTED);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ success: false, error: expect.any(String), code: 'UNAUTHENTICATED' });
    });

    test.each([
        ['garbage', 'Bearer not-a-jwt'],
        ['wrong secret', `Bearer ${jwt.sign({ userId: ids.ALICE }, 'other-secret')}`],
        ['expired', `Bearer ${jwt.sign({ userId: ids.ALICE, typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET)}`],
        ['HS512 instead of HS256', `Bearer ${jwt.sign({ userId: ids.ALICE, typ: 'access' }, SECRET, { algorithm: 'HS512' })}`],
        ['unsigned (alg none)', `Bearer ${jwt.sign({ userId: ids.ALICE, typ: 'access' }, null, { algorithm: 'none' })}`],
        ['no userId', `Bearer ${jwt.sign({ username: 'x', typ: 'access' }, SECRET)}`],
        ['basic scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
    ])('401 for an invalid token (%s)', async (_label, header) => {
        const res = await request(app).get(PROTECTED).set('Authorization', header);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHENTICATED');
        expect(m.tasks.getTasksByGroupId).not.toHaveBeenCalled();
    });

    test('purpose token (typ gh_install_state) is rejected as Bearer', async () => {
        const purpose = tokens.signPurposeToken('gh_install_state', { userId: ids.ALICE, gid: ids.GROUP_A, nonce: 'n' });
        const res = await request(app).get(PROTECTED).set('Authorization', `Bearer ${purpose}`);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    test('tokens with a foreign typ or an audience are rejected', async () => {
        const foreign = jwt.sign({ userId: ids.ALICE, typ: 'refresh' }, SECRET);
        const withAud = jwt.sign({ userId: ids.ALICE }, SECRET, { audience: 'taskmate' });
        for (const token of [foreign, withAud]) {
            const res = await request(app).get(PROTECTED).set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(401);
        }
    });

    test('legacy tokens without typ and tokens without exp are rejected', async () => {
        const legacy = jwt.sign({ userId: ids.ALICE, username: 'alice' }, SECRET, { expiresIn: '24h' });
        const forever = jwt.sign({ userId: ids.ALICE, username: 'alice', typ: 'access' }, SECRET);
        for (const token of [legacy, forever]) {
            const res = await request(app).get(PROTECTED).set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(401);
        }
    });

    test('access token works and scheme is case-insensitive', async () => {
        const res = await request(app).get(PROTECTED).set('Authorization', `bearer ${tokenFor(ids.ALICE)}`);
        expect(res.status).toBe(200);
        expect(res.body.data[0].datetime).toBe('2026-09-11T10:00');
    });
});

describe('helpers/tokens', () => {
    test('access tokens are HS256 with typ access and 24h expiry', () => {
        const token = tokens.signAccessToken({ userId: ids.ALICE, username: 'alice' });
        const { header, payload } = jwt.decode(token, { complete: true });
        expect(header.alg).toBe('HS256');
        expect(payload).toMatchObject({ userId: ids.ALICE, username: 'alice', typ: 'access' });
        expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
        expect(tokens.verifyAccessToken(token)).toEqual({ userId: ids.ALICE, username: 'alice' });
    });

    test('purpose tokens round-trip only for their own purpose', () => {
        const token = tokens.signPurposeToken('gh_install_state', { gid: ids.GROUP_A }, '5m');
        expect(jwt.decode(token)).toMatchObject({ typ: 'gh_install_state', aud: 'taskmate', gid: ids.GROUP_A });
        expect(tokens.verifyPurposeToken('gh_install_state', token)).toMatchObject({ gid: ids.GROUP_A });
        expect(() => tokens.verifyPurposeToken('other_purpose', token)).toThrow(expect.objectContaining({ code: 'INVALID_STATE', status: 403 }));
        expect(() => tokens.verifyAccessToken(token)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    });

    test('an access token is not accepted as a purpose token', () => {
        const access = tokens.signAccessToken({ userId: ids.ALICE, username: 'alice' });
        expect(() => tokens.verifyPurposeToken('access', access)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
        expect(() => tokens.verifyPurposeToken('gh_install_state', access)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
        expect(() => tokens.signPurposeToken('access', {})).toThrow();
    });
});

describe('POST /api/users/login and register (public)', () => {
    let m;
    beforeEach(() => { m = applyDefaults(); });

    test('login returns {message, uid, token} with a usable access token', async () => {
        const hash = await bcrypt.hash('secret123', 4);
        m.user.getUserByUsername.mockResolvedValue([{ uid: ids.BOB, username: 'bob', password: hash }]);

        const res = await request(app).post('/api/users/login').send({ username: 'bob', password: 'secret123' });
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(['message', 'token', 'uid']);
        expect(res.body.uid).toBe(ids.BOB);
        expect(jwt.decode(res.body.token)).toMatchObject({ userId: ids.BOB, typ: 'access' });

        const tasks = await request(app).get(PROTECTED).set('Authorization', `Bearer ${res.body.token}`);
        expect(tasks.status).toBe(200);
    });

    test('wrong password and unknown user both answer 401 with a code', async () => {
        const hash = await bcrypt.hash('secret123', 4);
        m.user.getUserByUsername.mockResolvedValueOnce([{ uid: ids.BOB, username: 'bob', password: hash }]);
        const wrong = await request(app).post('/api/users/login').send({ username: 'bob', password: 'nope' });
        expect(wrong.status).toBe(401);
        expect(wrong.body).toMatchObject({ error: 'Invalid credentials', code: 'UNAUTHENTICATED' });

        const unknown = await request(app).post('/api/users/login').send({ username: 'ghost', password: 'whatever' });
        expect(unknown.status).toBe(401);
    });

    test('register validates input and does not leak DB errors', async () => {
        const short = await request(app).post('/api/users').send({ username: 'new', password: '123' });
        expect(short.status).toBe(400);
        expect(short.body.code).toBe('VALIDATION_ERROR');

        m.user.registerUserWithPersonalGroup.mockRejectedValueOnce(new Error('Cannot insert NULL into column password, table dbo.Users'));
        const failed = await request(app).post('/api/users').send({ username: 'new', password: 'secret123' });
        expect(failed.status).toBe(500);
        expect(JSON.stringify(failed.body)).not.toMatch(/NULL|column|table/);
        expect(failed.body.code).toBe('INTERNAL_ERROR');
    });

    test('model AppErrors pass through (duplicate username 400, DB_BUSY 503)', async () => {
        m.user.registerUserWithPersonalGroup.mockRejectedValueOnce(new AppError('VALIDATION_ERROR', 'Username already exists', 400));
        const dup = await request(app).post('/api/users').send({ username: 'taken', password: 'secret123' });
        expect(dup.status).toBe(400);
        expect(dup.body).toEqual({ success: false, error: 'Username already exists', code: 'VALIDATION_ERROR' });

        m.user.registerUserWithPersonalGroup.mockRejectedValueOnce(new AppError('DB_BUSY', 'The database is busy, please try again', 503));
        const busy = await request(app).post('/api/users').send({ username: 'other', password: 'secret123' });
        expect(busy.status).toBe(503);
        expect(busy.body.code).toBe('DB_BUSY');
    });

    test('register creates user + personal group atomically and keeps the response shape', async () => {
        const res = await request(app).post('/api/users').send({ username: 'newuser', password: 'secret123' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: 'User and group and userGroup created successfully',
            data: { uid: expect.any(String), gid: expect.any(String) },
        });
        const [args] = m.user.registerUserWithPersonalGroup.mock.calls[0];
        expect(args).toMatchObject({ uid: res.body.data.uid, gid: res.body.data.gid, username: 'newuser', groupName: "newuser's Group" });
        expect(await bcrypt.compare('secret123', args.passwordHash)).toBe(true);
        expect(m.user.addUser).not.toHaveBeenCalled();
    });

    test('GET /api/users/getuid requires auth', async () => {
        m.user.getidUserByUsername.mockResolvedValue({ uid: ids.BOB });
        expect((await request(app).get('/api/users/getuid?username=bob')).status).toBe(401);
        const res = await request(app).get('/api/users/getuid?username=bob').set(bearer(ids.ALICE));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ uid: ids.BOB });
    });
});
