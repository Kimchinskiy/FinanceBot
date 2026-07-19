// ===================================================================
// FinaBot — migrate.js  (миграция БД к многопользовательности)
// SQLite-версия. Используется и как standalone (node migrate.js),
// и как модуль runMigration(db), вызываемый при старте server.js.
// Идемпотентно — безопасно запускать повторно.
// ===================================================================
const { db, DB_PATH } = require('./db');

// value храним как TEXT (JSON-строка), datetime — TEXT (ISO-8601).
const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE,
    password_hash TEXT,
    tg_id         TEXT UNIQUE,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  `INSERT OR IGNORE INTO users (id, email) VALUES ('system', 'system@local')`,

  `CREATE TABLE IF NOT EXISTS incomes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'system',
    amount      REAL NOT NULL,
    category    TEXT NOT NULL,
    description TEXT DEFAULT '',
    datetime    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_incomes_user ON incomes (user_id)`,

  `CREATE TABLE IF NOT EXISTS expenses (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'system',
    amount      REAL NOT NULL,
    category    TEXT NOT NULL,
    description TEXT DEFAULT '',
    datetime    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses (user_id)`,

  `CREATE TABLE IF NOT EXISTS mandatory_payments (
    id       TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL DEFAULT 'system',
    name     TEXT NOT NULL,
    amount   REAL NOT NULL,
    category TEXT NOT NULL,
    day      INTEGER,
    type     TEXT DEFAULT 'monthly',
    status   TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mandatory_user ON mandatory_payments (user_id)`,

  `CREATE TABLE IF NOT EXISTS settings (
    user_id    TEXT NOT NULL DEFAULT 'system',
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, key)
  )`,

  `INSERT OR IGNORE INTO settings (user_id, key, value) VALUES
    ('system','cash','"0"'),
    ('system','salary','{"day": null, "amount": 0, "period": "monthly"}'),
    ('system','income_categories','["Зарплата","Фриланс","Подработка","Подарок","Инвестиции","Прочее"]'),
    ('system','expense_categories','["Еда","Транспорт","Жильё","Одежда","Здоровье","Развлечения","Связь","Коммуналка","Кредит","Прочее"]')`,

  `CREATE TABLE IF NOT EXISTS accounts (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT 'system',
    name       TEXT NOT NULL,
    type       TEXT DEFAULT 'cash',
    currency   TEXT DEFAULT 'RUB',
    balance    REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id)`,

  `INSERT OR IGNORE INTO accounts (id, user_id, name, type, currency, balance)
    SELECT 'system-cash','system','Наличные','cash','RUB',0
    WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE user_id='system')`,
  `INSERT OR IGNORE INTO accounts (id, user_id, name, type, currency, balance)
    SELECT 'system-card','system','Карта','card','RUB',0
    WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE user_id='system' AND id <> 'system-cash')`,

  `CREATE TABLE IF NOT EXISTS goals (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL DEFAULT 'system',
    title         TEXT NOT NULL,
    target_amount REAL NOT NULL,
    current_amount REAL NOT NULL DEFAULT 0,
    deadline      TEXT,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id)`,

  `CREATE TABLE IF NOT EXISTS debts (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'system',
    person      TEXT NOT NULL,
    amount      REAL NOT NULL,
    note        TEXT DEFAULT '',
    direction   TEXT DEFAULT 'i_owe',
    status      TEXT DEFAULT 'pending',
    due_date    TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_debts_user ON debts (user_id)`,
];

// Новые колонки (добавляются идемпотентно). SQLite не поддерживает
// ALTER TABLE ADD COLUMN IF NOT EXISTS, поэтому проверяем через PRAGMA.
const columnMigrations = [
  // Источник средств (счёт) для доходов/расходов
  { table: 'incomes',  column: 'source', def: `source TEXT NOT NULL DEFAULT 'Наличные'` },
  { table: 'expenses', column: 'source', def: `source TEXT NOT NULL DEFAULT 'Наличные'` },
  // Инвестиционные активы (крипта/акции/вклады)
  { table: 'accounts', column: 'symbol',           def: `symbol TEXT` },
  { table: 'accounts', column: 'quantity',         def: `quantity REAL` },
  { table: 'accounts', column: 'unit_price',       def: `unit_price REAL` },
  { table: 'accounts', column: 'meta',             def: `meta TEXT DEFAULT '{}'` },
  { table: 'accounts', column: 'price_updated_at', def: `price_updated_at TEXT` },
];

function columnExists(table, column) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some(r => r.name === column);
  } catch (_) {
    return false;
  }
}

function runMigration() {
  for (let i = 0; i < statements.length; i++) {
    try {
      db.exec(statements[i]);
    } catch (e) {
      throw new Error(`migration step ${i + 1} failed: ${e.message}`);
    }
  }
  // Добавляем недостающие колонки
  for (const m of columnMigrations) {
    if (!columnExists(m.table, m.column)) {
      try {
        db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.def}`);
      } catch (e) {
        throw new Error(`add column ${m.table}.${m.column} failed: ${e.message}`);
      }
    }
  }
}

module.exports = { runMigration };

// Standalone-запуск: node migrate.js
if (require.main === module) {
  try {
    runMigration();
    console.log(`✅ Migration complete (${DB_PATH})`);
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
}
