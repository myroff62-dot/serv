const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function loadDotEnv(file = path.join(__dirname, '.env')) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      value = value.replace(/^(['"])(.*)\1$/, '$2');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (_) {}
}
loadDotEnv();

const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '');
const OWNER_CHAT_ID = String(process.env.OWNER_CHAT_ID || '');
const ADMIN_CHAT_IDS = String(process.env.ADMIN_CHAT_IDS || OWNER_CHAT_ID)
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

const root = path.join(__dirname, 'frontend');

const buckets = new Map();
function allow(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.t > windowMs) {
    b = { t: now, n: 0 };
    buckets.set(key, b);
  }
  b.n++;
  return b.n <= limit;
}

function headers(res, extra = {}) {
  Object.assign(res, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
    ...extra
  });
}

function getCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function ensureSession(req, res) {
  const cookies = getCookies(req);
  if (cookies.jof_sid) return cookies.jof_sid;
  const sid = crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie', `jof_sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return sid;
}

function json(res, status, body) {
  headers(res, { 'Content-Type': 'application/json; charset=utf-8' });
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 32768) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (_) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function telegram(method, params) {
  if (!TOKEN) return { ok: false, description: 'TELEGRAM_BOT_TOKEN is not configured' };
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(params || {})
  });
  return r.json();
}

function ipFromRequest(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'Unknown';
}

async function route(req, res) {
  headers(res);
  const sid = ensureSession(req, res);
  const ip = ipFromRequest(req);

  if (req.url === '/api/session' && req.method === 'GET') {
    return json(res, 200, { ok: true, sessionId: sid });
  }

  if (req.url === '/api/geo' && req.method === 'GET') {
    if (!allow(`geo:${ip}`, 20, 60000)) return json(res, 429, {error:'Too many requests'});
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
      return json(res, 200, {ip:'127.0.0.1', country:'Localhost', city:'Local test', isp:'Local'});
    }
    return json(res, 200, {ip, country:'Неизвестно', city:'Неизвестно', isp:'Неизвестно'});
  }

  if (req.url === '/api/telegram/send' && req.method === 'POST') {
    if (!allow(`send:${ip}`, 60, 60000)) return json(res, 429, {ok:false});
    if (!TOKEN) return json(res, 503, {ok:false, description:'Telegram token is not configured'});
    let b;
    try { b = await readJson(req); } catch (e) {
      return json(res, 400, {ok:false, description:e.message});
    }
    const chatId = String(b.chatId || '');
    console.log(`📨 /send: chatId=${chatId}, message length=${b.message ? b.message.length : 0}, editMessageId=${b.editMessageId || 'none'}`);
    if (!ADMIN_CHAT_IDS.includes(chatId)) {
      console.log(`❌ chatId ${chatId} не в списке админов: ${ADMIN_CHAT_IDS.join(', ')}`);
      return json(res, 403, {ok:false});
    }
    const params = {chat_id:chatId, text:String(b.message || ''), parse_mode:'HTML'};
    if (b.replyMarkup) params.reply_markup = b.replyMarkup;
    let result;
    try {
      result = b.editMessageId
        ? await telegram('editMessageText', {...params, message_id:Number(b.editMessageId)})
        : await telegram('sendMessage', params);
    } catch (e) {
      return json(res, 502, {ok:false, description:e.message});
    }
    return json(res, result.ok ? 200 : 502, result);
  }

  if (req.url.startsWith('/api/telegram/updates') && req.method === 'GET') {
    if (!allow(`updates:${ip}`, 15, 60000)) return json(res, 429, {ok:false, result:[]});
    if (!TOKEN) return json(res, 503, {ok:false, result:[]});
    const u = new URL(req.url, `http://${HOST}:${PORT}`);
    const offset = Number(u.searchParams.get('offset') || 0);
    try {
      const result = await telegram('getUpdates', {
        offset,
        timeout: 10,
        allowed_updates: ['message', 'callback_query']
      });
      return json(res, result.ok ? 200 : 502, result);
    } catch (e) {
      return json(res, 502, {ok:false, result:[], description:e.message});
    }
  }

  if (req.url === '/api/telegram/answer' && req.method === 'POST') {
    if (!TOKEN) return json(res, 503, {ok:false});
    let b;
    try { b = await readJson(req); } catch (e) {
      return json(res, 400, {ok:false, description:e.message});
    }
    if (!b.callbackQueryId) return json(res, 400, {ok:false});
    try {
      return json(res, 200, await telegram('answerCallbackQuery', {
        callback_query_id: String(b.callbackQueryId),
        ...(b.text ? {text:String(b.text), show_alert:false} : {})
      }));
    } catch (e) {
      return json(res, 502, {ok:false, description:e.message});
    }
  }

  // Static files.
  const pathname = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.normalize(path.join(root, file));
  if (!full.startsWith(root)) return json(res, 403, {error:'Forbidden'});

  try {
    const stat = fs.statSync(full);
    if (!stat.isFile()) return json(res, 404, {error:'Not found'});
    const ext = path.extname(full).toLowerCase();
    const types = {
      '.html':'text/html; charset=utf-8',
      '.js':'application/javascript; charset=utf-8',
      '.css':'text/css; charset=utf-8',
      '.png':'image/png',
      '.jpg':'image/jpeg',
      '.jpeg':'image/jpeg',
      '.svg':'image/svg+xml',
      '.ico':'image/x-icon'
    };
    res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream'});
    fs.createReadStream(full).pipe(res);
  } catch (_) {
    json(res, 404, {error:'Not found'});
  }
}

const server = http.createServer((req, res) => {
  route(req, res).catch(err => {
    console.error(err);
    if (!res.headersSent) json(res, 500, {error:'Internal server error'});
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Local site: http://${HOST}:${PORT}`);
  console.log(`Telegram configured: ${Boolean(TOKEN)}`);
  console.log(`Owner configured: ${Boolean(OWNER_CHAT_ID)}`);
});
