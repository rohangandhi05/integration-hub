/**
 * API key authentication and rate limiting middleware.
 */
const rateLimit = require('express-rate-limit');

// Load valid API keys from environment (comma-separated)
function getValidKeys() {
  const raw = process.env.API_KEYS || 'dev-key-1234';
  return new Set(raw.split(',').map(k => k.trim()).filter(Boolean));
}

/**
 * Express middleware: checks x-api-key header.
 * Passes if valid, returns 401 otherwise.
 */
function apiKeyAuth(req, res, next) {
  // Allow health checks without auth
  if (req.path === '/health' || req.path === '/graphql-playground') {
    return next();
  }

  const key = req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({
      error: 'Missing API key',
      hint: 'Provide your key in the x-api-key header',
    });
  }

  const validKeys = getValidKeys();
  if (!validKeys.has(key)) {
    return res.status(403).json({
      error: 'Invalid API key',
      code: 'FORBIDDEN',
    });
  }

  // Attach key identity to request for logging
  req.apiKey = key;
  next();
}

/**
 * Rate limiter: 100 requests per minute per IP.
 */
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: '60 seconds' },
});

/**
 * Stricter limiter for write operations.
 */
const writeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many write requests', retryAfter: '60 seconds' },
});

module.exports = { apiKeyAuth, rateLimiter, writeRateLimiter };
