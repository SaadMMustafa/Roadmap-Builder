// سيرفر محلي صغير للمشروع — من غير أي اعتماديات خارجية.
// السبب اللي بيخلّي ده مهم: تسجيل الدخول بـ Firebase لا يعمل مع فتح index.html مباشرة (file://)،
// وكذلك استيراد ملفات ES modules. السيرفر ده بيكفي تمامًا للتجربة والنشر الساكن.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  } catch {
    send(res, 400, 'Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  // منع الخروج خارج مجلد المشروع (path traversal)
  const target = path.resolve(ROOT, '.' + pathname);
  if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(target, (err, stats) => {
    if (err || !stats.isFile()) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  console.log('باني المخططات — Roadmap Builder v1.1.0');
  console.log('شغّال على: ' + address);
  console.log('افتح الرابط ده في المتصفح. للإيقاف اضغط Ctrl+C.');
});

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`المنفذ ${PORT} مشغول. جرّب: set PORT=5174 && npm start`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
