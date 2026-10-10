-- Choco Campus SQLite schema. The Node server also runs these CREATE TABLE statements automatically.
PRAGMA foreign_keys = ON;

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
