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
  const weatherWidget = `
  <style>
    #sleekproxy-widget {
      position: fixed;
      top: 10px;
      left: 12px;
      background: rgba(12,18,26,0.85);
      color: #e2e8f0;
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: 10px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.25);
      z-index: 99999999;
      min-width: 180px;
    }
    #sleekproxy-widget .time {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    #sleekproxy-widget .weather {
      font-size: 12px;
      color: #94a3b8;
    }
  </style>

  <div id="sleekproxy-widget">
    <div class="time">Loading time…</div>
    <div class="weather">Detecting location…</div>
  </div>

  <script>
    (function() {
      const timeEl = document.querySelector('#sleekproxy-widget .time');
      const weatherEl = document.querySelector('#sleekproxy-widget .weather');

      function updateTime() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        timeEl.textContent = timeStr;
      }

      setInterval(updateTime, 1000);
      updateTime();

      // Fetch weather data using Open-Meteo
      function fetchWeather(lat, lon) {
        const url = \`https://api.open-meteo.com/v1/forecast?latitude=\${lat}&longitude=\${lon}&current_weather=true\`;
        fetch(url)
          .then(res => res.json())
          .then(data => {
            const w = data.current_weather;
            if (!w) return;
            const temp = Math.round(w.temperature);
            const condition = w.weathercode;
            const codeMap = {
              0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
              45: "Fog", 48: "Freezing fog",
              51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
              61: "Light rain", 63: "Rain", 65: "Heavy rain",
              71: "Light snow", 73: "Snow", 75: "Heavy snow",
              95: "Thunderstorm"
            };
            const desc = codeMap[condition] || "Weather";
            weatherEl.textContent = \`\${temp}°C — \${desc}\`;
          })
          .catch(err => {
            console.warn('Weather fetch failed', err);
            weatherEl.textContent = "Weather unavailable";
          });
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          const { latitude, longitude } = pos.coords;
          fetchWeather(latitude, longitude);
        }, err => {
          console.warn("Geolocation blocked", err);
          weatherEl.textContent = "Location blocked";
        });
      } else {
        weatherEl.textContent = "Geolocation unsupported";
      }
    })();
  </script>
`; {
$('body').append(weatherWidget); // inject into page body

};
