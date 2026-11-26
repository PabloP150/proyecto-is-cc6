const { verifyVercelSignature, signVercelPayload } = require('../../services/deploy/deploySignature');

const SECRET = 'vercel-whsec-test';
const body = Buffer.from(JSON.stringify({ type: 'deployment.succeeded', payload: {} }));

describe('verifyVercelSignature', () => {
    test('accepts a valid signature over the raw body', () => {
        expect(verifyVercelSignature(body, signVercelPayload(body, SECRET), SECRET)).toBe(true);
    });

    test('accepts an upper-case hex digest', () => {
        const sig = signVercelPayload(body, SECRET).toUpperCase();
        expect(verifyVercelSignature(body, sig, SECRET)).toBe(true);
    });

    test('rejects a tampered body', () => {
        const sig = signVercelPayload(body, SECRET);
        const tampered = Buffer.from(body.toString().replace('succeeded', 'error'));
        expect(verifyVercelSignature(tampered, sig, SECRET)).toBe(false);
    });

    test('rejects a signature made with another secret', () => {
        expect(verifyVercelSignature(body, signVercelPayload(body, 'other'), SECRET)).toBe(false);
    });

    test('rejects a missing or malformed header', () => {
        expect(verifyVercelSignature(body, undefined, SECRET)).toBe(false);
        expect(verifyVercelSignature(body, '', SECRET)).toBe(false);
        expect(verifyVercelSignature(body, 'sha1=' + signVercelPayload(body, SECRET), SECRET)).toBe(false);
        expect(verifyVercelSignature(body, 'zz'.repeat(20), SECRET)).toBe(false);
    });

    test('rejects when no secret is configured', () => {
        expect(verifyVercelSignature(body, signVercelPayload(body, SECRET), undefined)).toBe(false);
        expect(verifyVercelSignature(body, signVercelPayload(body, SECRET), '')).toBe(false);
    });

    test('rejects a non-Buffer body', () => {
        // express.json() would hand us an object; the HMAC must see the original bytes.
        expect(verifyVercelSignature(body.toString(), signVercelPayload(body, SECRET), SECRET)).toBe(false);
    });

    test('a GitHub-style sha256 signature never passes', () => {
        const crypto = require('crypto');
        const sha256 = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
        expect(verifyVercelSignature(body, sha256, SECRET)).toBe(false);
    });
});
