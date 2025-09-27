const cheerio = require('cheerio');

const FUNCTION_PATH = '/.netlify/functions/proxy';

exports.handler = async function (event, context) {
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
        body: 'Only http(s) URLs are supported.'
      };
    }

    const upstreamResp = await fetch(target, {
      headers: {
        'User-Agent': event.headers['user-agent'] || 'SleekProxy/1.0'
      },
      redirect: 'follow'
    });

    const contentType = upstreamResp.headers.get('content-type') || '';
    const status = upstreamResp.status || 200;

    if (contentType.toLowerCase().includes('text/html')) {
      const text = await upstreamResp.text();
      const $ = cheerio.load(text, { decodeEntities: false });

      function resolveAndProxy(base, val) {
        if (!val || /^(data:|javascript:|mailto:|tel:|#)/i.test(val)) return val;
        try {
          const abs = new URL(val, base).toString();
          return `${FUNCTION_PATH}?url=${encodeURIComponent(abs)}`;
        } catch {
          return val;
        }
      }

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        $(el).attr('href', resolveAndProxy(target, href));
      });

      $('[src]').each((_, el) => {
        const src = $(el).attr('src');
        $(el).attr('src', resolveAndProxy(target, src));
      });

      $('link[href]').each((_, el) => {
        const href = $(el).attr('href');
        $(el).attr('href', resolveAndProxy(target, href));
      });

      $('meta[http-equiv="Content-Security-Policy"]').remove();

      $('body').prepend(`
        <div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#111;padding:10px;color:#fff;font-size:14px;">
          Proxying: ${target}
          <a href="/" style="margin-left:20px;color:#0bf;">Home</a>
        </div>
        <div style="height:40px;"></div>
      `);

      return {
        statusCode: status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8'
        },
        body: $.html()
      };
    } else {
      const buffer = Buffer.from(await upstreamResp.arrayBuffer());
      return {
        statusCode: status,
        isBase64Encoded: true,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'max-age=3600'
        },
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
};
