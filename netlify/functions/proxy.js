// netlify/functions/proxy.js
import cheerio from 'cheerio';

/**
 * Proxy function for Netlify Functions
 * - Endpoint: /.netlify/functions/proxy?url=ENCODED_URL
 *
 * Behavior:
 * - Accepts only http(s) URLs.
 * - For HTML responses: parse and rewrite links (a[href], img[src], script[src], link[href]) to
 *   point back to this function.
 * - For non-HTML: return base64-encoded body with correct Content-Type.
 *
 * Limitations:
 * - This is best-effort. Some pages using strict CSP or dynamic JS will not fully work.
 * - Binary responses are returned base64 (Netlify expects that flag).
 * - No authentication for public hosting — add access controls if hosting publicly.
 */

const FUNCTION_PATH = '/.netlify/functions/proxy';

export async function handler(event, context) {
  try {
    const qs = event.queryStringParameters || {};
    const target = qs.url;
    if (!target) {
      return {
        statusCode: 400,
        body: 'Missing url parameter. Usage: /.netlify/functions/proxy?url=https://example.com'
      };
    }

    if (!/^https?:\/\//i.test(target)) {
      return {
        statusCode: 400,
        body: 'Only http(s) URLs are supported. Include http:// or https://'
      };
    }

    // Forward minimal headers; do not forward client cookies
    const upstreamResp = await fetch(target, {
      method: 'GET',
      headers: {
        'User-Agent': event.headers['user-agent'] || 'SleekProxy-Netlify/1.0'
      },
      redirect: 'follow'
    });

    const contentType = upstreamResp.headers.get('content-type') || '';

    // Pass upstream status through (e.g., 404)
    const status = upstreamResp.status || 200;

    if (contentType.toLowerCase().includes('text/html')) {
      // HTML — rewrite
      const text = await upstreamResp.text();
      const $ = cheerio.load(text, { decodeEntities: false });

      // helper to resolve relative -> absolute and then return proxied function URL
      function resolveAndProxy(base, val) {
        if (!val) return val;
        // leave safe protocols or anchors unchanged
        if (/^(data:|javascript:|mailto:|tel:|#)/i.test(val)) return val;
        try {
          const abs = new URL(val, base).toString();
          return `${FUNCTION_PATH}?url=${encodeURIComponent(abs)}`;
        } catch (e) {
          return val;
        }
      }

      // Rewrite anchor hrefs
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        $(el).attr('href', resolveAndProxy(target, href));
        $(el).attr('rel', 'noreferrer noopener');
      });

      // Rewrite src attributes (img/script/iframe)
      $('[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (!src) return;
        $(el).attr('src', resolveAndProxy(target, src));
      });

      // Rewrite CSS link hrefs
      $('link[href]').each((i, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        $(el).attr('href', resolveAndProxy(target, href));
      });

      // Remove CSP meta tags so injected scripts/styles can load (best-effort)
      $('meta[http-equiv="Content-Security-Policy"]').remove();

      // Inject a slim topbar so users see proxied origin (optional)
      const topbar = `
        <div id="sleekproxy-topbar" style="position:fixed;left:0;right:0;top:0;z-index:9999999;height:54px;
            backdrop-filter: blur(6px); background:linear-gradient(180deg, rgba(12,18,26,0.9), rgba(12,18,26,0.6));
            color:#e6eef8; display:flex; align-items:center; gap:12px; padding:6px 14px; font-family:Inter,system-ui;">
          <div style="font-weight:700; font-size:13px; margin-left:6px;">SleekProxy</div>
          <div style="opacity:.93; font-size:13px; margin-left:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:60%;">
            ${escapeHtml(target)}
          </div>
          <div style="margin-left:auto; display:flex; gap:8px;">
            <a href="/" style="color:#cfe8ff; text-decoration:none; padding:6px 10px; background:rgba(255,255,255,0.02); border-radius:8px;">New</a>
            <a href="${escapeAttr(`${FUNCTION_PATH}?url=${encodeURIComponent(target)}`)}" style="color:#cfe8ff; text-decoration:none; padding:6px 10px; background:rgba(255,255,255,0.02); border-radius:8px;">Refresh</a>
          </div>
        </div><div style="height:54px;"></div>`;

      if ($('body').length) {
        $('body').prepend(topbar);
      } else {
        $.root().prepend(topbar);
      }

      const out = $.html();

      return {
        statusCode: status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8'
        },
        body: out
      };
    } else {
      // Non-HTML: return binary as base64 (Netlify expects base64 for binary payloads)
      const buffer = Buffer.from(await upstreamResp.arrayBuffer());
      const headers = {
        'Content-Type': contentType || 'application/octet-stream',
        // allow caching for static resources if desired (optional)
        'Cache-Control': 'max-age=3600'
      };

      return {
        statusCode: status,
        isBase64Encoded: true,
        headers,
        body: buffer.toString('base64')
      };
    }
  } catch (err) {
    console.error('Proxy function error:', err);
    return {
      statusCode: 500,
      body: 'Proxy function error: ' + String(err.message || err)
    };
  }
}

// helpers
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
