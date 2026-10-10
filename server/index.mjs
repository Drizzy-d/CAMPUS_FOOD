import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_PATH = path.resolve(ROOT, process.env.DB_PATH || 'data/choco-campus.sqlite3');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'choco_admin';
const PRICE_PER_WAFFLE = 200;
const scrypt = promisify(scryptCallback);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    whatsapp TEXT NOT NULL DEFAULT '',
    min_purchase INTEGER NOT NULL DEFAULT 4,
    threshold INTEGER NOT NULL DEFAULT 10
  );
  INSERT OR IGNORE INTO settings (id, whatsapp, min_purchase, threshold) VALUES (1, '', 4, 10);
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    qty INTEGER NOT NULL CHECK (qty > 0),
    total INTEGER NOT NULL,
    pickup TEXT NOT NULL DEFAULT 'À confirmer',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'En attente',
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'student',
    loyalty_counted INTEGER NOT NULL DEFAULT 0,
    loyalty_message TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    normalized_phone TEXT NOT NULL DEFAULT '',
    normalized_name TEXT NOT NULL,
    bought INTEGER NOT NULL DEFAULT 0,
    rewards INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_customer_phone ON customers(normalized_phone);
  CREATE INDEX IF NOT EXISTS idx_customer_name ON customers(normalized_name);
  CREATE TABLE IF NOT EXISTS loyalty_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    event_at TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 0,
    qualifies INTEGER NOT NULL DEFAULT 0,
    rewards_earned INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_history_customer ON loyalty_history(customer_id, id DESC);
`);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

const toString = value => (typeof value === 'string' ? value.trim() : String(value ?? '').trim());
const normalizePhone = value => toString(value).replace(/\D/g, '');
const normalizeName = value => toString(value).normalize('NFKC').toLocaleLowerCase('fr-FR');
const isoNow = () => new Date().toISOString();
const getSettings = () => db.prepare('SELECT whatsapp, min_purchase AS minPurchase, threshold FROM settings WHERE id = 1').get();
const safeSettings = () => {
  const s = getSettings();
  return { whatsappConfigured: Boolean(s.whatsapp), minPurchase: s.minPurchase, threshold: s.threshold, price: PRICE_PER_WAFFLE };
};
const escapeForMessage = value => toString(value).slice(0, 500);
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [scheme, salt, savedHex] = toString(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !savedHex) return false;
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const saved = Buffer.from(savedHex, 'hex');
  return derived.length === saved.length && timingSafeEqual(derived, saved);
}
function cookieToken(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === COOKIE_NAME) return decodeURIComponent(valueParts.join('='));
  }
  return '';
}
function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_MS / 1000);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
function requireAdmin(req, res, next) {
  const token = cookieToken(req);
  if (!token) return res.status(401).json({ error: 'Connecte-toi pour accéder à cette section.' });
  const session = db.prepare(`
    SELECT s.token_hash, s.expires_at, a.id AS admin_id, a.username
    FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?
  `).get(sha256(token));
  if (!session || session.expires_at <= Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Ta session a expiré. Connecte-toi de nouveau.' });
  }
  req.admin = { id: session.admin_id, username: session.username, tokenHash: session.token_hash };
  next();
}
async function createSession(adminId, res) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), adminId, Date.now() + SESSION_MS);
  setSessionCookie(res, token);
}
function validateOrderInput(body) {
  const name = toString(body.name).slice(0, 100);
  const phone = toString(body.phone).slice(0, 40);
  const qty = Number(body.qty);
  const pickup = toString(body.pickup || 'À confirmer').slice(0, 100) || 'À confirmer';
  const notes = escapeForMessage(body.notes).slice(0, 500);
  if (!name) return { error: 'Le nom du client est obligatoire.' };
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) return { error: 'Le nombre de gaufres doit être compris entre 1 et 100.' };
  return { name, phone, qty, pickup, notes };
}
function insertOrder({ name, phone, qty, pickup, notes, source = 'seller' }) {
  const order = {
    id: randomUUID(), name, phone: phone || '', qty, total: qty * PRICE_PER_WAFFLE,
    pickup: pickup || 'À confirmer', notes: notes || '', status: 'En attente',
    created_at: isoNow(), source, loyalty_counted: 0, loyalty_message: ''
  };
  db.prepare(`INSERT INTO orders (id, name, phone, qty, total, pickup, notes, status, created_at, source, loyalty_counted, loyalty_message)
    VALUES (@id, @name, @phone, @qty, @total, @pickup, @notes, @status, @created_at, @source, @loyalty_counted, @loyalty_message)`).run(order);
  return order;
}
function findOrCreateCustomer(order) {
  const normalizedPhone = normalizePhone(order.phone);
  const normalizedName = normalizeName(order.name);
  let customer = normalizedPhone
    ? db.prepare('SELECT * FROM customers WHERE normalized_phone = ? ORDER BY created_at DESC LIMIT 1').get(normalizedPhone)
    : db.prepare('SELECT * FROM customers WHERE normalized_name = ? ORDER BY created_at DESC LIMIT 1').get(normalizedName);
  if (!customer) {
    customer = {
      id: randomUUID(), name: order.name, phone: order.phone || '', normalized_phone: normalizedPhone,
      normalized_name: normalizedName, bought: 0, rewards: 0, created_at: isoNow()
    };
    db.prepare(`INSERT INTO customers (id, name, phone, normalized_phone, normalized_name, bought, rewards, created_at)
      VALUES (@id, @name, @phone, @normalized_phone, @normalized_name, @bought, @rewards, @created_at)`).run(customer);
  } else {
    const newName = order.name || customer.name;
    const newPhone = order.phone || customer.phone;
    db.prepare('UPDATE customers SET name = ?, phone = ?, normalized_phone = ?, normalized_name = ? WHERE id = ?')
      .run(newName, newPhone, normalizePhone(newPhone), normalizeName(newName), customer.id);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
  }
  return customer;
}
const deliverOrder = db.transaction(orderId => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw Object.assign(new Error('Commande introuvable.'), { status: 404 });
  if (order.status === 'Livrée') return { order, loyaltyMessage: order.loyalty_message, rewardsEarned: 0 };
  let loyaltyMessage = order.loyalty_message || '';
  let rewardsEarned = 0;
  if (!order.loyalty_counted) {
    const customer = findOrCreateCustomer(order);
    const settings = getSettings();
    const qualifies = order.qty >= settings.minPurchase;
    if (qualifies) {
      const oldBought = customer.bought;
      const newBought = oldBought + order.qty;
      const oldRewardsLevel = Math.floor(oldBought / settings.threshold);
      const newRewardsLevel = Math.floor(newBought / settings.threshold);
      rewardsEarned = Math.max(0, newRewardsLevel - oldRewardsLevel);
      db.prepare('UPDATE customers SET bought = ?, rewards = rewards + ? WHERE id = ?').run(newBought, rewardsEarned, customer.id);
      loyaltyMessage = `${order.qty} gaufre(s) ajoutée(s) au compteur de fidélité.`;
    } else {
      loyaltyMessage = `Non comptabilisée : achat inférieur au minimum de ${settings.minPurchase} gaufre(s).`;
    }
    db.prepare(`INSERT INTO loyalty_history (customer_id, order_id, event_type, event_at, qty, qualifies, rewards_earned, note)
      VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?)`).run(customer.id, order.id, isoNow(), order.qty, qualifies ? 1 : 0, rewardsEarned, loyaltyMessage);
  }
  db.prepare('UPDATE orders SET status = ?, loyalty_counted = 1, loyalty_message = ? WHERE id = ?').run('Livrée', loyaltyMessage, order.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  return { order: updated, loyaltyMessage, rewardsEarned };
});

app.get('/api/health', (req, res) => res.json({ ok: true, database: 'sqlite', timestamp: isoNow() }));
app.get('/api/public/settings', (req, res) => res.json(safeSettings()));
app.get('/api/admin/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
  res.json({ setupRequired: count === 0 });
});

app.post('/api/public/orders', (req, res) => {
  const input = validateOrderInput(req.body || {});
  if (input.error) return res.status(400).json({ error: input.error });
  const settings = getSettings();
  if (!settings.whatsapp) return res.status(409).json({ error: 'Le vendeur doit configurer son numéro WhatsApp dans l’espace admin avant de recevoir des commandes.' });
  const order = insertOrder({ ...input, source: 'student' });
  res.status(201).json({
    order: { id: order.id, name: order.name, qty: order.qty, total: order.total, status: order.status, createdAt: order.created_at },
    whatsapp: settings.whatsapp
  });
});

app.post('/api/admin/setup', async (req, res) => {
  try {
    if (db.prepare('SELECT COUNT(*) AS count FROM admins').get().count > 0) {
      return res.status(409).json({ error: 'Un compte administrateur existe déjà. Utilise le formulaire de connexion.' });
    }
    const username = toString(req.body?.username).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Le nom admin doit contenir 3 à 32 caractères : lettres, chiffres, point, tiret ou tiret bas.' });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    const hashed = await passwordHash(password);
    const createAdmin = db.transaction(() => {
      if (db.prepare('SELECT COUNT(*) AS count FROM admins').get().count > 0) throw Object.assign(new Error('Le compte admin a déjà été créé. Connecte-toi.'), { status: 409 });
      return db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, hashed, isoNow()).lastInsertRowid;
    });
    const id = createAdmin();
    await createSession(Number(id), res);
    res.status(201).json({ ok: true, username });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Impossible de créer le compte admin.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const username = toString(req.body?.username).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username);
    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Nom admin ou mot de passe incorrect.' });
    }
    await createSession(admin.id, res);
    res.json({ ok: true, username: admin.username });
  } catch {
    res.status(500).json({ error: 'La connexion a échoué. Réessaie.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  const token = cookieToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ username: req.admin.username }));

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  const customers = db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE').all();
  const history = db.prepare('SELECT * FROM loyalty_history ORDER BY id DESC').all();
  const historyByCustomer = new Map();
  for (const entry of history) {
    if (!historyByCustomer.has(entry.customer_id)) historyByCustomer.set(entry.customer_id, []);
    historyByCustomer.get(entry.customer_id).push(entry);
  }
  const customerRows = customers.map(customer => ({ ...customer, history: historyByCustomer.get(customer.id) || [] }));
  res.json({
    username: req.admin.username,
    settings: getSettings(),
    orders,
    customers: customerRows,
    stats: {
      orders: orders.length,
      pending: orders.filter(order => order.status === 'En attente').length,
      customers: customers.length
    }
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const whatsapp = normalizePhone(req.body?.whatsapp);
  const minPurchase = Number(req.body?.minPurchase);
  const threshold = Number(req.body?.threshold);
  if (whatsapp.length < 8 || whatsapp.length > 15) return res.status(400).json({ error: 'Entre un numéro WhatsApp international valide, sans + ni espaces (8 à 15 chiffres).' });
  if (!Number.isInteger(minPurchase) || minPurchase < 1 || minPurchase > 100) return res.status(400).json({ error: 'Le minimum d’achat doit être compris entre 1 et 100.' });
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 100) return res.status(400).json({ error: 'Le seuil de fidélité doit être compris entre 2 et 100.' });
  db.prepare('UPDATE settings SET whatsapp = ?, min_purchase = ?, threshold = ? WHERE id = 1').run(whatsapp, minPurchase, threshold);
  res.json({ ok: true, settings: getSettings() });
});

app.post('/api/admin/orders', requireAdmin, (req, res) => {
  const input = validateOrderInput(req.body || {});
  if (input.error) return res.status(400).json({ error: input.error });
  const order = insertOrder({ ...input, source: 'seller' });
  res.status(201).json({ order });
});

app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const status = toString(req.body?.status);
  const allowed = new Set(['En attente', 'En préparation', 'Livrée', 'Annulée']);
  if (!allowed.has(status)) return res.status(400).json({ error: 'Statut de commande invalide.' });
  try {
    if (status === 'Livrée') {
      const result = deliverOrder(req.params.id);
      return res.json({ ...result, order: result.order });
    }
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status === 'Livrée' && status !== 'Livrée') return res.status(409).json({ error: 'Une commande livrée ne peut pas revenir à un statut antérieur.' });
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    res.json({ order: db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id), loyaltyMessage: '', rewardsEarned: 0 });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Impossible de mettre à jour cette commande.' });
  }
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  if (order.loyalty_counted) return res.status(409).json({ error: 'Cette commande a déjà été comptabilisée pour la fidélité et ne peut pas être supprimée.' });
  db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  res.json({ ok: true });
});

app.post('/api/admin/customers/:id/redeem', requireAdmin, (req, res) => {
  const redeem = db.transaction(customerId => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw Object.assign(new Error('Client introuvable.'), { status: 404 });
    if (customer.rewards < 1) throw Object.assign(new Error('Aucune récompense disponible pour ce client.'), { status: 409 });
    db.prepare('UPDATE customers SET rewards = rewards - 1 WHERE id = ?').run(customer.id);
    db.prepare(`INSERT INTO loyalty_history (customer_id, order_id, event_type, event_at, qty, qualifies, rewards_earned, note)
      VALUES (?, NULL, 'reward', ?, 0, 0, 0, ?)`).run(customer.id, isoNow(), 'Une gaufre offerte a été remise au client.');
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
  });
  try { res.json({ customer: redeem(req.params.id) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Impossible de remettre la récompense.' }); }
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route API introuvable.' });
  res.status(404).send('Page introuvable.');
});

const server = app.listen(PORT, HOST, () => {
  console.log('Choco Campus is running.');
  console.log(`Website: http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log('First run: open Espace admin in the website to create the admin account.');
});

function shutdown() {
  server.close(() => {
    try { db.close(); } finally { process.exit(0); }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
