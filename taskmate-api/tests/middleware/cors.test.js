const { isAllowedOrigin } = require('../../middleware/cors');

describe('isAllowedOrigin', () => {
    const env = { ...process.env };
    afterEach(() => { process.env = { ...env }; });

    test('FRONTEND_URL origins only, by default', () => {
        process.env.FRONTEND_URL = 'http://localhost:3000';
        delete process.env.ALLOW_LAN_ORIGINS;
        expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
        expect(isAllowedOrigin('http://192.168.1.20:3000')).toBe(false);
        expect(isAllowedOrigin(undefined)).toBe(true);
    });

    test('ALLOW_LAN_ORIGINS=true also accepts private network addresses', () => {
        process.env.FRONTEND_URL = 'http://localhost:3000';
        process.env.ALLOW_LAN_ORIGINS = 'true';
        for (const origin of ['http://192.168.1.235:3000', 'http://172.20.10.9:3000', 'http://10.0.0.5:3000', 'http://172.31.0.1']) {
            expect(isAllowedOrigin(origin)).toBe(true);
        }
        for (const origin of ['http://172.32.0.1:3000', 'http://8.8.8.8:3000', 'https://192.168.1.2.evil.example', 'http://evil.example', 'http://192.168.1.2:3000/x']) {
            expect(isAllowedOrigin(origin)).toBe(false);
        }
    });
});
