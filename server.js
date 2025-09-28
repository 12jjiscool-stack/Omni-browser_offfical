// server.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { URL } = require('url');
const dns = require('dns').promises;
const net = require('net');
const app = express();

const PORT = process.env.PORT || 3000;
const BASIC_USER = process.env.BASIC_USER || '';
const BASIC_PASS = process.env.BASIC_PASS || '';
const ALLOWLIST = (process.env.ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean); // optional

// Simple rate limiter (tweak for your needs)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet());
app.use(limiter);

// Basic auth middleware (optional). If BASIC_USER/BASIC_PASS are empty, skip auth.
function maybeAuth(req, res, next) {
  if (!BASIC_USER || !BASIC_PASS) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Proxy"');
    return res.status(401).send('Authentication required');
  }
  const payload = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = payload.split(':');
  if (user === BASIC_USER && pass === BASIC_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="Proxy"');
  return res.status(401).send('Invalid credentials');
}

// helper: block internal IP ranges (RFC1918 + localhost, link-local)
function isPrivateIP(ip) {
  if (!ip) return true;
  // IPv6 hostname mapped to IPv4
  if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    const [a,b] = parts;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // link-local 169.254.0.0/16
    if (a === 169 && b === 254) return true;
  }
  // simple IPv6 checks
  if (ip === '::1' || ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

// resolve hostname -> ip and block private ranges
async function resolveAndCheck(hostname) {
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const a of addresses) {
      if (isPrivateIP(a.address)) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// proxy endpoint
app.get('/proxy', maybeAuth, async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).send('Missing url parameter');

  let target;
  try {
    target = new URL(raw);
    if (!['http:', 'https:'].includes(target.protocol)) return res.status(400).send('Invalid protocol');
  } catch (e) {
    return res.status(400).send('Invalid URL');
  }

  // Optional allowlist check
  if (ALLOWLIST.length && !ALLOWLIST.includes(target.hostname)) {
    return res.status(403).send('Host not allowed by server allowlist');
  }

  // Block private/internal hosts
  const ok = await resolveAndCheck(target.hostname);
  if (!ok) return res.status(403).send('Access to private/internal IPs is blocked');

  // fetch the target
  try {
    const upstreamRes = await fetch(target.href, {
      headers: {
        // pass through user-agent/cookie if desired; be careful with security
        'user-agent': req.get('user-agent') || 'OmniProxy/1.0',
        // do not forward original cookies by default (privacy)
      },
      redirect: 'follow',
      timeout: 20000,
    });

    // copy status and headers (but sanitize some)
    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((value, name) => {
      // don't forward hop-by-hop or security headers that break embedding
      const banned = ['content-security-policy', 'content-security-policy-report-only',
                      'x-frame-options', 'set-cookie', 'set-cookie2', 'strict-transport-security'];
      if (banned.includes(name.toLowerCase())) return;
      // adjust content-length handled by stream
      res.set(name, value);
    });

    const contentType = upstreamRes.headers.get('content-type') || '';

    // If HTML, we do a lightweight transformation:
    if (contentType.includes('text/html')) {
      const text = await upstreamRes.text();

      // Inject a <base> tag to make relative links load through our proxy.
      // Also rewrite occurrences of src/href that start with '/' or relative to go through /proxy?url=
      // Basic approach — not perfect for all sites (complex JS or CSP).
      const baseTag = `<base href="${target.origin}">`;
      let modified = text.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);

      // Simple rewrite: replace href="/..." and src="/..." with absolute using origin (keeps browser loading those resources directly).
      // To route those through proxy you'd need a robust HTML/JS rewriter (not done here for simplicity).
      // NOTE: we keep resources loading directly from origin to reduce complexity.
      // Send modified HTML
      res.set('content-type', 'text/html; charset=utf-8');
      return res.send(modified);
    }

    // For non-HTML, stream the body directly
    upstreamRes.body.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(502).send('Bad gateway');
  }
});

// A simple health endpoint
app.get('/_health', (req, res) => res.send('ok'));

// Serve a helper static UI if you want (optional)
// app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`Proxy server listening on http://localhost:${PORT}`);
});
