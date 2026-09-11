const { verifyWebhookSignature, signWebhookPayload } = require('../../services/github/webhookSignature');

const SECRET = 'whsec-test';
const body = Buffer.from(JSON.stringify({ action: 'opened', number: 1 }));

describe('verifyWebhookSignature', () => {
    test('accepts a valid signature over the raw body', () => {
        expect(verifyWebhookSignature(body, signWebhookPayload(body, SECRET), SECRET)).toBe(true);
    });

    test('accepts an upper-case hex digest', () => {
        const sig = signWebhookPayload(body, SECRET).replace(/[a-f]/g, (c) => c.toUpperCase()).replace('SHA256', 'sha256');
        expect(verifyWebhookSignature(body, sig, SECRET)).toBe(true);
    });

    test('rejects a tampered body', () => {
        const sig = signWebhookPayload(body, SECRET);
        const tampered = Buffer.from(body.toString().replace('opened', 'closed'));
        expect(verifyWebhookSignature(tampered, sig, SECRET)).toBe(false);
    });

    test('rejects a signature made with another secret', () => {
        expect(verifyWebhookSignature(body, signWebhookPayload(body, 'other'), SECRET)).toBe(false);
    });

    test('rejects a missing header', () => {
        expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
        expect(verifyWebhookSignature(body, '', SECRET)).toBe(false);
    });

    test('rejects a digest of the wrong length without throwing', () => {
        const short = signWebhookPayload(body, SECRET).slice(0, -2);
        const long = `${signWebhookPayload(body, SECRET)}00`;
        expect(verifyWebhookSignature(body, short, SECRET)).toBe(false);
        expect(verifyWebhookSignature(body, long, SECRET)).toBe(false);
    });

    test('rejects the legacy sha1 header format', () => {
        expect(verifyWebhookSignature(body, 'sha1=0123456789abcdef0123456789abcdef01234567', SECRET)).toBe(false);
    });

    test('rejects everything when the secret is not configured', () => {
        const sig = signWebhookPayload(body, SECRET);
        expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
        expect(verifyWebhookSignature(body, sig, '')).toBe(false);
    });

    test('rejects a parsed (non-Buffer) body', () => {
        const sig = signWebhookPayload(body, SECRET);
        expect(verifyWebhookSignature(JSON.parse(body.toString()), sig, SECRET)).toBe(false);
    });

    test('reads GITHUB_WEBHOOK_SECRET by default', () => {
        const previous = process.env.GITHUB_WEBHOOK_SECRET;
        process.env.GITHUB_WEBHOOK_SECRET = SECRET;
        try {
            expect(verifyWebhookSignature(body, signWebhookPayload(body, SECRET))).toBe(true);
            delete process.env.GITHUB_WEBHOOK_SECRET;
            expect(verifyWebhookSignature(body, signWebhookPayload(body, SECRET))).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
            else process.env.GITHUB_WEBHOOK_SECRET = previous;
        }
    });
});
