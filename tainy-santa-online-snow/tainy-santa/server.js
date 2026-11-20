'use strict';

// «Тайный Санта» — сервер на Node.js.
// Локально данные хранятся в JSON, а при публикации DATABASE_URL включает PostgreSQL.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  randomBytes,
  randomInt,
  createHash,
  timingSafeEqual,
} = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'secret-santa.json');
const MAX_BODY_BYTES = 20 * 1024;

// При публикации DATABASE_URL включает долговременную базу PostgreSQL.
// Локально, без DATABASE_URL, проект продолжает хранить данные в JSON-файле.
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
}
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 240;
const rateBuckets = new Map();
const allowedCurrencies = new Set(['RUB', 'USD', 'EUR']);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

if (!pool) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

function emptyStore() {
  return { version: 1, games: {} };
}

function loadLocalStore() {
  if (!fs.existsSync(DATA_FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.games || typeof parsed.games !== 'object') {
      throw new Error('Неверный формат файла данных.');
    }
    return parsed;
  } catch (error) {
    console.error(`Не удалось прочитать базу данных ${DATA_FILE}:`, error.message);
    throw new Error('Файл с данными игры повреждён. Не перезаписываю его автоматически.');
  }
}

let store = emptyStore();
let saveQueue = Promise.resolve();

async function initializeStore() {
  if (!pool) {
    store = loadLocalStore();
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS secret_santa_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const result = await pool.query('SELECT payload FROM secret_santa_state WHERE id = 1');
  if (result.rows.length) {
    const parsed = result.rows[0].payload;
    if (!parsed || typeof parsed !== 'object' || !parsed.games || typeof parsed.games !== 'object') {
      throw new Error('В базе данных найден некорректный формат игровых данных.');
    }
    store = parsed;
  } else {
    store = emptyStore();
    await saveStore();
  }
}

function saveStore() {
  if (pool) {
    // Сохраняем последовательные снимки по очереди, чтобы параллельные записи
    // участников в одном экземпляре приложения не затирали изменения друг друга.
    const snapshot = JSON.stringify(store);
    const operation = saveQueue.catch(() => {}).then(() => pool.query(
      `INSERT INTO secret_santa_state (id, payload, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [snapshot],
    ));
    saveQueue = operation.catch((error) => {
      console.error('Не удалось сохранить данные в PostgreSQL:', error.message);
    });
    return operation;
  }

  const temporaryFile = `${DATA_FILE}.tmp`;
  const contents = JSON.stringify(store, null, 2);
  fs.writeFileSync(temporaryFile, contents, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryFile, DATA_FILE);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function safeTokenMatch(providedToken, storedHash) {
  if (typeof providedToken !== 'string' || !storedHash) return false;
  const providedHash = Buffer.from(hashToken(providedToken), 'hex');
  const expectedHash = Buffer.from(storedHash, 'hex');
  return providedHash.length === expectedHash.length && timingSafeEqual(providedHash, expectedHash);
}

function makeToken() {
  return randomBytes(32).toString('base64url');
}

function makeCode() {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += alphabet[randomInt(alphabet.length)];
  return code;
}

function normalizeName(name) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function shuffleSecure(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createDerangement(participants) {
  // Случайная перестановка без совпадений «сам себе».
  // Для 2+ участников вероятность быстро найти такую перестановку высокая.
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const shuffled = shuffleSecure(participants);
    if (shuffled.every((recipient, index) => recipient.id !== participants[index].id)) {
      return shuffled;
    }
  }
  // Гарантированный безопасный резервный вариант — случайный цикл.
  const cycle = shuffleSecure(participants);
  return cycle.map((_, index) => cycle[(index + 1) % cycle.length]);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:"
  );
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  return json(res, status, { error: message });
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function checkRateLimit(req, res) {
  const now = Date.now();
  const ip = req.socket.remoteAddress || 'unknown';
  const current = rateBuckets.get(ip);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (current.count <= RATE_LIMIT) return true;
  res.setHeader('Retry-After', String(Math.ceil((RATE_WINDOW_MS - (now - current.startedAt)) / 1000)));
  sendError(res, 429, 'Слишком много запросов. Попробуйте немного позже.');
  return false;
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().includes('application/json')) {
    const error = new Error('Ожидается запрос в формате JSON.');
    error.status = 415;
    throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Слишком большой запрос.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Ожидается JSON-объект.');
    }
    return parsed;
  } catch {
    const error = new Error('Не удалось прочитать данные запроса.');
    error.status = 400;
    throw error;
  }
}

function getGame(code) {
  return store.games[String(code || '').toUpperCase()] || null;
}

function requireAdmin(req, res, game) {
  const token = getHeader(req, 'x-admin-token');
  if (!game || !safeTokenMatch(token, game.adminTokenHash)) {
    sendError(res, 404, 'Игра или секретная ссылка организатора не найдена.');
    return false;
  }
  return true;
}

function formatPublicGame(game) {
  return {
    code: game.code,
    title: game.title,
    budget: game.budget,
    currency: game.currency,
    status: game.status,
    participantCount: game.participants.length,
  };
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1) : null;
}

async function handleApi(req, res, url) {
  if (!checkRateLimit(req, res)) return;
  const pathname = url.pathname;

  // GET: общая информация о приглашении. Пары и секреты не выдаются.
  let match = routeMatch(pathname, /^\/api\/games\/([A-Z0-9]+)\/public$/i);
  if (req.method === 'GET' && match) {
    const game = getGame(match[0]);
    if (!game) return sendError(res, 404, 'Игра не найдена. Проверьте ссылку-приглашение.');
    return json(res, 200, formatPublicGame(game));
  }

  // POST: создать новую игру и секретный ключ организатора.
  if (req.method === 'POST' && pathname === '/api/games') {
    const body = await readJson(req);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const budget = Number(body.budget);
    const currency = body.currency;
    if (title.length < 2 || title.length > 60) return sendError(res, 400, 'Название игры должно содержать от 2 до 60 символов.');
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 1_000_000) return sendError(res, 400, 'Укажите бюджет от 1 до 1 000 000.');
    if (!allowedCurrencies.has(currency)) return sendError(res, 400, 'Выберите поддерживаемую валюту.');

    let code;
    do { code = makeCode(); } while (getGame(code));
    const adminToken = makeToken();
    store.games[code] = {
      code,
      title,
      budget,
      currency,
      status: 'open',
      createdAt: new Date().toISOString(),
      drawnAt: null,
      adminTokenHash: hashToken(adminToken),
      participants: [],
    };
    await saveStore();
    return json(res, 201, { code, adminToken });
  }

  // POST: добавить участника, выдать его персональный секретный токен.
  match = routeMatch(pathname, /^\/api\/games\/([A-Z0-9]+)\/join$/i);
  if (req.method === 'POST' && match) {
    const game = getGame(match[0]);
    if (!game) return sendError(res, 404, 'Игра не найдена.');
    if (game.status !== 'open') return sendError(res, 409, 'Жеребьёвка уже началась. Запись закрыта.');
    const body = await readJson(req);
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 40) return sendError(res, 400, 'Имя должно содержать от 2 до 40 символов.');
    const nameKey = normalizeName(name);
    if (game.participants.length >= 100) return sendError(res, 409, 'В одной игре может быть не больше 100 участников.');
    if (game.participants.some((person) => person.nameKey === nameKey)) {
      return sendError(res, 409, 'Такое имя уже есть в списке. Добавьте к имени фамилию или отличительное слово.');
    }
    const participantToken = makeToken();
    const participantId = randomBytes(8).readBigUInt64BE().toString();
    game.participants.push({
      id: participantId,
      name,
      nameKey,
      tokenHash: hashToken(participantToken),
      recipientId: null,
      createdAt: new Date().toISOString(),
    });
    await saveStore();
    return json(res, 201, { participantId, participantToken });
  }

  // GET: организатор получает состав списка, но никогда не получает пары.
  match = routeMatch(pathname, /^\/api\/games\/([A-Z0-9]+)\/admin$/i);
  if (req.method === 'GET' && match) {
    const game = getGame(match[0]);
    if (!requireAdmin(req, res, game)) return;
    return json(res, 200, {
      code: game.code,
      title: game.title,
      budget: game.budget,
      currency: game.currency,
      status: game.status,
      drawnAt: game.drawnAt,
      participants: game.participants.map((person) => ({ name: person.name, created_at: person.createdAt })),
    });
  }

  // PATCH: настройки можно редактировать только до жеребьёвки.
  if (req.method === 'PATCH' && match) {
    const game = getGame(match[0]);
    if (!requireAdmin(req, res, game)) return;
    if (game.status !== 'open') return sendError(res, 409, 'После жеребьёвки настройки игры заблокированы.');
    const body = await readJson(req);
    const title = typeof body.title === 'string' ? body.title.trim() : game.title;
    const budget = body.budget === undefined ? game.budget : Number(body.budget);
    const currency = body.currency === undefined ? game.currency : body.currency;
    if (title.length < 2 || title.length > 60) return sendError(res, 400, 'Название игры должно содержать от 2 до 60 символов.');
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 1_000_000) return sendError(res, 400, 'Укажите бюджет от 1 до 1 000 000.');
    if (!allowedCurrencies.has(currency)) return sendError(res, 400, 'Выберите поддерживаемую валюту.');
    game.title = title;
    game.budget = budget;
    game.currency = currency;
    await saveStore();
    return json(res, 200, { ok: true });
  }

  // POST: провести жеребьёвку ровно один раз.
  match = routeMatch(pathname, /^\/api\/games\/([A-Z0-9]+)\/draw$/i);
  if (req.method === 'POST' && match) {
    const game = getGame(match[0]);
    if (!requireAdmin(req, res, game)) return;
    if (game.status !== 'open') return sendError(res, 409, 'Жеребьёвка уже проводилась.');
    const participants = [...game.participants].sort((a, b) => a.id.localeCompare(b.id));
    if (participants.length < 2) return sendError(res, 409, 'Для жеребьёвки нужно минимум два участника.');
    const recipients = createDerangement(participants);
    participants.forEach((participant, index) => {
      participant.recipientId = recipients[index].id;
    });
    game.status = 'drawn';
    game.drawnAt = new Date().toISOString();
    await saveStore();
    return json(res, 200, { ok: true, participantCount: participants.length });
  }

  // GET: единственный endpoint, который раскрывает получателя, проверяет личный токен.
  match = routeMatch(pathname, /^\/api\/games\/([A-Z0-9]+)\/me$/i);
  if (req.method === 'GET' && match) {
    const game = getGame(match[0]);
    const participantToken = getHeader(req, 'x-participant-token');
    if (!game || !participantToken) return sendError(res, 404, 'Личная ссылка не найдена.');
    const participant = game.participants.find((person) => safeTokenMatch(participantToken, person.tokenHash));
    if (!participant) return sendError(res, 404, 'Личная ссылка не найдена. Проверьте, что открыли свою ссылку.');
    if (game.status !== 'drawn') {
      return json(res, 200, { status: 'open', title: game.title, budget: game.budget, currency: game.currency });
    }
    const recipient = game.participants.find((person) => person.id === participant.recipientId);
    if (!recipient) return sendError(res, 500, 'Не удалось получить результат. Обратитесь к организатору.');
    return json(res, 200, { status: 'drawn', recipientName: recipient.name, title: game.title, budget: game.budget, currency: game.currency });
  }

  return sendError(res, 404, 'Страница не найдена.');
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return sendError(res, 400, 'Некорректный адрес.'); }
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return sendError(res, 403, 'Доступ запрещён.');
  }

  let target = filePath;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    // Все экранные маршруты приложения используют единый клиентский index.html.
    if (decoded === '/' || /^\/g\/[A-Z0-9]+(?:\/(?:admin|result))?\/?$/i.test(decoded)) {
      target = path.join(PUBLIC_DIR, 'index.html');
    } else {
      return sendError(res, 404, 'Файл не найден.');
    }
  }

  const extension = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405, 'Метод запроса не поддерживается.');
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    if (res.headersSent) return res.end();
    const status = Number.isInteger(error.status) ? error.status : 500;
    return sendError(res, status, status === 500
      ? 'Произошла ошибка сервера. Попробуйте ещё раз.'
      : error.message);
  }
});

initializeStore().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Тайный Санта запущен на ${HOST}:${PORT}`);
    console.log(pool ? 'Хранилище: PostgreSQL (DATABASE_URL).' : `Файл данных: ${DATA_FILE}`);
  });
}).catch((error) => {
  console.error('Не удалось подготовить хранилище данных:', error);
  process.exit(1);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
