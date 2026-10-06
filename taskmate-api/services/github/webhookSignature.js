const crypto = require('crypto');

const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/i;

// Verifies GitHub's X-Hub-Signature-256 over the exact bytes received. Never throws:
// a missing secret, a missing/malformed header or a mismatch all return false.
const verifyWebhookSignature = (rawBody, signatureHeader, secret = process.env.GITHUB_WEBHOOK_SECRET) => {
    if (!secret || typeof secret !== 'string') return false;
    if (!Buffer.isBuffer(rawBody)) return false;
    if (typeof signatureHeader !== 'string') return false;

    const match = signatureHeader.trim().match(SIGNATURE_RE);
    if (!match) return false;

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
    const received = Buffer.from(match[1], 'hex');
    // timingSafeEqual throws on different lengths; the regex already fixes it at 32 bytes,
    // the explicit check keeps that guarantee if the regex ever changes.
    if (received.length !== expected.length) return false;
    return crypto.timingSafeEqual(received, expected);
};

const signWebhookPayload = (rawBody, secret) =>
    `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

module.exports = { verifyWebhookSignature, signWebhookPayload };
