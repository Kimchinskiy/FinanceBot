-- ===================================================================
-- FinanceBot — schema_v2.sql (миграция к многопользовательности)
-- Идемпотентно: безопасно запускать повторно.
-- ===================================================================

-- ──────────────────── USERS ────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(50) PRIMARY KEY,
    email         VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    tg_id         VARCHAR(50) UNIQUE,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- Системный пользователь для обратной совместимости (Telegram-бот / веб Mini App)
INSERT INTO users (id, email) VALUES ('system', 'system@local')
    ON CONFLICT (id) DO NOTHING;

-- ──────────────────── SCOPE СУЩЕСТВУЮЩИХ ТАБЛИЦ НА user_id ────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'incomes' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE incomes ADD COLUMN user_id VARCHAR(50) NOT NULL DEFAULT 'system';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'expenses' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE expenses ADD COLUMN user_id VARCHAR(50) NOT NULL DEFAULT 'system';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mandatory_payments' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE mandatory_payments ADD COLUMN user_id VARCHAR(50) NOT NULL DEFAULT 'system';
    END IF;
END $$;

-- ──────────────────── SETTINGS → per-user (user_id, key, value) ────────────────────
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'value'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE settings RENAME TO settings_old;

        CREATE TABLE settings (
            user_id    VARCHAR(50) NOT NULL DEFAULT 'system',
            key        VARCHAR(100) NOT NULL,
            value      JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (user_id, key)
        );

        INSERT INTO settings (user_id, key, value, updated_at)
        SELECT 'system', key, value, updated_at FROM settings_old;

        DROP TABLE settings_old;
    END IF;
END $$;

-- Гарантируем наличие таблицы settings в нужной схеме (если БД была пустой)
CREATE TABLE IF NOT EXISTS settings (
    user_id    VARCHAR(50) NOT NULL DEFAULT 'system',
    key        VARCHAR(100) NOT NULL,
    value      JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);

-- Сидим базовые настройки для system-пользователя (если их ещё нет)
INSERT INTO settings (user_id, key, value) VALUES
    ('system', 'cash', '"0"'::jsonb),
    ('system', 'salary', '{"day": null, "amount": 0, "period": "monthly"}'::jsonb),
    ('system', 'income_categories', '["Зарплата","Фриланс","Подработка","Подарок","Инвестиции","Прочее"]'::jsonb),
    ('system', 'expense_categories', '["Еда","Транспорт","Жильё","Одежда","Здоровье","Развлечения","Связь","Коммуналка","Кредит","Прочее"]'::jsonb)
ON CONFLICT (user_id, key) DO NOTHING;

-- ──────────────────── ACCOUNTS (счета) ────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id       VARCHAR(50) PRIMARY KEY,
    user_id  VARCHAR(50) NOT NULL DEFAULT 'system',
    name     VARCHAR(200) NOT NULL,
    type     VARCHAR(20) DEFAULT 'cash',   -- cash | card | deposit | crypto | broker
    currency VARCHAR(10) DEFAULT 'RUB',
    balance  DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id);

-- Сидим дефолтный счёт «Наличные» для system-пользователя
INSERT INTO accounts (id, user_id, name, type, currency, balance)
SELECT 'system-cash', 'system', 'Наличные', 'cash', 'RUB', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE user_id = 'system');
INSERT INTO accounts (id, user_id, name, type, currency, balance)
SELECT 'system-card', 'system', 'Карта', 'card', 'RUB', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE user_id = 'system' AND id <> 'system-cash');

-- ──────────────────── GOALS (цели накопления) ────────────────────
CREATE TABLE IF NOT EXISTS goals (
    id            VARCHAR(50) PRIMARY KEY,
    user_id       VARCHAR(50) NOT NULL DEFAULT 'system',
    title         VARCHAR(200) NOT NULL,
    target_amount DECIMAL(14,2) NOT NULL,
    current_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    deadline      DATE,
    created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id);
