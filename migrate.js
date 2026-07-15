// ===================================================================
// FinaBot — migrate.js  (миграция БД к многопользовательности)
// Используется и как standalone (node migrate.js), и как модуль
// runMigration(pool), который вызывается при старте server.js.
// Идемпотентно — безопасно запускать повторно.
// ===================================================================
const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    tg_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `INSERT INTO users (id, email) VALUES ('system', 'system@local')
   ON CONFLICT (id) DO NOTHING`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='incomes' AND column_name='user_id') THEN
      ALTER TABLE incomes ADD COLUMN user_id VARCHAR(50) NOT NULL DEFAULT 'system';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='user_id') THEN
      ALTER TABLE expenses ADD COLUMN user_id VARCHAR(50) NOT NULL DEFAULT 'system';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mandatory_payments' AND column_name='user_id') THEN
      ALTER TABLE mandatory_payments ADD COLUMN user_id VARCHAR(50) NOT NULL DEFAULT 'system';
    END IF;
  END $$`,

  // Источник средств (счёт) для доходов/расходов: Наличные | Карта | ...
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='incomes' AND column_name='source') THEN
      ALTER TABLE incomes ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT 'Наличные';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='source') THEN
      ALTER TABLE expenses ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT 'Наличные';
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='value')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='user_id') THEN
      ALTER TABLE settings RENAME TO settings_old;
      CREATE TABLE settings (
        user_id VARCHAR(50) NOT NULL DEFAULT 'system',
        key VARCHAR(100) NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, key)
      );
      INSERT INTO settings (user_id, key, value, updated_at)
        SELECT 'system', key, value, updated_at FROM settings_old;
      DROP TABLE settings_old;
    END IF;
  END $$`,

  `CREATE TABLE IF NOT EXISTS settings (
    user_id VARCHAR(50) NOT NULL DEFAULT 'system',
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
  )`,

  `INSERT INTO settings (user_id, key, value) VALUES
    ('system','cash','"0"'::jsonb),
    ('system','salary','{"day": null, "amount": 0, "period": "monthly"}'::jsonb),
    ('system','income_categories','["Зарплата","Фриланс","Подработка","Подарок","Инвестиции","Прочее"]'::jsonb),
    ('system','expense_categories','["Еда","Транспорт","Жильё","Одежда","Здоровье","Развлечения","Связь","Коммуналка","Кредит","Прочее"]'::jsonb)
  ON CONFLICT (user_id, key) DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL DEFAULT 'system',
    name VARCHAR(200) NOT NULL,
    type VARCHAR(20) DEFAULT 'cash',
    currency VARCHAR(10) DEFAULT 'RUB',
    balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id)`,

  // Расширяем accounts под инвестиционные активы (крипта/акции/вклады)
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='symbol') THEN
      ALTER TABLE accounts ADD COLUMN symbol VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='quantity') THEN
      ALTER TABLE accounts ADD COLUMN quantity DECIMAL(28,10);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='unit_price') THEN
      ALTER TABLE accounts ADD COLUMN unit_price DECIMAL(20,6);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='meta') THEN
      ALTER TABLE accounts ADD COLUMN meta JSONB DEFAULT '{}'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='price_updated_at') THEN
      ALTER TABLE accounts ADD COLUMN price_updated_at TIMESTAMP;
    END IF;
  END $$`,

  `INSERT INTO accounts (id, user_id, name, type, currency, balance)
   SELECT 'system-cash','system','Наличные','cash','RUB',0
   WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE user_id='system')`,

  `INSERT INTO accounts (id, user_id, name, type, currency, balance)
   SELECT 'system-card','system','Карта','card','RUB',0
   WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE user_id='system' AND id <> 'system-cash')`,

  `CREATE TABLE IF NOT EXISTS goals (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL DEFAULT 'system',
    title VARCHAR(200) NOT NULL,
    target_amount DECIMAL(14,2) NOT NULL,
    current_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    deadline DATE,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id)`,
];

async function runMigration(pool) {
  for (let i = 0; i < statements.length; i++) {
    try {
      await pool.query(statements[i]);
    } catch (e) {
      throw new Error(`migration step ${i + 1} failed: ${e.message}`);
    }
  }
}

module.exports = { runMigration };

// Standalone-запуск: node migrate.js
if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    user: process.env.DB_USER || 'noc',
    password: process.env.DB_PASSWORD || 'noc',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'financebot',
  });
  runMigration(pool)
    .then(() => { console.log('✅ Migration complete'); return pool.end(); })
    .catch((e) => { console.error('❌', e.message); process.exit(1); });
}
