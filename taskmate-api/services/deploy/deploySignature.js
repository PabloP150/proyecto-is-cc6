const crypto = require('crypto');

// Vercel signs webhooks with SHA-1 HMAC in `x-vercel-signature`, as bare hex with no
// algorithm prefix -- unlike GitHub's `sha256=...` in X-Hub-Signature-256. Same shape of
// check as services/github/webhookSignature.js, different algorithm and header format.
const VERCEL_SIGNATURE_RE = /^([0-9a-f]{40})$/i;

// Never throws: a missing secret, a missing/malformed header or a mismatch all return false.
// Verified over the exact bytes received, so the route must use express.raw.
const verifyVercelSignature = (rawBody, signatureHeader, secret = process.env.VERCEL_WEBHOOK_SECRET) => {
    if (!secret || typeof secret !== 'string') return false;
    if (!Buffer.isBuffer(rawBody)) return false;
    if (typeof signatureHeader !== 'string') return false;

    const match = signatureHeader.trim().match(VERCEL_SIGNATURE_RE);
    if (!match) return false;

    const expected = crypto.createHmac('sha1', secret).update(rawBody).digest();
    const received = Buffer.from(match[1], 'hex');
    // timingSafeEqual throws on differing lengths; the regex already fixes both at 20 bytes,
    // the explicit check keeps that guarantee if the regex ever changes.
    if (received.length !== expected.length) return false;
    return crypto.timingSafeEqual(received, expected);
};

// Test helper, and useful for verifying a local webhook by hand.
const signVercelPayload = (rawBody, secret) =>
    crypto.createHmac('sha1', secret).update(rawBody).digest('hex');

module.exports = { verifyVercelSignature, signVercelPayload };
