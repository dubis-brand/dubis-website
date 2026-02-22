// DUBIS — Simple In-Memory Rate Limiter
// =========================================
// Per-IP request throttling for serverless API routes.
//
// ⚠️  Each Vercel serverless instance has its own isolated process, so this
//     store resets on cold starts and is NOT shared across instances.
//     For a small store this is fine — it stops naive/accidental abuse.
//     If you ever need distributed rate limiting, swap to Upstash + Redis.
//
// Usage:
//   const rateLimit = require('../_rateLimit');
//   // at top of handler, before business logic:
//   if (rateLimit(req, res)) return;                     // default: 10/min
//   if (rateLimit(req, res, { max: 5, windowMs: 60_000 })) return;  // custom

const store = new Map(); // ip → { count, windowStart }

/**
 * @param {object}  req
 * @param {object}  res
 * @param {object}  [opts]
 * @param {number}  [opts.max=10]           – max requests per window
 * @param {number}  [opts.windowMs=60_000]  – sliding window in milliseconds
 * @returns {boolean} true = rate-limited (caller must return immediately)
 */
module.exports = function rateLimit(req, res, { max = 10, windowMs = 60_000 } = {}) {
    // Prefer the real client IP sent by Vercel's edge proxy
    const ip =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        'unknown';

    const now    = Date.now();
    let   record = store.get(ip);

    if (!record || now - record.windowStart >= windowMs) {
        record = { count: 1, windowStart: now };
    } else {
        record.count += 1;
    }
    store.set(ip, record);

    const remaining   = Math.max(0, max - record.count);
    const resetEpoch  = Math.ceil((record.windowStart + windowMs) / 1000);

    res.setHeader('X-RateLimit-Limit',     String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset',     String(resetEpoch));

    if (record.count > max) {
        const retryAfter = Math.ceil((record.windowStart + windowMs - now) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
        return true;
    }

    return false;
};
