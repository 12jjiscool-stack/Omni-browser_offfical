/**
 * Sleek Proxy Browser - simple educational proxy
 *
 * - Fetches URLs from `GET /proxy?url=ENCODED_URL`
 * - Streams non-HTML (images, css, js) directly
 * - Rewrites HTML <a>, <img>, <script>, <link> to pass through proxy
 *
 * WARNING: This is a lightweight demo. It does NOT:
 * - Strip tracking or sanitize everything
 * - Remove JS-based leaks (cookies, referer may still be exposed)
 * - Bypass authentication/protected content reliably
 *
 * Use responsibly.
 */

import express from 'express';
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Helper to normalize/resolve relative URLs to absolute
function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).toString();
  } catch (e) {
    return relative;
  }
}

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing url parameter');

  // Basic normalization: allow http(s) only
  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).send('Only http(s) URLs are supported. Include http:// or https://');
  }

  try {
    // Forward common headers that make sense; do NOT forward cookies from user to upstream.
    const headers = {
      'User-Agent': req.get('User-Agent') || 'SleekProxy/1.0',
      // remove referer to reduce leaking origin — we still pass origin if you want in future
    };

    const upstream = await fetch(target, { headers, redirect: 'follow' });

    // If Content-Type is HTML, parse and rewrite links / resources
    const contentType = upstream.headers.get('content-type') || '';

    // Pass through status for e.g., 404/500 pages from upstream
    res.status(upstream.status);

    if (contentType.includes('text/html')) {
      const text = await upstream.text();

      const $ = cheerio.load(text, { decodeEntities: false });

      // Rewriting helper: given an attribute value, convert it to proxied form or absolute
      function makeProxyUrl(base, attrVal) {
        if (!attrVal) return attrVal;
        // data- urls and javascript: and mailto: should be left alone
        if (/^(data:|javascript:|mailto:|tel:|#)/i.test(attrVal)) return attrVal;
        const abs = resolveUrl(base, attrVal);
        return `/proxy?url=${encodeURIComponent(abs)}`;
      }

      // Rewrite anchors
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        $(el).attr('href', makeProxyUrl(target, href));
        // open in same window — keep proxied
        $(el).attr('rel', 'noreferrer noopener');
      });

      // Rewrite src attributes (images, scripts)
      $('[src]').each((i, el) => {
        const src = $(el).attr('src');
        $(el).attr('src', makeProxyUrl(target, src));
      });

      // Rewrite link[rel=stylesheet] hrefs
      $('link[href]').each((i, el) => {
        const href = $(el).attr('href');
        $(el).attr('href', makeProxyUrl(target, href));
      });

      // Inject a small topbar so user can easily navigate / see proxied origin
      const topbar = `
        <div id="proxy-topbar" style="position:fixed;left:0;right:0;top:0;z-index:9999999;
          height:56px;backdrop-filter: blur(6px); background: linear-gradient(180deg, rgba(12,18,26,0.9), rgba(12,18,26,0.6));
          color:#e6eef8; display:flex; align-items:center; gap:12px; padding:8px 16px; box-shadow:0 4px 12px rgba(2,6,23,0.6)">
          <div style="font-weight:700; font-family:Inter, system-ui; font-size:14px;">SleekProxy</div>
          <div style="opacity:.9; font-size:13px;">${escapeHtml(target)}</div>
          <div style="margin-left:auto; display:flex; gap:8px;">
            <a href="/" style="color:#cfe8ff; text-decoration:none; padding:6px 10px; background:rgba(255,255,255,0.02); border-radius:8px;">New search</a>
            <a href="${escapeAttr(`/proxy?url=${encodeURIComponent(target)}`)}" style="color:#cfe8ff; text-decoration:none; padding:6px 10px; background:rgba(255,255,255,0.02); border-radius:8px;">Refresh</a>
          </div>
        </div>
        <div style="height:56px;"></div>
      `;

      // prepend topbar to <body>
      if ($('body').length) {
        $('body').prepend(topbar);
      } else {
        // fallback: prepend to root
        $.root().prepend(topbar);
      }

      // Remove problematic CSP meta tags so proxied scripts/styles can load (best-effort)
      $('meta[http-equiv="Content-Security-Policy"]').remove();

      // Send modified HTML
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send($.html());
      return;
    }

    // For non-HTML, stream bytes and copy important headers
    // Make sure we don't allow certain headers to leak sensitive info
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error: ' + String(err.message || err));
  }
});

// Tiny helpers for insertion
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

app.listen(PORT, () => {
  console.log(`SleekProxy running on http://localhost:${PORT} — open that in your browser`);
});
